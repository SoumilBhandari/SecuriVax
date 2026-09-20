# Prototype 101 schematic

Prototype 101 is the removable bench prototype. This schematic documents the actual modules, their wiring, and the communication protocols needed to duplicate the build.

## System overview

The ESP32 DevKit WROOM-1 is the controller. Two DHT11 sensors provide independent temperature and humidity samples for sensor fusion. The RC522 provides 13.56 MHz RFID over SPI. The prototype board distributes 3.3 V and GND and the female headers keep the modules replaceable.

## Connection table

| Device     | Module pin | ESP32 DevKit pin | Electrical connection                    | Protocol           |
| ---------- | ---------- | ---------------: | ---------------------------------------- | ------------------ |
| RC522      | `SCK`      |          GPIO 18 | 3.3 V logic                              | SPI clock          |
| RC522      | `MOSI`     |          GPIO 23 | 3.3 V logic                              | SPI controller out |
| RC522      | `MISO`     |          GPIO 19 | 3.3 V logic                              | SPI controller in  |
| RC522      | `SDA/SS`   |           GPIO 5 | Chip select; not I2C SDA                 | SPI chip select    |
| RC522      | `RST`      |          GPIO 22 | Reset output                             | Digital GPIO       |
| RC522      | `3.3V`     |              3V3 | Never connect to 5 V                     | Power              |
| RC522      | `GND`      |              GND | Common return                            | Power              |
| DHT11-1    | `S/OUT`    |           GPIO 4 | Add 4.7-10 kOhm pull-up to 3V3 if needed | Timed single-wire  |
| DHT11-2    | `S/OUT`    |          GPIO 13 | Separate data line and pull-up if needed | Timed single-wire  |
| Both DHT11 | `+`        |              3V3 | Shared 3.3 V rail                        | Power              |
| Both DHT11 | `-`        |              GND | Shared return                            | Power              |
| ESP32      | USB        |        USB cable | 115200 baud diagnostics                  | USB serial         |

## Communication behavior

- The RC522 uses the ESP32 hardware SPI bus. `SDA/SS` is the reader chip-select signal.
- Each DHT11 has its own data GPIO. The lines must not be joined.
- DHT11 readings are slow; allow at least one second between reads.
- All modules share ground and use 3.3 V logic.

## Prototype assembly order

1. Solder a 3.3 V rail and a GND rail on the prototype board.
2. Install female headers for the ESP32 and RC522.
3. Wire the RC522 SPI signals and reset line.
4. Wire DHT11-1 to GPIO 4 and DHT11-2 to GPIO 13.
5. Check continuity and confirm there is no 3.3 V to GND short.
6. Test the two DHT readings, then test an RFID tag UID.

## Validation checklist

- [ ] 3.3 V rail measures correctly before modules are inserted
- [ ] DHT11-1 returns temperature and humidity
- [ ] DHT11-2 returns an independent reading
- [ ] RC522 initializes and reads a known tag
- [ ] USB serial monitor is readable at 115200 baud
- [ ] Final tested pin values are copied into firmware configuration
