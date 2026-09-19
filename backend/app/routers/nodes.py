import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.routers.ingest import LIVE_WINDOW_S
from app.security import agent_hourly_limit, agent_limit, live_limit, require_operator

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
    # A low-power node is quiet between check-ins: online means it checked in on time.
    within = max(ONLINE_WITHIN_S, 2 * (node.checkin_s or 0) + 60)
    data.update(
        online=node.last_seen_at is not None and now - node.last_seen_at <= within,
        live=_live_state(node, now),
        low_battery=node.battery_v is not None and node.battery_v < LOW_BATTERY_V,
        latest=latest.model_dump(include={"ts", "temp_c", "rh", "lat", "lon"}) if latest else None,
        box_ids=list(boxes),
    )
    return data


def _live_state(node: Node, now: int) -> dict:
    """Whether it's streaming, waiting to hear the ask at its next check-in, or neither."""
    if node.live_until and node.live_until > now:
        state = "live"
    elif node.live_asked_at and (node.live_until is None or node.live_until < node.live_asked_at):
        state = "asked"
    else:
        state = "off"
    next_checkin = node.last_seen_at + node.checkin_s if node.last_seen_at and node.checkin_s else None
    return {"state": state, "until": node.live_until if state == "live" else None, "next_checkin": next_checkin}


# Anyone watching can ask a node to stream live; each node streams at most
# this many windows a day, so its battery can't be run down from the web.
LIVE_WINDOWS_PER_DAY = 12
_live_asks: dict[str, deque] = defaultdict(deque)


def clear_live_asks() -> None:
    _live_asks.clear()


@router.post("/{node_id}/live", dependencies=[Depends(live_limit)])
def ask_live(node_id: str, session: Session = Depends(get_session)) -> dict:
    """Ask a low-power node to stream readings for ten minutes. It hears the
    ask at its next check-in, so the answer says when that should be."""
    node = session.get(Node, node_id)
    if node is None:
        raise HTTPException(404, f"no node {node_id}")
    now = int(time.time())
    state = _live_state(node, now)
    if state["state"] != "off":
        return state  # already live, or already asked
    asks = _live_asks[node_id]
    while asks and now - asks[0] > 86_400:
        asks.popleft()
    if len(asks) >= LIVE_WINDOWS_PER_DAY:
        raise HTTPException(429, f"{node_id} has streamed live {LIVE_WINDOWS_PER_DAY} times today; its battery comes first")
    asks.append(now)
    node.live_asked_at = now
    session.add(node)
    session.commit()
    return {**_live_state(node, now), "window_s": LIVE_WINDOW_S}


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


# "Heading to" offers places a carrier could reach today, not every site on the
# continent: a truck in Tanzania shouldn't be offered a clinic in Senegal.
REACH_KM = 800


@router.get("/{node_id}/destinations")
def destinations(node_id: str, session: Session = Depends(get_session)) -> list[dict]:
    """Facilities within a day's drive of where the carrier is, nearest first,
    with the road distance. A carrier with no position gets those in its zone."""
    from app.services import twin as twin_service
    from app.services.climate import ROAD_FACTOR, haversine_km

    node = session.get(Node, node_id)
    if node is None:
        raise HTTPException(404, f"no node {node_id}")
    now = int(time.time())
    located = [r for r in twin_service.carrier_readings(session, node_id, now - 6 * 3600, now) if r.lat is not None]
    pos = (located[-1].lat, located[-1].lon) if located else None
    rows = []
    for f in session.exec(select(Facility)).all():
        km = haversine_km(pos, (f.lat, f.lon)) * ROAD_FACTOR if pos else None
        if (km is not None and km > REACH_KM) or (km is None and node.timezone and f.timezone != node.timezone):
            continue
        rows.append({"id": f.id, "name": f.name, "kind": f.kind, "has_fridge": f.has_fridge,
                     "road_km": round(km) if km is not None else None})
    rows.sort(key=lambda r: (r["road_km"] is None, r["road_km"] or 0, r["name"]))
    return rows


AGENT_REUSE_S = 300
_agent_answers: dict[tuple, tuple[float, dict]] = {}


def clear_agent_answers() -> None:
    _agent_answers.clear()


@router.post("/{node_id}/agent", dependencies=[Depends(agent_limit)])
def location_agent(node_id: str, body: AgentIn, request: Request, session: Session = Depends(get_session)) -> dict:
    """Gemini dispatch agent (rules fallback): continue, divert or hold. Anyone
    can ask (it only advises; acting on it is /decisions, for operators). The
    same question about the same carrier gets the same answer for five
    minutes, and Gemini's total use is capped per hour."""
    from app.services.location_agent import recommend

    if session.get(Node, node_id) is None:
        raise HTTPException(404, f"no node {node_id}")
    if body.destination_id and session.get(Facility, body.destination_id) is None:
        raise HTTPException(404, f"no facility {body.destination_id}")
    key = (node_id, body.destination_id, body.question[:500])
    hit = _agent_answers.get(key)
    if hit and time.time() - hit[0] < AGENT_REUSE_S:
        return hit[1]
    agent_hourly_limit(request)
    answer = recommend(session, node_id, body.destination_id, body.question[:500])
    if len(_agent_answers) > 500:
        _agent_answers.clear()
    _agent_answers[key] = (time.time(), answer)
    return answer


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
