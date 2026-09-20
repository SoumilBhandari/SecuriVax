import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { ChevronDownIcon } from "../components/Icons";
import { ErrorNote, Layout, PageTitle, SectionTitle, Spinner, Split } from "../components/Layout";
import RiskMap from "../components/RiskMap";
import { VerdictChip } from "../components/Verdict";
import { api } from "../lib/api";
import { ago, RISK_COLOR, RISK_ORDER, time, weatherSource } from "../lib/format";
import type { CarrierPerformance, Risk, StoreRisk, StoresAtRisk } from "../types";

const RISKS: Risk[] = ["extreme", "high", "moderate", "low"];
type Filter = "action" | "all" | Risk;

/**
 * Heat ahead, at a glance: how the sites split by risk, the map, and one
 * short row per site. The rows that need doing something come first and
 * alone; a row (or its dot on the map) opens its forecast and what to do.
 */
export default function ClimatePage() {
  const [stores, setStores] = useState<StoresAtRisk | null>(null);
  const [carriers, setCarriers] = useState<CarrierPerformance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("action");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    api.storesAtRisk().then(setStores).catch((e: Error) => setError(e.message));
    api.carriers().then(setCarriers).catch(() => setCarriers([]));
  }, []);

  const sites = [...(stores?.facilities ?? [])].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.peak_c - a.peak_c);
  const needs = sites.filter((s) => s.risk === "extreme" || s.risk === "high");
  const current: Filter = filter === "action" && needs.length === 0 ? "all" : filter;
  const shown = current === "action" ? needs : current === "all" ? sites : sites.filter((s) => s.risk === current);

  // Picking a dot on the map: show its row (widening the filter if needed) and bring it into view.
  const pick = (id: string) => {
    const site = sites.find((s) => s.id === id);
    if (site && !shown.includes(site)) setFilter("all");
    setOpen((o) => (o === id ? null : id));
    requestAnimationFrame(() => rows.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  return (
    <Layout>
      <PageTitle
        top
        eyebrow="Climate"
        title="Heat ahead"
        sub={stores ? `${weatherSource(stores.source)} · updated ${ago(stores.generated_at)}` : "Weather forecast against the cold chain"}
      />
      {error && <ErrorNote error={error} />}
      {!stores && !error && <Spinner label="Fetching the forecast" />}

      {/* On a laptop the map stays in view on the left while the rows scroll. */}
      <Split
        wide="left"
        left={
          stores && (
            <>
              <p className="ui-heading m-0">{stores.summary}</p>
              <RiskBar sites={sites} filter={current} onFilter={(f) => setFilter(current === f ? "all" : f)} />
              <div className="mt-4">
                <RiskMap sites={sites} selected={open} onSelect={pick} legend={false} />
              </div>
              <p className="ui-caption m-0 mt-2">A forecast: it never changes a box's verdict.</p>
            </>
          )
        }
        right={
          <>
            {stores && (
              <>
                <SectionTitle
                  aside={
                    <span className="flex gap-2">
                      {needs.length > 0 && (
                        <button className="chip !min-h-8 !px-3 !text-[13px]" aria-pressed={current === "action"} onClick={() => setFilter("action")}>
                          Needs action {needs.length}
                        </button>
                      )}
                      <button className="chip !min-h-8 !px-3 !text-[13px]" aria-pressed={current === "all"} onClick={() => setFilter("all")}>
                        All {sites.length}
                      </button>
                    </span>
                  }
                >
                  Sites · next 72 h
                </SectionTitle>
                <ul className="panel m-0 list-none p-0">
                  {shown.map((site, i) => (
                    <SiteRow
                      key={site.id}
                      site={site}
                      first={i === 0}
                      open={open === site.id}
                      onToggle={() => setOpen(open === site.id ? null : site.id)}
                      rowRef={(el) => (el ? rows.current.set(site.id, el) : rows.current.delete(site.id))}
                    />
                  ))}
                </ul>
              </>
            )}

            <SectionTitle aside="cold life from real trips">Carriers</SectionTitle>
            {!carriers ? (
              <Spinner />
            ) : (
              <ul className="panel m-0 list-none p-0">
                {carriers.map((c, i) => (
                  <CarrierRow key={c.node_id} carrier={c} first={i === 0} />
                ))}
              </ul>
            )}
          </>
        }
      />
    </Layout>
  );
}

/** "Mon 15:00" at the site: enough for a row (the open row has the full label). */
function dayHour(ts: number, tz?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz ?? undefined }).format(new Date(ts * 1000));
  } catch {
    return time(ts, tz);
  }
}

