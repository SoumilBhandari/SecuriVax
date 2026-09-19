import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { EASE, gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { XIcon } from "./Icons";

/**
 * A panel that rises over the page (the camera, a confirmation). On a phone it
 * comes up from the bottom with a spring and can be dragged back down; on a
 * laptop it scales in at the centre. Escape and the scrim close it.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y0: number; t0: number } | null>(null);

  const phone = () => !window.matchMedia("(min-width: 1024px)").matches;

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const p = panel.current;
    const s = scrim.current;
    if (!p || !s || prefersReducedMotion()) {
      onClose();
      return;
    }
    gsap.to(s, { opacity: 0, duration: 0.25, ease: "power1.out" });
    gsap.to(p, {
      ...(phone() ? { y: "110%" } : { scale: 0.96, y: 12, opacity: 0 }),
      duration: 0.32,
      ease: "power2.in",
      onComplete: onClose,
    });
  }, [closing, onClose]);

  useGSAP(
    () => {
      const p = panel.current;
      const s = scrim.current;
      if (!p || !s || prefersReducedMotion()) return;
      gsap.from(s, { opacity: 0, duration: 0.35, ease: "power1.out" });
      gsap.from(p, phone() ? { y: "100%", duration: 0.6, ease: EASE.out } : { scale: 0.96, y: 14, opacity: 0, duration: 0.45, ease: EASE.out });
    },
    { scope: root },
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [close]);

  // The grab handle: follow the finger, then either let go or spring back.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!phone()) return;
    drag.current = { y0: e.clientY, t0: performance.now() };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y0);
    gsap.set(panel.current, { y: dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const dy = e.clientY - drag.current.y0;
    const v = dy / Math.max(1, performance.now() - drag.current.t0); // px per ms
    drag.current = null;
    if (dy > 120 || v > 0.6) close();
    else gsap.to(panel.current, { y: 0, duration: 0.5, ease: EASE.out });
  };

  return (
    <div ref={root} className="fixed inset-0 z-[1300] flex items-end justify-center lg:items-center lg:p-8" role="presentation">
      <div ref={scrim} className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={close} />
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="scroll-quiet relative max-h-[92dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-surface px-5 pt-2 shadow-float lg:max-w-lg lg:rounded-[28px] lg:px-7 lg:pt-6"
        style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div
          className="mx-auto mb-3 h-5 w-full cursor-grab touch-none lg:hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden="true"
        >
          <span className="mx-auto mt-2 block h-[5px] w-9 rounded-full" style={{ background: "var(--border-strong)", opacity: 0.6 }} />
        </div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="ui-heading m-0">{title}</h2>
          <button onClick={close} aria-label="Close" className="back-btn">
            <XIcon size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
