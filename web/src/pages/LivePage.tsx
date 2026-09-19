import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { ErrorNote, Layout, SectionTitle, Spinner } from "../components/Layout";
import { humidity } from "../lib/format";
import { useLive, type LiveStatus } from "../lib/useLive";
import type { Band, LiveReading, LiveRecent } from "../types";

type Range = LiveRecent["band"];

const BAND: Record<Band, { color: string; fg: string; tint: string; label: (r: Range) => string }> = {
  ok: { color: "var(--color-good)", fg: "var(--color-good-fg)", tint: "var(--color-good-tint)", label: (r) => `In range ${r.min_c}–${r.max_c} °C` },
  warm: { color: "var(--color-hot)", fg: "var(--color-hot-fg)", tint: "var(--color-hot-tint)", label: (r) => `Above ${r.max_c} °C` },
  cold: { color: "var(--color-warn)", fg: "var(--color-warn-fg)", tint: "var(--color-warn-tint)", label: (r) => `Below ${r.min_c} °C` },
  freeze: { color: "var(--color-bad)", fg: "var(--color-bad-fg)", tint: "var(--color-bad-tint)", label: () => "Freezing" },
};

const STATUS: Record<LiveStatus, { text: string; color: string; pulse?: boolean }> = {
  connecting: { text: "Connecting", color: "var(--color-neutral-400)" },
  live: { text: "Live", color: "var(--color-good)", pulse: true },
  reconnecting: { text: "Reconnecting", color: "var(--color-warn)" },
  offline: { text: "Offline", color: "var(--color-bad)" },
  snapshot: { text: "Saved copy", color: "var(--color-neutral-400)" },
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
      <div className="mt-[26px] flex items-center justify-between gap-3">
        <h1 className="m-0 text-[34px] leading-[1.05]">Live signal</h1>
        <StatusPill status={status} />
      </div>
      <p className="m-0 mb-[18px] mt-1.5 text-sm text-neutral-400">Every reading as it reaches the server.</p>

      {error && <ErrorNote error={error} />}
      {!band && !error && <Spinner label="Tuning in" />}
      {band && readings.length === 0 && <Empty />}

      {band && hero && <Hero readings={byNode.get(hero)!} band={band} now={now} live={status === "live"} />}

      {nodes.length > 1 && (
        <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          <NodeChip active={!focus} onClick={() => setFocus(null)} label="All" />
          {nodes.map((r) => (
            <NodeChip key={r.node_id} active={focus === r.node_id} onClick={() => setFocus(focus === r.node_id ? null : r.node_id)} label={r.node_id} dot={BAND[r.band].color} value={`${r.temp_c.toFixed(1)}°`} />
          ))}
        </div>
      )}

      {feed.length > 0 && (
        <>
          <SectionTitle aside={focus ?? `${nodes.length} ${nodes.length === 1 ? "node" : "nodes"}`}>Feed</SectionTitle>
          <ol className="panel m-0 list-none p-0">
            {feed.map((r) => (
              <Row key={r.id} r={r} now={now} fresh={firstNewId != null && r.id >= firstNewId} />
            ))}
          </ol>
          <p className="m-0 mt-3 text-xs leading-[1.45] text-neutral-500">
            From nodes over WiFi, the USB bridge and the simulated lanes. Verdicts read each box's full history, not
            this feed.
          </p>
        </>
      )}
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
    <section className="card-soft px-5 pb-4 pt-[18px]">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/node/${last.node_id}`} className="min-w-0 truncate text-[15px] font-semibold text-text no-underline">
          {last.label}
        </Link>
        <span className="pill shrink-0 !px-2.5 !py-1 !text-xs" style={{ background: b.tint, color: b.fg }}>
          {b.label(band)}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-4">
        <p className="m-0 text-[56px] font-semibold leading-none tabular-nums tracking-[-0.04em]" style={{ color: last.band === "ok" ? "var(--color-text)" : b.color }}>
          {last.temp_c.toFixed(1)}
          <span className="text-[26px] font-medium tracking-normal text-neutral-400"> °C</span>
        </p>
        {last.rh != null && (
          <p className="m-0 pb-1.5 text-lg tabular-nums text-neutral-300">
            {humidity(last.rh)} <span className="text-sm text-neutral-500">RH</span>
          </p>
        )}
      </div>
      <p className="m-0 mt-1.5 flex items-center gap-2 text-[13px] text-neutral-400">
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: fresh ? "var(--color-good)" : "var(--color-neutral-500)", animation: fresh ? "vt-pulse 1.6s infinite" : undefined }} />
        {since(now, last.received_at)}
        {gap != null && ` · every ${gap < 90 ? `${Math.round(gap)} s` : `${Math.round(gap / 60)} min`}`}
      </p>
      <LiveChart points={recent} band={band} />
    </section>
  );
}

/** One node's recent readings against the storage range. */
function LiveChart({ points, band }: { points: LiveReading[]; band: Range }) {
  if (points.length < 2) return <p className="m-0 mt-3 text-sm text-neutral-500">The chart starts at the second reading.</p>;
  const W = 320, H = 118, L = 26, R = 8, T = 8, B = 16;
  const temps = points.map((p) => p.temp_c);
  // Zoomed to the signal so it visibly moves; the storage range joins the view
  // once readings come within a few degrees of it, otherwise a note says where it is.
  const NEAR = 4;
  let lo = Math.floor(Math.min(...temps) - 1);
  let hi = Math.ceil(Math.max(...temps) + 1);
  const rangeBelow = band.max_c < lo - NEAR;
  const rangeAbove = band.min_c > hi + NEAR;
  if (!rangeBelow && !rangeAbove) {
    lo = Math.min(lo, Math.floor(band.min_c - 1));
    hi = Math.max(hi, Math.ceil(band.max_c + 1));
  }
  const t0 = points[0].ts;
  const t1 = Math.max(points[points.length - 1].ts, t0 + 1);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (c: number) => T + (1 - (c - lo) / (hi - lo)) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.temp_c).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  const inView = !rangeBelow && !rangeAbove;
  // The chart's top and bottom, and the range edges when they're in view and clear of them.
  const ticks = inView
    ? [band.max_c, band.min_c, ...(hi - band.max_c >= 3 ? [hi] : []), ...(band.min_c - lo >= 3 ? [lo] : [])]
    : [hi, lo];
  const away = rangeBelow ? Math.min(...temps) - band.max_c : band.min_c - Math.max(...temps);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block w-full" role="img" aria-label={`Last ${points.length} readings, ${Math.min(...temps).toFixed(1)} to ${Math.max(...temps).toFixed(1)} °C`}>
        {inView && <rect x={L} y={y(band.max_c)} width={W - L - R} height={y(band.min_c) - y(band.max_c)} fill="var(--color-good-tint)" opacity={0.55} />}
        {inView && band.freeze_c > lo && (
          <line x1={L} x2={W - R} y1={y(band.freeze_c)} y2={y(band.freeze_c)} stroke="var(--color-bad)" strokeDasharray="3 3" opacity={0.7} />
        )}
        {ticks.map((c) => (
          <text key={c} x={L - 5} y={y(c) + 3} textAnchor="end" fontSize="9" fill="var(--color-neutral-500)">
            {c}°
          </text>
        ))}
        <path d={line} fill="none" stroke="var(--color-accent-300)" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={x(last.ts)} cy={y(last.temp_c)} r="3.5" fill="var(--color-accent-200)" />
        <text x={L} y={H - 3} fontSize="9" fill="var(--color-neutral-500)">
          {clock(t0)}
        </text>
        <text x={W - R} y={H - 3} textAnchor="end" fontSize="9" fill="var(--color-neutral-500)">
          {clock(last.ts)}
        </text>
      </svg>
      {!inView && (
        <p className="m-0 mt-1 text-xs text-neutral-500">
          The {band.min_c}–{band.max_c} °C range is {Math.round(away)} °C {rangeBelow ? "below" : "above"} this; it joins the chart
          as readings get close.
        </p>
      )}
    </>
  );
}

function Row({ r, now, fresh }: { r: LiveReading; now: number; fresh: boolean }) {
  const b = BAND[r.band];
  return (
    <li className="flex items-center gap-3 border-t border-line px-[18px] py-2.5 first:border-0" style={fresh ? { animation: "vt-arrive 2.4s ease-out" } : undefined}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: b.color }} title={r.band} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-medium">{r.node_id}</p>
        <p className="m-0 truncate text-xs text-neutral-500">{clock(r.ts)}</p>
      </div>
      <div className="text-right">
        <p className="m-0 text-[15px] font-semibold tabular-nums" style={{ color: r.band === "ok" ? undefined : b.color }}>
          {r.temp_c.toFixed(1)} °C
        </p>
        <p className="m-0 text-xs tabular-nums text-neutral-500">
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
    <span className="pill shrink-0 gap-2 !text-xs" style={{ background: "var(--color-neutral-900)", color: s.color }} role="status">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: s.color, animation: s.pulse ? "vt-pulse 1.6s infinite" : undefined }} />
      {s.text}
    </span>
  );
}

function NodeChip({ active, onClick, label, dot, value }: { active: boolean; onClick: () => void; label: string; dot?: string; value?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex !min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] border px-3 text-[13px] font-medium"
      style={{
        borderColor: active ? "var(--color-accent-600)" : "var(--color-neutral-700)",
        background: active ? "var(--color-accent-900)" : "transparent",
        color: active ? "var(--color-accent-200)" : "var(--color-neutral-300)",
      }}
    >
      {dot && <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />}
      {label}
      {value && <span className="font-normal tabular-nums opacity-60">{value}</span>}
    </button>
  );
}

function Empty() {
  return (
    <section className="panel p-5 text-[15px] leading-[1.5] text-neutral-300">
      <p className="m-0">Nothing has come in yet. Readings appear here the moment a node uploads.</p>
      <p className="m-0 mt-3 text-sm text-neutral-400">A node on USB with no WiFi can send through the bridge:</p>
      <code className="mt-2 block overflow-x-auto rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-200">
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

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The usual time between readings: the median gap. */
function typicalGap(rs: LiveReading[]): number | null {
  if (rs.length < 3) return null;
  const gaps = rs.slice(1).map((r, i) => r.ts - rs[i].ts).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || null;
}
