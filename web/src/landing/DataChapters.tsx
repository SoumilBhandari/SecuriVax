import { useMemo, useRef } from "react";

import { budgetOver, budgetPct, pct, temp, time } from "../lib/format";
import { EASE, gsap, prefersReducedMotion } from "../lib/motion";
import { SIGNAL_HEX } from "../lib/useVerdictView";
import type { Report } from "../types";
import { chapterHeight, reveal, useChapter } from "./useChapter";

// ---- The last mile: a real trip's temperature, drawing itself across the screen.

const VW = 1200;
const VH = 480;

/** How much of the budget is gone: the figure, and a bar under it. */
function Spent({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <p className="eyebrow m-0">Budget used</p>
      <p data-spent className="m-0 mt-2 font-display text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums lg:text-[56px]">
        0%
      </p>
      <span className="mt-3 block h-[3px] w-full overflow-hidden rounded-full lg:mt-4" style={{ background: "rgba(255,255,255,0.14)" }}>
        <span data-bar className="block h-full w-full origin-left rounded-full" style={{ background: "currentColor", transform: "scaleX(0)" }} />
      </span>
      {/* Only once the budget is gone: how far past it this trip went. */}
      <p data-over className="eyebrow m-0 mt-2 opacity-0 transition-opacity duration-300" />
    </div>
  );
}

/**
 * The ground under the trace, by how much of the product's stability budget
 * has been spent: black while the box is cold, an ember that deepens towards
 * red as the heat eats into it. A wash, never a fill: the signal colours stay
 * with the verdict itself.
 */
function heat(budget: number): string {
  const t = Math.min(1, Math.max(0, budget));
  const g = Math.round(150 - 110 * t);
  const b = Math.round(70 - 55 * t);
  return `radial-gradient(125% 95% at 50% 82%, rgba(214, ${g}, ${b}, ${(0.05 + 0.3 * t).toFixed(3)}) 0%, rgba(0,0,0,0) 62%)`;
}

/**
 * Every reading of one real trip as a line that draws as the reader scrolls,
 * against the 2 to 8 band, with the hottest moment called out when the line
 * reaches it. Dark ground.
 */
