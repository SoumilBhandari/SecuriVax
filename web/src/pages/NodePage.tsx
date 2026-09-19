import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { BoxCard } from "../components/BoxCard";
import { Dispatch } from "../components/Dispatch";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ForecastCard } from "../components/Forecast";
import { NfcIcon } from "../components/Icons";
import { BackHeader, Detail, Details, ErrorNote, Layout, PageTitle, SectionTitle, Spinner, Split, Toast } from "../components/Layout";
import { api } from "../lib/api";
import { canTapTags, useCanTapTags } from "../lib/device";
import { ago, demoRate } from "../lib/format";
import { clearArm, getArm, setArm, takeTap } from "../lib/tap";
import { useReadingNudge } from "../lib/useLive";
import type { BoxSummary, NodeDetail } from "../types";

/** A carrier or cold room, as the driver or store keeper sees it. */
export default function NodePage() {
  const { id = "" } = useParams();
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [allBoxes, setAllBoxes] = useState<BoxSummary[]>([]);
  const boxes = allBoxes.filter((b) => b.current_node_id === id);
  const canTap = useCanTapTags();
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
    api.boxes().then(setAllBoxes).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (tapHandled.current || !takeTap()) return;
    tapHandled.current = true;
    if (!canTapTags()) return; // a tag's URL opened on a computer: there's no second tap to pair it with
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
    const timer = setInterval(() => !document.hidden && refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  // Each new reading refreshes the page at once; the 30 s poll is the fallback.
  useReadingNudge(id, refresh);

  const hideToast = useCallback(() => setToast(null), []);

  if (!node) {
    return (
      <Layout>
        <BackHeader />
        <PageTitle eyebrow="Carrier" title={id} />
        {error && /^no node/i.test(error) ? (
          <div role="alert" className="panel p-4">
            <p className="ui-heading m-0">Carrier not found</p>
            <p className="m-0 mt-2 text-neutral-300">No carrier or cold room has the ID {id}. Check the sticker.</p>
            <Link to="/boxes" className="btn-secondary mt-4">
              See all boxes
            </Link>
          </div>
        ) : error ? (
          <ErrorNote error={error} onRetry={refresh} />
        ) : (
          <Spinner />
        )}
      </Layout>
    );
  }

  const latest = node.latest;
  const forecastable = node.kind !== "rdt_box" && !node.backup_for;
  return (
    <Layout>
      <BackHeader />
      <PageTitle
        eyebrow={node.kind === "cold_box" ? "Cold box" : node.kind === "rdt_box" ? "Test box" : "Carrier"}
        title={node.label}
        sub={
          <>
            {node.facility} · {node.online ? "Online" : "Offline"}, seen {ago(node.last_seen_at)}
            {node.battery_v != null && (
              <>
                {" · "}
                <span className={node.low_battery ? "font-bold text-text" : undefined}>
                  {node.battery_v.toFixed(2)} V{node.low_battery && ", swap soon"}
                </span>
              </>
            )}
          </>
        }
      />
      {node.backup_for && (
        <p className="ui-caption m-0 mb-3 -mt-3">
          Backup for <Link to={`/node/${node.backup_for}`}>{node.backup_for}</Link>: its readings fill in whenever {node.backup_for} goes quiet.
        </p>
      )}
      {node.time_scale !== 1 && <p className="ui-caption m-0 mb-4 -mt-3">Demo node: {demoRate(node.time_scale)}.</p>}

      <Split
        left={
          <>
            <div className="grid grid-cols-2 gap-3">
              <BigNumber label="Inside" value={latest ? latest.temp_c.toFixed(1) : "–"} unit=" °C" />
              <BigNumber label="Humidity" value={latest?.rh != null ? `${Math.round(latest.rh)}%` : "–"} />
            </div>

            {forecastable && (
              <div className="mt-3">
                <ErrorBoundary label="The forecast">
                  <ForecastCard nodeId={node.id} />
                </ErrorBoundary>
              </div>
            )}
          </>
        }
        right={
          <>
            {forecastable && node.box_ids.length > 0 && (
              <>
                <SectionTitle>What should I do?</SectionTitle>
                <ErrorBoundary label="The dispatch agent">
                  <Dispatch nodeId={node.id} />
                </ErrorBoundary>
              </>
            )}

            <SectionTitle>Boxes · {boxes.length}</SectionTitle>
            <div className="flex flex-col gap-3">
              {boxes.map((b) => (
                <BoxCard key={b.id} box={b} compact />
              ))}
              {boxes.length === 0 && <p className="m-0 text-neutral-500">Empty.</p>}
              {canTap ? (
                <button onClick={() => setArm("node", id)} className="btn-secondary w-full">
                  <NfcIcon size={20} />
                  Load a box: tap its tag
                </button>
              ) : (
                <LoadBox
                  nodeId={id}
                  boxes={allBoxes}
                  onDone={(message) => {
                    setToast(message);
                    refresh();
                  }}
                />
              )}
            </div>

            <div className="mt-6">
              <Details>
                <Detail first title="Recent readings">
                  <Sparkline values={node.recent.map((r) => r.temp_c)} />
                </Detail>
                <Detail title={`Uploads · ${node.uploads.length}`}>
                  <Uploads node={node} />
                </Detail>
              </Details>
            </div>
          </>
        }
      />
      <Toast message={toast} onDone={hideToast} />
    </Layout>
  );
}

/** A computer can't tap a box's sticker, so it picks the box from a list. */
function LoadBox({ nodeId, boxes, onDone }: { nodeId: string; boxes: BoxSummary[]; onDone: (message: string) => void }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const choices = boxes.filter((b) => b.current_node_id !== nodeId);
  const load = () => {
    setBusy(true);
    api
      .load(target, nodeId)
      .then((res) => {
        setTarget("");
        onDone(res.status === "already_loaded" ? `${target} is already here` : `Loaded ${target} into ${nodeId}`);
      })
      .catch((e: Error) => onDone(`Couldn't load: ${e.message}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex gap-2">
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="select-pill min-w-0 flex-1" aria-label="Box to load">
        <option value="">Load a box…</option>
        {choices.map((b) => (
          <option key={b.id} value={b.id}>
            {b.id} · {b.product_name}
            {b.current_node_id ? ` (now in ${b.current_node_id})` : ""}
          </option>
        ))}
      </select>
      <button disabled={!target || busy} onClick={load} className="btn-outline">
        {busy ? "Loading…" : "Load"}
      </button>
    </div>
  );
}

function BigNumber({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="card-soft p-4">
      <p className="eyebrow m-0">{label}</p>
      <p className="m-0 mt-2 font-display text-[34px] font-semibold leading-10 tracking-[-0.02em] tabular-nums">
        {value}
        {unit && value !== "–" && <span className="font-sans text-base font-normal tracking-normal text-neutral-500">{unit}</span>}
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
      <path d={pts} fill="none" stroke="var(--line)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <text x="0" y="9" fontSize="9" fill="var(--text-muted)">{hi.toFixed(0)}°</text>
      <text x="0" y="58" fontSize="9" fill="var(--text-muted)">{lo.toFixed(0)}°</text>
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
              <td className="py-1.5 text-right" style={u.rejected ? { fontWeight: 700 } : undefined}>
                {u.rejected}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
