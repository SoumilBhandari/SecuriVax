import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { ErrorNote, Layout, PageTitle, SectionTitle, Spinner, Split } from "../components/Layout";
import { humidity } from "../lib/format";
import { useLive, type LiveStatus } from "../lib/useLive";
import { clock, LiveChart } from "../components/LiveChart";
import type { Band, LiveReading, LiveRecent } from "../types";

type Range = LiveRecent["band"];

// A reading's band isn't a verdict, so it gets no signal colour: it's said in
// words, and marked by a dot that fills in as it leaves the range.
const BAND: Record<Band, { dot: string; label: (r: Range) => string }> = {
  ok: { dot: "var(--ring-track)", label: (r) => `In range ${r.min_c}–${r.max_c} °C` },
  warm: { dot: "var(--text)", label: (r) => `Above ${r.max_c} °C` },
  cold: { dot: "var(--ink-500)", label: (r) => `Below ${r.min_c} °C` },
  freeze: { dot: "var(--text)", label: () => "Freezing" },
};

const STATUS: Record<LiveStatus, { text: string; dot: string; pulse?: boolean }> = {
  connecting: { text: "Connecting", dot: "var(--ink-300)" },
  live: { text: "Live", dot: "var(--glacier-500)", pulse: true },
  reconnecting: { text: "Reconnecting", dot: "var(--ink-300)" },
  offline: { text: "Offline", dot: "var(--text)" },
  snapshot: { text: "Saved copy", dot: "var(--ink-300)" },
};

const WINDOW_S = 10 * 60; // what counts as "active", and the chart's usual span
const MIN_POINTS = 12; // a slower node charts its last CHART_POINTS readings instead
const CHART_POINTS = 30;
const FEED_ROWS = 80;

/** Every reading as it reaches the server, newest first. */
export default function LivePage() {
  const { readings, band, status, error, firstNewId } = useLive();
  const now = useNow();
  const [focus, setFocus] = useState<string | null>(null);

  const byNode = useMemo(() => {
    const m = new Map<string, LiveReading[]>();
    for (const r of readings) m.set(r.node_id, [...(m.get(r.node_id) ?? []), r]);
    return m;
  }, [readings]);

  // The hero follows the busiest signal (a sensor on the bench beats a lane
  // that reports every 10 minutes), unless a node is picked.
  const hero = useMemo(() => {
    if (focus && byNode.has(focus)) return focus;
    let best: string | null = null;
    let bestScore = -1;
    for (const [id, rs] of byNode) {
      const last = rs[rs.length - 1];
      const score = rs.filter((r) => r.received_at > last.received_at - WINDOW_S).length * 1e10 + last.received_at;
      if (score > bestScore) [best, bestScore] = [id, score];
    }
    return best;
  }, [byNode, focus]);

  const nodes = useMemo(
    () => [...byNode.values()].map((rs) => rs[rs.length - 1]).sort((a, b) => b.received_at - a.received_at || a.node_id.localeCompare(b.node_id)),
    [byNode],
  );
  const feed = useMemo(() => {
    const rows = focus ? (byNode.get(focus) ?? []) : readings;
    return rows.slice(-FEED_ROWS).reverse();
  }, [readings, byNode, focus]);

  return (
    <Layout>
      <div className="relative">
        <PageTitle top eyebrow="Live" title="Live signal" sub="Every reading as it reaches the server." />
        <div className="absolute right-0 top-0">
          <StatusPill status={status} />
        </div>
      </div>

      {error && <ErrorNote error={error} />}
      {!band && !error && <Spinner label="Tuning in" />}
      {band && readings.length === 0 && <Empty />}

      <Split
        wide="left"
        left={
          <>
            {band && hero && <Hero readings={byNode.get(hero)!} band={band} now={now} live={status === "live"} />}

            {nodes.length > 1 && (
              <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
                <NodeChip active={!focus} onClick={() => setFocus(null)} label="All" />
                {nodes.map((r) => (
                  <NodeChip key={r.node_id} active={focus === r.node_id} onClick={() => setFocus(focus === r.node_id ? null : r.node_id)} label={r.node_id} value={`${r.temp_c.toFixed(1)}°`} />
                ))}
              </div>
            )}
          </>
        }
        right={
          <>
            {feed.length > 0 && (
              <>
                <SectionTitle aside={focus ?? `${nodes.length} ${nodes.length === 1 ? "node" : "nodes"}`}>Feed</SectionTitle>
                <ol className="panel m-0 list-none p-0">
                  {feed.map((r) => (
                    <Row key={r.id} r={r} now={now} fresh={firstNewId != null && r.id >= firstNewId} />
                  ))}
                </ol>
                <p className="ui-caption m-0 mt-3">
                  From nodes over WiFi, the USB bridge and the simulated lanes. Verdicts read each box's full history, not
                  this feed.
                </p>
              </>
            )}
          </>
        }
      />
    </Layout>
  );
}

