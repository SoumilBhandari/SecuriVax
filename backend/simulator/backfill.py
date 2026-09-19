"""Fill the database with a few days of believable history for the demo.

    python -m simulator.backfill --reset

Writes straight to the database (custody segments start in the past, which
the live API deliberately can't do). Each box tells a different story:

    BOX-0001 penta   froze against frozen ice packs on the road   -> QUARANTINE (shake test)
    BOX-0003 MR      same carrier, same freeze, not sensitive     -> USE
    BOX-0002 OPV     three hot outreach days                      -> QUARANTINE (check VVM)
    BOX-0005 OPV     carrier left in a parked car for two days    -> DISCARD
    BOX-0004 HPV     textbook trip                                -> USE
    BOX-0101/0102    RDTs in a hot, humid clinic store            -> USE + advisories
"""

import argparse
import math
import random
import time
from collections.abc import Callable

from sqlmodel import Session, SQLModel

from app.db import engine, init_db
from app.models import Custody, Node, Reading, Scan
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
) -> None:
    node = session.get(Node, node_id)
    boot = start  # a fresh boot per trip keeps (node, boot, seq) unique
    for seq, t in enumerate(range(start, end + 1, STEP), start=1):
        lat, lon = where((t - start) / max(end - start, 1))
        session.add(Reading(
            node_id=node_id, boot_id=boot, seq=seq, ts=t, temp_c=round(temp(t), 2),
            rh=round(min(max(rh(t), 0), 100), 1), lat=round(lat, 6), lon=round(lon, 6),
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


def outreach_temp(t: int) -> float:
    """Ice packs hold until noon; by mid-afternoon the carrier is warm."""
    hour = ((t / 3600) + 3) % 24
    if 12 <= hour < 18:
        return 5 + 29 * math.sin((hour - 12) / 6 * math.pi) + random.gauss(0, 0.4)
    return cold_box_temp(t)


def backfill(session: Session, now: int) -> None:
    random.seed(7)

    # BOX-0005: carrier forgotten in a parked car, 5 -> 3 days ago.
    start, end = now - 5 * D, now - 3 * D
    write_readings(session, "CAR-01", start, end, lambda t: ambient_temp(t, 30, 44), parked(KISUMU_TO_KOMBEWA[3]))
    custody(session, "BOX-0005", "CAR-01", start, end, "found in parked vehicle")

    # BOX-0002: three outreach days, 4 -> 1 days ago.
    start, end = now - 4 * D, now - 1 * D
    write_readings(
        session, "CAR-02", start, end, outreach_temp,
        lambda f: along(KISUMU_TO_KOMBEWA[3:], abs(math.sin(f * 3 * math.pi))),
    )
    custody(session, "BOX-0002", "CAR-02", start, end, "back at district store")

    # BOX-0004: a textbook trip on CAR-02, 10 -> 7 hours ago.
    start, end = now - 10 * H, now - 7 * H
    write_readings(session, "CAR-02", start, end, cold_box_temp, road)
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
    args = parser.parse_args()
    if args.reset:
        SQLModel.metadata.drop_all(engine)
    init_db()
    with Session(engine) as session:
        seed(session)
        backfill(session, int(time.time()))
    print("backfilled demo history")


if __name__ == "__main__":
    main()
