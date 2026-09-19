import { useEffect, useRef, useState, type ReactNode } from "react";

import { pct } from "../lib/format";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { applyTheme } from "../lib/theme";
import { useFitText } from "../lib/useFitText";
import { SIGNAL_HEX as HEX, useVerdictView } from "../lib/useVerdictView";
import type { Report, Verdict } from "../types";
import { BudgetRing, VERDICT_KEY, VERDICT_MARK } from "./Brand";
import { timeLeft, verdictNote } from "./Verdict";

export const WORD: Record<Verdict, string> = { USE: "Use", USE_FIRST: "Use first", QUARANTINE: "Quarantine", DISCARD: "Discard" };

/** Laptop width or wider. */
function useWide(): boolean {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    const on = () => setWide(mq.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  return wide;
}

/** The rows under the word: how much is gone, what it rests on, how sure it is. */
export function verdictRows(report: Report): { label: ReactNode; value: ReactNode }[] {
  const left = timeLeft(report);
  const records = report.segments.length;
  const coarse = report.segments.reduce<Report["segments"][number] | null>(
    (worst, s) => ((s.sensor_accuracy_c ?? 0) > Math.max(worst?.sensor_accuracy_c ?? 0, 0.5) ? s : worst),
    null,
  );
  const rows = [
    { label: "Budget used", value: left ? `${pct(report.budget_used)} · ${left}` : pct(report.budget_used) },
    { label: "Witnesses", value: `${records} custody ${records === 1 ? "record" : "records"}${report.confidence.label_fused ? " + VVM" : ""}` },
    {
      label: <span title="Share of plausible scenarios (sensor error, batch variation, starting budget) that give the same verdict">Confidence</span>,
      value: `Holds in ${pct(report.confidence.confidence)} of scenarios`,
    },
  ];
  if (coarse) rows.push({ label: "Sensor", value: `${coarse.sensor}, ±${coarse.sensor_accuracy_c} °C` });
  return rows;
}

/**
 * The verdict, edge to edge in its own colour: the word at display size, the
 * budget ring, and the one instruction. When the verdict flips, the new colour
 * washes outward from the ring and the new word lands with a spring. The page
 * scrolls up over it as a sheet.
 */
export function VerdictField({ report, top }: { report: Report; top?: ReactNode }) {
  const field = useRef<HTMLElement>(null);
  const wash = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  // What's painted. It trails the report by one wash when the verdict changes.
  const view = useVerdictView(report, { field, wash, ring, word });
  const key = VERDICT_KEY[view.verdict];
  const [ringValue, setRingValue] = useState(0.5);
  const wide = useWide();
  const fit = useFitText([view.verdict, wide], { max: wide ? 168 : 128 });

  // The status bar takes the verdict's colour while this page is open.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", HEX[key]);
    return () => {
      applyTheme();
    };
  }, [key]);

  // The ring fills from empty on arrival and follows the budget after.
  useEffect(() => {
    const id = requestAnimationFrame(() => setRingValue(Math.round(Math.min(view.budget_used, 1) * 100)));
    return () => cancelAnimationFrame(id);
  }, [view.budget_used]);

  // The first paint: the word, the note and the line under it rise in.
  useGSAP(
    () => {
      if (prefersReducedMotion() || !copy.current) return;
      gsap.from(copy.current.children, { y: 26, opacity: 0, duration: 1.1, ease: EASE.out, stagger: 0.09, delay: 0.05 });
    },
    { scope: field },
  );

  const vaccine = view.product.kind === "vaccine";
  const unit = vaccine ? "doses" : "tests";
  const rows = verdictRows(view);

  return (
    <section
      ref={field}
      className={`verdict-field verdict-field--${key}`}
      aria-label={`Verdict: ${WORD[view.verdict]}`}
      style={{ viewTransitionName: "verdict" } as React.CSSProperties}
    >
      <span ref={wash} className="verdict-field__wash" aria-hidden="true" />
      <span className="sr-only" role="status" aria-live="polite">
        Verdict: {view.verdict.replace("_", " ").toLowerCase()}. {view.action}
      </span>
      <div className="verdict-field__inner">
        <div className="flex items-center justify-between gap-3">
          {top}
          {/* On a phone the ring sits opposite the back button; a laptop has it over the numbers. */}
          <div ref={ring} className="lg:hidden">
            <BudgetRing value={ringValue} tone="signal" size={56} mark={VERDICT_MARK[key]} />
          </div>
        </div>
        <div className="lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(300px,4fr)] lg:items-end lg:gap-16">
          <div ref={copy} className="mt-6 lg:mt-10">
            <p className="m-0 text-[17px] font-semibold leading-6 tracking-[-0.022em]">{view.product.name}</p>
            <p className="verdict-field__dim m-0 mt-0.5 text-[15px] leading-5 tracking-[-0.016em]">
              {view.box.id} · {view.box.quantity.toLocaleString()} {unit}
            </p>
            <div ref={fit.box} className="mt-5 w-full lg:mt-6">
              <span ref={fit.text} className="verdict-field__word">
                <span ref={word} className="inline-block origin-left">
                  {WORD[view.verdict]}
                </span>
              </span>
            </div>
            <p className="verdict-field__note m-0 mt-3 max-w-[34ch] text-[19px] font-medium leading-7 tracking-[-0.022em] lg:text-[21px] lg:leading-8">
              {verdictNote(view)}
            </p>
          </div>
          <div className="hidden lg:block">
            <div className="flex justify-end">
              <BudgetRing value={ringValue} tone="signal" size={116} mark={VERDICT_MARK[key]} />
            </div>
            <dl className="verdict-field__rows m-0 mt-6">
              {rows.map((r, i) => (
                <div key={i} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="verdict-field__dim m-0 text-[15px]">{r.label}</dt>
                  <dd className="m-0 text-right text-[15px] font-semibold tabular-nums">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
