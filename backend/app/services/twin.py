"""The carrier twin, wired to the database and the weather.

For a carrier on a trip right now: filter its readings, learn from its past
trips, and forecast through the weather ensemble:
- when it will leave the safe range, with a spread (P10/P50/P90),
- the chance each box inside reaches QUARANTINE or DISCARD.
"""

import statistics
import threading
import time

import numpy as np
from sqlmodel import Session, select

from app.engine import twin
from app.engine.uncertainty import _rates
from app.engine.location import attach_positions
from app.engine.profiles import FREEZE_THRESHOLD_C, PRODUCTS_BY_ID
from app.engine.redundancy import merge
from app.models import Box, Custody, LocationPoint, Node
from app.services import weather as wx
from app.services.report import _node_readings, evaluate_box

HORIZON_H = 12
LOOKBACK_S = 12 * 3600
STORAGE_MAX_C = 8.0
MODEL_FLOOR = 0.15  # never claim tighter than +/-15%: the model itself is simple
CARRIER_KINDS = ("carrier", "cold_box")
# One forecast per node (the latest); bounded memory, safe across threads.
_cache: dict[str, tuple[int, float, dict, twin.Forecast | None]] = {}
_track_record: dict[tuple[str, int], float | None] = {}
_legs: dict[tuple[str, int, int, int], tuple[list[float], float] | None] = {}
_lock = threading.Lock()
MAX_LEGS = 2000


def carrier_readings(session: Session, node_id: str, start: int, end: int):
    """Primary + backup readings, positioned from the tracker where needed."""
    readings = _node_readings(session, node_id, start, end)
    backup = session.exec(select(Node).where(Node.backup_for == node_id)).first()
    if backup:
        readings = merge(readings, _node_readings(session, backup.id, start, end)).readings
    points = session.exec(
        select(LocationPoint).where(LocationPoint.node_id == node_id, LocationPoint.ts.between(start - 7200, end + 7200))
    ).all()
    return attach_positions(readings, [(p.ts, p.lat, p.lon) for p in points])


def outside_fn(readings):
    from app.services.climate import DEFAULT_SITE, _ambient_fn

    positions = {r.ts: (r.lat, r.lon) for r in readings if r.lat is not None}
    weather = wx.weather_for(list(positions.values()) or [DEFAULT_SITE])
    last = positions[max(positions)] if positions else DEFAULT_SITE
    return _ambient_fn(weather, positions, last), last


def leg_cold_life(session: Session, node_id: str, start: int, end: int) -> tuple[list[float], float] | None:
    """Effective cold life (P10/P50/P90, rated hours) and fit RMSE for one trip."""
    readings = carrier_readings(session, node_id, start, end)
    if len(readings) < 12:
        return None
    if any(r.time_scale != 1 for r in readings):
        return None  # demo-time trips run on accelerated time: not a real cold life
    key = (node_id, start, end, readings[-1].ts)
    with _lock:
        if key in _legs:
            return _legs[key]
    ambient, _ = outside_fn(readings)
    res = twin.run_filter([(r.ts, r.temp_c, r.time_scale) for r in readings], ambient, n=600)
    q = twin.weighted_quantiles(twin.effective_cold_life(res.particles), res.particles.weight, (0.1, 0.5, 0.9))
    with _lock:
        if len(_legs) > MAX_LEGS:
            _legs.clear()
        _legs[key] = (_floored(q), res.one_step_rmse_c)
        return _legs[key]


def _floored(q: list[float]) -> list[float]:
    mid = q[1]
    return [round(min(q[0], mid * (1 - MODEL_FLOOR)), 1), round(mid, 1), round(max(q[2], mid * (1 + MODEL_FLOOR)), 1)]


def track_record(session: Session, node_id: str, before: int) -> float | None:
    """Median effective cold life over this carrier's last few finished trips."""
    legs = sorted({
        (c.start_ts, c.end_ts)
        for c in session.exec(select(Custody).where(Custody.node_id == node_id, Custody.end_ts.is_not(None), Custody.end_ts <= before)).all()
    })[-4:]
    key = (node_id, legs[-1][1] if legs else 0)
    if key not in _track_record:
        lives = [fit[0][1] for s, e in legs if (fit := leg_cold_life(session, node_id, s, e)) and fit[0][1] < 60]
        _track_record[key] = statistics.median(lives) if lives else None
    return _track_record[key]


def fleet_record(session: Session, before: int) -> float | None:
    """For a carrier with no history: the fleet's median cold life (empirical Bayes)."""
    carriers = session.exec(
        select(Node).where(Node.backup_for.is_(None), Node.kind.in_(CARRIER_KINDS), Node.time_scale == 1)
    ).all()
    lives = [life for node in carriers if (life := track_record(session, node.id, before)) is not None]
    return statistics.median(lives) if lives else None


def carrier_forecast(session: Session, node_id: str, now: int | None = None) -> dict:
    now = int(time.time()) if now is None else now
    node = session.get(Node, node_id)
    if node is None:
        raise KeyError(node_id)
    if node.time_scale != 1:
        return {"node_id": node_id, "available": False, "reason": "Demo-time carriers run on accelerated time; the forecast needs real time."}
    if node.kind not in CARRIER_KINDS:
        return {"node_id": node_id, "available": False, "reason": "Forecasts are for ice-pack carriers; this is a storage box."}

    open_custody = session.exec(select(Custody).where(Custody.node_id == node_id, Custody.end_ts.is_(None))).all()
    trip_start = min((c.start_ts for c in open_custody), default=now - LOOKBACK_S)
    readings = carrier_readings(session, node_id, max(trip_start, now - 3 * 86400), now)
    if len(readings) < 6:
        return {"node_id": node_id, "available": False, "reason": "Not enough readings on this trip yet."}

    with _lock:
        hit = _cache.get(node_id)
        if hit and hit[0] == readings[-1].ts and time.time() - hit[1] < 60:
            return hit[2]
    return _compute(session, node_id, readings, trip_start, open_custody, now)


