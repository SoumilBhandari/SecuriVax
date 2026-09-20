// DHT wiring check on the two pins the sensors are wired to:
//   pio run -e diag -t upload, then read the monitor.
//
// The sweep that came before this one only ever said "no answer", which fits
// four different faults. This watches the two known pins closely enough to
// tell them apart: what the line rests at, whether the sensor pulls it at
// all, and what the pulses look like if it does.
#include <Arduino.h>
#include <SPI.h>
#include <DHT.h>

static const int PINS[] = {26, 27};

// Room for the response plus all forty bits, twice over.
static const int MAXT = 200;
static uint32_t when[MAXT];
static uint8_t level[MAXT];

/**
 * Where the line sits when nobody is talking. A data leg wired to a powered
 * sensor reads high on the internal pull-up and follows the pull-down; a leg
 * that reads low even when pulled up is shorted to ground, which is what a
 * DHT11 wired one leg out looks like.
 */
static void rest(int pin) {
  pinMode(pin, INPUT_PULLUP);
  delay(5);
  int up = digitalRead(pin);
  pinMode(pin, INPUT_PULLDOWN);
  delay(5);
  int down = digitalRead(pin);
  pinMode(pin, INPUT);
  delay(5);
  int mv = analogReadMilliVolts(pin);

  const char *verdict;
  if (!up && !down) verdict = "shorted to ground - the data leg is on the wrong pin of the sensor";
  else if (up && down) verdict = "held high by a pull-up of its own - a module, and powered";
  else verdict = "floating - either a bare sensor (normal) or nothing connected";
  Serial.printf("  GPIO %d rests: pulled up %s, pulled down %s, %d mV  <- %s\n", pin, up ? "HIGH" : "LOW",
                down ? "HIGH" : "LOW", mv, verdict);
}

/**
 * The start signal by hand, and every transition for the next 10 ms.
 *
 * Interrupts are off for the capture because a DHT11's bits are 26 to 70 us
 * apart and the WiFi and timer interrupts are longer than that. Ten ms is
 * shorter than the interrupt watchdog, so it cannot panic the core.
 */
static int handshake(int pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delay(20);  // a DHT11 wants the line held for at least 18 ms
  int n = 0;
  noInterrupts();
  pinMode(pin, INPUT_PULLUP);
  uint32_t t0 = micros();
  int last = digitalRead(pin);
  when[n] = 0;
  level[n] = last;
  n++;
  while ((micros() - t0) < 10000 && n < MAXT) {
    int now = digitalRead(pin);
    if (now != last) {
      when[n] = micros() - t0;
      level[n] = now;
      n++;
      last = now;
    }
  }
  interrupts();
  return n;
}

/**
 * The forty bits, if they are there. A DHT answers the start signal by
 * pulling low for 80 us and letting go for 80 us, then sends each bit as a
 * 50 us low followed by a high: short for a nought, long for a one. So the
 * high pulses after the response carry the data, and their length is the bit.
 */
static bool decode(int n, uint8_t *out) {
  int bits = 0;
  bool seenResponse = false;
  for (int i = 0; i + 1 < n; i++) {
    uint32_t held = when[i + 1] - when[i];
    if (!level[i]) continue;  // only the high pulses carry a bit
    if (!seenResponse) {
      // The response high is the long one before the data starts.
      if (held > 60 && held < 120) seenResponse = true;
      continue;
    }
    if (bits >= 40) break;
    out[bits / 8] = (out[bits / 8] << 1) | (held > 45 ? 1 : 0);
    bits++;
  }
  return bits == 40;
}

static void look(int pin) {
  Serial.printf("\nGPIO %d\n", pin);
  rest(pin);

  int n = handshake(pin);
  Serial.printf("  transitions after the start signal: %d  (a live DHT11 gives about 84)\n", n);
  if (n <= 2) {
    Serial.println("  the sensor never pulled the line: it has no power, or this leg is not its data leg");
    return;
  }

  Serial.print("  first pulses (us, level):");
  for (int i = 1; i < n && i < 10; i++) Serial.printf(" %u%s", when[i] - when[i - 1], level[i - 1] ? "H" : "L");
  Serial.println();

  uint8_t b[5] = {0, 0, 0, 0, 0};
  if (!decode(n, b)) {
    Serial.println("  it answered, but not with forty clean bits - the pulses above say why");
    return;
  }
  uint8_t sum = b[0] + b[1] + b[2] + b[3];
  Serial.printf("  bytes: %02X %02X %02X %02X  checksum %02X (want %02X)\n", b[0], b[1], b[2], b[3], b[4], sum);
  if (sum == b[4])
    Serial.printf("  *** DHT11 answering on GPIO %d: %d.%d C, %d%% RH ***\n", pin, b[2], b[3], b[0]);
  else
    Serial.println("  checksum is wrong - the wiring is right but the line is noisy; shorten the wires");
}

/** The library's own read, as a second opinion on a pin that looks alive. */
static void viaLibrary(int pin) {
  DHT dht(pin, DHT11);
  dht.begin();
  delay(2200);
  float t = dht.readTemperature(false, true), h = dht.readHumidity();
  if (!isnan(t) && !isnan(h))
    Serial.printf("  library agrees: %.1f C, %.0f%% RH\n", t, h);
  else
    Serial.println("  library read failed too");
}

void setup() {
  Serial.begin(115200);
  delay(1500);
}

void loop() {
  Serial.println("\n=== DHT check on GPIO 26 and 27 ===");
  for (int pin : PINS) {
    look(pin);
    viaLibrary(pin);
    delay(200);
  }
  Serial.println("\n(reading again in 4 s)");
  delay(4000);
}
