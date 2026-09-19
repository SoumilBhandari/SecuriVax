import { useMemo, useState } from "react";

import { humidity, pct, temp, time } from "../lib/format";
import type { Product, Segment } from "../types";

const W = 360;
const L = 32;
const R = 30;

/**
 * Temperature and humidity across every custody change, the cumulative
 * stability budget under it, and a scrubber to replay the trip.
 */
export function HistoryScrubber({ segments, product, budgetUsed }: { segments: Segment[]; product: Product; budgetUsed: number }) {
  const points = useMemo(() => segments.flatMap((s) => s.series), [segments]);
  const outside = useMemo(() => segments.flatMap((s) => s.environment?.ambient ?? []), [segments]);
  const [at, setAt] = useState<number | null>(null);
  if (points.length < 2) return <p className="py-6 text-center text-sm text-muted">No readings yet.</p>;

  const i = at ?? points.length - 1;
  const p = points[Math.min(i, points.length - 1)];
  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const temps = [...points.map((q) => q.temp_c), ...outside.map(([, c]) => c), product.storage_min_c, product.storage_max_c];
  const lo = Math.floor(Math.min(...temps) - 1);
  const hi = Math.ceil(Math.max(...temps) + 1);
  const x = (ts: number) => L + ((ts - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
  const H1 = 150;
  const y = (c: number) => 8 + ((hi - c) / (hi - lo)) * (H1 - 26);
  const yRh = (h: number) => 8 + ((100 - h) / 100) * (H1 - 26);
  const H2 = 90;
  const bMax = Math.max(1.05, budgetUsed * 1.05);
  const yb = (b: number) => 8 + ((bMax - b) / bMax) * (H2 - 24);

  const path = (vals: [number, number][], fy: (v: number) => number) =>
    vals.map(([ts, v], k) => `${k ? "L" : "M"}${x(ts).toFixed(1)},${fy(v).toFixed(1)}`).join("");
  const byLeg = segments.filter((s) => s.series.length > 1);
  const rh = points.filter((q) => q.rh != null).map((q) => [q.ts, q.rh as number] as [number, number]);
  const budget = points.map((q) => [q.ts, q.budget] as [number, number]);
  const area = `${path(budget, yb)}L${x(t1)},${yb(0)}L${x(t0)},${yb(0)}Z`;
  const hot = points.filter((q) => q.temp_c > product.storage_max_c).length;
  const cold = points.filter((q) => q.temp_c <= -0.5).length;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H1}`} className="w-full" role="img"
        aria-label={`Temperature ${temp(Math.min(...points.map((q) => q.temp_c)))} to ${temp(Math.max(...points.map((q) => q.temp_c)))}; ${hot} readings above ${product.storage_max_c} °C, ${cold} at or below freezing`}>
        <rect x={L} width={W - L - R} y={y(product.storage_max_c)} height={y(product.storage_min_c) - y(product.storage_max_c)} className="fill-emerald-100" />
        {segments.slice(1).map((s) => (
          <line key={s.start_ts} x1={x(s.start_ts)} x2={x(s.start_ts)} y1={6} y2={H1 - 18} className="stroke-slate-300" strokeDasharray="3 3" />
        ))}
        {outside.length > 1 && <path d={path(outside, y)} fill="none" className="stroke-orange-300" strokeWidth={1} strokeDasharray="4 3" />}
        {rh.length > 1 && <path d={path(rh, yRh)} fill="none" className="stroke-sky-400" strokeWidth={1} strokeDasharray="2 2" />}
        {byLeg.map((s) => (
          <path key={s.start_ts} d={path(s.series.map((q) => [q.ts, q.temp_c]), y)} fill="none" className="stroke-cold" strokeWidth={1.8} />
        ))}
        <line x1={x(p.ts)} x2={x(p.ts)} y1={6} y2={H1 - 18} className="stroke-ink" />
        <circle cx={x(p.ts)} cy={y(p.temp_c)} r={3.5} className="fill-white stroke-ink" strokeWidth={1.5} />
        {axisLabels([product.storage_max_c, product.storage_min_c, hi, lo], y).map((v) => (
          <text key={v} x={L - 4} y={y(v) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">{v}°</text>
        ))}
        <text x={W - R + 4} y={yRh(100) + 3} className="fill-sky-600 text-[10px]">100%</text>
        <text x={W - R + 4} y={yRh(0) + 3} className="fill-sky-600 text-[10px]">0%</text>
      </svg>
      <p className="mt-1 text-xs font-bold uppercase tracking-wider text-muted">Cumulative stability budget</p>
      <svg viewBox={`0 0 ${W} ${H2}`} className="w-full" role="img" aria-label={`Budget grew to ${pct(budgetUsed)} over the trip`}>
        {[0.4, 0.75, 1].map((m) => (
          <g key={m}>
            <line x1={L} x2={W - R} y1={yb(m)} y2={yb(m)} className={m === 1 ? "stroke-bad" : "stroke-slate-300"} strokeDasharray="4 3" />
            <text x={W - R + 4} y={yb(m) + 3} className={`text-[10px] ${m === 1 ? "fill-bad" : "fill-slate-500"}`}>{m * 100}%</text>
          </g>
        ))}
        <path d={area} className="fill-amber-200/60" />
        <path d={path(budget, yb)} fill="none" className="stroke-warn" strokeWidth={1.8} />
        <line x1={x(p.ts)} x2={x(p.ts)} y1={6} y2={H2 - 16} className="stroke-ink" />
        <circle cx={x(p.ts)} cy={yb(p.budget)} r={3.5} className="fill-warn stroke-white" strokeWidth={1.5} />
      </svg>
      <label className="mt-2 flex items-center gap-3 text-sm">
        <span className="shrink-0 text-muted">Scrub time</span>
        <input type="range" min={0} max={points.length - 1} step={1} value={i} onChange={(e) => setAt(Number(e.target.value))}
          className="w-full accent-[var(--color-cold)]" aria-label="Scrub through the trip" />
      </label>
      <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs" aria-live="polite">
        {time(p.ts)} · {temp(p.temp_c)} · {humidity(p.rh)} RH · {(p.budget * 100).toFixed(1)}% budget used
      </p>
      <figcaption className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span><span className="mr-1 inline-block h-0 w-3 border-t-2 border-cold align-middle" />Temperature</span>
        <span><span className="mr-1 inline-block h-0 w-3 border-t-2 border-dashed border-sky-400 align-middle" />Humidity</span>
        {outside.length > 1 && <span><span className="mr-1 inline-block h-0 w-3 border-t-2 border-dashed border-orange-300 align-middle" />Outside air</span>}
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-emerald-100 align-middle" />Labelled range {product.storage_min_c}–{product.storage_max_c} °C</span>
        <span>Dashed verticals: custody changes. Excursions add damage; cold readings can't buy it back.</span>
      </figcaption>
    </figure>
  );
}

/** Axis ticks in priority order, dropping any that would overlap one already kept. */
function axisLabels(values: number[], fy: (v: number) => number, gap = 11): number[] {
  const kept: number[] = [];
  for (const v of values) if (kept.every((k) => Math.abs(fy(k) - fy(v)) >= gap)) kept.push(v);
  return kept;
}