/** How the sites split by risk: one bar, and each part filters the rows. */
function RiskBar({ sites, filter, onFilter }: { sites: StoreRisk[]; filter: Filter; onFilter: (r: Risk) => void }) {
  const counts = RISKS.map((r) => ({ r, n: sites.filter((s) => s.risk === r).length }));
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={counts.map((c) => `${c.n} ${c.r}`).join(", ")}>
        {counts.map(({ r, n }) =>
          n ? <span key={r} style={{ width: `${(n / sites.length) * 100}%`, background: RISK_COLOR[r], opacity: filter === r || !RISKS.includes(filter as Risk) ? 1 : 0.35 }} /> : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Show sites by risk">
        {counts.map(({ r, n }) => (
          <button key={r} className="chip !min-h-8 !px-3 !text-[13px] capitalize" aria-pressed={filter === r} disabled={!n} onClick={() => onFilter(r)}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_COLOR[r] }} />
            {r}
            <span className="font-normal tabular-nums opacity-60">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** One site on one line; open, its forecast, what to do, and the boxes there. */
function SiteRow({
  site,
  first,
  open,
  onToggle,
  rowRef,
}: {
  site: StoreRisk;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  rowRef: (el: HTMLLIElement | null) => void;
}) {
  return (
    <li ref={rowRef} className={first ? "" : "border-t border-line"} style={open ? { background: "var(--quiet)" } : undefined}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 bg-transparent px-4 py-3 text-left text-text hover:bg-[var(--quiet)]"
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_COLOR[site.risk] }} aria-label={site.risk} />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold">{site.name}</span>
          <span className="ui-caption block truncate">
            Peak {site.peak_c.toFixed(0)} °C {dayHour(site.peak_ts, site.tz)}
            {site.hours_above_30_next_72h > 0 && ` · ${site.hours_above_30_next_72h} h over 30 °C`}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {site.stock.length > 0 && <span className="pill">{site.stock.length} {site.stock.length === 1 ? "box" : "boxes"}</span>}
          <ChevronDownIcon size={18} className="shrink-0 text-neutral-500 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </span>
      </button>
      {open && (
        <div className="rise-in flex flex-col gap-2 px-4 pb-4">
          <p className="ui-caption m-0">Hottest {time(site.peak_ts, site.tz)}</p>
          <Forecast points={site.forecast} />
          {site.actions.map((a) => (
            <p key={a} className="m-0 text-[15px]">
              {a}
            </p>
          ))}
          {site.stock.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {site.stock.map((b) => (
                <Link key={b.id} to={`/box/${b.id}`} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-text no-underline hover:border-line-strong">
                  {b.id}
                  <VerdictChip verdict={b.verdict} small />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** 72 h forecast strip with the 30 °C line. */
function Forecast({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null;
  const temps = points.map(([, c]) => c);
  const lo = Math.min(...temps, 15);
  const hi = Math.max(...temps, 35);
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const x = (t: number) => ((t - t0) / (t1 - t0)) * 300;
  const y = (c: number) => 36 - ((c - lo) / (hi - lo)) * 32;
  return (
    <svg viewBox="0 0 300 40" className="mt-1 h-10 w-full" role="img" aria-label="72-hour temperature forecast">
      <line x1={0} x2={300} y1={y(30)} y2={y(30)} stroke="var(--text-muted)" strokeDasharray="3 3" />
      <polyline points={points.map(([t, c]) => `${x(t).toFixed(1)},${y(c).toFixed(1)}`).join(" ")} fill="none" stroke="var(--line)" strokeWidth={1.5} strokeLinejoin="round" />
      <text x={298} y={y(30) - 3} textAnchor="end" fontSize="8" fill="var(--text-muted)">
        30 °C
      </text>
    </svg>
  );
}

/** One carrier on one line: how much of its rated cold life it really holds; open for the detail. */
function CarrierRow({ carrier, first }: { carrier: CarrierPerformance; first: boolean }) {
  const [open, setOpen] = useState(false);
  const share = carrier.effective_cold_life_h == null ? null : Math.min(carrier.effective_cold_life_h / carrier.rated_cold_life_h, 1);
  return (
    <li className={first ? "" : "border-t border-line"}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 bg-transparent px-4 py-3 text-left text-text hover:bg-[var(--quiet)]"
      >
        <span className="truncate text-[15px] font-semibold">{carrier.label}</span>
        <span className="pill">{carrier.rating}</span>
        {share != null && (
          <span className="col-span-2 flex items-center gap-3">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, 2)}%`, background: "var(--line)" }} />
            </span>
            <span className="ui-caption shrink-0 tabular-nums">
              {carrier.effective_cold_life_h} / {carrier.rated_cold_life_h} h
            </span>
          </span>
        )}
      </button>
      {open && (
        <div className="rise-in flex flex-col gap-1 px-4 pb-4">
          <p className="m-0 text-[15px]">{carrier.note}</p>
          {share != null && (
            <p className="ui-caption m-0">
              {carrier.effective_cold_life_h} h of cold on its worst trip vs {carrier.rated_cold_life_h} h rated · {carrier.legs.length} trips checked
            </p>
          )}
          <Link to={`/node/${carrier.node_id}`} className="mt-1 text-sm font-semibold text-text underline underline-offset-4">
            Open the carrier
          </Link>
        </div>
      )}
    </li>
  );
}
