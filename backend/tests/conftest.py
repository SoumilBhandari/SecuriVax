import os

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.config import get_settings
from app.db import get_session, init_db, make_engine
from app.main import app
from app.seed import seed
from app.security import ALL_LIMITS
from app.services import twin as twin_service
from app.services import weather


@pytest.fixture(autouse=True)
def offline_weather(monkeypatch):
    """Tests never call Open-Meteo; the built-in climate model stands in."""
    monkeypatch.setattr(get_settings(), "weather_offline", True)
    weather.clear_cache()
    twin_service.clear_cache()
    for limit in ALL_LIMITS:
        limit.reset()


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
