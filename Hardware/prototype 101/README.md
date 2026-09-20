# Prototype 101

Prototype 101 is the first SecuriVax hardware build: a removable, hand-wired bench prototype using an ESP32 DevKit WROOM-1, an RC522 RFID reader, two DHT11 sensors, a solderable prototype board, and female headers.

## Purpose and design iteration

This revision was built to validate the sensing concept and RFID identification before committing to a custom PCB. The two DHT11 sensors provide independent observations for sensor fusion and disagreement detection. Female headers make the modules replaceable while the pin map is being tested.

It is a bench prototype rather than a sealed product enclosure. It is superseded by revision 102 for a repeatable manufactured unit.

## Build contents

- [Bill of materials](<BOM(Bill%20of%20material)/README.md>)
- [Prototype 101 schematic](schematics/README.md)
- [CAD and 3D-printing guide](cad/README.md)
- [Available images](../image/README.md)

## Assembly sequence

1. Install the ESP32 and RC522 into female headers on the prototype board.
2. Create common 3.3 V and GND rails.
3. Wire the RC522 SPI bus and reset line.
4. Wire DHT11-1 to GPIO 4 and DHT11-2 to GPIO 13.
5. Check continuity and power rails before inserting the modules.
6. Test both sensors, then read a known RFID tag.

## Reproduction checklist

- [ ] All BOM parts purchased
- [ ] Schematic wiring reproduced exactly
- [ ] Both DHT11 readings are independent
- [ ] RC522 reports a known tag UID
- [ ] CAD parts printed or prototype enclosure decision recorded
- [ ] Tested firmware pin configuration recorded
