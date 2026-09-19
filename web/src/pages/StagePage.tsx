import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { BudgetRing, Logo, ThemeToggle, VERDICT_KEY, VERDICT_MARK } from "../components/Brand";
import { BackIcon } from "../components/Icons";
import { LiveChart } from "../components/LiveChart";
import { timeLeft, verdictNote } from "../components/Verdict";
import { api } from "../lib/api";
import { demoRate, humidity, pct } from "../lib/format";
import { useLive, useReadingNudge } from "../lib/useLive";
import type { Report } from "../types";

const STAGE_NODE = "DEMO-01";
const STAGE_BOXES = ["BOX-9001", "BOX-9002"];
const WINDOW_S = 10 * 60;

/**
 * The projector view of the stage demo: the carrier's live temperature, and
 * each box inside it with its budget and verdict, all moving with every
 * reading. /stage?node=CAR-01 shows another carrier.
 */
export default function StagePage() {
  const [params] = useSearchParams();
  const node = params.get("node") ?? STAGE_NODE;
  const live = useLive(node);
  const [reports, setReports] = useState<Report[]>([]);
  const [loaded, setLoaded] = useState(true);

  // The boxes in the carrier now, or the two stage boxes before they're loaded.
  const refresh = useCallback(() => {
    api
      .boxes()
      .then((all) => {
        const inside = all.filter((b) => b.current_node_id === node).map((b) => b.id);
        setLoaded(inside.length > 0);
        return Promise.all((inside.length ? inside : node === STAGE_NODE ? STAGE_BOXES : []).map((id) => api.report(id)));
      })
      .then(setReports)
      .catch(() => {});
  }, [node]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => !document.hidden && refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);
  useReadingNudge(node, refresh, 1000);

  const now = useNow();
  const last = live.readings[live.readings.length - 1];
  const recent = useMemo(() => (last ? live.readings.filter((r) => r.ts > last.ts - WINDOW_S) : []), [live.readings, last]);
  const fresh = last && live.status === "live" && now / 1000 - last.received_at < 45;
  const band = live.band;
  const bandWord = !last || !band ? null : last.band === "ok" ? `In range ${band.min_c}–${band.max_c} °C` : last.band === "warm" ? `Above ${band.max_c} °C` : last.band === "cold" ? `Below ${band.min_c} °C` : "Freezing";
  const scale = reports[0]?.time_scale ?? 1;

  return (
    <div className="min-h-dvh bg-bg px-6 py-6 text-text lg:px-12 lg:py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/tags" aria-label="Back" className="back-btn">
            <BackIcon size={22} />
          </Link>
          <Logo height={40} />
        </div>
        <div className="flex items-center gap-3">
          <span className="pill gap-2" role="status">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: fresh ? "var(--glacier-500)" : "var(--ink-300)", animation: fresh ? "vt-pulse 1.6s infinite" : undefined }} />
            {fresh ? "Live" : live.status === "live" ? "Waiting for a reading" : live.status}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        <section aria-label="Carrier" className="card-soft p-6 lg:p-8">
          <p className="eyebrow m-0">Carrier · {node}</p>
          {last ? (
            <>
              <p className="m-0 mt-2 font-display text-xl font-semibold tracking-[-0.01em]">{last.label}</p>
              <p className="m-0 mt-6 whitespace-nowrap font-display text-[clamp(72px,11vw,168px)] font-semibold leading-[0.9] tabular-nums tracking-[-0.04em]">
                {last.temp_c.toFixed(1)}
                <span className="font-sans text-[clamp(28px,3vw,44px)] font-normal tracking-normal text-neutral-500"> °C</span>
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {bandWord && <span className="pill !text-sm">{bandWord}</span>}
                {last.rh != null && <span className="text-xl font-bold">{humidity(last.rh)} <span className="font-normal text-neutral-500">RH</span></span>}
              </div>
              <p className="ui-caption m-0 mt-3">
                {last.sensor} ±{last.sensor_accuracy_c} °C · {recent.length} readings in the last 10 min
              </p>
              {band && <LiveChart points={recent.length >= 2 ? recent : live.readings.slice(-30)} band={band} tall />}
            </>
          ) : (
            <p className="m-0 mt-6 text-xl text-neutral-500">{live.error ?? "Waiting for the carrier's first reading."}</p>
          )}
        </section>

        <section aria-label="Boxes" className="flex flex-col gap-6">
          {!loaded && reports.length > 0 && (
            <p className="ui-caption m-0">Not loaded yet: tap a box's tag, then {node}'s. Showing the stage boxes as they stand.</p>
          )}
          {reports.map((r) => (
            <StageBox key={r.box.id} report={r} />
          ))}
          {reports.length === 0 && <p className="m-0 text-xl text-neutral-500">No boxes in {node}.</p>}
        </section>
      </main>

      <footer className="ui-caption mt-8 flex flex-wrap justify-between gap-2">
        <span>{scale !== 1 ? `Demo time: ${demoRate(scale)}.` : "Real time."} Every reading moves the budget; the verdict follows.</span>
        <span>Potency in every drop. Decision support with a human in the loop.</span>
      </footer>
    </div>
  );
}

/**
 * One box, big enough to read from the back of the room, on its verdict's
 * colour with ✓, ! or ✕. The card pops when the verdict changes.
 */
function StageBox({ report: r }: { report: Report }) {
  const key = VERDICT_KEY[r.verdict];
  const used = Math.round(Math.min(r.budget_used, 1) * 100);
  const left = timeLeft(r);
  return (
    <article
      key={key}
      aria-label={`${r.product.name}: ${key}`}
      className={`sv-verdict sv-verdict--${key} grid grid-cols-[auto_minmax(0,1fr)] !gap-6 !p-6 lg:!gap-8 lg:!p-8`}
      style={{ animation: "vt-pop 600ms ease-out" }}
    >
      <BudgetRing value={used} size={148} tone="signal" mark={VERDICT_MARK[key]} />
      <div className="min-w-0">
        <p className="sv-verdict__eyebrow">
          {r.box.id} · {r.product.name}
        </p>
        <p className="m-0 mt-1 font-display text-[clamp(40px,5vw,72px)] font-bold uppercase leading-none tracking-[-0.03em]">{key}</p>
        <p className="m-0 mt-3 text-xl">{verdictNote(r)}</p>
        <p className="m-0 mt-2 text-lg opacity-90">
          <b className="tabular-nums">{pct(r.budget_used)}</b> of the heat budget used{left && ` · ${left} at this temperature`}
        </p>
      </div>
    </article>
  );
}

/** Re-render every second so "Live" goes quiet when readings stop. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
