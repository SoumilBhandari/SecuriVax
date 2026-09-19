import { Link } from "react-router";

import { pct, VERDICT_STYLE } from "../lib/format";
import type { BoxSummary } from "../types";

/** One box in a list: a verdict stripe, what and where, how much budget is gone. */
export function BoxCard({ box: b, compact = false }: { box: BoxSummary; compact?: boolean }) {
  const v = VERDICT_STYLE[b.verdict];
  const unit = b.product_kind === "vaccine" ? "doses" : "tests";
  const route = b.origin ? `${b.origin} → ${b.destination}` : "not dispatched";
  return (
    <Link
      to={`/box/${b.id}`}
      className="card-soft grid w-full grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-3.5 py-3.5 pl-3.5 pr-4 text-left text-text hover:border-line-strong active:scale-[.99]"
    >
      <span className="w-1 self-stretch rounded-full opacity-90" style={{ background: v.color }} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-base font-semibold leading-[1.2] tracking-[-0.015em]">{b.product_name}</span>
        <span className="text-[13.5px] text-neutral-400">{compact ? b.id : `${b.quantity.toLocaleString()} ${unit} · ${route}`}</span>
        {!compact && (
          <span className="mt-1 flex items-center gap-2.5">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)]">
              <span className="block h-full rounded-full" style={{ width: `${Math.min(b.budget_used, 1) * 100}%`, background: v.color }} />
            </span>
            <span className="whitespace-nowrap text-[12.5px] tabular-nums text-neutral-400">{pct(b.budget_used)} used</span>
          </span>
        )}
      </span>
      <span className="pill" style={{ background: v.tint, color: v.color }}>
        {v.label}
      </span>
    </Link>
  );
}
