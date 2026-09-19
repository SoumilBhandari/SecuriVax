"""Inside vs outside: was it the weather, or the carrier?

For each leg we line the carrier's inside temperature up against the outside
air temperature at the same place and time. That separates the environment
(a hot afternoon) from the equipment (ice packs that ran out, packs that
were frozen solid, a carrier left in the sun) and from plain sensor noise.
None of this changes the verdict; it explains it and feeds the planner.
"""

import statistics
from dataclasses import dataclass, field

from app.engine.profiles import FREEZE_THRESHOLD_C

MIN_SHARE = 0.1  # a pattern must hold for at least this share of the leg


@dataclass
class LegEnvironment:
    code: str  # PROTECTED | TRACKING_AMBIENT | HEAT_SOURCE | FROZEN_PACKS | CALM | NO_DATA
    text: str
    source: str  # open-meteo | model
    ambient_min_c: float | None = None
    ambient_max_c: float | None = None
    inside_mean_c: float | None = None
    ambient_mean_c: float | None = None
    hot_outside_share: float = 0.0
    # Reading-to-reading jitter left after removing the slow trend: the
    # sensor's own noise, as opposed to real temperature change.
    noise_c: float | None = None
    ambient: list[tuple[int, float]] = field(default_factory=list)


def sensor_noise(values: list[float]) -> float | None:
    """Estimate noise from second differences, which cancel slow trends."""
    if len(values) < 5:
        return None
    d2 = [values[i] - (values[i - 1] + values[i + 1]) / 2 for i in range(1, len(values) - 1)]
    # For white noise sigma, var(d2) = 1.5 sigma^2. Median-based so real jumps don't count.
    mad = statistics.median(abs(x) for x in d2) * 1.4826
    return round(mad / 1.5**0.5, 2)


def analyze_leg(
    pairs: list[tuple[int, float, float]], storage_min_c: float, storage_max_c: float, source: str
) -> LegEnvironment:
    """pairs: (ts, inside_c, outside_c) in time order."""
    if len(pairs) < 3:
        return LegEnvironment("NO_DATA", "Not enough readings to compare with the weather.", source)

    inside = [p[1] for p in pairs]
    outside = [p[2] for p in pairs]
    n = len(pairs)

    def share(pred) -> float:
        return sum(1 for _, i, o in pairs if pred(i, o)) / n

    env = LegEnvironment(
        code="CALM", text="", source=source,
        ambient_min_c=min(outside), ambient_max_c=max(outside),
        inside_mean_c=round(statistics.fmean(inside), 1), ambient_mean_c=round(statistics.fmean(outside), 1),
        hot_outside_share=round(share(lambda i, o: o > storage_max_c), 2),
        noise_c=sensor_noise(inside),
    )
    air = f"{env.ambient_min_c:.0f}–{env.ambient_max_c:.0f} °C outside"

    if share(lambda i, o: i <= FREEZE_THRESHOLD_C and o > 5) >= MIN_SHARE / 2:
        env.code = "FROZEN_PACKS"
        env.text = (
            f"It froze inside while it was {air}. The cold came from the carrier, not the weather: "
            "ice packs straight from the freezer. Condition packs until they sweat before packing."
        )
    elif share(lambda i, o: i > storage_max_c and i > o + 3) >= MIN_SHARE:
        peak = max(i - o for _, i, o in pairs)
        env.code = "HEAT_SOURCE"
        env.text = (
            f"It got hotter inside than outside (up to {peak:.0f} °C above the air, {air}): sun on the "
            "carrier, a closed vehicle, a tin roof or an engine. Keep it shaded and ventilated."
        )
    elif share(lambda i, o: i > storage_max_c and abs(i - o) <= 4) >= MIN_SHARE:
        env.code = "TRACKING_AMBIENT"
        env.text = (
            f"Inside followed the outside air ({air}), so the carrier stopped protecting it: "
            "the ice packs ran out or the lid was left open."
        )
    elif env.hot_outside_share >= 0.5 and share(lambda i, o: storage_min_c <= i <= storage_max_c) >= 0.9:
        env.code = "PROTECTED"
        env.text = f"It stayed in range through {air}. The carrier did its job."
    else:
        env.code = "CALM"
        env.text = f"Mild weather ({air}). Nothing here was caused by the environment."
    return env
