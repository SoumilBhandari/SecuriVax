import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { BatteryIcon, DropIcon, OfflineIcon, TapIcon, ThermoIcon } from "../components/Icons";
import { Card, ErrorNote, Layout, Spinner, Toast } from "../components/Layout";
import { VerdictChip } from "../components/Verdict";
import { api } from "../lib/api";
import { ago, demoRate, humidity, temp } from "../lib/format";
import { clearArm, getArm, setArm, takeTap } from "../lib/tap";
import type { BoxSummary, NodeDetail } from "../types";

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
        .catch((e: Error) => setToast(e.message));
    } else {
      setArm("node", id);
    }
  }, [id, refresh]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const hideToast = useCallback(() => setToast(null), []);

  if (error && !node) {
    return (
      <Layout back>
        <ErrorNote error={error} />
      </Layout>
    );
  }
  if (!node) {
    return (
      <Layout back>
        <Spinner />
      </Layout>
    );
  }

  return (
    <Layout back>
      <div className="mb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {node.kind.replace("_", " ")} · {node.facility}
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{node.label}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${node.online ? "bg-emerald-500" : "bg-slate-300"}`} />
            {node.online ? "Online" : "Offline"} · seen {ago(node.last_seen_at)}
          </span>
          {node.battery_v != null && (
            <span className={`flex items-center gap-1 ${node.low_battery ? "text-red-600" : ""}`}>
              <BatteryIcon size={16} /> {node.battery_v.toFixed(2)} V{node.low_battery && " · swap soon"}
            </span>
          )}
        </p>
        {node.time_scale !== 1 && (
          <p className="mt-2 inline-block rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">
            Demo node: {demoRate(node.time_scale)}
          </p>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <ThermoIcon size={14} /> Temperature
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{temp(node.latest?.temp_c)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <DropIcon size={14} /> Humidity
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{humidity(node.latest?.rh)}</p>
        </div>
      </div>

      <Card title="Last readings" aside={`${node.recent.length} shown`}>
        <Sparkline values={node.recent.map((r) => r.temp_c)} />
      </Card>

      <Card title="Boxes inside" aside={`${boxes.length}`}>
        {boxes.length === 0 ? (
          <p className="text-sm text-slate-500">Empty.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {boxes.map((b) => (
              <li key={b.id}>
                <Link to={`/box/${b.id}`} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-medium text-slate-900">{b.id}</span>
                    <span className="ml-2 text-sm text-slate-500">{b.product_name}</span>
                  </span>
                  <VerdictChip verdict={b.verdict} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => setArm("node", id)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
        >
          <TapIcon size={16} /> Load a box here: tap its tag next
        </button>
      </Card>

      <Card title="Uploads" aside="every batch the node sent">
        {node.uploads.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <OfflineIcon size={16} /> Nothing received yet.
          </p>
        ) : (
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 font-normal">When</th>
                <th className="py-1 text-right font-normal">Sent</th>
                <th className="py-1 text-right font-normal">New</th>
                <th className="py-1 text-right font-normal">Dup</th>
                <th className="py-1 text-right font-normal">Bad</th>
              </tr>
            </thead>
            <tbody className="text-slate-800">
              {node.uploads.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="py-1">{ago(u.received_at)}</td>
                  <td className="py-1 text-right">{u.count}</td>
                  <td className="py-1 text-right">{u.accepted}</td>
                  <td className="py-1 text-right">{u.duplicates}</td>
                  <td className={`py-1 text-right ${u.rejected ? "text-red-600" : ""}`}>{u.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Toast message={toast} onDone={hideToast} />
    </Layout>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="text-sm text-slate-500">Waiting for readings.</p>;
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 10);
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * 300).toFixed(1)},${(60 - ((v - lo) / (hi - lo)) * 56 - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 300 60" className="h-16 w-full" role="img" aria-label="Recent temperatures">
      <polyline points={pts} fill="none" className="stroke-slate-800" strokeWidth={1.5} strokeLinejoin="round" />
      <text x="0" y="10" className="fill-slate-400 text-[9px]">
        {hi.toFixed(0)}°
      </text>
      <text x="0" y="58" className="fill-slate-400 text-[9px]">
        {lo.toFixed(0)}°
      </text>
    </svg>
  );
}
