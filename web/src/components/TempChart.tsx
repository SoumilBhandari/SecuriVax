import { time } from "../lib/format";
import type { Product, Segment } from "../types";

const W = 340;
const H = 150;
const PAD = { l: 30, r: 8, t: 10, b: 22 };
const FREEZE_C = -0.5;

/** Temperature across every leg, with the product's safe band shaded. */
export function TempChart({ segments, product }: { segments: Segment[]; product: Product }) {
  const points = segments.flatMap((s) => s.series.map((p) => ({ ...p, node: s.node_id })));
  if (points.length < 2) {
    return <p className="py-6 text-center text-sm text-slate-500">No readings yet.</p>;
  }

  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const temps = points.map((p) => p.temp_c);
  const lo = Math.floor(Math.min(...temps, FREEZE_C, product.storage_min_c) - 2);
  const hi = Math.ceil(Math.max(...temps, product.storage_max_c) + 2);
  const x = (ts: number) => PAD.l + ((ts - t0) / Math.max(t1 - t0, 1)) * (W - PAD.l - PAD.r);
  const y = (c: number) => PAD.t + ((hi - c) / (hi - lo)) * (H - PAD.t - PAD.b);

  // One path per leg, so the line doesn't jump across time spent between legs.
  const paths = segments
    .filter((s) => s.series.length > 1)
    .map((s) => s.series.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.temp_c).toFixed(1)}`).join(""));
  const ticks = [lo, product.storage_min_c, product.storage_max_c, hi].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Temperature over time">
        <rect
          x={PAD.l}
          width={W - PAD.l - PAD.r}
          y={y(product.storage_max_c)}
          height={y(product.storage_min_c) - y(product.storage_max_c)}
          className="fill-emerald-100"
        />
        {lo < FREEZE_C && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(FREEZE_C)} y2={y(FREEZE_C)} className="stroke-violet-400" strokeDasharray="3 3" />
        )}
        {ticks.map((v) => (
          <text key={v} x={PAD.l - 4} y={y(v) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">
            {v}°
          </text>
        ))}
        {segments.slice(1).map((s) => (
          <line key={s.start_ts} x1={x(s.start_ts)} x2={x(s.start_ts)} y1={PAD.t} y2={H - PAD.b} className="stroke-slate-300" />
        ))}
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" className="stroke-slate-800" strokeWidth={1.5} strokeLinejoin="round" />
        ))}
        {points
          .filter((p) => p.temp_c > product.storage_max_c || p.temp_c <= FREEZE_C)
          .map((p) => (
            <circle
              key={`${p.node}-${p.ts}`}
              cx={x(p.ts)}
              cy={y(p.temp_c)}
              r={1.8}
              className={p.temp_c <= FREEZE_C ? "fill-violet-600" : "fill-red-500"}
            />
          ))}
        <text x={PAD.l} y={H - 6} className="fill-slate-400 text-[9px]">
          {time(t0)}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-slate-400 text-[9px]">
          {time(t1)}
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>
          <span className="mr-1 inline-block h-2 w-3 rounded-sm bg-emerald-100 align-middle" />
          Safe range {product.storage_min_c}–{product.storage_max_c} °C
        </span>
        <span>
          <span className="mr-1 inline-block h-0 w-3 border-t border-dashed border-violet-400 align-middle" />
          Freeze line
        </span>
      </figcaption>
    </figure>
  );
}
