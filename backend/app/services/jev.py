"""The likely cause of a leg's temperature pattern, named by Jev.

The rules decide what is safe; this only says what most likely went wrong, so
a health worker and a supervisor can fix it before the next trip. Nothing here
can move a verdict: `likely_cause` is called after the engine has decided, its
answer is carried beside the verdict, and every failure falls back to the cause
the rules already worked out in `app.engine.environment`.

Needs TYPESAFE_API_KEY. Without one, or if the call is slow or fails, the
rules' own answer is returned with `source="rules"` and the page reads the
same, only without a probability.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from threading import Lock

from app.config import get_settings

log = logging.getLogger(__name__)

# What Jev chooses between, and how each one looks in a carrier's readings.
CAUSES: dict[str, str] = {
    "unconditioned_packs": "Froze soon after packing while it was warm outside",
    "ice_ran_out": "Warmed steadily toward the outside air late in the trip",
    "hot_vehicle": "Hotter inside than the outside air: sun, closed car, engine",
    "lid_open": "Short warm spikes that recover",
    "sensor_fault": "Jumps or flat lines no real carrier could produce",
    "none": "Stayed in range",
}

# What to say on the page for each cause.
LABELS: dict[str, str] = {
    "unconditioned_packs": "ice packs straight from the freezer",
    "ice_ran_out": "the ice ran out before the end of the trip",
    "hot_vehicle": "sun or a closed vehicle heating the carrier",
    "lid_open": "the lid opened on the way",
    "sensor_fault": "the sensor, not the carrier",
    "none": "nothing: it stayed in range",
}

# The rules' own reading of the same leg (app/engine/environment.py), which is
# both the fallback and the way a leg with nothing to explain skips the call.
FROM_RULES: dict[str, str] = {
    "FROZEN_PACKS": "unconditioned_packs",
    "TRACKING_AMBIENT": "ice_ran_out",
    "HEAT_SOURCE": "hot_vehicle",
    "PROTECTED": "none",
    "CALM": "none",
}

TIMEOUT_S = 1.5
MODEL = "jev-latest"


@dataclass
class Cause:
    """What most likely happened on a leg, and how sure of it we are."""

    cause: str
    label: str
    source: str  # jev | rules
    probability: float | None = None
    confidence: float | None = None
    ms: int | None = None
    probabilities: dict[str, float] = field(default_factory=dict)


def _rules(code: str) -> Cause:
    cause = FROM_RULES.get(code, "none")
    return Cause(cause=cause, label=LABELS[cause], source="rules")


_client = None
_lock = Lock()
_cache: dict[str, Cause] = {}


def _client_once():
    """One client for the process, built on first use. None when it can't be."""
    global _client
    if _client is not None:
        return _client
    key = get_settings().typesafe_api_key
    if not key:
        return None
    with _lock:
        if _client is None:
            from typesafe_sdk import TypeSafeClient  # kept out of import time: optional dependency

            _client = TypeSafeClient(api_key=key, model=MODEL, timeout=TIMEOUT_S)
    return _client


def likely_cause(leg_summary: str, rules_code: str) -> Cause:
    """Ask Jev what caused this leg's pattern; the rules' answer if it can't say.

    `leg_summary` is the leg's own numbers written as a sentence; `rules_code`
    is what `analyze_leg` made of the same leg.
    """
    fallback = _rules(rules_code)
    # A leg that stayed in range has nothing to name, and asking costs a call.
    if fallback.cause == "none" or not leg_summary:
        return fallback

    hit = _cache.get(leg_summary)
    if hit is not None:
        return hit

    client = _client_once()
    if client is None:
        return fallback

    started = time.perf_counter()
    try:
        from typesafe_sdk import Choice

        answer = client.system_one(
            state=leg_summary,
            questions={
                "cause": Choice(
                    instructions="What most likely caused this vaccine carrier's temperature pattern?",
                    criteria=CAUSES,
                )
            },
        ).answers["cause"]
        chosen = str(answer.choice)
        if chosen not in CAUSES:  # a model that answers off the list is no use here
            raise ValueError(f"unknown cause {chosen!r}")
        probabilities = {str(k): round(float(v), 3) for k, v in dict(answer.probabilities or {}).items()}
        cause = Cause(
            cause=chosen,
            label=LABELS[chosen],
            source="jev",
            probability=probabilities.get(chosen),
            confidence=round(float(answer.confidence), 3) if answer.confidence is not None else None,
            ms=round((time.perf_counter() - started) * 1000),
            probabilities=probabilities,
        )
    except Exception as exc:  # never let naming a cause touch the answer
        log.info("jev: falling back to the rules (%s)", exc)
        return fallback

    _cache[leg_summary] = cause
    return cause


def leg_summary(env, *, carrier: str, peak_c: float | None, min_c: float | None, minutes_to_min: float | None) -> str:
    """The leg's own numbers as a sentence, which is what Jev reads."""
    if env is None or env.code == "NO_DATA":
        return ""
    bits = [f"{carrier}."]
    if min_c is not None and minutes_to_min is not None and min_c <= 0:
        bits.append(f"Fell to {min_c:.1f} °C within {minutes_to_min:.0f} min of packing.")
    elif min_c is not None:
        bits.append(f"Coldest {min_c:.1f} °C.")
    if peak_c is not None:
        bits.append(f"Peaked at {peak_c:.1f} °C.")
    if env.inside_mean_c is not None and env.ambient_mean_c is not None:
        bits.append(f"Averaged {env.inside_mean_c:.1f} °C inside against {env.ambient_mean_c:.1f} °C outside.")
    if env.ambient_min_c is not None and env.ambient_max_c is not None:
        bits.append(f"Outside ran {env.ambient_min_c:.0f}–{env.ambient_max_c:.0f} °C.")
    if env.hot_outside_share:
        bits.append(f"It was above the product's range outside for {env.hot_outside_share * 100:.0f}% of the leg.")
    if env.noise_c is not None:
        bits.append(f"Reading-to-reading noise {env.noise_c:.2f} °C.")
    return " ".join(bits)
