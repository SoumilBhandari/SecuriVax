import { useEffect, useRef, type CSSProperties } from "react";
import { Link } from "react-router";

import { VerdictBadge } from "../components/Brand";
import { ChevronDownIcon } from "../components/Icons";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { useLive } from "../lib/useLive";
import { useWide } from "../lib/useWide";
import type { BoxSummary } from "../types";
import type { Anchor } from "./placeholders";
import { Sequence, type Extra, type SequenceHandle } from "./Sequence";
import { chapterHeight, reveal, useChapter } from "./useChapter";

/**
 * The front door: the question over a lit carrier on black, with the live
 * signal floating beside it. On load the lines rise out of a mask and the
 * scene fades up; while the reader rests, the carrier sways and bobs.
 * Scrolling lifts the lid, then the carrier settles back and up as what
 * SecuriVax does, and the way in, rise from the bottom.
 */
export function Hero({ line, spotlight }: { line: string | null; spotlight: BoxSummary | null }) {
  const section = useRef<HTMLElement>(null);
  const seq = useRef<SequenceHandle>(null);
  const scene = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const start: Anchor = wide ? { ax: 0.5, ay: 0.68, scale: 0.68 } : { ax: 0.5, ay: 0.66, scale: 0.6 };
  // Where it ends up once the words are in: higher and smaller, above them.
  const end: Anchor = wide ? { ax: 0.5, ay: 0.17, scale: 0.34 } : { ax: 0.5, ay: 0.15, scale: 0.28 };
  const state = useRef<{ p: number; at: Anchor; extra: Extra }>({ p: 0, at: start, extra: {} });
  const live = useLive();
  const last = live.readings[live.readings.length - 1];

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
      if (chips.current) tl.fromTo(chips.current, { opacity: 1, y: 0 }, { opacity: 0, y: -40, duration: 0.14, ease: "power2.in", immediateRender: false }, 0.06);
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

  const bandWord = last ? (last.band === "ok" ? "in range" : last.band === "warm" ? "too warm" : last.band === "cold" ? "cold" : "freezing") : "";
  const place = last ? last.label.replace(/^(truck cold box|vaccine carrier|demo carrier|backup node|cold box)\s*/i, "").replace(/\s*\(.*$/, "") : "";

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

        {/* The live signal, floating beside the carrier: the newest reading anywhere, and one box's verdict. */}
        <div ref={chips} className="pointer-events-none absolute inset-0" aria-hidden="true">
          {last && (
            <div className="hero-chip-slot left-4 top-[46%] lg:left-[17%] lg:top-[54%]">
              <div className="rise-in" style={{ "--i": 2 } as CSSProperties}>
                <div className="hero-chip">
                  <span className="hero-chip__dot" />
                  <span className="hero-chip__num">{last.temp_c.toFixed(1)} °C</span>
                  <span className="hero-chip__muted hidden sm:inline">
                    {place} · {bandWord}
                  </span>
                  <span className="hero-chip__muted sm:hidden">{bandWord}</span>
                </div>
              </div>
            </div>
          )}
          {spotlight && (
            <div className="hero-chip-slot right-4 top-[80%] lg:right-[17%] lg:top-[66%]">
              <div className="rise-in" style={{ "--i": 5 } as CSSProperties}>
                <div className="hero-chip" style={{ animationDelay: "-3.2s" }}>
                  <span className="hero-chip__muted">{spotlight.id}</span>
                  <VerdictBadge verdict={spotlight.verdict} />
                </div>
              </div>
            </div>
          )}
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
