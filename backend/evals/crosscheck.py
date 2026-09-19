"""Camera vs logger: does the cross-check catch real disagreements, and only those?

Each trial is a vaccine box with a known true history. The logger sees it
through a real sensor (bias, noise, dropped readings) and predicts the label's
stage with its Monte Carlo range; the camera reads a synthetic phone photo of
the label at its true progress. In a third of the trials we plant a genuine
disagreement:

- unrecorded heat: the box sat warm before our monitoring, more than the
  assumed initial budget (the label is ahead of the record);
- wrong witness: the record says more heat than the label took (a faulty
  sensor reading hot, or a label from another batch).

The cross-check should flag those and stay quiet on the honest trials.
"""

import time

import numpy as np

from app.engine.history import Segment
from app.engine.profiles import PRODUCTS
from app.engine.uncertainty import verdict_confidence
from app.engine.verdict import evaluate
from app.engine.vvm import cross_check, read_vvm
from evals.core import Metric, SuiteResult
from evals.verdicts import T0, observe, scenario
from evals.vvm import photo

VACCINES = [p for p in PRODUCTS if p.kind == "vaccine"]


def _true_progress(product, step, temps, initial) -> float:
    rates = np.array([product.rate(t) for t in temps])
    return initial + float(np.sum(0.5 * (rates[1:] + rates[:-1])) * step / 3600)


def run(quick: bool) -> SuiteResult:
    started = time.time()
    rng = np.random.default_rng(23)
    n = 150 if quick else 450
    honest = honest_flagged = planted = planted_caught = 0
    stage_match = stage_total = retakes = 0
    by_kind = {"unrecorded heat": [0, 0], "wrong witness": [0, 0]}
    for _ in range(n):
        product, step, temps, initial, _kind = scenario(rng)
        if product.kind != "vaccine":
            product = VACCINES[rng.integers(len(VACCINES))]
        true_initial = initial
        plant = rng.choice(["none", "unrecorded heat", "wrong witness"], p=[2 / 3, 1 / 6, 1 / 6])
        if plant == "unrecorded heat":
            true_initial = initial + rng.uniform(0.35, 0.6)
        progress = _true_progress(product, step, temps, true_initial)
        if plant == "wrong witness":
            progress = max(0.0, progress - rng.uniform(0.35, 0.6))
        progress_shown = min(progress, 1.4)  # a label that far gone looks the same

        readings = observe(rng, step, temps)
        seg = [Segment("N", "Carrier", T0, readings[-1].ts, readings)]
        now = readings[-1].ts
        report = evaluate(product, seg, now, initial)
        conf = verdict_confidence(product, seg, initial, report.verdict, False, now=now, samples=200)

        cam = read_vvm(photo(rng, progress_shown, hard=True))
        if not cam.found:
            retakes += 1
            continue
        w = cross_check(cam.progress, cam.stage, report.budget_used, conf.budget_p10, conf.budget_p90, rho=cam.rho)
        # Planted gaps small enough to vanish in the label's saturation don't count.
        visible = plant != "none" and not (min(progress, 1.2) >= 1.15 and min(report.budget_used, 1.2) >= 1.15)
        if plant == "none":
            honest += 1
            honest_flagged += w.flagged
            stage_total += 1
            stage_match += w.predicted_stage == cam.stage or (w.predicted_stage >= 3 and cam.stage >= 3)
        elif visible:
            planted += 1
            planted_caught += w.flagged
            by_kind[plant][0] += 1
            by_kind[plant][1] += w.flagged
    metrics = [
        Metric("planted disagreements flagged", planted_caught / max(planted, 1), 0.9, unit="%"),
        Metric("  unrecorded heat (label ahead) flagged", by_kind["unrecorded heat"][1] / max(by_kind["unrecorded heat"][0], 1), None, unit="%"),
        Metric("  wrong witness (record ahead) flagged", by_kind["wrong witness"][1] / max(by_kind["wrong witness"][0], 1), None, unit="%"),
        Metric("honest boxes flagged (false alarm)", honest_flagged / max(honest, 1), 0.05, higher_is_better=False, unit="%"),
        Metric("record predicts the camera's stage", stage_match / max(stage_total, 1), 0.8, unit="%",
               note="stages 3 and 4 both count as discard"),
        Metric("photos needing a retake", retakes / n, None, unit="%"),
    ]
    return SuiteResult(
        "crosscheck",
        "Camera vs temperature record: planted disagreements (unrecorded heat, wrong witness) against honest boxes",
        metrics, time.time() - started, {"trials": n, "planted": planted, "honest": honest},
    )

