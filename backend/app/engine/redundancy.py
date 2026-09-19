"""Two nodes in one carrier: the backup covers for the primary.

Primary readings are used as-is. Backup readings fill any stretch where the
primary said nothing, so a dead primary doesn't leave a hole in the history.
Where both reported at the same time, we compare them: two sensors that
disagree mean one of them is wrong.
"""

import bisect
from dataclasses import dataclass

from app.engine.history import Reading

# The primary counts as silent after this long without a reading.
SILENT_S = 5 * 60
# Readings this close in time are compared with each other.
PAIR_S = 2 * 60


@dataclass
class Merged:
    readings: list[Reading]
    backup_filled: int
    max_disagreement_c: float | None
    pairs: int


def merge(primary: list[Reading], backup: list[Reading]) -> Merged:
    primary = sorted(primary, key=lambda r: r.ts)
    backup = sorted(backup, key=lambda r: r.ts)
    times = [r.ts for r in primary]

    def nearest_primary(ts: int) -> Reading | None:
        i = bisect.bisect_left(times, ts)
        near = [primary[j] for j in (i - 1, i) if 0 <= j < len(primary)]
        return min(near, key=lambda r: abs(r.ts - ts)) if near else None

    filled, diffs = [], []
    for b in backup:
        p = nearest_primary(b.ts)
        if p is None or abs(p.ts - b.ts) > SILENT_S:
            filled.append(b)
        elif abs(p.ts - b.ts) <= PAIR_S:
            diffs.append(abs(p.temp_c - b.temp_c))

    readings = sorted(primary + filled, key=lambda r: r.ts)
    return Merged(readings, len(filled), max(diffs) if diffs else None, len(diffs))
