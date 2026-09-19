import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { BoxCard } from "../components/BoxCard";
import { Logo, ThemeToggle } from "../components/Brand";
import { ListIcon, MapIcon, NfcIcon, SearchIcon, XIcon } from "../components/Icons";
import { Account, ErrorNote, Layout, Spinner } from "../components/Layout";
import { Reveal } from "../components/Reveal";
import { Segmented } from "../components/Segmented";
import { api } from "../lib/api";
import { useCanTapTags } from "../lib/device";
import { ago, SEVERITY_ORDER } from "../lib/format";
import { refreshScroll } from "../lib/motion";
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

// The map pulls in Leaflet, so it loads only when someone opens it.
const ShipmentsView = lazy(() => import("../components/ShipmentsMap"));
const VIEW_KEY = "securivax.boxView";
type View = "list" | "map";

function savedView(): View {
  const asked = new URLSearchParams(window.location.search).get("view");
  if (asked === "map" || asked === "list") return asked;
  try {
    return localStorage.getItem(VIEW_KEY) === "map" ? "map" : "list";
  } catch {
    return "list";
  }
}

/** Every box, worst first: the list a health worker scans, or the same boxes on a map. */
export default function HomePage() {
  const boxes = usePoll(() => api.boxes(), 30000);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [waiting, setWaiting] = useState(false);
  const [view, setView] = useState<View>(savedView);
  const pickView = (v: View) => {
    setView(v);
    refreshScroll();
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: the choice lasts this visit */
    }
  };
  // A computer can't read the stickers, so it gets a search instead of the tap button.
  const canTap = useCanTapTags();
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const all = boxes.data ?? [];
  const sorted = [...all].sort((a, b) => SEVERITY_ORDER[a.verdict] - SEVERITY_ORDER[b.verdict] || b.budget_used - a.budget_used);
  const active = FILTERS.find((f) => f.id === filter)!;
  const q = query.trim().toLowerCase();
  const found = (b: BoxSummary) => !q || [b.id, b.product_name, b.origin, b.destination].some((s) => s?.toLowerCase().includes(q));
  const visible = sorted.filter(active.match).filter(found);
  // Enter opens the box: an exact ID, or the only one left.
  const open = () => {
    const pick = all.find((b) => b.id.toLowerCase() === q) ?? (visible.length === 1 ? visible[0] : null);
    if (pick) navigate(`/box/${pick.id}`, { viewTransition: true });
  };
  const toCheck = all.filter((b) => b.verdict === "QUARANTINE" || b.verdict === "DISCARD").length;

  return (
    <Layout>
      {/* On a laptop the top bar carries the logo and the theme switch. */}
      <div className="flex items-center justify-between gap-3 pb-6 pt-4 lg:hidden">
        <Logo height={26} />
        <span className="flex gap-2">
          <ThemeToggle />
          <Account compact />
        </span>
      </div>

      <Reveal each stagger={0.06} className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-end lg:gap-12">
        <div>
          <p className="eyebrow m-0 mb-2">Boxes</p>
          <h1 className="ui-title m-0 mb-2">Is it still good?</h1>
          <p className="ui-caption m-0 mb-6 text-[17px] leading-6 lg:mb-7">
            {boxes.data ? `${all.length} boxes tracked · ${toCheck} to check` : " "}
            {boxes.updatedAt && <span className="hidden sm:inline"> · updated {ago(boxes.updatedAt / 1000)}</span>}
          </p>
        </div>
        <div className="lg:mb-7">
          {!canTap ? (
            <FindBox query={query} onChange={setQuery} onOpen={open} />
          ) : (
            <button onClick={() => setWaiting(true)} className="btn-primary min-h-[68px] !justify-start gap-4 py-2 text-left">
              <NfcIcon size={30} className="shrink-0" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>Tap a box's sticker</span>
                <span className="text-[14px] font-normal leading-5 tracking-[-0.016em] opacity-80">Hold your phone to the tag to see its verdict</span>
              </span>
            </button>
          )}
          {waiting && (
            <div role="status" className="panel modal-in mt-3 flex items-center gap-3 px-4 py-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--accent)", animation: "vt-pulse 1.2s infinite" }} />
              <span className="flex-1">Waiting for a tag, or pick a box below.</span>
              <button onClick={() => setWaiting(false)} aria-label="Cancel" className="grid h-11 w-11 place-items-center text-neutral-500 hover:text-text">
                <XIcon size={18} />
              </button>
            </div>
          )}
        </div>
      </Reveal>

      <Reveal className="mb-4 mt-6 flex flex-col gap-3 sm:flex-row sm:items-center lg:mt-8">
        <div className="-mx-5 flex-1 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:overflow-visible">
          <Segmented
            label="Filter by verdict"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: all.filter(f.match).filter(found).length }))}
          />
        </div>
        <Segmented
          className="self-end sm:self-auto"
          label="Show as"
          value={view}
          onChange={pickView}
          options={[
            { id: "list", label: <ListIcon size={18} />, title: "List" },
            { id: "map", label: <MapIcon size={18} />, title: "Map" },
          ]}
        />
      </Reveal>

      {boxes.error && !boxes.data && <ErrorNote error={boxes.error} onRetry={boxes.refresh} />}
      {!boxes.data && !boxes.error && <Spinner />}

      {view === "map" && boxes.data ? (
        <Suspense fallback={<Spinner label="Opening the map" />}>
          <div className="fade-in">
            <ShipmentsView boxes={visible} />
          </div>
        </Suspense>
      ) : (
        <Reveal each stagger={0.05} key={`${filter}-${q}`} className="flex flex-col gap-3 lg:grid lg:grid-cols-2">
          {visible.map((b) => (
            <BoxCard key={b.id} box={b} />
          ))}
        </Reveal>
      )}
      {boxes.data && visible.length === 0 && <p className="py-10 text-center text-neutral-500">{q ? `No box matches "${query.trim()}".` : "Nothing here."}</p>}

      <p className="mt-10 text-center text-[14px]">
        <Link to="/tags" viewTransition className="text-neutral-500 underline underline-offset-4 hover:text-text">
          NFC tags, the VVM test card and the stage demo
        </Link>
      </p>
    </Layout>
  );
}

/** The computer's way in: type an ID, a product or a place. "/" jumps here. */
function FindBox({ query, onChange, onOpen }: { query: string; onChange: (q: string) => void; onOpen: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, select, textarea");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onOpen();
      }}
    >
      <label htmlFor="find-box" className="relative block">
        <span className="sr-only">Find a box</span>
        <SearchIcon size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          ref={input}
          id="find-box"
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            onOpen();
          }}
          placeholder="Find a box: ID, product or place"
          autoComplete="off"
          spellCheck={false}
          className="select-pill w-full pl-12"
        />
      </label>
    </form>
  );
}
