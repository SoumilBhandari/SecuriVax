# Hardware

The SecuriVax node: the thing that rides inside the cold box with the vaccine.

Two generations live here.

| Folder | What it is |
| --- | --- |
| [`prototype 101/`](<prototype 101>) | The first pass — a devkit, a sensor and a power bank in a lunchbox. What the bench demo was built on. |
| [`SecuriVax (102)/`](<SecuriVax (102)>) | The designed node: a sealed enclosure sized around a LiPo cell and the board, with the lid carrying the lockup and the status LED. |

## Where the CAD is

The 102 enclosure was modelled in Onshape and exported as glTF. The exported
model is checked in under [`web/public/hero/models/`](../web/public/hero/models)
rather than here, because the landing page renders it live — the exploded device
on the front page is the real CAD, not an illustration. It has four parts:

```
TopCover     lid, carries the lockup and the status LED
Battery      the LiPo cell
Board        the ESP32 and the sensor headers
LowCover     the base the board sits in
```

See [`web/hero-src/device/README.md`](../web/hero-src/device/README.md) for how
the export is processed.

## Bill of materials

Per node. Quantities are for one carrier; the design uses two nodes per carrier
so the backup covers a gap in the primary.

| Part | Role | Notes |
| --- | --- | --- |
| ESP32-WROOM devkit | The node | 2.4 GHz WiFi only. Any devkit works; the firmware finds its own sensor pins. |
| SHT31 | Temperature + humidity | ±0.2 °C. The design sensor: accurate enough to call a freeze. |
| DS18B20 probe | Product temperature | Optional. Goes in a water-filled vial among the vials, so a real freeze shows as a flat line at 0 °C while the water turns to ice. Needs a 4.7k pull-up. |
| DHT11 / DHT22 | Fallback sensor | What was on the bench. A DHT11 is ±2 °C and reads whole degrees from 0 °C up, so it cannot see freezing — fine for heat, useless for the freeze case. |
| 3.7 V LiPo cell | Power | ~2000 mAh runs the battery build for months at a reading every 5 minutes. |
| TP4056 module | Charge + protection | USB charging and low-voltage cutoff. |
| 100k / 100k resistors | Battery divider | Into GPIO 35 so the node reports its own voltage. |
| NFC sticker (NTAG213) | The tag on the box | Written with NFC Tools; the `/tags` page prints the URL for each box and carrier. |
| Samsung SmartTag | Location | Instead of a GPS module. Bridged via Home Assistant — see [docs/smarttag.md](../docs/smarttag.md). |
| NEO-6M GPS | Location, alternative | Optional, `HAS_GPS 0` by default. Costs more power than the SmartTag. |

Pin map, firmware builds and the wiring diagram:
[docs/architecture.md](../docs/architecture.md#hardware).

## Honest status

The enclosure is designed and the firmware is complete, but **the bench sensor
never answered**. Across every GPIO the node reports total silence rather than
garbled data, which rules out timing and pin choice and points at the wiring or
a dead part. The diagnosis is written up in
[docs/hardware.md](../docs/hardware.md).

Because of that, the node ships a `replay` build that sends a scripted trip over
serial with no sensor fitted, so the rest of the chain — ingest, budget, verdict,
live — can be shown end to end. Nothing it sends is presented as measured: the
boot banner says so, and the sensor name it prints is deliberately one the server
does not recognise, so no reading is ever attributed to a sensor that wasn't there.
