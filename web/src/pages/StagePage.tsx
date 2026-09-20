import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { BudgetRing, Logo, ThemeToggle, VERDICT_KEY, VERDICT_MARK } from "../components/Brand";
import { BackIcon } from "../components/Icons";
import { LiveChart } from "../components/LiveChart";
import { timeLeft, verdictNote } from "../components/Verdict";
import { WORD } from "../components/VerdictField";
import { api } from "../lib/api";
import { budgetPct, demoRate, humidity } from "../lib/format";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { useFitText } from "../lib/useFitText";
import { useLive, useReadingNudge } from "../lib/useLive";
import { useVerdictView } from "../lib/useVerdictView";
import type { Report } from "../types";

/** The same wording the Live page uses: the projector must not show the raw
 * status word, which is lowercase and reads like a bug from the back row. */
const STATUS_WORD: Record<string, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
  snapshot: "Saved copy",
};

const STAGE_NODE = "DEMO-01";
const STAGE_BOXES = ["BOX-9001", "BOX-9002"];
const WINDOW_S = 10 * 60;

/**
 * The projector view of the stage demo: the carrier's live temperature, and
 * each box inside it filling its own panel in its verdict's colour, all
 * moving with every reading. /stage?node=CAR-01 shows another carrier.
 */
export default function StagePage() {
  const [params] = useSearchParams();
  const node = params.get("node") ?? STAGE_NODE;
  const live = useLive(node);
  const [reports, setReports] = useState<Report[]>([]);
  const [loaded, setLoaded] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  // The boxes in the carrier now, or the two stage boxes before they're loaded.
  const refresh = useCallback(() => {
    api
      .boxes()
      .then((all) => {
        const inside = all.filter((b) => b.current_node_id === node).map((b) => b.id);
        setLoaded(inside.length > 0);
        return Promise.all((inside.length ? inside : node === STAGE_NODE ? STAGE_BOXES : []).map((id) => api.report(id)));
      })
      .then((rs) => {
        setReports(rs);
        setUnreachable(false);
      })
      // An unreachable server used to land as "No boxes in DEMO-01", which is
      // the projector saying the carrier is empty when it does not know.
      .catch(() => setUnreachable(true));
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
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion() || !root.current) return;
      gsap.from(root.current.querySelectorAll("[data-rise]"), { y: 24, opacity: 0, duration: 1, ease: EASE.out, stagger: 0.1 });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="flex min-h-dvh flex-col bg-bg px-5 py-5 text-text lg:px-10 lg:py-8">
      <header className="mb-6 flex items-center justify-between gap-4" data-rise>
        <div className="flex items-center gap-4">
          <Link to="/tags" viewTransition aria-label="Back" className="back-btn">
            <BackIcon size={22} />
          </Link>
          <Logo height={34} />
        </div>
        <div className="flex items-center gap-3">
          <span className="pill gap-2 !normal-case !tracking-[-0.01em] !text-[13px]" role="status">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: fresh ? "var(--accent)" : "var(--line-2)", animation: fresh ? "vt-pulse 1.6s infinite" : undefined }}
            />
            {fresh ? "Live" : live.status === "live" ? "Waiting for a reading" : STATUS_WORD[live.status]}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        <section aria-label="Carrier" className="panel flex flex-col p-6 lg:p-9" data-rise>
          <p className="eyebrow m-0">Carrier · {node}</p>
          {last ? (
            <>
              <p className="ui-heading m-0 mt-2">{last.label}</p>
              <p className="m-0 mt-8 font-display text-[clamp(52px,12vw,192px)] font-semibold leading-[0.9] tracking-[-0.045em] tabular-nums">
                <Rolling value={last.temp_c} decimals={1} />
                <span className="font-sans text-[clamp(28px,3vw,44px)] font-normal tracking-normal text-neutral-500"> °C</span>
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {bandWord && <span className="pill !normal-case !tracking-[-0.01em] !text-[14px]">{bandWord}</span>}
                {last.rh != null && (
                  <span className="text-[22px] font-semibold tabular-nums">
                    {humidity(last.rh)} <span className="font-normal text-neutral-500">RH</span>
                  </span>
                )}
              </div>
              <p className="ui-caption m-0 mt-3">
                {last.sensor} ±{last.sensor_accuracy_c} °C · {recent.length} readings in the last 10 min
              </p>
              <div className="mt-auto pt-6">{band && <LiveChart points={recent.length >= 2 ? recent : live.readings.slice(-30)} band={band} tall />}</div>
            </>
          ) : (
            <p className="m-0 mt-8 text-[21px] leading-8 text-neutral-500">{live.error ?? "Waiting for the carrier's first reading."}</p>
          )}
        </section>

        <section aria-label="Boxes" className="flex flex-col gap-5 lg:gap-6">
          {!loaded && reports.length > 0 && (
            <p className="ui-caption m-0" data-rise>
              Not loaded yet: tap {node}'s tag, then each box's. Showing the stage boxes as they stand.
            </p>
          )}
          {reports.map((r) => (
            <StageBox key={r.box.id} report={r} />
          ))}
          {reports.length === 0 && (
            <p className="m-0 text-[21px] text-neutral-500" role={unreachable ? "alert" : undefined} data-rise>
              {unreachable ? "Can't reach the server. Showing nothing rather than something wrong." : `No boxes in ${node}.`}
            </p>
          )}
        </section>
      </main>

      <footer className="ui-caption mt-6 flex flex-wrap justify-between gap-2" data-rise>
        <span>{scale !== 1 ? `Demo time: ${demoRate(scale)}.` : "Real time."} Every reading moves the budget; the verdict follows.</span>
        <span>Potency in every drop. Decision support with a human in the loop.</span>
      </footer>
    </div>
  );
}

