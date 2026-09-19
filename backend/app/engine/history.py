"""Stitch a box's thermal history out of the nodes it rode in, and integrate it.

A box's history is a list of custody segments: "box X was in node N from t0 to
t1". For each segment we take node N's readings inside that window and
integrate the product's degradation rate over time (trapezoid rule).

All timestamps are UTC epoch seconds. Durations that feed the budget and the
alarms are multiplied by the reading's time_scale (1 in real use; >1 only on
demo nodes). Gaps are always measured in real time.
"""

from dataclasses import dataclass, field, replace

from app.engine.arrhenius import rate_per_hour
from app.engine.profiles import (
    FREEZE_THRESHOLD_C,
    HUMIDITY_ADVISORY_RH,
    ProductProfile,
)

# Intervals longer than this between readings are not integrated; they are
# reported as holes in the history instead.
MAX_GAP_S = 60 * 60


@dataclass(frozen=True)
class Reading:
    ts: int
    temp_c: float
    rh: float | None = None
    lat: float | None = None
    lon: float | None = None
    time_scale: float = 1.0


@dataclass
class Segment:
    node_id: str
    node_label: str
    start_ts: int
    end_ts: int | None  # None while the box is still in this node
    readings: list[Reading]
    # Redundancy and location provenance, filled in by the data layer.
    backup_label: str | None = None
    backup_filled: int = 0
    max_disagreement_c: float | None = None
    located_by: str | None = None


@dataclass
class Gap:
    node_id: str
    start_ts: int
    end_ts: int
    ongoing: bool = False  # node hasn't synced since start_ts

    @property
    def minutes(self) -> float:
        return (self.end_ts - self.start_ts) / 60


@dataclass
class Run:
    """A continuous stretch of readings past some threshold."""

    kind: str  # "freeze" | "heat" | "humid"
    node_id: str
    start_ts: int
    end_ts: int
    minutes: float  # product time (scaled)
    extreme: float  # coldest / hottest / most humid value
    lat: float | None
    lon: float | None
    budget_used: float = 0.0


@dataclass
class RoutePoint:
    ts: int
    lat: float
    lon: float
    temp_c: float
    rh: float | None
    status: str  # "ok" | "heat" | "freeze"


@dataclass
class SeriesPoint:
    ts: int
    temp_c: float
    rh: float | None


@dataclass
class SegmentResult:
    node_id: str
    node_label: str
    start_ts: int
    end_ts: int | None
    budget_used: float = 0.0
    reading_count: int = 0
    min_temp_c: float | None = None
    max_temp_c: float | None = None
    max_rh: float | None = None
    data_through: int | None = None
    last_temp_c: float | None = None
    last_rh: float | None = None
    start_lat: float | None = None
    start_lon: float | None = None
    end_lat: float | None = None
    end_lon: float | None = None
    gaps: list[Gap] = field(default_factory=list)
    runs: list[Run] = field(default_factory=list)
    route: list[RoutePoint] = field(default_factory=list)
    series: list[SeriesPoint] = field(default_factory=list)
    backup_label: str | None = None
    backup_filled: int = 0
    max_disagreement_c: float | None = None
    located_by: str | None = None


def _status(profile: ProductProfile, temp_c: float) -> str:
    if temp_c <= FREEZE_THRESHOLD_C:
        return "freeze"
    if temp_c > profile.storage_max_c:
        return "heat"
    return "ok"


def _window(seg: Segment, now: int) -> tuple[list[Reading], int]:
    """Readings that describe the segment, with a held value at each edge."""
    end = seg.end_ts if seg.end_ts is not None else now
    ordered = sorted(seg.readings, key=lambda r: r.ts)
    points = [r for r in ordered if seg.start_ts <= r.ts <= end]
    before = [r for r in ordered if r.ts < seg.start_ts and seg.start_ts - r.ts <= MAX_GAP_S]
    if before and (not points or points[0].ts > seg.start_ts):
        points.insert(0, replace(before[-1], ts=seg.start_ts))
    return points, end


