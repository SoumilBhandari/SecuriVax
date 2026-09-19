import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlmodel import Session

from app.config import get_settings
from app.db import engine, init_db
from app.routers import boxes, climate, ingest, nodes, products
from app.seed import seed

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.demo_reset:
        from sqlmodel import SQLModel

        SQLModel.metadata.drop_all(engine)
    init_db()
    with Session(engine) as session:
        if seed(session, settings.demo_dataset) and settings.demo_history:
            from simulator.backfill import backfill

            backfill(session, int(time.time()), settings.demo_dataset)
        if not settings.weather_offline:
            from sqlmodel import select as _select

            from app.models import Facility
            from app.services.weather import warm

            warm([(f.lat, f.lon) for f in session.exec(_select(Facility)).all()])
    yield


app = FastAPI(title="Vialtality API", version="0.1.0", lifespan=lifespan)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (ingest.router, boxes.router, nodes.router, products.router, climate.router):
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
    return {"status": "ok"}


# In production the built web app is served from here, so NFC tags, the API
# and the app share one domain.
if settings.static_dir and Path(settings.static_dir, "index.html").is_file():
    static_root = Path(settings.static_dir).resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "not found")
        file = (static_root / path).resolve()
        if path and file.is_file() and file.is_relative_to(static_root):
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            return FileResponse(file, headers={"Cache-Control": cache})
        # Client-side routes (/box/..., /node/...) all load the app shell.
        return FileResponse(static_root / "index.html", headers={"Cache-Control": "no-cache"})
