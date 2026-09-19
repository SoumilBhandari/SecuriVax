/**
 * One motion engine for the whole app: GSAP, with ScrollTrigger for anything
 * tied to scrolling and Flip for things that change place. Registered once
 * here; import from this module, never from "gsap" directly, so the plugins
 * are always there.
 *
 * Rules (docs/ui-overhaul.md): the landing page may pin and scrub; app pages
 * only reveal once on first view. Everything respects reduced motion.
 */
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, Flip, useGSAP);

gsap.defaults({ ease: "expo.out", duration: 0.8 });

// Anything scrubbed has to match the scroll, not a smoothed idea of elapsed
// time. GSAP's lag smoothing pretends a long frame was 33 ms, so after any
// stall (a chapter's WebGL starting up, a background tab) a scrubbed timeline
// crawls towards the scroll position and the reader sees a half-finished
// chapter. Real time instead: a stall is followed by an immediate catch-up.
gsap.ticker.lagSmoothing(0);

// On a phone, flicking up brings the browser's own bars back, which changes
// the viewport height. Re-measuring every chapter in the middle of that flick
// is a visible stutter, and the reader gained nothing by it.
ScrollTrigger.config({ ignoreMobileResize: true });

// In development the scroll triggers are reachable from the console and the screenshot scripts.
if (import.meta.env.DEV) (window as unknown as { ScrollTrigger: typeof ScrollTrigger }).ScrollTrigger = ScrollTrigger;

export { Flip, gsap, ScrollTrigger, useGSAP };

/** The eases the design uses, by name, so pages don't invent their own. */
export const EASE = {
  /** Things that arrive and settle: reveals, sheets opening, a value changing. */
  out: "expo.out",
  /** Things that move from one place to another. */
  inOut: "power3.inOut",
  /** A verdict landing, a badge popping: one overshoot, then still. */
  spring: "back.out(1.6)",
  /** A scrubbed sequence: the scroll owns the timing, this only smooths it. */
  scrub: "none",
} as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/** Ask ScrollTrigger to re-measure after layout changes it can't see (data arriving, an accordion opening). */
export function refreshScroll(): void {
  requestAnimationFrame(() => ScrollTrigger.refresh());
}

/**
 * A number that counts up to its value, for stats and verdict percentages.
 * Returns a tween the caller can kill; writes the formatted text itself.
 */
export function countTo(el: Element, to: number, format: (n: number) => string, duration = 1.2): gsap.core.Tween {
  const state = { n: 0 };
  el.textContent = format(0);
  if (prefersReducedMotion()) {
    el.textContent = format(to);
    return gsap.to(state, { n: to, duration: 0 });
  }
  return gsap.to(state, {
    n: to,
    duration,
    ease: "power2.out",
    onUpdate: () => {
      el.textContent = format(state.n);
    },
  });
}
