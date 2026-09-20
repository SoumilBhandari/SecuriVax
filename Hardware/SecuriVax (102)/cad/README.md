# SecuriVax 102 CAD and 3D printing

This section documents the custom enclosure for SecuriVax 102. It is organized as a build guide: design requirements, model parts, assembly, available views, and printing parameters.

## 1. Design considerations

The enclosure protects the custom PCB, DHT22, USB-C connector, buttons, status LED, and NFC/RFID antenna. The design must preserve USB access, button travel, sensor exposure, and antenna clearance while allowing the case to be opened for service.

The supplied measurement drawing indicates an overall enclosure size of approximately 70 mm x 30 mm x 17 mm. Confirm the units and all openings against the final PCB revision before printing.

## 2. Model parts and STL files

STL assets are kept directly in `Hardware/STL/`. That folder contains STL files only; this README is the explanation and assembly guide.

| File                                                   | Model role                                                                               | Status                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------- |
| [`Part Studio 2.stl`](../../STL/Part%20Studio%202.stl) | Exported enclosure part; identify as base or cover from the CAD source before assembly   | Available                    |
| [`Part Studio 3.stl`](../../STL/Part%20Studio%203.stl) | Exported enclosure part; identify as the mating part from the CAD source before assembly | Available                    |
| `base.stl`                                             | Named base export for the release package                                                | Not exported under this name |
| `cover-top.stl`                                        | Named top-cover export for the release package                                           | Not exported under this name |
| `cover-button.stl`                                     | Named button/access-cover export for the release package                                 | Not exported under this name |

The current folder contains two STL exports, not three. Do not invent a third file or rename the existing exports until their source parts are confirmed. The final CAD release should identify whether a separate button cover is part of the design.

## 3. Enclosure assembly

1. Remove support material and deburr the USB-C, sensor, button, and fastening openings.
2. Place the populated PCB into the lower enclosure part.
3. Confirm the NFC antenna has clearance from screws, wires, and conductive surfaces.
4. Confirm the DHT22 sensing opening is not blocked by the cover.
5. Fit the mating cover and test both buttons through their openings.
6. Connect USB-C and verify that the cable can be inserted without stressing the PCB.

## 4. Available CAD views

The enclosure drawings are stored in [`Hardware/image`](../../image/README.md):

| View                                 | Use                                |
| ------------------------------------ | ---------------------------------- |
| `Animate Box Issometric Drawing.png` | Exploded isometric assembly        |
| `Animate Box Drawing.png`            | Numbered exploded component view   |
| `Box view Drawing.png`               | Orthographic enclosure views       |
| `LOW CAVER Drawing.png`              | Lower-cover dimensions and section |
| `LOW CAVER Issometric Drawing.png`   | Lower-cover isometric view         |
| `TOP COVER Drawing.png`              | Top-cover orthographic views       |
| `TOP COVER Issometric Drawing.png`   | Top-cover isometric view           |
| `Measurements Box Drawing.png`       | Overall size reference             |

## 5. 3D-printing parameters

| Parameter       |                                        Recommended starting value |
| --------------- | ----------------------------------------------------------------: |
| Process         |                                                               FDM |
| Material        |              PETG for final parts; PLA for dimensional prototypes |
| Nozzle          |                                                            0.4 mm |
| Layer height    |                                                           0.20 mm |
| Walls           |                     4 perimeters around PCB and fastener features |
| Top / bottom    |                                                          5 layers |
| Infill          |                                                25% gyroid or grid |
| Supports        | Use only where required; avoid support scars near the NFC antenna |
| Brim            |                                   Optional, based on bed adhesion |
| Fit clearance   |  Start at 0.20-0.30 mm per mating side and tune with a test print |
| Post-processing |     Deburr openings, test cover fit, and verify antenna clearance |

## 6. Print documentation

Record the STL revision, PCB revision, material, slicer, weights, and fit result in [the print log](PRINT-LOG.md). A release is complete only when the STL identity, PCB revision, enclosure views, and final fit are recorded together.
