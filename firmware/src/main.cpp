// SecuriVax node firmware.
//
// Every wake: read temperature, humidity and battery, sometimes a GPS fix,
// append one record to a queue in flash, then deep sleep. WiFi is the big
// power cost, so the node only connects to check in every UPLOAD_EVERY wakes
// (pushing the queue and hearing the server's reply), or at once when a
// reading leaves the safe range. A record leaves flash only after the server
// acks it, so power cuts, dead zones and server outages lose nothing.
//
// Live on request: when someone on the website asks to watch this node, the
// reply to its next check-in says so, and it stays awake with WiFi up, a
// reading every live_sample_s, each uploaded, until live_until. Then it goes
// back to sleep.
//
// Protocol: POST {API_BASE}/api/ingest/readings (see backend/app/routers/ingest.py)
//   (node_id, boot_id, seq) identifies a reading, so resending is always safe.

#include <Arduino.h>
#include <Adafruit_SHT31.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <sys/time.h>

#if __has_include("config.h")
#include "config.h"
#else
#include "config.example.h"
#endif

#ifndef HAS_DS18B20
#define HAS_DS18B20 0
#endif
// A reading outside this range goes up at once instead of at the next check-in.
#ifndef ALARM_LOW_C
#define ALARM_LOW_C 2.0f
#endif
#ifndef ALARM_HIGH_C
#define ALARM_HIGH_C 8.0f
#endif
#ifndef VERDICT_LED_PIN
#define VERDICT_LED_PIN -1
#endif
#ifndef DHT_PIN
#define DHT_PIN -1
#endif
#ifndef DHT2_PIN
#define DHT2_PIN -1
#endif
// Two DHTs in one box back each other up: the second one's readings go up as
// this node (the server knows it as NODE_ID's backup), and where both read at
// once the server keeps the more cautious one and flags a disagreement.
#ifndef BACKUP_NODE_ID
#define BACKUP_NODE_ID NODE_ID "B"
#endif
#if HAS_DS18B20
#include <DallasTemperature.h>
#include <OneWire.h>
#endif
#if DHT_PIN >= 0
#include <DHT.h>
#endif

static const char *FW_VERSION = "0.3.0";
static const char *QUEUE_PATH = "/queue2.bin";  // v2 records carry the second sensor
static const char *QUEUE_TMP = "/queue.tmp";
static const char *OLD_QUEUE_PATH = "/queue.bin";  // v1 records: a different size, so dropped on upgrade
static const time_t CLOCK_VALID_AFTER = 1704067200;  // 2024-01-01

// One reading, as stored in flash.
struct Record {
  uint32_t seq;
  uint32_t clock_s;   // RTC clock when sampled (true UTC if synced, else seconds since power-on)
  uint8_t synced;     // was the clock set when this was sampled?
  float temp_c;       // NAN when the first sensor's read failed
  float rh;
  float temp2_c;      // the second DHT; NAN when there is none or its read failed
  float rh2;
  float lat;          // NAN when there is no recent fix
  float lon;
  uint16_t battery_mv;
};

// Survive deep sleep (lost on power-off, which starts a new boot_id).
RTC_DATA_ATTR uint32_t wake_count = 0;
RTC_DATA_ATTR uint32_t seq = 0;
RTC_DATA_ATTR float last_lat = NAN, last_lon = NAN;
RTC_DATA_ATTR uint32_t last_fix_wake = 0;
// Offset from "seconds since power-on" to UTC, learnt at the first clock sync,
// used to date records that were sampled before the clock was set.
RTC_DATA_ATTR int64_t clock_offset_s = 0;
RTC_DATA_ATTR bool clock_offset_known = false;

uint32_t boot_id = 0;
Adafruit_SHT31 sht31;
#if HAS_DS18B20
OneWire oneWire(DS18B20_PIN);
DallasTemperature probe(&oneWire);
#endif

// Which sensor gives the temperature: a DS18B20 probe if one answers, else the
// SHT31, else a DHT11/DHT22.
bool use_probe = false;
bool sht_ok = false;
bool use_dht = false;
#if DHT_PIN >= 0
DHT *dht = nullptr;
int dht_pin = -1;
DHT *dht2 = nullptr;
// Found once at power-on (the search takes a while), then reused after each deep sleep.
RTC_DATA_ATTR int8_t rtc_dht_pin = -1;
RTC_DATA_ATTR int8_t rtc_dht2_pin = -1;

