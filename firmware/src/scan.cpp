// Sensor finder: flash with `pio run -e scan -t upload`, then read the serial
// monitor. Reports every temperature sensor it can find and the pins it is on:
// I2C devices (SHT3x, BME/BMP280, AHT, HTU21D, ...), DS18B20 probes, DHT11/22,
// and analog sensors (TMP36, LM35, thermistors). Uses only pins that are safe
// to drive after boot; never touches the flash pins (6-11) or UART0 (1, 3).
#include <Arduino.h>
#include <SPI.h>  // Adafruit's sensor libraries need it found
#include <DHT.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <Wire.h>

// Every pin safe to drive after boot. A generic board's silkscreen cannot be
// trusted and its module has no PSRAM, so 16 and 17 are free and 2 is fair
// game once booted: sensors turn up on all three. Still never 6-11 (flash),
// 1/3 (UART0), 12 (holds the flash voltage at reset) or 34-39 (input only).
static const int DIGITAL_PINS[] = {2, 4, 5, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};
static const int ADC_PINS[] = {32, 33, 34, 35, 36, 39};
// A DHT module has its own pull-up, but a DHT11 wired to 3.3 V may not read as pulled up: try them all.
static const int DHT_PINS[] = {2, 4, 5, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};

static int dhtEdges(int pin);

static const char *i2cName(uint8_t a) {
  switch (a) {
    case 0x39: return "AHT20/Si7021-class temperature/humidity";
    case 0x41: return "HDC1080/HDC2010 temperature/humidity";
    case 0x44: case 0x45: return "SHT3x (SHT31) temperature/humidity";
    case 0x76: case 0x77: return "BME280/BMP280 temperature/pressure";
    case 0x38: return "AHT10/AHT20 temperature/humidity";
    case 0x40: return "HTU21D/SHT21/Si7021 temperature/humidity";
    case 0x5C: return "AM2320 temperature/humidity";
    case 0x18: return "MCP9808 temperature";
    case 0x48: case 0x49: case 0x4A: case 0x4B: return "TMP102/LM75 temperature (or ADS1115 ADC)";
    case 0x3C: case 0x3D: return "OLED display";
    default: return "unknown I2C device";
  }
}

// Pins an external pull-up holds high: where sensor data lines usually are.
static bool pulledUp(int pin) {
  pinMode(pin, INPUT_PULLDOWN);
  delay(2);
  bool high = digitalRead(pin);
  pinMode(pin, INPUT);
  return high;
}

// The addresses a temperature or humidity part actually answers on. Sweeping
// all 126 across every pin pair takes minutes; these take seconds.
static const uint8_t I2C_SENSORS[] = {0x18, 0x38, 0x39, 0x40, 0x41, 0x44, 0x45, 0x48, 0x49, 0x4A, 0x4B, 0x5C, 0x76, 0x77};

static void scanI2C() {
  Serial.println("I2C (every pair where at least one line is pulled up):");
  int found = 0;
  bool up[64] = {false};
  for (int pin : DIGITAL_PINS) up[pin] = pulledUp(pin);
  for (int sda : DIGITAL_PINS) {
    for (int scl : DIGITAL_PINS) {
      // A module pulls both lines up, but a weak pull-up on one of them can
      // read low, so one is enough to be worth trying.
      if (sda == scl || !(up[sda] || up[scl])) continue;
      Wire.begin(sda, scl, 100000);
      Wire.setTimeOut(20);
      for (uint8_t addr : I2C_SENSORS) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
          Serial.printf("  SDA %d, SCL %d: 0x%02X %s  <- set I2C_SDA %d and I2C_SCL %d\n", sda, scl, addr, i2cName(addr), sda, scl);
          found++;
        }
      }
      Wire.end();
      delay(2);
    }
  }
  if (!found) Serial.println("  nothing");
}

static void scanOneWire() {
  Serial.println("DS18B20 / 1-Wire:");
  int found = 0;
  for (int pin : DIGITAL_PINS) {
    if (!pulledUp(pin)) continue;
    OneWire ow(pin);
    DallasTemperature dt(&ow);
    dt.begin();
    int n = dt.getDeviceCount();
    if (n > 0) {
      dt.requestTemperatures();
      Serial.printf("  GPIO %d: %d probe(s), %.2f C\n", pin, n, dt.getTempCByIndex(0));
      found++;
    }
  }
  if (!found) Serial.println("  nothing (a DS18B20 needs a 4.7k pull-up from data to 3.3V)");
}

