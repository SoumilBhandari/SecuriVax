import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useParams } from "react-router";

import { Counterfactual } from "../components/Counterfactual";
import { Custody } from "../components/Custody";
import { Dispatch } from "../components/Dispatch";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ForecastCard } from "../components/Forecast";
import { HistoryScrubber } from "../components/HistoryScrubber";
import { SparkIcon } from "../components/Icons";
import { StageReset } from "../components/StageReset";
import { Card, Layout, Spinner, Toast } from "../components/Layout";
import { LoggerCompare } from "../components/LoggerCompare";
import { KeyStats, Reasons, VerdictCard } from "../components/Verdict";
import { VvmCheck } from "../components/VvmCheck";
import { api } from "../lib/api";
import { time } from "../lib/format";
import { clearArm, getArm, setArm, takeTap } from "../lib/tap";
import { usePoll } from "../lib/usePoll";
import { SNAPSHOT } from "../lib/snapshot";
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

  const nodeId = data?.current_node_id ?? null;
  const forecast = usePoll<CarrierForecast | null>(
    () => (nodeId ? api.forecast(nodeId) : Promise.resolve(null)),
    nodeId ? 60000 : null,
    [nodeId],
  );
  const kind = data?.product.kind;
  const tabs = useTabs([
    "why",
    "history",
    ...(nodeId && forecast.data?.available ? (["carrier"] as const) : []),
    ...(kind === "vaccine" ? (["label"] as const) : []),
    "report",
  ]);
  const hideToast = useCallback(() => setToast(null), []);
  const offline = !data ? cached(id) : null;
  const report = data ?? offline?.report ?? null;
  const savedAt = time(Math.round((updatedAt ?? offline?.at ?? Date.now()) / 1000));
  const stale = error && report
    ? `Can't reach the server: result from ${savedAt}`
    : !data && offline
      ? `Updating… showing the result from ${savedAt}`
      : null;

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
  const route = report.box.origin ? `${report.box.origin} → ${report.box.destination}` : null;
  return (
    <Layout back>
      <div className="mb-3">
        <h1 className="font-display text-xl font-bold leading-tight tracking-tight">{report.product.name}</h1>
        <p className="text-xs text-muted">
          {report.box.id} · {report.box.quantity.toLocaleString()} {vaccine ? "doses" : "tests"}
          {route && ` · ${route}`} · {report.current_node_id ? "in transit" : "delivered"}
        </p>
      </div>

      <VerdictCard report={report} stale={stale} onCheckLabel={() => tabs.open("label")} />
      <BoxTabs report={report} tabs={tabs} forecast={forecast.data} onChanged={(msg) => { setToast(msg); refresh(); }} />
      <Toast message={toast} onDone={hideToast} />
    </Layout>
  );
}

type TabId = "why" | "history" | "carrier" | "label" | "report";
const TAB_LABEL: Record<TabId, string> = { why: "Why", history: "History", carrier: "Carrier", label: "Label", report: "Report" };