// Pins a DHT's data wire might be on: DHT_PIN first, then the other free
// GPIOs. Skips the boot pins (0, 2, 12, 15), UART0 (1, 3), the flash pins
// (6-11), 16/17 (PSRAM on WROVER modules) and the input-only 34-39.
static const int DHT_CANDIDATES[] = {DHT_PIN, 4, 5, 13, 14, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};

/**
 * Does anything on this pin answer a DHT start signal?
 *
 * The library's read bit-bangs the line with interrupts off. On a pin with
 * nothing on it that spin can outlast the interrupt watchdog, which panics
 * the core and reboots the node: searching the free GPIOs would crash-loop
 * before it ever took a reading. So knock first, here, with interrupts on
 * and every wait bounded: pull the line low for the start, let it go, and
 * see whether something pulls it back down within the time a DHT would.
 */
static bool dhtAnswers(int pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delay(20);  // a DHT11 wants at least 18 ms of start signal
  pinMode(pin, INPUT_PULLUP);
  uint32_t t0 = micros();
  while (digitalRead(pin) == HIGH) {
    if (micros() - t0 > 250) return false;  // nobody pulled it down: no sensor
  }
  t0 = micros();
  while (digitalRead(pin) == LOW) {
    if (micros() - t0 > 250) return false;  // held low: a short, not a sensor
  }
  return true;
}

/**
 * A DHT on this pin that answers, or nullptr. `knock` first asks whether
 * anything is there at all: that is for the blind sweep of the free GPIOs,
 * where most pins have nothing on them. A pin someone configured is read
 * straight, because a sensor wired without an external pull-up can be slow
 * to let the line rise and would fail the knock while reading perfectly well.
 */
DHT *tryDht(int pin, bool knock) {
  if (knock && !dhtAnswers(pin)) {
    pinMode(pin, INPUT);
    return nullptr;
  }
  DHT *probe = new DHT(pin, DHT_TYPE);
  probe->begin();
  for (int i = 0; i < 2; i++) {
    delay(1100);  // a DHT11 needs a second between reads
    if (!isnan(probe->readTemperature(false, true))) return probe;
  }
  delete probe;
  pinMode(pin, INPUT);
  return nullptr;
}

// Up to two DHTs: the configured pins first, then (only at power-on) the free
// GPIOs. The pins found are kept in RTC memory, so a wake from deep sleep
// doesn't search again.
bool findDhts() {
  if (rtc_dht_pin >= 0) {
    dht = new DHT(rtc_dht_pin, DHT_TYPE);
    dht->begin();
    dht_pin = rtc_dht_pin;
    if (rtc_dht2_pin >= 0) {
      dht2 = new DHT(rtc_dht2_pin, DHT_TYPE);
      dht2->begin();
    }
    delay(1100);  // first read after power-up
    return true;
  }
  int found[2] = {-1, -1};
  int n = 0;
  for (int pin : {DHT_PIN, DHT2_PIN}) {
    if (pin < 0 || n >= 2) continue;
    DHT *d = tryDht(pin, false);  // configured: read it straight
    if (d) {
      (n == 0 ? dht : dht2) = d;
      found[n++] = pin;
    }
  }
  if (n < 2 && DHT2_PIN < 0) {
    for (int pin : DHT_CANDIDATES) {
      if (n >= 2) break;
      if (pin < 0 || pin == found[0] || pin == found[1]) continue;
      DHT *d = tryDht(pin, true);  // a sweep of pins that are mostly empty
      if (d) {
        (n == 0 ? dht : dht2) = d;
        found[n++] = pin;
      }
    }
  }
  dht_pin = found[0];
  rtc_dht_pin = found[0];
  rtc_dht2_pin = found[1];
  return n > 0;
}
#endif

// Worst verdict in the carrier, from the last ack: 0 none, 1 USE, 2 USE FIRST,
// 3 QUARANTINE, 4 DISCARD.
RTC_DATA_ATTR uint8_t worst_verdict = 0;
// Live on request, from the last ack: stream until this UTC second.
RTC_DATA_ATTR uint32_t live_until = 0;
RTC_DATA_ATTR uint16_t live_sample_s = 10;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// ---------------------------------------------------------------- time -----

