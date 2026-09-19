# SecuriVax landing page: 3D hero brief

> **Superseded in part, 19 September 2026.** The node exists in CAD now, so
> the page renders the team's own Onshape parts (`web/hero-src/device/`) and
> nothing here invents the hardware: no designed puck, and no carrier at all —
> the product is what goes in the vaccine box, not the box. What still stands
> is the method: pre-rendered frame sequences, the studio look, the output
> spec and the checks. Model the CAD, not the objects described below.


Run this with Codex CLI from the repo root:

```
codex --model gpt-6-astra --reasoning high "$(cat docs/hero-3d-brief.md)"
```

Everything below the line is the prompt.

---

## Your role

You are Codex CLI running in the SecuriVax repository on a Mac with Apple
silicon. Your job is to build, render, and verify the 3D assets for the
landing page, working entirely through scripts you write into the repo so
every frame can be regenerated from source. You do not have a 3D artist. You
are the 3D artist, using Blender through its Python API.

Do not touch anything outside `web/hero-src/`, `web/public/hero/`, and this
file. Do not edit the web app.

## What this is for

SecuriVax is a cold-chain monitor for vaccines: a sensor node inside a
vaccine carrier, an NFC sticker on every box, and a phone web app that says
USE, QUARANTINE, or DISCARD for the product in the box. The landing page is
built in the style of an Apple product page: one object pinned in the
viewport, manipulated by the visitor's scroll, with short chapters of text
between. The assets must look like they were shot in Apple's product studio:
a designed object, matte materials, soft studio light, a clean ground,
nothing in frame that isn't the product.

The physical prototype is an ESP32 board with a temperature and humidity
sensor in a lunchbox. Do not model the prototype. Model the product it is
meant to become, as an industrial designer would draw it.

## Toolchain

- Blender 4.x. If it isn't installed, run `brew install --cask blender`.
  Invoke it headless as
  `/Applications/Blender.app/Contents/MacOS/Blender -b -P <script> -- <args>`.
- ffmpeg for the review turntable: `brew install ffmpeg` if missing.
- Python 3 for the verification script, using only the standard library plus
  Pillow.
- Cycles with the Metal GPU device, OpenImageDenoise on. Finals at 256
  samples. Previews at 32 samples and 25% resolution.

## Source layout you will create

```
web/hero-src/
  README.md         how to render everything from scratch
  scene.py          builds every object from primitives and modifiers
  materials.py      every PBR material, one function per material
  sequences.py      keyframes for each sequence, one function per sequence
  render.py         CLI: --sequence A --crop landscape --frames 1-180 --preview
  stills.py         renders the stills
  turntable.py      renders and encodes the review turntable
  check.py          verifies the output against the acceptance checklist
  render-all.sh     the full pipeline in order
```

Scripts must be deterministic: fixed seeds, no dependence on the current
time, no interactive prompts. Build the scene from Blender primitives with
bevel, boolean, solidify, subdivision, and curve modifiers. Do not download
models or textures. Import the SecuriVax mark from
`web/src/assets/brand/securivax-mark-dark.svg` as curves for the stickers.

## The objects

Real-world scale in metres, Y up when exported, origin at the base centre of
each object. Every object is a separate named mesh so it can be moved and
exploded independently. Whole set under 400k triangles after subdivision.
PBR materials only: base colour, roughness, metallic, normal, transmission
where stated. No baked lighting.

### 1. The carrier (`carrier`)

A vaccine carrier of about 1.7 litres net: a rectangular insulated box with
rounded vertical edges, a lift-off lid, and a fold-flat carry handle. Outer
dimensions 330 × 230 × 280 mm. Proportions like a WHO-prequalified vaccine
carrier, redesigned: no ribs, no moulding seams, no manufacturer marks.

- `carrier_body`: matte off-white polymer, base colour #F2F2F4, roughness
  0.55. A 2 mm inset gasket line around the top rim in teal #35D0C3, the only
  colour on the object.
- `carrier_lid`: same material as the body. Underside is a soft-touch
  graphite #2C2C2E, roughness 0.8. Separate mesh, pivot at the rear top edge,
  so it can hinge open and also lift straight up.
- `carrier_handle`: graphite #2C2C2E, folds flat into a recess in the lid.
- `carrier_liner`: the inner cavity, graphite, visible when the lid is open.
- `carrier_front_wall`: the front wall as its own mesh, so it can be hidden
  for the cutaway in sequence E without affecting the rest.
