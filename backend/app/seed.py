"""Demo nodes and boxes. Run `python -m app.seed --reset` to start over."""

import argparse

from sqlmodel import Session, SQLModel, select

from app.config import get_settings
from app.db import engine, init_db
from app.models import Box, Facility, Node

# One real minute on the demo node counts as two days for the product, so
# heating it for a minute on stage visibly spends the budget.
DEMO_TIME_SCALE = 2880


def demo_nodes(key: str) -> list[Node]:
    return [
        Node(id="CAR-01", label="Carrier CAR-01", kind="carrier", facility="Kisumu district store", key=key),
        Node(id="CAR-02", label="Carrier CAR-02", kind="carrier", facility="Kisumu district store", key=key),
        Node(id="RDT-01", label="RDT box RDT-01", kind="rdt_box", facility="Kombewa health centre", key=key),
        Node(
            id="DEMO-01", label="Demo carrier DEMO-01", kind="carrier",
            facility="Demo stage", key=key, time_scale=DEMO_TIME_SCALE,
        ),
        # The second ESP32 rides in the same carrier as DEMO-01.
        Node(
            id="DEMO-01B", label="Backup node DEMO-01B", kind="carrier",
            facility="Demo stage", key=key, time_scale=DEMO_TIME_SCALE, backup_for="DEMO-01",
        ),
    ]


def demo_boxes() -> list[Box]:
    return [
        Box(id="BOX-0001", product_id="penta", lot="PT-2611", quantity=20, initial_budget_used=0.10),
        Box(id="BOX-0002", product_id="opv", lot="OP-2604", quantity=20, initial_budget_used=0.68),
        Box(id="BOX-0003", product_id="mr", lot="MR-2609", quantity=10, initial_budget_used=0.05),
        Box(id="BOX-0004", product_id="hpv", lot="HP-2612", quantity=10, initial_budget_used=0.05),
        Box(id="BOX-0005", product_id="opv", lot="OP-2604", quantity=20, initial_budget_used=0.20),
        # On the road right now in CAR-02, whose ice packs keep running out.
        Box(id="BOX-0006", product_id="opv", lot="OP-2604", quantity=20, initial_budget_used=0.30),
        Box(id="BOX-0007", product_id="penta", lot="PT-2611", quantity=20, initial_budget_used=0.10),
        Box(id="BOX-0101", product_id="rdt-malaria", lot="MAL-2603", quantity=25, initial_budget_used=0.30),
        Box(id="BOX-0102", product_id="rdt-hiv", lot="HIV-2605", quantity=25, initial_budget_used=0.25),
        # Load these into DEMO-01 on stage: heat flips the OPV, freeze flips the penta.
        Box(id="BOX-9001", product_id="opv", lot="DEMO", quantity=20, initial_budget_used=0.10),
        Box(id="BOX-9002", product_id="penta", lot="DEMO", quantity=20, initial_budget_used=0.10),
    ]


def demo_facilities() -> list[Facility]:
    """Kisumu and Siaya area, approximate coordinates."""
    return [
        Facility(id="KSM-STORE", name="Kisumu district vaccine store", kind="store", lat=-0.0917, lon=34.7680),
        Facility(id="SIA-STORE", name="Siaya county store", kind="store", lat=0.0607, lon=34.2881),
        Facility(id="KOMBEWA", name="Kombewa health centre", kind="clinic", lat=-0.1037, lon=34.5170),
        Facility(id="MASENO", name="Maseno sub-county hospital", kind="clinic", lat=-0.0045, lon=34.6003),
        Facility(id="AHERO", name="Ahero health centre", kind="clinic", lat=-0.1745, lon=34.9190),
        Facility(id="BONDO", name="Bondo sub-county hospital", kind="clinic", lat=-0.0987, lon=34.2741),
        Facility(id="KENDU", name="Kendu Bay health centre", kind="clinic", lat=-0.3605, lon=34.6400),
    ]


def stage_nodes(key: str) -> list[Node]:
    """The carrier (and its backup) used live on stage, in any dataset."""
    return [n for n in demo_nodes(key) if n.id.startswith("DEMO-")]


def stage_boxes() -> list[Box]:
    return [b for b in demo_boxes() if b.id.startswith("BOX-9")]


KENYA = "Africa/Nairobi"
# The Kisumu district dataset (tests, backtest); the stage nodes are left out on
# purpose: they're wherever the demo is, so their times show in the viewer's zone.
KISUMU_TZ = {i: KENYA for i in ("CAR-01", "CAR-02", "RDT-01", "KSM-STORE", "SIA-STORE", "KOMBEWA", "MASENO", "AHERO", "BONDO", "KENDU")}


def sync_timezones(session: Session) -> int:
    """Give every known facility and node its time zone where it has none: new
    databases, and ones seeded before sites knew their zone. Returns rows set."""
    from simulator import lanes

    zones = {**KISUMU_TZ, **lanes.timezones()}
    changed = 0
    for model in (Facility, Node):
        for row in session.exec(select(model).where(model.timezone.is_(None))).all():
            if row.id in zones:
                row.timezone = zones[row.id]
                session.add(row)
                changed += 1
    session.commit()
    return changed


def sync_node_keys(session: Session) -> int:
    """Every node uses the configured NODE_KEY. Keys are stored when the demo is
    seeded, so without this a secret set after the first deploy would never
    reach the nodes (and they'd keep the public dev key). Returns nodes changed."""
    key = get_settings().node_key
    stale = session.exec(select(Node).where(Node.key != key)).all()
    for node in stale:
        node.key = key
        session.add(node)
    session.commit()
    return len(stale)


def seed(session: Session, dataset: str = "kisumu") -> bool:
    """Insert demo data if the database is empty. Returns True if it did."""
    if session.exec(select(Node)).first() is not None:
        return False
    key = get_settings().node_key
    if dataset == "lanes":
        from simulator import lanes

        session.add_all(lanes.facilities())
        session.add_all(lanes.nodes(key))
        session.add_all(lanes.boxes())
        session.add_all(stage_nodes(key))
        session.add_all(stage_boxes())
    else:
        session.add_all(demo_nodes(key))
        session.add_all(demo_boxes())
        session.add_all(demo_facilities())
    session.commit()
    sync_timezones(session)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="drop every table first")
    parser.add_argument("--dataset", default=get_settings().demo_dataset, choices=["lanes", "kisumu"])
    args = parser.parse_args()
    if args.reset:
        SQLModel.metadata.drop_all(engine)
    init_db()
    with Session(engine) as session:
        print("seeded" if seed(session, args.dataset) else "already seeded")


if __name__ == "__main__":
    main()
