import { api } from "../lib/api";
import { budgetPct } from "../lib/format";
import { usePoll } from "../lib/usePoll";
import { VerdictBadge } from "./Brand";

/** Same trip, other products: stability is product-specific. */
export function Counterfactual({ boxId }: { boxId: string }) {
  const { data, error } = usePoll(() => api.counterfactual(boxId), null, [boxId]);
  if (error) return <p className="ui-caption m-0">{error}</p>;
  if (!data) return <p className="ui-caption m-0">Working it out…</p>;
  const rows = [...data].sort((a, b) => Number(b.this_box) - Number(a.this_box) || a.budget_used - b.budget_used);
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((r) => (
        <li key={r.product_id} className="grid grid-cols-[minmax(0,1fr)_48px_auto] items-center gap-3 border-t border-line py-3 first:border-0">
          <span className={`truncate text-[15px] ${r.this_box ? "font-bold" : ""}`}>
            {r.name}
            {r.this_box && " (this box)"}
          </span>
          <span className="text-right text-[15px] font-bold tabular-nums">{budgetPct(r.budget_used)}</span>
          <VerdictBadge verdict={r.verdict} />
        </li>
      ))}
    </ul>
  );
}