time_t nowClock() { return time(nullptr); }
bool clockSynced() { return nowClock() > CLOCK_VALID_AFTER; }
bool liveNow() { return clockSynced() && (uint32_t)nowClock() < live_until; }

void setClock(time_t utc) {
  if (!clockSynced() && !clock_offset_known) {
    clock_offset_s = (int64_t)utc - (int64_t)nowClock();
    clock_offset_known = true;
  }
  timeval tv = {.tv_sec = utc, .tv_usec = 0};
  settimeofday(&tv, nullptr);  // the RTC keeps counting through deep sleep
}

// ------------------------------------------------------------- sensors -----

uint16_t readBatteryMv() {
  return (uint16_t)(analogReadMilliVolts(BATTERY_PIN) * BATTERY_DIVIDER);
}

void gpsPower(bool on) {
  if (GPS_POWER_PIN < 0) return;
  pinMode(GPS_POWER_PIN, OUTPUT);
  digitalWrite(GPS_POWER_PIN, on ? LOW : HIGH);  // P-MOSFET: LOW = on
}

// Try for a fix; also sets the clock from satellite time.
void updateGps() {
  gpsPower(true);
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  uint32_t start = millis();
  while (millis() - start < GPS_FIX_TIMEOUT_MS) {
    while (gpsSerial.available()) gps.encode(gpsSerial.read());
    if (gps.location.isUpdated() && gps.location.isValid() && gps.date.isValid() && gps.time.isValid()) {
      last_lat = gps.location.lat();
      last_lon = gps.location.lng();
      last_fix_wake = wake_count;
      tm t = {};
      t.tm_year = gps.date.year() - 1900;
      t.tm_mon = gps.date.month() - 1;
      t.tm_mday = gps.date.day();
      t.tm_hour = gps.time.hour();
      t.tm_min = gps.time.minute();
      t.tm_sec = gps.time.second();
      setClock(mktime(&t));
      break;
    }
    delay(10);
  }
  gpsSerial.end();
#if !DEMO_MODE
  gpsPower(false);
#endif
}

bool sample(Record &r) {
  float t = NAN;
  float h = sht_ok ? sht31.readHumidity() : NAN;  // air humidity, if the SHT31 is fitted
  float t2 = NAN, h2 = NAN;
#if HAS_DS18B20
  if (use_probe) {
    probe.requestTemperatures();  // ~750 ms at 12-bit
    t = probe.getTempCByIndex(0);
    // -127: probe disconnected; 85: power-on value before the first conversion.
    if (t == DEVICE_DISCONNECTED_C || t == 85.0f) t = NAN;
  }
#endif
  if (!use_probe && sht_ok) t = sht31.readTemperature();
#if DHT_PIN >= 0
  if (!use_probe && !sht_ok && use_dht) {
    t = dht->readTemperature();
    h = dht->readHumidity();
    if (dht2) {
      t2 = dht2->readTemperature();
      h2 = dht2->readHumidity();
    }
  }
#endif
  if (isnan(t) && isnan(t2)) {
    Serial.println("temperature read failed; skipping this sample");
    return false;
  }
  bool fresh_fix = !isnan(last_lat) && wake_count - last_fix_wake <= GPS_EVERY * 2;
  r.seq = ++seq;
  r.clock_s = (uint32_t)nowClock();
  r.synced = clockSynced();
  r.temp_c = t;
  r.rh = isnan(h) ? NAN : h;
  r.temp2_c = t2;
  r.rh2 = isnan(h2) ? NAN : h2;
  r.lat = fresh_fix ? last_lat : NAN;
  r.lon = fresh_fix ? last_lon : NAN;
  r.battery_mv = readBatteryMv();
  return true;
}

// --------------------------------------------------------------- queue -----

size_t queuedCount() {
  if (!LittleFS.exists(QUEUE_PATH)) return 0;  // nothing queued yet (and no error log)
  File f = LittleFS.open(QUEUE_PATH, "r");
  size_t n = f ? f.size() / sizeof(Record) : 0;
  if (f) f.close();
  return n;
}

