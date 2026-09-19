import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

import { Custody } from "../components/Custody";
import { SparkIcon } from "../components/Icons";
import { Card, ErrorNote, Layout, Spinner, Toast } from "../components/Layout";
import { RouteMap } from "../components/RouteMap";
import { TempChart } from "../components/TempChart";
import { BudgetCard, Reasons, VerdictCard } from "../components/Verdict";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { clearArm, getArm, setArm, takeTap } from "../lib/tap";
import type { Explanation, NodeSummary, Report } from "../types";

const LIVE_REFRESH_MS = 5000;

export default function BoxPage() {
  const { id = "" } = useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const tapHandled = useRef(false);

  const refresh = useCallback(
    () =>
      api
        .report(id)
        .then((r) => {
          setReport(r);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  // Arriving from an NFC tag: finish a pending link, or start one.
  useEffect(() => {
    if (tapHandled.current || !takeTap()) return;
    tapHandled.current = true;
    const arm = getArm();
    if (arm?.kind === "node") {
      clearArm();
      api
        .load(id, arm.id)
        .then((res) => {
          setToast(res.status === "already_loaded" ? `Already in ${arm.id}` : `Loaded into ${arm.id}`);
          refresh();
        })
        .catch((e: Error) => setToast(e.message));
    } else {
      setArm("box", id);
    }
  }, [id, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Follow the node live while the box is inside it.
  const liveNode = report?.current_node_id;
  useEffect(() => {
    if (!liveNode) return;
    const timer = setInterval(refresh, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [liveNode, refresh]);

  const hideToast = useCallback(() => setToast(null), []);

  if (error && !report) {
    return (
      <Layout back>
        <ErrorNote error={error} />
      </Layout>
    );
  }
  if (!report) {
    return (
      <Layout back>
        <Spinner label="Checking this box" />
      </Layout>
    );
  }

  return (
    <Layout back>
      <div className="mb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {report.product.kind === "vaccine" ? "Vaccine" : "Rapid test"} · lot {report.box.lot} · {report.box.quantity} units
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{report.box.id}</h1>
        <p className="text-sm text-slate-600">{report.product.name}</p>
      </div>

      <VerdictCard report={report} />
      <BudgetCard report={report} />
      <Card title="Why">
        <Reasons reasons={report.reasons} />
      </Card>
      <WorkerReport boxId={id} verdict={report.verdict} onPlaces={(places) => setReport((r) => (r ? { ...r, places: { ...r.places, ...places } } : r))} />
      <Card title="Temperature" aside={report.data_through ? `updated ${ago(report.data_through)}` : undefined}>
        <TempChart segments={report.segments} product={report.product} />
      </Card>
      <Card title="Route">
        <RouteMap segments={report.segments} places={report.places} />
      </Card>
      <Card title="Chain of custody">
        <Custody segments={report.segments} places={report.places} />
      </Card>
      <MoveBox report={report} onMoved={(msg) => { setToast(msg); refresh(); }} />
      <Toast message={toast} onDone={hideToast} />
    </Layout>
  );
}

/** Grok's plain-language write-up, regenerated whenever the verdict changes. */
function WorkerReport({
  boxId,
  verdict,
  onPlaces,
}: {
  boxId: string;
  verdict: Report["verdict"];
  onPlaces: (places: Record<string, string>) => void;
}) {
  const [data, setData] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const onPlacesRef = useRef(onPlaces);
  onPlacesRef.current = onPlaces;

  const run = useCallback(() => {
    setLoading(true);
    api
      .explain(boxId)
      .then((d) => {
        setData(d);
        onPlacesRef.current(d.places);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [boxId]);

  useEffect(run, [run, verdict]);

  const source =
    data?.source === "grok" ? "Written by Grok" : data ? "Template (add XAI_API_KEY for Grok)" : "";
  const places =
    data?.places_source === "gemini" ? "Places named by Gemini with Google Maps" : data ? "Places shown as coordinates" : "";

  return (
    <Card
      title="Report"
      aside={
        <button onClick={run} disabled={loading} className="text-slate-500 underline-offset-2 hover:underline disabled:opacity-50">
          {loading ? "Writing…" : "Refresh"}
        </button>
      }
    >
      {data ? (
        <div className={loading ? "opacity-60 transition-opacity" : ""}>
          {data.text.split(/\n\s*\n/).map((para, i) => (
            <p key={i} className="mb-2 text-[15px] leading-relaxed text-slate-800 last:mb-0">
              {para}
            </p>
          ))}
          <p className="mt-3 flex items-center gap-1 text-[11px] text-slate-400">
            <SparkIcon size={12} /> {source} · {places} · verdict set by the rule engine
          </p>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
        </div>
      ) : (
        <p className="text-sm text-slate-500">Report unavailable right now.</p>
      )}
    </Card>
  );
}

/** Manual fallback for the two-tap flow: pick a carrier, or unload. */
function MoveBox({ report, onMoved }: { report: Report; onMoved: (message: string) => void }) {
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.nodes().then(setNodes).catch(() => setNodes([]));
  }, []);

  const act = (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    fn()
      .then(() => onMoved(message))
      .catch((e: Error) => onMoved(e.message))
      .finally(() => setBusy(false));
  };

  const others = nodes.filter((n) => n.id !== report.current_node_id);
  return (
    <Card title="Move this box" aside="or tap a carrier's tag, then this box">
      <div className="flex gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          aria-label="Carrier"
        >
          <option value="">Choose a carrier…</option>
          {others.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
        <button
          disabled={!target || busy}
          onClick={() => act(() => api.load(report.box.id, target), `Loaded into ${target}`)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Load
        </button>
      </div>
      {report.current_node_id && (
        <button
          disabled={busy}
          onClick={() => act(() => api.unload(report.box.id, "unloaded from app"), `Unloaded from ${report.current_node_id}`)}
          className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
        >
          Unload from {report.current_node_id}
        </button>
      )}
    </Card>
  );
}
