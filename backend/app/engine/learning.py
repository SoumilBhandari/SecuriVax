"""Crowdsourced calibration: every confirmed VVM photo improves the stability model.

The label's Arrhenius curve says how fast a product uses up its stability
budget. A real product in the field may run faster or slower. Each VVM photo
a health worker confirms is a measurement of the truth: the label shows
progress p, and our record says the box took a heat dose D (at the label's
nominal speed) on top of the budget assumed used before monitoring, B0. If the
product degrades k times the nominal speed,

    p = B0 + k * D + noise

so every photo carries information about k. We keep a posterior over log k per
product on a grid (so a stage the worker picked, which is an interval, counts
as well as a camera measurement), starting from N(0, 0.15^2): the same spread
the verdict's Monte Carlo already assumes for batch-to-batch variation.

How the engine uses it, conservatively:
- if the evidence says the product is faster (median k above 1.02), the curve
  is sped up to the median at once;
- it is slowed down only when the evidence is strong (the posterior's 90th
  percentile below 1), and then only to that percentile;
- the Monte Carlo draws the rate from the posterior's spread, so confidence
  tightens as photos accumulate.
"""

import math
from dataclasses import dataclass

import numpy as np

GRID = np.linspace(-1.0, 1.0, 401)  # log k: k from 0.37x to 2.7x
PRIOR_SD = 0.15
INITIAL_SD = 0.05  # the pre-monitoring budget is read off by eye
MIN_DOSE = 0.05  # boxes we barely monitored say nothing about the rate
SATURATES_AT = 1.15  # beyond stage 3 the label darkens slowly: read as "at least"
STAGE_INTERVALS = {1: (0.0, 0.25), 2: (0.25, 1.0), 3: (1.0, 1.15), 4: (1.15, math.inf)}
# A camera error shared by every photo (lighting, print, a calibration that is
# slightly off) doesn't average away the way per-photo noise does: it is
# integrated out, so many photos can't make the answer more certain than the
# camera itself allows.
CAMERA_BIAS_SD = 0.02
BIAS_GRID = np.linspace(-3, 3, 13) * CAMERA_BIAS_SD
DEAD_BAND = 0.02  # a learned speed within 2% of the label's is the label's


@dataclass
class Observation:
    initial: float  # budget assumed used before monitoring
    dose: float  # budget our record measured, at the nominal speed
    progress: float | None = None  # camera measurement (confirmed)
    sigma: float = 0.08  # camera error
    stage: int | None = None  # worker-chosen stage instead: an interval


@dataclass
class RatePosterior:
    photos: int  # informative observations
    median: float  # k
    p10: float
    p90: float
    sd_log: float
    scale_used: float  # what the verdict engine applies
    note: str


def _phi(x: np.ndarray) -> np.ndarray:
    """Standard normal CDF."""
    return 0.5 * (1 + np.vectorize(math.erf)(x / math.sqrt(2)))


def log_likelihood(obs: Observation, k: np.ndarray, bias: float = 0.0) -> np.ndarray:
    mu = obs.initial + k * obs.dose
    if obs.stage is not None:
        lo, hi = STAGE_INTERVALS[obs.stage]
        s = math.hypot(INITIAL_SD, 0.05)  # plus fuzz at the stage boundaries
        p = (_phi((hi - mu) / s) if math.isfinite(hi) else 1.0) - _phi((lo - mu) / s)
        return np.log(np.clip(p, 1e-12, None))
    s = math.hypot(obs.sigma, INITIAL_SD)
    mu = mu + bias
    if obs.progress >= SATURATES_AT:
        return np.log(np.clip(1 - _phi((SATURATES_AT - mu) / s), 1e-12, None))
    return -0.5 * ((obs.progress - mu) / s) ** 2


def informative(obs: Observation) -> bool:
    return obs.dose >= MIN_DOSE


def posterior(observations: list[Observation], prior_sd: float = PRIOR_SD) -> RatePosterior:
    used = [o for o in observations if informative(o)]
    k = np.exp(GRID)
    stages = [o for o in used if o.stage is not None]
    camera = [o for o in used if o.stage is None]
    base = -0.5 * (GRID / prior_sd) ** 2 + sum((log_likelihood(o, k) for o in stages), np.zeros_like(GRID))
    # Marginalise the shared camera bias: p(k) = sum_b p(b) prod_i p(obs_i | k, b).
    per_bias = np.array([
        -0.5 * (b / CAMERA_BIAS_SD) ** 2 + sum((log_likelihood(o, k, b) for o in camera), np.zeros_like(GRID))
        for b in BIAS_GRID
    ])
    top = per_bias.max(axis=0)  # log-sum-exp per k, so nothing underflows
    logp = base + top + np.log(np.exp(per_bias - top).sum(axis=0))
    w = np.exp(logp - logp.max())
    w /= w.sum()
    cdf = np.cumsum(w)
    q = lambda p: float(np.exp(np.interp(p, cdf, GRID)))  # noqa: E731
    mean_log = float(np.sum(w * GRID))
    sd_log = float(math.sqrt(np.sum(w * (GRID - mean_log) ** 2)))
    median, p10, p90 = q(0.5), q(0.1), q(0.9)
    if not used:
        scale, note = 1.0, "No confirmed VVM photos yet: using the label's curve as published."
    elif median > 1 + DEAD_BAND:
        scale = median
        note = f"Field photos say this product degrades {median:.2f}x the label's speed; verdicts use that."
    elif p90 < 1:
        scale = p90
        note = f"Field photos say this product is slower than labelled ({median:.2f}x); verdicts use a cautious {p90:.2f}x."
    else:
        scale, note = 1.0, f"Field photos agree with the label's curve ({median:.2f}x, 80% range {p10:.2f} to {p90:.2f})."
    return RatePosterior(
        photos=len(used), median=round(median, 3), p10=round(p10, 3), p90=round(p90, 3),
        sd_log=round(sd_log, 4), scale_used=round(scale, 3), note=note,
    )
