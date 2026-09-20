# Prototype 101 wiring

This is the recommended point-to-point wiring for the prototype board. It matches the firmware's DHT convention and leaves the SPI bus available for the RC522 reader.

## GPIO and connection table

| Function                | Module pin     | ESP32 DevKit WROOM-1 | Protocol / electrical detail                                          |
| ----------------------- | -------------- | -------------------: | --------------------------------------------------------------------- |
| RFID SPI clock          | RC522 `SCK`    |              GPIO 18 | SPI clock, 3.3 V logic                                                |
| RFID SPI controller out | RC522 `MOSI`   |              GPIO 23 | SPI MOSI                                                              |
| RFID SPI controller in  | RC522 `MISO`   |              GPIO 19 | SPI MISO                                                              |
| RFID chip select        | RC522 `SDA/SS` |               GPIO 5 | SPI chip select; label as `SS`, not I2C SDA                           |
| RFID reset              | RC522 `RST`    |              GPIO 22 | Active reset control                                                  |
| RFID power              | RC522 `3.3V`   |                  3V3 | Do not use 5 V                                                        |
| RFID return             | RC522 `GND`    |                  GND | Common ground                                                         |
| Sensor 1 data           | DHT11 `S/OUT`  |               GPIO 4 | Single-wire timed data; 4.7-10 kOhm pull-up to 3V3 if module has none |
| Sensor 2 data           | DHT11 `S/OUT`  |              GPIO 13 | Independent backup measurement; same power rail                       |
| Sensor power            | both DHT11 `+` |                  3V3 | Keep sensor leads short                                               |
| Sensor return           | both DHT11 `-` |                  GND | Common ground                                                         |
| Programming             | ESP32 USB      |            USB cable | 115200 baud for current firmware                                      |

## Prototype board assembly

1. Mount the ESP32 DevKit so the USB connector remains accessible.
2. Mount female headers for the ESP32 and RC522 so modules can be removed without soldering.
3. Route the two DHT data lines separately; label them `DHT1` and `DHT2`.
4. Keep the RC522 antenna area away from copper, screws, and the ESP32 antenna.
5. Add a common ground rail and verify it with a continuity meter.
6. Photograph the completed top, bottom, and wiring sides for the `image/` folder.

## Bring-up checks

| Check                              | Expected result                             |
| ---------------------------------- | ------------------------------------------- |
| 3V3 to GND resistance before power | No hard short                               |
| DHT1 read                          | Temperature and humidity returned           |
| DHT2 read                          | Independent reading returned                |
| RC522 reset                        | Reader initializes without repeated reset   |
| RFID read                          | Known tag UID is reported                   |
| USB serial                         | Firmware monitor is readable at 115200 baud |
