# Models

`device.glb` is the node itself: the team's own CAD, exported from Onshape as
four parts (the board with its ESP32-C3, the cell, and the two halves of the
case) and assembled into one file by `web/hero-src/device/build.mjs`. Its four
root nodes — `TopCover`, `Battery`, `Board`, `LowCover` — are what the landing
page moves when the case comes apart, so the model must keep those names.

Nothing in it is drawn by hand: it is the part that goes in the vaccine box,
as designed. Onshape writes flat fills rather than materials, so the surfaces
are restyled in `web/src/landing/three/device.tsx`.

The vaccine carton on the landing page is still built from geometry in
`web/src/landing/three/device.tsx`, since no one models a cardboard box in
CAD. Free models were evaluated early on (Poly Pizza's CC0 "Cooler Box" by
MilkAndBanana and "Cardboard Boxes" by Quaternius) and none are shipped.
