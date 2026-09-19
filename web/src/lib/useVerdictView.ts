import { useEffect, useState, type RefObject } from "react";

import { VERDICT_KEY, type VerdictKey } from "../components/Brand";
import type { Report } from "../types";
import { EASE, gsap, prefersReducedMotion } from "./motion";

/** The signal fills as the browser needs them literally: for the status bar and the wash. */
export const SIGNAL_HEX: Record<VerdictKey, string> = { use: "#157a52", quarantine: "#f2b01e", discard: "#c93535" };

/**
 * What a verdict surface paints. It trails the report by one wash when the
 * verdict changes: the new colour grows out from the ring over the old one,
 * then the new word lands with a spring. Same-verdict updates paint at once.
 */
export function useVerdictView(
  report: Report,
  refs: { field: RefObject<HTMLElement | null>; wash: RefObject<HTMLElement | null>; ring: RefObject<HTMLElement | null>; word: RefObject<HTMLElement | null> },
): Report {
  const [view, setView] = useState(report);

  useEffect(() => {
    if (report === view) return;
    if (report.verdict === view.verdict) {
      setView(report);
      return;
    }
    const f = refs.field.current;
    const w = refs.wash.current;
    if (!f || !w || prefersReducedMotion()) {
      setView(report);
      return;
    }
    const next = VERDICT_KEY[report.verdict];
    const fr = f.getBoundingClientRect();
    const rr = (refs.ring.current ?? f).getBoundingClientRect();
    const cx = rr.left + rr.width / 2 - fr.left;
    const cy = rr.top + rr.height / 2 - fr.top;
    const radius = Math.hypot(Math.max(cx, fr.width - cx), Math.max(cy, fr.height - cy));
    gsap.set(w, { background: SIGNAL_HEX[next], clipPath: `circle(0px at ${cx}px ${cy}px)`, opacity: 1 });
    const tween = gsap.to(w, {
      clipPath: `circle(${radius}px at ${cx}px ${cy}px)`,
      duration: 0.75,
      ease: EASE.out,
      onComplete: () => {
        setView(report);
        gsap.set(w, { opacity: 0 });
        const word = refs.word.current;
        if (word) gsap.fromTo(word, { scale: 0.9, opacity: 0.3 }, { scale: 1, opacity: 1, duration: 0.7, ease: EASE.spring });
      },
    });
    return () => {
      tween.kill();
    };
  }, [report, view, refs.field, refs.wash, refs.ring, refs.word]);

  return view;
}
