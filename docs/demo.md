# Demo script (3 minutes)

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
6. **Reliability (15 s).** Simulator `o` (offline) for 20 s, then `o` again. The node page
   upload log shows the buffered batch arriving, with no gaps and no duplicates.
7. **Rapid tests (10 s).** Open `BOX-0101`: a hot, humid clinic store room, with a heat and
   desiccant advisory.

## Reset

```bash
cd backend && .venv/bin/python -m simulator.backfill --reset
```

On Render, use the shell, or delete and recreate the database.
