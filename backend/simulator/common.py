"""Shared bits for the simulator and the demo backfill: routes and weather."""

import math
import random

# Approximate waypoints: Kisumu district vaccine store -> Kombewa, west along
# the Kisumu-Bondo road. Good enough to draw a believable route on the map.
KISUMU_TO_KOMBEWA = [
    (-0.0917, 34.7680),
    (-0.0858, 34.7310),
    (-0.0797, 34.6930),
    (-0.0902, 34.6420),
    (-0.0990, 34.5890),
    (-0.1035, 34.5520),
    (-0.1037, 34.5170),
]
KOMBEWA = KISUMU_TO_KOMBEWA[-1]
KISUMU_STORE = KISUMU_TO_KOMBEWA[0]


def along(route: list[tuple[float, float]], frac: float, jitter: float = 0.0002) -> tuple[float, float]:
    """Position a fraction of the way along a polyline, with GPS-ish noise."""
    frac = min(max(frac, 0.0), 1.0)
    legs = [math.dist(a, b) for a, b in zip(route, route[1:])]
    target = frac * sum(legs)
    for (a, b), length in zip(zip(route, route[1:]), legs):
        if target <= length or length == 0:
            f = target / length if length else 0
            lat = a[0] + (b[0] - a[0]) * f
            lon = a[1] + (b[1] - a[1]) * f
            break
        target -= length
    else:
        lat, lon = route[-1]
    return lat + random.uniform(-jitter, jitter), lon + random.uniform(-jitter, jitter)


def cold_box_temp(t: float) -> float:
    """A well-packed carrier: 4-6 C with a slow wobble."""
    return 5.0 + 0.8 * math.sin(t / 1800) + random.gauss(0, 0.15)


def ambient_temp(t: float, low: float = 22.0, high: float = 34.0) -> float:
    """Daily cycle peaking mid-afternoon (t in UTC seconds; Kenya is UTC+3)."""
    hour = ((t / 3600) + 3) % 24
    phase = math.cos((hour - 15) / 24 * 2 * math.pi)
    return low + (high - low) * (phase + 1) / 2 + random.gauss(0, 0.3)


def ambient_rh(t: float) -> float:
    """Humid nights, drier afternoons."""
    hour = ((t / 3600) + 3) % 24
    return 70 + 15 * math.cos((hour - 4) / 24 * 2 * math.pi) + random.gauss(0, 2)