static void scanDHT() {
  Serial.println("DHT11 / DHT22 (every safe pin, 2.5 s start-up each):");
  int found = 0;
  for (int pin : DHT_PINS) {
    // Only pins that answered the raw handshake above. The library reads with
    // interrupts off, and on an empty pin that spin outlasts the interrupt
    // watchdog and panics the core, which used to end the scan half way.
    if (dhtEdges(pin) < 4) continue;
    for (uint8_t type : {DHT11, DHT22}) {
      DHT dht(pin, type);
      dht.begin();
      delay(2500);
      float t = dht.readTemperature(false, true), h = dht.readHumidity();
      if (!isnan(t) && !isnan(h) && h > 0) {
        Serial.printf("  GPIO %d: %s, %.1f C, %.0f%% RH\n", pin, type == DHT22 ? "DHT22" : "DHT11", t, h);
        found++;
        break;
      }
    }
  }
  if (!found) Serial.println("  nothing");
}

static void scanAnalog() {
  Serial.println("Analog (something wired to an ADC pin reads between rails):");
  for (int pin : ADC_PINS) {
    uint32_t mv = 0;
    for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(pin);
    mv /= 16;
    if (mv > 80 && mv < 3150)
      Serial.printf("  GPIO %d: %u mV  (TMP36 would be %.1f C, LM35 %.1f C)\n", pin, mv, ((int)mv - 500) / 10.0, mv / 10.0);
  }
}

// A closer look at each pulled-up pin: is any 1-Wire device answering at all,
// and does a DHT answer if given its full 2 s start-up?
static void deepProbe() {
  Serial.println("Closer look at pulled-up pins:");
  for (int pin : DIGITAL_PINS) {
    if (!pulledUp(pin)) continue;
    OneWire ow(pin);
    uint8_t presence = ow.reset();
    Serial.printf("  GPIO %d: 1-Wire presence pulse: %s\n", pin, presence ? "yes (a 1-Wire device answers)" : "no");
    for (uint8_t type : {DHT11, DHT22}) {
      DHT dht(pin, type);
      dht.begin();
      for (int attempt = 0; attempt < 3; attempt++) {
        delay(2500);
        float t = dht.readTemperature(false, true), h = dht.readHumidity();
        if (!isnan(t)) {
          Serial.printf("  GPIO %d: %s answers: %.1f C, %.0f%% RH\n", pin, type == DHT22 ? "DHT22" : "DHT11", t, h);
          return;
        }
      }
    }
    Serial.printf("  GPIO %d: no DHT11/DHT22 answer after 3 tries each\n", pin);
  }
}

// The DHT handshake by hand: pull the line low for 20 ms, let go, and count
// how many times it changes in the next 6 ms. A live DHT answers with ~80
// edges (its 40 data bits); a wire to nothing answers with none.
static int dhtEdges(int pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delay(20);
  pinMode(pin, INPUT_PULLUP);
  int edges = 0, last = digitalRead(pin);
  uint32_t t = micros();
  while (micros() - t < 6000) {
    int now = digitalRead(pin);
    if (now != last) { edges++; last = now; }
  }
  return edges;
}

static void rawDht() {
  Serial.println("Raw DHT handshake (edges in 6 ms; a live sensor gives ~80):");
  for (int pin : DHT_PINS) {
    int e = dhtEdges(pin);
    if (e > 0) Serial.printf("  GPIO %d: %d edges%s\n", pin, e, e > 60 ? "  <- a DHT is answering here" : "");
    delay(1200);
  }
  Serial.println("  (pins with no edges are left out)");
}

void setup() {
  Serial.begin(115200);
  delay(500);
}

void loop() {
  Serial.println("\n=== SecuriVax sensor finder ===");
  Serial.print("Pins pulled high externally:");
  for (int pin : DIGITAL_PINS)
    if (pulledUp(pin)) Serial.printf(" %d", pin);
  Serial.println();
  scanI2C();      // an AHT/SHT/BME module is two wires and a pull-up: look first
  scanOneWire();
  rawDht();
  scanDHT();
  scanAnalog();
  deepProbe();
  Serial.println("=== done; scanning again in 10 s ===");
  delay(10000);
}
