# Prototype 101 BOM

Prototype 101 is the hand-wired validation build. Quantities are the minimum for one unit.

| Name                     | Description                                                                     | Image                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ESP32 DevKit WROOM-1     | Wi-Fi/Bluetooth microcontroller development board and USB programming interface | ![ESP32 DevKit](../../image/bom/esp32intro2.jpg)                               |
| RC522 RFID reader module | 13.56 MHz RFID reader used with the SPI bus                                     | ![RC522 RFID reader](../../image/bom/rfid-rc522.jpg)                           |
| DHT11 sensor 1           | First temperature and humidity measurement channel                              | ![DHT11 sensor](../../image/bom/DHT11-Sensor.jpg)                              |
| DHT11 sensor 2           | Independent second channel for sensor fusion and disagreement detection         | ![DHT11 sensor](../../image/bom/DHT11-Sensor.jpg)                              |
| Prototype board          | Solderable carrier for point-to-point assembly                                  | ![Prototype board](../../image/bom/solderable-breadboard-400-main-500x500.jpg) |
| Female header strips     | Removable sockets for ESP32 and sensor modules                                  | ![Female headers](<../../image/bom/female headers.jpg>)                        |
| Jumper wire kit          | 3.3 V, ground, SPI, reset, and sensor signal wiring                             | ![Jumper wire kit](<../../image/bom/Jumper wire kit.jpg>)                      |
| 4.7-10 kOhm resistors    | Optional DHT data pull-ups when the sensor board has no fitted pull-up          | ![SMD resistor](<../../image/bom/smd resistor.webp>)                           |
| USB cable                | Power and firmware upload cable for the ESP32                                   | ![USB cable](<../../image/bom/USB cable.jpg>)                                  |

See [101 wiring](../../schematics/101-wiring.md) for the GPIO map and assembly checks.