def analyze_segment(profile: ProductProfile, seg: Segment, now: int) -> SegmentResult:
    res = SegmentResult(
        seg.node_id, seg.node_label, seg.start_ts, seg.end_ts,
        backup_label=seg.backup_label, backup_filled=seg.backup_filled,
        max_disagreement_c=seg.max_disagreement_c, located_by=seg.located_by,
    )
    points, end = _window(seg, now)
    real = [p for p in points if p.ts >= seg.start_ts]

    if not points:
        # A box loaded moments ago is just waiting for the node's next upload.
        if seg.end_ts is not None or end - seg.start_ts > MAX_GAP_S:
            res.gaps.append(Gap(seg.node_id, seg.start_ts, end, ongoing=seg.end_ts is None))
        return res

    res.reading_count = len(real)
    res.data_through = points[-1].ts
    res.last_temp_c, res.last_rh = points[-1].temp_c, points[-1].rh
    temps = [p.temp_c for p in points]
    res.min_temp_c, res.max_temp_c = min(temps), max(temps)
    rhs = [p.rh for p in points if p.rh is not None]
    res.max_rh = max(rhs) if rhs else None

    located = [p for p in points if p.lat is not None and p.lon is not None]
    if located:
        res.start_lat, res.start_lon = located[0].lat, located[0].lon
        res.end_lat, res.end_lon = located[-1].lat, located[-1].lon
    res.route = [
        RoutePoint(p.ts, p.lat, p.lon, p.temp_c, p.rh, _status(profile, p.temp_c))
        for p in located
    ]

    res.series = [SeriesPoint(p.ts, p.temp_c, p.rh) for p in points]

    if points[0].ts - seg.start_ts > MAX_GAP_S:
        res.gaps.append(Gap(seg.node_id, seg.start_ts, points[0].ts))

    # Close the tail: a finished segment holds its last value to the unload
    # time; an open one is only a gap once the node has been silent too long.
    tail = end - points[-1].ts
    if seg.end_ts is not None:
        if tail > MAX_GAP_S:
            res.gaps.append(Gap(seg.node_id, points[-1].ts, end))
        elif tail > 0:
            points.append(replace(points[-1], ts=end))
    elif tail > MAX_GAP_S:
        res.gaps.append(Gap(seg.node_id, points[-1].ts, end, ongoing=True))

    open_runs: dict[str, Run] = {}

    def close(kind: str) -> None:
        if kind in open_runs:
            res.runs.append(open_runs.pop(kind))

    def track(kind: str, active: bool, p: Reading, until: int, value: float, minutes: float, used: float):
        if not active:
            close(kind)
            return
        run = open_runs.get(kind)
        if run is None:
            run = open_runs[kind] = Run(kind, seg.node_id, p.ts, until, 0.0, value, p.lat, p.lon)
        if value < run.extreme if kind == "freeze" else value > run.extreme:
            run.extreme = value
            if p.lat is not None:
                run.lat, run.lon = p.lat, p.lon
        run.end_ts = until
        run.minutes += minutes
        run.budget_used += used

    for p, q in zip(points, points[1:]):
        dt = q.ts - p.ts
        if dt > MAX_GAP_S:
            res.gaps.append(Gap(seg.node_id, p.ts, q.ts))
            for kind in list(open_runs):
                close(kind)
            continue
        hours = dt / 3600 * p.time_scale
        used = hours * 0.5 * (
            rate_per_hour(profile.anchors, p.temp_c) + rate_per_hour(profile.anchors, q.temp_c)
        )
        res.budget_used += used
        minutes = hours * 60
        track("freeze", p.temp_c <= FREEZE_THRESHOLD_C, p, q.ts, p.temp_c, minutes, used)
        track("heat", p.temp_c > profile.storage_max_c, p, q.ts, p.temp_c, minutes, used)
        humid = p.rh is not None and p.rh >= HUMIDITY_ADVISORY_RH
        track("humid", humid, p, q.ts, p.rh or 0.0, minutes, used)

    for kind in list(open_runs):
        close(kind)
    res.runs.sort(key=lambda r: r.start_ts)
    return res
