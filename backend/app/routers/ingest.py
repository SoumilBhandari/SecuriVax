"""Reading ingest for ESP32 nodes (and the simulator).

Designed for flaky links: the node keeps every reading until the server acks
it, and re-sending a batch is always safe because (node, boot, seq) is unique.
One bad reading is rejected on its own; it never sinks the rest of the batch.
"""

import hmac
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.dialects import postgresql, sqlite
from sqlmodel import Session, func, select

from app.db import get_session
from app.models import IngestLog, LocationPoint, Node, Reading
from app.schemas import IngestBatch, IngestResult, LocationBatch, LocationResult, ReadingIn, Rejected

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

EARLIEST_TS = 1_704_067_200  # 2024-01-01; anything older is an unset clock
MAX_FUTURE_S = 5 * 60
# Values sensors report when they are unplugged or glitching (DS18B20: -127
# when disconnected, 85 on power-on reset).
SENSOR_ERROR_VALUES = {-127.0, 85.0}


def _check(r: ReadingIn) -> str | None:
    if r.temp_c in SENSOR_ERROR_VALUES or not -60 <= r.temp_c <= 80:
        return f"temperature {r.temp_c} out of range"
    if r.rh is not None and not 0 <= r.rh <= 100:
        return f"humidity {r.rh} out of range"
    if (r.lat is None) != (r.lon is None):
        return "lat and lon must be sent together"
    if r.lat is not None and not (-90 <= r.lat <= 90 and -180 <= r.lon <= 180):
        return "position out of range"
    return None


def _timestamp(r: ReadingIn, batch: IngestBatch, now: int) -> tuple[int, str] | None:
    """Device clock if it looks set, otherwise rebuilt from uptime."""
    if r.ts is not None and EARLIEST_TS <= r.ts <= now + MAX_FUTURE_S:
        return r.ts, "device"
    if r.uptime_ms is not None and batch.uptime_ms is not None and r.uptime_ms <= batch.uptime_ms:
        return now - round((batch.uptime_ms - r.uptime_ms) / 1000), "reconstructed"
    return None


def _insert_ignoring_duplicates(session: Session, rows: list[dict]) -> None:
    dialect = postgresql if session.get_bind().dialect.name == "postgresql" else sqlite
    stmt = dialect.insert(Reading).values(rows).on_conflict_do_nothing(
        index_elements=["node_id", "boot_id", "seq"]
    )
    session.execute(stmt)


def _authorised_node(session: Session, node_id: str, key: str) -> Node:
    node = session.get(Node, node_id)
    if node is None or not hmac.compare_digest(node.key.encode(), key.encode()):
        raise HTTPException(401, "unknown node or bad key")
    return node


@router.post("/readings", response_model=IngestResult)
def ingest_readings(
    batch: IngestBatch,
    session: Session = Depends(get_session),
    x_node_key: str = Header(default=""),
) -> IngestResult:
    node = _authorised_node(session, batch.node_id, x_node_key)

    now = int(time.time())
    seen: set[int] = set()
    fresh: list[ReadingIn] = []
    rejected: list[Rejected] = []
    duplicates = 0

    for r in batch.readings:
        if r.seq in seen:
            duplicates += 1
            continue
        seen.add(r.seq)
        if error := _check(r):
            rejected.append(Rejected(seq=r.seq, error=error))
            continue
        fresh.append(r)

    existing = set()
    if fresh:
        existing = set(session.exec(
            select(Reading.seq).where(
                Reading.node_id == node.id,
                Reading.boot_id == batch.boot_id,
                Reading.seq.in_([r.seq for r in fresh]),
            )
        ).all())
    duplicates += len(existing)

    rows = []
    for r in fresh:
        if r.seq in existing:
            continue
        stamped = _timestamp(r, batch, now)
        if stamped is None:
            rejected.append(Rejected(seq=r.seq, error="no usable timestamp"))
            continue
        ts, source = stamped
        no_fix = r.lat == 0 and r.lon == 0  # GPS modules report 0,0 before a fix
        rows.append({
            "node_id": node.id, "boot_id": batch.boot_id, "seq": r.seq,
            "ts": ts, "ts_source": source, "temp_c": r.temp_c, "rh": r.rh,
            "lat": None if no_fix else r.lat, "lon": None if no_fix else r.lon,
            "battery_v": r.battery_v, "time_scale": node.time_scale, "received_at": now,
        })

    try:
        if rows:
            _insert_ignoring_duplicates(session, rows)
        node.last_seen_at = now
        latest_battery = next((r.battery_v for r in reversed(batch.readings) if r.battery_v), None)
        node.battery_v = batch.battery_v or latest_battery or node.battery_v
        node.fw_version = batch.fw_version or node.fw_version
        ack_seq = max(seen) if seen else None
        session.add(node)
        session.add(IngestLog(
            node_id=node.id, boot_id=batch.boot_id, received_at=now, count=len(batch.readings),
            accepted=len(rows), duplicates=duplicates, rejected=len(rejected), ack_seq=ack_seq,
        ))
        session.commit()
    except Exception as exc:  # nothing was stored, so the node must retry
        session.rollback()
        raise HTTPException(503, "storage unavailable, retry later") from exc

    return IngestResult(
        accepted=len(rows), duplicates=duplicates, rejected=rejected,
        ack_seq=ack_seq, server_time=now,
    )


@router.post("/locations", response_model=LocationResult)
def ingest_locations(
    batch: LocationBatch,
    session: Session = Depends(get_session),
    x_node_key: str = Header(default=""),
) -> LocationResult:
    """Positions for a carrier from any tracker (Samsung SmartTag via Home
    Assistant, a phone, a GPS module). Resending is harmless."""
    node = _authorised_node(session, batch.node_id, x_node_key)
    now = int(time.time())
    rows, rejected = [], 0
    for p in batch.points:
        ok_pos = -90 <= p.lat <= 90 and -180 <= p.lon <= 180 and not (p.lat == 0 and p.lon == 0)
        if not ok_pos or not EARLIEST_TS <= p.ts <= now + MAX_FUTURE_S:
            rejected += 1
            continue
        rows.append({
            "node_id": node.id, "ts": p.ts, "lat": p.lat, "lon": p.lon,
            "accuracy_m": p.accuracy_m, "source": batch.source, "received_at": now,
        })
    count = select(func.count()).select_from(LocationPoint).where(LocationPoint.node_id == node.id)
    before = session.exec(count).one()
    if rows:
        dialect = postgresql if session.get_bind().dialect.name == "postgresql" else sqlite
        session.execute(
            dialect.insert(LocationPoint).values(rows)
            .on_conflict_do_nothing(index_elements=["node_id", "ts", "source"])
        )
    session.commit()
    accepted = session.exec(count).one() - before
    return LocationResult(accepted=accepted, duplicates=len(rows) - accepted, rejected=rejected)
