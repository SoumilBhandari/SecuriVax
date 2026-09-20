# Prototype 101 CAD and 3D printing

This section documents the mechanical design and manufacturing decisions for Prototype 101. It follows the model-guide style used by the reference project: design intent first, then model parts, assembly, and printing.

## 1. Design considerations

Prototype 101 is a bench enclosure concept for a removable ESP32, RC522 reader, and two DHT11 sensors. The mechanical priorities are easy access, replaceable modules, short sensor wiring, and enough clearance around the RC522 antenna.

Because 101 is a hand-wired prototype, dimensions must be checked against the actual prototype board and module positions before a final enclosure is printed. Do not use the 102 PCB dimensions for this revision.

## 2. Model parts

The 101 CAD export is not currently present in `Hardware/STL/`. No STL file is fabricated or renamed to represent this revision. When the 101 model is exported, place STL files directly in `Hardware/STL/` and add them to this table. Keep explanations here, not beside the STL files.

| Part                | Purpose                                                            | STL status       |
| ------------------- | ------------------------------------------------------------------ | ---------------- |
| Base                | Holds the prototype board and provides the enclosure floor         | Not exported yet |
| Top cover           | Protects the ESP32 and sensor wiring while keeping access possible | Not exported yet |
| Button/access cover | Provides access to the prototype controls or openings              | Not exported yet |

## 3. Assembly method

1. Fit the prototype board into the base with the USB connector accessible.
2. Route the two DHT11 sensors away from the RC522 antenna.
3. Keep the RC522 antenna face clear of metal fasteners and dense copper.
4. Fit the top cover only after sensor and RFID tests pass.
5. Leave a service path for USB programming and module replacement.

## 4. 3D-printing parameters

| Parameter    |                                          Recommended starting value |
| ------------ | ------------------------------------------------------------------: |
| Process      |                                                                 FDM |
| Material     |                        PETG for a durable part; PLA for fit testing |
| Nozzle       |                                                              0.4 mm |
| Layer height |                                                             0.20 mm |
| Walls        |                                                        3 perimeters |
| Top / bottom |                                                            5 layers |
| Infill       |                                                  20% gyroid or grid |
| Supports     |                           Only where required by the exported model |
| Brim         |                                           Optional for bed adhesion |
| Fit check    | Test USB access, module clearance, and cover fit before final print |

## 5. Print documentation

Record the CAD revision, material, slicer, weights, and fit result in [the print log](PRINT-LOG.md). Add the final STL filenames and a top, bottom, isometric, and separated-part view to the image inventory when the model is available.
