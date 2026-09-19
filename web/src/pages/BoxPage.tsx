import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { Counterfactual } from "../components/Counterfactual";
import { Custody } from "../components/Custody";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { forecastLine } from "../components/Forecast";
import { ChevronRightIcon, ScanIcon, SparkIcon, XIcon } from "../components/Icons";
import { BackHeader, Detail, Details, ErrorNote, Layout, SectionTitle, Spinner, Toast } from "../components/Layout";
import { LoggerCompare } from "../components/LoggerCompare";
import { StageReset } from "../components/StageReset";
import { TripChart } from "../components/TripChart";
import { Numbers, Reasons, VerdictHero } from "../components/Verdict";
import { VvmCheck } from "../components/VvmCheck";
import { api } from "../lib/api";
import { time } from "../lib/format";
import { clearArm, getArm, setArm, takeTap } from "../lib/tap";
import { useReadingNudge } from "../lib/useLive";
import { usePoll } from "../lib/usePoll";
import type { CarrierForecast, Explanation, NodeSummary, Report } from "../types";

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
  // Its carrier's every reading can move the verdict: re-fetch within a second, not at the next poll.
  useReadingNudge(data?.current_node_id, refresh);
  const [toast, setToast] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [moving, setMoving] = useState(false);
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

  const hideToast = useCallback(() => setToast(null), []);
  const changed = useCallback(
    (message: string) => {
      if (message) setToast(message);
      refresh();
    },
    [refresh],
  );
  const offline = !data ? cached(id) : null;
  const report = data ?? offline?.report ?? null;
  const savedAt = time(Math.round((updatedAt ?? offline?.at ?? Date.now()) / 1000));
  const stale = error && report ? `Can't reach the server: result from ${savedAt}` : !data && offline ? `Updating… showing the result from ${savedAt}` : null;

  if (!report) {
    return (
      <Layout>
        <BackHeader eyebrow={id} />
        {error ? <ErrorNote error={error} onRetry={refresh} /> : <Spinner label="Checking this box" />}
      </Layout>
    );
  }

  const vaccine = report.product.kind === "vaccine";
  const unit = vaccine ? "doses" : "tests";
  const inside = report.segments.find((s) => !s.end_ts);
  const fc = forecast.data?.available ? forecast.data : null;
  const label = report.label_check;

  return (
    <Layout>
      <BackHeader eyebrow={report.box.id} />
      <h1 className="m-0 mb-1 text-2xl leading-[1.15] [text-wrap:pretty]">{report.product.name}</h1>
      <p className="m-0 mb-[18px] text-sm text-neutral-400">
        {report.box.quantity.toLocaleString()} {unit}
        {report.box.origin && ` · ${report.box.origin} → ${report.box.destination}`} · {report.current_node_id ? "in transit" : "delivered"}
      </p>

      <VerdictHero report={report} stale={stale} onCheckLabel={() => setScanning(true)} />

      <SectionTitle>Why this verdict</SectionTitle>
      <Reasons reasons={report.reasons} />

      {fc && inside && (
        <Link
          to={`/node/${inside.node_id}`}
          className="mt-[26px] grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] bg-accent-900 px-5 py-4 text-left text-accent-200 hover:bg-accent-800"
        >
          <span className="flex flex-col gap-1">
            <span className="text-[13px] uppercase tracking-[0.08em] opacity-80">In {inside.node_label}</span>
            <span className="text-base leading-[1.35]">{forecastLine(fc)}</span>
          </span>
          <ChevronRightIcon size={22} />
        </Link>
      )}

      <div className="mt-[26px] flex flex-col gap-2.5">
        {vaccine && (
          <button onClick={() => setScanning(true)} className="btn-accent">
            <ScanIcon size={22} />
            Scan the VVM label
          </button>
        )}
        {vaccine && label && (
          <p className="m-0 text-center text-[13px] text-neutral-400">
            Last label confirmed {time(label.ts)}: stage {label.stage}
            {label.flagged ? ", flagged: it disagreed with the record" : ", agreed with the record"}
          </p>
        )}
        <button onClick={() => setMoving(!moving)} aria-expanded={moving} className="btn-quiet w-full">
          Move this box
        </button>
        {moving && <MoveBox report={report} onMoved={changed} />}
      </div>

      <SectionTitle>More detail</SectionTitle>
      <Details>
        <Detail first title="Temperature over the trip">
          <ErrorBoundary label="The chart">
            <TripChart segments={report.segments} product={report.product} budgetUsed={report.budget_used} />
          </ErrorBoundary>
        </Detail>
        <Detail title="Where it has been">
          <Custody segments={report.segments} places={report.places} />
        </Detail>
        <Detail title="What a threshold logger would say">
          <LoggerCompare report={report} />
        </Detail>
        <Detail title="The numbers">
          <Numbers report={report} />
        </Detail>
        <Detail title="Same trip, other products">
          <ErrorBoundary label="The comparison">
            <Counterfactual boxId={report.box.id} />
          </ErrorBoundary>
        </Detail>
        <Detail title="Written report">
          <ErrorBoundary label="The report">
            <WorkerReport boxId={report.box.id} verdict={report.verdict} />
          </ErrorBoundary>
        </Detail>
        {report.box.id.startsWith("BOX-9") && (
          <Detail title="Stage demo">
            <StageReset onDone={changed} />
          </Detail>
        )}
      </Details>
      <p className="m-0 mt-[18px] text-center text-xs text-neutral-500">Decision support with a human in the loop. Not a clinical determination.</p>

      {scanning && (
        <Sheet title="Check the VVM label" onClose={() => setScanning(false)}>
          <VvmCheck
            boxId={report.box.id}
            latest={report.label_check}
            highlight={report.confidence.borderline}
            onConfirmed={(message) => {
              setScanning(false);
              changed(message);
            }}
          />
        </Sheet>
      )}
      <Toast message={toast} onDone={hideToast} />
    </Layout>
  );
}

