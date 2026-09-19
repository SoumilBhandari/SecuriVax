import type { LiveReading, LiveRecent } from "../types";

type Range = LiveRecent["band"];

export const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** One node's recent readings against the storage range. */
export function LiveChart({ points, band, tall = false }: { points: LiveReading[]; band: Range; tall?: boolean }) {
  if (points.length < 2) return <p className="ui-caption m-0 mt-3">The chart starts at the second reading.</p>;
  const W = 320, H = tall ? 150 : 118, L = 26, R = 8, T = 8, B = 16;
  const temps = points.map((p) => p.temp_c);
  // Zoomed to the signal so it visibly moves; the storage range joins the view
  // once readings come within a few degrees of it, otherwise a note says where it is.
  const NEAR = 4;
  let lo = Math.floor(Math.min(...temps) - 1);
  let hi = Math.ceil(Math.max(...temps) + 1);
  const rangeBelow = band.max_c < lo - NEAR;
  const rangeAbove = band.min_c > hi + NEAR;
  if (!rangeBelow && !rangeAbove) {
    lo = Math.min(lo, Math.floor(band.min_c - 1));
    hi = Math.max(hi, Math.ceil(band.max_c + 1));
  }
  const t0 = points[0].ts;
  const t1 = Math.max(points[points.length - 1].ts, t0 + 1);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (c: number) => T + (1 - (c - lo) / (hi - lo)) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.temp_c).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  const inView = !rangeBelow && !rangeAbove;
  // The chart's top and bottom, and the range edges when they're in view and clear of them.
  const ticks = inView
    ? [band.max_c, band.min_c, ...(hi - band.max_c >= 3 ? [hi] : []), ...(band.min_c - lo >= 3 ? [lo] : [])]
    : [hi, lo];
  const away = rangeBelow ? Math.min(...temps) - band.max_c : band.min_c - Math.max(...temps);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block w-full" role="img" aria-label={`Last ${points.length} readings, ${Math.min(...temps).toFixed(1)} to ${Math.max(...temps).toFixed(1)} °C`}>
        {inView && <rect x={L} y={y(band.max_c)} width={W - L - R} height={y(band.min_c) - y(band.max_c)} fill="var(--band)" />}
        {inView && band.freeze_c > lo && (
          <line x1={L} x2={W - R} y1={y(band.freeze_c)} y2={y(band.freeze_c)} stroke="var(--text-muted)" strokeDasharray="3 3" />
        )}
        {ticks.map((c) => (
          <text key={c} x={L - 5} y={y(c) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">
            {c}°
          </text>
        ))}
        <path d={line} fill="none" stroke="var(--line)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.ts)} cy={y(last.temp_c)} r="4" fill="var(--glacier-500)" stroke="var(--line)" strokeWidth="1.5" />
        <text x={L} y={H - 3} fontSize="9" fill="var(--text-muted)">
          {clock(t0)}
        </text>
        <text x={W - R} y={H - 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">
          {clock(last.ts)}
        </text>
      </svg>
      {!inView && (
        <p className="ui-caption m-0 mt-1">
          The {band.min_c}–{band.max_c} °C range is {Math.round(away)} °C {rangeBelow ? "below" : "above"} this; it joins the chart
          as readings get close.
        </p>
      )}
    </>
  );
}
