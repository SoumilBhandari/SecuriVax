import { useEffect, useState } from "react";

import { Card, ErrorNote, Layout, Spinner } from "../components/Layout";
import { LearningCard } from "../components/Learning";
import { api } from "../lib/api";
import type { Impact, MetricStat, PolicyId } from "../types";

const POLICY: Record<PolicyId, { name: string; color: string }> = {
  status_quo: { name: "Today: VVM by eye", color: "bg-slate-400" },
  alarm_logger: { name: "Alarm-only logger", color: "bg-amber-500" },
  vialtality: { name: "Vialtality", color: "bg-sky-600" },
  vialtality_planned: { name: "Vialtality + planning", color: "bg-emerald-600" },
};
const ORDER: PolicyId[] = ["status_quo", "alarm_logger", "vialtality", "vialtality_planned"];

const METRICS: { key: string; title: string; unit: string; lowerIsBetter: string; fmt?: (v: number) => string }[] = [
  { key: "unsafe_used", title: "Damaged doses given at the next session", unit: "doses", lowerIsBetter: "Patient safety" },
  { key: "good_discarded", title: "Good doses thrown away", unit: "doses", lowerIsBetter: "Waste" },
  { key: "damaged_freeze", title: "Doses damaged by freezing in the first place", unit: "doses", lowerIsBetter: "Prevention" },
  { key: "trips_breached", title: "Trips that left 2–8 °C", unit: "trips", lowerIsBetter: "Prevention" },
  { key: "value_lost_usd", title: "Value of doses lost", unit: "US$", lowerIsBetter: "Cost", fmt: (v) => `$${Math.round(v).toLocaleString()}` },
];

export default function ImpactPage() {
  const [data, setData] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.impact().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <Layout back><ErrorNote error={error} /></Layout>;
  if (!data) return <Layout back><Spinner label="Loading the backtest" /></Layout>;

  const s = data.sweep.summary;
  const unsafeCut = 1 - s.vialtality_planned.unsafe_used.mean / Math.max(s.status_quo.unsafe_used.mean, 1);
  return (
    <Layout back>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Impact backtest</h1>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-slate-600">
        {data.run.trips} outreach trips over {data.run.days} days, simulated on the real hourly weather at the district's
        clinics ({data.run.weather.source}, {data.run.weather.start} to {data.run.weather.end}). The same trips are
        decided four ways. Numbers are the mean over {data.sweep.seeds} random seeds; bars show the P10–P90 range.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-900 p-4 text-white">
          <p className="text-3xl font-bold">−{Math.round(unsafeCut * 100)}%</p>
          <p className="mt-1 text-sm text-slate-300">damaged doses reaching patients, vs today</p>
        </div>
        <div className="rounded-2xl bg-slate-900 p-4 text-white">
          <p className="text-3xl font-bold">{Math.round(s.alarm_logger.good_discarded.mean).toLocaleString()} → 0</p>
          <p className="mt-1 text-sm text-slate-300">good doses thrown away, alarm logger vs Vialtality</p>
        </div>
      </div>

      <LearningCard />

      {METRICS.map((m) => (
        <Card key={m.key} title={m.title} aside={m.lowerIsBetter}>
          <Bars stats={ORDER.map((p) => [p, s[p][m.key]])} fmt={m.fmt ?? ((v) => Math.round(v).toLocaleString())} />
        </Card>
      ))}

      <Card title="What the four policies do">
        <ul className="space-y-2 text-sm text-slate-700">
          {data.run.policies.map((p) => (
            <li key={p.id} className="flex gap-2">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${POLICY[p.id].color}`} />
              <span>
                <span className="font-medium text-slate-900">{POLICY[p.id].name}.</span> {p.description}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Assumptions" aside="all adjustable in the code">
        <table className="w-full table-fixed text-left text-xs">
          <tbody>
            {data.run.assumptions.filter((a) => a.note).map((a) => (
              <tr key={a.name} className="border-t border-slate-100 align-top">
                <td className="w-14 py-1.5 font-mono tabular-nums text-slate-900">{a.value}</td>
                <td className="py-1.5 text-slate-600">{a.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-400">
          A simulation, not a field trial: it shows what each way of deciding does with the same trips, on real weather.
        </p>
      </Card>
    </Layout>
  );
}

function Bars({ stats, fmt }: { stats: [PolicyId, MetricStat][]; fmt: (v: number) => string }) {
  const max = Math.max(...stats.map(([, s]) => s.p90), 1e-9);
  return (
    <div className="space-y-2.5">
      {stats.map(([p, s]) => (
        <div key={p}>
          <div className="flex justify-between text-xs">
            <span className="text-slate-600">{POLICY[p].name}</span>
            <span className="font-semibold tabular-nums text-slate-900">{fmt(s.mean)}</span>
          </div>
          <div className="relative mt-1 h-3 rounded bg-slate-100">
            <div className={`absolute inset-y-0 left-0 rounded ${POLICY[p].color}`} style={{ width: `${(s.mean / max) * 100}%` }} />
            <div
              className="absolute top-1/2 h-px -translate-y-1/2 bg-slate-900/50"
              style={{ left: `${(s.p10 / max) * 100}%`, width: `${Math.max(((s.p90 - s.p10) / max) * 100, 0.5)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
