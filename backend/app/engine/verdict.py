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
# Two sensors in one carrier further apart than this: one of them is wrong.
DISAGREE_C = 2.0
# Below 0 C this soon after packing means unconditioned ice packs: warn before the box freezes.
PACK_CHECK_S = 45 * 60
# An open segment whose newest reading is older than this is marked provisional.
FRESH_S = 2 * 60

USE, QUARANTINE, DISCARD = "USE", "QUARANTINE", "DISCARD"


@dataclass
class Reason:
    code: str
    severity: str  # "discard" | "quarantine" | "advisory" | "ok"
    text: str


@dataclass
class LabelCheck:
    """A confirmed camera reading of the vial's VVM label."""

    ts: int
    progress: float
    past_endpoint: bool


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


def _how_long(runs: list) -> str:
    total = fmt_minutes(sum(x.minutes for x in runs))
    return f"for {total}" if len(runs) == 1 else f"{len(runs)} times, {total} in all,"


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def evaluate(
    profile: ProductProfile,
    segments: list[Segment],
    now: int | None = None,
    initial_budget_used: float = 0.0,
    label: LabelCheck | None = None,
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

    for seg, r in zip(segments, results):
        early = [rd.temp_c for rd in seg.readings if seg.start_ts <= rd.ts <= seg.start_ts + PACK_CHECK_S]
        if seg.end_ts is None and early and min(early) <= 0.0:
            reasons.append(Reason(
                "PACKS_TOO_COLD", "advisory",
                f"{r.node_label} dropped to {min(early):.1f} °C right after packing: the ice packs weren't "
                "conditioned. Take them out until they sweat, before the vaccines freeze.",
            ))
        freezes = [x for x in r.runs if x.kind == "freeze" and x.minutes >= FREEZE_ALARM_MINUTES]
        heats = [x for x in r.runs if x.kind == "heat" and x.minutes >= HEAT_REPORT_MIN_MINUTES]
        humids = [x for x in r.runs if x.kind == "humid" and x.minutes >= HUMIDITY_ADVISORY_MINUTES]
        if freezes:
            where = f"{min(x.extreme for x in freezes):.1f} °C {_how_long(freezes)} in {r.node_label}"
            if profile.freeze_sensitive:
                reasons.append(Reason("FREEZE", "quarantine", f"Froze: {where}."))
                checks.append(profile.freeze_check)
            else:
                reasons.append(Reason(
                    "FREEZE_TOLERATED", "advisory",
                    f"Went below freezing ({where}), but {profile.name} is not freeze-sensitive.",
                ))
        if heats:
            alarm = profile.kind == "vaccine" and any(
                x.extreme >= HEAT_ALARM_C and x.minutes >= HEAT_ALARM_MINUTES for x in heats
            )
            reasons.append(Reason(
                "HEAT_ALARM" if alarm else "HEAT_EXCURSION", "advisory",
                f"Above {profile.storage_max_c:g} °C {_how_long(heats)} in {r.node_label} "
                f"(peak {max(x.extreme for x in heats):.1f} °C), using "
                f"{_pct(sum(x.budget_used for x in heats))} of the budget.",
            ))
        if humids and profile.kind == "rapid_test":
            reasons.append(Reason(
                "HUMIDITY", "advisory",
                f"Humidity reached {max(x.extreme for x in humids):.0f}% {_how_long(humids)} in "
                f"{r.node_label}. Check the desiccant indicator in opened pouches.",
            ))
        if r.backup_filled:
            reasons.append(Reason(
                "BACKUP_USED", "advisory",
                f"{r.node_label} went quiet; {r.backup_filled} readings came from its backup {r.backup_label}.",
            ))
        if r.max_disagreement_c is not None and r.max_disagreement_c > DISAGREE_C:
            reasons.append(Reason(
                "SENSOR_DISAGREE", "advisory",
                f"{r.node_label} and its backup {r.backup_label} disagree by up to "
                f"{r.max_disagreement_c:.1f} °C. Check both sensors.",
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

    # The second witness: the vial's own VVM, read by the camera and confirmed
    # by a person. WHO practice is that a VVM at its discard point means discard,
    # whatever else says; otherwise the more cautious witness decides.
    if label is not None:
        if label.past_endpoint:
            reasons.insert(0, Reason(
                "VVM_PAST_ENDPOINT", "discard",
                f"The vial's VVM is at its discard point (camera {label.progress * 100:.0f}%, confirmed).",
            ))
        elif label.progress >= QUARANTINE_AT and budget < QUARANTINE_AT:
            reasons.insert(0, Reason(
                "VVM_NEAR_ENDPOINT", "quarantine",
                f"The vial's VVM is close to its discard point (camera {label.progress * 100:.0f}%).",
            ))
            checks.append("Compare every vial's VVM before use")

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
        open_seg and (open_seg.data_through is None or now - open_seg.data_through > FRESH_S)
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
