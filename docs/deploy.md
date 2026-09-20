# Deploy: Render, with your own domain

One service does everything: FastAPI serves the API and the built phone app,
so NFC stickers, nodes and phones all use one HTTPS address. The Blueprint is
[`render.yaml`](../render.yaml): a Docker web service (always on, 512 MB) and a
Postgres 16 database, both in Render's Virginia region.

## 1. Create it (5 minutes, all in the browser)

1. Sign in at [render.com](https://render.com) with GitHub, and let Render see the
   `SoumilBhandari/hophacks` repo (it's private: pick *Only select repositories*).
2. Open **https://render.com/deploy?repo=https://github.com/SoumilBhandari/hophacks**
   (or **New → Blueprint** and pick the repo). Render reads `render.yaml`.
3. It asks for the five secrets. Type them in there; they never go in the repo:

| Variable | What |
| --- | --- |
| `OPERATOR_TOKEN` | A code the team types once per phone to change things (load, unload, confirm a VVM). Pick something memorable. Without it, anyone with the URL can write, and `/api/admin` is off. |
| `NODE_KEY` | The ESP32's key: make up a long random string. The same value goes in `firmware/include/config.h`. Until it's set, no node can upload. |
| `GEMINI_API_KEY` | Location agent, place names and the VVM second opinion. |
| `XAI_API_KEY` | Grok writes the report. |
| `TYPESAFE_API_KEY` | Jev names the likely cause of a leg. Without it the rules name it instead. |

4. Check the plans and price it shows, then **Apply**. The first build takes a few
   minutes, and the first start seeds the demo (about a minute more).

Every push to `main` redeploys. Check it with:

```bash
curl https://securivax.onrender.com/api/health
```

(Render adds a suffix to the name if `securivax` is taken; the dashboard shows the URL.)
It should say `"status": "ok"`, `"database": "ok"`, the AI keys `true`,
`"writes": "operator code"`, `"node_key": "set"`, and `version` set to the deployed commit.

Free instead? Switch the web service to *Free* in the dashboard. It then sleeps
after 15 minutes without traffic and takes about a minute to wake, so wake it
before a demo. The free database expires 30 days after it's created.

## 2. Your domain (GoDaddy)

Buy the domain yourself. Then:

1. In Render: **the service → Settings → Custom Domains → Add**, e.g. `app.securivax.com`.
   It shows the target to point it at (the service's `onrender.com` address).
2. In GoDaddy: **DNS → Add record**: type `CNAME`, name `app`, value that target, TTL 1 hour.
   (A bare apex domain can't be a CNAME at GoDaddy; use a subdomain such as `app.` or `www.`.)
3. Wait for Render to show the domain as verified: it issues the HTTPS certificate itself.
4. Only now write the NFC stickers (the `/tags` page lists every URL) and set `API_BASE` in the firmware.
   A sticker can't be changed once it's locked, so the domain has to be final first.

## 3. Rehearse against the real URL

```bash
cd backend
.venv/bin/python -m simulator.sim_node --node DEMO-01 --api https://app.<your-domain> --key <NODE_KEY>
```

Keys in the simulator: `f` freeze, `h` heat, `n` normal, `o` offline. Run the
five steps in [demo.md](demo.md). Between runs press **Reset the stage demo**
on `/tags`. Before judging, refresh the whole demo so its history ends now:

```bash
curl -X POST https://app.<your-domain>/api/admin/reset-demo -H "X-Operator-Token: <OPERATOR_TOKEN>"
```

The demo seeds itself on the first start. A redeploy keeps the data,
including confirmed VVM photos and what the model learnt from them.
`reset-demo` wipes everything.

## Tiger Data (Timescale) prize: what it would take

Tiger Cloud is Postgres, so pointing `DATABASE_URL` at it works as-is.
Turning `reading` into a hypertable is not a one-liner. Timescale requires every
unique index to include the time column, and our idempotency key is
`(node_id, boot_id, seq)`, without `ts`. We can't simply add `ts`: a reading
sent before the node's clock was set gets its time rebuilt on arrival, so a
resend could carry a slightly different `ts` and be stored twice. The honest
version keeps a small plain table of `(node_id, boot_id, seq) → ts` for
de-duplication and makes `reading` the hypertable keyed on
`(node_id, ts, seq)`. That's roughly an hour of work plus the ingest eval to
prove nothing broke. Worth it only if the prize matters to the team.
