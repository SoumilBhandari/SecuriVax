# The node, for the landing page

`build.mjs` turns the Onshape exports into `web/public/hero/models/device.glb`,
the model the landing page takes apart as the reader scrolls.

## When the design changes

1. In Onshape, export each part as **glTF 2.0**, and put the files in this
   folder under these names:

   | File | What it is |
   | --- | --- |
   | `low.gltf` | the lower half of the case |
   | `top.gltf` | the lid |
   | `board.gltf` | the board, with its components |
   | `battery.gltf` | the cell |

   They are not committed: each is a few megabytes of base64, and Onshape is
   the source of truth.

2. Build and compress:

   ```sh
   npm i @gltf-transform/core @gltf-transform/functions
   node build.mjs
   npx @gltf-transform/cli meshopt device_raw.glb ../../public/hero/models/device.glb --level high
   ```

3. Check the numbers it prints. The assembled case should be about
   30 x 18 x 70 mm and sit on y = 0, and the four root nodes must come out as
   `LowCover`, `Board`, `Battery`, `TopCover` — the page moves them by name.

## What the script does

Every part is exported in its own frame, so each one is recentred on itself,
turned if it needs it (the cell lies flat), and placed at its own height in
the stack. Real-world metres throughout; the page draws the node at eight
times life size so one set of lights and framing serves every chapter.
