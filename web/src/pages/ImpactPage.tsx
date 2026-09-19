import { useEffect, useState } from "react";

import { ErrorNote, Layout, PageTitle, SectionTitle, Spinner } from "../components/Layout";
import { LearningCard } from "../components/Learning";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { Impact, MetricStat, PolicyId } from "../types";

const POLICY: Record<PolicyId, { name: string; color: string }> = {
  status_quo: { name: "Today: VVM by eye", color: "var(--ink-300)" },
  alarm_logger: { name: "Alarm-only logger", color: "var(--ink-500)" },
  vialtality: { name: "SecuriVax", color: "var(--text)" },
  vialtality_planned: { name: "SecuriVax + planning", color: "var(--glacier-500)" },
};
const ORDER: PolicyId[] = ["status_quo", "alarm_logger", "vialtality", "vialtality_planned"];

const METRICS: { key: string; title: string; kind: string; fmt?: (v: number) => string; note?: string }[] = [
  { key: "trips_breached", title: "Trips that left 2–8 °C", kind: "Prevention" },
  { key: "damaged_freeze", title: "Doses freeze-exposed (at or below −0.5 °C for an hour or more)", kind: "Prevention" },
  { key: "unsafe_used", title: "Heat-spent or freeze-exposed doses given at the next session", kind: "Patient safety" },
  { key: "good_discarded", title: "Good doses thrown away (if an alarm means discard)", kind: "Waste" },
  {
    key: "value_lost_usd",
    title: "Value of doses lost",
    kind: "Cost",
    fmt: (v) => `$${Math.round(v).toLocaleString()}`,
    note:
      "Spotting damage can't undo it: a dose that froze or overheated is lost either way, so today and SecuriVax lose the same. " +
      "What detection changes is who gets those doses (patient safety, above) and not throwing good ones away, which is why the " +
      "alarm-only logger loses the most. Planning is what saves value: the damage never happens.",
  },
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
      <PageTitle top eyebrow="Impact" title="What it changes" />

      {fleet.data && (
        <>
          <SectionTitle>Across the fleet now</SectionTitle>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Tile label="Doses and tests tracked" value={fleet.data.doses_tracked} />
            <Tile
              label="Alarm fired, still in budget"
              value={fleet.data.saved_from_needless_discard}
              note="A threshold logger would flag these; the stability budget says they're usable (if an alarm means discard)."
            />
            <Tile
              label="Damage no alarm saw"
              value={fleet.data.silent_failures_caught}
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
      <p className="m-0 mb-4 text-neutral-300">
        {data.run.trips} outreach trips over {data.run.days} days on the real hourly weather at the district's clinics (
        {data.run.weather.source}, {data.run.weather.start} to {data.run.weather.end}), decided four ways. Means over{" "}
        {data.sweep.seeds} random seeds; the thin line on each bar is the P10–P90 range.
      </p>

      {/* On a laptop: the headline beside its two numbers, and the charts two to a row. */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-3">
        <section className="card-soft p-4">
          <p className="eyebrow m-0">Prevention</p>
          <p className="m-0 mt-2 font-display text-[40px] font-semibold leading-none tracking-[-0.03em]">
            {trips("status_quo")} → {trips("vialtality_planned")}
          </p>
          <p className="m-0 mt-2">
            trips that left 2–8 °C, when departures and routes are planned from the forecast. No assumption about what
            anyone does with an alarm: these excursions never happen.
          </p>
        </section>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:mt-0">
          <div className="card-soft p-4">
            <p className="m-0 font-display text-[28px] font-semibold tracking-[-0.03em]">−{Math.round(unsafeCut * 100)}%</p>
            <p className="ui-caption m-0 mt-1">heat-spent or freeze-exposed doses given, vs today</p>
          </div>
          <div className="card-soft p-4">
            <p className="m-0 font-display text-[28px] font-semibold tracking-[-0.03em]">{Math.round(s.alarm_logger.good_discarded.mean).toLocaleString()} → 0</p>
            <p className="ui-caption m-0 mt-1">good doses thrown away, if every alarm meant discard</p>
          </div>
        </div>
      </div>

      <SectionTitle>What confirmed labels teach the model</SectionTitle>
      <LearningCard />

      <div className="lg:grid lg:grid-cols-2 lg:gap-x-8">
        {METRICS.map((m) => (
          <div key={m.key} className="lg:flex lg:flex-col">
            <SectionTitle aside={m.kind}>{m.title}</SectionTitle>
            <div className="panel p-4 lg:flex-1">
              <Bars stats={ORDER.map((p) => [p, s[p][m.key]])} fmt={m.fmt ?? ((v) => Math.round(v).toLocaleString())} />
              {m.note && <p className="ui-caption m-0 mt-3">{m.note}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:gap-x-8">
        <div>
          <SectionTitle>What the four policies do</SectionTitle>
          <ul className="panel m-0 flex list-none flex-col gap-3 p-4">
            {data.run.policies.map((p) => (
              <li key={p.id} className="flex gap-3 text-[15px] text-neutral-300">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: POLICY[p.id].color }} />
                <span>
                  <span className="font-semibold text-text">{POLICY[p.id].name}.</span> {p.description}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <SectionTitle aside="all adjustable in the code">Assumptions</SectionTitle>
          <div className="panel p-4">
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
            <p className="ui-caption m-0 mt-3">
              A simulation, not a field trial: it shows what each way of deciding does with the same trips, on real weather.
              Freeze-exposed doses are counted as exposed, not proven damaged: chilled vaccine often supercools and stays
              liquid, which only a shake test settles.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="card-soft p-4">
      <p className="eyebrow m-0">{label}</p>
      <p className="m-0 mt-2 font-display text-[30px] font-semibold tabular-nums tracking-[-0.02em]">{value.toLocaleString()}</p>
      {note && <p className="ui-caption m-0 mt-1">{note}</p>}
    </div>
  );
}

function Bars({ stats, fmt }: { stats: [PolicyId, MetricStat][]; fmt: (v: number) => string }) {
  const max = Math.max(...stats.map(([, st]) => st.p90), 1e-9);
  return (
    <div className="flex flex-col gap-3">
      {stats.map(([p, st]) => (
        <div key={p}>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-300">{POLICY[p].name}</span>
            <span className="font-bold tabular-nums">{fmt(st.mean)}</span>
          </div>
          <div className="relative mt-1.5 h-2.5 rounded-full bg-neutral-800">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(st.mean / max) * 100}%`, background: POLICY[p].color }} />
            <div
              className="absolute top-1/2 h-px -translate-y-1/2 bg-text/60"
              style={{ left: `${(st.p10 / max) * 100}%`, width: `${Math.max(((st.p90 - st.p10) / max) * 100, 0.5)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
