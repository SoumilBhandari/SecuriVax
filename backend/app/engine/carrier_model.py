"""A simple thermal model of a passive vaccine carrier, for forecasting.

While the ice lasts, the inside holds at about +5 °C. The ice is a store of
"degree-hours": WHO rates carriers by cold life at a constant +43 °C, so a
carrier rated 20 h holds 20 x (43 - 5) degree-hours. Each hour it spends
max(outside - inside, 0) of them. Once they're gone, the inside drifts to the
outside temperature with time constant tau.

Used to predict a trip from the forecast, and fitted to real legs to see how
a carrier actually performs.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass

from app.engine.profiles import ProductProfile

RATED_AT_C = 43.0
HOLD_C = 5.0
STEP_S = 10 * 60


@dataclass(frozen=True)
class CarrierSpec:
    cold_life_h: float = 20.0  # at +43 C, as rated
    tau_h: float = 1.5
    start_c: float = HOLD_C


def simulate(
    ambient: Callable[[int], float], start: int, end: int, spec: CarrierSpec, step_s: int = STEP_S
) -> list[tuple[int, float]]:
    ice = spec.cold_life_h * (RATED_AT_C - HOLD_C)  # degree-hours
    inside = spec.start_c
    out = [(start, inside)]
    for ts in range(start + step_s, end + step_s, step_s):
        ts = min(ts, end)
        dt_h = (ts - out[-1][0]) / 3600
        outside = ambient(ts)
        if ice > 0:
            ice -= max(outside - HOLD_C, 0.0) * dt_h
            inside = HOLD_C
        else:
            inside += (outside - inside) * (1 - math.exp(-dt_h / spec.tau_h))
        out.append((ts, inside))
        if ts >= end:
            break
    return out


def budget_used(profile: ProductProfile, series: list[tuple[int, float]]) -> float:
    total = 0.0
    for (t0, c0), (t1, c1) in zip(series, series[1:]):
        hours = (t1 - t0) / 3600
        total += hours * 0.5 * (profile.rate(c0) + profile.rate(c1))
    return total


def first_breach(series: list[tuple[int, float]], storage_max_c: float) -> int | None:
    return next((ts for ts, c in series if c > storage_max_c), None)


def effective_cold_life(
    measured: list[tuple[int, float]], ambient: Callable[[int], float], storage_max_c: float
) -> tuple[float | None, str]:
    """How many rated-equivalent hours of cold this carrier really had.

    Compares when the carrier actually first went above the safe range with
    when the model says a carrier of the rated cold life would have.
    Returns (hours, how) where how is "fitted" or "held" (never breached, so
    hours is a lower bound) or "unknown".
    """
    if len(measured) < 3:
        return None, "unknown"
    actual = first_breach(measured, storage_max_c)
    if actual is None:
        # It never warmed up, so it had at least as much ice as it burned.
        burned = sum(
            max(ambient(t0) - HOLD_C, 0.0) * (t1 - t0) / 3600
            for (t0, _), (t1, _) in zip(measured, measured[1:])
        )
        return round(burned / (RATED_AT_C - HOLD_C), 1), "held"
    # Degree-hours of ice spent up to the breach (minus the drift after it).
    burned = sum(
        max(ambient(t0) - HOLD_C, 0.0) * (t1 - t0) / 3600
        for (t0, _), (t1, _) in zip(measured, measured[1:])
        if t1 <= actual
    )
    return round(max(burned, 0.0) / (RATED_AT_C - HOLD_C), 1), "fitted"
