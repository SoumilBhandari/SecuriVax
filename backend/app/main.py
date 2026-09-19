import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from app.config import get_settings
from app.db import engine, init_db
from app.routers import boxes, ingest, nodes, products
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


app = FastAPI(title="ColdTrace API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (ingest.router, boxes.router, nodes.router, products.router):
    app.include_router(router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
