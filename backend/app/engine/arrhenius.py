"""Two-point Arrhenius model: hours of life left at a constant temperature."""

import math

KELVIN = 273.15
GAS_CONSTANT = 8.314  # J / (mol K)

Anchors = tuple[tuple[float, float], tuple[float, float]]


def _slope(anchors: Anchors) -> float:
    """b in ln(t) = a + b / T, fitted through both anchors."""
    (c1, h1), (c2, h2) = anchors
    return math.log(h1 / h2) / (1 / (c1 + KELVIN) - 1 / (c2 + KELVIN))


def t_life_hours(anchors: Anchors, temp_c: float) -> float:
    """Hours until the whole budget is used if held at temp_c."""
    (c1, h1), _ = anchors
    return h1 * math.exp(_slope(anchors) * (1 / (temp_c + KELVIN) - 1 / (c1 + KELVIN)))


def rate_per_hour(anchors: Anchors, temp_c: float) -> float:
    """Fraction of the budget used per hour at temp_c."""
    return 1.0 / t_life_hours(anchors, temp_c)


def activation_energy_kj(anchors: Anchors) -> float:
    return _slope(anchors) * GAS_CONSTANT / 1000
