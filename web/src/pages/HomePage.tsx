import { useState } from "react";
import { Link } from "react-router";

import { BoxCard } from "../components/BoxCard";
import { TapIcon, XIcon } from "../components/Icons";
import { ErrorNote, Layout, Spinner } from "../components/Layout";
import { api } from "../lib/api";
import { ago, SEVERITY_ORDER, VERDICT_STYLE } from "../lib/format";
import { usePoll } from "../lib/usePoll";
import type { Verdict } from "../types";

const TIERS: Verdict[] = ["USE", "USE_FIRST", "QUARANTINE", "DISCARD"];
type Filter = Verdict | "ALL";

export default function HomePage() {
  const boxes = usePoll(() => api.boxes(), 30000);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [waiting, setWaiting] = useState(false);

  const all = boxes.data ?? [];
  const sorted = [...all].sort(
    (a, b) => SEVERITY_ORDER[a.verdict] - SEVERITY_ORDER[b.verdict] || b.budget_used - a.budget_used,
  );
  const visible = sorted.filter((b) => filter === "ALL" || b.verdict === filter);
  const count = (v: Verdict) => all.filter((b) => b.verdict === v).length;
  const attention = all.filter((b) => b.verdict !== "USE").length;

  return (
    <Layout>
      <div className="flex items-center justify-between pb-7 pt-6">
        <Brand />
        <span className="text-xs text-neutral-500">{boxes.updatedAt ? `Updated ${ago(boxes.updatedAt / 1000)}` : ""}</span>
      </div>
      <p className="eyebrow m-0 mb-2">Fleet</p>
      <h1 className="m-0 mb-1.5 text-[30px] leading-[1.08] [text-wrap:pretty]">Is it still good?</h1>
      <p className="m-0 mb-[22px] text-[15px] text-neutral-400">
        {boxes.data ? `${all.length} boxes tracked · ${attention} need attention` : " "}
      </p>

      <button
        onClick={() => setWaiting(true)}
        className="flex w-full items-center gap-4 rounded-2xl px-[18px] py-4 text-left text-accent-200"
        style={{
          border: "1px solid color-mix(in srgb, var(--color-accent) 70%, transparent)",
          background: "color-mix(in srgb, var(--color-accent) 10%, var(--color-surface))",
          boxShadow: "0 0 40px color-mix(in srgb, var(--color-accent) 18%, transparent)",
        }}
      >
        <TapIcon size={30} className="shrink-0" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[17px] font-semibold leading-[1.15] tracking-[-0.02em]">Tap a box's sticker</span>
          <span className="text-[13.5px] text-neutral-400">Hold your phone to the tag to see its verdict</span>
        </span>
      </button>
      {waiting && (
        <div role="status" className="mt-3 flex items-center gap-3 rounded-xl border border-accent-700 bg-surface px-[18px] py-3.5 text-sm text-neutral-200">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent-400" style={{ animation: "vt-pulse 1.2s infinite" }} />
          <span className="flex-1">Waiting for a tag… or pick a box below.</span>
          <button onClick={() => setWaiting(false)} aria-label="Cancel" className="grid h-11 w-11 place-items-center text-neutral-300">
            <XIcon size={18} />
          </button>
        </div>
      )}

      <div className="mb-3 mt-6 flex flex-wrap gap-1.5" role="group" aria-label="Filter by verdict">
        <Chip active={filter === "ALL"} onClick={() => setFilter("ALL")} dot="var(--color-neutral-400)" label="All" count={all.length} />
        {TIERS.map((v) => (
          <Chip key={v} active={filter === v} onClick={() => setFilter(v)} dot={VERDICT_STYLE[v].color} label={VERDICT_STYLE[v].label} count={count(v)} />
        ))}
      </div>

      {boxes.error && !boxes.data && <ErrorNote error={boxes.error} onRetry={boxes.refresh} />}
      {!boxes.data && !boxes.error && <Spinner />}

      <div className="flex flex-col gap-2.5">
        {visible.map((b) => (
          <BoxCard key={b.id} box={b} />
        ))}
      </div>
      {boxes.data && visible.length === 0 && <p className="py-8 text-center text-base text-neutral-400">Nothing here.</p>}

      <p className="mt-8 text-center text-sm">
        <Link to="/tags" className="text-neutral-400 underline underline-offset-4 hover:text-neutral-200">
          NFC tags, the VVM test card and the stage demo
        </Link>
      </p>
    </Layout>
  );
}

export function Brand() {
  return (
    <span className="inline-flex items-center gap-[9px] text-sm font-semibold tracking-[-0.01em] text-neutral-200">
      <span
        className="h-[22px] w-[22px] rounded-[7px]"
        style={{
          background: "linear-gradient(145deg, var(--color-accent-400), var(--color-accent-700))",
          boxShadow: "0 0 16px color-mix(in srgb, var(--color-accent) 40%, transparent)",
        }}
      />
      Vialtality
    </span>
  );
}

function Chip({ active, onClick, dot, label, count }: { active: boolean; onClick: () => void; dot: string; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex !min-h-9 items-center gap-2 rounded-[9px] border px-3 text-[13px] font-medium"
      style={{
        borderColor: active ? "var(--color-accent-600)" : "var(--color-neutral-700)",
        background: active ? "var(--color-accent-900)" : "transparent",
        color: active ? "var(--color-accent-200)" : "var(--color-neutral-300)",
      }}
    >
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />
      {label}
      <span className="font-normal tabular-nums opacity-55">{count}</span>
    </button>
  );
}
