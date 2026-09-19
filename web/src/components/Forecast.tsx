import { api } from "../lib/api";
import { eat, fromNow, pct, time } from "../lib/format";
import { usePoll } from "../lib/usePoll";
import type { CarrierForecast } from "../types";

const W = 340;
const H = 140;
const PAD = { l: 30, r: 8, t: 10, b: 20 };

/** The carrier's twin: when it will leave 2–8 °C, and how sure we are. */
export function ForecastCard({ nodeId, boxId, initial }: { nodeId: string; boxId?: string; initial?: CarrierForecast }) {
  const polled = usePoll(() => api.forecast(nodeId), initial ? null : 60000, [nodeId]);
  const data = initial ?? polled.data;

  if (!data && polled.error) return <p className="py-4 text-center text-sm text-muted">Forecast unavailable: {polled.error}</p>;
  if (!data) return <p className="py-4 text-center text-sm text-muted">Running the forecast…</p>;
  if (!data.available) {
    return <p className="text-sm text-slate-500">{data.reason}</p>;
  }
  const { breach, state, forecast, fit, prior } = data;
  if (!breach || !state || !forecast || !prior) return <p className="text-sm text-muted">Forecast incomplete.</p>;
  const range = `2–${data.storage_max_c ?? 8} °C`;
  const box = data.boxes?.find((b) => b.box_id === boxId);
  const likely = breach.prob >= 0.5;
  const already = state.inside_c > (data.storage_max_c ?? 8) || (breach.p50 != null && breach.p50 * 1000 < Date.now());

  return (
    <div>
      <div className={`rounded-xl p-3 ${likely ? "bg-orange-50 text-orange-900" : "bg-emerald-50 text-emerald-900"}`}>
        {already ? (
          <p className="text-sm">
            <span className="text-base font-semibold">Already outside {range}</span>
            <br />
            Inside is {state.inside_c.toFixed(1)} °C now.
          </p>
        ) : likely ? (
          <p className="text-sm">
            <span className="text-base font-semibold">Leaves {range} {fromNow(breach.p50)}</span>
            <br />
            80% range: {eat(breach.p10)} to {breach.p90 ? eat(breach.p90) : "after the forecast window"} ·{" "}
            {pct(breach.prob)} chance within {forecast.horizon_h} h
          </p>
        ) : (
          <p className="text-sm">
            <span className="text-base font-semibold">Stays in range for the next {forecast.horizon_h} h</span>
            <br />
            {pct(1 - breach.prob)} of forecast runs keep it at {range}
          </p>
        )}
      </div>
      <Fan data={data} />
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-slate-500">Ice left</dt>
          <dd className="font-semibold text-slate-800">
            {state.ice_left_h[1]} h <span className="font-normal text-slate-500">({state.ice_left_h[0]}–{state.ice_left_h[2]})</span>
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-slate-500">Cold life (learnt)</dt>
          <dd className="font-semibold text-slate-800">
            {state.effective_cold_life_h[1]} h <span className="font-normal text-slate-500">vs 20 rated</span>
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-slate-500">Model error</dt>
          <dd className="font-semibold text-slate-800">
            {fit?.one_step_rmse_c == null ? "learning…" : `±${fit.one_step_rmse_c.toFixed(2)} °C`}
          </dd>
        </div>
      </dl>
      {box && (
        <p className="mt-2 text-sm text-slate-700">
          This box: {pct(box.p_quarantine_or_worse)} chance of QUARANTINE or worse by the end of the window
          {box.p_freeze != null && box.p_freeze > 0 ? `, ${pct(box.p_freeze)} chance of freezing` : ""}.
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-slate-400">
        Particle filter over the carrier's hidden ice and heat leak ({data.readings} readings, prior from {prior.from}),
        rolled forward through {data.weather_source}.
      </p>
    </div>
  );
}

function Fan({ data }: { data: CarrierForecast }) {
  const f = data.forecast!;
  if (f.times.length < 2) return null;
  const all = [...f.p10, ...f.p90, ...f.outside_p50, 8, 2];
  const lo = Math.floor(Math.min(...all) - 1);
  const hi = Math.ceil(Math.max(...all) + 1);
  const t0 = f.times[0];
  const t1 = f.times[f.times.length - 1];
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (c: number) => PAD.t + ((hi - c) / (hi - lo)) * (H - PAD.t - PAD.b);
  const band =
    f.times.map((t, i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(f.p90[i]).toFixed(1)}`).join("") +
    [...f.times].reverse().map((t, i) => `L${x(t).toFixed(1)},${y(f.p10[f.times.length - 1 - i]).toFixed(1)}`).join("") +
    "Z";
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(f.times[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Forecast of the inside temperature">
        <rect x={PAD.l} width={W - PAD.l - PAD.r} y={y(8)} height={y(2) - y(8)} className="fill-emerald-100" />
        <path d={band} className="fill-sky-200/70" />
        <path d={line(f.outside_p50)} fill="none" className="stroke-orange-400" strokeWidth={1.2} strokeDasharray="4 3" />
        <path d={line(f.p50)} fill="none" className="stroke-sky-700" strokeWidth={1.8} />
        {[lo, 2, 8, hi].map((v) => (
          <text key={v} x={PAD.l - 4} y={y(v) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">
            {v}°
          </text>
        ))}
        <text x={PAD.l} y={H - 5} className="fill-slate-500 text-[10px]">
          {time(f.times[0] - 600)}
        </text>
        <text x={W - PAD.r} y={H - 5} textAnchor="end" className="fill-slate-400 text-[9px]">
          +{f.horizon_h} h
        </text>
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 text-[11px] text-slate-500">
        <span>
          <span className="mr-1 inline-block h-0 w-3 border-t-2 border-sky-700 align-middle" />
          Inside, median
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-3 rounded-sm bg-sky-200 align-middle" />
          80% range
        </span>
        <span>
          <span className="mr-1 inline-block h-0 w-3 border-t-2 border-dashed border-orange-400 align-middle" />
          Outside forecast
        </span>
      </figcaption>
    </figure>
  );
}
