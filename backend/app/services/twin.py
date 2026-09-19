"""The carrier twin, wired to the database and the weather.

For a carrier on a trip right now: filter its readings, learn from its past
trips, and forecast through the weather ensemble:
- when it will leave the safe range, with a spread (P10/P50/P90),
- the chance each box inside reaches QUARANTINE or DISCARD.
"""

import statistics
import time

import numpy as np
from sqlmodel import Session, select

from app.engine import twin
from app.engine.arrhenius import rate_per_hour
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
_cache: dict[tuple[str, int], tuple[float, dict]] = {}
_track_record: dict[tuple[str, int], float | None] = {}
_legs: dict[tuple[str, int, int, int], tuple[list[float], float] | None] = {}


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
    key = (node_id, start, end, readings[-1].ts)
    if key not in _legs:
        ambient, _ = outside_fn(readings)
        res = twin.run_filter([(r.ts, r.temp_c, r.time_scale) for r in readings], ambient, n=600)
        q = twin.weighted_quantiles(twin.effective_cold_life(res.particles), res.particles.weight, (0.1, 0.5, 0.9))
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


def carrier_forecast(session: Session, node_id: str, now: int | None = None) -> dict:
    now = int(time.time()) if now is None else now
    node = session.get(Node, node_id)
    if node is None:
        raise KeyError(node_id)
    if node.time_scale != 1:
        return {"node_id": node_id, "available": False, "reason": "Demo-time carriers run on accelerated time; the forecast needs real time."}

    open_custody = session.exec(select(Custody).where(Custody.node_id == node_id, Custody.end_ts.is_(None))).all()
    trip_start = min((c.start_ts for c in open_custody), default=now - LOOKBACK_S)
    readings = carrier_readings(session, node_id, max(trip_start, now - 3 * 86400), now)
    if len(readings) < 6:
        return {"node_id": node_id, "available": False, "reason": "Not enough readings on this trip yet."}

    key = (node_id, readings[-1].ts)
    if key in _cache and time.time() - _cache[key][0] < 60:
        return _cache[key][1]

    ambient, (lat, lon) = outside_fn(readings)
    known = track_record(session, node_id, trip_start)
    res = twin.run_filter([(r.ts, r.temp_c, r.time_scale) for r in readings], ambient, known_cold_life_h=known)
    members, source = wx.ensemble_for(lat, lon)
    ensemble = [(lambda ts, m=m: (m.at(ts) or (ambient(ts),))[0]) for m in members]
    fc = twin.forecast(res, ensemble, HORIZON_H, STORAGE_MAX_C)

    p = res.particles
    now_out = ambient(res.last_ts)
    gradient = np.maximum(now_out + p.gain - p.hold, 0.5)
    ice_left_h = np.where(p.ice > 0, p.ice / (p.leak * gradient), 0.0)
    out = {
        "node_id": node_id,
        "available": True,
        "trip_start": trip_start,
        "readings": res.readings,
        "fit": {"one_step_rmse_c": round(res.one_step_rmse_c, 2), "min_effective_particles": round(res.min_ess)},
        "prior": {"cold_life_h": known, "from": "this carrier's recent trips" if known else "a wide default (no trip history)"},
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
        "weather_source": source,
        "boxes": _box_risks(session, open_custody, fc, now),
    }
    _cache[key] = (time.time(), out)
    return out


def _box_risks(session: Session, custodies, fc: twin.Forecast, now: int) -> list[dict]:
    """Chance each box inside ends the forecast horizon at QUARANTINE or DISCARD."""
    out = []
    traj = fc.trajectories
    for c in custodies:
        box = session.get(Box, c.box_id)
        profile = PRODUCTS_BY_ID[box.product_id]
        report = evaluate_box(session, box, now)
        rates = np.vectorize(lambda t: rate_per_hour(profile.anchors, t))(traj)
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
    _cache.clear()
    _track_record.clear()
    _legs.clear()
