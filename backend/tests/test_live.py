import json
import time

import pytest

from app.routers import live
from scripts.serial_bridge import parse_sample, parse_sensor

KEY = {"X-Node-Key": "dev-node-key"}


def send(client, *temps, node="DEMO-01", boot=900, rh=52.0):
    now = int(time.time())
    readings = [{"seq": i + 1, "ts": now - len(temps) + i, "temp_c": t, "rh": rh} for i, t in enumerate(temps)]
    res = client.post("/api/ingest/readings", json={"node_id": node, "boot_id": boot, "readings": readings}, headers=KEY)
    assert res.status_code == 200, res.text


def sse(body: str) -> list[tuple[str, dict]]:
    events = []
    for block in body.split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line and not line.startswith(":"))
        if "event" in fields:
            events.append((fields["event"], json.loads(fields["data"])))
    return events


@pytest.fixture
def short_streams(monkeypatch):
    """The test client waits for a response to end, so streams end quickly here."""
    monkeypatch.setattr(live, "STREAM_MAX_S", 0.3)
    monkeypatch.setattr(live, "POLL_S", 0.05)


def test_band_follows_the_storage_range():
    assert live.band(5.0) == "ok"
    assert live.band(23.4) == "warm"
    assert live.band(1.0) == "cold"
    assert live.band(-3.0) == "freeze"


def test_recent_is_oldest_first_with_the_node_and_band(client):
    send(client, 4.0, 9.5)
    data = client.get("/api/live/recent", params={"node": "DEMO-01"}).json()
    last_two = data["readings"][-2:]
    assert [r["temp_c"] for r in last_two] == [4.0, 9.5]
    assert [r["band"] for r in last_two] == ["ok", "warm"]
    assert last_two[0]["label"] == "Demo carrier DEMO-01" and last_two[0]["rh"] == 52.0
    assert data["last_id"] >= last_two[-1]["id"]
    assert data["band"] == {"min_c": 2.0, "max_c": 8.0, "freeze_c": live.FREEZE_GUARD_C}


def test_stream_sends_readings_after_the_given_id(client, short_streams):
    send(client, 5.0)
    after = client.get("/api/live/recent").json()["last_id"]
    send(client, 6.0, 7.0, boot=901)
    events = sse(client.get("/api/live/stream", params={"after": after}).text)
    assert events[0] == ("hello", {"after": after})
    assert [e["temp_c"] for kind, e in events if kind == "reading"] == [6.0, 7.0]


def test_stream_resumes_from_last_event_id(client, short_streams):
    send(client, 5.0, 6.0)
    first = client.get("/api/live/recent").json()["readings"][-2]["id"]
    events = sse(client.get("/api/live/stream", params={"after": 0}, headers={"Last-Event-ID": str(first)}).text)
    assert [e["temp_c"] for kind, e in events if kind == "reading"] == [6.0]


def test_stream_can_follow_one_node(client, short_streams):
    send(client, 5.0, node="CAR-01", boot=902)
    send(client, 6.0, node="DEMO-01", boot=903)
    events = sse(client.get("/api/live/stream", params={"after": 0, "node": "DEMO-01"}).text)
    assert {e["node_id"] for kind, e in events if kind == "reading"} == {"DEMO-01"}


def test_stream_turns_viewers_away_when_full(client, monkeypatch):
    monkeypatch.setattr(live, "_open_streams", live.MAX_STREAMS)
    assert client.get("/api/live/stream").status_code == 503


def test_bridge_reads_the_firmware_serial_line():
    first, backup = parse_sample("#12 23.40 C 52.0% no fix")
    assert (first["seq"], first["temp_c"], first["rh"]) == (12, 23.4, 52.0) and backup is None
    assert parse_sample("#3 4.10 C nan% fix")[0]["rh"] is None
    assert parse_sample("uploaded 3: 3 new, 0 dup, 0 rejected") is None


def test_bridge_reads_both_dhts():
    first, backup = parse_sample("#7 4.80 C 55.0% no fix | B 5.10 C 53.0%")
    assert (first["temp_c"], backup["temp_c"], backup["rh"], backup["seq"]) == (4.8, 5.1, 53.0, 7)
    # The first sensor missed this one: the backup's reading still goes up.
    first, backup = parse_sample("#8 nan C nan% no fix | B 5.20 C 53.5% OUT OF RANGE")
    assert first is None and backup["temp_c"] == 5.2


def test_bridge_reads_the_sensor_from_the_boot_line():
    assert parse_sensor("temperature and humidity: DHT11 on GPIO 4") == "dht11"
    assert parse_sensor("temperature: DS18B20 probe on GPIO 13, humidity: SHT31") == "ds18b20"
    assert parse_sensor("no temperature sensor found: SHT31 on SDA 21 / SCL 22") is None


def test_a_quiet_stream_still_pings(client, monkeypatch):
    monkeypatch.setattr(live, "STREAM_MAX_S", 0.35)
    monkeypatch.setattr(live, "POLL_S", 0.05)
    monkeypatch.setattr(live, "HEARTBEAT_S", 0.1)
    kinds = [kind for kind, _ in sse(client.get("/api/live/stream").text)]
    assert kinds[0] == "hello" and "ping" in kinds and "reading" not in kinds
