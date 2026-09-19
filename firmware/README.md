# SecuriVax node firmware (skeleton)

ESP32 + SHT31 temperature/humidity sensor, running on a LiPo cell or power
bank. It rides inside a vaccine carrier, cold box or rapid-test storage box.
A NEO-6M GPS is optional (`HAS_GPS`). Without one, position comes from a
Samsung SmartTag in the carrier. See [../docs/hardware.md](../docs/hardware.md) for
the build guide.

## What it does

Every wake (once a minute on battery):

1. Reads temperature, humidity and battery voltage. Every 5th wake it also powers the GPS for a fix, which sets the clock from satellite time too.
2. Appends a 28-byte record to a queue file in flash (LittleFS).
3. Every 10th wake, it joins WiFi and uploads the queue in batches of 100.
4. Deletes records only after the server acks them (`ack_seq`), then deep-sleeps.

It never loses a reading to a dead zone, a power cut mid-upload or a server
outage. Resending is always safe because the server keys readings on
`(node_id, boot_id, seq)`. `boot_id` is kept in NVS and goes up on every
power-on, so `seq` can restart from 1 without clashing.

Dating readings without an RTC module:

- The ESP32's RTC keeps counting through deep sleep.
- The clock is set from GPS time or from `server_time` in each upload reply.
- Readings taken before the clock is set are dated from the offset learnt at the first sync.
- If the clock has never been set, the node sends `uptime_ms` and the server rebuilds the timestamp.

## Flash in the morning (five minutes)

Both builds compile (checked with `pio run -e demo -e node`, with and without
the probe and LED), so the morning is only config and upload:

1. Use a **data** USB cable: charge-only cables power the board but can't flash it.
   The board is the classic ESP32 DevKit (`esp32dev`, ESP32-WROOM-32). If upload says
   *Failed to connect*, hold the **BOOT** button while it starts. If no serial port
   shows up at all, the board's USB chip (CP2102 or CH340) may need its driver.
2. `cp include/config.example.h include/config.h`, then set `NODE_ID` (`DEMO-01`),
   `NODE_KEY` (the server's `NODE_KEY`; `dev-node-key` on a laptop), `API_BASE` (no
   trailing slash) and the WiFi:
   - Not deployed yet? Use the laptop: `https://<laptop-ip>:5173` while
     `npm run dev:phone` runs (it passes `/api` on to the laptop's API, which
     itself only listens on the laptop). `ipconfig getifaddr en0` gives the IP.
   - Deployed: the app's HTTPS URL.
   - The ESP32 only does 2.4 GHz WiFi with a plain password: campus WiFi such as
     eduroam (WPA2-Enterprise) won't work. Use a phone hotspot for both the ESP32
     and the laptop; on an iPhone turn on *Maximize Compatibility*.
3. `pio run -e demo -t upload && pio device monitor`. You should see
   `uploaded 1: 1 new` every 5 s, and the `DEMO-01` page says **Online**.
4. Only then add the extras: `HAS_DS18B20 1` (probe in a water vial) and
   `VERDICT_LED_PIN 2`.

## No WiFi yet? Send over USB

```bash
cd backend && .venv/bin/python -m scripts.serial_bridge --port /dev/cu.usbserial-0001
```

The bridge restarts the board to catch its boot id, then uploads every reading
the node prints, with the node's own boot id and sequence numbers (so if the
node later sends the same readings over WiFi, they count as duplicates). Watch
them arrive on the app's **Live** tab. Boxes loaded into `DEMO-01` are judged
on these readings, at demo speed.

## Build

```bash
cp include/config.example.h include/config.h   # set NODE_ID, NODE_KEY, API_BASE, WiFi
pio run -e node -t upload && pio device monitor   # battery build
pio run -e demo -t upload                         # stage build: awake, 5 s readings
```

`NODE_ID` must exist on the server (seeded: `CAR-01`, `CAR-02`, `RDT-01`,
`DEMO-01`), and `NODE_KEY` must match the server's `NODE_KEY`.

## Wiring

| Part | ESP32 |
| --- | --- |
| SHT31 SDA / SCL | GPIO 21 / 22, 3V3, GND |
| NEO-6M TX / RX (optional) | GPIO 16 / 17 |
| NEO-6M VCC (optional) | through a P-MOSFET or load switch on GPIO 25 (LOW = on) |
| Battery + | 100k/100k divider into GPIO 35 |
| DS18B20 data (optional) | GPIO 4, 4.7k pull-up to 3V3; red to 3V3, black to GND |
| Status LED (optional) | GPIO 2 is the DevKit's own blue LED; an external LED needs a 220 Ω resistor |

With `HAS_DS18B20 1` the temperature comes from the probe (in a water-filled
vial among the vaccines) and humidity from the SHT31. A real freeze shows as a
drop, then a flat line at 0 °C while the water turns to ice.

The LED shows the worst verdict among the boxes in the carrier, from each
upload's reply: solid USE, slow blink USE FIRST, fast blink QUARANTINE,
double flash DISCARD, off when nothing is loaded.

## Power notes

- **WiFi** is the biggest cost (~100+ mA while connected), so uploads are batched.
- **GPS** draws ~45 mA while searching, so it's switched off between fixes. A
  backup cell on the NEO-6M V_BAT pin keeps its almanac for fast warm fixes.
- **Deep sleep** is ~10 µA on a bare ESP32 module. Dev boards with USB-serial chips
  and power LEDs draw far more, so use a low-quiescent board for real
  battery life.
- A 2000 mAh LiPo should last weeks at these intervals on a bare module.

## Demo tips

- Heat the node with your hand or a hair dryer. On the demo node, 1 real minute
  counts as 2 days of product time.
- Ice water stays at 0 °C, which isn't cold enough to trip the -0.5 °C freeze
  alarm. Use salted ice or a freezer pack straight from the freezer.

## Not done yet

- Root-CA pinning for HTTPS (it uses `setInsecure()` for now).
- On-device verdict LED for clinics with no signal.
- Local alarm buzzer.
