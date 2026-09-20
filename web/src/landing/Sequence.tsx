import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from "react";

import { framesFor, type Crop, type Frames } from "./frames";
import { CENTRED, PLACEHOLDERS, type Anchor, type Ground } from "./placeholders";
import type { ObjectViewHandle } from "./three/ObjectView";

// Three.js and the models load only when a chapter is near the screen.
const ObjectView = lazy(() => import("./three/ObjectView").then((m) => ({ default: m.ObjectView })));

/** Idle motion on top of the scroll: a sway of the camera and a bob of the object, both small. */
export interface Extra {
  spin?: number;
  bob?: number;
}

export interface SequenceHandle {
  /** Show the frame for a progress in [0, 1], optionally moving the object. Cheap to call on every scroll tick. */
  draw(progress: number, at?: Anchor, extra?: Extra): void;
}

type Mode = "frames" | "live" | "drawn";

function webglWorks(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * One chapter's picture, driven by scroll progress. Three ways to draw it,
 * in order of preference: the render's frame sequence if it exists
 * (/hero/manifest.json), the models rendered live in WebGL, or a flat
 * drawing on a 2D canvas. The parent drives it through the handle.
 */
export const Sequence = forwardRef<SequenceHandle, { id: string; ground: Ground; at?: Anchor; className?: string }>(function Sequence(
  { id, ground, at = CENTRED, className = "" },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const frames = useRef<Frames | null>(null);
  const live = useRef<ObjectViewHandle>(null);
  const state = useRef({ p: 0, at });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const [mode, setMode] = useState<Mode>("drawn");
  const [near, setNear] = useState(false);

  // Only when it really changes: once a chapter's scroll is driving the
  // anchor, a parent that re-renders (a live reading arriving, say) must not
  // reset the object to where it started.
  useEffect(() => {
    const now = state.current.at;
    if (now.ax !== at.ax || now.ay !== at.ay || now.scale !== at.scale) state.current.at = at;
  }, [at]);

  const paint2d = () => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const { w, h, dpr } = size.current;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { p, at } = state.current;
    if (at.scale <= 0) {
      ctx.fillStyle = ground === "dark" ? "#000000" : "#ffffff";
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const img = frames.current?.at(p);
    if (img) {
      ctx.fillStyle = ground === "dark" ? "#000000" : "#ffffff";
      ctx.fillRect(0, 0, w, h);
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * at.scale;
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, w * at.ax - dw / 2, h * at.ay - dh / 2, dw, dh);
    } else {
      PLACEHOLDERS[id]?.(ctx, w, h, p, ground, at);
    }
  };

  useImperativeHandle(ref, () => ({
    draw(p: number, where?: Anchor, extra?: Extra) {
      state.current.p = p;
      if (where) state.current.at = where;
      if (mode === "live") live.current?.set(p, state.current.at, extra);
      else paint2d();
    },
  }));

  // Which way to draw: the render if there is one, else live if the browser can.
  useEffect(() => {
    let alive = true;
    const crop: Crop = window.innerHeight > window.innerWidth ? "portrait" : "landscape";
    framesFor(id, crop).then((f) => {
      if (!alive) return;
      if (f) {
        frames.current = f;
        setMode("frames");
        f.start(() => alive && paint2d());
      } else {
        setMode(webglWorks() ? "live" : "drawn");
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Mount the live renderer when the chapter first comes within a screen of
  // the viewport, and keep it: tearing a WebGL context down and building it
  // again costs a few hundred milliseconds, which lands as a stall in the
  // middle of the scroll it was meant to save.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "100% 0px 100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Size the 2D canvas to its box at device resolution.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: rect.width, h: rect.height, dpr };
      el.width = Math.round(rect.width * dpr);
      el.height = Math.round(rect.height * dpr);
      paint2d();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ground, mode]);

  const showLive = mode === "live" && near && state.current.at.scale > 0;
  return (
    <div ref={box} className={className} aria-hidden="true">
      <canvas ref={canvas} className="absolute inset-0 block h-full w-full" style={{ opacity: mode === "live" ? 0 : 1 }} />
      {showLive && (
        <Suspense fallback={null}>
          <ObjectView
            ref={(h) => {
              live.current = h;
              h?.set(state.current.p, state.current.at);
            }}
            id={id}
            ground={ground}
            initial={state.current.at}
          />
        </Suspense>
      )}
    </div>
  );
});
