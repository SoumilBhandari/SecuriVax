import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.db import normalize_url
from app.models import Box, Custody, Node, Reading


def test_render_postgres_urls_use_psycopg():
    assert normalize_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("sqlite:///x.db") == "sqlite:///x.db"


def test_seed_creates_demo_nodes_and_boxes(session):
    assert session.get(Node, "DEMO-01").time_scale > 1
    assert len(session.exec(select(Box)).all()) >= 6


def test_reading_identity_is_unique(session):
    session.add(Reading(node_id="CAR-01", boot_id=1, seq=1, ts=1, temp_c=5))
    session.commit()
    session.add(Reading(node_id="CAR-01", boot_id=1, seq=1, ts=2, temp_c=6))
    with pytest.raises(IntegrityError):
        session.commit()


def test_box_has_at_most_one_open_custody(session):
    session.add(Custody(box_id="BOX-0001", node_id="CAR-01", start_ts=1))
    session.commit()
    session.add(Custody(box_id="BOX-0001", node_id="CAR-02", start_ts=2))
    with pytest.raises(IntegrityError):
        session.commit()
