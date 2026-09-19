# Demo script: five steps, about four minutes

Freeze, heat, VVM camera, twin, impact. Open with freezing: it does more damage
in our backtest than heat, and it's the thing a VVM can't show.

## Before you go on

- The deployed URL loads and `/api/health` says `"status": "ok"`, with `grok` and `gemini` both `true`.
- Stickers are written with the URLs from `/tags` (stage: `DEMO-01`, `BOX-9001`, `BOX-9002`).
- The node is sending and the `DEMO-01` page says **Online**. No board? Run
  `python -m simulator.sim_node --node DEMO-01 --api https://<domain> --key <NODE_KEY>`.
- **Reset the stage** on `/tags` (or on BOX-9001's History tab) before every run. Kept on ice, the
  stage boxes drift towards QUARANTINE within about 90 minutes of demo time.
- iPhone: Safari in a normal tab (not Private, not the home-screen app). Unlock before each tap.
- Before judging, refresh the whole demo so its history ends now:
  `curl -X POST https://<domain>/api/admin/reset-demo -H "X-Operator-Token: <code>"`.

## Script

1. **Freeze (60 s).** "On outreach, the VVM is often the only monitor, and a VVM can't see
   freezing. Freeze indicators give you one pass/fail. We show when, where, and for which product."
   Tap the `DEMO-01` sticker, then `BOX-9002` (pentavalent); tap `DEMO-01`, then `BOX-9001` (OPV).
   Put the probe vial on the freezer pack. The reading drops, then sits at 0 °C while the water in
   the vial actually freezes. The pentavalent box goes to **QUARANTINE** ("Froze", run the shake
   test). The OPV box says it isn't freeze-sensitive. "Same carrier, different verdicts."
2. **Heat (45 s).** Hair dryer on the node. OPV's budget climbs through **USE FIRST** and
   **QUARANTINE** to **DISCARD**, live. "A VVM shows heat too. We add when and where, and a
   verdict for products that have no VVM, like rapid tests." Point at *Threshold logger vs
   Vialtality* on the Why tab. "One real minute is two days on this demo carrier; the page says so."
3. **VVM camera (45 s).** Open `BOX-TZ-0318` (Spikevax): QUARANTINE, and it *holds in 67% of
   scenarios*. Go to the Label tab, then **Scan the VVM label** and photograph the stage-2 VVM
   from the test card. The camera compares the square with the ring (1.51, lighter: usable). The
   temperature record predicts stage 2, so the two witnesses agree. Confirm. Now it holds in 90%,
   and the photo also calibrates Spikevax's model (on the Impact page).
4. **Twin (40 s).** Open an in-transit lane box, Carrier tab: "Leaves 2–8 °C in X h, 80% range
   …". The filter learnt this truck's real cold life from its last trips. Ask the dispatch agent
   what to do.
5. **Impact (30 s).** `/impact`: **144 → 12 trips that left 2–8 °C**, with departures planned from
   the forecast. "No assumption about what anyone does with an alarm: those excursions never happen."

## Questions a judge will ask

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
- **"Has the twin seen real data?"** Only simulated data so far, from its own physics. Saturday's
  real cooler run is the first test: predicted breach time against the actual one.
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