void enqueue(const Record &r) {
  if (queuedCount() >= MAX_QUEUED) {
    Serial.println("queue full: dropping this reading");  // ~2 weeks offline
    return;
  }
  File f = LittleFS.open(QUEUE_PATH, "a");
  f.write((const uint8_t *)&r, sizeof(Record));
  f.close();
}

size_t peek(Record *out, size_t max) {
  if (!LittleFS.exists(QUEUE_PATH)) return 0;
  File f = LittleFS.open(QUEUE_PATH, "r");
  if (!f) return 0;
  size_t n = f.read((uint8_t *)out, max * sizeof(Record)) / sizeof(Record);
  f.close();
  return n;
}

// Drop every record the server has acked (seq <= ack). Crash-safe: write a
// new file, then rename over the old one.
void dropAcked(uint32_t ack) {
  if (!LittleFS.exists(QUEUE_PATH)) return;
  File in = LittleFS.open(QUEUE_PATH, "r");
  if (!in) return;
  File out = LittleFS.open(QUEUE_TMP, "w");
  Record r;
  while (in.read((uint8_t *)&r, sizeof(Record)) == sizeof(Record)) {
    if (r.seq > ack) out.write((const uint8_t *)&r, sizeof(Record));
  }
  in.close();
  out.close();
  LittleFS.remove(QUEUE_PATH);
  LittleFS.rename(QUEUE_TMP, QUEUE_PATH);
}

// -------------------------------------------------------------- uplink -----

bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) delay(100);
  return WiFi.status() == WL_CONNECTED;
}

