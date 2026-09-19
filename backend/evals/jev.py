"""Does naming the cause actually work?

The backtest builds trips from known facts: this carrier left with packs
straight from the freezer, that one sat in a hot vehicle, this one's ice ran
out. So for every trip we know the true cause, and can ask both the rules and
Jev to name it from the readings alone.

Two things are scored. Accuracy: how often the named cause is the true one.
Calibration: when Jev says 90%, is it right about 90% of the time — because a
probability nobody can trust is worse than no probability at all.

Without TYPESAFE_API_KEY the suite still runs and scores the rules, and says
that Jev was not reached.
"""

import time

import numpy as np

from app.backtest.simulate import ASSUMPTIONS, Trip, Weather, inside_temps
from app.config import get_settings
from app.engine.environment import analyze_leg
from app.engine.profiles import PRODUCTS_BY_ID
from app.services import jev
from evals.core import Metric, SuiteResult

PRODUCT = "opv"
STEP_S = 600  # the simulator's ten-minute step


def _true_cause(trip: Trip, inside: np.ndarray, outside: np.ndarray, storage_max_c: float) -> str | None:
    """What the simulator actually did to this trip, as the readings show it.

    Heat is labelled by which signature dominates, not by whichever fired
    first: on its way up a hot vehicle passes through the outside air's own
    temperature, so a single reading proves nothing. A trip whose heat is a
    tie, or that both froze and cooked, is left out rather than scored against
    one label it was never going to give.
    """
    froze = bool(inside.min() <= 0)
    over = inside > storage_max_c
    own_heat = int(np.count_nonzero(over & (inside > outside + 3)))
    tracking = int(np.count_nonzero(over & (np.abs(inside - outside) <= 4)))

    causes = set()
    if trip.frozen_packs and froze:
        causes.add("unconditioned_packs")
    if own_heat + tracking >= 3:  # a handful of readings, not one stray
        if trip.hot_vehicle and own_heat >= 2 * tracking:
            causes.add("hot_vehicle")
        elif tracking >= 2 * own_heat:
            causes.add("ice_ran_out")
        else:
            return None  # neither signature dominates
    if len(causes) > 1:
        return None
    return causes.pop() if causes else "none"


def _trips(count: int, seed: int = 2026) -> list[tuple[Trip, np.ndarray, np.ndarray, np.ndarray]]:
    """Trips with their inside and outside temperatures, as the backtest runs them."""
    a = {k: v.value for k, v in ASSUMPTIONS.items()}
    weather = Weather()
    rng = np.random.default_rng(seed)
    cells = list(weather.cells)
    day0 = weather.first_day + 86400
    out = []
    for i in range(count):
        hot_vehicle = bool(rng.random() < 0.25)
        trip = Trip(
            depart=int(day0 + (i % 80) * 86400 + rng.uniform(6, 11) * 3600),
            clinic="EVAL",
            cell=cells[int(rng.integers(len(cells)))],
            travel_h=float(max(0.3, rng.uniform(0.5, 3.0))),
            # A carrier with a full load of ice shrugs off a hot vehicle, so a
            # fleet of fresh carriers would never show that cause at all. The
            # hot-vehicle trips are drawn from the worn end of the fleet, which
            # is where it actually bites.
            cold_life_h=float(rng.uniform(2.5, 6.0) if hot_vehicle else rng.uniform(3.0, 14.0)),
            frozen_packs=bool(rng.random() < 0.25),
            hot_vehicle=hot_vehicle,
            carrier=int(rng.integers(8)),
        )
        ts, inside = inside_temps(trip, weather, a)
        outside = weather.at(trip.cell, ts)
        out.append((trip, ts, inside, outside))
    return out


def run(quick: bool = False) -> SuiteResult:
    started = time.perf_counter()
    profile = PRODUCTS_BY_ID[PRODUCT]
    trips = _trips(60 if quick else 360)

    scored = 0
    skipped = 0
    hot_trips = 0
    hot_shown = 0
    rules_right = 0
    jev_right = 0
    jev_asked = 0
    buckets: dict[int, list[int]] = {}
    confusion: dict[str, dict[str, int]] = {}

    for trip, ts, inside, outside in trips:
        truth = _true_cause(trip, inside, outside, profile.storage_max_c)
        hot_trips += trip.hot_vehicle
        hot_shown += truth == "hot_vehicle"
        if truth is None:  # two things wrong at once
            skipped += 1
            continue
        pairs = [(int(t), float(i), float(o)) for t, i, o in zip(ts, inside, outside)]
        env = analyze_leg(pairs, profile.storage_min_c, profile.storage_max_c, "model")
        rules = jev.FROM_RULES.get(env.code, "none")
        coldest = int(np.argmin(inside))
        summary = jev.leg_summary(
            env,
            carrier="Vaccine carrier on a motorbike",
            peak_c=float(inside.max()),
            min_c=float(inside.min()),
            minutes_to_min=coldest * STEP_S / 60,
        )
        answer = jev.likely_cause(summary, env.code)

        scored += 1
        rules_right += rules == truth
        confusion.setdefault(truth, {}).setdefault(answer.cause, 0)
        confusion[truth][answer.cause] += 1
        if answer.source == "jev":
            jev_asked += 1
            hit = answer.cause == truth
            jev_right += hit
            if answer.probability is not None:
                buckets.setdefault(int(answer.probability * 10) * 10, []).append(int(hit))

    rules_acc = rules_right / scored if scored else 0.0
    jev_acc = jev_right / jev_asked if jev_asked else 0.0
    # How far the stated probability is from how often it turns out right.
    gaps = [abs(bucket / 100 + 0.05 - sum(hits) / len(hits)) for bucket, hits in buckets.items() if len(hits) >= 5]
    calibration_gap = sum(gaps) / len(gaps) if gaps else 0.0

    metrics = [
        Metric("The rules name the true cause", rules_acc, 0.7, unit="share"),
        Metric("Trips scored (one cause each)", scored, None, unit="trips"),
        Metric("Trips left out (no single cause the readings show)", skipped, None, unit="trips"),
        Metric("Hot-vehicle trips that leave a mark of their own", hot_shown / hot_trips if hot_trips else 0.0,
               None, unit="share",
               note=("The backtest's hot vehicle adds heat the ice absorbs, so inside rarely runs hotter than "
                     "outside for long. That cause is therefore barely scored here: it is not evidence either "
                     "way about naming it in the field.")),
    ]
    if jev_asked:
        metrics += [
            Metric("Jev names the true cause", jev_acc, 0.7, unit="share"),
            Metric("Its probability matches how often it is right, within", calibration_gap, 0.1,
                   higher_is_better=False, unit="share"),
            Metric("Legs Jev answered", jev_asked, None, unit="legs"),
        ]
    else:
        metrics.append(
            Metric("Legs Jev answered", 0, None, unit="legs",
                   note="No TYPESAFE_API_KEY: the rules answered every leg, which is the fallback the app ships with.")
        )

    return SuiteResult(
        name="jev",
        description="Naming the cause of a trip, against the backtest's own known causes",
        metrics=metrics,
        seconds=time.perf_counter() - started,
        details={
            "asked": bool(get_settings().typesafe_api_key),
            "confusion": confusion,
            "calibration": {str(k): {"n": len(v), "right": sum(v) / len(v)} for k, v in sorted(buckets.items())},
        },
    )


if __name__ == "__main__":
    result = run()
    print(result.name, "-", result.description)
    for m in result.metrics:
        print(f"  {m.name:<52} {m.value:.3f} {m.unit}")
    print("  confusion:", result.details["confusion"])
