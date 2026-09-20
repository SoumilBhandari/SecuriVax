# SecuriVax 102
![ SecuriVax 102](https://github.com/SoumilBhandari/hophacks/blob/main/Hardware/image/Animate%20Box%20Drawing.png)
SecuriVax 102 is the production-oriented custom-PCB revision. It replaces the 101 point-to-point wiring with an ESP32-C3-WROOM-02-N4, DHT22, ST25R3916 NFC/RFID reader, USB-C connector, regulator, two buttons, status LED, and supporting passives.

## Design iteration

The 102 revision consolidates the validated concept into a repeatable PCB and enclosure. The ST25R3916 reader is a different architecture from the 101 RC522 module, so its bus, interrupt, reset, and antenna network must be verified from the 102 PCB schematic rather than copied from 101.

The enclosure is designed around the custom board and its antenna clearance. Use the supplied enclosure drawings in [the image inventory](../image/README.md) while checking the final PCB revision.

## Build contents

- [Bill of materials](<BOM(Bill%20of%20material)/README.md>)
- [SecuriVax 102 schematic](schematics/README.md)
- [CAD and 3D-printing guide](cad/README.md)
- [Available enclosure and component images](../image/README.md)

## Assembly sequence

1. Inspect the PCB for solder bridges, polarity, and connector orientation.
2. Verify VBUS, regulated rails, and GND with power removed.
3. Apply current-limited USB power and confirm the ESP32-C3 boot output.
4. Test the DHT22, both buttons, and status LED.
5. Test the ST25R3916 reader and antenna with a known compatible tag.
6. Install the verified board in the printed enclosure.

## Reproduction checklist

- [ ] Final PCB schematic stored with the hardware release
- [ ] All TBD GPIO and PCB-net rows completed in the 102 schematic
- [ ] BOM parts and PCB revision verified
- [ ] USB-C polarity and regulated rails tested
- [ ] NFC antenna clearance and reader range tested
- [ ] STL and enclosure fit checked against the same PCB revision
