"""Reading ingest for ESP32 nodes (and the simulator).

Designed for flaky links: the node keeps every reading until the server acks
it, and re-sending a batch is always safe because (node, boot, seq) is unique.
One bad reading is rejected on its own; it never sinks the rest of the batch.
"""

import hmac
import logging
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.dialects import postgresql, sqlite
from sqlmodel import Session, func, select

from app.db import get_session
from app.models import IngestLog, LocationPoint, Node, Reading
from app.schemas import IngestBatch, IngestResult, LocationBatch, LocationResult, ReadingIn, Rejected

router = APIRouter(prefix="/api/ingest", tags=["ingest"])
log = logging.getLogger(__name__)

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
    # An empty key (an unset secret) must never match a request that sends none.
    if node is None or not node.key or not hmac.compare_digest(node.key.encode(), key.encode()):
        raise HTTPException(401, "unknown node or bad key")
    return node


# Live on request. A low-power node sleeps and connects every checkin_s; when
# someone has asked to watch it, the reply to its next check-in tells it to
# sample every LIVE_SAMPLE_S and upload each reading for LIVE_WINDOW_S.
LIVE_SAMPLE_S = 10
LIVE_WINDOW_S = 10 * 60
LIVE_ASK_EXPIRES_S = 3 * 3600  # an ask the node never heard (switched off) lapses


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
        node.sensor = batch.sensor.lower() if batch.sensor else node.sensor
        node.checkin_s = batch.checkin_s or node.checkin_s
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

    asked = node.live_asked_at
    if asked and now - asked < LIVE_ASK_EXPIRES_S and (node.live_until is None or node.live_until < asked):
        node.live_until = now + LIVE_WINDOW_S  # it hears the ask now: the window starts now
        session.add(node)
        session.commit()
    live = node.live_until if node.live_until and node.live_until > now else None
    return IngestResult(
        accepted=len(rows), duplicates=duplicates, rejected=rejected,
        ack_seq=ack_seq, server_time=now, worst_verdict=_worst_verdict(session, node, now),
        live_until=live, live_sample_s=LIVE_SAMPLE_S if live else None,
    )


def _worst_verdict(session: Session, node: Node, now: int) -> str | None:
    """For the node's status LED. Computed after the readings are stored and
    never allowed to fail the upload: the ack is what matters."""
    from app.engine.verdict import VERDICT_ORDER
    from app.models import Box, Custody
    from app.services.report import evaluate_box

    try:
        carrier = node.backup_for or node.id
        open_custody = session.exec(select(Custody).where(Custody.node_id == carrier, Custody.end_ts.is_(None))).all()
        verdicts = [evaluate_box(session, session.get(Box, c.box_id), now).verdict for c in open_custody]
        return min(verdicts, key=VERDICT_ORDER.__getitem__) if verdicts else None
    except Exception:  # noqa: BLE001
        log.exception("worst verdict for %s failed", node.id)
        return None


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
