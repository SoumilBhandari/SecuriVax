import type { ReactNode } from "react";

import { api } from "../lib/api";
import { pct } from "../lib/format";
import { usePoll } from "../lib/usePoll";
import type { CarrierForecast } from "../types";
import { DataList } from "./Brand";

function until(ts: number | null | undefined): string {
  if (!ts) return "soon";
  const h = (ts - Date.now() / 1000) / 3600;
  return h < 0 ? "now" : h < 1 ? `in ${Math.round(h * 60)} min` : `in ${h.toFixed(1)} h`;
}

/** One sentence: will this carrier keep its boxes in range, and until when? */
export function forecastLine(fc: CarrierForecast): string {
  const max = fc.storage_max_c ?? 8;
  const { breach, state, forecast } = fc;
  if (!breach || !state || !forecast) return "Forecast incomplete.";
  if (state.inside_c > max) return `Already above ${max} °C. Inside is ${state.inside_c.toFixed(1)} °C now.`;
  if (breach.prob >= 0.5) return `Leaves 2–${max} °C ${until(breach.p50)}. ${pct(breach.prob)} chance within ${forecast.horizon_h} h.`;
  return `Stays in range for the next ${forecast.horizon_h} h. ${pct(1 - breach.prob)} of forecast runs keep it at 2–${max} °C.`;
}

export function forecastAtRisk(fc: CarrierForecast): boolean {
  return !!fc.breach && !!fc.state && (fc.breach.prob >= 0.5 || fc.state.inside_c > (fc.storage_max_c ?? 8));
}

/** The carrier's twin: how long the cold lasts, with the forecast fan behind it. */
export function ForecastCard({ nodeId, boxId, initial }: { nodeId: string; boxId?: string; initial?: CarrierForecast }) {
  const polled = usePoll(() => api.forecast(nodeId), initial ? null : 60000, [nodeId]);
  const data = initial ?? polled.data;

  if (!data && polled.error) return <Note>Forecast unavailable: {polled.error}</Note>;
  if (!data) return <Note>Running the forecast…</Note>;
  if (!data.available) return <Note>{data.reason}</Note>;
  const { state, forecast, fit, prior } = data;
  if (!state || !forecast || !prior) return <Note>Forecast incomplete.</Note>;
  const box = data.boxes?.find((b) => b.box_id === boxId);

  return (
    <section className="card-soft p-4">
      <p className="eyebrow m-0 mb-2">Forecast{forecastAtRisk(data) ? " · at risk" : ""}</p>
      <p className="ui-heading m-0 mb-4">{forecastLine(data)}</p>
      <Fan data={data} />
      <div className="ui-caption mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <span>— inside</span>
        <span>- - outside</span>
        <span>▬ likely range</span>
        <span>▬ 2–{data.storage_max_c ?? 8} °C</span>
      </div>
      <div className="mt-3">
        <DataList
          rows={[
            { label: "Ice left", value: `${state.ice_left_h[1]} h (${state.ice_left_h[0]}–${state.ice_left_h[2]} likely)` },
            { label: "Cold life", value: `${state.effective_cold_life_h[1]} h (rated ${state.rated_cold_life_h ?? 20})` },
            { label: "Outside now", value: `${state.outside_c.toFixed(0)} °C` },
          ]}
        />
      </div>
      {box && (
        <p className="m-0 mt-3">
          {box.verdict_now === "DISCARD"
            ? "This box is already past its end point."
            : box.verdict_now === "QUARANTINE"
              ? `This box is already held: ${pct(box.p_discard)} chance it reaches DISCARD by the end of the window.`
              : `This box: ${pct(box.p_quarantine_or_worse)} chance it needs QUARANTINE or worse by the end of the window.`}
        </p>
      )}
      <p className="ui-caption m-0 mt-3">
        Particle filter over the carrier's hidden ice and heat leak ({data.readings} readings
        {fit?.one_step_rmse_c != null ? `, tracking to ±${fit.one_step_rmse_c.toFixed(2)} °C` : ""}; prior from {prior.from}),
        rolled forward through {data.weather_source}.
      </p>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 rounded-2xl border border-line bg-surface p-4 text-neutral-500">{children}</p>;
}

function Fan({ data }: { data: CarrierForecast }) {
  const f = data.forecast!;
  if (f.times.length < 2) return null;
  const max = data.storage_max_c ?? 8;
  const all = [...f.p10, ...f.p90, ...f.outside_p50, max, 2];
  const lo = Math.floor(Math.min(...all) - 1);
  const hi = Math.ceil(Math.max(...all) + 1);
  const t0 = f.times[0];
  const t1 = f.times[f.times.length - 1];
  const sx = (t: number) => 30 + ((t - t0) / (t1 - t0)) * 300;
  const sy = (c: number) => 8 + ((hi - c) / (hi - lo)) * 104;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${sx(f.times[i]).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  const band =
    line(f.p90) +
    [...f.times].reverse().map((t, i) => `L${sx(t).toFixed(1)},${sy(f.p10[f.times.length - 1 - i]).toFixed(1)}`).join("") +
    "Z";
  return (
    <figure className="m-0">
      <svg viewBox="0 0 340 124" className="block w-full" role="img" aria-label="Forecast of the inside temperature">
        <rect x="30" y={sy(max)} width="300" height={sy(2) - sy(max)} fill="var(--band)" />
        <path d={band} fill="var(--line)" opacity=".1" />
        <path d={line(f.outside_p50)} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={line(f.p50)} fill="none" stroke="var(--line)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x="26" y={sy(max) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{max}°</text>
        <text x="26" y={sy(2) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">2°</text>
      </svg>
      <div className="ui-caption mt-0.5 flex justify-between">
        <span>now</span>
        <span>+{f.horizon_h} h</span>
      </div>
    </figure>
  );
}
