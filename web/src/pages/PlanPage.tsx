import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { Card, ErrorNote, Layout, Spinner } from "../components/Layout";
import { api } from "../lib/api";
import { eat, weatherSource } from "../lib/format";
import type { Facility, NodeSummary, Product, TripOption, TripPlan } from "../types";

/** When should a carrier leave, and where should which stock go? */
export default function PlanPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Facility[]>([]);
  const [carriers, setCarriers] = useState<NodeSummary[]>([]);
  // Plans can be shared as links: /plan?product=opv&carrier=CAR-02
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    product_id: params.get("product") ?? "opv",
    origin_id: params.get("from") ?? "KSM-STORE",
    carrier_id: params.get("carrier") ?? "",
    session_h: Number(params.get("hours") ?? 6),
  });
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.facilities().then((f) => setStores(f.filter((x) => x.kind === "store"))).catch(() => {});
    api.nodes().then((n) => setCarriers(n.filter((x) => x.kind === "carrier" && !x.backup_for))).catch(() => {});
  }, []);

  const run = () => {
    setBusy(true);
    setError(null);
    api
      .plan({ ...form, carrier_id: form.carrier_id || null })
      .then(setPlan)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  // Plan once on arrival with the defaults.
  useEffect(run, []);

  const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <Layout back>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Trip planner</h1>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-slate-600">
        Uses the weather forecast and a carrier's real cold life to predict every daylight departure over the next two
        days, for every clinic.
      </p>

      <Card>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs text-slate-500">
            Product
            <select className={field} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.stability_ref})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            From
            <select className={field} value={form.origin_id} onChange={(e) => setForm({ ...form, origin_id: e.target.value })}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Hours at the site
            <select className={field} value={form.session_h} onChange={(e) => setForm({ ...form, session_h: Number(e.target.value) })}>
              {[2, 4, 6, 8].map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 text-xs text-slate-500">
            Carrier
            <select className={field} value={form.carrier_id} onChange={(e) => setForm({ ...form, carrier_id: e.target.value })}>
              <option value="">A carrier performing as rated (20 h)</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} (use its measured cold life)
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Forecasting…" : "Plan trips"}
        </button>
      </Card>

      {error && <ErrorNote error={error} />}
      {busy && !plan && <Spinner label="Running the forecast" />}
      {plan && <PlanResult plan={plan} />}
    </Layout>
  );
}

function PlanResult({ plan }: { plan: TripPlan }) {
  return (
    <>
      <Card title="Recommendation" aside={plan.product.name}>
        <ul className="space-y-2">
          {plan.recommendations.map((r) => (
            <li key={r} className="text-sm leading-snug text-slate-800">
              {r}
            </li>
          ))}
        </ul>
        {plan.stock_advice.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3">
            {plan.stock_advice.map((a) => (
              <p key={a} className="text-sm text-amber-900">
                {a}
              </p>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-400">
          {weatherSource(plan.source)} · {plan.assumptions}
        </p>
      </Card>

      <Card title="Every departure" aside="green: stays 2–8 °C">
        <div className="space-y-4">
          {plan.destinations.map((d) => (
            <div key={d.id}>
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium text-slate-900">{d.name}</p>
                <p className="text-xs text-slate-500">
                  {d.km} km · {d.travel_h} h drive
                </p>
              </div>
              <Strip options={d.options} best={d.best} />
              <p className="mt-1 text-xs text-slate-600">
                Best: leave {eat(d.best.depart_ts)}, max {d.best.max_inside_c.toFixed(1)} °C inside, +
                {(d.best.budget_used * 100).toFixed(1)}% budget
                {d.best.breach_ts ? `, above ${plan.product.storage_max_c} °C from ${eat(d.best.breach_ts)}` : ""}
              </p>
              {d.rated_best && d.best.breach_ts && !d.rated_best.breach_ts && (
                <p className="text-xs text-emerald-700">A carrier at its rated cold life would stay in range on this run.</p>
              )}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function Strip({ options, best }: { options: TripOption[]; best: TripOption }) {
  const worst = Math.max(...options.map((o) => o.budget_used), 1e-6);
  return (
    <div className="mt-1.5 flex gap-0.5" role="list" aria-label="Departure options">
      {options.map((o) => {
        const heat = o.budget_used / worst;
        const color = o.breach_ts
          ? heat > 0.66
            ? "bg-red-500"
            : heat > 0.33
              ? "bg-orange-400"
              : "bg-amber-300"
          : "bg-emerald-400";
        return (
          <div
            key={o.depart_ts}
            role="listitem"
            title={`${eat(o.depart_ts)}: +${(o.budget_used * 100).toFixed(1)}%, max ${o.max_inside_c} °C`}
            className={`h-6 flex-1 rounded-sm ${color} ${o.depart_ts === best.depart_ts ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
          />
        );
      })}
    </div>
  );
}
