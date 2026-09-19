"""Turn a box's stitched history into USE / QUARANTINE / DISCARD.

Deterministic on purpose: the same history always gives the same verdict.
Language models only ever explain the result; they never change it.
"""

import time
from dataclasses import dataclass, field

from app.engine.arrhenius import t_life_hours
from app.engine.history import SegmentResult, Segment, analyze_segment
from app.engine.profiles import (
    FREEZE_ALARM_MINUTES,
    HEAT_ALARM_C,
    HEAT_ALARM_MINUTES,
    HUMIDITY_ADVISORY_MINUTES,
    ProductProfile,
)

DISCARD_AT = 1.0
QUARANTINE_AT = 0.75
USE_FIRST_AT = 0.5
# Heat excursions shorter than this (product time) are noise, not news.
HEAT_REPORT_MIN_MINUTES = 10
# An open segment whose newest reading is older than this is marked provisional.
FRESH_S = 2 * 60

USE, QUARANTINE, DISCARD = "USE", "QUARANTINE", "DISCARD"


@dataclass
class Reason:
    code: str
    severity: str  # "discard" | "quarantine" | "advisory" | "ok"
    text: str


@dataclass
class Report:
    verdict: str
    action: str
    budget_used: float
    budget_remaining: float
    initial_budget_used: float
    reasons: list[Reason]
    segments: list[SegmentResult]
    current_temp_c: float | None
    current_rh: float | None
    hours_left_at_current: float | None
    data_through: int | None
    provisional: bool
    demo_time: bool
    time_scale: float
    computed_at: int = field(default_factory=lambda: int(time.time()))


def fmt_minutes(minutes: float) -> str:
    if minutes < 1:
        return "under a minute"
    if minutes < 120:
        return f"{minutes:.0f} min"
    if minutes < 48 * 60:
        return f"{minutes / 60:.1f} h"
    return f"{minutes / 1440:.1f} days"


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def evaluate(
    profile: ProductProfile,
    segments: list[Segment],
    now: int | None = None,
    initial_budget_used: float = 0.0,
) -> Report:
    now = int(time.time()) if now is None else now
    results = [analyze_segment(profile, s, now) for s in segments]
    budget = initial_budget_used + sum(r.budget_used for r in results)
    reasons: list[Reason] = []
    checks: list[str] = []

    if budget >= DISCARD_AT:
        reasons.append(Reason(
            "BUDGET_EXHAUSTED", "discard",
            f"Heat budget used up ({_pct(budget)}). The {profile.stability_ref} end point has been reached.",
        ))
    elif budget >= QUARANTINE_AT:
        reasons.append(Reason(
            "BUDGET_LOW", "quarantine",
            f"{_pct(budget)} of the heat budget is used, close to the {profile.stability_ref} end point.",
        ))
        checks.append(
            "Check the VVM on each vial" if profile.kind == "vaccine" else "Run a positive control"
        )

    for r in results:
        for run in r.runs:
            if run.kind == "freeze" and run.minutes >= FREEZE_ALARM_MINUTES:
                where = f"{run.extreme:.1f} °C for {fmt_minutes(run.minutes)} in {r.node_label}"
                if profile.freeze_sensitive:
                    reasons.append(Reason("FREEZE", "quarantine", f"Froze: {where}."))
                    checks.append(profile.freeze_check)
                else:
                    reasons.append(Reason(
                        "FREEZE_TOLERATED", "advisory",
                        f"Went below freezing ({where}), but {profile.name} is not freeze-sensitive.",
                    ))
            elif run.kind == "heat" and run.minutes >= HEAT_REPORT_MIN_MINUTES:
                alarm = (
                    profile.kind == "vaccine"
                    and run.extreme >= HEAT_ALARM_C
                    and run.minutes >= HEAT_ALARM_MINUTES
                )
                reasons.append(Reason(
                    "HEAT_ALARM" if alarm else "HEAT_EXCURSION", "advisory",
                    f"Above {profile.storage_max_c:g} °C for {fmt_minutes(run.minutes)} in "
                    f"{r.node_label} (peak {run.extreme:.1f} °C), using {_pct(run.budget_used)} of the budget.",
                ))
            elif (
                run.kind == "humid"
                and profile.kind == "rapid_test"
                and run.minutes >= HUMIDITY_ADVISORY_MINUTES
            ):
                reasons.append(Reason(
                    "HUMIDITY", "advisory",
                    f"Humidity reached {run.extreme:.0f}% for {fmt_minutes(run.minutes)} in "
                    f"{r.node_label}. Check the desiccant indicator in opened pouches.",
                ))
        for gap in r.gaps:
            if gap.ongoing:
                reasons.append(Reason(
                    "NODE_OFFLINE", "quarantine",
                    f"{r.node_label} has not sent data for {fmt_minutes(gap.minutes)}.",
                ))
            else:
                reasons.append(Reason(
                    "HISTORY_GAP", "quarantine",
                    f"No temperature record for {fmt_minutes(gap.minutes)} in {r.node_label}.",
                ))
            checks.append("Ask a supervisor to review the missing temperature record")

    severities = {r.severity for r in reasons}
    if "discard" in severities:
        verdict = DISCARD
        action = "Do not use. Set this box aside for disposal and report it."
    elif "quarantine" in severities:
        verdict = QUARANTINE
        steps = list(dict.fromkeys(checks))
        action = "Hold this box and keep it cold. " + ". ".join(steps) + " before use."
    else:
        verdict = USE
        action = "Safe to use. Use this box first." if budget >= USE_FIRST_AT else "Safe to use."
        if not reasons:
            reasons.append(Reason("ALL_CLEAR", "ok", "Stayed within its safe range the whole time."))

    open_seg = next((r for r in results if r.end_ts is None), None)
    latest = next((r for r in reversed(results) if r.data_through is not None), None)
    source = open_seg or latest
    current_temp = source.last_temp_c if source else None
    current_rh = source.last_rh if source else None
    hours_left = None
    if current_temp is not None:
        hours_left = max(0.0, 1 - budget) * t_life_hours(profile.anchors, current_temp)

    scales = [rd.time_scale for s in segments for rd in s.readings]
    time_scale = max(scales, default=1.0)
    provisional = bool(
        open_seg and open_seg.data_through is not None and now - open_seg.data_through > FRESH_S
    )

    return Report(
        verdict=verdict,
        action=action,
        budget_used=budget,
        budget_remaining=max(0.0, 1 - budget),
        initial_budget_used=initial_budget_used,
        reasons=reasons,
        segments=results,
        current_temp_c=current_temp,
        current_rh=current_rh,
        hours_left_at_current=hours_left,
        data_through=latest.data_through if latest else None,
        provisional=provisional,
        demo_time=time_scale != 1.0,
        time_scale=time_scale,
        computed_at=now,
    )
