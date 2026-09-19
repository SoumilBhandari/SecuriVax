# Hardware build: what we have and what it becomes

## Parts on hand

| Part | Becomes |
| --- | --- |
| ESP32 #1 | Primary node `DEMO-01` inside the carrier |
| ESP32 #2 | Backup node `DEMO-01B` in the same carrier (redundancy) |
| SHT31 | Temperature + humidity sensor for the primary |
| NFC chip | Sticker on the medicine bottle: `https://<domain>/box/BOX-9001?tap=1` |
| Labelled medicine bottle | Stands in for the vaccine box (`BOX-9001`, OPV) |
| Ice cube | The cold chain working (inside drops toward 0–4 °C) |
| Samsung SmartTag | Location of the carrier (no GPS module needed) |

Carrier: any small cooler or lunchbox holding the bottle, the ice and both
nodes. Power: a USB power bank, or LiPo cells if you have them.

## Build

```
 ┌──────────── cooler / lunchbox ─────────────┐
 │  [ESP32 #1]──I2C──[SHT31]    [ice cube]    │
 │  [ESP32 #2]                  [bottle+NFC]  │
 │  [SmartTag]                  [power bank]  │
 └────────────────────────────────────────────┘
        │ WiFi (phone hotspot, 2.4 GHz)
        ▼
   Vialtality server ◀── Home Assistant ◀── SmartThings Find (SmartTag)
```

1. **SHT31 → ESP32 #1**: SDA→GPIO21, SCL→GPIO22, VIN→3V3, GND→GND.
2. **Firmware**: `cp include/config.example.h include/config.h`, then set WiFi,
   `API_BASE`, `NODE_KEY` and `HAS_GPS 0`.
   - ESP32 #1: `NODE_ID "DEMO-01"`, then `pio run -e demo -t upload`.
   - ESP32 #2: `NODE_ID "DEMO-01B"`, same build. The server already knows it's
     DEMO-01's backup.
3. **NFC**: write the bottle's URL with NFC Tools (the `/tags` page lists it).
   You only have one sticker, so load the bottle with the carrier page's
   **"Load a box here"** button, then tap the bottle. With a second sticker on
   the cooler (`/node/DEMO-01?tap=1`), it becomes the full two-tap flow.
4. **SmartTag**: clip it inside the cooler lid and bridge it with
   [smarttag.md](smarttag.md).

## Redundancy, honestly

ESP32 #2 keeps the carrier's record going if #1 dies (battery, crash, bumped
wire). The server fills #1's silences with #2's readings, and the box page says
"readings came from its backup". Where both report at once, it compares them:
more than 2 °C apart means one sensor is wrong ("check both sensors").

With a single SHT31, only one board can measure. For true sensor redundancy,
add a second SHT31 (or a DS18B20 probe) to ESP32 #2, a few dollars. Until then,
ESP32 #2 is a hot spare: flash it and swap the sensor over in seconds.

## Demo moves with these parts

| Do this | What the node sees | What the app shows |
| --- | --- | --- |
| Ice cube in the cooler | 2–6 °C | USE; carrier "protected" against the room air |
| Hold the node in your hand / hair dryer | 30–40 °C | OPV budget climbs, then QUARANTINE, then DISCARD (demo time: 1 min = 2 days) |
| Unplug ESP32 #1 | #1 silent | No gap: backup DEMO-01B fills in, "BACKUP_USED" |
| Salted ice (not plain) | below −0.5 °C | Pentavalent box: QUARANTINE, "run the shake test" |

Plain ice sits at 0 °C and won't trip the freeze alarm (−0.5 °C for 60 min).
Salted ice or a freezer pack reaches −5 to −10 °C. The simulator (`f` key) is
the fallback.

## Worth buying (cheap)

- A second SHT31, for real sensor redundancy.
- 5–10 NTAG213 stickers: one per box, plus one per carrier.
- Salt. Seriously.
- Optional: a NEO-6M GPS for continuous routes (`HAS_GPS 1`). The SmartTag
  only updates when a Galaxy phone passes by.
