import { api } from "../lib/api";
import { pct, VERDICT_STYLE } from "../lib/format";
import { usePoll } from "../lib/usePoll";
import { VerdictChip } from "./Verdict";

/** Same thermal history, different product: stability is product-specific. */
export function Counterfactual({ boxId }: { boxId: string }) {
  const { data, error } = usePoll(() => api.counterfactual(boxId), null, [boxId]);
  if (error) return <p className="text-sm text-muted">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Working it out…</p>;
  const rows = [...data].sort((a, b) => Number(b.this_box) - Number(a.this_box) || a.budget_used - b.budget_used);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.product_id} className={`grid grid-cols-[minmax(0,1fr)_3.5rem_auto] items-center gap-2 rounded-lg px-2 py-1.5 ${r.this_box ? "bg-sky-50 ring-1 ring-cold" : ""}`}>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{r.name}{r.this_box && <span className="ml-1 text-xs font-normal text-cold">this box</span>}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${VERDICT_STYLE[r.verdict].bar}`} style={{ width: `${Math.min(r.budget_used, 1) * 100}%` }} />
            </div>
          </div>
          <span className="text-right font-mono text-sm tabular-nums">{pct(r.budget_used)}</span>
          <VerdictChip verdict={r.verdict} />
        </li>
      ))}
    </ul>
  );
}
