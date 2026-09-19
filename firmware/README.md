# Vialtality node firmware (skeleton)

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
