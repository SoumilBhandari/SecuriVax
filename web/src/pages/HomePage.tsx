import { Link } from "react-router";

import { TapIcon } from "../components/Icons";
import { Layout, Spinner } from "../components/Layout";
import { VerdictChip } from "../components/Verdict";
import { api } from "../lib/api";
import { SEVERITY_ORDER, VERDICT_STYLE } from "../lib/format";
import { usePoll } from "../lib/usePoll";
import type { Verdict } from "../types";

const TIERS: Verdict[] = ["USE", "USE_FIRST", "QUARANTINE", "DISCARD"];
const DOT: Record<Verdict, string> = { USE: "bg-ok", USE_FIRST: "bg-[#f4b942]", QUARANTINE: "bg-hot", DISCARD: "bg-bad" };

export default function HomePage() {
  const boxes = usePoll(() => api.boxes(), 30000);
  const fleet = usePoll(() => api.fleet(), 60000);
  const sorted = [...(boxes.data ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.verdict] - SEVERITY_ORDER[b.verdict] || b.budget_used - a.budget_used,
  );

  return (
    <Layout>
      <p className="text-xs font-bold uppercase tracking-wider text-muted">Fleet verdicts · {boxes.data?.length ?? "…"} boxes</p>
      <h1 className="mb-4 font-display text-3xl font-bold leading-tight tracking-tight">Is it still good? Know before you inject.</h1>

      {fleet.data && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TIERS.map((v) => (
              <div key={v} className="rounded-2xl border border-line bg-white p-3">
                <p className="flex items-center gap-2 font-display text-3xl font-bold">
                  <span className={`h-2.5 w-2.5 rounded-full ${DOT[v]}`} />
                  {fleet.data!.counts[v] ?? 0}
                </p>
                <p className="text-xs font-bold uppercase tracking-wider text-muted">{VERDICT_STYLE[v].label}</p>
              </div>
            ))}
          </div>
          <div className="mb-5 grid gap-2 sm:grid-cols-3">
            <Tile label="Doses and tests tracked" value={fleet.data.doses_tracked} />
            <Tile label="Saved from needless discard" value={fleet.data.saved_from_needless_discard} tone="text-ok"
              note="Threshold alarms fired, budget says still good" />
            <Tile label="Silent failures caught" value={fleet.data.silent_failures_caught} tone="text-hot"
              note="No alarm ever fired, damage still accrued" />
          </div>
        </>
      )}

      <div className="mb-5 flex items-center gap-3 rounded-2xl bg-ink p-4 text-white">
        <TapIcon className="shrink-0 text-sky-300" size={24} />
        <p className="text-sm">Tap the sticker on any box with your phone to see its verdict.</p>
      </div>

      {boxes.error && !boxes.data && (
        <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-900">
          {boxes.error}
          <button onClick={boxes.refresh} className="ml-3 rounded-lg bg-ink px-3 text-white">Try again</button>
        </div>
      )}
      {!boxes.data && !boxes.error && <Spinner />}

      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((b) => (
          <Link key={b.id} to={`/box/${b.id}`} className="block rounded-2xl border border-line bg-white p-4 hover:border-faint">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-bold">{b.product_name}</p>
                <p className="text-sm text-muted">{b.id} · {b.quantity.toLocaleString()} doses</p>
              </div>
              <VerdictChip verdict={b.verdict} />
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${VERDICT_STYLE[b.verdict].bar}`} style={{ width: `${Math.min(b.budget_used, 1) * 100}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span><b>{Math.round(b.budget_used * 100)}%</b> budget used</span>
              <span className="text-muted">MKT {b.mkt_c == null ? "–" : `${b.mkt_c.toFixed(1)} °C`}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm text-muted">
              <span>{b.origin ? `${b.origin} → ${b.destination}` : b.current_node_id ?? "Not in a carrier"}</span>
              <span>{b.status}</span>
            </div>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        <Link to="/tags" className="underline underline-offset-2">NFC tags and the VVM test card</Link>
      </p>
    </Layout>
  );
}

function Tile({ label, value, tone = "", note }: { label: string; value: number; tone?: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className={`text-xs font-bold uppercase tracking-wider ${tone || "text-muted"}`}>{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  );
}
