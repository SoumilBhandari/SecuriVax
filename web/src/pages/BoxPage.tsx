import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { DataList } from "../components/Brand";
import { Counterfactual } from "../components/Counterfactual";
import { Custody } from "../components/Custody";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { FieldAction } from "../components/FieldAction";
import { forecastLine } from "../components/Forecast";
import { History } from "../components/History";
import { ChevronRightIcon, ScanIcon } from "../components/Icons";
import { BackHeader, BackOnField, Detail, Details, ErrorNote, Layout, PageTitle, SectionTitle, Spinner, Split, Toast } from "../components/Layout";
import { LoggerCompare } from "../components/LoggerCompare";
import { Reveal } from "../components/Reveal";
import { Sheet } from "../components/Sheet";
import { StageReset } from "../components/StageReset";
import { TripChart } from "../components/TripChart";
import { TripConditions } from "../components/TripConditions";
import { Numbers, Reasons } from "../components/Verdict";
import { VerdictField, verdictRows } from "../components/VerdictField";
import { VvmCheck } from "../components/VvmCheck";
import { api } from "../lib/api";
import { useAuth, useSignInFirst } from "../lib/auth";
import { canTapTags, useCanTapTags } from "../lib/device";
import { demoRate, pct, time } from "../lib/format";
import { refreshScroll } from "../lib/motion";
import { clearArm, getArm, setArm, takeFlag, takeTap } from "../lib/tap";
import { useReadingNudge } from "../lib/useLive";
import { usePoll } from "../lib/usePoll";
import type { CarrierForecast, Cause, NodeSummary, Report } from "../types";

// The route map pulls in Leaflet: loaded only when it's shown.
const RouteMap = lazy(() => import("../components/RouteMap"));

function cached(id: string): { report: Report; at: number } | null {
  try {
    return JSON.parse(localStorage.getItem(`vialtality.report.${id}`) ?? "null");
  } catch {
    return null;
  }
}

