import time

from sqlmodel import select

from app.models import Custody, Scan

KEY = {"X-Node-Key": "dev-node-key"}


def send(client, node, temps, start, step=60, boot=1, first_seq=1):
    readings = [
        {"seq": first_seq + i, "ts": start + i * step, "temp_c": t, "rh": 55.0, "lat": -0.1, "lon": 34.7 + i * 1e-3}
        for i, t in enumerate(temps)
    ]
    res = client.post("/api/ingest/readings", json={"node_id": node, "boot_id": boot, "readings": readings}, headers=KEY)
    assert res.status_code == 200, res.text


def test_load_unload_and_transfer(client, session):
    assert client.post("/api/boxes/BOX-0001/load", json={"node_id": "CAR-01"}).json()["action"] == "load"
    assert client.post("/api/boxes/BOX-0001/load", json={"node_id": "CAR-01"}).json()["status"] == "already_loaded"
    # Make the first load old enough that the next one is a real transfer, not a mis-tap.
    first = session.exec(select(Custody)).one()
    first.start_ts -= 600
    session.add(first)
    session.commit()
    assert client.post("/api/boxes/BOX-0001/load", json={"node_id": "CAR-02"}).json()["action"] == "transfer"
    assert client.post("/api/boxes/BOX-0001/unload", json={"note": "clinic fridge"}).json()["status"] == "unloaded"
    assert client.post("/api/boxes/BOX-0001/unload", json={}).json()["status"] == "not_loaded"
    custody = session.exec(select(Custody).order_by(Custody.id)).all()
    assert [(c.node_id, c.end_ts is not None) for c in custody] == [("CAR-01", True), ("CAR-02", True)]
    assert [s.action for s in session.exec(select(Scan).order_by(Scan.id)).all()] == ["load", "transfer", "unload"]


def test_unknown_box_or_node_404(client):
    assert client.get("/api/boxes/NOPE/report").status_code == 404
    assert client.post("/api/boxes/BOX-0001/load", json={"node_id": "NOPE"}).status_code == 404


def test_report_follows_the_nodes_readings(client, session):
    now = int(time.time())
    session.add(Custody(box_id="BOX-0001", node_id="CAR-01", start_ts=now - 7200))
    session.commit()
    send(client, "CAR-01", [5.0] * 30, start=now - 7200)
    # Last reading 91 minutes ago: the carrier is out of signal.
    report = client.get("/api/boxes/BOX-0001/report").json()
    assert report["verdict"] == "QUARANTINE"
    assert [r["code"] for r in report["reasons"]] == ["NODE_OFFLINE"]
    assert report["current_node_id"] == "CAR-01"
    assert report["product"]["id"] == "penta"
    seg = report["segments"][0]
    assert seg["reading_count"] == 30 and len(seg["route"]) == 30

    # Back in signal, it syncs: it sat against ice packs for 80 minutes.
    send(client, "CAR-01", [-3.0] * 80, start=now - 5400, first_seq=31)
    report = client.get("/api/boxes/BOX-0001/report").json()
    assert report["verdict"] == "QUARANTINE"
    # It froze within 45 min of packing, so the pack warning fires too.
    assert [r["code"] for r in report["reasons"]] == ["FREEZE", "PACKS_TOO_COLD"]
    assert report["reasons"][1]["text"].startswith("Likely cause")
    assert "shake test" in report["action"]


def test_list_endpoints(client):
    client.post("/api/boxes/BOX-0002/load", json={"node_id": "CAR-02"})
    boxes = {b["id"]: b for b in client.get("/api/boxes").json()}
    assert boxes["BOX-0002"]["current_node_id"] == "CAR-02"
    nodes = {n["id"]: n for n in client.get("/api/nodes").json()}
    assert nodes["CAR-02"]["box_ids"] == ["BOX-0002"]
    assert "key" not in nodes["CAR-02"]
    assert len(client.get("/api/products").json()) >= 6
    assert client.get("/api/nodes/CAR-02").json()["recent"] == []


def test_quick_retap_to_another_carrier_undoes_the_mistake(client, session):
    client.post("/api/boxes/BOX-0002/load", json={"node_id": "CAR-02"})
    res = client.post("/api/boxes/BOX-0002/load", json={"node_id": "CAR-01"}).json()
    assert res["action"] == "retap"
    custody = session.exec(select(Custody).where(Custody.box_id == "BOX-0002")).all()
    assert [c.node_id for c in custody] == ["CAR-01"]
    report = client.get("/api/boxes/BOX-0002/report").json()
    assert "HISTORY_GAP" not in {r["code"] for r in report["reasons"]}


def test_short_unmonitored_leg_is_not_a_history_gap(client, session):
    now = int(time.time())
    session.add(Custody(box_id="BOX-0003", node_id="CAR-02", start_ts=now - 300, end_ts=now - 120))
    session.commit()
    codes = {r["code"] for r in client.get("/api/boxes/BOX-0003/report").json()["reasons"]}
    assert "HISTORY_GAP" not in codes
