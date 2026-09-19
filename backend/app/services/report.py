"""Load a box's custody + readings from the database and run the engine."""

import time
from dataclasses import asdict

from sqlmodel import Session, select

from collections import Counter

from app.engine import history
from app.engine.location import MAX_INTERPOLATE_S, attach_positions
from app.engine.profiles import PRODUCTS_BY_ID, sensor_spec
from app.engine.redundancy import merge
from app.engine.verdict import LabelCheck, Report, evaluate
from app.models import Box, Custody, LocationPoint, Node, Reading, TextCache, VvmCheck

# Enough to draw a route; excursion points are always kept.
MAX_ROUTE_POINTS = 400


def place_key(lat: float, lon: float) -> str:
    """~100 m buckets, so nearby points share one place name."""
    return f"place:{lat:.3f},{lon:.3f}"


def _node_readings(session: Session, node_id: str, start: int, end: int) -> list[history.Reading]:
    rows = session.exec(
        select(Reading)
        .where(Reading.node_id == node_id, Reading.ts >= start, Reading.ts <= end)
        .order_by(Reading.ts)
    ).all()
    return [history.Reading(r.ts, r.temp_c, r.rh, r.lat, r.lon, r.time_scale) for r in rows]


def box_segments(session: Session, box_id: str, now: int) -> list[history.Segment]:
    custodies = session.exec(
        select(Custody).where(Custody.box_id == box_id).order_by(Custody.start_ts)
    ).all()
    segments = []
    for c in custodies:
        node = session.get(Node, c.node_id)
        start, end = c.start_ts - history.MAX_GAP_S, c.end_ts if c.end_ts is not None else now
        readings = _node_readings(session, c.node_id, start, end)

        # A backup node in the same carrier covers for the primary.
        backup = session.exec(select(Node).where(Node.backup_for == c.node_id)).first()
        merged = None
        if backup:
            merged = merge(readings, _node_readings(session, backup.id, start, end))
            readings = merged.readings

        # Position comes from the carrier's tracker when the node has no GPS.
        points = session.exec(
            select(LocationPoint).where(
                LocationPoint.node_id == c.node_id,
                LocationPoint.ts >= start - MAX_INTERPOLATE_S,
                LocationPoint.ts <= end + MAX_INTERPOLATE_S,
            )
        ).all()
        located_by = Counter(p.source for p in points).most_common(1)[0][0] if points else None
        readings = attach_positions(readings, [(p.ts, p.lat, p.lon) for p in points])
        if located_by is None and any(r.lat is not None for r in readings):
            located_by = "gps"

        segments.append(history.Segment(
            c.node_id, node.label if node else c.node_id, c.start_ts, c.end_ts, readings,
            backup_label=backup.label if backup else None,
            backup_filled=merged.backup_filled if merged else 0,
            max_disagreement_c=merged.max_disagreement_c if merged and merged.pairs >= 3 else None,
            located_by=located_by,
            # Merged readings are only as trustworthy as the coarser of the two sensors.
            sensor=max((n.sensor for n in (node, backup) if n), key=lambda s: sensor_spec(s).sigma_c, default=None),
        ))
    return segments


def latest_label(session: Session, box_id: str) -> VvmCheck | None:
    return session.exec(
        select(VvmCheck).where(VvmCheck.box_id == box_id, VvmCheck.confirmed).order_by(VvmCheck.ts.desc())
    ).first()


def _label(check: VvmCheck | None) -> LabelCheck | None:
    return LabelCheck(check.ts, check.progress, check.past_endpoint) if check else None


def _label_evidence(check: VvmCheck | None, budget_now: float) -> dict:
    """A confirmed label that agreed with the record, brought forward to now by
    the heat recorded since the photo: evidence for the confidence Monte Carlo."""
    from app.engine.vvm import CALIBRATION

    if check is None or not check.confirmed or check.flagged or check.past_endpoint:
        return {}
    since = max(0.0, budget_now - check.sensor_budget)
    sigma = 0.15 if check.worker_stage is not None else CALIBRATION.progress_sigma  # by eye vs camera
    return {"label_progress": check.progress + since, "label_sigma": sigma}


def evaluate_box(session: Session, box: Box, now: int | None = None) -> Report:
    from app.services.learning import profile_for

    now = int(time.time()) if now is None else now
    profile = profile_for(session, box.product_id)
    label = _label(latest_label(session, box.id))
    return evaluate(profile, box_segments(session, box.id, now), now, box.initial_budget_used, label)