/** A panel that slides up over the page (the camera, a confirmation). */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-[color-mix(in_srgb,var(--color-neutral-900)_70%,transparent)] backdrop-blur-sm" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[20px] bg-surface px-5 pt-4 shadow-[0_0_0_1px_#595d6c,0_-16px_40px_rgba(0,0,0,.55)]"
        style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="m-0 text-lg">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-neutral-300 hover:bg-white/5">
            <XIcon size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

/** Grok's plain-language write-up, requested only when someone opens it. */
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

  if (!data) {
    return loading ? (
      <div className="space-y-2" aria-busy="true">
        <div className="h-3 w-full animate-pulse rounded bg-neutral-800" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-800" />
      </div>
    ) : (
      <p className="m-0 text-sm text-neutral-400">Report unavailable right now.</p>
    );
  }
  const source = data.source === "grok" ? "Written by Grok" : "Template (add XAI_API_KEY for Grok)";
  const places = data.places_source === "gemini" ? "places named by Gemini" : "places shown as coordinates";
  return (
    <div className={loading ? "opacity-60" : ""}>
      {data.text.split(/\n\s*\n/).map((para, i) => (
        <p key={i} className="m-0 mb-3 text-base leading-[1.55] [text-wrap:pretty] last:mb-0">
          {para}
        </p>
      ))}
      <p className="m-0 mt-3 flex flex-wrap items-center gap-1 text-xs text-neutral-500">
        <SparkIcon size={12} /> {source} · {places} · the verdict comes from the rule engine
        <button onClick={run} disabled={loading} className="ml-auto !min-h-0 text-accent-400 underline-offset-2 hover:underline disabled:opacity-50">
          {loading ? "Writing…" : "Refresh"}
        </button>
      </p>
      {failed && <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-bad)" }}>Couldn't refresh; showing the last report.</p>}
    </div>
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

  const others = nodes.filter((n) => n.id !== report.current_node_id && !n.backup_for);
  return (
    <div className="flex flex-col gap-2 py-1.5">
      <div className="flex gap-2">
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="select-pill flex-1" aria-label="Carrier or cold room">
          <option value="">Choose a carrier or cold room…</option>
          {others.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
        <button disabled={!target || busy} onClick={() => act(() => api.load(report.box.id, target), `Loaded ${report.box.id} into ${target}`)} className="btn-outline">
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
          className="btn-quiet w-full"
        >
          Unload from {report.current_node_id}
        </button>
      )}
    </div>
  );
}
