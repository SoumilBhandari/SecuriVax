"""Stitch a box's thermal history out of the nodes it rode in, and integrate it.

A box's history is a list of custody segments: "box X was in node N from t0 to
t1". For each segment we take node N's readings inside that window and
integrate the product's degradation rate over time (trapezoid rule).

All timestamps are UTC epoch seconds. Durations that feed the budget and the
alarms are multiplied by the reading's time_scale (1 in real use; >1 only on
demo nodes). Gaps are always measured in real time.
"""

from dataclasses import dataclass, field, replace

from app.engine.profiles import (
    FREEZE_THRESHOLD_C,
    HUMIDITY_ADVISORY_RH,
    ProductProfile,
    freeze_guard,
    sensor_spec,
)

# Intervals longer than this between readings are not integrated; they are
# reported as holes in the history instead.
MAX_GAP_S = 60 * 60
# A finished leg shorter than this with no readings is a handoff blip (the node
# hadn't reported yet), not a hole in the history.
MIN_UNMONITORED_LEG_S = 15 * 60


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
    sensor: str | None = None  # what the node reads with (None: the design's SHT31)

    @property
    def sensor_sigma_c(self) -> float:
        return sensor_spec(self.sensor).sigma_c


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

    kind: str  # "freeze" | "near_freeze" | "heat" | "humid"
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
    budget: float = 0.0  # heat budget used on this leg up to this point (the scrubber reads it)


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
    sensor: str = "SHT31"
    sensor_accuracy_c: float = 0.2
    freeze_guard_c: float = 0.0


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


def integration_points(seg: Segment, now: int) -> list[Reading]:
    """The exact points the engine integrates over: readings in the leg, the
    value held from just before it started, and (for a finished leg) the last
    value held to the unload time. Shared with the Monte Carlo confidence so
    the two can never disagree about the data."""
    points, end = _window(seg, now)
    if points and seg.end_ts is not None and 0 < end - points[-1].ts <= MAX_GAP_S:
        points = points + [replace(points[-1], ts=end)]
    return points


def analyze_segment(profile: ProductProfile, seg: Segment, now: int) -> SegmentResult:
    res = SegmentResult(
        seg.node_id, seg.node_label, seg.start_ts, seg.end_ts,
        backup_label=seg.backup_label, backup_filled=seg.backup_filled,
        max_disagreement_c=seg.max_disagreement_c, located_by=seg.located_by,
    )
    spec = sensor_spec(seg.sensor)
    res.sensor, res.sensor_accuracy_c = spec.name, spec.accuracy_c
    res.freeze_guard_c = guard = freeze_guard(spec.sigma_c)
    points, end = _window(seg, now)

    if not points:
        # A box loaded moments ago is just waiting for the node's next upload,
        # and a leg of a few minutes with no reading is a handoff blip.
        too_long = MIN_UNMONITORED_LEG_S if seg.end_ts is not None else MAX_GAP_S
        if end - seg.start_ts > too_long:
            res.gaps.append(Gap(seg.node_id, seg.start_ts, end, ongoing=seg.end_ts is None))
        return res

    res.reading_count = sum(1 for r in seg.readings if seg.start_ts <= r.ts <= end)
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
            profile.rate(p.temp_c) + profile.rate(q.temp_c)
        )
        res.budget_used += used
        minutes = hours * 60
        track("freeze", p.temp_c <= FREEZE_THRESHOLD_C, p, q.ts, p.temp_c, minutes, used)
        track("near_freeze", p.temp_c <= guard, p, q.ts, p.temp_c, minutes, used)
        track("heat", p.temp_c > profile.storage_max_c, p, q.ts, p.temp_c, minutes, used)
        humid = p.rh is not None and p.rh >= HUMIDITY_ADVISORY_RH
        track("humid", humid, p, q.ts, p.rh or 0.0, minutes, used)

    for kind in list(open_runs):
        close(kind)
    res.runs.sort(key=lambda r: r.start_ts)
    # Cumulative budget at every series point, for scrubbing through the trip.
    cum, at = 0.0, {points[0].ts: 0.0}
    for p, q in zip(points, points[1:]):
        dt = q.ts - p.ts
        if 0 < dt <= MAX_GAP_S:
            cum += dt / 3600 * p.time_scale * 0.5 * (
                profile.rate(p.temp_c) + profile.rate(q.temp_c)
            )
        at[q.ts] = cum
    for sp in res.series:
        sp.budget = round(at.get(sp.ts, 0.0), 5)
    return res
