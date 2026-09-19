// Copy to include/config.h (gitignored) and fill in.
#pragma once

// --- Identity: must match a node registered on the server -------------------
#define NODE_ID   "DEMO-01"                // second ESP32 in the same carrier: "DEMO-01B"
#define NODE_KEY  "dev-node-key"          // X-Node-Key; NODE_KEY env on the server
#define API_BASE  "https://your-app.ondigitalocean.app"   // or your own domain; no trailing slash
// Testing against the laptop before deploying: "https://<laptop-ip>:5173", the
// phone-test server (npm run dev:phone), which passes /api on to the laptop's
// API. The laptop and the ESP32 must share a 2.4 GHz network (a phone hotspot).

// --- WiFi (ESP32 is 2.4 GHz only; on iPhone hotspots enable Maximize Compatibility)
#define WIFI_SSID "your-hotspot"
#define WIFI_PASS "your-password"
#define WIFI_TIMEOUT_MS 10000

// --- Hardware present -----------------------------------------------------------
// No GPS module? Set 0: position then comes from a Samsung SmartTag in the
// same carrier (see docs/smarttag.md) and the clock from the server.
#define HAS_GPS 0

// DS18B20 probe for the product temperature: put it in a water-filled vial
// among the vaccines. When that water really freezes the reading drops, then
// sits at 0 °C while it turns to ice: proof of a freeze, which neither a VVM
// nor a freeze indicator can give. The SHT31 still gives the air humidity.
#define HAS_DS18B20 1                     // used when one answers on the pin, else the SHT31
#define DS18B20_PIN 13                    // data line, with a 4.7k pull-up to 3.3V

// DHT11 or DHT22 module (S/OUT/DATA pin to this GPIO, + to 3V3, - to GND).
// A DHT11 reads 0-50 °C in whole degrees: fine for heat, blind to freezing.
// A DHT22 reads -40-80 °C. -1 = none.
#define DHT_PIN 4
#define DHT2_PIN -1                       // the second DHT (a backup in the same box); -1: find it on the free pins
#define DHT_TYPE DHT11                    // or DHT22 (both sensors the same type)

// Status LED showing the worst verdict among the boxes in this carrier
// (demo build only; the battery build sleeps). -1 = no LED.
//   solid: USE · slow blink: USE FIRST · fast blink: QUARANTINE · double flash: DISCARD
#define VERDICT_LED_PIN -1                // e.g. 2 for the DevKit's blue LED

// --- Pins -------------------------------------------------------------------
#define I2C_SDA 21                        // SHT31
#define I2C_SCL 22
#define GPS_RX_PIN 16                     // ESP32 RX  <- GPS TX
#define GPS_TX_PIN 17                     // ESP32 TX  -> GPS RX
#define GPS_POWER_PIN 25                  // drives a P-MOSFET / load switch on GPS VCC; -1 if always on
#define BATTERY_PIN 35                    // ADC1 pin behind a 100k/100k divider
#define BATTERY_DIVIDER 2.0f

// --- Timing -------------------------------------------------------------------
#if DEMO_MODE
  #define SAMPLE_INTERVAL_S 5             // awake the whole time, uploads every sample
  #define UPLOAD_EVERY 1
  #define GPS_EVERY 1
  #define GPS_FIX_TIMEOUT_MS 1500         // GPS stays powered; just catch the next sentence
#else
  // Ultra low power: a reading every 5 min into flash, deep sleep in between,
  // and a check-in every 15 min (upload the queue, hear whether anyone asked
  // to watch live). A reading outside 2-8 C is sent at once. About 7 mAh a
  // day, mostly the WiFi check-ins: months on a 2000 mAh cell.
  #define SAMPLE_INTERVAL_S 300
  #define UPLOAD_EVERY 3                  // check in every 3 samples: 15 min
  #define GPS_EVERY 3                     // a warm GPS fix takes a few seconds
  #define GPS_FIX_TIMEOUT_MS 30000
#endif
#define BATCH_SIZE 100                    // readings per HTTP request
#define MAX_BATCHES_PER_WAKE 10
#define MAX_QUEUED 20000                  // ~2 weeks offline at 1/min