export function TraceChapter({ report }: { report: Report | null }) {
  const section = useRef<HTMLElement>(null);
  const wipe = useRef<SVGRectElement>(null);
  const head = useRef<SVGCircleElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const peakLabel = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);

  const trace = useMemo(() => {
    if (!report) return null;
    const pts = report.segments.flatMap((s) => s.series.map((p) => ({ ts: p.ts, c: p.temp_c, b: p.budget })));
    if (pts.length < 2) return null;
    const t0 = pts[0].ts;
    const t1 = pts[pts.length - 1].ts;
    const temps = pts.map((p) => p.c);
    const lo = Math.floor(Math.min(...temps, report.product.storage_min_c) - 2);
    const hi = Math.ceil(Math.max(...temps, report.product.storage_max_c) + 2);
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * VW;
    const y = (c: number) => VH - 40 - ((c - lo) / (hi - lo)) * (VH - 80);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
    let peak = pts[0];
    let peakI = 0;
    pts.forEach((p, i) => {
      if (p.c > peak.c) {
        peak = p;
        peakI = i;
      }
    });
    const budgets = pts.map((p) => p.b);
    const at = (f: number) => pts[Math.max(0, Math.min(pts.length - 1, Math.round(f * (pts.length - 1))))];
    return { d, x, y, lo, hi, t0, t1, peak, peakAt: peakI / (pts.length - 1), budgets, at, min: report.product.storage_min_c, max: report.product.storage_max_c, tz: report.segments[0]?.tz };
  }, [report]);

  useChapter(
    section,
    (tl) => {
      if (copy.current) reveal(tl, copy.current.children, 0.02);
      const h = head.current;
      const w = wipe.current;
      if (!w || !trace) return;
      const o = { f: 0 };
      tl.to(
        o,
        {
          f: 1,
          duration: 0.7,
          onUpdate: () => {
            // The line is revealed by a wipe across the plot, not by a dash:
            // the stroke doesn't scale with the box, so a dash measured in the
            // viewBox's units tiles across it and the trip appears in pieces.
            w.setAttribute("width", String(VW * o.f));
            const now = trace.at(o.f);
            if (h) {
              h.setAttribute("cx", String(trace.x(now.ts)));
              h.setAttribute("cy", String(trace.y(now.c)));
            }
            // The budget the engine had spent by this reading, as the line
            // reaches it: the number climbs, the bar fills, and the ground
            // warms with it, so the cost of the hot stretch is visible while
            // it happens rather than at the end.
            const b = trace.budgets[Math.round(o.f * (trace.budgets.length - 1))] ?? 0;
            const shown = budgetPct(b);
            view.current?.querySelectorAll<HTMLElement>("[data-spent]").forEach((el) => (el.textContent = shown));
            const over = budgetOver(b);
            view.current?.querySelectorAll<HTMLElement>("[data-over]").forEach((el) => {
              el.textContent = over ?? "";
              el.style.opacity = over ? "1" : "0";
            });
            view.current?.querySelectorAll<HTMLElement>("[data-bar]").forEach((el) => (el.style.transform = `scaleX(${Math.min(1, b)})`));
            if (view.current) view.current.style.background = heat(b);
          },
        },
        0.18,
      );
      if (peakLabel.current) reveal(tl, peakLabel.current, 0.18 + 0.7 * trace.peakAt, { duration: 0.08, y: 10 });
      if (view.current) view.current.style.background = heat(0);
    },
    [trace],
  );

  return (
    <section ref={section} data-theme="dark" className="chapter bg-bg text-text" style={chapterHeight(trace ? 2.6 : 1)} aria-label="Temperature over the trip">
      <div ref={view} className="chapter__view">
        <div className="chapter__copy chapter__copy--top">
          <div ref={copy}>
            <p className="eyebrow m-0">{report?.box.id ?? " "}</p>
            <h2 className="ui-title-1 m-0 mt-4">Temperature over the trip</h2>
            {trace ? (
              <Spent className="mt-7 max-w-[220px] lg:hidden" />
            ) : (
              <p className="ui-body m-0 mt-5 max-w-[34ch] text-neutral-500">Fetching a real trip from the server.</p>
            )}
          </div>
        </div>
        {trace && <Spent className="absolute right-6 top-[calc(var(--nav-h)+7vh)] hidden w-[220px] text-right lg:block lg:right-10" />}
        {trace && (
          <div className="absolute inset-x-0 bottom-[max(6vh,calc(env(safe-area-inset-bottom,0px)+24px))] px-6 lg:bottom-[10vh] lg:px-10">
            <div className="relative mx-auto max-w-[1180px]">
              <svg viewBox={`0 0 ${VW} ${VH}`} className="block h-[32svh] w-full lg:h-[46vh]" preserveAspectRatio="none" role="img" aria-label="Temperature over the trip">
                <rect x="0" y={trace.y(trace.max)} width={VW} height={trace.y(trace.min) - trace.y(trace.max)} fill="var(--accent)" opacity="0.14" />
                <line x1="0" x2={VW} y1={trace.y(trace.max)} y2={trace.y(trace.max)} stroke="var(--accent)" strokeOpacity="0.5" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
                <line x1="0" x2={VW} y1={trace.y(trace.min)} y2={trace.y(trace.min)} stroke="var(--accent)" strokeOpacity="0.5" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
                <clipPath id="trace-wipe">
                  <rect ref={wipe} x="0" y="0" width="0" height={VH} />
                </clipPath>
                <path
                  d={trace.d}
                  clipPath="url(#trace-wipe)"
                  fill="none"
                  stroke="var(--text)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <circle ref={head} r="6" fill="var(--accent)" vectorEffect="non-scaling-stroke" style={{ transform: "scale(1)" }} />
              </svg>
              <div
                ref={peakLabel}
                className="pointer-events-none absolute -translate-x-1/2 text-center"
                style={{ left: `${(trace.x(trace.peak.ts) / VW) * 100}%`, top: `calc(${(trace.y(trace.peak.c) / VH) * 100}% - 52px)` }}
              >
                <span className="rounded-full bg-surface px-3 py-1 text-[13px] font-semibold tabular-nums shadow-float">Peak {temp(trace.peak.c)}</span>
              </div>
              <div className="ui-caption mt-2 flex justify-between text-[13px]">
                <span>
                  {report?.box.origin} · {time(trace.t0, trace.tz)}
                </span>
                <span>
                  {report?.box.destination} · {time(trace.t1, trace.tz)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- Decide: the budget fills, the verdict steps up, and the ground takes the verdict's colour.

const STEPS: { at: number; word: string; key: "use" | "quarantine" | "discard" }[] = [
  { at: 0, word: "Use", key: "use" },
  { at: 0.5, word: "Use first", key: "use" },
  { at: 0.75, word: "Quarantine", key: "quarantine" },
  { at: 1, word: "Discard", key: "discard" },
];

export function DecideChapter() {
  const section = useRef<HTMLElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const number = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const step = useRef(-1);

  useChapter(section, (tl) => {
    if (copy.current) reveal(tl, copy.current.children, 0.02);
    const o = { b: 0 };
    tl.to(
      o,
      {
        b: 1.06,
        duration: 0.78,
        onUpdate: () => {
          const shown = Math.min(1, o.b);
          if (arc.current) arc.current.setAttribute("stroke-dasharray", `${shown * 100} ${100 - shown * 100}`);
          if (number.current) number.current.textContent = pct(shown);
          let i = 0;
          for (let k = 0; k < STEPS.length; k++) if (o.b >= STEPS[k].at) i = k;
          if (i !== step.current) {
            step.current = i;
            const s = STEPS[i];
            if (view.current) {
              view.current.style.background = SIGNAL_HEX[s.key];
              view.current.style.color = s.key === "quarantine" ? "#1d1d1f" : "#ffffff";
            }
            if (word.current) {
              word.current.textContent = s.word;
              if (!prefersReducedMotion()) gsap.fromTo(word.current, { scale: 0.9, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.6, ease: EASE.spring, overwrite: true });
            }
          }
        },
      },
      0.14,
    );
  });

  return (
    <section ref={section} data-theme="dark" className="chapter" style={chapterHeight(3)} aria-label="Decide">
      <div ref={view} className="chapter__view chapter__view--signal" style={{ background: SIGNAL_HEX.use, color: "#ffffff" }}>
        <div className="chapter__copy chapter__copy--on-signal">
          <div ref={copy}>
            <p className="eyebrow m-0" style={{ color: "inherit", opacity: 0.8 }}>
              03
            </p>
            <h2 className="ui-title-1 m-0 mt-4">Decide</h2>
            <p className="m-0 mt-5 max-w-[40ch] text-[17px] leading-7 opacity-85 lg:text-[19px] lg:leading-8">
              Each product's stability budget is spent with the Arrhenius equation, freezing is checked on its own, and the box gets one verdict:
              use, use first, quarantine or discard. A photo of the VVM label is the second witness.
            </p>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-[max(8vh,calc(env(safe-area-inset-bottom,0px)+40px))] flex flex-col items-center gap-5 px-6 lg:inset-y-0 lg:left-auto lg:right-[8vw] lg:justify-center">
          <div className="relative">
            <svg width="min(46vw, 260px)" height="min(46vw, 260px)" viewBox="0 0 100 100" className="block" role="img" aria-label="Budget used">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="9" />
              <circle
                ref={arc}
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="9"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="0 100"
                transform="rotate(-90 50 50)"
              />
            </svg>
            <span ref={number} className="absolute inset-0 grid place-items-center font-display text-[clamp(36px,7vw,64px)] font-semibold tabular-nums tracking-[-0.03em]">
              0%
            </span>
          </div>
          <span ref={word} className="verdict-field__word inline-block text-[clamp(40px,9vw,96px)]">
            Use
          </span>
        </div>
      </div>
    </section>
  );
}
