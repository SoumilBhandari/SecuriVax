# Hardware build: what we have and what it becomes

> **What actually happened.** This page describes the intended build around an
> SHT31 on GPIO 21/22. On the bench we had DHT11s instead, and none of them ever
> answered — across every GPIO the node reports silence rather than garbled data,
> which rules out timing and pin choice and points at the wiring or a dead part.
> The diagnosis is at the bottom under [The sensor that never
> answered](#the-sensor-that-never-answered). The node therefore runs
> `pio run -e replay`, which sends a scripted trip with no sensor fitted.

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
   SecuriVax server ◀── Home Assistant ◀── SmartThings Find (SmartTag)
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

## The sensor that never answered

Two CJSL DHT11s, wired to GPIO 26 and 27. What the board reports, every sweep:

```
No DHT is answering on any pin.
  Pins showing a flicker (noise, not a sensor): 27(3)   [a live DHT11 gives ~84]
Pins held high by something with power: 5              [the devkit's own pull-up]
GPIO 26 rests: pulled up HIGH, pulled down LOW, 1808 mV -> 1898 mV -> 2031 mV
GPIO 27 rests: pulled up HIGH, pulled down LOW,  823 mV ->  870 mV ->  915 mV
```

What that rules out, in order:

1. **Not timing, not the library, not the pin choice.** A sensor that answered
   at the wrong speed would give garbled bits. This gives none: 3 noise edges
   where a live DHT11 gives about 84.
2. **Not power at the board.** It runs for hours without a brownout once the
   USB cable is seated.
3. **The data pins are electrically empty.** This is the telling one. The rest
   voltage on both pins *drifts* between sweeps — 1.81 V to 2.03 V on GPIO 26.
   A pin connected to anything, even a completely dead part, is clamped to a
   steady value by that part's input protection. Only a pin connected to
   nothing drifts like that, charging from leakage.

So the data legs are not reaching the GPIOs: a breadboard row out, a leg folded
under the body instead of into the hole, a broken jumper, or — on a clone board
— a silkscreen that does not match the pin it names. Reproduce with
`pio run -e diag -t upload`, which prints all of the above for GPIO 26 and 27.
