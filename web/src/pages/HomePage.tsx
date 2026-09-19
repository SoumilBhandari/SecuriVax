import { useState } from "react";
import { Link } from "react-router";

import { BoxCard } from "../components/BoxCard";
import { Logo, ThemeToggle } from "../components/Brand";
import { NfcIcon, XIcon } from "../components/Icons";
import { ErrorNote, Layout, Spinner } from "../components/Layout";
import { api } from "../lib/api";
import { ago, SEVERITY_ORDER } from "../lib/format";
import { usePoll } from "../lib/usePoll";
import type { BoxSummary } from "../types";

// The kit's three verdict words: USE_FIRST boxes count under Use (they sort first within it).
const FILTERS = [
  { id: "ALL", label: "All", match: () => true },
  { id: "USE", label: "Use", match: (b: BoxSummary) => b.verdict === "USE" || b.verdict === "USE_FIRST" },
  { id: "QUARANTINE", label: "Quarantine", match: (b: BoxSummary) => b.verdict === "QUARANTINE" },
  { id: "DISCARD", label: "Discard", match: (b: BoxSummary) => b.verdict === "DISCARD" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

export default function HomePage() {
  const boxes = usePoll(() => api.boxes(), 30000);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [waiting, setWaiting] = useState(false);

  const all = boxes.data ?? [];
  const sorted = [...all].sort(
    (a, b) => SEVERITY_ORDER[a.verdict] - SEVERITY_ORDER[b.verdict] || b.budget_used - a.budget_used,
  );
  const active = FILTERS.find((f) => f.id === filter)!;
  const visible = sorted.filter(active.match);
  const toCheck = all.filter((b) => b.verdict === "QUARANTINE" || b.verdict === "DISCARD").length;

  return (
    <Layout>
      {/* On a laptop the sidebar carries the logo and the theme switch. */}
      <div className="flex items-center justify-between gap-3 pb-8 pt-6 lg:justify-end lg:pt-8">
        <span className="flex lg:hidden">
          <Logo height={30} />
        </span>
        <span className="flex items-center gap-3">
          <span className="ui-caption text-right">{boxes.updatedAt ? `Updated ${ago(boxes.updatedAt / 1000)}` : ""}</span>
          <span className="flex lg:hidden">
            <ThemeToggle />
          </span>
        </span>
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-end lg:gap-10">
        <div>
          <p className="eyebrow m-0 mb-2">Boxes</p>
          <h1 className="ui-title m-0 mb-1">Is it still good?</h1>
          <p className="m-0 mb-6 text-neutral-500">{boxes.data ? `${all.length} boxes tracked · ${toCheck} to check` : " "}</p>
        </div>
        <div className="lg:mb-6">
          <button onClick={() => setWaiting(true)} className="btn-primary min-h-16 !justify-start gap-3 py-2 text-left">
            <NfcIcon size={28} className="shrink-0" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>Tap a box's sticker</span>
              <span className="font-sans text-sm font-normal leading-5 tracking-normal">Hold your phone to the tag to see its verdict</span>
            </span>
          </button>
          {waiting && (
            <div role="status" className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--glacier-500)", animation: "vt-pulse 1.2s infinite" }} />
              <span className="flex-1">Waiting for a tag, or pick a box below.</span>
              <button onClick={() => setWaiting(false)} aria-label="Cancel" className="grid h-11 w-11 place-items-center text-neutral-500 hover:text-text">
                <XIcon size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 mt-8 flex flex-wrap gap-2" role="group" aria-label="Filter by verdict">
        {FILTERS.map((f) => (
          <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            <span className="font-normal tabular-nums opacity-60">{all.filter(f.match).length}</span>
          </button>
        ))}
      </div>

      {boxes.error && !boxes.data && <ErrorNote error={boxes.error} onRetry={boxes.refresh} />}
      {!boxes.data && !boxes.error && <Spinner />}

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2">
        {visible.map((b) => (
          <BoxCard key={b.id} box={b} />
        ))}
      </div>
      {boxes.data && visible.length === 0 && <p className="py-8 text-center text-neutral-500">Nothing here.</p>}

      <p className="mt-8 text-center text-sm">
        <Link to="/tags" className="text-neutral-500 underline underline-offset-4 hover:text-text">
          NFC tags, the VVM test card and the stage demo
        </Link>
      </p>
    </Layout>
  );
}
