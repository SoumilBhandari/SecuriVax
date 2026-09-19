"""Operator-only maintenance. Refuses to run unless OPERATOR_TOKEN is set, so a
deploy that forgot the token can't be wiped by anyone who finds the URL."""

import hmac
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlmodel import Session, SQLModel, delete, select

from app.config import get_settings
from app.db import engine, get_session, init_db
from app.security import require_operator

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_configured_operator(token: str) -> None:
    expected = get_settings().operator_token
    if not expected:
        raise HTTPException(403, "set OPERATOR_TOKEN on the server to enable admin actions")
    if not hmac.compare_digest(expected.encode(), token.encode()):
        raise HTTPException(401, "operator code required")


def _reset(dataset: str, history: bool) -> dict:
    from app.seed import seed
    from app.services import climate, learning, twin

    started = time.time()
    SQLModel.metadata.drop_all(engine)
    init_db()
    with Session(engine) as session:
        seed(session, dataset)
        if history:
            from simulator.backfill import backfill

            backfill(session, int(time.time()), dataset)
    twin.clear_cache()
    climate.clear_cache()
    learning.invalidate()
    return {"reset": True, "dataset": dataset, "history": history, "seconds": round(time.time() - started, 1)}


@router.post("/reset-demo")
async def reset_demo(x_operator_token: str = Header(default="")) -> dict:
    """Wipe everything and re-seed the demo, with history ending now. Use before
    a demo when the data has gone stale. Confirmed VVM photos are wiped too."""
    _require_configured_operator(x_operator_token)
    settings = get_settings()
    return await run_in_threadpool(_reset, settings.demo_dataset, settings.demo_history)


@router.post("/reset-stage", dependencies=[Depends(require_operator)])
def reset_stage(session: Session = Depends(get_session)) -> dict:
    """Put the live stage demo back to the start: the stage carrier (DEMO-01 and
    its backup) forgets its readings, and BOX-9001/9002 are unloaded with their
    starting budget, custody, scans and VVM checks cleared. The lanes and
    everything learned from them are untouched, so this is safe between runs."""
    from app.models import Box, Custody, Reading, Scan, VvmCheck
    from app.seed import stage_boxes, stage_nodes
    from app.services import climate, learning, twin

    nodes = [n.id for n in stage_nodes("")]
    boxes = {b.id: b for b in stage_boxes()}
    for model, col, ids in ((Reading, Reading.node_id, nodes), (Custody, Custody.box_id, list(boxes)),
                            (Scan, Scan.box_id, list(boxes)), (VvmCheck, VvmCheck.box_id, list(boxes))):
        session.exec(delete(model).where(col.in_(ids)))
    for box in session.exec(select(Box).where(Box.id.in_(list(boxes)))).all():
        box.initial_budget_used = boxes[box.id].initial_budget_used
        session.add(box)
    session.commit()
    twin.clear_cache()
    climate.clear_cache()
    learning.invalidate()
    return {"reset": True, "nodes": nodes, "boxes": list(boxes)}
