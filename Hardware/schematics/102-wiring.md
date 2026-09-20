# SecuriVax 102 wiring

Revision 102 is a custom PCB. The table below records the component-level connections and the protocol expectations from the supplied BOM. The final PCB net names and GPIO numbers must be copied from the exported PCB schematic before production assembly.

## PCB component connections

| Reference | Part                 | PCB connection / role                              | Protocol                             |
| --------- | -------------------- | -------------------------------------------------- | ------------------------------------ |
| U1        | ESP32-C3-WROOM-02-N4 | Main controller and radio                          | GPIO, USB serial, Wi-Fi              |
| U2        | DHT22                | `VCC`, `GND`, and one routed data GPIO             | Timed single-wire                    |
| U3/U4     | Buttons              | GPIO input with pull-up or fitted resistor network | Digital input                        |
| U5        | USB-C 06PF-073       | USB power and data connector                       | USB 2.0 / 5 V input                  |
| U6        | AMS1117M-5.0RG       | USB/input rail regulation as designed              | Linear regulation                    |
| U7        | ST25R3916-AQWT       | NFC/RFID reader IC and antenna network             | Use the PCB's exported NFC schematic |
| LED1      | Red 0603 LED         | Status output through R3                           | Digital output                       |
| C1        | 10 uF                | Bulk supply decoupling                             | Power integrity                      |
| C2        | 100 nF               | Local high-frequency decoupling                    | Power integrity                      |
| R1        | 10 kOhm              | Pull-up / bias network per PCB schematic           | Board-defined                        |
| R2        | 5.1 kOhm             | USB-C CC resistor or board-defined pull-down       | USB-C configuration                  |
| R3        | 1 kOhm               | LED current limiting                               | GPIO output protection               |

## Required final pin record

Fill this table from the PCB schematic and keep it beside the assembled board. Do not infer these values from the 101 prototype because U1 is a different ESP32 family and U7 is a different reader architecture.

| Signal          | ESP32-C3 GPIO | PCB net name | Connector/test point | Verified |
| --------------- | ------------: | ------------ | -------------------- | -------- |
| DHT22 data      |           TBD | TBD          | TBD                  | [ ]      |
| Button 1        |           TBD | TBD          | TBD                  | [ ]      |
| Button 2        |           TBD | TBD          | TBD                  | [ ]      |
| Status LED      |           TBD | TBD          | TBD                  | [ ]      |
| NFC interrupt   |           TBD | TBD          | TBD                  | [ ]      |
| NFC bus clock   |           TBD | TBD          | TBD                  | [ ]      |
| NFC bus data    |           TBD | TBD          | TBD                  | [ ]      |
| NFC chip select |           TBD | TBD          | TBD                  | [ ]      |
| NFC reset       |           TBD | TBD          | TBD                  | [ ]      |

## 102 bring-up sequence

1. Inspect the PCB for solder bridges and confirm connector orientation.
2. Check `VBUS`, regulated rails, and `GND` for shorts before inserting U1.
3. Power from a current-limited USB supply.
4. Confirm the 3.3 V rail and controller boot output.
5. Test the DHT22, then each button and LED.
6. Test the ST25R3916 reader with a known compatible tag and record the antenna result.
7. Update the TBD rows above from the verified schematic and test points.
