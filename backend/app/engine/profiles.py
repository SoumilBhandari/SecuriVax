"""Product stability profiles.

Every profile is a two-point Arrhenius fit: the hours it takes to use up the
product's whole heat budget at two reference temperatures. For vaccines the
anchors are the WHO vaccine vial monitor (VVM) categories, so budget used maps
directly onto how far the VVM on the vial has progressed. Rapid-test anchors
are illustrative; see RDT_ANCHORS.
"""

from dataclasses import dataclass

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

PRODUCTS_BY_ID = {p.id: p for p in PRODUCTS}
