# UI overhaul: decisions

Agreed on 19 September 2026. This is the contract for the `ui-overhaul`
branch. Change the file when a decision changes.

## Direction

- **North star: an Apple product page.** The landing page is a pinned-object
  scroll story. The app pages feel like an iOS system app on the web: large
  type, generous space, glass chrome, spring physics, one idea per screen.
- **No deadline.** Quality over speed. Every slice ships working and reviewed.
- **Copy is unchanged.** Words stay as written; only presentation changes.

## Brand

- The SecuriVax logo stays. It is the team's, not the UI's.
- The three verdict signals stay exactly as they are: green USE, amber
  QUARANTINE, red DISCARD. They appear only on the verdict itself: the
  full-bleed verdict field, list badges, map pins. Never on buttons, chart
  lines, or reasons.
- Everything else goes neutral. Light: white and #F5F5F7 grounds, #1D1D1F
  text. Dark: black and #1C1C1E, white text. Ink navy is gone as a surface.
- Glacier teal #35D0C3 is the single accent, used rarely: links, the one
  primary action, the node ring in renders.

## Type

- SF Pro Display for 20px and up, SF Pro Text below, SF Mono only for IDs and
  readings where alignment matters. Bundled as subset woff2 from the installed
  Apple developer fonts. Known: Apple's license limits SF to Apple platforms;
  if the repo goes public or the product ships, swap to the system stack with
  Inter as the non-Apple fallback.
- Sora, DM Sans, and Geist Mono are removed. The uppercase mono eyebrows are
  removed; Apple uses SF Pro at small sizes with slight positive tracking.
- Scale: 12, 14, 17, 21, 28, 40, 56, 80. Tabular figures on data, proportional
  on headlines.

## Theme

- **Landing page is art-directed.** It ignores the system theme. Sections pick
  their own ground: the hero is black with the carrier lit and a teal glow
  under it, then the chapters alternate.
- **App pages follow the system**, with the existing manual override. The
  theme toggle lives inside the app only, not on the landing nav.

## Motion

- **GSAP with ScrollTrigger and Flip.** One library. CSS transitions for hover
  and press only.
- **Landing page**: pinned sections, scrubbed frame sequences, staggered
  reveals, sticky chapter headers.
- **App pages**: entrance reveals once on first view. No pinning, no scroll
  hijacking, no parallax. A verdict page scrolls like a normal page.
- **Page transitions** use the View Transitions API through the router. A box
  card's badge morphs into the verdict field on the next page.
- `prefers-reduced-motion` turns scrubbed sequences into their final frame and
  disables reveals.

## Landing page

- **Hero object: a rendered 3D carrier**, delivered as pre-rendered frame
  sequences scrubbed on a canvas, Apple's own method. The hardware is
  idealised: a designed sensor puck, a clean carrier, a generic tag. The brief
  is `docs/hero-3d-brief.md` and runs through Codex CLI and Blender.
- **The hero moves before the reader does.** On load the headline's lines rise
  out of a mask and the scene fades up; at rest the carrier sways and bobs
  (dying out on scroll); two glass chips float beside it with the newest live
  reading anywhere and one box's verdict.
- **Data chapters** between the object chapters: the temperature trace drawing
  itself, the budget ring filling, the verdict word stepping through its four
  states, the forecast fan.
- Chapters, in order: Hero, Temperature over the trip, How it works (Tag it,
  Sense it, Decide), the numbers, Inside the app, Closing.
- **The words are the landing page's words from before the overhaul**, with
  no new copy: the three steps keep their text, and the Two witnesses and
  twin chapters were taken out (19 September) because they had only new,
  technical wording.
- **Live 3D until the render lands.** The objects are built from geometry in
  `web/src/landing/three/objects.tsx` (a filleted carrier with an open cavity,
  lid, latches, handle, gasket and badge; the carton; the sensor puck; the tag;
  the vial) with physically based materials, and rendered by Three.js in each
  chapter, driven by the same scroll progress. Free CC0 models from Poly Pizza
  were evaluated (a cooler, cardboard boxes, vials) and rejected: low-poly
  game assets with uncontrolled interiors read worse than clean geometry.
  Each chapter picks, in order: the render's frames if
  `web/public/hero/manifest.json` exists, live WebGL, or a flat 2D drawing.

## App shell

- **Phone**: a floating glass tab bar lifted off the bottom edge, five sections,
  collapsing to icons on scroll down and expanding on scroll up.
- **Desktop**: no sidebar. A frosted top bar with the sections centred, content
  in a centred column. The box page keeps its two-column split.
- The landing page has its own nav: transparent over the hero, then a
  floating glass capsule that takes the colours of whichever chapter is under
  it (an observer on the top strip of the viewport). Logo, three links on
  laptops, Sign in, Open the app.
- The five sections stay as they are.

## The verdict

- **Full-bleed** on the box page and the stage screen. The top of the box
  page is an edge-to-edge field in the verdict colour with the word at display
  size, the budget ring, and the one-line instruction. The rest of the page is
  a sheet with rounded top corners that scrolls up over it. On a flip the new
  colour washes outward from the ring with a spring on the word.
- The boxes list stays neutral with small badges.

## Data surfaces

- **Maps**: CARTO Positron and Dark Matter tiles, following the theme. Custom
  zoom control, attribution as one line in the map footer. Pins and trip lines
  redrawn; the verdict colour only on the pin.
- **Charts**: keep the existing SVG and canvas code, restyle with the tokens:
  SF Pro tick labels, hairline axes, a single ink line, the 2 to 8 band as the
  only tint, draw-in on first view. The trip point cloud keeps its physics.

## Defaults not worth a question

- Icons: the existing hand-drawn line set, stroke tuned to match SF Symbols
  weights. SF Symbols are not bundled.
- Sheets: bottom sheets with spring physics and drag-to-dismiss on phone,
  centred dialogs on desktop.
- Accessibility rigour stays: 44px targets, AA contrast, focus rings, live
  regions on the verdict.
- Local dev proxies `/api` to the deployed server so every page shows real
  data without running the backend.

## Delivery

- Work happens in this folder on the `ui-overhaul` branch, on top of a
  snapshot commit of the tree as downloaded. The team pushes it.
- Order: foundation (fonts, tokens, shell, motion primitives, view
  transitions), then the box page, boxes list, stage, carrier page, then the
  landing scroll engine and data chapters on placeholders, then secondary
  pages, then the landing page finals when the render lands.
- Each slice is one commit with screenshots at phone and laptop widths in
  light and dark.
