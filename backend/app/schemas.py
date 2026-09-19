from pydantic import BaseModel, Field

MAX_BATCH = 1000


class ReadingIn(BaseModel):
    seq: int = Field(ge=0, le=2**31 - 1, description="Per-boot counter, strictly increasing")
    ts: int | None = Field(None, description="UTC epoch seconds, if the node's clock is set")
    uptime_ms: int | None = Field(None, ge=0, description="ms since boot when sampled")
    temp_c: float
    rh: float | None = None
    lat: float | None = None
    lon: float | None = None
    battery_v: float | None = None


class IngestBatch(BaseModel):
    node_id: str = Field(max_length=40)
    boot_id: int = Field(ge=0, le=2**31 - 1, description="Changes every reboot; persisted in NVS")
    uptime_ms: int | None = Field(None, ge=0, description="ms since boot when the batch was sent")
    fw_version: str | None = None
    battery_v: float | None = None
    sensor: str | None = Field(None, max_length=16, pattern=r"^[A-Za-z0-9_-]+$",
                               description="The temperature sensor, e.g. dht11, ds18b20, sht31")
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
    # Worst verdict among the boxes in this carrier now, for the node's LED.
    worst_verdict: str | None = None


class LocationIn(BaseModel):
    ts: int
    lat: float
    lon: float
    accuracy_m: float | None = None


class LocationBatch(BaseModel):
    node_id: str = Field(max_length=40)
    source: str = Field("smarttag", max_length=32)
    points: list[LocationIn] = Field(max_length=MAX_BATCH)


class LocationResult(BaseModel):
    accepted: int
    duplicates: int
    rejected: int
