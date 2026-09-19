"""Two sensors in one carrier: the backup covers for the primary.

Backup readings fill any stretch where the primary said nothing, so a dead
primary doesn't leave a hole in the history. Where both read at the same
time, we compare them (two sensors that disagree mean one of them is wrong)
and keep the more cautious one: the reading further from the middle of the
2-8 C range, so the warmer sensor counts when it's hot and the colder one
when it's cold.
"""

import bisect
from dataclasses import dataclass, replace

from app.engine.history import Reading

# The primary counts as silent after this long without a reading.
SILENT_S = 5 * 60
# Readings this close in time are compared with each other.
PAIR_S = 2 * 60
# The middle of the vaccine range: of two readings at once, the one further from it counts.
MID_C = 5.0


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

    backup_times = [r.ts for r in backup]

    def nearest_backup(ts: int) -> Reading | None:
        i = bisect.bisect_left(backup_times, ts)
        near = [backup[j] for j in (i - 1, i) if 0 <= j < len(backup)]
        return min(near, key=lambda r: abs(r.ts - ts)) if near else None

    cautious = []
    for p in primary:
        b = nearest_backup(p.ts)
        if b is not None and abs(b.ts - p.ts) <= PAIR_S and abs(b.temp_c - MID_C) > abs(p.temp_c - MID_C):
            p = replace(p, temp_c=b.temp_c, rh=b.rh if b.rh is not None else p.rh)
        cautious.append(p)

    readings = sorted(cautious + filled, key=lambda r: r.ts)
    return Merged(readings, len(filled), max(diffs) if diffs else None, len(diffs))
