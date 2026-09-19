"""How sure is the verdict? Monte Carlo over what we don't know exactly.

The verdict itself is computed from the point estimate. Here we ask how
often it would come out the same if the inputs were a little different:

- the sensor's calibration is off by a fixed bias (SHT31: about ±0.2 °C),
- this batch degrades a bit faster or slower than its VVM category's nominal curve,
- the budget used before our monitoring was read off by eye.

A verdict that survives 95% of those worlds is solid. One that flips in 40%
of them is borderline, so we ask the health worker to check the VVM label
with the camera (the second witness).
"""

from dataclasses import dataclass

import numpy as np

from app.engine.arrhenius import KELVIN, _slope
from app.engine.history import MAX_GAP_S, Segment
from app.engine.profiles import FREEZE_ALARM_MINUTES, FREEZE_THRESHOLD_C, ProductProfile
from app.engine.verdict import DISCARD_AT, QUARANTINE_AT

SENSOR_BIAS_C = 0.2
RATE_SPREAD = 0.15  # lognormal sigma on the degradation rate
INITIAL_SPREAD = 0.05
SAMPLES = 400
BORDERLINE_BELOW = 0.8


@dataclass
class Confidence:
    confidence: float  # share of samples that agree with the verdict
    p_use: float
    p_quarantine: float
    p_discard: float
    budget_p10: float
    budget_p50: float
    budget_p90: float
    borderline: bool
    samples: int


def _rates(profile: ProductProfile, temps: np.ndarray) -> np.ndarray:
    (c1, h1), _ = profile.anchors
    return np.exp(-_slope(profile.anchors) * (1 / (temps + KELVIN) - 1 / (c1 + KELVIN))) / h1


def verdict_confidence(
    profile: ProductProfile,
    segments: list[Segment],
    initial_budget: float,
    point_verdict: str,
    forced_quarantine: bool,
    seed: int = 3,
) -> Confidence:
    """forced_quarantine: gaps or offline nodes, which no sensor bias can explain away."""
    rng = np.random.default_rng(seed)
    bias = rng.normal(0, SENSOR_BIAS_C, SAMPLES)
    rate_mult = np.exp(rng.normal(0, RATE_SPREAD, SAMPLES))
    budget = np.clip(initial_budget + rng.normal(0, INITIAL_SPREAD, SAMPLES), 0, None)
    froze = np.zeros(SAMPLES, dtype=bool)

    for seg in segments:
        pts = sorted((r.ts, r.temp_c, r.time_scale) for r in seg.readings if r.ts >= seg.start_ts - MAX_GAP_S)
        if seg.end_ts is not None:
            pts = [p for p in pts if p[0] <= seg.end_ts]
        if len(pts) < 2:
            continue
        ts = np.array([p[0] for p in pts], dtype=float)
        temps = np.array([p[1] for p in pts])
        scale = np.array([p[2] for p in pts])
        ts = np.maximum(ts, seg.start_ts)
        dt = np.diff(ts)
        ok = (dt > 0) & (dt <= MAX_GAP_S)
        hours = dt / 3600 * scale[:-1] * ok
        shifted = temps[None, :] + bias[:, None]  # (samples, points)
        r = _rates(profile, shifted)
        budget += rate_mult * np.sum(hours[None, :] * 0.5 * (r[:, :-1] + r[:, 1:]), axis=1)
        if profile.freeze_sensitive:
            cold = shifted[:, :-1] <= FREEZE_THRESHOLD_C
            minutes = hours * 60
            # Longest continuous cold run, per sample.
            run = np.zeros(SAMPLES)
            longest = np.zeros(SAMPLES)
            for j in range(cold.shape[1]):
                run = np.where(cold[:, j] & ok[j], run + minutes[j], 0)
                longest = np.maximum(longest, run)
            froze |= longest >= FREEZE_ALARM_MINUTES

    discard = budget >= DISCARD_AT
    quarantine = ~discard & (froze | (budget >= QUARANTINE_AT) | forced_quarantine)
    use = ~discard & ~quarantine
    agree = {"DISCARD": discard, "QUARANTINE": quarantine, "USE": use}[point_verdict]
    q10, q50, q90 = np.percentile(budget, [10, 50, 90])
    conf = float(agree.mean())
    return Confidence(
        confidence=round(conf, 3),
        p_use=round(float(use.mean()), 3),
        p_quarantine=round(float(quarantine.mean()), 3),
        p_discard=round(float(discard.mean()), 3),
        budget_p10=round(float(q10), 4),
        budget_p50=round(float(q50), 4),
        budget_p90=round(float(q90), 4),
        borderline=conf < BORDERLINE_BELOW,
        samples=SAMPLES,
    )
