"""Give readings a position from a separate location track.

The node itself may have no GPS; a Samsung SmartTag (or a phone) in the same
carrier reports where it is every so often. Each reading gets the carrier's
position at that moment, interpolated between the nearest fixes.
"""

import bisect
from dataclasses import replace

from app.engine.history import Reading

# Don't draw a straight line across a stretch longer than this.
MAX_INTERPOLATE_S = 2 * 60 * 60
# A lone fix counts for readings this close to it.
MAX_NEAREST_S = 30 * 60


def position_at(track: list[tuple[int, float, float]], ts: int) -> tuple[float, float] | None:
    """track: (ts, lat, lon) sorted by ts."""
    if not track:
        return None
    i = bisect.bisect_left(track, (ts,))
    after = track[i] if i < len(track) else None
    before = track[i - 1] if i > 0 else None
    if after and after[0] == ts:
        return after[1], after[2]
    if before and after and after[0] - before[0] <= MAX_INTERPOLATE_S:
        f = (ts - before[0]) / (after[0] - before[0])
        return before[1] + (after[1] - before[1]) * f, before[2] + (after[2] - before[2]) * f
    nearest = min((p for p in (before, after) if p), key=lambda p: abs(p[0] - ts))
    if abs(nearest[0] - ts) <= MAX_NEAREST_S:
        return nearest[1], nearest[2]
    return None


def attach_positions(readings: list[Reading], track: list[tuple[int, float, float]]) -> list[Reading]:
    """Fill lat/lon on readings that have none. Readings with their own GPS win."""
    track = sorted(track)
    out = []
    for r in readings:
        if r.lat is None and (pos := position_at(track, r.ts)):
            r = replace(r, lat=pos[0], lon=pos[1])
        out.append(r)
    return out
