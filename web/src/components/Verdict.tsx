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

/** The one thing a nurse needs: the verdict, what to do now, and how sure we are. */
export function VerdictCard({ report, stale }: { report: Report; stale: string | null }) {
  const style = VERDICT_STYLE[report.verdict];
  const where = report.current_node_id ? "In transit" : "Delivered";
  const lead = report.reasons.find((r) => r.severity !== "ok" && r.severity !== "advisory") ?? report.reasons[0];
  return (
    <section className={`mb-4 rounded-2xl p-5 ${style.card}`}>
      <p className="text-xs font-bold uppercase tracking-wider opacity-80">
        Verdict at point of use · {where}
      </p>
      <h2 className="mt-1 font-display text-5xl font-bold tracking-tight">{style.label}</h2>
      <span className="sr-only" role="status" aria-live="polite">
        Verdict: {style.label}. {report.action}
      </span>
      {lead && <p className="mt-2 text-[15px] leading-snug opacity-95">{lead.text}</p>}
      <div className="mt-4 rounded-xl bg-black/15 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">Next 60 seconds</p>
        <p className="mt-0.5 text-base font-semibold leading-snug">{report.action}</p>
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <span className="shrink-0">Confidence {pct(report.confidence.confidence)}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/20">
          <div className="h-full bg-current" style={{ width: `${report.confidence.confidence * 100}%` }} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {report.confidence.borderline && report.product.kind === "vaccine" && (
          <a href="#vvm" className="rounded-full bg-white/90 px-2.5 py-1 font-semibold text-ink">
            Borderline: check the VVM label
          </a>
        )}
        {stale && <span className="rounded-full bg-white/90 px-2.5 py-1 font-semibold text-bad">{stale}</span>}
        {!stale && report.provisional && (
          <span className="rounded-full bg-white/90 px-2.5 py-1 text-ink">
            Carrier quiet since {time(report.data_through)}: this may change
          </span>
        )}
        {report.demo_time && (
          <span className="rounded-full bg-ink px-2.5 py-1 text-white">Demo time: {demoRate(report.time_scale)}</span>
        )}
      </div>
      <p className="mt-3 text-[11px] opacity-75">Decision support with a human in the loop. Not a clinical determination.</p>
    </section>
  );
}

/** Stability budget with the design's markers, plus the numbers behind it. */
export function BudgetCard({ report }: { report: Report }) {
  const used = Math.min(report.budget_used, 1);
  const style = VERDICT_STYLE[report.verdict];
  const fresh = report.current_node_id && report.data_through && report.computed_at - report.data_through < 600;
  return (
    <section className="mb-4 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Stability budget consumed</h2>
        <span className="font-display text-4xl font-bold tabular-nums">
          {Math.round(report.budget_used * 100)}
          <span className="text-lg text-muted">%</span>
        </span>
      </div>
      <div
        className="relative mt-2 h-3 overflow-hidden rounded-full bg-slate-100"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used * 100)}
        aria-label="Stability budget consumed"
      >
        <div className={`absolute inset-y-0 left-0 ${style.bar} transition-all duration-700`} style={{ width: `${used * 100}%` }} />
        {[40, 75].map((m) => (
          <div key={m} className="absolute inset-y-0 w-0.5 bg-ink/40" style={{ left: `${m}%` }} />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: "40%" }}>40 use first</span>
        <span className="absolute -translate-x-1/2" style={{ left: "75%" }}>75 quarantine</span>
        <span className="absolute right-0">100</span>
      </div>
      <p className="mt-2 text-xs text-muted">
        {pct(report.initial_budget_used)} was used before our monitoring · {report.product.stability_ref}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Mean kinetic temp" value={temp(report.mkt_c)} />
        <Stat label="Peak reading" value={temp(report.peak_c)} />
        <Stat label="Hours out of range" value={`${Math.round(report.hours_out_of_range)} h`} />
        <Stat label="Peak humidity" value={humidity(report.peak_rh)} />
        <Stat label={fresh ? "Now" : `At ${time(report.data_through)}`} value={temp(report.current_temp_c)} />
        <Stat label="Left at that temp" value={report.budget_remaining <= 0 ? "none" : hours(report.hours_left_at_current)} />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 font-display text-xl font-bold tabular-nums">{value}</dd>
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
