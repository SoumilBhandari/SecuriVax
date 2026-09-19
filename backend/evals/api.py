"""API latency and payload size on the full demo (nine lanes, days of history).

Measured in-process (no network) on whatever machine runs the evals, so the
targets are for a laptop; a 1 vCPU deploy is roughly 2x slower. What matters is
that a nurse tapping a sticker gets the verdict well under a second, and that
nothing the phone polls is heavy.
"""

import gzip
import io
import json
import time

import numpy as np

from evals.core import Metric, SuiteResult
from evals.harness import api


def _times(client, method: str, url: str, n: int, **kw) -> tuple[list[float], bytes]:
    out, body = [], b""
    for _ in range(n):
        t = time.perf_counter()
        res = getattr(client, method)(url, **kw)
        out.append((time.perf_counter() - t) * 1000)
        assert res.status_code == 200, (url, res.status_code, res.text[:200])
        body = res.content
    return out, body


def run(quick: bool) -> SuiteResult:
    started = time.time()
    reps = 5 if quick else 15
    with api("lanes", history=True) as (client, _):
        boxes = [b["id"] for b in client.get("/api/boxes").json()]
        lane_boxes = [b for b in boxes if not b.startswith("BOX-9")]
        list_ms, _ = _times(client, "get", "/api/boxes", reps)
        fleet_ms, _ = _times(client, "get", "/api/boxes/fleet/summary", reps)
        report_ms, sizes = [], []
        for b in lane_boxes:
            ms, body = _times(client, "get", f"/api/boxes/{b}/report", max(2, reps // 3))
            report_ms += ms
            sizes.append((len(body), len(gzip.compress(body))))
        carriers = sorted({r["current_node_id"] for r in client.get("/api/boxes").json() if r["current_node_id"]})
        cold, warm = [], []
        for node in carriers:
            t = time.perf_counter()
            client.get(f"/api/nodes/{node}/forecast")
            cold.append((time.perf_counter() - t) * 1000)
            warm += _times(client, "get", f"/api/nodes/{node}/forecast", 3)[0]
        stores_ms, _ = _times(client, "get", "/api/climate/stores", 2)

        from tests.test_vvm import vvm_photo

        buf = io.BytesIO()
        vvm_photo(0.6).save(buf, "JPEG")
        import base64

        payload = {"image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}
        vvm_ms, _ = _times(client, "post", f"/api/boxes/{lane_boxes[0]}/vvm", 3, json=payload)

    p95 = lambda xs: float(np.percentile(xs, 95))  # noqa: E731
    raw_kb = max(s[0] for s in sizes) / 1024
    gz_kb = max(s[1] for s in sizes) / 1024
    metrics = [
        Metric("box list, p95 (ms)", p95(list_ms), 250, higher_is_better=False),
        Metric("fleet summary, p95 (ms)", p95(fleet_ms), 250, higher_is_better=False),
        Metric("box report (verdict + Monte Carlo), p95 (ms)", p95(report_ms), 400, higher_is_better=False,
               note="what a sticker tap waits for"),
        Metric("carrier forecast, first call (ms)", max(cold), 3000, higher_is_better=False,
               note="particle filter + 40-member ensemble"),
        Metric("carrier forecast, cached, p95 (ms)", p95(warm), 100, higher_is_better=False),
        Metric("stores at risk, p95 (ms)", p95(stores_ms), 1500, higher_is_better=False),
        Metric("VVM photo read + cross-check, p95 (ms)", p95(vvm_ms), 1500, higher_is_better=False, note="Gemini off"),
        Metric("largest box report, gzipped (KB)", gz_kb, 40, higher_is_better=False, note=f"{raw_kb:.0f} KB raw"),
    ]
    return SuiteResult(
        "api", "API latency and payload size on the nine-lane demo with full history (in-process, laptop)",
        metrics, time.time() - started, {"boxes": len(boxes), "carriers": carriers, "reps": reps},
    )


if __name__ == "__main__":
    print(json.dumps([m.to_dict() for m in run(True).metrics], indent=1))
