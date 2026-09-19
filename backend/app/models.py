"""Database tables. All timestamps are UTC epoch seconds."""

import time

from sqlalchemy import Column, Index, Text, UniqueConstraint, text
from sqlmodel import Field, SQLModel


def now_ts() -> int:
    return int(time.time())


class Node(SQLModel, table=True):
    id: str = Field(primary_key=True)  # printed on the node, e.g. "CAR-02"
    label: str
    kind: str = "carrier"  # carrier | cold_box | rdt_box
    facility: str = ""
    key: str  # shared secret the node sends in X-Node-Key
    # >1 only on demo nodes: 1 real second counts as time_scale seconds.
    time_scale: float = 1.0
    # A second node in the same carrier. Its readings fill the primary's gaps.
    backup_for: str | None = Field(default=None, foreign_key="node.id")
    last_seen_at: int | None = None
    battery_v: float | None = None
    fw_version: str | None = None


class Facility(SQLModel, table=True):
    """A place in the supply chain: vaccine store or clinic."""

    id: str = Field(primary_key=True)
    name: str
    kind: str  # store | clinic
    lat: float
    lon: float


class Box(SQLModel, table=True):
    id: str = Field(primary_key=True)  # printed on the NFC sticker, e.g. "BOX-0042"
    product_id: str
    lot: str = ""
    quantity: int = 0
    # Budget already used before the box entered our monitoring (e.g. read
    # off the VVM at dispatch).
    initial_budget_used: float = 0.0
    origin: str | None = None  # e.g. "Accra"
    destination: str | None = None  # e.g. "Bolgatanga"
    created_at: int = Field(default_factory=now_ts)


class Reading(SQLModel, table=True):
    __table_args__ = (
        # (node, boot, seq) identifies a reading, so re-uploads are no-ops.
        UniqueConstraint("node_id", "boot_id", "seq", name="uq_reading_node_boot_seq"),
        Index("ix_reading_node_ts", "node_id", "ts"),
    )

    id: int | None = Field(default=None, primary_key=True)
    node_id: str = Field(foreign_key="node.id")
    boot_id: int
    seq: int
    ts: int
    ts_source: str = "device"  # device | reconstructed
    temp_c: float
    rh: float | None = None
    lat: float | None = None
    lon: float | None = None
    battery_v: float | None = None
    time_scale: float = 1.0  # copied from the node on arrival
    received_at: int = Field(default_factory=now_ts)


class LocationPoint(SQLModel, table=True):
    """Where a carrier was, from any tracker: Samsung SmartTag, GPS, phone."""

    __table_args__ = (
        UniqueConstraint("node_id", "ts", "source", name="uq_location_node_ts_source"),
        Index("ix_location_node_ts", "node_id", "ts"),
    )

    id: int | None = Field(default=None, primary_key=True)
    node_id: str = Field(foreign_key="node.id")
    ts: int
    lat: float
    lon: float
    accuracy_m: float | None = None
    source: str = "smarttag"
    received_at: int = Field(default_factory=now_ts)


class Custody(SQLModel, table=True):
    """Box X was inside node N from start_ts until end_ts."""

    __table_args__ = (
        Index(
            "uq_custody_one_open_per_box", "box_id", unique=True,
            sqlite_where=text("end_ts IS NULL"), postgresql_where=text("end_ts IS NULL"),
        ),
        Index("ix_custody_node_end", "node_id", "end_ts"),
    )

    id: int | None = Field(default=None, primary_key=True)
    box_id: str = Field(foreign_key="box.id", index=True)
    node_id: str = Field(foreign_key="node.id")
    start_ts: int
    end_ts: int | None = None
    end_note: str = ""


class Scan(SQLModel, table=True):
    """Audit log of every tap and custody change."""

    id: int | None = Field(default=None, primary_key=True)
    box_id: str | None = Field(default=None, index=True)
    node_id: str | None = None
    action: str  # load | unload | transfer
    ts: int = Field(default_factory=now_ts)
    note: str = ""


class IngestLog(SQLModel, table=True):
    """One row per upload, so we can see what every node sent and when."""

    id: int | None = Field(default=None, primary_key=True)
    node_id: str = Field(index=True)
    boot_id: int
    received_at: int = Field(default_factory=now_ts)
    count: int
    accepted: int
    duplicates: int
    rejected: int
    ack_seq: int | None = None


class TextCache(SQLModel, table=True):
    """Generated text (Grok reports, Gemini place names), keyed by input."""

    key: str = Field(primary_key=True)
    kind: str  # report | place
    text: str = Field(sa_column=Column(Text, nullable=False))
    source: str  # grok | gemini | template | coords
    created_at: int = Field(default_factory=now_ts)


class VvmCheck(SQLModel, table=True):
    """A photo of the vial's VVM label, read by the camera and confirmed by a person."""

    id: int | None = Field(default=None, primary_key=True)
    box_id: str = Field(foreign_key="box.id", index=True)
    ts: int = Field(default_factory=now_ts)
    progress: float  # 0 fresh label, 1 discard point (camera measurement)
    stage: int
    past_endpoint: bool
    sensor_budget: float  # what our record said at the moment of the photo
    agreement: str  # AGREE | LABEL_AHEAD | SENSOR_AHEAD
    rho: float | None = None  # L_square / L_ring
    flagged: bool = False  # camera and logger disagree beyond both their errors
    predicted_stage: int | None = None  # from the temperature record
    sensor_p10: float | None = None
    sensor_p90: float | None = None
    # For crowdsourced calibration: the record split into what was assumed
    # before monitoring and the heat dose we measured, at the label's nominal
    # (unlearned) speed. A confirmed photo then says how fast this product
    # really degrades: progress = initial + rate_scale x dose.
    initial_budget: float | None = None
    nominal_dose: float | None = None
    gemini_stage: int | None = None
    gemini_confidence: float | None = None
    gemini_note: str = ""
    # Human in the loop: nothing counts until a person confirms (or corrects) it.
    confirmed: bool = False
    worker_stage: int | None = None
