# Demo script (4 minutes; trim steps 9 to 11 if short on time)

## Before you go on

- Deployed URL loads, and `/api/health` returns ok.
- Stickers are written with the URLs from the `/tags` page (demo: `DEMO-01`, `BOX-9001`, `BOX-9002`).
- The node (or `python -m simulator.sim_node --node DEMO-01 --api https://<domain> --key <NODE_KEY>`) is sending. The `DEMO-01` page should say "Online".
- On iPhone, use Safari in a normal tab, not Private and not the home-screen app. Unlock the screen before each tap.
- Have the Gemini and Grok keys set. Without them the report still works, but reads as a template.

## Script

1. **The gap (20 s).** "Vaccines are monitored in the national store and district
   fridges. Between the district and the clinic, and on outreach, nobody watches.
   Rapid tests aren't monitored at all."
2. **Tap to load (30 s).** Tap the `DEMO-01` carrier sticker ("Now tap a box…"),
   then tap `BOX-9001` (OPV). A toast says "Loaded into DEMO-01", and the verdict is **USE**.
   Tap `DEMO-01`, then `BOX-9002` (pentavalent).
3. **Heat (45 s).** Hair dryer on the node (simulator: `h`). The OPV page updates
   live every 5 s: budget climbs, then **QUARANTINE** (check VVM), then **DISCARD**.
   "One real minute is two days on this demo carrier. We say so on screen."
4. **Freeze (30 s).** Freezer pack on the node (simulator: `f`). The pentavalent box goes
   to **QUARANTINE**, "run the shake test". The OPV box shows "not freeze-sensitive".
   "Same carrier, different verdicts. It's product-specific."
5. **The story (30 s).** Scroll the report. Grok wrote it and Gemini named the places:
   "froze on the Kisumu–Bondo road…". Show the map with the purple freeze segment and
   the chain of custody. "The AI explains; the verdict comes from WHO VVM curves
   and fixed rules."
6. **Two witnesses (30 s).** Open `BOX-0002`: QUARANTINE, but only "64% sure".
   It's borderline, so the page asks for the VVM label. Photograph the stage-2
   VVM from the test card (`/tags`) on the bottle. The camera measures it, Gemini
   gives a second read, the label and the sensor agree, and the worker confirms.
7. **The twin (30 s).** Open `BOX-0006` (in CAR-02): "Leaves 2–8 °C in 3.9 h, 80%
   range 2.1–6.4 h". The twin learnt CAR-02's 3 h cold life from its last trips.
   Ask the location agent: carry on, and here's the nearest fridge if you're
   delayed.
8. **Impact (20 s).** `/impact`: 98% fewer damaged doses reaching patients,
   with none of the ~1,100 good doses an alarm-only logger throws away.
9. **Environment (30 s).** Open `/climate`: "Ahero hits 35 °C on Monday. Here's who
   should move stock into the fridge." Back on `BOX-0001`, the chart shows outside air
   at 22 °C while the box froze at −3 °C: "The weather didn't do this; the ice packs
   did." Open `/plan?product=opv&carrier=CAR-02`: "This carrier only holds 3 hours,
   so every afternoon run breaks the cold chain. Frozen packs would fix 4 of 5."
10. **Reliability (15 s).** Simulator `o` (offline) for 20 s, then `o` again. The node page
   upload log shows the buffered batch arriving, with no gaps and no duplicates.
   Unplug ESP32 #1: the backup node fills in, with no gap.
11. **Rapid tests (10 s).** Open `BOX-0101`: a hot, humid clinic store room, with a heat and
   desiccant advisory.

## Reset

```bash
cd backend && .venv/bin/python -m simulator.backfill --reset
```

On Render, use the shell, or delete and recreate the database.
