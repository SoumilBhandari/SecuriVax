"""Verdict confidence: does it match the engine, and is it calibrated?

1. With no perturbation, the Monte Carlo must reproduce the engine's verdict
   exactly: they share the integration points and rules.
2. Calibration: on boxes where we know the true (noise-free) record, the
   verdict computed from a biased sensor should be right about as often as
   the confidence says.
"""

import time

import numpy as np

from app.engine.history import Segment
from app.engine.uncertainty import verdict_confidence
from app.engine.verdict import evaluate
from evals.core import Metric, SuiteResult
from evals.verdicts import T0, observe, scenario


def run(quick: bool) -> SuiteResult:
    started = time.time()
    rng = np.random.default_rng(5)
    n = 250 if quick else 800
    agree_zero = 0
    pairs = []
    for _ in range(n):
        product, step, temps, initial, _ = scenario(rng)
        readings = observe(rng, step, temps)
        seg = [Segment("CAR-01", "Carrier", T0, readings[-1].ts, readings)]
        now = readings[-1].ts
        report = evaluate(product, seg, now=now, initial_budget_used=initial)
        forced = any(r.code in ("HISTORY_GAP", "NODE_OFFLINE") for r in report.reasons)
        zero = verdict_confidence(product, seg, initial, report.verdict, forced, now=now,
                                  samples=8, bias_c=0, rate_spread=0, initial_spread=0)
        agree_zero += zero.confidence == 1.0
        # Truth: the engine on the noise-free trace.
        clean = [r.__class__(r.ts, float(temps[(r.ts - T0) // step])) for r in readings]
        truth = evaluate(product, [Segment("CAR-01", "Carrier", T0, clean[-1].ts, clean)], now=now, initial_budget_used=initial).verdict
        conf = verdict_confidence(product, seg, initial, report.verdict, forced, now=now, samples=200)
        pairs.append((conf.confidence, float(report.verdict == truth)))

    p, y = np.array(pairs).T
    bins = np.minimum((p * 5).astype(int), 4)
    ece = float(sum(abs(p[bins == k].mean() - y[bins == k].mean()) * (bins == k).mean() for k in range(5) if (bins == k).any()))
    low = p < 0.8
    metrics = [
        Metric("zero-noise Monte Carlo reproduces the verdict", agree_zero / n, 1.0, unit="%", note="shared logic, no drift"),
        Metric("confidence calibration error", ece, 0.08, higher_is_better=False, unit="%"),
        Metric("verdicts marked confident (>=80%) that are right", float(y[~low].mean()) if (~low).any() else 1.0, 0.95, unit="%"),
        Metric("verdicts marked borderline that are wrong", float(1 - y[low].mean()) if low.any() else 0.0, None, unit="%",
               note="where the camera check earns its keep"),
    ]
    return SuiteResult("confidence", "Monte Carlo verdict confidence: consistency with the engine and calibration",
                       metrics, time.time() - started, {"boxes": n})