def _storage_max(session: Session, custodies) -> float:
    """The tightest upper limit among the products on board (8 C for vaccines)."""
    limits = [PRODUCTS_BY_ID[session.get(Box, c.box_id).product_id].storage_max_c for c in custodies]
    return min(limits, default=STORAGE_MAX_C)


def _compute(session, node_id, readings, trip_start, open_custody, now) -> dict:

    ambient, (lat, lon) = outside_fn(readings)
    known, spread, prior_from = track_record(session, node_id, trip_start), 0.35, "this carrier's recent trips"
    if known is None:
        known, spread, prior_from = fleet_record(session, trip_start), 1.0, "the fleet's trips (no history for this carrier)"
    res = twin.run_filter(
        [(r.ts, r.temp_c, r.time_scale) for r in readings], ambient, known_cold_life_h=known, spread=spread
    )
    members, weather_source = wx.ensemble_for(lat, lon)
    ensemble = [(lambda ts, m=m: (m.at(ts) or (ambient(ts),))[0]) for m in members]
    storage_max = _storage_max(session, open_custody)
    fc = twin.forecast(res, ensemble, HORIZON_H, storage_max)

    p = res.particles
    now_out = ambient(res.last_ts)
    gradient = np.maximum(now_out + p.gain - p.hold, 0.5)
    ice_left_h = np.where(p.ice > 0, p.ice / (p.leak * gradient), 0.0)
    out = {
        "node_id": node_id,
        "available": True,
        "trip_start": trip_start,
        "readings": res.readings,
        "fit": {
            "one_step_rmse_c": None if res.one_step_rmse_c is None else round(res.one_step_rmse_c, 2),
            "min_effective_particles": round(res.min_ess),
        },
        "prior": {"cold_life_h": known, "from": prior_from if known else "a wide default (no trip history anywhere)"},
        "storage_max_c": storage_max,
        "state": {
            "inside_c": round(float(np.sum(p.weight * p.temp)), 2),
            "outside_c": round(now_out, 1),
            "ice_left_h": [round(x, 1) for x in twin.weighted_quantiles(ice_left_h, p.weight, (0.1, 0.5, 0.9))],
            "effective_cold_life_h": _floored(twin.weighted_quantiles(twin.effective_cold_life(p), p.weight, (0.1, 0.5, 0.9))),
            "hold_c": round(float(np.sum(p.weight * p.hold)), 1),
            "heat_gain_c": round(float(np.sum(p.weight * p.gain)), 1),
            "ice_gone_prob": round(float(np.sum(p.weight * (p.ice <= 0))), 3),
        },
        "forecast": {
            "times": fc.times[::3], "p10": fc.p10[::3], "p50": fc.p50[::3], "p90": fc.p90[::3],
            "outside_p50": fc.outside_p50[::3], "horizon_h": HORIZON_H,
        },
        "breach": {"prob": fc.breach_prob, "p10": fc.breach_p10, "p50": fc.breach_p50, "p90": fc.breach_p90},
        "weather_source": weather_source,
        "boxes": _box_risks(session, open_custody, fc, now),
    }
    with _lock:
        _cache[node_id] = (readings[-1].ts, time.time(), out, fc)
    return out


def p_breach_within(session: Session, node_id: str, minutes: float) -> float | None:
    """Share of forecast trajectories that leave 2-8 C within `minutes`."""
    out = carrier_forecast(session, node_id)
    if not out.get("available"):
        return None
    with _lock:
        hit = _cache.get(node_id)
    fc = hit[3] if hit else None
    if fc is None:
        return out["breach"]["prob"]
    steps = int(minutes / 60 / fc.dt_h)
    window = fc.trajectories[:, : max(steps, 1)]
    limit = out.get("storage_max_c", STORAGE_MAX_C)
    return round(float(((window > limit) | (window <= FREEZE_THRESHOLD_C)).any(axis=1).mean()), 3)


def _box_risks(session: Session, custodies, fc: twin.Forecast, now: int) -> list[dict]:
    """Chance each box inside ends the forecast horizon at QUARANTINE or DISCARD."""
    out = []
    traj = fc.trajectories
    for c in custodies:
        box = session.get(Box, c.box_id)
        profile = PRODUCTS_BY_ID[box.product_id]
        report = evaluate_box(session, box, now)
        rates = _rates(profile, traj)
        future = report.budget_used + np.sum(rates, axis=1) * fc.dt_h
        frozen = np.zeros(len(traj), dtype=bool)
        if profile.freeze_sensitive:
            cold = traj <= FREEZE_THRESHOLD_C
            run = np.zeros(len(traj))
            for j in range(traj.shape[1]):
                run = np.where(cold[:, j], run + fc.dt_h * 60, 0)
                frozen |= run >= 60
        out.append({
            "box_id": box.id, "product": profile.name, "budget_now": round(report.budget_used, 4),
            "budget_p50_end": round(float(np.median(future)), 4),
            "p_quarantine_or_worse": round(float(np.mean((future >= 0.75) | frozen)), 3),
            "p_discard": round(float(np.mean(future >= 1.0)), 3),
            "p_freeze": round(float(frozen.mean()), 3) if profile.freeze_sensitive else None,
            "verdict_now": report.verdict,
        })
    return out


def clear_cache() -> None:
    with _lock:
        _cache.clear()
        _track_record.clear()
        _legs.clear()
