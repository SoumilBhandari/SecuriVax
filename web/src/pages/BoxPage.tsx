import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

import { Counterfactual } from "../components/Counterfactual";
import { Custody } from "../components/Custody";
import { Dispatch } from "../components/Dispatch";
import { Environment } from "../components/Environment";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ForecastCard } from "../components/Forecast";
import { HistoryScrubber } from "../components/HistoryScrubber";
import { SparkIcon } from "../components/Icons";
import { Card, Layout, Spinner, Toast } from "../components/Layout";
import { LoggerCompare } from "../components/LoggerCompare";
import { BudgetCard, Reasons, VerdictCard } from "../components/Verdict";
import { VvmCheck } from "../components/VvmCheck";
import { api } from "../lib/api";
import { time } from "../lib/format";
import { clearArm, getArm, setArm, takeTap } from "../lib/tap";
import { usePoll } from "../lib/usePoll";
import type { CarrierForecast, Explanation, NodeSummary, Report } from "../types";

const RouteMap = lazy(() => import("../components/RouteMap"));

function cached(id: string): { report: Report; at: number } | null {
  try {
    return JSON.parse(localStorage.getItem(`vialtality.report.${id}`) ?? "null");
  } catch {
    return null;
  }
}

export default function BoxPage() {
  const { id = "" } = useParams();
  const [live, setLive] = useState(false);
  const { data, error, updatedAt, refresh } = usePoll(() => api.report(id), live ? 15000 : 60000, [id]);
  const [toast, setToast] = useState<string | null>(null);
  const tapHandled = useRef(false);

  useEffect(() => {
    setLive(Boolean(data?.current_node_id));
    if (data) {
      try {
        localStorage.setItem(`vialtality.report.${id}`, JSON.stringify({ report: data, at: Date.now() }));
      } catch {
        /* storage full or private mode: no offline copy */
      }
    }
  }, [data, id]);

  // Arriving from an NFC tag: finish a pending link (then refresh), or start one.
  useEffect(() => {
    if (tapHandled.current || !takeTap()) return;
    tapHandled.current = true;
    const arm = getArm();
    if (arm?.kind === "node") {
      clearArm();
      api
        .load(id, arm.id)
        .then((res) => setToast(res.status === "already_loaded" ? `Already in ${arm.id}` : `Loaded into ${arm.id}`))
        .catch((e: Error) => setToast(`Couldn't load: ${e.message}`))
        .finally(refresh);
    } else {
      setArm("box", id);
    }
  }, [id, refresh]);

  const hideToast = useCallback(() => setToast(null), []);
  const offline = !data ? cached(id) : null;
  const report = data ?? offline?.report ?? null;
  const stale = error && report ? `Can't reach the server: result from ${time(Math.round((updatedAt ?? offline?.at ?? Date.now()) / 1000))}` : null;

  if (!report) {
    return (
      <Layout back>
        {error ? (
          <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-900">
            <p>{error}</p>
            <button onClick={refresh} className="mt-3 rounded-lg bg-ink px-4 text-white">
              Try again
            </button>
          </div>
        ) : (
          <Spinner label="Checking this box" />
        )}
      </Layout>
    );
  }

  const vaccine = report.product.kind === "vaccine";
  return (
    <Layout back>
      <div className="mb-3">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">
          {vaccine ? "Vaccine" : "Rapid test"} · lot {report.box.lot} · {report.box.quantity.toLocaleString()} doses
        </p>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {report.product.name} <span className="text-muted">· {report.box.id}</span>
        </h1>
        {report.box.origin && (
          <p className="text-sm text-muted">
            {report.box.origin} → {report.box.destination} · {report.current_node_id ? "in transit" : "delivered"}
          </p>
        )}
      </div>

      <VerdictCard report={report} stale={stale} />
      {vaccine && report.confidence.borderline && (
        <Card title="Settle it with the VVM label" aside="camera + Gemini">
          <VvmCheck boxId={report.box.id} latest={report.label_check} highlight onConfirmed={refresh} />
        </Card>
      )}
      <BudgetCard report={report} />
      <Card title="Why">
        <Reasons reasons={report.reasons} />
      </Card>
      <LoggerCompare report={report} />
      <Card title="Temperature and humidity history" aside="across every custody change">
        <ErrorBoundary label="The history chart">
          <HistoryScrubber segments={report.segments} product={report.product} budgetUsed={report.budget_used} />
        </ErrorBoundary>
      </Card>
      {report.current_node_id && <CarrierSection nodeId={report.current_node_id} boxId={report.box.id} />}
      <ErrorBoundary label="The report">
        <WorkerReport boxId={id} verdict={report.verdict} />
      </ErrorBoundary>
      <Card title="Same thermal history, different product" aside="stability is product-specific">
        <ErrorBoundary label="The comparison">
          <Counterfactual boxId={report.box.id} />
        </ErrorBoundary>
      </Card>

      <details className="mb-4 rounded-2xl border border-line bg-white p-4 [&_summary]:cursor-pointer">
        <summary className="flex min-h-11 items-center font-semibold">Route, custody, weather and more</summary>
        <div className="mt-3 space-y-5">
          {vaccine && !report.confidence.borderline && (
            <section id="vvm">
              <h3 className="mb-2 text-sm font-semibold">Second witness: the VVM label</h3>
              <VvmCheck boxId={report.box.id} latest={report.label_check} highlight={false} onConfirmed={refresh} />
            </section>
          )}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Route</h3>
            <ErrorBoundary label="The map">
              <Suspense fallback={<p className="text-sm text-muted">Loading the map…</p>}>
                <RouteMap segments={report.segments} places={report.places} />
              </Suspense>
            </ErrorBoundary>
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Chain of custody</h3>
            <Custody segments={report.segments} places={report.places} />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Weather vs carrier</h3>
            <Environment segments={report.segments} />
          </section>
          <MoveBox report={report} onMoved={(msg) => { setToast(msg); refresh(); }} />
        </div>
      </details>
      <Toast message={toast} onDone={hideToast} />
    </Layout>
  );
}

