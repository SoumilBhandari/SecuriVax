# Demo script: five steps, about four minutes

Freeze, heat, VVM camera, twin, impact. Open with freezing: it does more damage
in our backtest than heat, and it's the thing a VVM can't show.

## Before you go on

- The deployed URL loads and `/api/health` says `"status": "ok"`, with `grok` and `gemini` both `true`.
- Stickers are written with the URLs from `/tags` (stage: `DEMO-01`, `BOX-9001`, `BOX-9002`).
- The node is sending and the `DEMO-01` page says **Online**. Two ways in:
  - **Deployed, over WiFi (best):** `API_BASE` in `firmware/include/config.h` is the app's HTTPS URL,
    and the board is on a 2.4 GHz phone hotspot.
  - **On the cable:** the board plugged into the laptop, with `python -m scripts.serial_bridge`
    running in `backend/`. Say so on stage: "Today it's on USB to my laptop; in the field it uploads
    over WiFi or a hotspot, and keeps every reading until the server has it."
  - Don't point `API_BASE` at the laptop's IP for the real run: it's today's address on today's
    network (10.191.136.89 during setup), and it changes when the laptop rejoins WiFi.
  - No board at all? `python -m simulator.sim_node --node DEMO-01 --api https://<domain> --key <NODE_KEY>`.
- The stage screen is open on the projector: `/stage` (also linked from `/tags`). It shows the
  node's live temperature and both stage boxes, and turns green, amber or red the moment a verdict flips.
