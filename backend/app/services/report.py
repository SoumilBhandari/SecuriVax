"""Load a box's custody + readings from the database and run the engine."""

import time
from dataclasses import asdict

from sqlmodel import Session, select

from app.engine import history
from app.engine.profiles import PRODUCTS_BY_ID
from app.engine.verdict import Report, evaluate
from app.models import Box, Custody, Node, Reading, TextCache

# Enough to draw a route; excursion points are always kept.
MAX_ROUTE_POINTS = 400


def place_key(lat: float, lon: float) -> str:
    """~100 m buckets, so nearby points share one place name."""
    return f"place:{lat:.3f},{lon:.3f}"


def box_segments(session: Session, box_id: str, now: int) -> list[history.Segment]:
    custodies = session.exec(
        select(Custody).where(Custody.box_id == box_id).order_by(Custody.start_ts)
    ).all()
    segments = []
    for c in custodies:
        node = session.get(Node, c.node_id)
        end = c.end_ts if c.end_ts is not None else now
        rows = session.exec(
            select(Reading)
            .where(
                Reading.node_id == c.node_id,
                Reading.ts >= c.start_ts - history.MAX_GAP_S,
                Reading.ts <= end,
            )
            .order_by(Reading.ts)
        ).all()
        readings = [
            history.Reading(r.ts, r.temp_c, r.rh, r.lat, r.lon, r.time_scale) for r in rows
        ]
        segments.append(history.Segment(c.node_id, node.label if node else c.node_id, c.start_ts, c.end_ts, readings))
    return segments


def evaluate_box(session: Session, box: Box, now: int | None = None) -> Report:
    now = int(time.time()) if now is None else now
    profile = PRODUCTS_BY_ID[box.product_id]
    return evaluate(profile, box_segments(session, box.id, now), now, box.initial_budget_used)


def _thin(points: list[dict], keep_if=lambda p: False) -> list[dict]:
    if len(points) <= MAX_ROUTE_POINTS:
        return points
    step = len(points) / MAX_ROUTE_POINTS
    keep = {round(i * step) for i in range(MAX_ROUTE_POINTS)} | {len(points) - 1}
    return [p for i, p in enumerate(points) if i in keep or keep_if(p)]


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
    report = evaluate_box(session, box, now)
    data = asdict(report)
    for seg in data["segments"]:
        seg["route"] = _thin(seg["route"], lambda p: p["status"] != "ok")
        seg["series"] = _thin(seg["series"])
    profile = PRODUCTS_BY_ID[box.product_id]
    open_seg = next((s for s in report.segments if s.end_ts is None), None)
    data["box"] = box.model_dump()
    data["product"] = asdict(profile)
    data["current_node_id"] = open_seg.node_id if open_seg else None
    data["places"] = cached_places(session, key_points(report))
    return data