// Posts one sensor's readings from these records (second = the backup DHT)
// under node_id. Returns false on any failure; `ack` gets the acked seq.
// Only the primary's reply sets the clock, the LED and live mode.
bool postReadings(const char *node_id, const Record *records, size_t n, bool second, uint32_t &ack) {
  JsonDocument doc;
  doc["node_id"] = node_id;
  doc["boot_id"] = boot_id;
  doc["fw_version"] = FW_VERSION;
  // The server sizes its allowance for calibration error by this.
  const char *sensor = use_probe ? "ds18b20" : sht_ok ? "sht31" : use_dht ? (DHT_TYPE == DHT11 ? "dht11" : "dht22") : nullptr;
  if (sensor) doc["sensor"] = sensor;
  doc["battery_v"] = readBatteryMv() / 1000.0;
  doc["checkin_s"] = SAMPLE_INTERVAL_S * UPLOAD_EVERY;  // so the website knows when it'll next hear from us
  // For records we can't date: the server rebuilds their time from this.
  doc["uptime_ms"] = (uint64_t)nowClock() * 1000;
  JsonArray arr = doc["readings"].to<JsonArray>();
  for (size_t i = 0; i < n; i++) {
    const Record &r = records[i];
    float t = second ? r.temp2_c : r.temp_c;
    float h = second ? r.rh2 : r.rh;
    if (isnan(t)) continue;  // this sensor missed that reading
    JsonObject o = arr.add<JsonObject>();
    o["seq"] = r.seq;
    if (r.synced) {
      o["ts"] = r.clock_s;
    } else if (clock_offset_known) {
      o["ts"] = (int64_t)r.clock_s + clock_offset_s;
    } else {
      o["uptime_ms"] = (uint64_t)r.clock_s * 1000;
    }
    o["temp_c"] = roundf(t * 100) / 100;
    if (!isnan(h)) o["rh"] = roundf(h * 10) / 10;
    if (!isnan(r.lat)) {
      o["lat"] = r.lat;
      o["lon"] = r.lon;
    }
    o["battery_v"] = r.battery_mv / 1000.0;
  }
  if (arr.size() == 0) {  // nothing from this sensor in these records: nothing to wait for
    ack = records[n - 1].seq;
    return true;
  }
  String body;
  serializeJson(doc, body);

  // https:// for the deployed server (or the laptop's phone-test server on
  // :5173); plain http:// for the laptop's API on :8000 while testing.
  String url = String(API_BASE) + "/api/ingest/readings";
  WiFiClientSecure tls;
  tls.setInsecure();  // TODO: pin the server's root CA for production
  WiFiClient plain;
  HTTPClient http;
  if (url.startsWith("https://")) {
    http.begin(tls, url);
  } else {
    http.begin(plain, url);
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Node-Key", NODE_KEY);
  http.setTimeout(15000);
  int code = http.POST(body);
  if (code != 200) {
    Serial.printf("upload for %s failed: HTTP %d\n", node_id, code);
    http.end();
    return false;
  }
  JsonDocument res;
  DeserializationError err = deserializeJson(res, http.getString());
  http.end();
  if (err || res["ack_seq"].isNull()) return false;
  ack = res["ack_seq"].as<uint32_t>();

  if (!second) {
    if (!res["server_time"].isNull() && !clockSynced()) setClock(res["server_time"].as<time_t>());
    const char *worst = res["worst_verdict"] | "";
    worst_verdict = !strcmp(worst, "DISCARD") ? 4 : !strcmp(worst, "QUARANTINE") ? 3
                  : !strcmp(worst, "USE_FIRST") ? 2 : !strcmp(worst, "USE") ? 1 : 0;
    uint32_t was_live = live_until;
    live_until = res["live_until"].isNull() ? 0 : res["live_until"].as<uint32_t>();
    if (!res["live_sample_s"].isNull()) live_sample_s = max<uint16_t>(2, res["live_sample_s"].as<uint16_t>());
    if (live_until && !was_live) Serial.printf("someone is watching: live every %u s until %u\n", live_sample_s, live_until);
  }
  Serial.printf("uploaded %u for %s: %d new, %d dup, %d rejected\n", (unsigned)arr.size(), node_id,
                res["accepted"].as<int>(), res["duplicates"].as<int>(), (int)res["rejected"].size());
  return true;
}

// Sends one batch: the first sensor as NODE_ID, the second (if fitted) as
// BACKUP_NODE_ID. Records leave flash only once both are acked; on any
// failure they stay queued, and resending is safe (seq identifies a reading).
bool sendBatch(const Record *records, size_t n) {
  uint32_t ack = 0, ack2 = UINT32_MAX;
  if (!postReadings(NODE_ID, records, n, false, ack)) return false;
#if DHT_PIN >= 0
  if (dht2 && !postReadings(BACKUP_NODE_ID, records, n, true, ack2)) return false;
#endif
  dropAcked(min(ack, ack2));
  return true;
}

void flushQueue() {
  if (queuedCount() == 0 || !connectWifi()) return;
  static Record batch[BATCH_SIZE];
  for (int i = 0; i < MAX_BATCHES_PER_WAKE; i++) {
    size_t n = peek(batch, BATCH_SIZE);
    if (n == 0 || !sendBatch(batch, n)) break;
  }
#if !DEMO_MODE
  if (!liveNow()) {  // while someone watches, keep WiFi up for the next reading
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
  }
#endif
}

// ---------------------------------------------------------------- main -----

void loadBootId() {
  Preferences prefs;
  prefs.begin("vialtality", false);
  boot_id = prefs.getUInt("boot_id", 0);
  if (esp_reset_reason() != ESP_RST_DEEPSLEEP) {
    boot_id++;  // fresh power-on: seq restarts, so (boot_id, seq) stays unique
    prefs.putUInt("boot_id", boot_id);
  }
  prefs.end();
}

void cycle() {
  wake_count++;
#if HAS_GPS
  if (wake_count % GPS_EVERY == 1 || GPS_EVERY == 1) updateGps();
#endif
  Record r;
  bool alarm = false;
  if (sample(r)) {
    enqueue(r);
    for (float t : {r.temp_c, r.temp2_c})
      if (!isnan(t) && (t < ALARM_LOW_C || t > ALARM_HIGH_C)) alarm = true;
    Serial.printf("#%u %.2f C %.1f%% %s", r.seq, r.temp_c, r.rh, isnan(r.lat) ? "no fix" : "fix");
    if (!isnan(r.temp2_c)) Serial.printf(" | B %.2f C %.1f%%", r.temp2_c, r.rh2);
    Serial.println(alarm ? " OUT OF RANGE" : "");
  }
  // Check in on schedule; at once when a reading is out of range or someone is watching.
  bool due = UPLOAD_EVERY == 1 || wake_count % UPLOAD_EVERY == 0;
  if (due || alarm || liveNow()) flushQueue();
}

void setup() {
  Serial.begin(115200);
  setenv("TZ", "UTC0", 1);  // mktime() on GPS time must not apply a zone
  tzset();
  Wire.begin(I2C_SDA, I2C_SCL);
  sht_ok = sht31.begin(0x44) || sht31.begin(0x45);  // 0x45 when the board's ADR pin is high
#if HAS_DS18B20
  probe.begin();
  use_probe = probe.getDeviceCount() > 0;
#endif
#if DHT_PIN >= 0
  if (!use_probe && !sht_ok) {
    if (rtc_dht_pin < 0) Serial.println("looking for DHT11/DHT22 sensors (two, if a backup is fitted)...");
    use_dht = findDhts();
  }
#endif
  if (use_probe) Serial.printf("temperature: DS18B20 probe on GPIO %d%s\n", DS18B20_PIN, sht_ok ? ", humidity: SHT31" : "");
  else if (sht_ok) Serial.printf("temperature and humidity: SHT31 on SDA %d / SCL %d\n", I2C_SDA, I2C_SCL);
#if DHT_PIN >= 0
  else if (use_dht) {
    Serial.printf("temperature and humidity: %s on GPIO %d\n", DHT_TYPE == DHT11 ? "DHT11" : "DHT22", dht_pin);
    if (dht2) Serial.printf("backup %s on GPIO %d, uploaded as %s\n", DHT_TYPE == DHT11 ? "DHT11" : "DHT22", rtc_dht2_pin, BACKUP_NODE_ID);
    if (dht_pin != DHT_PIN || (dht2 && rtc_dht2_pin != DHT2_PIN))
      Serial.printf("set DHT_PIN %d and DHT2_PIN %d in config.h to skip the search\n", dht_pin, rtc_dht2_pin);
  }
#endif
  else Serial.printf("no temperature sensor found: SHT31 on SDA %d / SCL %d, DS18B20 on GPIO %d (4.7k pull-up), or DHT on GPIO %d\n",
                     I2C_SDA, I2C_SCL, HAS_DS18B20 ? DS18B20_PIN : -1, DHT_PIN);
#if VERDICT_LED_PIN >= 0
  pinMode(VERDICT_LED_PIN, OUTPUT);
#endif
  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");
  if (LittleFS.exists(OLD_QUEUE_PATH)) LittleFS.remove(OLD_QUEUE_PATH);  // v1 records don't fit v2
  if (!LittleFS.exists(QUEUE_PATH)) LittleFS.open(QUEUE_PATH, "w").close();  // so later checks never log a miss
  loadBootId();

#if DEMO_MODE
  Serial.printf("SecuriVax %s demo mode, boot %u\n", NODE_ID, boot_id);
#else
  cycle();
  // Someone asked to watch live: stay awake, WiFi up, until the window closes.
  while (liveNow()) {
    delay(live_sample_s * 1000UL);
    cycle();
  }
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  esp_sleep_enable_timer_wakeup((uint64_t)SAMPLE_INTERVAL_S * 1000000ULL);
  esp_deep_sleep_start();
#endif
}

// The LED's pattern for the worst verdict, at time t (ms).
bool ledOn(uint32_t t) {
  switch (worst_verdict) {
    case 1: return true;                          // USE: solid
    case 2: return (t / 500) % 2 == 0;            // USE FIRST: slow blink
    case 3: return (t / 125) % 2 == 0;            // QUARANTINE: fast blink
    case 4: { uint32_t p = t % 1200;              // DISCARD: double flash
              return p < 120 || (p > 240 && p < 360); }
    default: return false;                        // nothing loaded
  }
}

void loop() {
#if DEMO_MODE
  uint32_t start = millis();
  cycle();
  // Wait out the interval, driving the LED instead of sleeping.
  while (millis() - start < SAMPLE_INTERVAL_S * 1000UL) {
#if VERDICT_LED_PIN >= 0
    digitalWrite(VERDICT_LED_PIN, ledOn(millis()) ? HIGH : LOW);
#endif
    delay(20);
  }
#endif
}