- **Reset the stage** on `/tags` (or under More detail on BOX-9001's page) right before every run. The stage
  carrier runs at 2,880x (one real minute is two days), so 90 real minutes is about six months:
  OPV, the most heat-sensitive vaccine, uses most of its budget in that time even at 5 °C.
- Between steps keep the node **in the cooler at 2–8 °C, not on the ice**, and not on the table:
  at demo speed a fresh OPV box on the bench at 22 °C reaches DISCARD in about seven minutes.
- The sensor sets the freeze line. With the design's SHT31 a reading at −0.2 °C already counts as a
  possible freeze; with today's DHT11 (±2 °C) anything at or below about 1.2 °C does, and the verdict
  says it's allowing for the DHT11's error.
- iPhone: Safari in a normal tab (not Private, not the home-screen app). Unlock before each tap.
- **Enter the operator code on every demo phone first.** Anything that changes data (a carrier tap
  then a box tap, *Move this box*, asking the dispatch agent) asks for it once, in a browser pop-up,
  and the phone remembers it. Do one load on each demo phone before judging so the pop-up never
  appears on stage. Judges on their own phones can look at everything; hand them a demo phone to tap.
- **The site opens on a landing page** (`/`); the app itself starts at `/boxes`, and an installed
  phone app opens straight there. Stickers still open `/box/…` and `/node/…` directly.
- **On a laptop there's no NFC**, so the app swaps each tap for a click. Boxes has a box search
  (press `/`) instead of the tap button. A carrier page loads boxes from a list. *Check the VVM
  label* takes a photo file (or a drop), the webcam, or shows a QR code that opens the same check on
  a phone. The Tags page shows every sticker's QR code. The operator code pop-up appears on the laptop
  too, so enter it there before judging. The switch goes by the pointer (a mouse or trackpad), not
  the window size.
- **The stage node reports to the live site.** `firmware/include/config.h` has
  `API_BASE "https://securivax.onrender.com"`; set `NODE_KEY` to the value in Render and the hotspot's
  WiFi, flash it, and check that `DEMO-01` says **Online** and the stage screen shows its temperature.
- Before judging, refresh the whole demo so its history ends now:
  `curl -X POST https://<domain>/api/admin/reset-demo -H "X-Operator-Token: <code>"`.

## Script

1. **Freeze (60 s).** "On outreach, the VVM is often the only monitor, and a VVM can't see
   freezing. Freeze indicators give you one pass/fail. We show when, where, and for which product."
   Tap the `DEMO-01` sticker, then `BOX-9002` (pentavalent); tap `DEMO-01`, then `BOX-9001` (OPV).
   Put the freezer pack against the sensor (in a zip bag, so it doesn't get wet). The reading drops
   to about 0 °C. The pentavalent box goes to **QUARANTINE** (a possible freeze within the sensor's
   error: run the shake test). The OPV box says it isn't freeze-sensitive. "Same carrier, different
   verdicts." With a DS18B20 probe in a water vial instead, you'd see the drop, then a flat line at
   0 °C while the water in the vial actually freezes.
2. **Heat (45 s).** Hair dryer on the node. OPV's budget climbs through **USE FIRST** and
   **QUARANTINE** to **DISCARD**, live. "A VVM shows heat too. We add when and where, and a
   verdict for products that have no VVM, like rapid tests." Open *What a threshold logger
   would say* under More detail. "One real minute is two days on this demo carrier; the page says so."
3. **VVM camera (45 s).** Open `BOX-KO-0915`: 60 doses of pentavalent on a health worker's
   outreach day, in a vaccine carrier on a motorbike. It's **QUARANTINE**: it froze at −2.4 °C for
   90 minutes right after packing, because the ice packs went in straight from the freezer. Tap
   **Scan the VVM label** and photograph the stage-1 VVM on the test card. The camera compares the
   square with the ring (lighter: usable), and the temperature record predicts stage 1, so the two
   witnesses agree on heat. "The label looks perfect. That's the point: a VVM can't see freezing,
   and this box froze." The verdict stays QUARANTINE until the shake test. Confirming also
   calibrates pentavalent's model (on the Impact page). Use a VVM product for this step: OPV,
   pentavalent or MR. Most COVID-19 vaccines ship without a VVM, and the app hides the scan for them.
4. **Twin (40 s).** Open an in-transit lane box and tap its **Carrier** card: "Leaves 2–8 °C in X h, 80% range
   …". The filter learnt this truck's real cold life from its last trips. Ask the dispatch agent
   what to do.
5. **Impact (30 s).** `/impact`: **144 → 12 trips that left 2–8 °C**, with departures planned from
   the forecast. "No assumption about what anyone does with an alarm: those excursions never happen."

## Questions a judge will ask

- **"Your home screen is national trucks. Isn't the pitch outreach?"** The trucks show the whole
  chain. The outreach box (`BOX-KO-0915`, Kombewa to a school session, vaccine carrier on a
  motorbike) is the last mile the pitch is about, and the stage carrier `DEMO-01` is one too.
- **"Doesn't anyone monitor this already?"** Partly. UNICEF recommends electronic freeze
  indicators for cold boxes, and fridges have 30-day loggers. But outreach carriers often have
  only the VVM, which can't detect freezing. A freeze indicator is one pass/fail; we say when,
  where and which product, and give a verdict per box.
- **"The VVM already shows heat."** Yes, and we read it with the camera and cross-check it. The
  VVM can't show freezing, can't say where it happened, and doesn't exist on rapid tests.
- **"Is 'confidence' a probability?"** No. It says the verdict holds in N% of plausible scenarios
  (sensor bias, batch variation, starting budget). Say "holds in 90% of scenarios", not "90% sure".
- **"Are frozen doses really damaged?"** Not always: chilled vaccine often supercools and stays
  liquid. We count them as freeze-exposed and send the box to the shake test; we don't call them
  destroyed.
- **"What about a box left on a table between carriers?"** It's flagged: "Unmonitored for 3 h
  between carriers", in the reasons and in the chain of custody. We don't count it as cold.
- **"Has the twin seen real data?"** Not yet. We tested it on simulated carriers from its own
  physics, and on carriers built with different physics it doesn't assume: ice that warms as it
  melts, lid openings, heat through the walls. There it still saw 97% of breaches coming and warned
  about 50 minutes early, but its percentages were too high: "94%" happened 71% of the time.
  Saturday's real cooler run is the first real test: predicted breach time against the actual one.
- **"Where does 'saved from needless discard' come from?"** It assumes an alarm means discard,
  which is common practice but not universal. The prevention number (144 → 12) doesn't need it.

## Who explains what (30 seconds each)

Each teammate owns two or three of these and can explain them without notes.

| Module | Where | One-line explanation |
| --- | --- | --- |
| Verdict engine | `backend/app/engine/verdict.py`, `history.py` | Arrhenius budget from WHO VVM curves, plus freeze and gap rules |
| Confidence | `backend/app/engine/uncertainty.py` | Re-runs the verdict 400 times over what we don't know exactly |
| VVM camera | `backend/app/engine/vvm.py` | Square/ring brightness ratio; 1 is the discard point; calibrated on photos |
| Learning | `backend/app/engine/learning.py` | Each confirmed photo tells us how fast the product really degrades |
| Carrier twin | `backend/app/engine/twin.py` | Particle filter over ice left and heat leak; forecasts through a weather ensemble |
| Ingest and node | `backend/app/routers/ingest.py`, `firmware/` | Keep every reading until acked; resending is always safe |
| Phone app | `web/src/pages/BoxPage.tsx` | Tap a sticker, get the verdict and the next 60 seconds |
| Impact backtest | `backend/app/backtest/` | 90 days of real weather, the same trips decided four ways |
