import { VERDICT_STYLE } from "../lib/format";
import type { Report } from "../types";

/** What a threshold logger concludes from the same record, next to our verdict. */
export function LoggerCompare({ report }: { report: Report }) {
  const log = report.logger;
  const style = VERDICT_STYLE[report.verdict];
  const doses = report.box.quantity.toLocaleString();
  const ours =
    log.outcome === "SAVED"
      ? `The budget says this unit survived. ${doses} doses saved from an unnecessary discard.`
      : log.outcome === "CAUGHT"
        ? `No alarm would have fired, but damage accrued. ${doses} doses stopped before they reach a patient.`
        : "Here the threshold logger and the stability budget reach the same call.";
  return (
    <section className="mb-4 grid gap-3 sm:grid-cols-2" aria-label="Threshold logger versus Vialtality">
      <div className="rounded-2xl border border-line bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Threshold logger says</p>
        <p className="mt-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${log.alarm ? "bg-red-100 text-bad" : "bg-slate-100 text-muted"}`}>
            {log.alarm ? `ALARM · ${Math.round(log.hours_out_of_range)} h out of range` : "No alarm"}
          </span>
        </p>
        <p className="mt-2 text-sm text-muted">
          {log.alarm
            ? `It says "excursion" (${log.alarms.join(", ")}), and the conservative call is to discard.`
            : "Nothing crossed its alarm thresholds, so it stays silent."}
        </p>
      </div>
      <div className={`rounded-2xl border-2 bg-white p-4 ${log.outcome === "AGREE" ? "border-line" : "border-cold"}`}>
        <p className="text-xs font-bold uppercase tracking-wider text-cold">Vialtality says</p>
        <p className="mt-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${style.chip}`}>
            {style.label} · {Math.round(report.budget_used * 100)}% used
          </span>
        </p>
        <p className="mt-2 text-sm">{ours}</p>
      </div>
    </section>
  );
}