/**
 * One box, big enough to read from the back of the room: its whole panel in
 * the verdict's colour with the ring and the word. A flip washes the new
 * colour out from the ring and lands the new word with a spring.
 */
function StageBox({ report }: { report: Report }) {
  const field = useRef<HTMLElement>(null);
  const wash = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const r = useVerdictView(report, { field, wash, ring, word });
  const key = VERDICT_KEY[r.verdict];
  const used = Math.round(Math.min(r.budget_used, 1) * 100);
  const left = timeLeft(r);
  const fit = useFitText([r.verdict], { min: 36, max: 112 });
  return (
    <article
      ref={field}
      aria-label={`${r.product.name}: ${WORD[r.verdict]}`}
      className={`verdict-field verdict-field--${key} flex flex-1 flex-col justify-center rounded-[28px] p-6 lg:p-8`}
      data-rise
    >
      <span ref={wash} className="verdict-field__wash rounded-[28px]" aria-hidden="true" />
      <div className="relative z-[1] grid grid-cols-[auto_minmax(0,1fr)] items-center gap-6 lg:gap-8">
        <div ref={ring}>
          <BudgetRing value={used} size={132} tone="signal" mark={VERDICT_MARK[key]} />
        </div>
        <div className="min-w-0">
          <p className="verdict-field__dim m-0 text-[15px] font-semibold leading-5 tracking-[-0.016em] lg:text-[17px] lg:leading-6">
            {r.box.id} · {r.product.name}
          </p>
          <div ref={fit.box} className="mt-2 w-full">
            <span ref={fit.text} className="verdict-field__word">
              <span ref={word} className="inline-block origin-left">
                {WORD[r.verdict]}
              </span>
            </span>
          </div>
          <p className="verdict-field__note m-0 mt-3 text-[19px] leading-7 tracking-[-0.022em] lg:text-[22px] lg:leading-8">{verdictNote(r)}</p>
          <p className="verdict-field__dim m-0 mt-1.5 text-[17px] leading-6 tracking-[-0.022em]">
            <b className="tabular-nums">{budgetPct(r.budget_used)}</b> of the heat budget used{left && ` · ${left} at this temperature`}
          </p>
        </div>
      </div>
    </article>
  );
}

/** A number that rolls to each new value instead of jumping. */
function Rolling({ value, decimals }: { value: number; decimals: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useEffect(() => {
    const span = el.current;
    if (!span) return;
    if (prefersReducedMotion()) {
      span.textContent = value.toFixed(decimals);
      shown.current = value;
      return;
    }
    const o = { n: shown.current };
    const tween = gsap.to(o, {
      n: value,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => {
        span.textContent = o.n.toFixed(decimals);
      },
    });
    shown.current = value;
    return () => {
      tween.kill();
    };
  }, [value, decimals]);
  return <span ref={el}>{value.toFixed(decimals)}</span>;
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
