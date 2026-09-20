import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from "react";

import { ErrorBoundary } from "../components/ErrorBoundary";

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
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    state.current.at = at;
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
      if (showLive) live.current?.set(p, state.current.at, extra);
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
  }, [id, ground, mode, failed, ready]);

  // WebGL can fail after it has been proved to work: a driver that gives up on
  // a big glTF, a context lost under memory pressure. The flat drawing is
  // already painted underneath, so a failure here uncovers it rather than
  // taking the chapter — and with it the whole landing page — down.
  const live3d = mode === "live" && near && !failed && state.current.at.scale > 0;

  // A context that never arrives. The renderer is built in a promise, so a
  // failure there reaches no error boundary and the chapter would stay blank
  // with nothing reported; if no frame has been made by now, show the drawing.
  useEffect(() => {
    if (!live3d || ready) return;
    const t = setTimeout(() => setFailed(true), 6000);
    return () => clearTimeout(t);
  }, [live3d, ready]);

  // The flat drawing shows until the live view proves it has a context.
  const showLive = live3d && ready;
  return (
    <div ref={box} className={className} aria-hidden="true">
      <canvas ref={canvas} className="absolute inset-0 block h-full w-full" style={{ opacity: showLive ? 0 : 1 }} />
      {live3d && (
        <ErrorBoundary fallback={null} onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <ObjectView
              ref={(h) => {
                live.current = h;
                h?.set(state.current.p, state.current.at);
              }}
              id={id}
              ground={ground}
              initial={state.current.at}
              onReady={() => setReady(true)}
              onLost={() => setFailed(true)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
});
