from fastapi.testclient import TestClient

from app.main import app


def test_health():
    res = TestClient(app).get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
