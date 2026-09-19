import time

from sqlmodel import select

from app.engine.history import Reading
from app.engine.location import attach_positions, position_at
from app.engine.redundancy import merge
from app.models import Custody, LocationPoint

KEY = {"X-Node-Key": "dev-node-key"}
T0 = 1_780_000_000


# --- engine ------------------------------------------------------------------

def test_position_is_interpolated_between_tracker_fixes():
    track = [(T0, 0.0, 34.0), (T0 + 600, 1.0, 35.0)]
    assert position_at(track, T0 + 300) == (0.5, 34.5)
    assert position_at(track, T0 + 600) == (1.0, 35.0)


def test_lone_fix_only_covers_nearby_readings():
    track = [(T0, 0.1, 34.1)]
    assert position_at(track, T0 + 20 * 60) == (0.1, 34.1)
    assert position_at(track, T0 + 45 * 60) is None
    assert position_at([], T0) is None


def test_long_silence_between_fixes_is_not_a_straight_line():
    track = [(T0, 0.0, 34.0), (T0 + 5 * 3600, 1.0, 35.0)]
    assert position_at(track, T0 + 2.5 * 3600) is None


def test_node_gps_beats_the_tracker():
    readings = [Reading(T0, 5.0, lat=9.0, lon=9.0), Reading(T0 + 60, 5.0)]
    out = attach_positions(readings, [(T0, 0.0, 34.0), (T0 + 120, 0.0, 34.2)])
    assert (out[0].lat, out[0].lon) == (9.0, 9.0)
    assert out[1].lon == 34.1


def test_backup_fills_the_primarys_silence_and_is_compared_elsewhere():
    primary = [Reading(T0 + i * 60, 5.0) for i in range(10)]
    backup = [Reading(T0 + i * 60 + 5, 5.5) for i in range(30)]
    m = merge(primary, backup)
    assert m.backup_filled == 16  # primary silent >5 min after its last reading at minute 9
    assert m.pairs == 11 and m.max_disagreement_c == 0.5
    assert [r.ts for r in m.readings] == sorted(r.ts for r in m.readings)


def test_of_two_readings_at_once_the_cautious_one_counts():
    # Warm: the warmer sensor counts. Cold: the colder one. In range: whichever is further from 5 C.
    primary = [Reading(T0, 9.0), Reading(T0 + 600, 1.5), Reading(T0 + 1200, 4.8)]
    backup = [Reading(T0 + 5, 10.5, rh=60.0), Reading(T0 + 605, 0.4), Reading(T0 + 1205, 5.1)]
    m = merge(primary, backup)
    assert [r.temp_c for r in m.readings] == [10.5, 0.4, 4.8]
    assert m.readings[0].rh == 60.0  # the humidity comes with the reading that counts
    assert m.max_disagreement_c == 1.5


# --- API ---------------------------------------------------------------------

def post_readings(client, node, temps, start, step=60, boot=1, gps=False):
    readings = [
        {"seq": i + 1, "ts": start + i * step, "temp_c": t, **({"lat": -0.1, "lon": 34.7} if gps else {})}
        for i, t in enumerate(temps)
    ]
    res = client.post("/api/ingest/readings", json={"node_id": node, "boot_id": boot, "readings": readings}, headers=KEY)
    assert res.status_code == 200, res.text


def test_smarttag_points_give_a_gps_less_node_a_route(client, session):
    now = int(time.time())
    session.add(Custody(box_id="BOX-0004", node_id="CAR-02", start_ts=now - 3600))
    session.commit()
    post_readings(client, "CAR-02", [5.0] * 55, start=now - 3500)
    points = [{"ts": now - 3600 + k * 900, "lat": -0.09, "lon": 34.76 - k * 0.05} for k in range(5)]
    body = {"node_id": "CAR-02", "source": "smarttag", "points": points + [{"ts": now, "lat": 0, "lon": 0}]}
    res = client.post("/api/ingest/locations", json=body, headers=KEY).json()
    assert res == {"accepted": 5, "duplicates": 0, "rejected": 1}
    again = client.post("/api/ingest/locations", json=body, headers=KEY).json()
    assert again["accepted"] == 0 and again["duplicates"] == 5
    assert len(session.exec(select(LocationPoint)).all()) == 5

    seg = client.get("/api/boxes/BOX-0004/report").json()["segments"][0]
    assert seg["located_by"] == "smarttag"
    assert len(seg["route"]) == 55
    assert seg["route"][0]["lon"] > seg["route"][-1]["lon"]  # heading west


def test_backup_node_keeps_a_box_monitored_when_the_primary_dies(client, session):
    now = int(time.time())
    session.add(Custody(box_id="BOX-9001", node_id="DEMO-01", start_ts=now - 7200))
    session.commit()
    post_readings(client, "DEMO-01", [5.0] * 20, start=now - 7200)  # then goes dark
    post_readings(client, "DEMO-01B", [5.3] * 119, start=now - 7190)
    report = client.get("/api/boxes/BOX-9001/report").json()
    codes = {r["code"] for r in report["reasons"]}
    assert "NODE_OFFLINE" not in codes and "HISTORY_GAP" not in codes
    assert "BACKUP_USED" in codes
    assert report["segments"][0]["backup_filled"] > 90


def test_disagreeing_sensors_are_flagged(client, session):
    now = int(time.time())
    session.add(Custody(box_id="BOX-9001", node_id="DEMO-01", start_ts=now - 600))
    session.commit()
    post_readings(client, "DEMO-01", [5.0] * 10, start=now - 600)
    post_readings(client, "DEMO-01B", [9.0] * 10, start=now - 590)
    codes = {r["code"] for r in client.get("/api/boxes/BOX-9001/report").json()["reasons"]}
    assert "SENSOR_DISAGREE" in codes
