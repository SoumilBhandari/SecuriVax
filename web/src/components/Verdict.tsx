import type { ReactNode } from "react";

import { demoRate, hours, humidity, pct, temp, time, VERDICT_STYLE } from "../lib/format";
import type { Reason, Report, Verdict } from "../types";
import { AlertIcon, CheckIcon, DropIcon, FlameIcon, OfflineIcon, SnowIcon, ThermoIcon } from "./Icons";

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${VERDICT_STYLE[verdict].chip}`}
    >
      {verdict}
    </span>
  );
}

export function VerdictCard({ report }: { report: Report }) {
  const style = VERDICT_STYLE[report.verdict];
  return (
    <section className={`mb-4 rounded-2xl border-2 p-5 ${style.card}`} aria-live="polite">
      <p className="text-xs font-medium uppercase tracking-wider opacity-70">Verdict</p>
      <p className="mt-1 text-4xl font-bold tracking-tight">{report.verdict}</p>
      <p className="mt-2 text-base leading-snug">{report.action}</p>
      <p className="mt-2 text-xs opacity-80">
        {pct(report.confidence.confidence)} sure · budget {pct(report.confidence.budget_p10)}–{pct(report.confidence.budget_p90)} across{" "}
        {report.confidence.samples} what-ifs (sensor bias, batch variation)
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {report.confidence.borderline && (
          <a href="#vvm" className="rounded-full bg-amber-200 px-2 py-0.5 font-medium text-amber-900">
            Borderline: check the VVM label
          </a>
        )}
        {report.provisional && (
          <span className="rounded-full bg-white/70 px-2 py-0.5">
            Provisional: data through {time(report.data_through)}
          </span>
        )}
        {report.demo_time && (
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">
            Demo time: {demoRate(report.time_scale)}
          </span>
        )}
      </div>
    </section>
  );
}

export function BudgetCard({ report }: { report: Report }) {
  const used = Math.min(report.budget_used, 1);
  const initial = Math.min(report.initial_budget_used, used);
  const style = VERDICT_STYLE[report.verdict];
  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Heat budget used</h2>
        <span className="text-2xl font-bold tabular-nums text-slate-900">{pct(report.budget_used)}</span>
      </div>
      <div
        className="relative mt-2 h-3 overflow-hidden rounded-full bg-slate-100"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used * 100)}
        aria-label="Heat budget used"
      >
        <div className={`absolute inset-y-0 left-0 ${style.bar} transition-all duration-700`} style={{ width: `${used * 100}%` }} />
        <div className="absolute inset-y-0 left-0 bg-slate-400/60" style={{ width: `${initial * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-slate-900/40" style={{ left: "75%" }} title="Quarantine threshold" />
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-400/80" />
          {pct(report.initial_budget_used)} before our monitoring
        </span>
        <span>{report.product.stability_ref}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat
          icon={<ThermoIcon size={16} />}
          label={report.current_node_id ? "Now" : "Last reading"}
          value={temp(report.current_temp_c)}
        />
        <Stat icon={<DropIcon size={16} />} label="Humidity" value={humidity(report.current_rh)} />
        <Stat
          label={report.current_temp_c == null ? "Time left" : "Left at this temp"}
          value={report.budget_remaining <= 0 ? "none" : hours(report.hours_left_at_current)}
        />
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2">
      <p className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

const REASON_ICON: Record<string, ReactNode> = {
  FREEZE: <SnowIcon className="text-violet-600" />,
  FREEZE_TOLERATED: <SnowIcon className="text-slate-400" />,
  HEAT_ALARM: <FlameIcon className="text-red-600" />,
  HEAT_EXCURSION: <FlameIcon className="text-orange-500" />,
  BUDGET_EXHAUSTED: <FlameIcon className="text-red-600" />,
  BUDGET_LOW: <AlertIcon className="text-amber-600" />,
  HUMIDITY: <DropIcon className="text-sky-600" />,
  HISTORY_GAP: <OfflineIcon className="text-amber-600" />,
  NODE_OFFLINE: <OfflineIcon className="text-amber-600" />,
  ALL_CLEAR: <CheckIcon className="text-emerald-600" />,
};

const SEVERITY_LABEL: Record<Reason["severity"], string> = {
  discard: "Decides the verdict",
  quarantine: "Decides the verdict",
  advisory: "For information",
  ok: "",
};

export function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="space-y-3">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 shrink-0">{REASON_ICON[r.code] ?? <AlertIcon className="text-slate-400" />}</span>
          <div>
            <p className="text-sm leading-snug text-slate-800">{r.text}</p>
            {SEVERITY_LABEL[r.severity] && (
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">{SEVERITY_LABEL[r.severity]}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
