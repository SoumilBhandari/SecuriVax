"""Operator-only maintenance. Refuses to run unless OPERATOR_TOKEN is set, so a
deploy that forgot the token can't be wiped by anyone who finds the URL."""

import hmac
import time

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlmodel import Session, SQLModel

from app.config import get_settings
from app.db import engine, init_db

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
