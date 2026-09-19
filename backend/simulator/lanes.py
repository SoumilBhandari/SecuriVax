"""Demo dataset: eight shipments across Africa, from central store to district.

Each lane is a chain of stops. At every stop the box sits in that facility's
cold room (a monitored fridge); between stops it rides in the lane's truck
cold box. Temperatures come from physics on real weather at each position
(Open-Meteo; the offline climate model if there's no network), plus the
incident each lane is built around (a hub power cut, a hot trunk road, a
freezing cold room). Nothing here sets a verdict: the engine decides.

    python -m simulator.backfill --reset --dataset lanes
"""

import math
import random
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
from sqlmodel import Session

from app.engine import twin
from app.models import Box, Custody, Facility, Node, Reading, Scan
from app.services import weather as wx

H = 3600
STEP = 600  # a reading every 10 minutes


@dataclass
class Stop:
    id: str
    name: str
    city: str
    lat: float
    lon: float
    kind: str  # store | hub | clinic
    dwell_h: float = 10.0
    # Cold-room incident while the box is here: (hours in, duration h, towards C)
    incident: tuple[float, float, float] | None = None


@dataclass
class Lane:
    code: str
    box: str
    product: str
    lot: str
    doses: int
    initial: float
    stops: list[Stop]
    delivered: bool
    truck_cold_life_h: float = 14.0  # rated hours at +43 C of the truck's cold box
    truck_gain_c: float = 1.0
    speed_kmh: float = 45.0
    extra: dict = field(default_factory=dict)


LANES: list[Lane] = [
    Lane("GH", "BOX-GH-0117", "r21", "R21-24B117", 4200, 0.45, [
        Stop("ACC-CMS", "Central Medical Stores", "Accra", 5.6037, -0.1870, "store", 14),
        Stop("KSI-RCR", "Regional cold room", "Kumasi", 6.6885, -1.6244, "hub", 18),
        Stop("TML-HUB", "Regional hub", "Tamale", 9.4034, -0.8424, "hub", 30, incident=(6, 22, 18.0)),
        Stop("BLG-DH", "District hospital", "Bolgatanga", 10.7856, -0.8514, "clinic"),
    ], delivered=False, truck_cold_life_h=10),
    Lane("KE", "BOX-KE-0231", "rtss", "RTS-23K231", 2000, 0.02, [
        Stop("NBO-KEMSA", "KEMSA national store", "Nairobi", -1.2921, 36.8219, "store", 12),
        Stop("KSM-RVS", "Regional vaccine store", "Kisumu", -0.0917, 34.7680, "hub", 20),
        Stop("SIA-CRH", "County referral hospital", "Siaya", 0.0607, 34.2881, "clinic", 16),
    ], delivered=True, truck_cold_life_h=24),
    Lane("NG", "BOX-NG-0442", "comirnaty", "FP-24N442", 3000, 0.30, [
        Stop("LOS-FCS", "Federal cold store", "Lagos", 6.5244, 3.3792, "store", 8),
        Stop("KAD-SCR", "State cold room", "Kaduna", 10.5105, 7.4165, "hub", 12),
        Stop("KAN-SCS", "Kano State Cold Store", "Kano", 12.0022, 8.5920, "clinic"),
    ], delivered=False, truck_cold_life_h=4, truck_gain_c=3.0),
    Lane("TZ", "BOX-TZ-0318", "spikevax", "MOD-24T318", 2000, 0.68, [
        Stop("DAR-MSD", "Medical Stores Department", "Dar es Salaam", -6.7924, 39.2083, "store", 10),
        Stop("DOD-ZVS", "Zonal vaccine store", "Dodoma", -6.1630, 35.7516, "hub", 14, incident=(4, 8, 14.0)),
        Stop("MWZ-RRH", "Regional referral hospital", "Mwanza", -2.5164, 32.9175, "clinic"),
    ], delivered=False, truck_cold_life_h=6, truck_gain_c=2.0),
    Lane("ET", "BOX-ET-0507", "nuvaxovid", "NVX-24E507", 1500, 0.05, [
        Stop("ADD-EPSS", "EPSS central hub", "Addis Ababa", 8.9806, 38.7578, "store", 12),
        Stop("DIR-HUB", "EPSS branch hub", "Dire Dawa", 9.6009, 41.8501, "hub", 16),
        Stop("JIJ-HC", "Karamara hospital", "Jijiga", 9.3500, 42.8000, "clinic"),
    ], delivered=False, truck_cold_life_h=20),
    Lane("ZA", "BOX-ZA-0612", "flucelvax", "FLU-24Z612", 2500, 0.15, [
        Stop("JNB-DEP", "Provincial depot", "Johannesburg", -26.2041, 28.0473, "store", 12),
        Stop("MBO-BCR", "Border cold room", "Mbombela", -25.4658, 30.9853, "hub", 18, incident=(3, 3, -3.0)),
        Stop("MPM-CMS", "Central medical store", "Maputo", -25.9692, 32.5732, "clinic", 12),
    ], delivered=True, truck_cold_life_h=18),
    Lane("CD", "BOX-CD-0729", "mr", "MR-24C729", 5000, 0.12, [
        Stop("FIH-PEV", "PEV national store", "Kinshasa", -4.4419, 15.2663, "store", 12),
        Stop("KKW-ANT", "Antenne PEV", "Kikwit", -5.0410, 18.8162, "hub", 20),
        Stop("KGA-HGR", "General referral hospital", "Kananga", -5.8962, 22.4166, "clinic"),
    ], delivered=False, truck_cold_life_h=16),
    Lane("SN", "BOX-SN-0834", "rdt-malaria", "RDT-24S834", 9300, 0.60, [
        Stop("DKR-PNA", "PNA central store", "Dakar", 14.7167, -17.4677, "store", 12),
        Stop("TAM-PRA", "Regional store", "Tambacounda", 13.7707, -13.6673, "hub", 24),
        Stop("KED-CS", "Health centre store room", "Kédougou", 12.5556, -12.1743, "clinic", 60),
    ], delivered=True, truck_cold_life_h=12, extra={"store_room": True}),
]


