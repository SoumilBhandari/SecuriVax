"""Fill the database with a few days of believable history for the demo.

    python -m simulator.backfill --reset

Writes straight to the database (custody segments start in the past, which
the live API deliberately can't do). Each box tells a different story:

    BOX-0001 penta   froze against frozen ice packs on the road   -> QUARANTINE (shake test)
    BOX-0003 MR      same carrier, same freeze, not sensitive     -> USE
    BOX-0002 OPV     three outreach days in CAR-02, packs run out  -> QUARANTINE (check VVM)
    BOX-0006/0007    on the road in CAR-02 right now               -> live forecast
    BOX-0005 OPV     carrier left in a parked car for two days    -> DISCARD
    BOX-0004 HPV     textbook trip, located by a SmartTag (no GPS) -> USE
    BOX-0101/0102    RDTs in a hot, humid clinic store            -> USE + advisories
"""

import argparse
import math
import random
import time
from collections.abc import Callable

from sqlmodel import Session, SQLModel

from app.db import engine, init_db
from app.engine import twin
from app.models import Custody, LocationPoint, Node, Reading, Scan
from app.services import weather as wx
from app.seed import seed
from simulator.common import (
    KISUMU_STORE,
    KISUMU_TO_KOMBEWA,
    KOMBEWA,
    along,
    ambient_rh,
    ambient_temp,
    cold_box_temp,
)

H, D = 3600, 86400
STEP = 300  # one reading every 5 minutes


def write_readings(
    session: Session,
    node_id: str,
    start: int,
    end: int,
    temp: Callable[[int], float],
    where: Callable[[float], tuple[float, float]],
    rh: Callable[[int], float] = lambda t: 50 + random.gauss(0, 2),
    smarttag_every: int | None = None,
) -> None:
    """smarttag_every: the node has no GPS; a SmartTag reports every N seconds."""
    node = session.get(Node, node_id)
    boot = start  # a fresh boot per trip keeps (node, boot, seq) unique
    if smarttag_every:
        for t in range(start, end + 1, smarttag_every):
            lat, lon = where((t - start) / max(end - start, 1))
            session.add(LocationPoint(node_id=node_id, ts=t, lat=round(lat, 6), lon=round(lon, 6),
                                      accuracy_m=30, source="smarttag", received_at=t))
    for seq, t in enumerate(range(start, end + 1, STEP), start=1):
        lat, lon = (None, None) if smarttag_every else where((t - start) / max(end - start, 1))
        session.add(Reading(
            node_id=node_id, boot_id=boot, seq=seq, ts=t, temp_c=round(temp(t), 2),
            rh=round(min(max(rh(t), 0), 100), 1),
            lat=None if lat is None else round(lat, 6), lon=None if lon is None else round(lon, 6),
            battery_v=round(4.15 - 0.5 * (t - start) / (5 * D), 3),
            time_scale=node.time_scale, received_at=t,
        ))
    node.last_seen_at, node.battery_v, node.fw_version = end, 3.92, "0.1.0"
    session.add(node)


def custody(session: Session, box_id: str, node_id: str, start: int, end: int | None, note: str = "") -> None:
    session.add(Custody(box_id=box_id, node_id=node_id, start_ts=start, end_ts=end, end_note=note))
    session.add(Scan(box_id=box_id, node_id=node_id, action="load", ts=start))
    if end is not None:
        session.add(Scan(box_id=box_id, node_id=node_id, action="unload", ts=end, note=note))


def road(frac: float) -> tuple[float, float]:
    return along(KISUMU_TO_KOMBEWA, frac)


def parked(point: tuple[float, float]) -> Callable[[float], tuple[float, float]]:
    return lambda _frac: along([point, point], 0, jitter=0.00005)


def carrier_physics(start: int, end: int, cold_life_h: float, gain_c: float, where) -> Callable[[int], float]:
    """Inside temperature of a carrier with this much ice, driven by the real
    outside temperature along its route: the same physics the twin assumes,
    so the twin can be checked against a known truth."""
    lat, lon = where(0.5)
    weather = wx.weather_for([(lat, lon)])[wx.cell(lat, lon)]
    fallback = wx.model_weather(*wx.cell(lat, lon))

    def outside(ts: int) -> float:
        got = weather.at(ts) or fallback.at(ts)
        return got[0] if got else 25.0

    import numpy as np

    truth = twin.Particles(*(np.array([v]) for v in (5.0, cold_life_h * twin.DEG_PER_RATED_HOUR, 4.5, 1.0, gain_c, 1.2, 0.0, 1.0)))
    temps, t = {start: 5.0}, start
    while t < end:
        twin.step(truth, outside(t + STEP), STEP / 3600, None)
        t += STEP
        temps[t] = float(truth.temp[0])
    return lambda ts: temps.get(ts, temps[max(k for k in temps if k <= ts)]) + random.gauss(0, 0.15)


