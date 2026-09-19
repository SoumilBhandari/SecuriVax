"""Demo nodes and boxes. Run `python -m app.seed --reset` to start over."""

import argparse

from sqlmodel import Session, SQLModel, select

from app.config import get_settings
from app.db import engine, init_db
from app.models import Box, Node

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
        Box(id="BOX-0101", product_id="rdt-malaria", lot="MAL-2603", quantity=25, initial_budget_used=0.30),
        Box(id="BOX-0102", product_id="rdt-hiv", lot="HIV-2605", quantity=25, initial_budget_used=0.25),
        # Load these into DEMO-01 on stage: heat flips the OPV, freeze flips the penta.
        Box(id="BOX-9001", product_id="opv", lot="DEMO", quantity=20, initial_budget_used=0.10),
        Box(id="BOX-9002", product_id="penta", lot="DEMO", quantity=20, initial_budget_used=0.10),
    ]


def seed(session: Session) -> bool:
    """Insert demo data if the database is empty. Returns True if it did."""
    if session.exec(select(Node)).first() is not None:
        return False
    session.add_all(demo_nodes(get_settings().node_key))
    session.add_all(demo_boxes())
    session.commit()
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="drop every table first")
    args = parser.parse_args()
    if args.reset:
        SQLModel.metadata.drop_all(engine)
    init_db()
    with Session(engine) as session:
        print("seeded" if seed(session) else "already seeded")


if __name__ == "__main__":
    main()
