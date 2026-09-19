"""The field workflow: drivers tap a box's NFC sticker on the way (checkpoints,
handovers), the clinic scans its QR code to pick it up, and a low-power node
streams live only when someone asks."""

import time

from sqlmodel import select

from app.models import Facility, LocationPoint, Node

KEY = {"X-Node-Key": "dev-node-key"}


def upload(client, node="CAR-01", seq=1, checkin_s=None, temp=5.0):
    body = {"node_id": node, "boot_id": 1, "readings": [{"seq": seq, "ts": int(time.time()) - 5, "temp_c": temp}]}
    if checkin_s:
        body["checkin_s"] = checkin_s
    res = client.post("/api/ingest/readings", json=body, headers=KEY)
    assert res.status_code == 200, res.text
    return res.json()


def test_checkpoint_pickup_and_history(client, session):
    store = session.exec(select(Facility)).first()
    client.post("/api/boxes/BOX-0001/load", json={"node_id": "CAR-01"})

    # A driver's NFC tap on the way, a little off the store: logged with where, and near what.
    res = client.post("/api/boxes/BOX-0001/checkpoint", json={"lat": store.lat + 0.005, "lon": store.lon, "note": "handed at the junction"})
    assert res.json() == {"status": "logged", "facility": store.name, "node_id": "CAR-01"}
    # The position counts for the carrier too, so its route follows the box.
    assert session.exec(select(LocationPoint).where(LocationPoint.source == "checkpoint")).one().node_id == "CAR-01"

    # The clinic's QR scan picks it up: the trip ends, and the list says so.
    res = client.post("/api/boxes/BOX-0001/receive", json={"facility_id": store.id})
    assert res.json()["status"] == "received" and res.json()["from_node"] == "CAR-01"
    box = {b["id"]: b for b in client.get("/api/boxes").json()}["BOX-0001"]
    assert box["status"] == "Received" and box["current_node_id"] is None

    history = client.get("/api/boxes/BOX-0001/report").json()["history"]
    assert [h["action"] for h in history] == ["load", "checkpoint", "receive"]
    assert history[1]["facility"] == store.name and history[1]["note"] == "handed at the junction"
    assert history[2]["facility"] == store.name and history[2]["by"] == "operator code"  # no sign-in on a laptop


def test_a_checkpoint_far_from_anywhere_names_no_facility(client):
    res = client.post("/api/boxes/BOX-0002/checkpoint", json={"lat": 0.0, "lon": 0.0})
    assert res.json()["facility"] is None
    assert client.post("/api/boxes/BOX-0002/receive", json={"facility_id": "NOPE"}).status_code == 404


def test_live_on_request(client, session):
    # A low-power node says how often it checks in; between check-ins it still counts as online.
    reply = upload(client, checkin_s=900)
    assert reply["live_until"] is None
    node = client.get("/api/nodes/CAR-01").json()
    assert node["checkin_s"] == 900 and node["live"]["state"] == "off"

    # Someone asks to watch: it's waiting for the node's next check-in.
    ask = client.post("/api/nodes/CAR-01/live").json()
    assert ask["state"] == "asked" and ask["next_checkin"] is not None
    assert client.post("/api/nodes/CAR-01/live").json()["state"] == "asked"  # asking again changes nothing

    # The node checks in and hears it: stream every 10 s for the next ten minutes.
    reply = upload(client, seq=2)
    assert reply["live_sample_s"] == 10 and reply["live_until"] > time.time() + 500
    assert client.get("/api/nodes/CAR-01").json()["live"]["state"] == "live"
    assert upload(client, seq=3)["live_until"] == reply["live_until"]  # the window doesn't restart


def test_live_asks_are_budgeted_per_node(client, session):
    from app.routers.nodes import LIVE_WINDOWS_PER_DAY
    from app.security import live_limit

    for i in range(LIVE_WINDOWS_PER_DAY):
        assert client.post("/api/nodes/CAR-02/live").status_code == 200
        node = session.get(Node, "CAR-02")
        node.live_asked_at, node.live_until = None, None  # as if that window came and went
        session.add(node)
        session.commit()
        live_limit.reset()  # the per-client limit isn't what this test is about
    assert client.post("/api/nodes/CAR-02/live").status_code == 429