function Hero({ readings, band, now, live }: { readings: LiveReading[]; band: Range; now: number; live: boolean }) {
  const last = readings[readings.length - 1];
  const b = BAND[last.band];
  const lately = readings.filter((r) => r.ts > last.ts - WINDOW_S);
  const recent = lately.length >= MIN_POINTS ? lately : readings.slice(-CHART_POINTS);
  const gap = typicalGap(recent);
  const fresh = live && now / 1000 - last.received_at < Math.max(3 * (gap ?? 0), 30);
  return (
    <section className="card-soft p-4">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/node/${last.node_id}`} className="min-w-0 truncate font-display font-semibold tracking-[-0.01em] text-text no-underline">
          {last.label}
        </Link>
        <span className="pill shrink-0">{b.label(band)}</span>
      </div>
      <div className="mt-3 flex items-end gap-4">
        <p className="m-0 font-display text-[56px] font-semibold leading-none tabular-nums tracking-[-0.03em]">
          {last.temp_c.toFixed(1)}
          <span className="font-sans text-2xl font-normal tracking-normal text-neutral-500"> °C</span>
        </p>
        {last.rh != null && (
          <p className="m-0 pb-1.5 text-lg font-bold tabular-nums">
            {humidity(last.rh)} <span className="text-sm font-normal text-neutral-500">RH</span>
          </p>
        )}
      </div>
      <p className="ui-caption m-0 mt-2 flex flex-wrap items-center gap-x-2">
        <span className="h-2 w-2 rounded-full" style={{ background: fresh ? "var(--glacier-500)" : "var(--ink-300)", animation: fresh ? "vt-pulse 1.6s infinite" : undefined }} />
        {since(now, last.received_at)}
        {gap != null && ` · every ${gap < 90 ? `${Math.round(gap)} s` : `${Math.round(gap / 60)} min`}`}
        {last.sensor && ` · ${last.sensor} ±${last.sensor_accuracy_c} °C`}
      </p>
      <LiveChart points={recent} band={band} />
    </section>
  );
}

function Row({ r, now, fresh }: { r: LiveReading; now: number; fresh: boolean }) {
  const b = BAND[r.band];
  return (
    <li className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-0" style={fresh ? { animation: "vt-arrive 2.4s ease-out" } : undefined}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: b.dot }} title={r.band} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[15px] font-bold">{r.node_id}</p>
        <p className="ui-caption m-0 truncate">{clock(r.ts)}</p>
      </div>
      <div className="text-right">
        <p className="m-0 font-bold tabular-nums">{r.temp_c.toFixed(1)} °C</p>
        <p className="ui-caption m-0 tabular-nums">
          {r.rh != null ? `${humidity(r.rh)} · ` : ""}
          {since(now, r.received_at)}
        </p>
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: LiveStatus }) {
  const s = STATUS[status];
  return (
    <span className="pill shrink-0 gap-2" role="status">
      <span className="h-2 w-2 rounded-full" style={{ background: s.dot, animation: s.pulse ? "vt-pulse 1.6s infinite" : undefined }} />
      {s.text}
    </span>
  );
}

function NodeChip({ active, onClick, label, value }: { active: boolean; onClick: () => void; label: string; value?: string }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="chip">
      {label}
      {value && <span className="font-normal tabular-nums opacity-60">{value}</span>}
    </button>
  );
}

function Empty() {
  return (
    <section className="panel p-4">
      <p className="m-0">Nothing has come in yet. Readings appear here the moment a node uploads.</p>
      <p className="ui-caption m-0 mt-3">A node on USB with no WiFi can send through the bridge:</p>
      <code className="mt-2 block overflow-x-auto rounded-lg bg-neutral-900 px-3 py-2 text-xs">
        cd backend && .venv/bin/python -m scripts.serial_bridge
      </code>
    </section>
  );
}

/** Re-render every second so "3 s ago" stays true. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function since(nowMs: number, ts: number): string {
  const s = Math.max(0, Math.round(nowMs / 1000 - ts));
  if (s < 3) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}


/** The usual time between readings: the median gap. */
function typicalGap(rs: LiveReading[]): number | null {
  if (rs.length < 3) return null;
  const gaps = rs.slice(1).map((r, i) => r.ts - rs[i].ts).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || null;
}
