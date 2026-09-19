"""Naming a cause must never cost us a verdict, an exception, or a stall.

Nothing here reaches the network: the client is stubbed, so these tests say
what happens when Jev answers, when it answers something odd, when it fails,
and when there is no key at all.
"""

import pytest

from app.services import jev


class FakeAnswer:
    def __init__(self, choice, probabilities, confidence=0.9):
        self.choice = choice
        self.probabilities = probabilities
        self.confidence = confidence


class FakeClient:
    """Stands in for TypeSafeClient: counts calls and answers as told."""

    def __init__(self, answer=None, raises=None):
        self.answer = answer
        self.raises = raises
        self.calls = 0

    def system_one(self, state, questions, **kwargs):
        self.calls += 1
        if self.raises:
            raise self.raises
        return type("R", (), {"answers": {"cause": self.answer}})()


@pytest.fixture(autouse=True)
def empty_cache():
    jev._cache.clear()
    yield
    jev._cache.clear()


SUMMARY = "Motorbike carrier. Fell to -2.4 °C within 40 min of packing. Outside ran 21–28 °C."


def test_no_key_uses_the_rules(monkeypatch):
    monkeypatch.setattr(jev, "_client_once", lambda: None)
    cause = jev.likely_cause(SUMMARY, "FROZEN_PACKS")
    assert cause.source == "rules"
    assert cause.cause == "unconditioned_packs"
    assert cause.probability is None


def test_a_leg_that_stayed_in_range_is_not_asked(monkeypatch):
    client = FakeClient(FakeAnswer("hot_vehicle", {"hot_vehicle": 0.9}))
    monkeypatch.setattr(jev, "_client_once", lambda: client)
    cause = jev.likely_cause(SUMMARY, "PROTECTED")
    assert (cause.cause, cause.source) == ("none", "rules")
    assert client.calls == 0


def test_jev_names_the_cause_with_a_probability(monkeypatch):
    client = FakeClient(FakeAnswer("unconditioned_packs", {"unconditioned_packs": 0.92, "ice_ran_out": 0.08}))
    monkeypatch.setattr(jev, "_client_once", lambda: client)
    cause = jev.likely_cause(SUMMARY, "FROZEN_PACKS")
    assert cause.source == "jev"
    assert cause.cause == "unconditioned_packs"
    assert cause.probability == 0.92
    assert cause.label == jev.LABELS["unconditioned_packs"]
    assert cause.ms is not None


def test_the_same_leg_is_asked_once(monkeypatch):
    client = FakeClient(FakeAnswer("ice_ran_out", {"ice_ran_out": 0.7}))
    monkeypatch.setattr(jev, "_client_once", lambda: client)
    jev.likely_cause(SUMMARY, "TRACKING_AMBIENT")
    jev.likely_cause(SUMMARY, "TRACKING_AMBIENT")
    assert client.calls == 1


@pytest.mark.parametrize(
    "client",
    [
        FakeClient(raises=TimeoutError("took too long")),
        FakeClient(raises=RuntimeError("500 from the API")),
        FakeClient(FakeAnswer("something_else", {"something_else": 1.0})),  # off the list
    ],
)
def test_every_failure_falls_back_to_the_rules(monkeypatch, client):
    monkeypatch.setattr(jev, "_client_once", lambda: client)
    cause = jev.likely_cause(SUMMARY, "HEAT_SOURCE")
    assert (cause.cause, cause.source) == ("hot_vehicle", "rules")


def test_the_verdict_never_sees_a_cause(client):
    """The box page carries a cause beside the verdict, not inside it."""
    report = client.get("/api/boxes/BOX-0001/report").json()
    assert "likely_cause" in report
    verdict = report["verdict"]
    for segment in report["segments"]:
        assert segment["cause"]["cause"] in jev.CAUSES
        assert segment["cause"]["source"] == "rules"  # no key in the tests
    assert report["verdict"] == verdict


def test_the_summary_reads_as_a_sentence():
    env = type(
        "E",
        (),
        {
            "code": "FROZEN_PACKS",
            "inside_mean_c": 1.2,
            "ambient_mean_c": 24.5,
            "ambient_min_c": 21.0,
            "ambient_max_c": 28.0,
            "hot_outside_share": 0.62,
            "noise_c": 0.06,
        },
    )()
    text = jev.leg_summary(env, carrier="Motorbike carrier", peak_c=9.1, min_c=-2.4, minutes_to_min=40)
    assert "Motorbike carrier." in text
    assert "-2.4 °C within 40 min" in text
    assert "21–28 °C" in text
