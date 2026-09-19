"""Shared bits for the eval suites: a metric with a threshold, and a suite."""

from dataclasses import asdict, dataclass, field
from typing import Callable


@dataclass
class Metric:
    name: str
    value: float
    target: float | None  # None: reported for context, not scored
    higher_is_better: bool = True
    unit: str = ""
    note: str = ""

    @property
    def passed(self) -> bool:
        if self.target is None:
            return True
        return self.value >= self.target if self.higher_is_better else self.value <= self.target

    def to_dict(self) -> dict:
        return asdict(self) | {"passed": self.passed}


@dataclass
class SuiteResult:
    name: str
    description: str
    metrics: list[Metric]
    seconds: float = 0.0
    details: dict = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return all(m.passed for m in self.metrics)


Suite = Callable[[bool], SuiteResult]  # quick: bool -> result


def fmt(value: float, unit: str) -> str:
    if unit == "%":
        return f"{value * 100:.1f}%"
    if unit in ("ms", "s", "°C", "h", "kB", "doses"):
        return f"{value:.3g} {unit}"
    return f"{value:.3g}"