def _thin(points: list[dict], keep_if=lambda p: False) -> list[dict]:
    """At most MAX_ROUTE_POINTS: an even sample, plus the flagged points (which are
    themselves thinned if a long hot spell would otherwise blow the budget)."""
    if len(points) <= MAX_ROUTE_POINTS:
        return points
    flagged = [i for i, p in enumerate(points) if keep_if(p)]
    if len(flagged) > MAX_ROUTE_POINTS // 2:
        stride = len(flagged) / (MAX_ROUTE_POINTS // 2)
        flagged = [flagged[round(k * stride)] for k in range(MAX_ROUTE_POINTS // 2)]
    step = len(points) / MAX_ROUTE_POINTS
    keep = {round(i * step) for i in range(MAX_ROUTE_POINTS)} | {len(points) - 1} | set(flagged)
    return [p for i, p in enumerate(points) if i in keep]


def key_points(report: Report) -> list[tuple[float, float]]:
    """Places worth naming: handoffs and where things went wrong."""
    points = []
    for s in report.segments:
        for lat, lon in ((s.start_lat, s.start_lon), (s.end_lat, s.end_lon)):
            if lat is not None:
                points.append((lat, lon))
        for run in s.runs:
            if run.lat is not None:
                points.append((run.lat, run.lon))
    return list(dict.fromkeys(points))


def cached_places(session: Session, points: list[tuple[float, float]]) -> dict[str, str]:
    places = {}
    for lat, lon in points:
        cached = session.get(TextCache, place_key(lat, lon))
        if cached:
            places[place_key(lat, lon)] = cached.text
    return places


def report_json(session: Session, box: Box, now: int | None = None) -> dict:
    from app.engine.uncertainty import verdict_confidence
    from app.services.learning import profile_for, rate_posterior

    now = int(time.time()) if now is None else now
    profile = profile_for(session, box.product_id)
    learned = rate_posterior(session, box.product_id)
    segments = box_segments(session, box.id, now)
    check = latest_label(session, box.id)
    report = evaluate(profile, segments, now, box.initial_budget_used, _label(check))
    data = asdict(report)
    forced = any(r.code in ("HISTORY_GAP", "NODE_OFFLINE", "VVM_NEAR_ENDPOINT") for r in report.reasons)
    confidence = verdict_confidence(
        profile, segments, box.initial_budget_used, report.verdict, forced, now=now, rate_spread=learned.sd_log,
        **_label_evidence(check, report.budget_used),
    )
    if check and check.past_endpoint:  # a person confirmed the label: no sensor doubt applies
        confidence.confidence, confidence.p_discard, confidence.borderline = 1.0, 1.0, False
    data["confidence"] = asdict(confidence)
    data["label_check"] = check.model_dump() if check else None
    data["learned_rate"] = asdict(learned)
    from app.services.climate import leg_environment  # avoids an import cycle

    carried = box.initial_budget_used  # budget already used when each leg starts
    for seg, result in zip(data["segments"], report.segments):
        seg["environment"] = asdict(leg_environment(result, PRODUCTS_BY_ID[box.product_id]))
        seg["route"] = _thin(seg["route"], lambda p: p["status"] != "ok")
        for point in seg["series"]:
            point["budget"] = round(carried + point["budget"], 5)  # box-level, for the scrubber
        carried += result.budget_used
        seg["series"] = _thin(seg["series"])
    open_seg = next((s for s in report.segments if s.end_ts is None), None)
    data["box"] = box.model_dump()
    data["product"] = {**asdict(profile), "has_vvm": profile.has_vvm}
    data["current_node_id"] = open_seg.node_id if open_seg else None
    data["places"] = cached_places(session, key_points(report))
    return data



def counterfactual(session: Session, box: Box, now: int | None = None) -> list[dict]:
    """The same thermal history, run through every product profile: stability
    is product-specific, so the verdict changes with what's in the box."""
    from app.engine.profiles import PRODUCTS
    from app.services.learning import profile_for

    now = int(time.time()) if now is None else now
    segments = box_segments(session, box.id, now)
    out = []
    for profile in PRODUCTS:
        r = evaluate(profile_for(session, profile.id), segments, now, 0.0)
        out.append({
            "product_id": profile.id, "name": profile.name, "stability_ref": profile.stability_ref,
            "budget_used": round(r.budget_used, 4), "verdict": r.verdict,
            "this_box": profile.id == box.product_id,
        })
    return out
