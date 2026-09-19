"""Product stability profiles.

Every profile is a two-point Arrhenius fit: the hours it takes to use up the
product's whole heat budget at two reference temperatures. For vaccines the
anchors are the WHO vaccine vial monitor (VVM) categories, so budget used maps
directly onto how far the VVM on the vial has progressed. Rapid-test anchors
are illustrative; see RDT_ANCHORS.
"""

from dataclasses import dataclass

from app.engine.arrhenius import rate_per_hour, t_life_hours

DAY = 24.0

# WHO/PQS/E006/IN05.3, table 1a: days to VVM end point. The spec defines each
# curve by these two points only (the +5 C figures for VVM30/14/7 are floors).
VVM_ANCHORS: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    "VVM30": ((37.0, 30 * DAY), (25.0, 193 * DAY)),
    "VVM14": ((37.0, 14 * DAY), (25.0, 90 * DAY)),
    "VVM7": ((37.0, 7 * DAY), (25.0, 45 * DAY)),
    "VVM2": ((37.0, 2 * DAY), (5.0, 225 * DAY)),
}

# Illustrative: 24-month label shelf life at the 30 C label maximum, and the
# WHO RDT product-testing stress condition (60 days at 45 C) as the end point.
RDT_ANCHORS = ((30.0, 730 * DAY), (45.0, 60 * DAY))

# WHO 30-day temperature recorder alarms.
FREEZE_THRESHOLD_C = -0.5
FREEZE_ALARM_MINUTES = 60


@dataclass(frozen=True)
class SensorSpec:
    name: str
    accuracy_c: float  # the datasheet's ± figure
    sigma_c: float  # calibration error, one sigma


# A node reports which sensor it read with; one that doesn't is taken to be the
# design's SHT31. The datasheet's ± figure is read as about two sigma.
SENSORS = {
    "sht31": SensorSpec("SHT31", 0.2, 0.2),
    "ds18b20": SensorSpec("DS18B20", 0.5, 0.25),
    "dht22": SensorSpec("DHT22", 0.5, 0.25),
    "dht11": SensorSpec("DHT11", 2.0, 1.0),
}
DEFAULT_SENSOR = SENSORS["sht31"]
SENSOR_SIGMA_C = DEFAULT_SENSOR.sigma_c


def sensor_spec(sensor: str | None) -> SensorSpec:
    return SENSORS.get((sensor or "").lower(), DEFAULT_SENSOR)


def freeze_guard(sigma_c: float) -> float:
    """Guard band for sensor calibration error: a reading at or below this could
    be a true -0.5 C with 95% one-sided confidence, so a freeze-sensitive box that
    sits here for an hour is held for a shake test. The coarser the sensor, the
    warmer the guard: a DHT11 (±2 C) can't rule out freezing below about 1 C."""
    return round(FREEZE_THRESHOLD_C + 1.645 * sigma_c, 2)


FREEZE_GUARD_C = freeze_guard(SENSOR_SIGMA_C)
HEAT_ALARM_C = 8.0
HEAT_ALARM_MINUTES = 10 * 60

# Rapid tests degrade with moisture once pouches are opened or damaged.
HUMIDITY_ADVISORY_RH = 75.0
HUMIDITY_ADVISORY_MINUTES = 6 * 60


@dataclass(frozen=True)
class ProductProfile:
    id: str
    name: str
    kind: str  # "vaccine" | "rapid_test"
    stability_ref: str
    anchors: tuple[tuple[float, float], tuple[float, float]]
    freeze_sensitive: bool
    # What the worker should do to confirm a box after a freeze.
    freeze_check: str
    storage_min_c: float
    storage_max_c: float
    notes: str = ""
    # Field correction to the label's degradation speed, learned from confirmed
    # VVM photos (see app.engine.learning). 1.0 = the curve exactly as labelled.
    rate_scale: float = 1.0

    def rate(self, temp_c: float) -> float:
        """Fraction of the stability budget used per hour at temp_c."""
        return rate_per_hour(self.anchors, temp_c) * self.rate_scale

    @property
    def has_vvm(self) -> bool:
        """A vial monitor on the label, not just a VVM-like stability curve: most
        COVID-19 vaccines, for one, ship without a VVM."""
        return self.stability_ref.startswith("VVM") and "equivalent" not in self.stability_ref

    def t_life(self, temp_c: float) -> float:
        """Hours until the whole budget is used if held at temp_c."""
        return t_life_hours(self.anchors, temp_c) / self.rate_scale