- `icepack_1` to `icepack_4`: four flat conditioned ice packs lining the four
  inner walls. Translucent white polymer, base colour #FFFFFF, transmission
  0.3, roughness 0.35, faint frosted look. No text. Each has a shape key or
  scale driver so its thickness can go from 100% to 20% toward its wall.
- `carrier_sticker`: a 32 mm circular NFC sticker on the outside of the lid
  near the front edge. Matte white with the SecuriVax mark in black.

### 2. The sensor node (`node`)

The designed version of the ESP32 sensor. A puck: 44 mm diameter, 14 mm tall,
1.5 mm chamfer on both edges.

- `node_shell_top`: matte white polymer #F5F5F7, roughness 0.5. A single 8 mm
  slot on the edge for the sensor vent.
- `node_ring`: a 1 mm illuminated ring set into the seam between the shells,
  emissive teal #35D0C3 at low strength. It reads as a thin line of light, not
  a glow. Emission strength is a material property you expose so a sequence
  can fade it.
- `node_shell_bottom`: same white polymer, with a subtle recessed SecuriVax
  mark.
- `node_board`: a round PCB, dark green-black #10231C, with a small sensor
  package, a module can, and a coin-shaped component. Stylised but plausible.
  No readable text.
- `node_battery`: a 3.7 V pouch cell, matte silver.

The node sits in a shallow moulded recess in the carrier liner on the inside
of the front wall, so it is visible when the lid is open.

### 3. The vaccine box (`box`)

A small carton of 10 vials: 95 × 60 × 45 mm.

- `box_carton`: white board #FAFAFA, roughness 0.7, with one line of grey
  text on the front in a clean sans serif reading `OPV · 10 vials · 20 doses`
  and nothing else.
- `box_sticker`: a 25 mm circular NFC sticker on the top face, same style as
  the carrier sticker.
- `vial_1` to `vial_10`: 2 ml glass vials, clear glass, transmission 0.9,
  roughness 0.05, white label, aluminium crimp cap, faint pink liquid.
- `vvm_label`: on `vial_1` only, the vaccine vial monitor: a 10 mm printed
  circle in purple #5B3E9B with an inner square. The square is its own
  material slot (`vvm_square`) whose colour is a keyframeable property, so a
  sequence can drive it from white to purple.

Two boxes sit in the carrier cavity between the ice packs.

### 4. The location tag (`tag`)

A generic Bluetooth location tag: 40 × 30 × 8 mm oval, white polymer, a small
lanyard hole, no brand marks. It is clipped to the inside of the carrier lid.
It has no sequence of its own. It appears in the open-carrier views and in the
cutaway, and gets one still.

## Palette and look

- Light ground: seamless white studio, #FFFFFF to #F5F5F7 gradient, soft
  contact shadow only.
- Dark ground: seamless black studio, #000000, with a single cool rim light
  so the white object reads as an edge-lit silhouette.
- Key light: large soft box, upper left, 5600 K. Fill: large soft source,
  right, at half the key. Rim: narrow, behind, only on the dark ground.
- No lens flare, no motion blur, no depth-of-field blur stronger than f/8.
- Camera: 50 mm equivalent for wide shots, 85 mm for the node and vial
  close-ups.
- Output sRGB, denoised, no film grain, no vignette.

## Sequences

Each sequence is a set of still frames the page scrubs as the visitor
scrolls. Frames are numbered from 0001 with no gaps, from one camera and one
lighting setup throughout. Every sequence is rendered on the one ground listed
for it, in two crops: landscape and portrait, each framed so the object stays
fully in frame in both.

| Id | Name | What happens across the frames | Ground | Frames |
| --- | --- | --- | --- | --- |
| A | Hero reveal | Carrier closed, three-quarter front view, handle down. Camera rises to a top-down three-quarter as the lid lifts straight up 120 mm and slides back, revealing the ice packs, the two boxes, the tag inside the lid, and the node with its ring lit. | light | 180 |
| B | Tag it | The vaccine box alone, top face toward camera at a slight angle, rotating 40 degrees so the NFC sticker catches the key light at the midpoint. | light | 120 |
| C | Sense it | The node alone, exploded on its vertical axis: top shell rises 40 mm, ring 25 mm, board 12 mm, battery stays, bottom shell drops 15 mm. Camera orbits 30 degrees during the explode. | dark | 120 |
| D | Two witnesses | Macro of `vial_1` at 85 mm, VVM label centred. `vvm_square` goes from #FFFFFF to #5B3E9B across the frames. Nothing else moves. | light | 90 |
| E | The twin | Carrier open, `carrier_front_wall` hidden, side elevation. The four ice packs shrink toward the walls to 20% thickness while a faint frost on the liner recedes. The tag is visible clipped inside the lid. Node ring stays lit. | dark | 150 |
| F | Closing | The carrier closed again, front elevation, camera pulling back from tight to full frame. | dark | 120 |

