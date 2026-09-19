import { Link, useViewTransitionState } from "react-router";

import { pct } from "../lib/format";
import type { BoxSummary } from "../types";
import { BudgetRing, VerdictBadge } from "./Brand";

/** One box in a list: its budget ring, what and where, and its verdict. */
export function BoxCard({ box: b, compact = false }: { box: BoxSummary; compact?: boolean }) {
  const to = `/box/${b.id}`;
  // Only the card being opened carries its badge across to the next page's field.
  const leaving = useViewTransitionState(to);
  const unit = b.product_kind === "vaccine" ? "doses" : "tests";
  const route = b.origin ? `${b.origin} → ${b.destination}` : "not dispatched";
  return (
    <Link
      to={to}
      viewTransition
      className={`lift grid w-full items-center gap-3 rounded-[18px] border border-line bg-surface p-4 text-left text-text no-underline active:scale-[.99] ${compact ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[40px_minmax(0,1fr)_auto]"}`}
    >
      {!compact && <BudgetRing value={Math.round(Math.min(b.budget_used, 1) * 100)} size={40} glyph={false} />}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-display text-[17px] font-semibold leading-[22px] tracking-[-0.01em]">{b.product_name}</span>
        <span className="ui-caption">{compact ? b.id : `${b.quantity.toLocaleString()} ${unit} · ${route}`}</span>
        {!compact && <span className="text-[15px] font-semibold leading-5 tabular-nums">{pct(b.budget_used)} of budget used</span>}
      </span>
      <span style={leaving ? ({ viewTransitionName: "verdict" } as React.CSSProperties) : undefined} className="inline-flex">
        <VerdictBadge verdict={b.verdict} />
      </span>
    </Link>
  );
}
