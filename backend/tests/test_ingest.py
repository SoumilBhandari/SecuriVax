import time

from sqlmodel import select

from app.models import IngestLog, Node, Reading

KEY = {"X-Node-Key": "dev-node-key"}


def batch(readings, node="CAR-01", boot=1, **extra):
    return {"node_id": node, "boot_id": boot, "readings": readings, **extra}


def reading(seq, **kw):
    return {"seq": seq, "ts": int(time.time()) - 600 + seq, "temp_c": 5.0, "rh": 60.0,
            "lat": -0.09, "lon": 34.76, **kw}


def post(client, body, headers=KEY):
    return client.post("/api/ingest/readings", json=body, headers=headers)


def test_accepts_a_batch_and_acks_the_highest_seq(client, session):
    res = post(client, batch([reading(i) for i in range(1, 6)], battery_v=3.9))
    assert res.status_code == 200
    body = res.json()
    assert (body["accepted"], body["duplicates"], body["ack_seq"]) == (5, 0, 5)
    assert len(session.exec(select(Reading)).all()) == 5
    node = session.get(Node, "CAR-01")
    assert node.last_seen_at and node.battery_v == 3.9


def test_resending_a_batch_is_harmless(client, session):
    body = batch([reading(i) for i in range(1, 4)])
    post(client, body)
    again = post(client, body).json()
    assert (again["accepted"], again["duplicates"], again["ack_seq"]) == (0, 3, 3)
    assert len(session.exec(select(Reading)).all()) == 3


def test_overlapping_and_out_of_order_batches(client, session):
    post(client, batch([reading(3), reading(1)]))
    res = post(client, batch([reading(2), reading(3), reading(2)])).json()
    assert (res["accepted"], res["duplicates"]) == (1, 2)
    assert sorted(session.exec(select(Reading.seq)).all()) == [1, 2, 3]


def test_same_seq_after_reboot_is_a_new_reading(client, session):
    post(client, batch([reading(1)], boot=1))
    assert post(client, batch([reading(1)], boot=2)).json()["accepted"] == 1


def test_bad_readings_are_rejected_individually(client, session):
    res = post(client, batch([
        reading(1), reading(2, temp_c=-127.0), reading(3, rh=140.0),
        reading(4, lat=None), reading(5),
    ])).json()
    assert res["accepted"] == 2
    assert [r["seq"] for r in res["rejected"]] == [2, 3, 4]
    assert res["ack_seq"] == 5  # rejected readings can never succeed, so drop them too


def test_timestamps_are_rebuilt_from_uptime_when_clock_is_unset(client, session):
    res = post(client, batch(
        [reading(1, ts=0, uptime_ms=10_000), reading(2, ts=None, uptime_ms=70_000)],
        uptime_ms=130_000,
    )).json()
    assert res["accepted"] == 2
    rows = session.exec(select(Reading).order_by(Reading.seq)).all()
    assert [r.ts_source for r in rows] == ["reconstructed"] * 2
    assert rows[1].ts - rows[0].ts == 60
    assert abs(rows[1].ts - (res["server_time"] - 60)) <= 1


def test_reading_without_any_time_is_rejected(client):
    res = post(client, batch([reading(1, ts=None)])).json()
    assert res["rejected"] == [{"seq": 1, "error": "no usable timestamp"}]


def test_gps_zero_zero_means_no_fix(client, session):
    post(client, batch([reading(1, lat=0.0, lon=0.0)]))
    r = session.exec(select(Reading)).one()
    assert r.lat is None and r.lon is None


def test_demo_node_time_scale_is_stamped_on_readings(client, session):
    post(client, batch([reading(1)], node="DEMO-01"))
    assert session.exec(select(Reading)).one().time_scale == session.get(Node, "DEMO-01").time_scale


def test_bad_key_and_unknown_node_are_refused(client):
    assert post(client, batch([reading(1)]), headers={"X-Node-Key": "nope"}).status_code == 401
    assert post(client, batch([reading(1)], node="NOPE")).status_code == 401


def test_every_upload_is_logged(client, session):
    post(client, batch([reading(1), reading(2)]))
    post(client, batch([reading(2)]))
    logs = session.exec(select(IngestLog).order_by(IngestLog.id)).all()
    assert [(log.accepted, log.duplicates) for log in logs] == [(2, 0), (0, 1)]


def test_ack_carries_the_worst_verdict_in_the_carrier(client):
    from app.config import get_settings

    key = get_settings().node_key
    empty = client.post("/api/ingest/readings", headers={"X-Node-Key": key},
                        json={"node_id": "DEMO-01", "boot_id": 7, "readings": [{"seq": 1, "temp_c": 5.0, "ts": int(__import__("time").time())}]})
    assert empty.json()["worst_verdict"] is None  # nothing loaded yet
    client.post("/api/boxes/BOX-9001/load", json={"node_id": "DEMO-01"})
    res = client.post("/api/ingest/readings", headers={"X-Node-Key": key},
                      json={"node_id": "DEMO-01", "boot_id": 7, "readings": [{"seq": 2, "temp_c": 5.0, "ts": int(__import__("time").time())}]})
    assert res.json()["worst_verdict"] in ("USE", "USE_FIRST", "QUARANTINE", "DISCARD")
