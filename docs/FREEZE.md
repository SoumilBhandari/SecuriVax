# Demo freeze — HopHacks 2026

This is the state submitted and demoed. Nothing below changes without a very
good reason; the deadline is Sunday 08:30.

## The links that must work

Written to NFC stickers. All public — no account, any phone.

| Tag | URL | Shows |
| --- | --- | --- |
| Cooler | `/node/KO-VC` | Vaccine carrier Kombewa–Kisumu West (motorbike). Online, running at 1.2 °C — below the 2 °C floor now. |
| Cooler (alt) | `/node/NG-TRK` | Truck cold box Lagos–Kano. Online, 3.9 °C, warms past 8 °C in ~3 h. |
| Box · USE | `/box/BOX-KE-0231` | RTS,S malaria vaccine · 2% of budget · "Safe to use." |
| Box · USE FIRST | `/box/BOX-SN-0834` | Malaria rapid test · 60% · "Bring it to the front." |
| Box · QUARANTINE | `/box/BOX-KO-0915` | Pentavalent · froze at −2.4 °C for 90 min · "Run the shake test." |
| Box · DISCARD | `/box/BOX-NG-0442` | Comirnaty · 100% · 3.2× the budget · "Do not use." |

Base: `https://securivax.onrender.com`. No `?tap=1` — that is the driver
handover flow and it asks for a sign-in.

**The pairing to show:** tap `KO-VC`, then `BOX-KO-0915`. The carrier is running
too cold right now; the box inside it already froze. That is the case a VVM
cannot make.

## Who can see what

- **Public:** the landing page, and any single box or carrier (`/box/:id`,
  `/node/:id`). This is what a sticker opens.
- **Sign-in:** the box list, live, climate, impact, stickers and the stage —
  anything that browses the fleet.
- Demo account: `bhanda61@purdue.edu` / `12345678` (viewer).

## What is real and what is not

- Real: the verdict engine, the 90-day backtest on ERA5 weather, the carrier
  twin, ingest, the live stream, every verdict on screen.
- Not measured: the node. The bench sensor never answered
  ([hardware.md](hardware.md)), so it runs `pio run -e replay`, which sends a
  scripted trip with no sensor fitted. Nothing it sends is presented as measured.
- Illustrative: the stability constants are anchored on published VVM grades,
  not a manufacturer's dossier.
- Confidence is scenario coverage, not a calibrated probability.

## Scripts

- Website, five minutes: [walkthrough.md](walkthrough.md)
- Stage with a working sensor: [demo.md](demo.md)

## Checks at freeze

211 backend tests · typecheck and build clean · pyflakes clean · knip reports
nothing unused that is not a CLI script · every internal doc link and image
resolves · no secrets tracked, `.env` never committed · all 160 commits inside
the event window · deploy matches HEAD.
