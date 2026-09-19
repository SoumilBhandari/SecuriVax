import { demoRate, hours, pct, temp, time, VERDICT_STYLE } from "../lib/format";
import type { Reason, Report, Verdict } from "../types";

export function VerdictChip({ verdict, small = false }: { verdict: Verdict; small?: boolean }) {
  const v = VERDICT_STYLE[verdict];
  return (
    <span className={`pill ${small ? "!px-[9px] !py-1 !text-[11px]" : ""}`} style={{ background: v.tint, color: v.color }}>
      {v.label}
    </span>
  );
}

/**
 * The one thing a nurse needs: the verdict, what to do now, how much of the
 * heat budget is gone, and how sure we are.
 */
export function VerdictHero({ report, stale, onCheckLabel }: { report: Report; stale: string | null; onCheckLabel?: () => void }) {
  const v = VERDICT_STYLE[report.verdict];
  const used = Math.min(report.budget_used, 1);
  // The coarsest sensor that watched this box, if it's coarser than the design's.
  const coarse = report.segments.reduce<Report["segments"][number] | null>(
    (worst, s) => ((s.sensor_accuracy_c ?? 0) > Math.max(worst?.sensor_accuracy_c ?? 0, 0.5) ? s : worst),
    null,
  );
  const budgetLine =
    report.budget_remaining <= 0
      ? "Heat budget used up."
      : `${pct(report.budget_used)} of the heat budget used · ${
          report.hours_left_at_current == null ? "time left unknown" : `${hours(report.hours_left_at_current)} left at the last reading`
        }`;
  return (
    <section
      aria-label="Verdict"
      className="rounded-2xl px-6 pb-[22px] pt-[26px]"
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${v.color} 9%, var(--color-surface)), var(--color-surface) 60%)`,
        border: `1px solid color-mix(in srgb, ${v.color} 28%, transparent)`,
        boxShadow: `0 0 56px color-mix(in srgb, ${v.color} 12%, transparent), inset 0 1px 0 rgba(255,255,255,.05), 0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)`,
      }}
    >
      <p className="m-0 text-xs uppercase tracking-[0.1em] text-neutral-400">Verdict</p>
      <h2 className="mb-3.5 mt-2 text-[40px] font-semibold leading-none tracking-[-0.035em]" style={{ color: v.color }}>
        {v.label}
      </h2>
      <span className="sr-only" role="status" aria-live="polite">
        Verdict: {v.label}. {report.action}
      </span>
      <p className="m-0 mb-[22px] text-[16.5px] leading-[1.45] text-neutral-200 [text-wrap:pretty]">{report.action}</p>

      <div
        role="meter"
        aria-label="Heat budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used * 100)}
        className="relative h-2 rounded-full bg-neutral-800"
      >
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700" style={{ width: `${used * 100}%`, background: v.color }} />
        {[40, 75].map((m) => (
          <div key={m} className="absolute -bottom-1 -top-1 w-0.5 bg-current opacity-45" style={{ left: `${m}%` }} />
        ))}
      </div>
      <div className="relative mt-1.5 h-3.5 text-[10.5px] uppercase tracking-[0.06em] text-neutral-500">
        <span className="absolute -translate-x-1/2" style={{ left: "40%" }}>use first</span>
        <span className="absolute -translate-x-1/2" style={{ left: "75%" }}>quarantine</span>
      </div>
      <p className="m-0 mt-1.5 text-[13.5px] tabular-nums text-neutral-400">{budgetLine}</p>
      <p className="m-0 mt-1 text-[13.5px] text-neutral-400" title="Share of plausible scenarios (sensor error, batch variation, starting budget) that give the same verdict">
        Holds in {pct(report.confidence.confidence)} of scenarios
        {report.confidence.label_fused && " · VVM label included"}
        {coarse && ` · allows for a ${coarse.sensor}'s ±${coarse.sensor_accuracy_c} °C`}
      </p>

      {(stale || report.provisional || report.demo_time) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {stale && (
            <span className="rounded-full px-3 py-1" style={{ background: "var(--color-bad-tint)", color: "var(--color-bad-fg)" }}>
              {stale}
            </span>
          )}
          {!stale && report.provisional && (
            <span className="rounded-full bg-neutral-900 px-3 py-1 text-neutral-300">Carrier quiet since {time(report.data_through)}: may change</span>
          )}
          {report.demo_time && <span className="rounded-full bg-accent-900 px-3 py-1 text-accent-300">Demo time: {demoRate(report.time_scale)}</span>}
        </div>
      )}

      {report.confidence.borderline && report.product.kind === "vaccine" && onCheckLabel && (
        <button
          onClick={onCheckLabel}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-accent bg-transparent px-[18px] text-sm font-medium text-accent-300 hover:bg-accent/10"
        >
          Borderline · check the VVM label →
        </button>
      )}
    </section>
  );
}

const TONE: Record<Reason["severity"], { dot: string; ring: string; tag: string }> = {
  discard: { dot: "var(--color-bad)", ring: "var(--color-bad-tint)", tag: "Decides the verdict" },
  quarantine: { dot: "var(--color-hot)", ring: "var(--color-hot-tint)", tag: "Decides the verdict" },
  advisory: { dot: "var(--color-warn)", ring: "var(--color-warn-tint)", tag: "Good to know" },
  ok: { dot: "var(--color-good)", ring: "var(--color-good-tint)", tag: "" },
};

export function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
      {reasons.map((r, i) => {
        const tone = TONE[r.severity];
        return (
          <li key={i} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
            <span className="grid h-9 w-9 place-items-center">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: tone.dot, boxShadow: `0 0 0 4px ${tone.ring}` }} />
            </span>
            <span className="flex flex-col gap-[3px]">
              <span className="text-[17px] leading-[1.4] [text-wrap:pretty]">{r.text}</span>
              {tone.tag && <span className="text-[13px] uppercase tracking-[0.06em] text-neutral-400">{tone.tag}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The numbers behind the budget. */
export function Numbers({ report }: { report: Report }) {
  const learned = report.learned_rate && report.learned_rate.photos > 0 ? report.learned_rate : null;
  return (
    <div>
      <dl className="m-0 grid grid-cols-2 gap-2.5">
        <Stat label="Mean kinetic" value={temp(report.mkt_c)} />
        <Stat label="Peak" value={temp(report.peak_c)} />
        <Stat label="Out of range" value={`${Math.round(report.hours_out_of_range)} h`} />
        <Stat label="Last reading" value={temp(report.current_temp_c)} />
      </dl>
      <p className="m-0 mt-3 text-sm leading-[1.45] text-neutral-300">
        Stability data: {report.product.stability_ref}
        {learned ? `, adjusted to ${learned.scale_used.toFixed(2)}x from ${learned.photos} confirmed field photos` : ""}.{" "}
        {pct(report.initial_budget_used)} of the budget was used before monitoring began. The verdict holds in{" "}
        {pct(report.confidence.confidence)} of plausible scenarios.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <dt className="text-xs uppercase tracking-[0.08em] text-neutral-400">{label}</dt>
      <dd className="m-0 mt-0.5 text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
