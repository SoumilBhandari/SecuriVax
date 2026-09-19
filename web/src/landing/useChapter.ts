import { useRef, type RefObject } from "react";

import { gsap, ScrollTrigger, useGSAP } from "../lib/motion";

/**
 * A chapter is a tall section whose inner viewport sticks while the reader
 * scrolls through it. This wires a paused timeline to that scroll: the
 * timeline's 0 to 1 is the section's top reaching the viewport's top to its
 * bottom reaching the viewport's bottom. `build` adds the tweens; a light
 * smoothing follows the wheel without lagging it. Rebuilt when `deps` change
 * (data arriving), with the previous build fully reverted first. An unpinned
 * section can pass its own `start` and `end`.
 */
export function useChapter(
  section: RefObject<HTMLElement | null>,
  build: (tl: gsap.core.Timeline) => void,
  deps: unknown[] = [],
  { start = "top top", end = "bottom bottom" }: { start?: string; end?: string } = {},
) {
  const builder = useRef(build);
  builder.current = build;
  useGSAP(
    () => {
      const el = section.current;
      if (!el) return;
      const tl = gsap.timeline({ paused: true, defaults: { ease: "none" } });
      builder.current(tl);
      ScrollTrigger.create({
        trigger: el,
        start,
        end,
        scrub: 0.4,
        animation: tl,
        invalidateOnRefresh: true,
      });
    },
    { scope: section, dependencies: deps },
  );
}

/**
 * Words rising into place at a point in the chapter. Both ends are explicit,
 * so a rebuild mid-scroll can never record a hidden state as the destination.
 */
export function reveal(tl: gsap.core.Timeline, targets: gsap.TweenTarget, at: number, { duration = 0.16, stagger = 0.035, y = 36 } = {}) {
  // Staggered members only render their start when their own tween begins; hide them all now.
  gsap.set(targets, { y, opacity: 0 });
  tl.fromTo(targets, { y, opacity: 0 }, { y: 0, opacity: 1, duration, stagger, ease: "power2.out", immediateRender: false }, at);
}

/** How tall a chapter is, in viewports, for a given scroll length. */
export const chapterHeight = (viewports: number) => ({ height: `${viewports * 100}vh` });