def _km(a: Stop, b: Stop) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lon, b.lat, b.lon))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h)) * 1.3  # roads are longer than straight lines


def _outside(lat: float, lon: float) -> Callable[[int], float]:
    weather = wx.weather_for([(lat, lon)])[wx.cell(lat, lon)]
    fallback = wx.model_weather(*wx.cell(lat, lon))

    def at(ts: int) -> float:
        got = weather.at(ts) or fallback.at(ts)
        return got[0] if got else 27.0

    return at


def facilities() -> list[Facility]:
    seen, out = set(), []
    for lane in LANES:
        for s in lane.stops:
            if s.id not in seen:
                seen.add(s.id)
                out.append(Facility(id=s.id, name=f"{s.city} · {s.name}", kind="store" if s.kind != "clinic" else "clinic", lat=s.lat, lon=s.lon))
    return out


def nodes(key: str) -> list[Node]:
    out = []
    for lane in LANES:
        a, b = lane.stops[0], lane.stops[-1]
        out.append(Node(id=f"{lane.code}-TRK", label=f"Truck cold box {a.city}–{b.city}", kind="cold_box",
                        facility=a.city, key=key))
        for s in lane.stops[:-1] if not lane.delivered else lane.stops:
            out.append(Node(id=f"{s.id}-CR", label=f"{s.city} {s.name.lower()}", kind="cold_room",
                            facility=f"{s.city} · {s.name}", key=key))
    return out


def boxes() -> list[Box]:
    return [Box(id=l.box, product_id=l.product, lot=l.lot, quantity=l.doses, initial_budget_used=l.initial) for l in LANES]


def _write(session: Session, node_id: str, start: int, end: int, temp: Callable[[int], float],
           where: Callable[[float], tuple[float, float]], rh: Callable[[int], float]) -> None:
    node = session.get(Node, node_id)
    for seq, t in enumerate(range(start, end + 1, STEP), start=1):
        lat, lon = where((t - start) / max(end - start, 1))
        session.add(Reading(
            node_id=node_id, boot_id=start, seq=seq, ts=t, temp_c=round(temp(t) + random.gauss(0, 0.12), 2),
            rh=round(min(max(rh(t), 5), 100), 1), lat=round(lat, 5), lon=round(lon, 5),
            battery_v=round(4.1 - 0.4 * (t - start) / (4 * 86400), 3), time_scale=1.0, received_at=t,
        ))
    node.last_seen_at, node.battery_v, node.fw_version = end, 3.95, "0.1.0"
    session.add(node)


