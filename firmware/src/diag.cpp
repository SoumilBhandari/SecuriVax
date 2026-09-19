// DHT wiring check on one pin: pio run -e diag -t upload, then read the monitor.
// Tells apart "not powered", "not connected" and "sensor answering".
#include <Arduino.h>
#include <SPI.h>
#include <DHT.h>

#ifndef DIAG_PIN
#define DIAG_PIN 4
#endif

void setup() {
  Serial.begin(115200);
  delay(1500);
}

void loop() {
  const int pin = DIAG_PIN;
  Serial.printf("\n=== DHT check on GPIO %d ===\n", pin);
  pinMode(pin, INPUT_PULLDOWN);
  delay(5);
  int withPulldown = digitalRead(pin);
  pinMode(pin, INPUT);
  delay(5);
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(pin);
  mv /= 16;
  Serial.printf("line level with the chip's pull-down: %s\n", withPulldown ? "HIGH (something holds it up: good)" : "LOW (nothing holds it up)");
  Serial.printf("line voltage, nothing pulling: %u mV (a powered DHT module holds ~3300)\n", mv);

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
  Serial.printf("handshake: %d edges (a live DHT answers with ~80)\n", edges);

  DHT dht(pin, DHT11);
  dht.begin();
  delay(2000);
  float c = dht.readTemperature(false, true), h = dht.readHumidity();
  if (!isnan(c)) Serial.printf("DHT11 reads %.1f C, %.0f%% RH  <- working\n", c, h);
  else Serial.println("DHT11 library read: no answer");

  if (!withPulldown && mv < 500)
    Serial.println("=> nothing is holding GPIO 4 up: the module's + isn't getting 3.3 V, or S isn't on this pin.");
  else if (edges == 0)
    Serial.println("=> the line is held up but the sensor doesn't answer: check GND, try + on 5 V (VIN), or the sensor may be dead.");
  delay(4000);
}
