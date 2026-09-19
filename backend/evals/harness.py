"""An in-memory copy of the API for evals: seeded demo data, offline weather,
rate limits reset, nothing touches the dev database or the network."""

import time
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.config import get_settings
from app.db import get_session, init_db, make_engine
from app.main import app
from app.security import ALL_LIMITS
from app.seed import seed
from app.services import climate, learning, twin, weather


@contextmanager
def api(dataset: str = "kisumu", history: bool = False):
    settings = get_settings()
    saved = settings.weather_offline, settings.operator_token
    settings.weather_offline, settings.operator_token = True, ""
    for clear in (weather.clear_cache, twin.clear_cache, climate.clear_cache, learning.invalidate):
        clear()
    for limit in ALL_LIMITS:
        limit.reset()
    eng = make_engine("sqlite://")
    init_db(eng)
    with Session(eng) as session:
        seed(session, dataset)
        if history:
            from simulator.backfill import backfill

            backfill(session, int(time.time()), dataset)

    def override():
        with Session(eng) as s:
            yield s

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app), eng
    finally:
        app.dependency_overrides.clear()
        settings.weather_offline, settings.operator_token = saved
        eng.dispose()
