from pydantic import BaseModel, Field

MAX_BATCH = 1000


class ReadingIn(BaseModel):
    seq: int = Field(ge=0, description="Per-boot counter, strictly increasing")
    ts: int | None = Field(None, description="UTC epoch seconds, if the node's clock is set")
    uptime_ms: int | None = Field(None, ge=0, description="ms since boot when sampled")
    temp_c: float
    rh: float | None = None
    lat: float | None = None
    lon: float | None = None
    battery_v: float | None = None


class IngestBatch(BaseModel):
    node_id: str
    boot_id: int = Field(ge=0, description="Changes every reboot; persisted in NVS")
    uptime_ms: int | None = Field(None, ge=0, description="ms since boot when the batch was sent")
    fw_version: str | None = None
    battery_v: float | None = None
    readings: list[ReadingIn] = Field(max_length=MAX_BATCH)


class Rejected(BaseModel):
    seq: int
    error: str


class IngestResult(BaseModel):
    accepted: int
    duplicates: int
    rejected: list[Rejected]
    # The node may delete every buffered reading with seq <= ack_seq.
    ack_seq: int | None
    # Lets a node without GPS or NTP set its clock.
    server_time: int