/** Which tab is open, kept in the URL hash so back and reload keep it. */
function useTabs(available: TabId[]) {
  const [want, setWant] = useState<TabId>(() => (SNAPSHOT ? "why" : (window.location.hash.slice(1) as TabId) || "why"));
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([want]));
  const bar = useRef<HTMLDivElement>(null);
  const current = available.includes(want) ? want : "why";

  const open = useCallback((id: TabId) => {
    setWant(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
    if (!SNAPSHOT) history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
    const top = bar.current?.getBoundingClientRect().top ?? 0;
    if (top <= 1 || top > window.innerHeight * 0.6) bar.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  return { current, available, visited, open, bar };
}
type Tabs = ReturnType<typeof useTabs>;

function BoxTabs({
  report,
  tabs,
  forecast,
  onChanged,
}: {
  report: Report;
  tabs: Tabs;
  forecast: CarrierForecast | null;
  onChanged: (message: string) => void;
}) {
  const panel = (id: TabId, body: ReactNode) =>
    tabs.visited.has(id) || tabs.current === id ? (
      <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={tabs.current !== id}>
        {body}
      </div>
    ) : null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.available.indexOf(tabs.current);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs.available[(i + step + tabs.available.length) % tabs.available.length];
    tabs.open(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <>
      <div ref={tabs.bar} className="sticky top-0 z-[1100] -mx-4 mb-3 scroll-mt-0 bg-ground/95 px-4 py-2 backdrop-blur">
        <div role="tablist" aria-label="Box details" onKeyDown={onKey} className="flex gap-1 rounded-full border border-line bg-white p-1">
          {tabs.available.map((id) => (
            <button
              key={id}
              id={`tab-${id}`}
              role="tab"
              aria-selected={tabs.current === id}
              aria-controls={`panel-${id}`}
              tabIndex={tabs.current === id ? 0 : -1}
              onClick={() => tabs.open(id)}
              className={`min-h-10 flex-1 rounded-full px-2 text-sm font-semibold transition-colors ${
                tabs.current === id ? "bg-ink text-white" : "text-muted hover:text-ink"
              }`}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </div>
      </div>

      {panel(
        "why",
        <>
          <Card title="Why this verdict">
            <Reasons reasons={report.reasons} />
          </Card>
          <Card title="Threshold logger vs Vialtality" aside="same record">
            <LoggerCompare report={report} />
          </Card>
          <Card title="The numbers">
            <KeyStats report={report} />
          </Card>
        </>,
      )}

      {panel(
        "history",
        <>
          <Card title="Temperature, humidity and budget" aside="drag to scrub">
            <ErrorBoundary label="The history chart">
              <HistoryScrubber segments={report.segments} product={report.product} budgetUsed={report.budget_used} />
            </ErrorBoundary>
          </Card>
          <Card title="Chain of custody" aside="tap a leg for weather">
            <Custody segments={report.segments} places={report.places} />
          </Card>
          <Card title="Route">
            <ErrorBoundary label="The map">
              <Suspense fallback={<p className="text-sm text-muted">Loading the map…</p>}>
                <RouteMap segments={report.segments} places={report.places} />
              </Suspense>
            </ErrorBoundary>
          </Card>
          <MoveBox report={report} onMoved={onChanged} />
          {report.box.id.startsWith("BOX-9") && (
            <Card title="Stage demo" aside="rehearsal">
              <StageReset onDone={onChanged} />
            </Card>
          )}
        </>,
      )}

      {report.current_node_id &&
        forecast?.available &&
        panel(
          "carrier",
          <>
            <Card title="Carrier forecast" aside={report.current_node_id}>
              <ErrorBoundary label="The forecast">
                <ForecastCard nodeId={report.current_node_id} boxId={report.box.id} initial={forecast} />
              </ErrorBoundary>
            </Card>
            <Card title="What should the carrier do?" aside="location agent">
              <ErrorBoundary label="The dispatch agent">
                <Dispatch nodeId={report.current_node_id} />
              </ErrorBoundary>
            </Card>
          </>,
        )}

      {report.product.kind === "vaccine" &&
        panel(
          "label",
          <Card title="Second witness: the VVM label" aside="camera + Gemini">
            <VvmCheck boxId={report.box.id} latest={report.label_check} highlight={report.confidence.borderline} onConfirmed={onChanged} />
          </Card>,
        )}

      {panel(
        "report",
        <>
          <ErrorBoundary label="The report">
            <WorkerReport boxId={report.box.id} verdict={report.verdict} />
          </ErrorBoundary>
          <Card title="Same history, different product" aside="stability is product-specific">
            <ErrorBoundary label="The comparison">
              <Counterfactual boxId={report.box.id} />
            </ErrorBoundary>
          </Card>
        </>,
      )}
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
    <Card title="Move this box" aside="if the tags aren't to hand">
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
    </Card>
  );
}