/** Forecast and dispatch, only for ice-pack carriers that can be forecast. */
function CarrierSection({ nodeId, boxId }: { nodeId: string; boxId: string }) {
  const { data } = usePoll<CarrierForecast>(() => api.forecast(nodeId), 60000, [nodeId]);
  if (!data?.available) return null;
  return (
    <>
      <Card title="Carrier forecast" aside={nodeId}>
        <ErrorBoundary label="The forecast">
          <ForecastCard nodeId={nodeId} boxId={boxId} initial={data} />
        </ErrorBoundary>
      </Card>
      <Card title="What should the carrier do?" aside="location agent">
        <ErrorBoundary label="The dispatch agent">
          <Dispatch nodeId={nodeId} />
        </ErrorBoundary>
      </Card>
    </>
  );
}

/** Grok's plain-language write-up, regenerated when the verdict changes. */
function WorkerReport({ boxId, verdict }: { boxId: string; verdict: Report["verdict"] }) {
  const [data, setData] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const run = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    api
      .explain(boxId)
      .then((d) => {
        if (mine === seq.current) {
          setData(d);
          setFailed(false);
        }
      })
      .catch(() => mine === seq.current && setFailed(true))
      .finally(() => mine === seq.current && setLoading(false));
  }, [boxId]);

  useEffect(() => {
    run();
    return () => {
      seq.current++;
    };
  }, [run, verdict]);

  const source = data?.source === "grok" ? "Written by Grok" : data ? "Template (add XAI_API_KEY for Grok)" : "";
  const places = data?.places_source === "gemini" ? "Places named by Gemini with Google Maps" : data ? "Places shown as coordinates" : "";
  return (
    <Card
      title="Report"
      aside={
        <button onClick={run} disabled={loading} className="min-h-11 px-2 text-muted underline-offset-2 hover:underline disabled:opacity-50">
          {loading ? "Writing…" : "Refresh"}
        </button>
      }
    >
      {data ? (
        <div className={loading ? "opacity-60" : ""}>
          {data.text.split(/\n\s*\n/).map((para, i) => (
            <p key={i} className="mb-2 text-[15px] leading-relaxed last:mb-0">{para}</p>
          ))}
          <p className="mt-3 flex items-center gap-1 text-xs text-muted">
            <SparkIcon size={12} /> {source} · {places} · verdict set by the rule engine
          </p>
          {failed && <p className="mt-1 text-xs text-bad">Couldn't refresh; showing the last report.</p>}
        </div>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
        </div>
      ) : (
        <p className="text-sm text-muted">Report unavailable right now.</p>
      )}
    </Card>
  );
}

/** Manual fallback for the two-tap flow: pick a carrier, or unload (with a confirmation). */
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
      .then(() => {
        setTarget("");
        onMoved(message);
      })
      .catch((e: Error) => onMoved(`Couldn't do that: ${e.message}`))
      .finally(() => setBusy(false));
  };

  const others = nodes.filter((n) => n.id !== report.current_node_id);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Move this box</h3>
      <div className="flex gap-2">
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3" aria-label="Carrier or cold room">
          <option value="">Choose a carrier or cold room…</option>
          {others.map((n) => (
            <option key={n.id} value={n.id}>{n.label}</option>
          ))}
        </select>
        <button disabled={!target || busy} onClick={() => act(() => api.load(report.box.id, target), `Loaded into ${target}`)}
          className="rounded-lg bg-ink px-4 font-semibold text-white disabled:opacity-40">
          Load
        </button>
      </div>
      {report.current_node_id && (
        <button
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Unload ${report.box.id} from ${report.current_node_id}? Its monitoring stops here.`)) {
              act(() => api.unload(report.box.id, "unloaded from app"), `Unloaded from ${report.current_node_id}`);
            }
          }}
          className="mt-2 w-full rounded-lg border border-line px-4 font-semibold disabled:opacity-40"
        >
          Unload from {report.current_node_id}
        </button>
      )}
    </section>
  );
}
