import { demoRate, hours, pct, temp, time } from "../lib/format";
import type { Reason, Report, Verdict } from "../types";
import { DataList, VerdictBadge, VerdictCard } from "./Brand";

/** A verdict as a signal badge (kept under its old name for the pages that use it). */
export function VerdictChip({ verdict }: { verdict: Verdict; small?: boolean }) {
  return <VerdictBadge verdict={verdict} />;
}

/** One short instruction under the verdict word, in the brand's voice. */
export function verdictNote(report: Report): string {
  switch (report.verdict) {
    case "USE":
      return "Safe to use";
    case "USE_FIRST":
      return "Use this box first";
    case "DISCARD":
      return "Set the box aside and report it";
    case "QUARANTINE": {
      // The engine's checks for this box ("Do the shake test", "Check the VVM on each vial").
      const steps = report.action.match(/keep it cold\. (.*) before use\./)?.[1];
      return steps ? `Keep it cold. ${steps} before use` : "Run the shake test or read each vial's VVM";
    }
  }
}

/**
 * Time left at the last reading, only while the box is usable: for a held or
 * spent box it isn't the question, and a frozen one would show decades.
 */
export function timeLeft(report: Report): string | null {
  if (report.verdict !== "USE" && report.verdict !== "USE_FIRST") return null;
  if (report.budget_remaining <= 0 || report.hours_left_at_current == null) return null;
  return report.hours_left_at_current > 365 * 24 ? "over a year left" : `${hours(report.hours_left_at_current)} left`;
}

/** The coarsest sensor that watched this box, if it's coarser than the design's. */
function coarseSensor(report: Report) {
  return report.segments.reduce<Report["segments"][number] | null>(
    (worst, s) => ((s.sensor_accuracy_c ?? 0) > Math.max(worst?.sensor_accuracy_c ?? 0, 0.5) ? s : worst),
    null,
  );
}

/**
 * The one thing a health worker needs: the verdict and what to do, then how
 * much budget is gone, what it rests on, and how sure it is.
 */
export function VerdictHero({ report, stale }: { report: Report; stale: string | null }) {
  const coarse = coarseSensor(report);
  const left = timeLeft(report);
  const records = report.segments.length;
  const rows = [
    { label: "Budget used", value: left ? `${pct(report.budget_used)} · ${left}` : pct(report.budget_used) },
    {
      label: "Witnesses",
      value: `${records} custody ${records === 1 ? "record" : "records"}${report.confidence.label_fused ? " + VVM" : ""}`,
    },
    {
      label: <span title="Share of plausible scenarios (sensor error, batch variation, starting budget) that give the same verdict">Confidence</span>,
      value: `Holds in ${pct(report.confidence.confidence)} of scenarios`,
    },
  ];
  if (coarse) rows.push({ label: "Sensor", value: `${coarse.sensor}, ±${coarse.sensor_accuracy_c} °C` });

  const notes = [
    report.confidence.borderline && report.product.kind === "vaccine"
      ? report.product.has_vvm
        ? "Borderline. Check the label."
        : "Borderline. A supervisor should decide."
      : null,
    !stale && report.provisional ? `Carrier quiet since ${time(report.data_through, report.segments.find((s) => !s.end_ts)?.tz)}, so this may change.` : null,
    report.demo_time ? `Demo time: ${demoRate(report.time_scale)}.` : null,
  ].filter(Boolean);

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        Verdict: {report.verdict.replace("_", " ").toLowerCase()}. {report.action}
      </span>
      {stale && <p className="m-0 mb-3 rounded-2xl border-[1.5px] border-line-strong bg-surface px-4 py-3">{stale}</p>}
      <VerdictCard verdict={report.verdict} budgetUsed={Math.round(Math.min(report.budget_used, 1) * 100)} note={verdictNote(report)} />
      {notes.map((n) => (
        <p key={n} className="ui-caption m-0 mt-3">
          {n}
        </p>
      ))}
      <div className="mt-4 rounded-2xl border border-line bg-surface px-4">
        <DataList rows={rows} />
      </div>
    </>
  );
}

const TAG: Record<Reason["severity"], string> = {
  discard: "Decides the verdict",
  quarantine: "Decides the verdict",
  advisory: "Good to know",
  ok: "",
};

/** Why: what decided the verdict (Ink dots), then what's good to know (Glacier). */
export function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {reasons.map((r, i) => {
        // The use-first reason is advisory in severity but it's what decides that verdict.
        const decides = r.severity === "discard" || r.severity === "quarantine" || r.code === "BUDGET_USE_FIRST";
        const tag = decides ? "Decides the verdict" : TAG[r.severity];
        return (
          <li key={i} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-3">
            <span className="grid h-6 w-4 place-items-center">
              <span className="h-2 w-2 rounded-full" style={{ background: decides ? "var(--text)" : "var(--accent)" }} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="[text-wrap:pretty]">{r.text}</span>
              {tag && <span className="ui-footnote font-semibold uppercase tracking-[0.04em]">{tag}</span>}
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
      <DataList
        rows={[
          { label: "Mean kinetic", value: temp(report.mkt_c) },
          { label: "Peak", value: temp(report.peak_c) },
          { label: "Out of range", value: `${Math.round(report.hours_out_of_range)} h` },
          { label: "Last reading", value: temp(report.current_temp_c) },
        ]}
      />
      <p className="ui-caption m-0 mt-2">
        Stability data: {report.product.stability_ref}
        {learned ? `, adjusted to ${learned.scale_used.toFixed(2)}x from ${learned.photos} confirmed field photos` : ""}.{" "}
        {pct(report.initial_budget_used)} of the budget was used before monitoring began. The verdict holds in{" "}
        {pct(report.confidence.confidence)} of plausible scenarios.
      </p>
    </div>
  );
}
