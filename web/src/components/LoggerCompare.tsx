import type { Report } from "../types";
import { VerdictBadge } from "./Brand";

/** What a threshold logger concludes from the same record, next to our verdict. */
export function LoggerCompare({ report }: { report: Report }) {
  const log = report.logger;
  const units = `${report.box.quantity.toLocaleString()} ${report.product.kind === "vaccine" ? "doses" : "tests"}`;
  const note =
    log.outcome === "SAVED"
      ? `${units} saved from a needless discard: the budget says they survived.`
      : log.outcome === "CAUGHT"
        ? `${units} stopped: no alarm fired, but damage accrued.`
        : "Both reach the same call here.";
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div className="tile">
          <p className="eyebrow m-0 mb-2">Logger</p>
          <p className="m-0 font-display text-lg font-semibold">{log.alarm ? "Discard" : "No alarm"}</p>
          {log.alarm && <p className="ui-caption m-0 mt-1">{log.alarms.join(", ")}</p>}
        </div>
        <div className="tile">
          <p className="eyebrow m-0 mb-2">SecuriVax</p>
          <VerdictBadge verdict={report.verdict} />
          <p className="ui-caption m-0 mt-1">{Math.round(report.budget_used * 100)}% of the budget</p>
        </div>
      </div>
      <p className="m-0 mt-3">{note}</p>
      {log.outcome === "SAVED" && (
        <p className="ui-caption m-0 mt-1">Assumes an alarm means discard, which is common but not universal.</p>
      )}
    </div>
  );
}