Every sequence must read cleanly in reverse, because the page scrubs
backwards when the visitor scrolls up.

## Stills

Single frames at 4000 px on the long side, as transparent PNG with straight
alpha and also on both grounds:

- `still-carrier-closed` (three-quarter front)
- `still-carrier-open` (top-down three-quarter, lid off, everything visible)
- `still-node` (three-quarter, ring lit)
- `still-node-exploded` (final frame of sequence C)
- `still-box` (three-quarter top)
- `still-vial-vvm` (macro, square at 60% purple)
- `still-tag` (three-quarter, resting on the lid underside)

## Output specification

- Sequence frames: WebP, quality 85. Landscape 1600 × 900, portrait
  900 × 1350. Render at 2× and downsample. Target under 90 KB per landscape
  frame; if a sequence averages above that, lower quality to 80 before
  lowering resolution.
- Stills: PNG for alpha, WebP quality 92 for the grounds.
- Colour: sRGB, 8 bit.
- Naming:
  `web/public/hero/<id>/<crop>/<frame>.webp`, for example
  `web/public/hero/A/landscape/0001.webp`.
  Stills: `web/public/hero/stills/<name>-<alpha|light|dark>.<ext>`.
- Manifest: `web/public/hero/manifest.json`, exactly this shape, which the
  page's loader (`web/src/landing/frames.ts`) reads:

  ```json
  {
    "sequences": [
      {
        "id": "A",
        "name": "Hero reveal",
        "ground": "light",
        "frames": 180,
        "crops": { "landscape": { "width": 1600, "height": 900 }, "portrait": { "width": 900, "height": 1350 } }
      }
    ],
    "stills": [{ "name": "still-carrier-open", "files": { "alpha": "stills/still-carrier-open-alpha.png", "light": "...", "dark": "..." } }]
  }
  ```

- Composition: the page overlays words on the frames, so place the object
  where the words aren't. Landscape crops: the object's centre at 66% of the
  frame width for B, C, D and E (words sit on the left third), centred for A
  and F. Portrait crops: the object centred horizontally, its centre at 66%
  of the frame height for B, C, D (words sit above), at 45% for E (a panel
  sits below), centred for A and F.
- The ground must reach the frame edges as one flat colour, exactly #FFFFFF
  on light and #000000 on dark, with any gradient confined to the middle
  60%. The page shifts and scales frames a little as the reader scrolls and
  fills what that uncovers with that flat colour; a gradient at the edge
  would show a seam.
- Source: the scene as `web/public/hero/source/scene.blend` and the object set
  as one Draco-compressed `web/public/hero/source/securivax.glb` with the mesh
  names above preserved.
- Review: `web/public/hero/review/turntable.mp4`, 10 seconds, 1080p, the open
  carrier on the light ground.

## Order of work, with an approval gate

1. Write the scripts and build the scene.
2. Render `still-carrier-open` and `still-node` at preview quality, and the
   turntable.
3. Stop. Print the paths and ask the human to approve the modelling and
   materials. Do not render any sequence until they say so.
4. After approval, render frame 1, the middle frame, and the last frame of
   every sequence at preview quality, in both crops. Stop again and ask for
   approval of the camera moves.
5. After the second approval, run `render-all.sh` for the finals.
6. Run `check.py` and fix anything it reports before declaring done.

## Rules

- No logos other than the SecuriVax mark. No Espressif, Samsung, WHO, or
  pharmaceutical marks anywhere.
- No readable text other than the carton line specified.
- No people, hands, phones, syringes, or clinical scenery.
- No colour anywhere except teal #35D0C3 on the gasket and node ring, purple
  on the VVM, faint pink in the vials.
- Frames are committed to the repo. If the total exceeds 150 MB, say so and
  propose Git LFS rather than silently shrinking anything.

## What `check.py` must verify

- Every sequence has exactly its frame count in both crops, numbered without
  gaps.
- Every frame in a sequence has identical pixel dimensions.
- No two consecutive frames are byte-identical (a stuck keyframe).
- Landscape frames average under the size budget.
- Alpha stills have no fringe: sample the edge pixels and confirm no
  premultiplied halo when composited on #F5F5F7 and on #000000.
- Every mesh name in the `.glb` matches this brief.
- `manifest.json` agrees with what is on disk.
