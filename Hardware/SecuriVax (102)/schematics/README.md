# SecuriVax 102 schematic
![SecuriVax 102 schematic](https://github.com/SoumilBhandari/hophacks/blob/main/Hardware/image/Custom%20PCB.png)
SecuriVax 102 is the custom-PCB revision. This schematic record belongs only to revision 102 and must be updated from the final PCB schematic before production assembly. The ESP32-C3 and ST25R3916 are not interchangeable with the 101 modules.

## System overview

U1 is the ESP32-C3-WROOM-02-N4 controller. U2 is the DHT22 sensor. U3 and U4 are local buttons. U5 provides USB-C power and programming access. U6 regulates the board supply. U7 is the ST25R3916 NFC/RFID reader IC with its antenna network. LED1 is the status indicator.

## Component and protocol table

| Reference | Component            | Connected function              | Protocol / interface    | Verification                                    |
| --------- | -------------------- | ------------------------------- | ----------------------- | ----------------------------------------------- |
| U1        | ESP32-C3-WROOM-02-N4 | Main controller, Wi-Fi, GPIO    | GPIO, USB serial, Wi-Fi | Confirm boot log                                |
| U2        | DHT22                | Temperature and humidity        | Timed single-wire       | Confirm one data GPIO from PCB netlist          |
| U3        | Button               | User input 1                    | Digital GPIO            | Confirm pull-up and active level                |
| U4        | Button               | User input 2                    | Digital GPIO            | Confirm pull-up and active level                |
| U5        | USB-C 06PF-073       | Power and programming connector | USB 2.0 / VBUS          | Check CC resistors and polarity                 |
| U6        | AMS1117M-5.0RG       | Regulated supply stage          | Linear regulation       | Measure rails before U1 is fitted               |
| U7        | ST25R3916-AQWT       | NFC/RFID reader and antenna     | PCB-routed reader bus   | Confirm bus, reset, interrupt, and antenna nets |
| LED1      | Red 0603 LED         | Board status                    | Digital GPIO through R3 | Confirm polarity and current limit              |
| C1/C2     | 10 uF / 100 nF       | Supply decoupling               | Power integrity         | Inspect placement and polarity where applicable |
| R1/R2/R3  | 10 k / 5.1 k / 1 k   | Bias, USB-C, and LED limiting   | Board-defined           | Confirm against PCB schematic                   |

## Final PCB pin record
![Final PCB pin record](https://github.com/SoumilBhandari/hophacks/blob/main/Hardware/image/Final%20PCB%20pin%20record.png)
Populate this table from the exported PCB schematic. Do not copy the 101 GPIO map: U1 and U7 use different hardware.

| Signal          | ESP32-C3 GPIO | PCB net name | Protocol          | Verified |
| --------------- | ------------: | ------------ | ----------------- | -------- |
| DHT22 data      |        GPIO 2 | DHT22_DATA   | Timed single-wire | [ ]      |
| Button 1        |        GPIO 0 | BUTTON_1     | Digital input     | [ ]      |
| Button 2        |        GPIO 1 | BUTTON_2     | Digital input     | [ ]      |
| Status LED      |        GPIO 3 | STATUS_LED   | Digital output    | [ ]      |
| NFC interrupt   |        GPIO 7 | NFC_IRQ      | Reader interrupt  | [ ]      |
| NFC bus clock   |        GPIO 4 | NFC_SCK      | Reader bus        | [ ]      |
| NFC bus data    |        GPIO 5 | NFC_MOSI     | Reader bus        | [ ]      |
| NFC chip select |        GPIO 6 | NFC_CS       | Reader select     | [ ]      |
| NFC reset       |       GPIO 10 | NFC_RST      | Digital output    | [ ]      |


## Bring-up order

1. Inspect soldering, connector orientation, and antenna clearance.
2. Check VBUS, regulated rails, and GND for shorts with power removed.
3. Apply current-limited USB power and measure the expected rails.
4. Confirm ESP32-C3 boot output.
5. Test U2, U3, U4, and LED1 individually.
6. Test U7 with a known compatible tag and record reader range.
7. Copy verified net names and GPIOs into this file and the firmware configuration.
   
## PCB File

[Download PCB JSON file](PCB_PCB_New-Project_2026-09-19.json)
