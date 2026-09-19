import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import get_session, init_db, make_engine
from app.main import app
from app.seed import seed


@pytest.fixture
def engine():
    eng = make_engine("sqlite://")
    init_db(eng)
    with Session(eng) as session:
        seed(session)
    return eng


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
