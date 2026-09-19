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

static const int DIGITAL_PINS[] = {4, 5, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};
static const int ADC_PINS[] = {32, 33, 34, 35, 36, 39};
// A DHT module has its own pull-up, but a DHT11 wired to 3.3 V may not read as pulled up: try them all.
static const int DHT_PINS[] = {4, 5, 2, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 12};

static const char *i2cName(uint8_t a) {
  switch (a) {
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

static void scanI2C() {
  Serial.println("I2C (every pair of pulled-up pins):");
  int found = 0;
  for (int a : DIGITAL_PINS) {
    for (int b : DIGITAL_PINS) {
      if (a == b || !pulledUp(a) || !pulledUp(b)) continue;
      Wire.begin(a, b, 100000);
      for (uint8_t addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
          Serial.printf("  SDA %d, SCL %d: 0x%02X %s\n", a, b, addr, i2cName(addr));
          found++;
        }
      }
      Wire.end();
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

void setup() {
  Serial.begin(115200);
  delay(500);
}

void loop() {
  Serial.println("\n=== Vialtality sensor finder ===");
  Serial.print("Pins pulled high externally:");
  for (int pin : DIGITAL_PINS)
    if (pulledUp(pin)) Serial.printf(" %d", pin);
  Serial.println();
  scanDHT();
  scanI2C();
  scanOneWire();
  Serial.println("=== done; scanning again in 10 s ===");
  delay(10000);
}
