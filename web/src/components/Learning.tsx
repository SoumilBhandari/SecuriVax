import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { LearningSummary } from "../types";

/**
 * Crowdsourced calibration: what confirmed VVM photos have taught the model
 * about each product's real degradation speed.
 */
export function LearningCard() {
  const [data, setData] = useState<LearningSummary | null>(null);
  useEffect(() => {
    api.learning().then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  const learnt = data.products.filter((p) => p.photos > 0);
  return (
    <section className="mb-4 rounded-2xl border border-line bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">The model learns from every confirmed label</h2>
        <span className="text-xs text-muted">{data.photos} field photo{data.photos === 1 ? "" : "s"}</span>
      </div>
      <p className="text-sm leading-snug text-muted">
        Each VVM photo a health worker confirms is a real-world reading of how far a vial degraded, next to the heat our
        record measured. Together they show whether a product is faster or slower than its label says; verdicts speed
        up at once when it is faster, and relax only when the evidence is strong.
      </p>
      {learnt.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-muted">
          No confirmed photos yet: every product runs on its label's curve.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {learnt.map((p) => (
            <li key={p.product_id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="shrink-0 text-sm tabular-nums">
                  <b>{p.median.toFixed(2)}×</b> <span className="text-xs text-muted">({p.p10.toFixed(2)}–{p.p90.toFixed(2)})</span>
                </p>
              </div>
              <SpeedBar lo={p.p10} mid={p.median} hi={p.p90} />
              <p className="mt-1 text-xs text-muted">
                {p.photos} photo{p.photos === 1 ? "" : "s"} · {p.note}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Learned speed on a 0.5x to 2x scale, with the label's 1x marked. */
function SpeedBar({ lo, mid, hi }: { lo: number; mid: number; hi: number }) {
  const x = (k: number) => `${((Math.log(Math.min(Math.max(k, 0.5), 2)) - Math.log(0.5)) / (Math.log(2) - Math.log(0.5))) * 100}%`;
  return (
    <div className="relative mt-1.5 h-3 rounded-full bg-slate-100" aria-hidden>
      <div className="absolute inset-y-0 rounded-full bg-cold/25" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
      <div className="absolute -top-0.5 h-4 w-0.5 bg-ink/50" style={{ left: x(1) }} />
      <div className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-cold" style={{ left: x(mid) }} />
    </div>
  );
}
