import time

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.models import Custody, IngestLog, Node, Reading

router = APIRouter(prefix="/api/nodes", tags=["nodes"])

ONLINE_WITHIN_S = 10 * 60
LOW_BATTERY_V = 3.4


def _summary(session: Session, node: Node, now: int) -> dict:
    latest = session.exec(
        select(Reading).where(Reading.node_id == node.id).order_by(Reading.ts.desc())
    ).first()
    boxes = session.exec(
        select(Custody.box_id).where(Custody.node_id == node.id, Custody.end_ts.is_(None))
    ).all()
    data = node.model_dump(exclude={"key"})
    data.update(
        online=node.last_seen_at is not None and now - node.last_seen_at <= ONLINE_WITHIN_S,
        low_battery=node.battery_v is not None and node.battery_v < LOW_BATTERY_V,
        latest=latest.model_dump(include={"ts", "temp_c", "rh", "lat", "lon"}) if latest else None,
        box_ids=list(boxes),
    )
    return data


@router.get("")
def list_nodes(session: Session = Depends(get_session)) -> list[dict]:
    now = int(time.time())
    return [_summary(session, n, now) for n in session.exec(select(Node).order_by(Node.id)).all()]


@router.get("/{node_id}")
def get_node(node_id: str, session: Session = Depends(get_session)) -> dict:
    node = session.get(Node, node_id)
    if node is None:
        raise HTTPException(404, f"no node {node_id}")
    now = int(time.time())
    recent = session.exec(
        select(Reading).where(Reading.node_id == node_id).order_by(Reading.ts.desc()).limit(240)
    ).all()
    uploads = session.exec(
        select(IngestLog).where(IngestLog.node_id == node_id).order_by(IngestLog.id.desc()).limit(10)
    ).all()
    return {
        **_summary(session, node, now),
        "recent": [
            r.model_dump(include={"ts", "temp_c", "rh", "lat", "lon", "battery_v"}) for r in reversed(recent)
        ],
        "uploads": [u.model_dump() for u in uploads],
    }


@router.get("/{node_id}/forecast")
def node_forecast(node_id: str, session: Session = Depends(get_session)) -> dict:
    """Particle-filter twin of the carrier, rolled forward through the weather ensemble."""
    from app.services.twin import carrier_forecast

    if session.get(Node, node_id) is None:
        raise HTTPException(404, f"no node {node_id}")
    return carrier_forecast(session, node_id)
