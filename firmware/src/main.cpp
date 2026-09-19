// Vialtality node firmware (skeleton).
//
// Every wake: read temperature, humidity and battery, sometimes a GPS fix,
// append one record to a queue in flash, and every few wakes push the queue to
// the server. A record leaves flash only after the server acks it, so power
// cuts, dead zones and server outages lose nothing. Then deep sleep.
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
#ifndef VERDICT_LED_PIN
#define VERDICT_LED_PIN -1
#endif
#if HAS_DS18B20
#include <DallasTemperature.h>
#include <OneWire.h>
#endif

static const char *FW_VERSION = "0.1.0";
static const char *QUEUE_PATH = "/queue.bin";
static const char *QUEUE_TMP = "/queue.tmp";
static const time_t CLOCK_VALID_AFTER = 1704067200;  // 2024-01-01

// One reading, as stored in flash.
struct Record {
  uint32_t seq;
  uint32_t clock_s;   // RTC clock when sampled (true UTC if synced, else seconds since power-on)
  uint8_t synced;     // was the clock set when this was sampled?
  float temp_c;
  float rh;
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

// Worst verdict in the carrier, from the last ack: 0 none, 1 USE, 2 USE FIRST,
// 3 QUARANTINE, 4 DISCARD.
RTC_DATA_ATTR uint8_t worst_verdict = 0;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// ---------------------------------------------------------------- time -----

time_t nowClock() { return time(nullptr); }
bool clockSynced() { return nowClock() > CLOCK_VALID_AFTER; }

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
#if HAS_DS18B20
  probe.requestTemperatures();  // ~750 ms at 12-bit
  float t = probe.getTempCByIndex(0);
  // -127: probe disconnected; 85: power-on value before the first conversion.
  if (t == DEVICE_DISCONNECTED_C || t == 85.0f) t = NAN;
  float h = sht31.readHumidity();  // air humidity, if the SHT31 is fitted
#else
  float t = sht31.readTemperature();
  float h = sht31.readHumidity();
#endif
  if (isnan(t)) {
    Serial.println("temperature read failed; skipping this sample");
    return false;
  }
  bool fresh_fix = !isnan(last_lat) && wake_count - last_fix_wake <= GPS_EVERY * 2;
  r.seq = ++seq;
  r.clock_s = (uint32_t)nowClock();
  r.synced = clockSynced();
  r.temp_c = t;
  r.rh = isnan(h) ? NAN : h;
  r.lat = fresh_fix ? last_lat : NAN;
  r.lon = fresh_fix ? last_lon : NAN;
  r.battery_mv = readBatteryMv();
  return true;
}

// --------------------------------------------------------------- queue -----

size_t queuedCount() {
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
  File f = LittleFS.open(QUEUE_PATH, "r");
  if (!f) return 0;
  size_t n = f.read((uint8_t *)out, max * sizeof(Record)) / sizeof(Record);
  f.close();
  return n;
}

// Drop every record the server has acked (seq <= ack). Crash-safe: write a
// new file, then rename over the old one.
void dropAcked(uint32_t ack) {
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

// Sends one batch. Returns false on any failure; records stay queued.
bool sendBatch(const Record *records, size_t n) {
  JsonDocument doc;
  doc["node_id"] = NODE_ID;
  doc["boot_id"] = boot_id;
  doc["fw_version"] = FW_VERSION;
  doc["battery_v"] = readBatteryMv() / 1000.0;
  // For records we can't date: the server rebuilds their time from this.
  doc["uptime_ms"] = (uint64_t)nowClock() * 1000;
  JsonArray arr = doc["readings"].to<JsonArray>();
  for (size_t i = 0; i < n; i++) {
    const Record &r = records[i];
    JsonObject o = arr.add<JsonObject>();
    o["seq"] = r.seq;
    if (r.synced) {
      o["ts"] = r.clock_s;
    } else if (clock_offset_known) {
      o["ts"] = (int64_t)r.clock_s + clock_offset_s;
    } else {
      o["uptime_ms"] = (uint64_t)r.clock_s * 1000;
    }
    o["temp_c"] = roundf(r.temp_c * 100) / 100;
    if (!isnan(r.rh)) o["rh"] = roundf(r.rh * 10) / 10;
    if (!isnan(r.lat)) {
      o["lat"] = r.lat;
      o["lon"] = r.lon;
    }
    o["battery_v"] = r.battery_mv / 1000.0;
  }
  String body;
  serializeJson(doc, body);

  WiFiClientSecure tls;
  tls.setInsecure();  // TODO: pin the server's root CA for production
  HTTPClient http;
  http.begin(tls, String(API_BASE) + "/api/ingest/readings");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Node-Key", NODE_KEY);
  http.setTimeout(15000);
  int code = http.POST(body);
  if (code != 200) {
    Serial.printf("upload failed: HTTP %d\n", code);
    http.end();
    return false;
  }
  JsonDocument res;
  DeserializationError err = deserializeJson(res, http.getString());
  http.end();
  if (err) return false;

  if (!res["server_time"].isNull() && !clockSynced()) setClock(res["server_time"].as<time_t>());
  if (!res["ack_seq"].isNull()) dropAcked(res["ack_seq"].as<uint32_t>());
  const char *worst = res["worst_verdict"] | "";
  worst_verdict = !strcmp(worst, "DISCARD") ? 4 : !strcmp(worst, "QUARANTINE") ? 3
                : !strcmp(worst, "USE_FIRST") ? 2 : !strcmp(worst, "USE") ? 1 : 0;
  Serial.printf("uploaded %u: %d new, %d dup, %d rejected\n", (unsigned)n,
                res["accepted"].as<int>(), res["duplicates"].as<int>(), (int)res["rejected"].size());
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
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
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
  if (sample(r)) {
    enqueue(r);
    Serial.printf("#%u %.2f C %.1f%% %s\n", r.seq, r.temp_c, r.rh, isnan(r.lat) ? "no fix" : "fix");
  }
  if (wake_count % UPLOAD_EVERY == 0 || UPLOAD_EVERY == 1) flushQueue();
}

void setup() {
  Serial.begin(115200);
  setenv("TZ", "UTC0", 1);  // mktime() on GPS time must not apply a zone
  tzset();
  Wire.begin(I2C_SDA, I2C_SCL);
  if (!sht31.begin(0x44)) Serial.println("SHT31 not found");
#if HAS_DS18B20
  probe.begin();
  if (probe.getDeviceCount() == 0) Serial.println("DS18B20 not found");
#endif
#if VERDICT_LED_PIN >= 0
  pinMode(VERDICT_LED_PIN, OUTPUT);
#endif
  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");
  loadBootId();

#if DEMO_MODE
  Serial.printf("Vialtality %s demo mode, boot %u\n", NODE_ID, boot_id);
#else
  cycle();
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
