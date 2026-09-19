import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.config import get_settings
from app.db import engine, init_db
from app.routers import boxes, climate, ingest, nodes, products
from app.seed import seed

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with Session(engine) as session:
        if seed(session) and settings.demo_history:
            from simulator.backfill import backfill

            backfill(session, int(time.time()))
    yield


app = FastAPI(title="Vialtality API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (ingest.router, boxes.router, nodes.router, products.router, climate.router):
    app.include_router(router)


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
