import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { BoxCard } from "../components/BoxCard";
import { Dispatch } from "../components/Dispatch";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ForecastCard } from "../components/Forecast";
import { TapIcon } from "../components/Icons";
import { BackHeader, Detail, Details, ErrorNote, Layout, SectionTitle, Spinner, Toast } from "../components/Layout";
import { api } from "../lib/api";
import { ago, demoRate } from "../lib/format";
import { clearArm, getArm, setArm, takeTap } from "../lib/tap";
import type { BoxSummary, NodeDetail } from "../types";

/** A carrier or cold room, as the driver or store keeper sees it. */
export default function NodePage() {
  const { id = "" } = useParams();
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const tapHandled = useRef(false);

  const refresh = useCallback(() => {
    api
      .node(id)
      .then((n) => {
        setNode(n);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    api.boxes().then((all) => setBoxes(all.filter((b) => b.current_node_id === id))).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (tapHandled.current || !takeTap()) return;
    tapHandled.current = true;
    const arm = getArm();
    if (arm?.kind === "box") {
      clearArm();
      api
        .load(arm.id, id)
        .then((res) => {
          setToast(res.status === "already_loaded" ? `${arm.id} is already here` : `Loaded ${arm.id} into ${id}`);
          refresh();
        })
        .catch((e: Error) => setToast(`Couldn't load: ${e.message}`));
    } else {
      setArm("node", id);
    }
  }, [id, refresh]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => !document.hidden && refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const hideToast = useCallback(() => setToast(null), []);

  if (!node) {
    return (
      <Layout>
        <BackHeader eyebrow={id} />
        {error ? <ErrorNote error={error} onRetry={refresh} /> : <Spinner />}
      </Layout>
    );
  }

  const latest = node.latest;
  const forecastable = node.kind !== "rdt_box" && !node.backup_for;
  return (
    <Layout>
      <BackHeader eyebrow={`${node.kind.replace("_", " ")} · ${node.facility}`} />
      <h1 className="m-0 mb-1.5 text-2xl leading-[1.15] [text-wrap:pretty]">{node.label}</h1>
      <p className="m-0 mb-[18px] flex flex-wrap items-center gap-2 text-[15px] text-neutral-300">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.online ? "var(--color-good)" : "#595d6c" }} />
        {node.online ? "Online" : "Offline"} · seen {ago(node.last_seen_at)}
        {node.battery_v != null && (
          <>
            <span className="opacity-60">·</span>
            <span style={node.low_battery ? { color: "var(--color-bad)" } : undefined}>
              {node.battery_v.toFixed(2)} V{node.low_battery && ", swap soon"}
            </span>
          </>
        )}
      </p>
      {node.backup_for && (
        <p className="m-0 mb-3 text-sm text-neutral-300">
          Backup for{" "}
          <Link to={`/node/${node.backup_for}`} className="text-accent-400 underline underline-offset-2">
            {node.backup_for}
          </Link>
          : its readings fill in whenever {node.backup_for} goes quiet.
        </p>
      )}
      {node.time_scale !== 1 && (
        <p className="m-0 mb-3 inline-block rounded-full bg-accent-900 px-3 py-1 text-xs text-accent-300">Demo node: {demoRate(node.time_scale)}</p>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <BigNumber label="Inside" value={latest ? latest.temp_c.toFixed(1) : "–"} unit=" °C" />
        <BigNumber label="Humidity" value={latest?.rh != null ? `${Math.round(latest.rh)}%` : "–"} />
      </div>

      {forecastable && (
        <div className="mt-3.5">
          <ErrorBoundary label="The forecast">
            <ForecastCard nodeId={node.id} />
          </ErrorBoundary>
        </div>
      )}

      {forecastable && node.box_ids.length > 0 && (
        <>
          <SectionTitle>Recommendation</SectionTitle>
          <ErrorBoundary label="The dispatch agent">
            <Dispatch nodeId={node.id} />
          </ErrorBoundary>
        </>
      )}

      <SectionTitle>Boxes inside · {boxes.length}</SectionTitle>
      <div className="flex flex-col gap-2.5">
        {boxes.map((b) => (
          <BoxCard key={b.id} box={b} compact />
        ))}
        {boxes.length === 0 && <p className="m-0 text-[15px] text-neutral-300">Empty.</p>}
        <button onClick={() => setArm("node", id)} className="btn-quiet w-full">
          <TapIcon size={20} />
          Load a box: tap its tag next
        </button>
      </div>

      <div className="mt-[26px]">
        <Details>
          <Detail first title="Recent readings">
            <Sparkline values={node.recent.map((r) => r.temp_c)} />
          </Detail>
          <Detail title={`Uploads · ${node.uploads.length}`}>
            <Uploads node={node} />
          </Detail>
        </Details>
      </div>
      <Toast message={toast} onDone={hideToast} />
    </Layout>
  );
}

function BigNumber({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="card-soft px-[18px] py-4">
      <p className="m-0 text-[13px] uppercase tracking-[0.08em] text-neutral-400">{label}</p>
      <p className="m-0 mt-1.5 text-[38px] font-semibold leading-none tracking-[-0.035em] tabular-nums">
        {value}
        {unit && value !== "–" && <span className="text-[17px] font-medium tracking-normal text-neutral-400">{unit}</span>}
      </p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="m-0 text-sm text-neutral-400">Waiting for readings.</p>;
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 10);
  const pts = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 300).toFixed(1)},${(56 - ((v - lo) / (hi - lo)) * 52).toFixed(1)}`).join("");
  return (
    <svg viewBox="0 0 300 60" className="block h-16 w-full" role="img" aria-label={`Recent temperatures, ${values[values.length - 1].toFixed(1)} °C now`}>
      <path d={pts} fill="none" stroke="#e9e9ed" strokeWidth="1.75" strokeLinejoin="round" />
      <text x="0" y="9" fontSize="9" fill="#9397ab">{hi.toFixed(0)}°</text>
      <text x="0" y="58" fontSize="9" fill="#9397ab">{lo.toFixed(0)}°</text>
    </svg>
  );
}

function Uploads({ node }: { node: NodeDetail }) {
  if (node.uploads.length === 0) return <p className="m-0 text-sm text-neutral-400">Nothing received yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px] tabular-nums">
        <thead className="text-xs uppercase tracking-[0.06em] text-neutral-500">
          <tr>
            <th className="py-1.5 font-medium">When</th>
            <th className="py-1.5 text-right font-medium">Sent</th>
            <th className="py-1.5 text-right font-medium">New</th>
            <th className="py-1.5 text-right font-medium">Dup</th>
            <th className="py-1.5 text-right font-medium">Bad</th>
          </tr>
        </thead>
        <tbody>
          {node.uploads.map((u) => (
            <tr key={u.id} className="border-t border-line">
              <td className="py-1.5">{ago(u.received_at)}</td>
              <td className="py-1.5 text-right">{u.count}</td>
              <td className="py-1.5 text-right">{u.accepted}</td>
              <td className="py-1.5 text-right">{u.duplicates}</td>
              <td className="py-1.5 text-right" style={u.rejected ? { color: "var(--color-bad)" } : undefined}>
                {u.rejected}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
