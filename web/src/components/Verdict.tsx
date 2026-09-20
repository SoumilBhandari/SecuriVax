import { budgetPct, hours, pct, temp } from "../lib/format";
import type { Reason, Report, Verdict } from "../types";
import { DataList, VerdictBadge } from "./Brand";

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
        {budgetPct(report.initial_budget_used)} of the budget was used before monitoring began. The verdict holds in{" "}
        {pct(report.confidence.confidence)} of plausible scenarios.
      </p>
    </div>
  );
}