PRODUCTS: list[ProductProfile] = [
    ProductProfile(
        id="opv",
        name="Oral polio vaccine (OPV)",
        kind="vaccine",
        stability_ref="VVM2",
        anchors=VVM_ANCHORS["VVM2"],
        freeze_sensitive=False,
        freeze_check="",
        storage_min_c=2,
        storage_max_c=8,
        notes="Most heat-sensitive vaccine; not damaged by freezing.",
    ),
    ProductProfile(
        id="mr",
        name="Measles-rubella (MR), freeze-dried",
        kind="vaccine",
        stability_ref="VVM14",
        anchors=VVM_ANCHORS["VVM14"],
        freeze_sensitive=False,
        freeze_check="",
        storage_min_c=2,
        storage_max_c=8,
        notes="The freeze-dried vaccine is not freeze-sensitive; never freeze the diluent.",
    ),
    ProductProfile(
        id="penta",
        name="Pentavalent (DTP-HepB-Hib), liquid",
        kind="vaccine",
        stability_ref="VVM14",
        anchors=VVM_ANCHORS["VVM14"],
        freeze_sensitive=True,
        freeze_check="Run the shake test",
        storage_min_c=2,
        storage_max_c=8,
        notes="VVM category depends on the manufacturer (VVM7 or VVM14).",
    ),
    ProductProfile(
        id="hpv",
        name="HPV vaccine",
        kind="vaccine",
        stability_ref="VVM30",
        anchors=VVM_ANCHORS["VVM30"],
        freeze_sensitive=True,
        freeze_check="Run the shake test",
        storage_min_c=2,
        storage_max_c=8,
    ),
    ProductProfile(
        id="rdt-malaria",
        name="Malaria rapid test (RDT)",
        kind="rapid_test",
        stability_ref="RDT, illustrative",
        anchors=RDT_ANCHORS,
        freeze_sensitive=True,
        freeze_check="Run a positive control",
        storage_min_c=2,
        storage_max_c=30,
        notes="Illustrative stability curve; replace with manufacturer data.",
    ),
    ProductProfile(
        id="rdt-hiv",
        name="HIV rapid test",
        kind="rapid_test",
        stability_ref="RDT, illustrative",
        anchors=RDT_ANCHORS,
        freeze_sensitive=True,
        freeze_check="Run a positive control",
        storage_min_c=2,
        storage_max_c=30,
        notes="Illustrative stability curve; replace with manufacturer data.",
    ),
]

# Products from the lane demo. Anchors marked "illustrative" come from label
# storage claims (days at +2-8 C, hours at room temperature), not from a VVM
# category; replace with manufacturer stability data before real use.
PRODUCTS += [
    ProductProfile(
        id="r21", name="R21/Matrix-M malaria vaccine", kind="vaccine", stability_ref="VVM14 (assumed)",
        anchors=VVM_ANCHORS["VVM14"], freeze_sensitive=True, freeze_check="Run the shake test",
        storage_min_c=2, storage_max_c=8, notes="Adjuvanted: do not freeze. VVM category assumed.",
    ),
    ProductProfile(
        id="rtss", name="RTS,S/AS01 malaria vaccine", kind="vaccine", stability_ref="VVM14 (assumed)",
        anchors=VVM_ANCHORS["VVM14"], freeze_sensitive=True, freeze_check="Run the shake test",
        storage_min_c=2, storage_max_c=8, notes="AS01 adjuvant: do not freeze. VVM category assumed.",
    ),
    ProductProfile(
        id="comirnaty", name="Comirnaty (thawed)", kind="vaccine", stability_ref="label claims, illustrative",
        anchors=((5.0, 10 * 7 * DAY), (25.0, 12.0)), freeze_sensitive=True, freeze_check="Do not use: never refreeze",
        storage_min_c=2, storage_max_c=8, notes="Thawed vials: up to 10 weeks at 2-8 C, hours at room temperature.",
    ),
    ProductProfile(
        id="spikevax", name="Spikevax (thawed)", kind="vaccine", stability_ref="label claims, illustrative",
        anchors=((5.0, 30 * DAY), (25.0, 24.0)), freeze_sensitive=True, freeze_check="Do not use: never refreeze",
        storage_min_c=2, storage_max_c=8, notes="Thawed vials: up to 30 days at 2-8 C, 24 h at 8-25 C.",
    ),
    ProductProfile(
        id="nuvaxovid", name="Nuvaxovid (protein)", kind="vaccine", stability_ref="VVM7-equivalent, illustrative",
        anchors=VVM_ANCHORS["VVM7"], freeze_sensitive=True, freeze_check="Run the shake test",
        storage_min_c=2, storage_max_c=8, notes="Stability anchors assumed equal to VVM7.",
    ),
    ProductProfile(
        id="flucelvax", name="Flucelvax (influenza, cell-based)", kind="vaccine", stability_ref="VVM7-equivalent, illustrative",
        anchors=VVM_ANCHORS["VVM7"], freeze_sensitive=True, freeze_check="Run the shake test",
        storage_min_c=2, storage_max_c=8, notes="Stability anchors assumed equal to VVM7.",
    ),
]

PRODUCTS_BY_ID = {p.id: p for p in PRODUCTS}
