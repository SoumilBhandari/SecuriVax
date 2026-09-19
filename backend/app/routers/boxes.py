import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.engine.profiles import PRODUCTS_BY_ID
from app.models import Box, Custody, Node, Scan
from app.services.narrative import build_facts, write_report
from app.services.places import resolve_places
from app.services.report import evaluate_box, key_points, report_json

router = APIRouter(prefix="/api/boxes", tags=["boxes"])


class LoadIn(BaseModel):
    node_id: str


class UnloadIn(BaseModel):
    note: str = ""


def _box(session: Session, box_id: str) -> Box:
    box = session.get(Box, box_id)
    if box is None:
        raise HTTPException(404, f"no box {box_id}")
    return box


def _open_custody(session: Session, box_id: str) -> Custody | None:
    return session.exec(
        select(Custody).where(Custody.box_id == box_id, Custody.end_ts.is_(None))
    ).first()


@router.get("")
def list_boxes(session: Session = Depends(get_session)) -> list[dict]:
    out = []
    for box in session.exec(select(Box).order_by(Box.id)).all():
        report = evaluate_box(session, box)
        custody = _open_custody(session, box.id)
        out.append({
            **box.model_dump(),
            "product_name": PRODUCTS_BY_ID[box.product_id].name,
            "product_kind": PRODUCTS_BY_ID[box.product_id].kind,
            "current_node_id": custody.node_id if custody else None,
            "verdict": report.verdict,
            "budget_used": report.budget_used,
        })
    return out


@router.get("/{box_id}/report")
def box_report(box_id: str, session: Session = Depends(get_session)) -> dict:
    return report_json(session, _box(session, box_id))


@router.post("/{box_id}/explain")
async def explain_box(box_id: str, session: Session = Depends(get_session)) -> dict:
    """Gemini names the places, then Grok writes the worker-facing report."""
    box = _box(session, box_id)
    report = evaluate_box(session, box)
    places, places_source = await resolve_places(session, key_points(report))
    facts = build_facts(box, PRODUCTS_BY_ID[box.product_id], report, places)
    text, source = await write_report(session, facts)
    return {
        "verdict": report.verdict,
        "text": text,
        "source": source,
        "places": places,
        "places_source": places_source,
    }


@router.post("/{box_id}/load")
def load_box(box_id: str, body: LoadIn, session: Session = Depends(get_session)) -> dict:
    """Put a box into a node. Loading into a different node is a transfer."""
    _box(session, box_id)
    if session.get(Node, body.node_id) is None:
        raise HTTPException(404, f"no node {body.node_id}")
    now = int(time.time())
    current = _open_custody(session, box_id)
    if current and current.node_id == body.node_id:
        return {"status": "already_loaded", "node_id": body.node_id}
    action = "load"
    if current:
        current.end_ts = now
        current.end_note = f"transferred to {body.node_id}"
        session.add(current)
        session.flush()
        action = "transfer"
    session.add(Custody(box_id=box_id, node_id=body.node_id, start_ts=now))
    session.add(Scan(box_id=box_id, node_id=body.node_id, action=action, ts=now))
    session.commit()
    return {"status": "loaded", "action": action, "node_id": body.node_id}


@router.post("/{box_id}/unload")
def unload_box(box_id: str, body: UnloadIn, session: Session = Depends(get_session)) -> dict:
    _box(session, box_id)
    current = _open_custody(session, box_id)
    if current is None:
        return {"status": "not_loaded"}
    now = int(time.time())
    current.end_ts = now
    current.end_note = body.note
    session.add(current)
    session.add(Scan(box_id=box_id, node_id=current.node_id, action="unload", ts=now, note=body.note))
    session.commit()
    return {"status": "unloaded", "node_id": current.node_id}
