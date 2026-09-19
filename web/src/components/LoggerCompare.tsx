import { VERDICT_STYLE } from "../lib/format";
import type { Report } from "../types";

/** What a threshold logger concludes from the same record, next to our verdict. */
export function LoggerCompare({ report }: { report: Report }) {
  const log = report.logger;
  const style = VERDICT_STYLE[report.verdict];
  const doses = report.box.quantity.toLocaleString();
  const ours =
    log.outcome === "SAVED"
      ? `${doses} doses saved from an unnecessary discard: the budget says they survived.`
      : log.outcome === "CAUGHT"
        ? `${doses} doses stopped: no alarm would have fired, but the damage accrued.`
        : "Both reach the same call here.";
  return (
    <section aria-label="Threshold logger versus Vialtality">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line">
        <div className="bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Threshold logger</p>
          <p className={`mt-1 font-display text-lg font-bold ${log.alarm ? "text-bad" : "text-muted"}`}>
            {log.alarm ? "Discard" : "No alarm"}
          </p>
          <p className="text-xs text-muted">{log.alarm ? log.alarms.join(", ") : "nothing crossed its thresholds"}</p>
        </div>
        <div className="border-l border-line bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-cold">Vialtality</p>
          <p className={`mt-1 font-display text-lg font-bold ${style.text}`}>{style.label}</p>
          <p className="text-xs text-muted">{Math.round(report.budget_used * 100)}% of the stability budget</p>
        </div>
      </div>
      <p className={`mt-2 text-sm ${log.outcome === "AGREE" ? "text-muted" : "font-semibold text-ink"}`}>{ours}</p>
    </section>
  );
}