def _cold_room(stop: Stop, start: int, end: int) -> Callable[[int], float]:
    outside = _outside(stop.lat, stop.lon)

    def temp(ts: int) -> float:
        base = 4.6 + 0.5 * math.sin(ts / 5400)
        if stop.incident:
            at_h, dur_h, target = stop.incident
            t0, t1 = start + at_h * H, start + (at_h + dur_h) * H
            if t0 <= ts <= t1:  # power cut or a thermostat stuck cold
                frac = min((ts - t0) / (3 * H), 1.0)
                goal = target if target < 0 else min(target, 0.6 * outside(ts) + 4)
                return base + (goal - base) * frac
            if t1 < ts < t1 + 2 * H:  # recovery
                return base + ((target if target < 0 else min(target, 0.6 * outside(ts) + 4)) - base) * (1 - (ts - t1) / (2 * H))
        return base

    return temp


def _store_room(stop: Stop) -> Callable[[int], float]:
    """Rapid tests often sit in an ordinary store room: outside air, a bit warmer under a tin roof."""
    outside = _outside(stop.lat, stop.lon)
    return lambda ts: outside(ts) + 3.0


def _truck(lane: Lane, a: Stop, b: Stop, start: int, end: int, life_h: float) -> Callable[[int], float]:
    mid_lat, mid_lon = (a.lat + b.lat) / 2, (a.lon + b.lon) / 2
    outside = _outside(mid_lat, mid_lon)
    p = twin.Particles(*(np.array([v]) for v in (4.8, life_h * twin.DEG_PER_RATED_HOUR, 4.6, 1.0, lane.truck_gain_c, 1.3, 0.0, 1.0)))
    temps, t = {start: 4.8}, start
    while t < end:
        twin.step(p, outside(t + STEP), STEP / 3600, None)
        t += STEP
        temps[t] = float(p.temp[0])
    return lambda ts: temps.get(ts, temps[max(k for k in temps if k <= ts)])


def backfill(session: Session, now: int) -> None:
    random.seed(11)
    # One batched Open-Meteo request for every position we'll need (stops and
    # leg midpoints), instead of one request each: the free tier rate-limits.
    points = [(s.lat, s.lon) for lane in LANES for s in lane.stops]
    points += [((a.lat + b.lat) / 2, (a.lon + b.lon) / 2) for lane in LANES for a, b in zip(lane.stops, lane.stops[1:])]
    wx.weather_for(points)
    for lane in LANES:
        legs = []  # (node_id, start, end, temp_fn, where_fn, rh_fn, note)
        # Work backwards from now so in-transit lanes are mid-leg right now.
        total_h = sum(s.dwell_h for s in lane.stops[:-1]) + sum(_km(a, b) / lane.speed_kmh for a, b in zip(lane.stops, lane.stops[1:]))
        if lane.delivered:
            total_h += lane.stops[-1].dwell_h + 2
            t = now - int(total_h * H)
        else:
            t = now - int((total_h - 0.55 * _km(lane.stops[-2], lane.stops[-1]) / lane.speed_kmh) * H)
        for i, stop in enumerate(lane.stops):
            last = i == len(lane.stops) - 1
            if last and not lane.delivered:
                break
            dwell_end = t + int(stop.dwell_h * H)
            temp = _store_room(stop) if (last and lane.extra.get("store_room")) else _cold_room(stop, t, dwell_end)
            rh = (lambda s: (lambda ts: 70 + 15 * math.sin(ts / 43200)))(stop) if lane.extra.get("store_room") else (lambda ts: 55.0)
            legs.append((f"{stop.id}-CR", t, dwell_end, temp, lambda f, s=stop: (s.lat, s.lon), rh, f"at {stop.city}"))
            t = dwell_end
            if last:
                break
            nxt = lane.stops[i + 1]
            drive_end = t + int(_km(stop, nxt) / lane.speed_kmh * H)
            open_leg = (i + 1 == len(lane.stops) - 1) and not lane.delivered
            end = min(drive_end, now - 60) if open_leg else drive_end
            temp = _truck(lane, stop, nxt, t, max(end, t + STEP), lane.truck_cold_life_h)
            where = (lambda a, b: (lambda f: (a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f)))(stop, nxt)
            legs.append((f"{lane.code}-TRK", t, end, temp, where, lambda ts: 50.0, None if open_leg else f"to {nxt.city}"))
            t = drive_end
        for node_id, start, end, temp, where, rh, note in legs:
            _write(session, node_id, start, end, temp, where, rh)
            closed = note is not None
            session.add(Custody(box_id=lane.box, node_id=node_id, start_ts=start, end_ts=end if closed else None, end_note=note or ""))
            session.add(Scan(box_id=lane.box, node_id=node_id, action="load", ts=start))
    session.commit()
