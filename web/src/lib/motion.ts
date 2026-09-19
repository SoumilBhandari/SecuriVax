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
