"""Ingest under a hostile network: is every good reading stored exactly once?

A simulated ESP32 node talks to the real API over a link that loses requests,
loses acknowledgements (so the node resends what the server already has),
delivers batches out of order, and a node that reboots (new boot id, sequence
back to 0, clock unset until it syncs, so the server must rebuild timestamps
from uptime) and occasionally reports a sensor glitch (-127 or 85 °C). A
stranger without the node key tries to write too.

The node follows the firmware's protocol: keep every reading until the server
acks it, and drop everything at or below the acked sequence.
"""

import time

import numpy as np
from sqlmodel import Session, select

from app.config import get_settings
from app.models import Reading
from evals.core import Metric, SuiteResult
from evals.harness import api

NODE = "CAR-01"
STEP_S = 60


def run(quick: bool) -> SuiteResult:
    started = time.time()
    rng = np.random.default_rng(5)
    total = 1500 if quick else 6000
    key = get_settings().node_key
    now = int(time.time())
    t0 = now - total * STEP_S  # the readings span the recent past, ending now

    # What the node samples: (boot, seq, true ts, uptime ms, clock set?, temp)
    samples, boot, seq, boot_at = [], 1, 0, t0 - 30
    for i in range(total):
        ts = t0 + i * STEP_S
        if rng.random() < 0.002:  # reboot: new boot id, counter and clock start over
            boot, seq, boot_at = boot + 1, 0, ts - 5
        clock_set = seq > 20 or boot == 1  # after a reboot the clock syncs a little later
        glitch = rng.random() < 0.01
        temp = float(rng.choice([-127.0, 85.0])) if glitch else float(rng.normal(5, 1))
        samples.append({"boot": boot, "seq": seq, "ts": ts, "up": (ts - boot_at) * 1000, "clock": clock_set,
                        "temp": temp, "glitch": glitch})
        seq += 1

    sent = lost_req = lost_ack = reordered = 0
    stranger_blocked = stranger_tries = 0
    with api("kisumu") as (client, eng):
        outbox: list[dict] = []
        pending: list[tuple[int, dict]] = []  # batches delayed in the network
        cursor = 0

        def deliver(batch_boot: int, body: dict) -> None:
            nonlocal lost_ack
            res = client.post("/api/ingest/readings", json=body, headers={"X-Node-Key": key})
            if res.status_code != 200 or rng.random() < 0.2:  # the ack never arrives
                lost_ack += res.status_code == 200
                return
            ack = res.json()["ack_seq"]
            if ack is not None:
                outbox[:] = [s for s in outbox if not (s["boot"] == batch_boot and s["seq"] <= ack)]

        while cursor < total or outbox or pending:
            # Sample for a while, then try to send.
            burst = int(rng.integers(5, 60))
            outbox.extend(samples[cursor:cursor + burst])
            cursor += burst
            if pending and rng.random() < 0.5:  # a delayed batch finally arrives
                b, body = pending.pop(0)
                deliver(b, body)
            if not outbox:
                continue
            boot_now = outbox[0]["boot"]
            chunk = [s for s in outbox if s["boot"] == boot_now][:50]
            send_at = time.time()
            up_now = int((send_at - (chunk[0]["ts"] - chunk[0]["up"] / 1000)) * 1000)
            body = {
                "node_id": NODE, "boot_id": boot_now, "uptime_ms": up_now,
                "readings": [
                    {"seq": s["seq"], "temp_c": s["temp"], "uptime_ms": s["up"], **({"ts": s["ts"]} if s["clock"] else {})}
                    for s in chunk
                ],
            }
            sent += 1
            roll = rng.random()
            if roll < 0.25:
                lost_req += 1  # never reaches the server; the node will resend
            elif roll < 0.35:
                reordered += 1
                pending.append((boot_now, body))
            else:
                deliver(boot_now, body)
            if rng.random() < 0.02:
                stranger_tries += 1
                bad = client.post("/api/ingest/readings", json={**body, "boot_id": 999},
                                  headers={"X-Node-Key": "guess"})
                stranger_blocked += bad.status_code == 401

        with Session(eng) as session:
            rows = session.exec(select(Reading).where(Reading.node_id == NODE)).all()

    stored = {(r.boot_id, r.seq): r for r in rows}
    good = [s for s in samples if not s["glitch"]]
    glitches = [s for s in samples if s["glitch"]]
    stored_good = sum((s["boot"], s["seq"]) in stored for s in good)
    stored_glitch = sum((s["boot"], s["seq"]) in stored for s in glitches)
    rebuilt = [abs(stored[(s["boot"], s["seq"])].ts - s["ts"]) for s in good if not s["clock"] and (s["boot"], s["seq"]) in stored]
    stranger_rows = sum(r.boot_id == 999 for r in rows)
    metrics = [
        Metric("good readings stored", stored_good / len(good), 1.0, unit="%"),
        Metric("rows stored more than once", len(rows) - len(stored), 0, higher_is_better=False,
               note="(node, boot, seq) is unique; resends are harmless"),
        Metric("sensor glitches (-127, 85 °C) stored", stored_glitch, 0, higher_is_better=False),
        Metric("rebuilt timestamps, worst error (s)", max(rebuilt) if rebuilt else 0.0, 5, higher_is_better=False,
               note=f"{len(rebuilt)} readings taken before the clock synced"),
        Metric("writes without the node key blocked", stranger_blocked / max(stranger_tries, 1), 1.0, unit="%"),
        Metric("rows written by the stranger", stranger_rows, 0, higher_is_better=False),
        Metric("batches sent", sent, None, note=f"{lost_req} lost on the way, {lost_ack} acks lost, {reordered} delivered late"),
    ]
    return SuiteResult(
        "ingest", "Node-to-server ingest over a lossy, reordering link, with reboots, unset clocks and sensor glitches",
        metrics, time.time() - started, {"readings": total, "boots": boot},
    )
