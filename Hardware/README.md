# SecuriVax hardware

This folder documents two hardware revisions. Each revision owns its BOM, schematic, CAD explanation, and assembly workflow so it can be reproduced independently.

| Revision      | Purpose                                                                                     | Guide                                            |
| ------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Prototype 101 | Hand-wired ESP32 DevKit, RC522 RFID, two DHT11 sensors, prototype board, and female headers | [Prototype 101](prototype%20101/README.md)       |
| SecuriVax 102 | Custom PCB with ESP32-C3, DHT22, ST25R3916 NFC/RFID, USB-C, regulator, buttons, and LED     | [SecuriVax 102](SecuriVax%20%28102%29/README.md) |

## Documentation layout

Each revision contains:

- `BOM(Bill of material)/README.md`: parts, descriptions, quantities, and component images.
- `schematics/README.md`: that revision's wiring, GPIO or PCB nets, power rails, and communication protocols.
- `cad/README.md`: design decisions, model parts, assembly, STL mapping, and print parameters.

The shared `image/` folder contains the available enclosure drawings and BOM component images. `STL/` contains STL assets only; model explanations belong in the revision CAD README files.

## Build workflow

1. Select one revision and read its revision guide.
2. Purchase the parts listed in its BOM.
3. Follow that revision's own schematic and communication protocol table.
4. Inspect the CAD explanation and print the listed STL files.
5. Assemble, test power first, then test sensors and RFID/NFC.
6. Record verified pin assignments, CAD revisions, and build photos in the revision guide.

## Safety

ESP32 GPIO uses 3.3 V logic. Do not connect a 5 V signal directly to an ESP32 GPIO. Check polarity, continuity, and rail voltage before applying power.
