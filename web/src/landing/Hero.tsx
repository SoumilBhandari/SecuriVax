import { useEffect, useRef } from "react";
import { Link } from "react-router";

import { ChevronDownIcon } from "../components/Icons";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { useWide } from "../lib/useWide";
import type { Anchor } from "./placeholders";
import { Sequence, type Extra, type SequenceHandle } from "./Sequence";
import { chapterHeight, reveal, useChapter } from "./useChapter";

/**
 * The front door: the question over a lit carrier on black, and nothing else.
 * On load the lines rise out of a mask and the scene fades up; while the
 * reader rests, the carrier sways and bobs.
 * Scrolling lifts the lid, then the carrier settles back and up as what
 * SecuriVax does, and the way in, rise from the bottom.
 */
export function Hero({ line }: { line: string | null }) {
  const section = useRef<HTMLElement>(null);
  const seq = useRef<SequenceHandle>(null);
  const scene = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const start: Anchor = wide ? { ax: 0.5, ay: 0.7, scale: 0.95 } : { ax: 0.5, ay: 0.68, scale: 0.8 };
  const end: Anchor = wide ? { ax: 0.5, ay: 0.4, scale: 0.56 } : { ax: 0.5, ay: 0.36, scale: 0.46 };
  const state = useRef<{ p: number; at: Anchor; extra: Extra }>({ p: 0, at: start, extra: {} });

  useChapter(
    section,
    (tl) => {
      const o = { p: 0, ...start };
      const paint = () => {
        state.current.p = o.p;
        state.current.at = { ax: o.ax, ay: o.ay, scale: o.scale };
        seq.current?.draw(o.p, state.current.at, state.current.extra);
      };
      tl.to(o, { p: 1, duration: 0.72, onUpdate: paint }, 0.1);
      tl.to(o, { ...end, duration: 0.3, ease: "power2.inOut", onUpdate: paint }, 0.5);
      if (hint.current) tl.fromTo(hint.current, { opacity: 1 }, { opacity: 0, duration: 0.08, immediateRender: false }, 0);
      if (head.current) tl.fromTo(head.current, { opacity: 1, y: 0 }, { opacity: 0, y: -48, duration: 0.22, ease: "power2.in", immediateRender: false }, 0.26);
      if (after.current) reveal(tl, after.current.children, 0.6, { duration: 0.2, stagger: 0.05, y: 40 });
    },
    [wide, line],
  );

  // The entrance, once: the scene fades up, the lines rise out of their mask, the hint follows.
  useGSAP(
    () => {
      const el = section.current;
      if (!el || prefersReducedMotion()) return;
      const tl = gsap.timeline({ defaults: { ease: EASE.out } });
      if (scene.current) tl.from(scene.current, { opacity: 0, scale: 0.94, duration: 1.8, ease: "power3.out" }, 0);
      tl.from(el.querySelector(".hero-eyebrow"), { opacity: 0, y: 12, duration: 0.9 }, 0.25);
      tl.from(el.querySelectorAll(".hero-line > span"), { yPercent: 110, duration: 1.2, ease: "power4.out", stagger: 0.12 }, 0.3);
      if (hint.current) tl.from(hint.current, { opacity: 0, duration: 0.8 }, 1.5);
    },
    { scope: section },
  );

  // At rest the carrier sways and bobs a little; the motion dies out as the reader scrolls.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let lastT = 0;
    const tick = (time: number) => {
      if (time - lastT < 1 / 30) return;
      lastT = time;
      const el = section.current;
      if (!el || document.hidden) return;
      if (el.getBoundingClientRect().bottom < 0) return;
      const { p, at } = state.current;
      const k = Math.max(0, 1 - p * 4);
      if (k <= 0) {
        if (state.current.extra.spin) {
          state.current.extra = {};
          seq.current?.draw(p, at, {});
        }
        return;
      }
      state.current.extra = { spin: Math.sin(time * 0.35) * 0.09 * k, bob: (Math.sin(time * 0.8) * 0.01 + 0.01) * k };
      seq.current?.draw(p, at, state.current.extra);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  return (
    <section ref={section} data-theme="dark" className="chapter" style={chapterHeight(3)} aria-label="SecuriVax">
      <div className="chapter__view">
        <div ref={scene} className="absolute inset-0">
          <div className="hero-glow" aria-hidden="true" />
          <Sequence ref={seq} id="A" ground="dark" at={start} className="absolute inset-0" />
        </div>

        <div ref={head} className="absolute inset-x-0 top-[calc(var(--nav-h)+9vh)] px-6 text-center lg:top-[calc(var(--nav-h)+10vh)]">
          <p className="eyebrow hero-eyebrow m-0">Vaccine cold chain · HopHacks 2026</p>
          <h1 className="ui-display m-0 mt-4">
            <span className="hero-line">
              <span>Is this vaccine</span>
            </span>
            <span className="hero-line">
              <span>still good?</span>
            </span>
          </h1>
        </div>

        <div
          ref={after}
          className="absolute inset-x-0 bottom-[max(8vh,calc(env(safe-area-inset-bottom,0px)+40px))] mx-auto max-w-2xl px-6 text-center lg:bottom-[10vh]"
        >
          <p className="ui-title-3 m-0 text-balance lg:text-[34px] lg:leading-[40px]">
            SecuriVax follows each box from the depot to the clinic and turns its temperature history into one call a health worker can act
            on: use it, hold it, or throw it away.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/boxes" viewTransition className="pill-btn pill-btn--solid">
              Open the app
            </Link>
            <Link to="/live" viewTransition className="pill-btn">
              Watch it live
            </Link>
          </div>
          <p className="eyebrow m-0 mt-8">{line ?? " "}</p>
        </div>

        <div ref={hint} className="hero-hint" aria-hidden="true">
          <ChevronDownIcon size={18} />
        </div>
      </div>
    </section>
  );
}
