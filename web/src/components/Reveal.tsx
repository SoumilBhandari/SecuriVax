import { createElement, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";

import { EASE, gsap, prefersReducedMotion, ScrollTrigger, useGSAP } from "../lib/motion";

/**
 * Content that rises into view the first time it's scrolled to. `each` reveals
 * the direct children one after another instead of the block at once. Runs
 * once and never again, and does nothing for anyone who asked for less motion.
 */
export function Reveal({
  children,
  className,
  style,
  as: Tag = "div",
  each = false,
  stagger = 0.07,
  y = 18,
  delay = 0,
  duration = 0.9,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
  each?: boolean;
  stagger?: number;
  y?: number;
  delay?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion()) return;
      const targets = each ? Array.from(el.children) : [el];
      if (targets.length === 0) return;
      gsap.set(targets, { opacity: 0, y });
      ScrollTrigger.batch(targets, {
        once: true,
        start: "top 94%",
        onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration, ease: EASE.out, stagger, delay, overwrite: true }),
      });
    },
    { scope: ref, dependencies: [each] },
  );

  return createElement(Tag, { ref, className, style }, children);
}
