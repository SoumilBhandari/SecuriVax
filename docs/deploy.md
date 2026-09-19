# Deploy: DigitalOcean App Platform, with your own domain

One service does everything: FastAPI serves the API and the built phone app,
so NFC stickers, nodes and phones all use one HTTPS address. The spec is
[`.do/app.yaml`](../.do/app.yaml): a Docker web service (1 vCPU, 1 GB) and a
Postgres 16 database.

## 1. Create the app (10 minutes)

These steps need your accounts, so they're yours to run:

```bash
brew install doctl                     # if needed
doctl auth init                        # paste a DigitalOcean API token
doctl apps create --spec .do/app.yaml  # prints the app id
```

DigitalOcean also needs access to the private GitHub repo: the first create
opens a link to install the DigitalOcean GitHub app. Give it this repo only.

Then, in the DigitalOcean console under **Settings → App-Level Environment Variables**,
set the secrets (never in the spec or the repo):

| Variable | What |
| --- | --- |
| `OPERATOR_TOKEN` | A code the team types once per phone to change things (load, unload, confirm a VVM). Without it, anyone with the URL can write, and `/api/admin` is off. |
| `NODE_KEY` | Shared secret for the ESP32 nodes; the same value goes in `firmware/include/config.h`. |
| `GEMINI_API_KEY` | Location agent, place names and the VVM second opinion. |
| `XAI_API_KEY` | Grok writes the report. |

Every push to `main` redeploys. Check it with:

```bash
curl https://<app>.ondigitalocean.app/api/health
```

It should say `"status": "ok"`, `"database": "ok"`, both AI keys `true`,
`"writes": "operator code"`, and `version` set to the deployed commit.

## 2. Your domain (GoDaddy)

Buy the domain yourself. Then:

1. In DigitalOcean: **App → Settings → Domains → Add domain**, e.g. `app.securivax.com`. Choose
   *You manage your domain*. It shows a CNAME target like `securivax-xxxx.ondigitalocean.app`.
2. In GoDaddy: **DNS → Add record**: type `CNAME`, name `app`, value the target from step 1, TTL 1 hour.
   (A bare apex domain can't be a CNAME at GoDaddy; use a subdomain such as `app.` or `www.`.)
3. Wait for DigitalOcean to show the domain as *Active*: it issues the HTTPS certificate itself.
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
