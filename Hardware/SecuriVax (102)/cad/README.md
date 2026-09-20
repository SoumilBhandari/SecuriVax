# SecuriVax 102 CAD and 3D printing

This is the 3D design guide for SecuriVax 102. It documents the enclosure and PCB model using the supplied CAD drawings, then explains the STL files and printing process.

## 1. Design overview

The enclosure protects the custom PCB, DHT11/DHT22 sensing area, USB-C access, reset and boot buttons, NFC/RFID hardware, status LED, and battery. The rounded enclosure is split into a top cover and lower cover/base so the board can be installed and serviced.

The supplied dimension drawing shows an overall size of approximately 70 mm x 30 mm x 17 mm. Confirm the dimensions and all openings against the final PCB revision before printing.

## 2. Exploded assembly

![Labeled exploded assembly](<../../image/Animate Box Drawing.png>)

The numbered drawing identifies the major design elements: top cover, temperature and humidity sensor, reset and boot buttons, NFC tag reader, ESP32 controller, PCB/NFC assembly, battery, and lower cover.

![Exploded isometric assembly](<../../image/Animate Box Issometric Drawing.png>)

The exploded isometric view shows the assembly order and the clearance between the cover, electronics, battery, PCB, and lower enclosure.

## 3. PCB and internal model

![Custom PCB 3D model](<../../image/Custom PCB.png>)

The PCB render shows the ESP32 module, DHT sensor, two buttons, passives, status LED, NFC/RFID area, antenna region, and mounting holes.

![Lower enclosure isometric](<../../image/LOW CAVER Issometric Drawing.png>)

The lower cover/base contains the internal support feature and the perimeter that mates with the top cover.

![Top cover isometric](<../../image/TOP COVER Issometric Drawing.png>)

The top cover provides the outer protection and ventilation openings shown in the supplied design.

## 4. Orthographic and part views

![Enclosure orthographic views](<../../image/Box view Drawing.png>)

![Lower cover drawing](<../../image/LOW CAVER Drawing.png>)

![Top cover drawing](<../../image/TOP COVER Drawing.png>)

![Overall enclosure measurements](<../../image/Measurements Box Drawing.png>)

Use the orthographic drawings for orientation and the dimension drawing for scale. Do not scale screenshots; use the CAD/STL source for manufacturing dimensions.

## 5. STL files

STL files are kept in `Hardware/STL/`. That folder contains STL files only. The current exports are:

| STL file                                               | Model role                                                                              | Status    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------- |
| [`Part Studio 2.stl`](../../STL/Part%20Studio%202.stl) | One enclosure half; confirm whether it is the top or lower cover from the CAD source    | Available |
| [`Part Studio 3.stl`](../../STL/Part%20Studio%203.stl) | Mating enclosure half; confirm whether it is the top or lower cover from the CAD source | Available |

The current release contains two STL exports, not three. Do not create or rename a third `cover-button.stl` unless the CAD source confirms that it is a separate part.

## 6. Assembly instructions

1. Remove support material and deburr the printed parts.
2. Place the populated PCB in the lower cover/base.
3. Check the NFC antenna clearance from screws, wires, and conductive surfaces.
4. Check that the sensor opening and ventilation slots are not blocked.
5. Fit the top cover and verify reset/boot button travel.
6. Connect USB-C and verify cable access without stressing the PCB.
7. Confirm the two enclosure halves mate evenly before final fastening.

## 7. 3D-printing parameters

| Parameter       |                                                       Recommended starting value |
| --------------- | -------------------------------------------------------------------------------: |
| Process         |                                                                              FDM |
| Material        |                             PETG for final parts; PLA for dimensional prototypes |
| Nozzle          |                                                                           0.4 mm |
| Layer height    |                                                                          0.20 mm |
| Walls           |                                    4 perimeters around PCB and fastener features |
| Top / bottom    |                                                                         5 layers |
| Infill          |                                                               25% gyroid or grid |
| Supports        | Use only where required by the STL; avoid scars near antenna and mating surfaces |
| Brim            |                                                  Optional, based on bed adhesion |
| Fit clearance   |                 Start at 0.20-0.30 mm per mating side and tune with a test print |
| Post-processing |                    Deburr openings, test cover fit, and verify antenna clearance |

## 8. Print documentation

Record STL revision, PCB revision, material, slicer, print weight, and fit result in [the print log](PRINT-LOG.md). Keep the supplied drawings with the print record so another builder can identify every enclosure part and reproduce the assembly.
