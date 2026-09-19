import { useEffect, useState } from "react";

import { ErrorNote, Layout, SectionTitle, Spinner } from "../components/Layout";
import { LearningCard } from "../components/Learning";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { Impact, MetricStat, PolicyId } from "../types";

const POLICY: Record<PolicyId, { name: string; color: string }> = {
  status_quo: { name: "Today: VVM by eye", color: "var(--color-neutral-500)" },
  alarm_logger: { name: "Alarm-only logger", color: "var(--color-warn)" },
  vialtality: { name: "Vialtality", color: "var(--color-accent)" },
  vialtality_planned: { name: "Vialtality + planning", color: "var(--color-good)" },
};
const ORDER: PolicyId[] = ["status_quo", "alarm_logger", "vialtality", "vialtality_planned"];

const METRICS: { key: string; title: string; kind: string; fmt?: (v: number) => string }[] = [
  { key: "trips_breached", title: "Trips that left 2–8 °C", kind: "Prevention" },
  { key: "damaged_freeze", title: "Doses freeze-exposed (at or below −0.5 °C for an hour or more)", kind: "Prevention" },
  { key: "unsafe_used", title: "Heat-spent or freeze-exposed doses given at the next session", kind: "Patient safety" },
  { key: "good_discarded", title: "Good doses thrown away (if an alarm means discard)", kind: "Waste" },
  { key: "value_lost_usd", title: "Value of doses lost", kind: "Cost", fmt: (v) => `$${Math.round(v).toLocaleString()}` },
];

