import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { ErrorNote, Layout, SectionTitle, Spinner } from "../components/Layout";
import { api } from "../lib/api";
import { time, weatherSource } from "../lib/format";
import type { Facility, NodeSummary, Product, TripOption, TripPlan } from "../types";

/** When should a carrier leave, and where should which stock go? */
export default function PlanPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Facility[]>([]);
  const [carriers, setCarriers] = useState<NodeSummary[]>([]);
  // Plans can be shared as links: /plan?product=opv&carrier=GH-TRK
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    product_id: params.get("product") ?? "opv",
    origin_id: params.get("from") ?? "",
    carrier_id: params.get("carrier") ?? "",
    session_h: Number(params.get("hours") ?? 6),
  });
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api
      .facilities()
      .then((f) => {
        const found = f.filter((x) => x.kind === "store");
        setStores(found);
        // A link or default for a store this deployment doesn't have: start from its first store.
        setForm((prev) => (found.some((x) => x.id === prev.origin_id) ? prev : { ...prev, origin_id: found[0]?.id ?? "" }));
      })
      .catch(() => {})
      .finally(() => setReady(true));
    api
      .nodes()
      .then((n) => setCarriers(n.filter((x) => (x.kind === "carrier" || x.kind === "cold_box") && !x.backup_for)))
      .catch(() => {});
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

  // Plan once on arrival, once the stores (and so a real origin) are known.
  useEffect(() => {
    if (ready) run();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout>
      <h1 className="m-0 mb-2 mt-[26px] text-[34px] leading-[1.05]">Trip planner</h1>
      <p className="m-0 mb-5 text-[15px] leading-[1.45] text-neutral-300">
        The weather forecast and a carrier's real cold life, run for every daylight departure over the next two days to
        every clinic.
      </p>

      <section className="panel grid grid-cols-2 gap-3 p-5">
        <Field label="Product" wide>
          <select className="select-pill w-full" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.stability_ref})
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <select className="select-pill w-full" value={form.origin_id} onChange={(e) => setForm({ ...form, origin_id: e.target.value })}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hours at the site">
          <select className="select-pill w-full" value={form.session_h} onChange={(e) => setForm({ ...form, session_h: Number(e.target.value) })}>
            {[2, 4, 6, 8].map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </select>
        </Field>
        <Field label="Carrier" wide>
          <select className="select-pill w-full" value={form.carrier_id} onChange={(e) => setForm({ ...form, carrier_id: e.target.value })}>
            <option value="">A carrier performing as rated (20 h)</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} (its measured cold life)
              </option>
            ))}
          </select>
        </Field>
        <button onClick={run} disabled={busy} className="btn-accent col-span-2 mt-1">
          {busy ? "Forecasting…" : "Plan trips"}
        </button>
      </section>

      {error && <ErrorNote error={error} />}
      {busy && !plan && <Spinner label="Running the forecast" />}
      {plan && <PlanResult plan={plan} />}
    </Layout>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs text-neutral-400 ${wide ? "col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

function PlanResult({ plan }: { plan: TripPlan }) {
  return (
    <>
      <SectionTitle aside={plan.product.name}>Recommendation</SectionTitle>
      <section className="rounded-[14px] bg-accent-900 p-[22px] text-accent-200">
        {plan.recommendations.map((r) => (
          <p key={r} className="m-0 mb-2 text-base leading-[1.45] last:mb-0">
            {r}
          </p>
        ))}
        {plan.stock_advice.length > 0 && (
          <div className="mt-3 rounded-lg p-3" style={{ background: "var(--color-warn-tint)", color: "var(--color-warn-fg)" }}>
            {plan.stock_advice.map((a) => (
              <p key={a} className="m-0 text-sm">
                {a}
              </p>
            ))}
          </div>
        )}
        <p className="m-0 mt-3 text-xs opacity-75">
          {weatherSource(plan.source)} · {plan.assumptions}
        </p>
      </section>

      <SectionTitle aside="green: stays in range">Every departure</SectionTitle>
      <div className="flex flex-col gap-2.5">
        {plan.destinations.map((d) => (
          <div key={d.id} className="panel px-[18px] py-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-[15px] font-semibold">{d.name}</p>
              <p className="m-0 whitespace-nowrap text-xs text-neutral-400">
                {d.km} km · {d.travel_h} h drive
              </p>
            </div>
            <Strip options={d.options} best={d.best} />
            <p className="m-0 mt-2 text-[13px] text-neutral-300">
              Best: leave {time(d.best.depart_ts)}, max {d.best.max_inside_c.toFixed(1)} °C inside, +{(d.best.budget_used * 100).toFixed(1)}% budget
              {d.best.breach_ts ? `, above ${plan.product.storage_max_c} °C from ${time(d.best.breach_ts)}` : ""}
            </p>
            {d.rated_best && d.best.breach_ts && !d.rated_best.breach_ts && (
              <p className="m-0 mt-1 text-[13px]" style={{ color: "var(--color-good)" }}>
                A carrier at its rated cold life would stay in range on this run.
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/** Every departure as one block: green stays in range, then warmer colours for more heat. */
function Strip({ options, best }: { options: TripOption[]; best: TripOption }) {
  const worst = Math.max(...options.map((o) => o.budget_used), 1e-6);
  return (
    <div className="mt-2 flex gap-[3px]" role="list" aria-label="Departure options">
      {options.map((o) => {
        const heat = o.budget_used / worst;
        const color = o.breach_ts ? (heat > 0.66 ? "var(--color-bad)" : heat > 0.33 ? "var(--color-hot)" : "var(--color-warn)") : "var(--color-good)";
        const isBest = o.depart_ts === best.depart_ts;
        return (
          <div
            key={o.depart_ts}
            role="listitem"
            aria-label={`${time(o.depart_ts)}: +${(o.budget_used * 100).toFixed(1)}% budget, max ${o.max_inside_c} °C${isBest ? ", best" : ""}`}
            title={`${time(o.depart_ts)}: +${(o.budget_used * 100).toFixed(1)}%, max ${o.max_inside_c} °C`}
            className="h-6 flex-1 rounded-[4px]"
            style={{ background: color, boxShadow: isBest ? "0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent-300)" : undefined }}
          />
        );
      })}
    </div>
  );
}