def backfill(session: Session, now: int, dataset: str = "kisumu") -> None:
    if dataset == "lanes":
        from simulator import lanes

        lanes.backfill(session, now)
        return
    random.seed(7)

    # BOX-0005: carrier forgotten in a parked car, 5 -> 3 days ago.
    start, end = now - 5 * D, now - 3 * D
    write_readings(session, "CAR-01", start, end, lambda t: ambient_temp(t, 30, 44), parked(KISUMU_TO_KOMBEWA[3]))
    custody(session, "BOX-0005", "CAR-01", start, end, "found in parked vehicle")

    # BOX-0002: three outreach days in CAR-02. The packs are repacked every
    # morning but never fully frozen: about 3 h of cold at the rated +43 C.
    today_0600 = (now // D) * D + 3 * H  # 06:00 East Africa Time
    for day in (4, 3, 2):
        start = today_0600 - day * D
        end = start + 11 * H

        def outreach_route(f: float) -> tuple[float, float]:
            return along(KISUMU_TO_KOMBEWA[3:], abs(math.sin(f * math.pi)))

        temp = carrier_physics(start, end, cold_life_h=3.2, gain_c=2.0, where=outreach_route)
        write_readings(session, "CAR-02", start, end, temp, outreach_route)
        custody(session, "BOX-0002", "CAR-02", start, end, "back in the district store fridge")

    # BOX-0004: a textbook trip on CAR-02, 10 -> 7 hours ago.
    start, end = now - 10 * H, now - 7 * H
    write_readings(session, "CAR-02", start, end, cold_box_temp, road, smarttag_every=15 * 60)
    custody(session, "BOX-0004", "CAR-02", start, end, "Kombewa health centre fridge")

    # BOX-0001 + BOX-0003: packed with frozen (unconditioned) ice packs.
    start, end = now - 6 * H, now - 2 * H

    def frozen_packs(t: int) -> float:
        minutes = (t - start) / 60
        if 30 <= minutes < 140:
            return -2.6 + random.gauss(0, 0.2)
        return cold_box_temp(t)

    write_readings(session, "CAR-01", start, end, frozen_packs, road)
    custody(session, "BOX-0001", "CAR-01", start, end, "Kombewa health centre fridge")
    custody(session, "BOX-0003", "CAR-01", start, end, "Kombewa health centre fridge")

    # BOX-0006 + BOX-0007: CAR-02 left two hours ago with the same weak packs.
    start = now - 2 * H - 10 * 60
    temp = carrier_physics(start, now, cold_life_h=2.8, gain_c=3.0, where=road)
    write_readings(session, "CAR-02", start, now - 60, temp, lambda f: along(KISUMU_TO_KOMBEWA, f * 0.4))
    custody(session, "BOX-0006", "CAR-02", start, None)
    custody(session, "BOX-0007", "CAR-02", start, None)

    # RDTs: five days in the clinic store room, which runs hot and humid.
    start, end = now - 5 * D, now - 10 * 60
    write_readings(
        session, "RDT-01", start, end, lambda t: ambient_temp(t, 24, 35), parked(KOMBEWA),
        rh=lambda t: ambient_rh(t) + 5,
    )
    custody(session, "BOX-0101", "RDT-01", start, end, "moved to testing bench")
    custody(session, "BOX-0102", "RDT-01", start, end, "moved to testing bench")

    session.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="drop every table first")
    parser.add_argument("--dataset", default="lanes", choices=["lanes", "kisumu"])
    args = parser.parse_args()
    if args.reset:
        SQLModel.metadata.drop_all(engine)
    init_db()
    with Session(engine) as session:
        seed(session, args.dataset)
        backfill(session, int(time.time()), args.dataset)
    print("backfilled demo history")


if __name__ == "__main__":
    main()
