// I2C sensor identifier: flash with `pio run -e i2c -t upload`, then read the
// monitor. An address scan only proves something acknowledged; a bus with one
// weak pull-up will acknowledge addresses that hold nothing. This talks to
// each candidate in its own language and prints the temperature and humidity
// it gets back, so the sensor that is really there identifies itself.
//
// Set the pins below to the ones `pio run -e scan` reported.
#include <Arduino.h>
#include <Wire.h>

#include "config.h"

static const int SDA_PIN = I2C_SDA;
static const int SCL_PIN = I2C_SCL;

static bool i2cRead(uint8_t addr, uint8_t *buf, size_t n) {
  return Wire.requestFrom((int)addr, (int)n) == (int)n && Wire.readBytes(buf, n) == n;
}

static bool i2cWrite(uint8_t addr, const uint8_t *cmd, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(cmd, n);
  return Wire.endTransmission() == 0;
}

/** AHT10 / AHT20 / DHT20 at 0x38: the cheap module in most kits. */
static void tryAht() {
  const uint8_t addr = 0x38;
  const uint8_t init[] = {0xBE, 0x08, 0x00};
  const uint8_t measure[] = {0xAC, 0x33, 0x00};
  if (!i2cWrite(addr, init, 3)) {
    Serial.println("  AHT (0x38): no answer to init");
    return;
  }
  delay(20);
  if (!i2cWrite(addr, measure, 3)) {
    Serial.println("  AHT (0x38): no answer to measure");
    return;
  }
  delay(100);
  uint8_t b[7] = {0};
  if (!i2cRead(addr, b, 7)) {
    Serial.println("  AHT (0x38): no data");
    return;
  }
  if (b[0] & 0x80) {
    Serial.println("  AHT (0x38): still busy");
    return;
  }
  uint32_t h = ((uint32_t)b[1] << 12) | ((uint32_t)b[2] << 4) | (b[3] >> 4);
  uint32_t t = (((uint32_t)b[3] & 0x0F) << 16) | ((uint32_t)b[4] << 8) | b[5];
  Serial.printf("  AHT (0x38): %.2f C, %.1f%% RH   <- an AHT10/AHT20/DHT20\n",
                t * 200.0 / 1048576.0 - 50.0, h * 100.0 / 1048576.0);
}

/** SHT3x at 0x44 or 0x45: single shot, high repeatability, clock stretching off. */
static void trySht(uint8_t addr) {
  const uint8_t single[] = {0x24, 0x00};
  if (!i2cWrite(addr, single, 2)) {
    Serial.printf("  SHT3x (0x%02X): no answer\n", addr);
    return;
  }
  delay(20);
  uint8_t b[6] = {0};
  if (!i2cRead(addr, b, 6)) {
    Serial.printf("  SHT3x (0x%02X): no data\n", addr);
    return;
  }
  uint16_t rawT = (b[0] << 8) | b[1];
  uint16_t rawH = (b[3] << 8) | b[4];
  if (rawT == 0 && rawH == 0) {
    Serial.printf("  SHT3x (0x%02X): zeros, so nothing is really there\n", addr);
    return;
  }
  Serial.printf("  SHT3x (0x%02X): %.2f C, %.1f%% RH   <- an SHT3x\n", addr,
                -45.0 + 175.0 * rawT / 65535.0, 100.0 * rawH / 65535.0);
}

/** MCP9808 at 0x18: temperature only, register 0x05. */
static void tryMcp() {
  const uint8_t reg = 0x05;
  if (!i2cWrite(0x18, &reg, 1)) {
    Serial.println("  MCP9808 (0x18): no answer");
    return;
  }
  uint8_t b[2] = {0};
  if (!i2cRead(0x18, b, 2)) {
    Serial.println("  MCP9808 (0x18): no data");
    return;
  }
  uint16_t raw = ((b[0] & 0x1F) << 8) | b[1];
  float c = (b[0] & 0x10) ? (raw - 8192) / 16.0 : raw / 16.0;
  Serial.printf("  MCP9808 (0x18): %.2f C   <- an MCP9808\n", c);
}

/** HTU21D / Si7021 / SHT21 at 0x40: hold-master measurement. */
static void tryHtu() {
  const uint8_t cmd = 0xE3;
  if (!i2cWrite(0x40, &cmd, 1)) {
    Serial.println("  HTU21/Si7021 (0x40): no answer");
    return;
  }
  delay(60);
  uint8_t b[3] = {0};
  if (!i2cRead(0x40, b, 3)) {
    Serial.println("  HTU21/Si7021 (0x40): no data");
    return;
  }
  uint16_t raw = ((b[0] << 8) | b[1]) & 0xFFFC;
  Serial.printf("  HTU21/Si7021 (0x40): %.2f C   <- an HTU21D-class part\n", -46.85 + 175.72 * raw / 65536.0);
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Wire.begin(SDA_PIN, SCL_PIN, 100000);
  Wire.setTimeOut(50);
}

void loop() {
  Serial.printf("\n=== I2C probe on SDA %d / SCL %d ===\n", SDA_PIN, SCL_PIN);
  Serial.println("Who answers, and with what:");
  tryAht();
  trySht(0x44);
  trySht(0x45);
  tryMcp();
  tryHtu();
  Serial.println("A line with a temperature is the sensor you have; the rest are");
  Serial.println("addresses acknowledging on a bus with one weak pull-up.");

  // What is on the pins that are not idle. A pin with nothing on it follows
  // whichever way it is pulled; a pin held near the middle against both pulls
  // has something driving it, and a pin whose voltage moves when you warm the
  // sensor is a thermistor or an analog part.
  Serial.println("Pins that are not idle, under each pull:");
  for (int pin : {32, 33, 34, 35}) {
    pinMode(pin, INPUT);
    delay(5);
    int floatMv = analogReadMilliVolts(pin);
    pinMode(pin, INPUT_PULLUP);
    delay(5);
    int upMv = analogReadMilliVolts(pin);
    pinMode(pin, INPUT_PULLDOWN);
    delay(5);
    int downMv = analogReadMilliVolts(pin);
    pinMode(pin, INPUT);
    Serial.printf("  GPIO %d: floating %4d mV, pulled up %4d mV, pulled down %4d mV%s\n", pin, floatMv, upMv, downMv,
                  (abs(upMv - downMv) < 400 && floatMv > 300) ? "  <- something is driving this pin" : "");
  }
  delay(5000);
}
