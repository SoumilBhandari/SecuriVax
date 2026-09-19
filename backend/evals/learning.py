"""Crowdsourced calibration: does the model get better as VVM photos come in?

A product in the field degrades k times as fast as its label's curve says (we
try k = 0.8, 1.0, 1.25, 1.5). Health workers photograph labels on boxes with
known-to-us-only-through-the-sensor histories; each confirmed photo feeds the
posterior over k. We check:

- does the learned k converge on the truth, and is its 80% range honest?
- does it make verdicts better? With the label's curve alone, a product that
  is really 1.5x faster gets spent boxes called usable; after learning it
  shouldn't. A product that is really slower must not get riskier verdicts.
"""

import dataclasses
import time

import numpy as np

from app.engine.history import Segment
from app.engine.learning import Observation, posterior
from app.engine.profiles import PRODUCTS_BY_ID
from app.engine.verdict import USABLE, evaluate
from app.engine.vvm import CALIBRATION, read_vvm
from evals.core import Metric, SuiteResult
from evals.verdicts import T0, observe
from evals.vvm import photo

PRODUCT = PRODUCTS_BY_ID["opv"]  # VVM2: the most heat-sensitive, where learning matters most
TRUE_K = (0.8, 1.0, 1.25, 1.5)


def box(rng, k: float):
    """A box with a warm spell or two; returns what the logger sees and the truth."""
    step = 900
    hours = rng.uniform(24, 240)
    n = int(hours * 3600 / step) + 1
    temps = rng.normal(5.5, 0.8) + rng.normal(0, 0.3, n)
    for _ in range(rng.integers(1, 4)):
        start = rng.integers(0, n - 2)
        length = rng.integers(4, max(5, n // 4))
        temps[start:start + length] = rng.uniform(20, 40)
    initial_true = rng.uniform(0, 0.4)
    rates = np.array([PRODUCT.rate(t) for t in temps])
    dose_true = float(np.sum(0.5 * (rates[1:] + rates[:-1])) * step / 3600)
    progress = initial_true + k * dose_true
    readings = observe(rng, step, temps)
    seg = [Segment("N", "Carrier", T0, readings[-1].ts, readings)]
    initial_recorded = float(np.clip(initial_true + rng.normal(0, 0.05), 0, None))
    return seg, readings[-1].ts, initial_recorded, progress


def photos(rng, k: float, n: int, camera: bool) -> list[Observation]:
    out = []
    while len(out) < n:
        seg, now, initial, progress = box(rng, k)
        dose = evaluate(PRODUCT, seg, now, initial).budget_used - initial
        if camera:
            r = read_vvm(photo(rng, min(progress, 1.4), hard=False))
            if not r.found:
                continue
            measured = r.progress
        else:
            measured = progress + rng.normal(0, CALIBRATION.progress_sigma)
        out.append(Observation(initial, dose, progress=measured, sigma=CALIBRATION.progress_sigma))
    return out


def verdict_errors(rng, k: float, scale: float, n: int) -> tuple[float, float]:
    """Share of truly spent boxes called usable, and of truly fine boxes held."""
    profile = dataclasses.replace(PRODUCT, rate_scale=scale)
    spent = spent_used = fine = fine_held = 0
    for _ in range(n):
        seg, now, initial, progress = box(rng, k)
        v = evaluate(profile, seg, now, initial).verdict
        if progress >= 1.0:
            spent += 1
            spent_used += v in USABLE
        elif progress < 0.75:
            fine += 1
            fine_held += v not in USABLE
    return spent_used / max(spent, 1), fine_held / max(fine, 1)


def run(quick: bool) -> SuiteResult:
    started = time.time()
    rng = np.random.default_rng(31)
    reps = 8 if quick else 25
    rel_err_60, covered, trials = [], 0, 0
    for k in TRUE_K:
        # With real camera reads of synthetic photos (slow): the headline number.
        post = posterior(photos(rng, k, 30 if quick else 60, camera=True))
        rel_err_60.append(abs(post.median - k) / k)
        # Coverage of the 80% range, with the camera's calibrated error (fast).
        for _ in range(reps):
            p = posterior(photos(rng, k, 20, camera=False))
            covered += p.p10 <= k <= p.p90
            trials += 1

    n_boxes = 300 if quick else 1000
    k_fast, k_slow = 1.5, 0.8
    before_fast = verdict_errors(np.random.default_rng(7), k_fast, 1.0, n_boxes)
    learned_fast = posterior(photos(rng, k_fast, 30, camera=False)).scale_used
    after_fast = verdict_errors(np.random.default_rng(7), k_fast, learned_fast, n_boxes)
    before_slow = verdict_errors(np.random.default_rng(8), k_slow, 1.0, n_boxes)
    learned_slow = posterior(photos(rng, k_slow, 30, camera=False)).scale_used
    after_slow = verdict_errors(np.random.default_rng(8), k_slow, learned_slow, n_boxes)

    metrics = [
        Metric("learned speed within 10% of the truth", float(np.mean(np.array(rel_err_60) <= 0.10)), 1.0, unit="%",
               note=f"{30 if quick else 60} camera-read photos, true speed 0.8x to 1.5x"),
        Metric("median error of the learned speed", float(np.median(rel_err_60)), 0.06, higher_is_better=False, unit="%"),
        Metric("80% range contains the truth (20 photos)", covered / trials, 0.7, unit="%", note="honest if about 80%"),
        Metric("1.5x-fast product: spent boxes called usable, label curve", before_fast[0], None, unit="%"),
        Metric("1.5x-fast product: spent boxes called usable, after 30 photos", after_fast[0], 0.05, higher_is_better=False, unit="%",
               note=f"learned {learned_fast:.2f}x"),
        Metric("0.8x-slow product: spent boxes called usable, after 30 photos", after_slow[0], max(before_slow[0], 0.02),
               higher_is_better=False, unit="%", note=f"learned {learned_slow:.2f}x; relaxing must not add risk"),
        Metric("0.8x-slow product: good boxes held, label curve", before_slow[1], None, unit="%"),
        Metric("0.8x-slow product: good boxes held, after 30 photos", after_slow[1], before_slow[1], higher_is_better=False, unit="%"),
    ]
    return SuiteResult(
        "learning",
        "Crowdsourced calibration: learning a product's real degradation speed from confirmed VVM photos",
        metrics, time.time() - started,
        {"true_speeds": TRUE_K, "learned_fast": learned_fast, "learned_slow": learned_slow},
    )