export default function ImpactPage() {
  const [data, setData] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fleet = usePoll(() => api.fleet(), 60000);

  useEffect(() => {
    api.impact().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <Layout>
      <h1 className="m-0 mb-2 mt-[26px] text-[34px] leading-[1.05]">Impact</h1>

      {fleet.data && (
        <>
          <SectionTitle>Across the fleet now</SectionTitle>
          <div className="grid grid-cols-1 gap-2.5">
            <Tile label="Doses and tests tracked" value={fleet.data.doses_tracked} />
            <Tile
              label="Alarm fired, still in budget"
              value={fleet.data.saved_from_needless_discard}
              color="var(--color-good)"
              note="A threshold logger would flag these; the stability budget says they're usable (if an alarm means discard)."
            />
            <Tile
              label="Damage no alarm saw"
              value={fleet.data.silent_failures_caught}
              color="var(--color-hot)"
              note="No threshold alarm fired, but the budget says damage accrued."
            />
          </div>
        </>
      )}

      {error && <ErrorNote error={error} />}
      {!data && !error && <Spinner label="Loading the backtest" />}
      {data && <Backtest data={data} />}
    </Layout>
  );
}

function Backtest({ data }: { data: Impact }) {
  const s = data.sweep.summary;
  const trips = (p: PolicyId) => Math.round(s[p].trips_breached.mean);
  const unsafeCut = 1 - s.vialtality_planned.unsafe_used.mean / Math.max(s.status_quo.unsafe_used.mean, 1);
  return (
    <>
      <SectionTitle>Backtest</SectionTitle>
      <p className="m-0 mb-4 text-[15px] leading-[1.5] text-neutral-300">
        {data.run.trips} outreach trips over {data.run.days} days on the real hourly weather at the district's clinics (
        {data.run.weather.source}, {data.run.weather.start} to {data.run.weather.end}), decided four ways. Means over{" "}
        {data.sweep.seeds} random seeds; the thin line on each bar is the P10–P90 range.
      </p>

      <section className="rounded-[14px] bg-accent-900 p-[22px] text-accent-200">
        <p className="m-0 text-xs uppercase tracking-[0.1em] opacity-80">Prevention</p>
        <p className="m-0 mt-1.5 text-[40px] font-semibold leading-none tracking-[-0.035em]">
          {trips("status_quo")} → {trips("vialtality_planned")}
        </p>
        <p className="m-0 mt-2 text-[15px] leading-[1.45]">
          trips that left 2–8 °C, when departures and routes are planned from the forecast. No assumption about what
          anyone does with an alarm: these excursions never happen.
        </p>
      </section>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <div className="card-soft p-4">
          <p className="m-0 text-[28px] font-semibold tracking-[-0.03em]">−{Math.round(unsafeCut * 100)}%</p>
          <p className="m-0 mt-1 text-[13px] leading-snug text-neutral-400">heat-spent or freeze-exposed doses given, vs today</p>
        </div>
        <div className="card-soft p-4">
          <p className="m-0 text-[28px] font-semibold tracking-[-0.03em]">{Math.round(s.alarm_logger.good_discarded.mean).toLocaleString()} → 0</p>
          <p className="m-0 mt-1 text-[13px] leading-snug text-neutral-400">good doses thrown away, if every alarm meant discard</p>
        </div>
      </div>

      <SectionTitle>What confirmed labels teach the model</SectionTitle>
      <LearningCard />

      {METRICS.map((m) => (
        <div key={m.key}>
          <SectionTitle aside={m.kind}>{m.title}</SectionTitle>
          <div className="panel p-5">
            <Bars stats={ORDER.map((p) => [p, s[p][m.key]])} fmt={m.fmt ?? ((v) => Math.round(v).toLocaleString())} />
          </div>
        </div>
      ))}

      <SectionTitle>What the four policies do</SectionTitle>
      <ul className="panel m-0 flex list-none flex-col gap-3 p-5">
        {data.run.policies.map((p) => (
          <li key={p.id} className="flex gap-2.5 text-sm leading-[1.45] text-neutral-300">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: POLICY[p.id].color }} />
            <span>
              <span className="font-semibold text-text">{POLICY[p.id].name}.</span> {p.description}
            </span>
          </li>
        ))}
      </ul>

      <SectionTitle aside="all adjustable in the code">Assumptions</SectionTitle>
      <div className="panel p-5">
        <table className="w-full table-fixed text-left text-[13px]">
          <tbody>
            {data.run.assumptions
              .filter((a) => a.note)
              .map((a) => (
                <tr key={a.name} className="border-t border-line align-top first:border-0">
                  <td className="w-14 py-2 tabular-nums text-text">{a.value}</td>
                  <td className="py-2 text-neutral-400">{a.note}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="m-0 mt-3 text-xs leading-[1.45] text-neutral-500">
          A simulation, not a field trial: it shows what each way of deciding does with the same trips, on real weather.
          Freeze-exposed doses are counted as exposed, not proven damaged: chilled vaccine often supercools and stays
          liquid, which only a shake test settles.
        </p>
      </div>
    </>
  );
}

function Tile({ label, value, color, note }: { label: string; value: number; color?: string; note?: string }) {
  return (
    <div className="card-soft px-[18px] py-4">
      <p className="m-0 text-xs uppercase tracking-[0.08em]" style={{ color: color ?? "var(--color-neutral-400)" }}>
        {label}
      </p>
      <p className="m-0 mt-1 text-[30px] font-semibold tabular-nums tracking-[-0.03em]">{value.toLocaleString()}</p>
      {note && <p className="m-0 mt-0.5 text-[13px] leading-snug text-neutral-400">{note}</p>}
    </div>
  );
}

function Bars({ stats, fmt }: { stats: [PolicyId, MetricStat][]; fmt: (v: number) => string }) {
  const max = Math.max(...stats.map(([, st]) => st.p90), 1e-9);
  return (
    <div className="flex flex-col gap-3">
      {stats.map(([p, st]) => (
        <div key={p}>
          <div className="flex justify-between text-[13px]">
            <span className="text-neutral-300">{POLICY[p].name}</span>
            <span className="font-semibold tabular-nums">{fmt(st.mean)}</span>
          </div>
          <div className="relative mt-1.5 h-2.5 rounded-full bg-neutral-800">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(st.mean / max) * 100}%`, background: POLICY[p].color }} />
            <div
              className="absolute top-1/2 h-px -translate-y-1/2 bg-neutral-300/70"
              style={{ left: `${(st.p10 / max) * 100}%`, width: `${Math.max(((st.p90 - st.p10) / max) * 100, 0.5)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
