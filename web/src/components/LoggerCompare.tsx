import { VERDICT_STYLE } from "../lib/format";
import type { Report } from "../types";

/** What a threshold logger concludes from the same record, next to our verdict. */
export function LoggerCompare({ report }: { report: Report }) {
  const log = report.logger;
  const v = VERDICT_STYLE[report.verdict];
  const doses = report.box.quantity.toLocaleString();
  const note =
    log.outcome === "SAVED"
      ? `${doses} doses saved from a needless discard: the budget says they survived.`
      : log.outcome === "CAUGHT"
        ? `${doses} doses stopped: no alarm fired, but damage accrued.`
        : "Both reach the same call here.";
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="tile !px-4 !py-3.5">
          <p className="m-0 mb-1 text-xs uppercase tracking-[0.08em] text-neutral-400">Logger</p>
          <p className="m-0 text-[22px] font-medium">{log.alarm ? "Discard" : "No alarm"}</p>
          {log.alarm && <p className="m-0 mt-1 text-xs text-neutral-400">{log.alarms.join(", ")}</p>}
        </div>
        <div className="rounded-lg px-4 py-3.5" style={{ background: v.tint, color: v.fg }}>
          <p className="m-0 mb-1 text-xs uppercase tracking-[0.08em] opacity-80">Vialtality</p>
          <p className="m-0 text-[22px] font-medium" style={{ color: v.color }}>
            {v.label}
          </p>
          <p className="m-0 mt-1 text-xs opacity-80">{Math.round(report.budget_used * 100)}% of the budget</p>
        </div>
      </div>
      <p className="m-0 mt-3 text-[15px] leading-[1.45]">{note}</p>
      {log.outcome === "SAVED" && (
        <p className="m-0 mt-1 text-[13px] text-neutral-400">Assumes an alarm means discard, which is common but not universal.</p>
      )}
    </div>
  );
}