/**
 * Tap a sticker, get the answer: the verdict fills the top of the screen in
 * its own colour, and everything behind it scrolls up over it as a sheet.
 */
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
  const vvmHandoff = useRef(false);
  // The field scan this visit came from: a driver's NFC tap (checkpoint) or the clinic's QR (pickup).
  const [field, setField] = useState<"checkpoint" | "pickup" | null>(null);
  const canTap = useCanTapTags();
  const { user, ready } = useAuth();
  const signInFirst = useSignInFirst();

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
    if (!ready || tapHandled.current || !takeTap()) return;
    tapHandled.current = true;
    if (!canTapTags()) return; // a tag's URL opened on a computer: there's no second tap to pair it with
    const arm = getArm();
    if (arm?.kind === "node" && !user) {
      // Loading needs an operator: keep the pending link, sign in, and come back to finish it.
      setArm("node", arm.id);
      signInFirst(`/box/${id}?tap=1`);
      return;
    }
    if (arm?.kind === "node") {
      clearArm();
      api
        .load(id, arm.id)
        .then((res) => setToast(res.status === "already_loaded" ? `Already in ${arm.id}` : `Loaded into ${arm.id}`))
        .catch((e: Error) => setToast(`Couldn't load: ${e.message}`))
        .finally(refresh);
    } else {
      setArm("box", id); // a carrier tapped next takes it (a handover)
      setField("checkpoint"); // and a driver can log where it is now
    }
  }, [id, refresh, ready, user, signInFirst]);

  // The clinic's QR code (?pickup=1), or a return from sign-in to finish either scan.
  useEffect(() => {
    if (takeFlag("pickup")) setField("pickup");
    else if (takeFlag("checkpoint")) setField("checkpoint");
  }, [id]);

  // A computer's QR code opens the box here with ?vvm=1: go straight to the label check.
  useEffect(() => {
    if (takeFlag("vvm")) vvmHandoff.current = true;
  }, []);
  useEffect(() => {
    if (!vvmHandoff.current || !data || !ready) return;
    vvmHandoff.current = false;
    if (data.product.kind !== "vaccine" || data.product.has_vvm === false) return;
    if (!signInFirst(`/box/${id}?vvm=1`)) setScanning(true);
  }, [data, ready, signInFirst, id]);

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
        <BackHeader />
        <PageTitle eyebrow="Product" title={id} />
        {error && /^no box/i.test(error) ? (
          // A retry won't help a box that doesn't exist: say so, and where to go.
          <div role="alert" className="panel p-5">
            <p className="ui-heading m-0">Box not found</p>
            <p className="m-0 mt-2 text-neutral-300">No box has the ID {id}. Check the sticker, or pick the box from the list.</p>
            <Link to="/boxes" viewTransition className="btn-secondary mt-4">
              See all boxes
            </Link>
          </div>
        ) : error ? (
          <ErrorNote error={error} onRetry={refresh} />
        ) : (
          <Spinner label="Checking this box" />
        )}
      </Layout>
    );
  }

  const vaccine = report.product.kind === "vaccine";
  const hasVvm = vaccine && report.product.has_vvm !== false;
  const inside = report.segments.find((s) => !s.end_ts);
  const fc = forecast.data?.available ? forecast.data : null;
  const label = report.label_check;
  const history = report.history ?? [];
  const pickedUp = !report.current_node_id ? [...history].reverse().find((e) => e.action === "receive") : undefined;
  const status = report.current_node_id
    ? "In transit"
    : pickedUp
      ? `Picked up${pickedUp.facility ? ` at ${pickedUp.facility}` : ""}`
      : report.segments.length
        ? "Delivered"
        : "Not dispatched";
  const notes = [
    report.confidence.borderline && vaccine
      ? report.product.has_vvm
        ? "Borderline. Check the label."
        : "Borderline. A supervisor should decide."
      : null,
    !stale && report.provisional ? `Carrier quiet since ${time(report.data_through, inside?.tz)}, so this may change.` : null,
    report.demo_time ? `Demo time: ${demoRate(report.time_scale)}.` : null,
  ].filter((n): n is string => Boolean(n));

  return (
    <Layout hero={<VerdictField report={report} top={<BackOnField />} />}>
      {stale && (
        <p role="status" className="panel m-0 mb-4 px-5 py-3 text-[15px]" style={{ borderColor: "var(--border-strong)" }}>
          {stale}
        </p>
      )}
      {field && (
        <FieldAction
          kind={field}
          report={report}
          onClose={() => setField(null)}
          onDone={(message) => {
            setField(null);
            changed(message);
          }}
        />
      )}
      <Split
        left={
          <Reveal each stagger={0.08}>
            {/* On a phone the numbers sit here, first in the sheet; a laptop has them in the field. */}
            <div className="panel px-5 lg:hidden">
              <DataList rows={verdictRows(report)} />
            </div>
            {notes.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                {notes.map((n) => (
                  <p key={n} className="ui-caption m-0">
                    {n}
                  </p>
                ))}
              </div>
            )}
            <div className="mt-5 flex flex-col gap-3 lg:mt-0">
              {hasVvm && (
                <button onClick={() => signInFirst() || setScanning(true)} className="btn-primary">
                  <ScanIcon size={22} />
                  {canTap ? "Scan the VVM label" : "Check the VVM label"}
                </button>
              )}
              {hasVvm && label && (
                <p className="ui-caption m-0 text-center">
                  Last label confirmed {time(label.ts)}: stage {label.stage}
                  {label.flagged ? ", flagged: it disagreed with the record" : ", agreed with the record"}
                </p>
              )}
              <button
                onClick={() => {
                  if (signInFirst()) return;
                  setMoving(!moving);
                  refreshScroll();
                }}
                aria-expanded={moving}
                className="btn-secondary w-full"
              >
                Move this box
              </button>
              {moving && <MoveBox report={report} onMoved={changed} />}
            </div>
            <dl className="sv-data mt-6">
              <div className="sv-data__row">
                <dt>Status</dt>
                <dd>{status}</dd>
              </div>
              {report.box.origin && (
                <div className="sv-data__row">
                  <dt>Route</dt>
                  <dd>
                    {report.box.origin} → {report.box.destination}
                  </dd>
                </div>
              )}
            </dl>

            {/* Laptops: where the box went, beside the reasons (phones have it under More detail). */}
            {report.segments.some((s) => s.route.length > 0) && (
              <div className="hidden lg:block">
                <SectionTitle>Where it has been</SectionTitle>
                <ErrorBoundary label="The map">
                  <Suspense fallback={<Spinner label="Loading the map" />}>
                    <RouteMap segments={report.segments} places={report.places} height="h-[max(220px,calc(100dvh-640px))]" />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
          </Reveal>
        }
        right={
          <>
            <Reveal>
              <SectionTitle>Why</SectionTitle>
              <Reasons reasons={report.reasons} />
              <LikelyCause cause={report.likely_cause} />
            </Reveal>

            {fc && inside && (
              <Reveal>
                <Link
                  to={`/node/${inside.node_id}`}
                  viewTransition
                  className="lift mt-6 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-line bg-surface p-5 text-left text-text no-underline"
                >
                  <span className="flex flex-col gap-1.5">
                    <span className="eyebrow">Carrier · {inside.node_label}</span>
                    <span className="text-[17px] leading-6">{forecastLine(fc)}</span>
                  </span>
                  <ChevronRightIcon size={22} className="text-neutral-500" />
                </Link>
              </Reveal>
            )}

            <Reveal>
              <SectionTitle aside={history.length ? `${history.length} ${history.length === 1 ? "event" : "events"}` : undefined}>History</SectionTitle>
              <History events={history} />
            </Reveal>

            <Reveal>
              <ErrorBoundary label="The trip conditions">
                <TripConditions report={report} />
              </ErrorBoundary>
            </Reveal>

            <Reveal>
              <SectionTitle>More detail</SectionTitle>
              <Details>
                <Detail first title="Temperature over the trip" onOpen={refreshScroll}>
                  <ErrorBoundary label="The chart">
                    <TripChart segments={report.segments} product={report.product} budgetUsed={report.budget_used} />
                  </ErrorBoundary>
                </Detail>
                <Detail title="Where it has been" onOpen={refreshScroll}>
                  <Custody segments={report.segments} places={report.places} />
                </Detail>
                <Detail title="What a threshold logger would say" onOpen={refreshScroll}>
                  <LoggerCompare report={report} />
                </Detail>
                <Detail title="The numbers" onOpen={refreshScroll}>
                  <Numbers report={report} />
                </Detail>
                <Detail title="Same trip, other products" onOpen={refreshScroll}>
                  <ErrorBoundary label="The comparison">
                    <Counterfactual boxId={report.box.id} />
                  </ErrorBoundary>
                </Detail>
                {report.box.id.startsWith("BOX-9") && (
                  <Detail title="Stage demo" onOpen={refreshScroll}>
                    <StageReset onDone={changed} />
                  </Detail>
                )}
              </Details>
              <p className="ui-caption m-0 mt-6 text-center">Decision support with a human in the loop. Not a clinical determination.</p>
            </Reveal>
          </>
        }
      />

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

/**
 * What most likely caused it, under the reasons. Jev names it with a
 * probability; without it the rules' own reading stands, and either way the
 * verdict above was already decided without this line.
 */
function LikelyCause({ cause }: { cause?: Cause | null }) {
  if (!cause || cause.cause === "none") return null;
  const parts = [
    cause.label,
    cause.probability != null ? pct(cause.probability) : null,
    cause.ms != null ? `${cause.ms} ms` : null,
    cause.source === "jev" ? "Jev" : "from the rules",
  ].filter((p): p is string => Boolean(p));
  return (
    <p className="ui-caption m-0 mt-4">
      <span className="font-semibold text-text">Likely cause:</span> {parts.join(" · ")}
    </p>
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
    <div className="fade-in flex flex-col gap-2 py-1.5">
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
