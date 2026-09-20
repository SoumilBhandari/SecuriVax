"""Environmental intelligence: weather against the cold chain.

- leg_environment: inside vs outside for each leg of a box's trip
- stores_at_risk:  which stores and clinics the forecast is about to hit
- carrier_performance: how each carrier really performs (model vs reality)

Weather never changes a verdict.
"""

import bisect
import math
import time

from sqlmodel import Session, select

from app.engine import carrier_model as cm
from app.engine.environment import LegEnvironment, analyze_leg
from app.engine.history import SegmentResult
from app.engine.location import attach_positions
from app.engine.profiles import PRODUCTS_BY_ID, ProductProfile
from app.models import Box, Custody, Facility, LocationPoint, Node
from app.services import weather as wx
from app.services.report import _node_readings, evaluate_box

HOUR, DAY = 3600, 86400
# Where a leg with no position at all is assumed to be.
DEFAULT_SITE = (-0.0917, 34.7680)
ROAD_FACTOR = 1.3  # roads are longer than straight lines
RATED = cm.CarrierSpec()
# Health workers travel in daylight: departures between these hours, in the
# origin's own time zone (a site without one is taken to be on East Africa Time).
FIRST_DEPARTURE_H, LAST_DEPARTURE_H = 5, 15
def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def _source(weathers) -> str:
    sources = {w.source for w in weathers}
    return "open-meteo" if sources == {"open-meteo"} else "model" if sources == {"model"} else "mixed"


# ---------------------------------------------------------- leg analysis ----

