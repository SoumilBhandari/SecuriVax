import { time } from "../lib/format";
import type { Product, Segment } from "../types";

/**
 * Temperature over the whole trip against the labelled range, then the heat
 * budget it used up, on the same time axis. Dotted lines mark a change of hands.
 */
export function TripChart({ segments, product, budgetUsed }: { segments: Segment[]; product: Product; budgetUsed: number }) {
  const pts = segments.flatMap((s) => s.series);
  if (pts.length < 2) return <p className="m-0 text-neutral-500">No readings yet.</p>;

  const t0 = pts[0].ts;
  const t1 = pts[pts.length - 1].ts;
  const temps = [...pts.map((p) => p.temp_c), product.storage_min_c, product.storage_max_c];
  const lo = Math.floor(Math.min(...temps) - 1);
  const hi = Math.ceil(Math.max(...temps) + 1);
  const sx = (t: number) => 30 + ((t - t0) / Math.max(t1 - t0, 1)) * 300;
  const sy = (c: number) => 8 + ((hi - c) / (hi - lo)) * 104;
  const bmax = Math.max(1.05, budgetUsed * 1.05);
  const sb = (b: number) => 4 + ((bmax - b) / bmax) * 52;
  const path = (vals: [number, number][], fy: (v: number) => number) =>
    vals.map(([t, v], i) => `${i ? "L" : "M"}${sx(t).toFixed(1)},${fy(v).toFixed(1)}`).join("");

  const tempPath = segments
    .filter((s) => s.series.length > 1)
    .map((s) => path(s.series.map((p) => [p.ts, p.temp_c]), sy))
    .join("");
  const budgetPath = `${path(pts.map((p) => [p.ts, p.budget]), sb)}L330,${sb(0).toFixed(1)}L30,${sb(0).toFixed(1)}Z`;
  const maxPct = (sy(product.storage_max_c) / 124) * 100;
  const minPct = (sy(product.storage_min_c) / 124) * 100;

  return (
    <figure className="m-0">
      <div className="relative">
        <span className="absolute left-0 -translate-y-1/2 text-xs text-neutral-500" style={{ top: `${maxPct}%` }}>
          {product.storage_max_c}°
        </span>
        <span className="absolute left-0 -translate-y-1/2 text-xs text-neutral-500" style={{ top: `${minPct}%` }}>
          {product.storage_min_c}°
        </span>
        <svg viewBox="0 0 340 124" className="block w-full" role="img"
          aria-label={`Temperature over the trip, ${Math.min(...pts.map((p) => p.temp_c)).toFixed(1)} to ${Math.max(...pts.map((p) => p.temp_c)).toFixed(1)} °C`}>
          <rect x="30" y={sy(product.storage_max_c)} width="300" height={sy(product.storage_min_c) - sy(product.storage_max_c)} fill="var(--band)" />
          {segments.slice(1).map((s) => (
            <line key={s.start_ts} x1={sx(s.start_ts)} x2={sx(s.start_ts)} y1="6" y2="116" stroke="var(--ink-300)" strokeDasharray="3 3" />
          ))}
          <path d={tempPath} fill="none" stroke="var(--line)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <p className="eyebrow m-0 mb-2 mt-4">Budget used over time</p>
      <svg viewBox="0 0 340 62" className="block w-full" role="img" aria-label={`Heat budget used, now ${Math.round(budgetUsed * 100)}%`}>
        <line x1="30" x2="330" y1={sb(1)} y2={sb(1)} stroke="var(--text-muted)" strokeDasharray="4 3" />
        <text x="328" y={sb(1) - 4} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--text-muted)">
          100%
        </text>
        <path d={budgetPath} fill="var(--glacier-300)" fillOpacity={0.7} stroke="var(--line)" strokeWidth="1.75" />
      </svg>
      <div className="ui-caption mt-1 flex justify-between">
        <span>{time(t0, segments[0].tz)}</span>
        <span>{time(t1, segments[segments.length - 1].tz)}</span>
      </div>
      <figcaption className="ui-caption mt-3">
        The pale band is the labelled safe range. Dotted lines mark a change of hands. Heat adds damage; cold can't buy it back.
      </figcaption>
    </figure>
  );
}
