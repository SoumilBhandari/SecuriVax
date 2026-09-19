import { api } from "../lib/api";
import { pct, VERDICT_STYLE } from "../lib/format";
import { usePoll } from "../lib/usePoll";

/** Same trip, other products: stability is product-specific. */
export function Counterfactual({ boxId }: { boxId: string }) {
  const { data, error } = usePoll(() => api.counterfactual(boxId), null, [boxId]);
  if (error) return <p className="m-0 text-sm text-neutral-400">{error}</p>;
  if (!data) return <p className="m-0 text-sm text-neutral-400">Working it out…</p>;
  const rows = [...data].sort((a, b) => Number(b.this_box) - Number(a.this_box) || a.budget_used - b.budget_used);
  return (
    <ul className="-mx-2 m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((r) => {
        const v = VERDICT_STYLE[r.verdict];
        return (
          <li
            key={r.product_id}
            className="grid grid-cols-[minmax(0,1fr)_52px_auto] items-center gap-3 rounded-lg px-2 py-2"
            style={{ background: r.this_box ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "transparent" }}
          >
            <span className="flex min-w-0 flex-col gap-[5px]">
              <span className="truncate text-[15px] font-semibold">
                {r.name}
                {r.this_box && " (this box)"}
              </span>
              <span className="h-[5px] overflow-hidden rounded-full bg-neutral-800">
                <span className="block h-full" style={{ width: `${Math.min(r.budget_used, 1) * 100}%`, background: v.color }} />
              </span>
            </span>
            <span className="text-right text-sm tabular-nums">{pct(r.budget_used)}</span>
            <span className="pill !px-[9px] !py-1 !text-[11px]" style={{ background: v.tint, color: v.color }}>
              {v.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
