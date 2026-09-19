"""How sure is the verdict? Monte Carlo over what we don't know exactly.

The verdict itself is computed from the point estimate. Here we ask how
often it would come out the same if the inputs were a little different:

- the sensor's calibration is off by a fixed bias (SHT31: about ±0.2 °C),
- this batch degrades a bit faster or slower than its VVM category's nominal curve,
- the budget used before our monitoring was read off by eye.

A verdict that survives 95% of those worlds is solid. One that flips in 40%
of them is borderline, so we ask the health worker to check the VVM label
with the camera (the second witness).

Once a confirmed label reading exists (and agrees with the record), the two
witnesses are fused: each simulated world is weighted by how well its budget
matches what the label showed, so the label narrows what we don't know.
"""

from dataclasses import dataclass

import numpy as np

from app.engine.arrhenius import KELVIN, _slope
from app.engine.history import MAX_GAP_S, Segment, integration_points
from app.engine.profiles import FREEZE_ALARM_MINUTES, FREEZE_GUARD_C, FREEZE_THRESHOLD_C, ProductProfile
from app.engine.verdict import DISCARD_AT, QUARANTINE_AT, USE_FIRST_AT

SENSOR_BIAS_C = 0.2
RATE_SPREAD = 0.15  # lognormal sigma on the degradation rate
INITIAL_SPREAD = 0.05
SAMPLES = 400
BORDERLINE_BELOW = 0.8


@dataclass
class Confidence:
    confidence: float  # share of samples that agree with the verdict
    p_use: float  # USE or USE_FIRST
    p_use_first: float
    p_quarantine: float
    p_discard: float
    budget_p10: float
    budget_p50: float
    budget_p90: float
    borderline: bool
    samples: int
    label_fused: bool = False  # a confirmed VVM reading narrowed the worlds


def _rates(profile: ProductProfile, temps: np.ndarray) -> np.ndarray:
    (c1, h1), _ = profile.anchors
    return profile.rate_scale * np.exp(-_slope(profile.anchors) * (1 / (temps + KELVIN) - 1 / (c1 + KELVIN))) / h1


def _weighted_quantiles(values: np.ndarray, weights: np.ndarray, qs) -> list[float]:
    order = np.argsort(values)
    cdf = np.cumsum(weights[order])
    cdf /= cdf[-1]
    return [float(np.interp(q, cdf, values[order])) for q in qs]


LABEL_SATURATES = 1.2  # beyond this a label can't tell more heat apart


def _longest_runs(cold: np.ndarray, minutes: np.ndarray, ok: np.ndarray) -> np.ndarray:
    """Longest continuous run (product minutes) of intervals flagged cold, per sample.
    A zero-length interval (duplicate timestamp) neither adds to nor breaks a run;
    a gap breaks it, exactly as in the engine."""
    run = np.zeros(cold.shape[0])
    longest = np.zeros(cold.shape[0])
    for j in range(cold.shape[1]):
        if minutes[j] == 0 and ok[j]:
            continue
        run = np.where(cold[:, j] & ok[j], run + minutes[j], 0)
        longest = np.maximum(longest, run)
    return longest


def verdict_confidence(
    profile: ProductProfile,
    segments: list[Segment],
    initial_budget: float,
    point_verdict: str,
    forced_quarantine: bool,
    seed: int = 3,
    now: int | None = None,
    samples: int = SAMPLES,
    bias_c: float = SENSOR_BIAS_C,
    rate_spread: float = RATE_SPREAD,
    initial_spread: float = INITIAL_SPREAD,
    label_progress: float | None = None,
    label_sigma: float = 0.08,
) -> Confidence:
    """forced_quarantine: gaps or offline nodes, which no sensor bias can explain away.
    label_progress: a confirmed VVM reading, brought forward to now."""
    import time as _time

    now = int(_time.time()) if now is None else now
    rng = np.random.default_rng(seed)
    bias = rng.normal(0, bias_c, samples) if bias_c else np.zeros(samples)
    rate_mult = np.exp(rng.normal(0, rate_spread, samples)) if rate_spread else np.ones(samples)
    budget = np.clip(initial_budget + (rng.normal(0, initial_spread, samples) if initial_spread else 0.0), 0, None)
    froze = np.zeros(samples, dtype=bool)
    near = np.zeros(samples, dtype=bool)

    for seg in segments:
        pts = integration_points(seg, now)
        if len(pts) < 2:
            continue
        ts = np.array([p.ts for p in pts], dtype=float)
        temps = np.array([p.temp_c for p in pts])
        scale = np.array([p.time_scale for p in pts])
        dt = np.diff(ts)
        ok = (dt >= 0) & (dt <= MAX_GAP_S)
        hours = dt / 3600 * scale[:-1] * ok
        shifted = temps[None, :] + bias[:, None]  # (samples, points)
        r = _rates(profile, shifted)
        budget += rate_mult * np.sum(hours[None, :] * 0.5 * (r[:, :-1] + r[:, 1:]), axis=1)
        if profile.freeze_sensitive:
            minutes = hours * 60
            froze |= _longest_runs(shifted[:, :-1] <= FREEZE_THRESHOLD_C, minutes, ok) >= FREEZE_ALARM_MINUTES
            near |= _longest_runs(shifted[:, :-1] <= FREEZE_GUARD_C, minutes, ok) >= FREEZE_ALARM_MINUTES

    discard = budget >= DISCARD_AT
    quarantine = ~discard & (froze | near | (budget >= QUARANTINE_AT) | forced_quarantine)
    use = ~discard & ~quarantine
    use_first = use & (budget >= USE_FIRST_AT)
    agree = {"DISCARD": discard, "QUARANTINE": quarantine, "USE_FIRST": use_first, "USE": use & ~use_first}[point_verdict]

    w = np.full(samples, 1 / samples)
    fused = False
    if label_progress is not None:
        cap = LABEL_SATURATES
        lw = np.exp(-0.5 * ((np.minimum(budget, cap) - min(label_progress, cap)) / label_sigma) ** 2)
        # Fuse only if the label sits inside the worlds we simulated; if it
        # doesn't, the witnesses disagree and the cross-check has flagged it.
        if lw.sum() > 0 and lw.sum() ** 2 / (lw**2).sum() >= 0.05 * samples:
            w, fused = lw / lw.sum(), True
    q10, q50, q90 = _weighted_quantiles(budget, w, (0.1, 0.5, 0.9))
    conf = float(np.sum(w * agree))
    return Confidence(
        confidence=round(conf, 3),
        p_use=round(float(np.sum(w * use)), 3),
        p_use_first=round(float(np.sum(w * use_first)), 3),
        p_quarantine=round(float(np.sum(w * quarantine)), 3),
        p_discard=round(float(np.sum(w * discard)), 3),
        budget_p10=round(float(q10), 4),
        budget_p50=round(float(q50), 4),
        budget_p90=round(float(q90), 4),
        borderline=conf < BORDERLINE_BELOW,
        samples=samples,
        label_fused=fused,
    )
