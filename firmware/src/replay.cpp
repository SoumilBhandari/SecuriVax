// The node with no sensor fitted: it replays a trip profile instead of
// reading one, so the carrier, the transport, the ingest and the verdict
// engine can all be shown working while the sensor hardware is missing.
//
//   pio run -e replay -t upload
//   cd backend && .venv/bin/python -m scripts.serial_bridge --port /dev/cu.usbserial-0001
//
// Nothing here is measured. The boot banner says so, and the sensor line the
// bridge reads is deliberately not one of the names it recognises, so the
// server is never told a sensor was fitted. Say the same thing on stage: the
// node is replaying a recorded profile, everything downstream of it is real.
//
// The BOOT button (GPIO 0) steps through the profile, so the demo is driven
// by hand at the moment the script calls for it rather than on a timer:
//
//   cooler -> vehicle -> hot vehicle -> freezer pack -> cooler
//
#include <Arduino.h>

#include "config.h"

/** The BOOT button, which every devkit has and nothing else uses after boot. */
static const int BUTTON_PIN = 0;
/** One sample every five seconds, the same cadence as the demo build. */
static const uint32_t SAMPLE_MS = 5000;
/** Out of this range the line is flagged, exactly as a real reading would be. */
static const float ALARM_LOW_C = 2.0f, ALARM_HIGH_C = 8.0f;

struct Phase {
  const char *name;
  const char *says;
  float temp_c;
  float rh;
};

/**
 * Where each step settles. The temperatures are the ones the demo script
 * calls for: a packed cooler, a vehicle with the lid left open, a hot vehicle
 * in the sun, and a freezer pack put in straight from the freezer.
 */
static const Phase PHASES[] = {
    {"cooler", "packed and holding, 2-8 C", 5.0f, 45.0f},
    {"vehicle", "lid left open, warming to ambient", 22.0f, 55.0f},
    {"hot vehicle", "in the sun: the budget should run out", 38.0f, 30.0f},
    {"freezer pack", "ice straight from the freezer: a possible freeze", -1.5f, 65.0f},
};
static const int PHASE_COUNT = sizeof(PHASES) / sizeof(PHASES[0]);

static int phase = 0;
static float temp_c = 5.0f, rh = 45.0f;
static uint32_t seq = 0;
static uint32_t boot_id = 0;
static uint32_t next_sample = 0;

/** A little jitter, so the trace looks like a sensor and not a formula. */
static float jitter(float spread) {
  return ((int)(esp_random() % 2001) - 1000) / 1000.0f * spread;
}

static void announce() {
  const Phase &p = PHASES[phase];
  Serial.printf("\n-- %s: %s (settling towards %.1f C) --\n", p.name, p.says, p.temp_c);
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  delay(600);
  boot_id = esp_random() % 100000;

  Serial.printf("\nSecuriVax %s replaying a profile, boot %u\n", NODE_ID, boot_id);
  Serial.println("temperature and humidity: simulated profile, no sensor fitted");
  Serial.println("Nothing below is measured. Press the BOOT button to step to the next phase.");
  announce();
  next_sample = millis();
}

void loop() {
  // The button steps the profile on. Held down, it steps once and waits.
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(30);
    if (digitalRead(BUTTON_PIN) == LOW) {
      phase = (phase + 1) % PHASE_COUNT;
      announce();
      while (digitalRead(BUTTON_PIN) == LOW) delay(10);
      delay(50);
    }
  }

  if ((int32_t)(millis() - next_sample) < 0) return;
  next_sample += SAMPLE_MS;
  // Holding the button blocks the loop. Without this the samples it held up
  // would all land at once, as a vertical step on an otherwise smooth trace.
  if ((int32_t)(millis() - next_sample) > 0) next_sample = millis() + SAMPLE_MS;

  // Ease towards the phase's temperature rather than jumping to it: a carrier
  // has thermal mass, and a step change would look like a broken sensor.
  const Phase &p = PHASES[phase];
  temp_c += (p.temp_c - temp_c) * 0.22f;
  rh += (p.rh - rh) * 0.18f;

  float shown_t = temp_c + jitter(0.15f);
  float shown_h = rh + jitter(0.8f);
  bool alarm = shown_t < ALARM_LOW_C || shown_t > ALARM_HIGH_C;

  // The line the serial bridge reads, in the same shape the real node prints.
  Serial.printf("#%u %.2f C %.1f%% no fix%s\n", ++seq, shown_t, shown_h, alarm ? " OUT OF RANGE" : "");
}
