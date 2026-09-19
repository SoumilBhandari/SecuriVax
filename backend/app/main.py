import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlmodel import Session

from app.config import DEV_NODE_KEY, get_settings
from app.db import engine, init_db
from app.routers import admin, auth, boxes, climate, ingest, live, nodes, products
from app.seed import seed, sync_node_keys, sync_timezones

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.demo_reset:
        from app.db import drop_demo_tables

        drop_demo_tables(engine)
    init_db()
    with Session(engine) as session:
        if seed(session, settings.demo_dataset) and settings.demo_history:
            from simulator.backfill import backfill

            backfill(session, int(time.time()), settings.demo_dataset)
        sync_node_keys(session)
        sync_timezones(session)
        if not settings.weather_offline:
            from sqlmodel import select as _select

            from app.models import Facility
            from app.services.weather import warm

            warm([(f.lat, f.lon) for f in session.exec(_select(Facility)).all()])
    live = None
    if settings.demo_live and settings.demo_history and settings.demo_dataset == "lanes":
        live = asyncio.create_task(_keep_lanes_live())
    yield
    if live:
        live.cancel()


async def _keep_lanes_live() -> None:
    """The simulated lane carriers report every few minutes, like real nodes."""
    from simulator.lanes import keep_alive

    def tick() -> None:
        with Session(engine) as session:
            keep_alive(session, int(time.time()))

    while True:
        try:
            await run_in_threadpool(tick)
        except Exception:  # noqa: BLE001  (a bad tick must not stop the next)
            logging.getLogger(__name__).exception("keeping the demo lanes live failed")
        await asyncio.sleep(120)


app = FastAPI(
    title="SecuriVax API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.show_api_docs else None,
    redoc_url="/redoc" if settings.show_api_docs else None,
    openapi_url="/openapi.json" if settings.show_api_docs else None,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (ingest.router, boxes.router, nodes.router, products.router, climate.router, admin.router, live.router, auth.router):
    app.include_router(router)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    size = request.headers.get("content-length")
    if size and size.isdigit() and int(size) > settings.max_body_bytes:
        return JSONResponse({"detail": "request too large"}, status_code=413)
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    """422 without echoing the (possibly huge) input back."""
    errors = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)


@app.get("/api/health")
def health() -> dict:
    """Liveness for the platform's health check, plus what is configured (never
    the values): enough to see at a glance why a deploy behaves as it does."""
    from sqlalchemy import text

    from app.engine.vvm import CALIBRATION

    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))
        database = "ok"
    except Exception:  # noqa: BLE001  (report, don't crash the health check)
        database = "unreachable"
    return {
        "status": "ok" if database == "ok" else "degraded",
        "database": database,
        "ai": {"grok": bool(settings.xai_api_key), "gemini": bool(settings.gemini_api_key)},
        "weather": "offline model" if settings.weather_offline else "open-meteo",
        "writes": "operator code" if settings.operator_token else "open (set OPERATOR_TOKEN)",
        # The dev key is in the repo, so anyone could post readings with it.
        "node_key": "set" if settings.node_key and settings.node_key != DEV_NODE_KEY else "dev default (set NODE_KEY)",
        "vvm_calibration": CALIBRATION.source,
        "version": settings.version,
    }


# In production the built web app is served from here, so NFC tags, the API
# and the app share one domain.
if settings.static_dir and Path(settings.static_dir, "index.html").is_file():
    static_root = Path(settings.static_dir).resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "not found")
        file = (static_root / path).resolve()
        if path.startswith("assets/") and not file.is_file():
            # An old tab asking for a chunk from a previous deploy: a real 404,
            # not the app shell (which would fail as "not a module").
            raise HTTPException(404, "not found")
        if path and file.is_file() and file.is_relative_to(static_root):
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            return FileResponse(file, headers={"Cache-Control": cache})
        # Client-side routes (/box/..., /node/...) all load the app shell.
        return FileResponse(static_root / "index.html", headers={"Cache-Control": "no-cache"})