def leg_environment(seg: SegmentResult, profile: ProductProfile) -> LegEnvironment:
    located = {p.ts: (p.lat, p.lon) for p in seg.route}
    fallback = next(iter(located.values()), DEFAULT_SITE)
    positions = [located.get(p.ts, fallback) for p in seg.series]
    weather = wx.weather_for(positions or [fallback])
    pairs = []
    for p, (lat, lon) in zip(seg.series, positions):
        outside = wx.ambient_at(weather, lat, lon, p.ts)
        if outside is not None:
            pairs.append((p.ts, p.temp_c, outside[0]))
    env = analyze_leg(pairs, profile.storage_min_c, profile.storage_max_c, _source(weather.values()))
    # Hourly outside temperature for the chart.
    if pairs:
        env.ambient = [(t, round(out, 1)) for t, _, out in pairs][:: max(1, len(pairs) // 120)]
    if not seg.route:
        env.text += " (No position for this leg; weather assumed for the district store.)"
    return env


# ---------------------------------------------------------- stores at risk --

def _risk(max_c: float) -> str:
    return "extreme" if max_c >= 34 else "high" if max_c >= 31 else "moderate" if max_c >= 28 else "low"


ACTIONS = {
    "extreme": "Move heat-sensitive stock (OPV first) into the fridge now. Deliver before 10:00 and condition extra ice packs.",
    "high": "Leave before 09:00 and stay off the road 12:00–16:00. Keep carriers shaded at outreach sites.",
    "moderate": "Normal schedule. Keep carriers in the shade and lids closed.",
    "low": "No action needed.",
}
RISK_ORDER = {"extreme": 0, "high": 1, "moderate": 2, "low": 3}


def _box_sites(session: Session, facilities: list[Facility], now: int) -> dict[str, list[dict]]:
    """Boxes sitting at each facility: last unloaded within 5 km of it."""
    out: dict[str, list[dict]] = {f.id: [] for f in facilities}
    for box in session.exec(select(Box)).all():
        report = evaluate_box(session, box, now)
        last = report.segments[-1] if report.segments else None
        if not last or last.end_ts is None or last.end_lat is None:
            continue
        near = min(facilities, key=lambda f: haversine_km((f.lat, f.lon), (last.end_lat, last.end_lon)))
        if haversine_km((near.lat, near.lon), (last.end_lat, last.end_lon)) <= 5:
            out[near.id].append({
                "id": box.id, "product": PRODUCTS_BY_ID[box.product_id].name,
                "kind": PRODUCTS_BY_ID[box.product_id].kind,
                "verdict": report.verdict, "budget_used": report.budget_used,
            })
    return out


_stores_cache: tuple[float, dict] | None = None


def stores_at_risk(session: Session, now: int | None = None) -> dict:
    """Cached for a minute: the forecast changes hourly, the page polls."""
    global _stores_cache
    if now is None and _stores_cache and time.time() - _stores_cache[0] < 60:
        return _stores_cache[1]
    result = _stores_at_risk(session, int(time.time()) if now is None else now)
    if now is None:
        _stores_cache = (time.time(), result)
    return result


def clear_cache() -> None:
    global _stores_cache
    _stores_cache = None


def _stores_at_risk(session: Session, now: int) -> dict:
    facilities = session.exec(select(Facility)).all()
    weather = wx.weather_for([(f.lat, f.lon) for f in facilities])
    stock = _box_sites(session, facilities, now)
    rows = []
    for f in facilities:
        w = weather[wx.cell(f.lat, f.lon)]
        ahead = w.between(now, now + 3 * DAY)
        past = w.between(now - 7 * DAY, now)
        if not ahead:
            continue
        peak_ts, peak_c, _ = max(ahead, key=lambda r: r[1])
        humid = max((r[2] for r in ahead if r[2] is not None), default=None)
        level = _risk(peak_c)
        actions = [ACTIONS[level]]
        rdts = [b for b in stock.get(f.id, []) if b["kind"] == "rapid_test"]
        if humid is not None and humid >= 85 and (rdts or f.kind == "store"):
            what = f"{len(rdts)} rapid-test boxes here" if rdts else "rapid tests in store"
            actions.append(f"Humidity up to {humid:.0f}% with {what}: keep pouches sealed until use.")
        rows.append({
            "id": f.id, "name": f.name, "kind": f.kind, "lat": f.lat, "lon": f.lon, "tz": f.timezone,
            "risk": level, "peak_c": peak_c, "peak_ts": peak_ts,
            "hours_above_30_next_72h": sum(1 for r in ahead if r[1] >= 30),
            "hours_above_30_past_7d": sum(1 for r in past if r[1] >= 30),
            "max_rh_next_72h": humid,
            "forecast": [(t, c) for t, c, _ in ahead],
            "actions": actions,
            "stock": stock.get(f.id, []),
        })
    rows.sort(key=lambda r: (RISK_ORDER[r["risk"]], -r["peak_c"]))
    hot = [r for r in rows if r["risk"] in ("extreme", "high")]
    return {
        "generated_at": now,
        "source": _source(weather.values()),
        "summary": f"{len(hot)} of {len(rows)} sites reach 31 °C or more in the next 72 hours.",
        "facilities": rows,
    }


# ------------------------------------------------------ model vs reality ----

def _ambient_fn(weather, positions: dict[int, tuple[float, float]], default: tuple[float, float]):
    """Outside temperature at the carrier's position nearest in time."""
    times = sorted(positions)

    def ambient(ts: int) -> float:
        pos = default
        if times:
            i = bisect.bisect_left(times, ts)
            near = [times[j] for j in (i - 1, i) if 0 <= j < len(times)]
            pos = positions[min(near, key=lambda t: abs(t - ts))]
        got = wx.ambient_at(weather, pos[0], pos[1], ts) or wx.model_weather(*wx.cell(*pos)).at(ts)
        return got[0] if got else 25.0

    return ambient


def carrier_performance(session: Session, now: int | None = None) -> list[dict]:
    now = int(time.time()) if now is None else now
    out = []
    # Only ice-pack carriers have a cold life; RDT boxes sit in store rooms.
    carriers = select(Node).where(Node.backup_for.is_(None), Node.kind.in_(["carrier", "cold_box"]), Node.time_scale == 1)
    for node in session.exec(carriers.order_by(Node.id)).all():
        windows = sorted({
            (c.start_ts, c.end_ts)
            for c in session.exec(select(Custody).where(Custody.node_id == node.id, Custody.end_ts.is_not(None))).all()
        })[-6:]  # the last few trips say what the carrier is like now
        legs = []
        for start, end in windows:
            readings = _node_readings(session, node.id, start, end)
            points = session.exec(
                select(LocationPoint).where(LocationPoint.node_id == node.id, LocationPoint.ts.between(start - 2 * HOUR, end + 2 * HOUR))
            ).all()
            readings = attach_positions(readings, [(p.ts, p.lat, p.lon) for p in points])
            if len(readings) < 3:
                continue
            positions = {r.ts: (r.lat, r.lon) for r in readings if r.lat is not None}
            weather = wx.weather_for(list(positions.values()) or [DEFAULT_SITE])
            ambient = _ambient_fn(weather, positions, next(iter(positions.values()), DEFAULT_SITE))
            measured = [(r.ts, r.temp_c) for r in readings]
            # The particle-filter twin gives cold life with a spread; the simple
            # breach-time estimate is kept as a cross-check.
            from app.services.twin import leg_cold_life

            fit = leg_cold_life(session, node.id, start, end)
            heuristic, _ = cm.effective_cold_life(measured, ambient, 8.0)
            effective, how = (fit[0][1], "twin") if fit else (heuristic, "heuristic")
            predicted = cm.first_breach(cm.simulate(ambient, start, end, RATED), 8.0)
            actual = cm.first_breach(measured, 8.0)
            froze = any(c <= -0.5 for _, c in measured)
            legs.append({
                "start_ts": start, "end_ts": end, "hours": round((end - start) / HOUR, 1),
                "effective_cold_life_h": effective, "how": how,
                "cold_life_range_h": [fit[0][0], fit[0][2]] if fit else None,
                "fit_rmse_c": round(fit[1], 2) if fit else None,
                "heuristic_cold_life_h": heuristic,
                "predicted_breach_ts": predicted, "actual_breach_ts": actual,
                "froze": froze, "outside_max_c": round(max(ambient(t) for t, _ in measured[:: max(1, len(measured) // 48)]), 1),
                "source": _source(weather.values()),
            })
        # Legs where the carrier never warmed up only give a lower bound; the
        # twin still estimates them, but "held" legs don't count against it.
        fitted = [leg["effective_cold_life_h"] for leg in legs if leg["actual_breach_ts"] and leg["effective_cold_life_h"] is not None]
        worst = min(fitted) if fitted else None
        if worst is None:
            rating, note = ("untested", "No completed trips yet.") if not legs else ("as rated", "Never left the safe range on any trip.")
        elif worst >= 0.8 * RATED.cold_life_h:
            rating, note = "as rated", f"Held about as long as a {RATED.cold_life_h:g} h carrier should."
        elif worst >= 0.4 * RATED.cold_life_h:
            rating, note = "underperforming", f"Only {worst:g} h of cold on its worst trip (rated {RATED.cold_life_h:g} h). Freeze packs fully and check the lid seal."
        else:
            rating, note = "failing", f"Only {worst:g} h of cold on its worst trip (rated {RATED.cold_life_h:g} h). Replace the packs or the carrier, and never leave it in a vehicle."
        if any(leg["froze"] for leg in legs):
            note += " It also froze on a trip: condition ice packs before packing."
        out.append({
            "node_id": node.id, "label": node.label, "rating": rating, "note": note,
            "effective_cold_life_h": worst, "rated_cold_life_h": RATED.cold_life_h, "legs": legs,
        })
    return out
