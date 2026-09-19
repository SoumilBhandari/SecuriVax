import time

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.security import agent_limit, require_operator

from app.db import get_session
from app.models import Custody, Facility, IngestLog, Node, Reading, Scan

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


class AgentIn(BaseModel):
    destination_id: str | None = Field(None, max_length=40)
    question: str = Field("What should this carrier do now?", max_length=500)


class DecisionIn(BaseModel):
    action: Literal["CONTINUE", "DIVERT", "HOLD", "UNKNOWN"]
    facility_id: str | None = Field(None, max_length=40)
    note: str = Field("", max_length=200)


@router.post("/{node_id}/agent", dependencies=[Depends(require_operator), Depends(agent_limit)])
async def location_agent(node_id: str, body: AgentIn, session: Session = Depends(get_session)) -> dict:
    """Gemini dispatch agent (rules fallback): continue, divert or hold."""
    from app.services.location_agent import recommend

    if session.get(Node, node_id) is None:
        raise HTTPException(404, f"no node {node_id}")
    if body.destination_id and session.get(Facility, body.destination_id) is None:
        raise HTTPException(404, f"no facility {body.destination_id}")
    return await recommend(session, node_id, body.destination_id, body.question[:500])


@router.post("/{node_id}/decisions", dependencies=[Depends(require_operator)])
def record_decision(node_id: str, body: DecisionIn, session: Session = Depends(get_session)) -> dict:
    """The supervisor accepted a recommendation: log it against every box inside."""
    if session.get(Node, node_id) is None:
        raise HTTPException(404, f"no node {node_id}")
    boxes = session.exec(select(Custody.box_id).where(Custody.node_id == node_id, Custody.end_ts.is_(None))).all()
    for box_id in boxes:
        session.add(Scan(box_id=box_id, node_id=node_id, action=f"dispatch:{body.action.lower()}",
                         note=(body.facility_id or "") + (f" {body.note}" if body.note else "")))
    session.commit()
    return {"logged": len(boxes)}
