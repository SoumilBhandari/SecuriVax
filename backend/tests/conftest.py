import os

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.config import get_settings
from app.db import get_session, init_db, make_engine
from app.main import app
from app.seed import seed
from app.routers.nodes import clear_agent_answers, clear_live_asks
from app.security import ALL_LIMITS
from app.services import climate as climate_service
from app.services import twin as twin_service
from app.services import weather


@pytest.fixture(autouse=True)
def offline_weather(monkeypatch):
    """Tests never call Open-Meteo; the built-in climate model stands in. Nor
    Grok or Gemini: a key in backend/.env must not turn the suite into paid,
    slow, non-deterministic calls (tests that need a model fake it)."""
    monkeypatch.setattr(get_settings(), "weather_offline", True)
    monkeypatch.setattr(get_settings(), "xai_api_key", "")
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    weather.clear_cache()
    twin_service.clear_cache()
    climate_service.clear_cache()
    for limit in ALL_LIMITS:
        limit.reset()
    clear_agent_answers()
    clear_live_asks()


# Set TEST_DATABASE_URL=postgresql://... to run the suite against Postgres.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite://")


@pytest.fixture
def engine():
    eng = make_engine(TEST_DATABASE_URL)
    SQLModel.metadata.drop_all(eng)
    init_db(eng)
    with Session(eng) as session:
        seed(session)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


@pytest.fixture
def client(engine):
    def override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = override
    yield TestClient(app)
    app.dependency_overrides.clear()
