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
    <section className="panel p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="ui-heading m-0">Every confirmed VVM photo calibrates the model</h2>
        {data.photos > 0 && <span className="ui-caption shrink-0">{data.photos} field photo{data.photos === 1 ? "" : "s"}</span>}
      </div>
      <p className="m-0 text-neutral-300">
        Each VVM photo a health worker confirms is a real-world reading of how far a vial degraded, next to the heat our
        record measured. Together they show whether a product is faster or slower than its label says; verdicts speed
        up at once when it is faster, and relax only when the evidence is strong.
      </p>
      {learnt.length === 0 ? (
        <p className="ui-caption m-0 mt-3 rounded-xl bg-neutral-900 p-3">
          Try it: open any vaccine box, tap Scan the VVM label and photograph it. Once you confirm the reading, that
          product's line appears here with its learned speed. Until then every product runs on its label's curve.
        </p>
      ) : (
        <ul className="m-0 mt-3 list-none p-0">
          {learnt.map((p) => (
            <li key={p.product_id} className="border-t border-line py-3 first:border-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="m-0 truncate font-bold">{p.name}</p>
                <p className="m-0 shrink-0 text-sm tabular-nums">
                  <b>{p.median.toFixed(2)}×</b> <span className="text-xs text-neutral-500">({p.p10.toFixed(2)}–{p.p90.toFixed(2)})</span>
                </p>
              </div>
              <SpeedBar lo={p.p10} mid={p.median} hi={p.p90} />
              <p className="ui-caption m-0 mt-1">
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
    <div className="relative mt-2 h-3 rounded-full bg-neutral-800" aria-hidden>
      <div className="absolute inset-y-0 rounded-full" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})`, background: "var(--ring-track)" }} />
      <div className="absolute -top-0.5 h-4 w-0.5 bg-text/60" style={{ left: x(1) }} />
      <div className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-text" style={{ left: x(mid) }} />
    </div>
  );
}
