import os

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.db import get_session, init_db, make_engine
from app.main import app
from app.seed import seed


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
