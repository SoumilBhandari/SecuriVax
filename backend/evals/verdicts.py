"""Does the verdict catch damaged boxes and leave good ones alone?

Ground truth comes from the true temperature trace; the engine only sees
what a real sensor would report (calibration bias, noise, dropped readings).
"""

import time

import numpy as np

from app.engine.arrhenius import rate_per_hour
from app.engine.history import Reading, Segment
from app.engine.profiles import FREEZE_ALARM_MINUTES, FREEZE_THRESHOLD_C, PRODUCTS, PRODUCTS_BY_ID
from app.engine.verdict import evaluate
from evals.core import Metric, SuiteResult

T0 = 1_780_000_000


def scenario(rng: np.random.Generator):
    """One box, one leg: a plausible trace with a known outcome."""
    product = PRODUCTS[rng.integers(len(PRODUCTS))]
    hours = rng.uniform(4, 96)
    step = int(rng.choice([60, 300, 900]))
    n = int(hours * 3600 / step) + 1
    base = rng.normal(5.0, 0.8)
    temps = base + rng.normal(0, 0.3, n)
    kind = rng.choice(
        ["clean", "heat", "freeze", "brief_freeze", "long_heat", "edge_freeze", "edge_budget"],
        p=[0.25, 0.15, 0.1, 0.1, 0.15, 0.13, 0.12],
    )
    if kind in ("heat", "long_heat"):
        start = rng.integers(0, n // 2)
        length = rng.integers(n // 10, n - start) if kind == "long_heat" else rng.integers(1, max(2, n // 6))
        temps[start:start + length] = rng.uniform(15, 42) + rng.normal(0, 0.5, len(temps[start:start + length]))
    elif kind in ("freeze", "brief_freeze", "edge_freeze"):
        start = rng.integers(0, n // 2)
        minutes = {"freeze": rng.uniform(90, 400), "brief_freeze": rng.uniform(5, 45), "edge_freeze": rng.uniform(40, 100)}[kind]
        length = max(1, int(minutes * 60 / step))
        level = rng.uniform(-1.3, -0.2) if kind == "edge_freeze" else rng.uniform(-5, -1.0)
        temps[start:start + length] = level + rng.normal(0, 0.2, len(temps[start:start + length]))
    initial = float(rng.uniform(0, 0.7))
    if kind == "edge_budget":
        # Land the true budget within +/-10% of the discard point.
        rates = np.array([rate_per_hour(product.anchors, t) for t in temps])
        spent = float(np.sum(0.5 * (rates[1:] + rates[:-1])) * step / 3600)
        initial = float(np.clip(rng.uniform(0.9, 1.1) - spent, 0, 1.2))
    return product, step, temps, initial, kind


def truth(product, step, temps, initial) -> str:
    rates = np.array([rate_per_hour(product.anchors, t) for t in temps])
    budget = initial + float(np.sum(0.5 * (rates[1:] + rates[:-1])) * step / 3600)
    run = longest = 0.0
    for t in temps[:-1]:
        run = run + step / 60 if t <= FREEZE_THRESHOLD_C else 0.0
        longest = max(longest, run)
    froze = product.freeze_sensitive and longest >= FREEZE_ALARM_MINUTES
    if budget >= 1.0:
        return "damaged"
    if froze:
        return "frozen"
    return "near" if budget >= 0.75 else "fine"


def observe(rng, step, temps):
    """What the sensor reports: bias, noise, and ~2% of readings lost."""
    bias = rng.normal(0, 0.2)
    keep = rng.random(len(temps)) > 0.02
    keep[0] = keep[-1] = True
    return [
        Reading(T0 + i * step, float(t + bias + rng.normal(0, 0.1)))
        for i, t in enumerate(temps) if keep[i]
    ]


def run(quick: bool) -> SuiteResult:
    started = time.time()
    rng = np.random.default_rng(42)
    n = 400 if quick else 2000
    tally = {k: {"USE": 0, "USE_FIRST": 0, "QUARANTINE": 0, "DISCARD": 0} for k in ("fine", "near", "frozen", "damaged")}
    edge = {"damaged_used": 0, "damaged": 0, "frozen_used": 0, "frozen": 0}
    for _ in range(n):
        product, step, temps, initial, kind = scenario(rng)
        t = truth(product, step, temps, initial)
        readings = observe(rng, step, temps)
        seg = Segment("CAR-01", "Carrier", T0, readings[-1].ts, readings)
        report = evaluate(product, [seg], now=readings[-1].ts, initial_budget_used=initial)
        tally[t][report.verdict] += 1
        if kind.startswith("edge") and t in ("damaged", "frozen"):
            edge[t] += 1
            edge[f"{t}_used"] += report.verdict in ("USE", "USE_FIRST")

    def share(rows, verdicts):
        total = sum(sum(tally[r].values()) for r in rows)
        return sum(tally[r][v] for r in rows for v in verdicts) / max(total, 1)

    metrics = [
        Metric("damaged boxes not marked USE", share(["damaged"], ["QUARANTINE", "DISCARD"]), 0.97, unit="%",
               note="VVM end point reached: must never be used"),
        Metric("damaged boxes marked DISCARD", share(["damaged"], ["DISCARD"]), 0.9, unit="%"),
        Metric("frozen boxes held (QUARANTINE+)", share(["frozen"], ["QUARANTINE", "DISCARD"]), 0.95, unit="%",
               note="freeze-sensitive product, WHO alarm reached"),
        Metric("fine boxes usable (USE or USE FIRST)", share(["fine"], ["USE", "USE_FIRST"]), 0.95, unit="%", note="no needless waste"),
        Metric("fine boxes wrongly DISCARDed", share(["fine"], ["DISCARD"]), 0.005, higher_is_better=False, unit="%"),
        Metric("edge cases: damaged/frozen box marked USE", (edge["damaged_used"] + edge["frozen_used"]) / max(edge["damaged"] + edge["frozen"], 1),
               0.1, higher_is_better=False, unit="%", note="within sensor error of a threshold"),
    ]
    return SuiteResult(
        "verdicts", "Verdict vs ground truth on synthetic boxes (sensor bias, noise, dropped readings)",
        metrics, time.time() - started, {"confusion": tally, "edge": edge, "boxes": n},
    )
