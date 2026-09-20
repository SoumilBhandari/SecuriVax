import { useRef, type RefObject } from "react";

import { gsap, prefersReducedMotion, ScrollTrigger, useGSAP } from "../lib/motion";

/**
 * A chapter is a tall section whose inner viewport sticks while the reader
 * scrolls through it. This wires a paused timeline to that scroll: the
 * timeline's 0 to 1 is the section's top reaching the viewport's top to its
 * bottom reaching the viewport's bottom. `build` adds the tweens; a light
 * smoothing follows the wheel without lagging it, and the moment the scroll
 * leaves the chapter the timeline is settled on that end, so a fast flick can
 * never leave a chapter half played. Rebuilt when `deps` change (data
 * arriving), with the previous build fully reverted first. An unpinned section
 * can pass its own `start` and `end`.
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
      // Past either end there is nothing left to smooth: finish the catch-up
      // at once so the chapter reads as its first or last frame, never as
      // something in between.
      const settle = (self: ScrollTrigger) => {
        self.getTween()?.progress(1);
      };
      ScrollTrigger.create({
        trigger: el,
        start,
        end,
        scrub: 0.4,
        animation: tl,
        invalidateOnRefresh: true,
        fastScrollEnd: true,
        onLeave: settle,
        onLeaveBack: settle,
      });
    },
    // revertOnUpdate: without it a rebuild leaves the old timeline and its
    // scroll trigger alive, and two of them then drive the same words and the
    // same object to different frames.
    { scope: section, dependencies: deps, revertOnUpdate: true },
  );
}

/**
 * Words rising into place at a point in the chapter. Both ends are explicit,
 * so a rebuild mid-scroll can never record a hidden state as the destination.
 */
export function reveal(tl: gsap.core.Timeline, targets: gsap.TweenTarget, at: number, { duration = 0.16, stagger = 0.035, y = 36 } = {}) {
  // A reader who asked for less motion still has to be able to read the words.
  // Hiding them and rising them in is the one step here that can leave copy
  // invisible if the tween never runs, so for them it simply does not happen.
  if (prefersReducedMotion()) {
    gsap.set(targets, { y: 0, opacity: 1 });
    return;
  }
  // Staggered members only render their start when their own tween begins; hide them all now.
  gsap.set(targets, { y, opacity: 0 });
  tl.fromTo(targets, { y, opacity: 0 }, { y: 0, opacity: 1, duration, stagger, ease: "power2.out", immediateRender: false }, at);
}

/** How tall a chapter is, in viewports, for a given scroll length. */
export const chapterHeight = (viewports: number) => ({ height: `${viewports * 100}vh` });
