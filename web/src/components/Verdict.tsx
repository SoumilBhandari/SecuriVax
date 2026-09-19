import type { ReactNode } from "react";

import { demoRate, hours, humidity, pct, temp, time, VERDICT_STYLE } from "../lib/format";
import type { Reason, Report, Verdict } from "../types";
import { AlertIcon, CheckIcon, DropIcon, FlameIcon, OfflineIcon, SnowIcon } from "./Icons";

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide ring-1 ${VERDICT_STYLE[verdict].chip}`}>
      {VERDICT_STYLE[verdict].label}
    </span>
  );
}

/**
 * The one thing a nurse needs, in one card: the verdict, how much of the
 * stability budget is gone, what to do now, and how sure we are.
 */
export function VerdictCard({
  report,
  stale,
  onCheckLabel,
}: {
  report: Report;
  stale: string | null;
  onCheckLabel?: () => void;
}) {
  const style = VERDICT_STYLE[report.verdict];
  const used = Math.min(report.budget_used, 1);
  const lead = report.reasons.find((r) => r.severity !== "ok" && r.severity !== "advisory") ?? report.reasons[0];
  return (
    <section className={`mb-3 rounded-2xl p-4 ${style.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">Verdict at point of use</p>
          <h2 className="mt-1 font-display text-4xl font-bold leading-none tracking-tight">{style.label}</h2>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-3xl font-bold leading-none tabular-nums">
            {Math.round(report.budget_used * 100)}
            <span className="text-base opacity-80">%</span>
          </p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wider opacity-80">budget used</p>
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        Verdict: {style.label}. {report.action}
      </span>

      <div
        className="relative mt-4 h-2 rounded-full bg-black/15"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used * 100)}
        aria-label="Stability budget consumed"
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-current transition-all duration-700" style={{ width: `${used * 100}%` }} />
        {[40, 75].map((m) => (
          <div key={m} className="absolute -top-1 h-4 w-0.5 rounded bg-current opacity-50" style={{ left: `${m}%` }} />
        ))}
      </div>
      <div className="relative mt-1 h-3.5 text-[10px] font-semibold opacity-80">
        <span className="absolute -translate-x-1/2" style={{ left: "40%" }}>use first</span>
        <span className="absolute -translate-x-1/2" style={{ left: "75%" }}>quarantine</span>
      </div>

      {lead && <p className="mt-2 text-sm leading-snug opacity-95">{lead.text}</p>}
      <div className="mt-3 rounded-xl bg-black/15 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">Next 60 seconds</p>
        <p className="mt-0.5 text-[15px] font-semibold leading-snug">{report.action}</p>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs font-semibold">
        <span className="shrink-0">Confidence {pct(report.confidence.confidence)}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/20">
          <div className="h-full bg-current" style={{ width: `${report.confidence.confidence * 100}%` }} />
        </div>
      </div>
      {(report.confidence.borderline || stale || report.provisional || report.demo_time) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {report.confidence.borderline && report.product.kind === "vaccine" && onCheckLabel && (
            <button onClick={onCheckLabel} className="min-h-9 rounded-full bg-white px-3 font-semibold text-ink">
              Borderline: check the VVM label →
            </button>
          )}
          {stale && <span className="rounded-full bg-white/90 px-2.5 py-1 font-semibold text-bad">{stale}</span>}
          {!stale && report.provisional && (
            <span className="rounded-full bg-white/90 px-2.5 py-1 text-ink">Carrier quiet since {time(report.data_through)}: may change</span>
          )}
          {report.demo_time && <span className="rounded-full bg-ink px-2.5 py-1 text-white">Demo time: {demoRate(report.time_scale)}</span>}
        </div>
      )}
      <p className="mt-2 text-[10px] opacity-70">Decision support with a human in the loop. Not a clinical determination.</p>
    </section>
  );
}

/** The numbers behind the budget, as one compact grid. */
export function KeyStats({ report }: { report: Report }) {
  const fresh = report.current_node_id && report.data_through && report.computed_at - report.data_through < 600;
  return (
    <div>
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
        <Stat label="Mean kinetic" value={temp(report.mkt_c)} />
        <Stat label="Peak" value={temp(report.peak_c)} />
        <Stat label="Out of range" value={`${Math.round(report.hours_out_of_range)} h`} />
        <Stat label="Peak humidity" value={humidity(report.peak_rh)} />
        <Stat label={fresh ? "Now" : "Last reading"} value={temp(report.current_temp_c)} />
        <Stat label="Time left" value={report.budget_remaining <= 0 ? "none" : hours(report.hours_left_at_current)} />
      </dl>
      <p className="mt-2 text-xs text-muted">
        {pct(report.initial_budget_used)} of the budget was used before our monitoring. Time left assumes it stays at the
        last reading ({time(report.data_through)}). Stability data: {report.product.stability_ref}.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-2.5 py-2">
      <dt className="truncate text-[10px] font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-base font-bold tabular-nums">{value}</dd>
    </div>
  );
}

const REASON_ICON: Record<string, ReactNode> = {
  FREEZE: <SnowIcon className="text-violet-700" />,
  FREEZE_POSSIBLE: <SnowIcon className="text-violet-700" />,
  FREEZE_TOLERATED: <SnowIcon className="text-slate-500" />,
  PACKS_TOO_COLD: <SnowIcon className="text-violet-700" />,
  HEAT_ALARM: <FlameIcon className="text-bad" />,
  HEAT_EXCURSION: <FlameIcon className="text-hot" />,
  BUDGET_EXHAUSTED: <FlameIcon className="text-bad" />,
  BUDGET_LOW: <AlertIcon className="text-warn" />,
  HUMIDITY: <DropIcon className="text-cold" />,
  HISTORY_GAP: <OfflineIcon className="text-warn" />,
  NODE_OFFLINE: <OfflineIcon className="text-warn" />,
  ALL_CLEAR: <CheckIcon className="text-ok" />,
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
          <span className="mt-0.5 shrink-0">{REASON_ICON[r.code] ?? <AlertIcon className="text-muted" />}</span>
          <div>
            <p className="text-sm leading-snug">{r.text}</p>
            {SEVERITY_LABEL[r.severity] && (
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted">{SEVERITY_LABEL[r.severity]}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
