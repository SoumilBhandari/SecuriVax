# Shared schematics index

The authoritative schematic for each build lives inside that build's folder. Use these revision-specific documents first; the older tables below are retained as cross-reference material.

## Revision index

| Revision | Wiring                      | Main protocol                                                       |
| -------- | --------------------------- | ------------------------------------------------------------------- |
| 101      | [101 wiring](101-wiring.md) | SPI for RC522 RFID, single-wire DHT                                 |
| 102      | [102 wiring](102-wiring.md) | PCB-routed NFC/RFID interface, single-wire DHT22, USB/UART bring-up |

The independent build guides are [Prototype 101 schematic](../prototype%20101/schematics/README.md) and [SecuriVax 102 schematic](../SecuriVax%20%28102%29/schematics/README.md).

## Power rails

| Rail   | Nominal voltage | Use                                 | Check                               |
| ------ | --------------: | ----------------------------------- | ----------------------------------- |
| `VBUS` |    5 V from USB | 102 input and regulator source      | USB-C VBUS to GND is not shorted    |
| `+5V`  |   5 V regulated | 102 regulator output where required | Measure before fitting ESP32 module |
| `+3V3` |           3.3 V | ESP32, DHT sensors, RC522/NFC logic | Never exceed 3.6 V on GPIO          |
| `GND`  |             0 V | Common return                       | Continuity to every module ground   |

## Protocol summary

| Device               | Protocol                 | Data lines                                | Notes                                              |
| -------------------- | ------------------------ | ----------------------------------------- | -------------------------------------------------- |
| DHT11/DHT22          | Timed single-wire        | One GPIO per sensor                       | One sensor per data line; do not share data wires  |
| RC522 module         | SPI                      | SCK, MOSI, MISO, SS, RST                  | 3.3 V only; `SS` is the chip-select line           |
| ST25R3916 on 102 PCB | PCB-routed NFC interface | Follow PCB net labels and final schematic | Confirm the exported PCB schematic before assembly |
| ESP32 USB serial     | USB/UART                 | USB D+/D- or USB-UART bridge              | Used for flashing and diagnostics                  |
