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

/**
 * The pins this watcher drives. Not 2, 15, 16 or 17: pulling those low on
 * this board resets it before the ROM has finished booting, so whatever they
 * are wired to here, they are not ours to drive. Never 6-11 (flash), 1/3
 * (UART0), 12 (holds the flash voltage at reset) or 34-39 (input only).
 */
static const int WATCH[] = {4, 5, 13, 14, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};

/** The DHT start signal, and how many edges come back within 6 ms.
 *
 * Each pin is named before it is driven, and the line is flushed, so if the
 * board resets while a pin is held low the last line printed says which one.
 * Pulling a pin that is wired to a supply rail collapses it: the board power
 * cycles and the log shows POWERON_RESET right after that pin's name.
 */
static int edges(int pin) {
  Serial.printf("    driving GPIO %d low...\n", pin);
  Serial.flush();
  delay(40);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delay(20);
  pinMode(pin, INPUT_PULLUP);
  int n = 0, last = digitalRead(pin);
  uint32_t t = micros();
  while (micros() - t < 6000) {
    int now = digitalRead(pin);
    if (now != last) {
      n++;
      last = now;
    }
  }
  return n;
}

/**
 * Live wiring check: leave this running while you fix the wiring and watch
 * the line change. A DHT that is powered and connected answers with about
 * eighty edges; a pin with nothing on it answers with none.
 */
void loop() {
  String live = "";
  String quiet = "";
  for (int pin : WATCH) {
    int n = edges(pin);
    if (n >= 20) live += String("  GPIO ") + pin + ": " + n + " edges  <- a DHT is answering here\n";
    else if (n > 0) quiet += String(" ") + pin + "(" + n + ")";
    delay(40);
  }
  Serial.println();
  if (live.length()) {
    Serial.print(live);
    Serial.println("Put those pins in config.h as DHT_PIN and DHT2_PIN, then flash -e demo.");
  } else {
    Serial.println("No DHT is answering on any pin.");
    Serial.println("  Check in this order: the sensor's + to 3V3, its - to GND, then data to a GPIO.");
    Serial.println("  A CJSL DHT11 with no pull-up of its own still answers on the ESP32's internal one.");
    if (quiet.length()) Serial.printf("  Pins showing a flicker (noise, not a sensor):%s\n", quiet.c_str());
  }
  delay(1200);
}
