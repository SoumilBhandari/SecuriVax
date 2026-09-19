// Copy to include/config.h (gitignored) and fill in.
#pragma once

// --- Identity: must match a node registered on the server -------------------
#define NODE_ID   "DEMO-01"                // second ESP32 in the same carrier: "DEMO-01B"
#define NODE_KEY  "dev-node-key"          // X-Node-Key; NODE_KEY env on the server
#define API_BASE  "https://coldtrace.onrender.com"

// --- WiFi (ESP32 is 2.4 GHz only; on iPhone hotspots enable Maximize Compatibility)
#define WIFI_SSID "your-hotspot"
#define WIFI_PASS "your-password"
#define WIFI_TIMEOUT_MS 10000

// --- Hardware present -----------------------------------------------------------
// No GPS module? Set 0: position then comes from a Samsung SmartTag in the
// same carrier (see docs/smarttag.md) and the clock from the server.
#define HAS_GPS 0

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
  #define SAMPLE_INTERVAL_S 60            // deep sleep in between
  #define UPLOAD_EVERY 10                 // WiFi is the big power cost: batch it
  #define GPS_EVERY 5                     // a warm GPS fix takes a few seconds
  #define GPS_FIX_TIMEOUT_MS 30000
#endif
#define BATCH_SIZE 100                    // readings per HTTP request
#define MAX_BATCHES_PER_WAKE 10
#define MAX_QUEUED 20000                  // ~2 weeks offline at 1/min
