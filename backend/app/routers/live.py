"""The live signal: every reading as the server receives it.

Tails the readings table by id instead of hooking the ingest route, so it sees
every source (nodes over WiFi, the USB bridge, the simulated lanes) and works
the same with more than one server process. Nothing here feeds a verdict: the
verdicts read the full history, this is only what just came in.
"""

import asyncio
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.db import get_session
from app.engine.profiles import FREEZE_GUARD_C, freeze_guard, sensor_spec
from app.models import Node, Reading

router = APIRouter(prefix="/api/live", tags=["live"])

STORAGE_MIN_C, STORAGE_MAX_C = 2.0, 8.0  # the label range nearly every vaccine shares
POLL_S = 1.0
# A real event, not an SSE comment: the page can't see comments, and it needs
# to hear something to notice a connection a proxy has left hanging.
HEARTBEAT_S = 10.0
# The browser reconnects on its own (resuming from Last-Event-ID), so a stream
# can end now and then; that keeps proxies with idle limits and forgotten tabs
# from holding connections forever. A shutdown doesn't wait for this: the server
# runs with --timeout-graceful-shutdown, or an open feed would hold a deploy.
STREAM_MAX_S = 10 * 60
MAX_PER_TICK = 200
MAX_STREAMS = 50
_open_streams = 0


def band(temp_c: float, freeze_c: float = FREEZE_GUARD_C) -> str:
    """freeze_c: the reading's sensor's freeze guard band."""
    if temp_c <= freeze_c:
        return "freeze"
    if temp_c < STORAGE_MIN_C:
        return "cold"
    if temp_c > STORAGE_MAX_C:
        return "warm"
    return "ok"


def _event(r: Reading, node: Node) -> dict:
    spec = sensor_spec(node.sensor)
    guard = freeze_guard(spec.sigma_c)
    return {
        "id": r.id, "node_id": r.node_id, "label": node.label, "kind": node.kind,
        "ts": r.ts, "received_at": r.received_at, "ts_source": r.ts_source,
        "temp_c": r.temp_c, "rh": r.rh, "battery_v": r.battery_v, "band": band(r.temp_c, guard),
        "sensor": spec.name, "sensor_accuracy_c": spec.accuracy_c, "freeze_c": guard,
    }


def _query(node_id: str | None):
    q = select(Reading, Node).join(Node, Node.id == Reading.node_id)
    return q.where(Reading.node_id == node_id) if node_id else q


def recent_events(session: Session, limit: int, node_id: str | None = None) -> list[dict]:
    rows = session.exec(_query(node_id).order_by(Reading.id.desc()).limit(limit)).all()
    return [_event(r, n) for r, n in reversed(rows)]


def events_after(session: Session, after_id: int, node_id: str | None = None) -> list[dict]:
    rows = session.exec(_query(node_id).where(Reading.id > after_id).order_by(Reading.id).limit(MAX_PER_TICK)).all()
    return [_event(r, n) for r, n in rows]


def _last_id(session: Session) -> int:
    return session.exec(select(Reading.id).order_by(Reading.id.desc()).limit(1)).first() or 0


@router.get("/recent")
def recent(
    limit: int = Query(60, ge=1, le=500),
    node: str | None = Query(None, max_length=40),
    session: Session = Depends(get_session),
) -> dict:
    """The latest readings, oldest first, and the id to stream from."""
    return {
        "readings": recent_events(session, limit, node),
        "last_id": _last_id(session),
        "band": {"min_c": STORAGE_MIN_C, "max_c": STORAGE_MAX_C, "freeze_c": FREEZE_GUARD_C},
        "server_time": int(time.time()),
    }


def _fetch(bind, after_id: int, node_id: str | None) -> list[dict]:
    with Session(bind) as session:
        return events_after(session, after_id, node_id)


def _start_id(bind, after: int | None, last_event_id: str | None) -> int:
    if last_event_id and last_event_id.isdigit():  # a reconnect resumes where it stopped
        return int(last_event_id)
    if after is not None:
        return after
    with Session(bind) as session:
        return _last_id(session)


@router.get("/stream")
async def stream(
    request: Request,
    after: int | None = Query(None, ge=0, description="Send readings with a larger id (default: only new ones)"),
    node: str | None = Query(None, max_length=40),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Server-sent events: one `reading` event per new reading, and a `ping`
    after HEARTBEAT_S without one."""
    global _open_streams
    if _open_streams >= MAX_STREAMS:
        raise HTTPException(503, "too many live viewers, try again shortly")
    # The stream outlives this request's session, so each poll opens its own.
    bind = session.get_bind()
    cursor = await asyncio.to_thread(_start_id, bind, after, request.headers.get("last-event-id"))

    async def events():
        global _open_streams
        nonlocal cursor
        _open_streams += 1
        started = last_sent = time.monotonic()
        try:
            yield f"retry: 3000\nevent: hello\ndata: {json.dumps({'after': cursor})}\n\n"
            while time.monotonic() - started < STREAM_MAX_S:
                if await request.is_disconnected():
                    return
                for e in await asyncio.to_thread(_fetch, bind, cursor, node):
                    cursor = e["id"]
                    last_sent = time.monotonic()
                    yield f"id: {e['id']}\nevent: reading\ndata: {json.dumps(e)}\n\n"
                if time.monotonic() - last_sent >= HEARTBEAT_S:
                    last_sent = time.monotonic()
                    yield "event: ping\ndata: {}\n\n"
                await asyncio.sleep(POLL_S)
        finally:
            _open_streams -= 1

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(events(), media_type="text/event-stream", headers=headers)
