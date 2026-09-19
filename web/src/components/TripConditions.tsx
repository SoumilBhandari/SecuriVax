import { useEffect, useMemo, useRef, useState } from "react";

import { useCanTapTags } from "../lib/device";
import { embedTrip, type TripCloud, type TripGroup } from "../lib/embed";
import { time } from "../lib/format";
import type { Report } from "../types";
import { SectionTitle } from "./Layout";

/**
 * The trip as a picture: every reading is a dot, readings from similar
 * conditions sit together, and each group says in numbers what it was and
 * what it cost. Nothing here is written by a model.
 */
export function TripConditions({ report }: { report: Report }) {
  // Re-group only when new readings arrive, not on every poll.
  const key = `${report.box.id}:${report.data_through}:${report.segments.length}`;
  const cloud = useMemo(() => embedTrip(report), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [focus, setFocus] = useState<number | null>(null);

  if (!cloud) {
    return (
      <>
        <SectionTitle>Trip conditions</SectionTitle>
        <p className="ui-caption m-0">Too few readings on this trip to group yet.</p>
      </>
    );
  }
  return (
    <>
      <SectionTitle aside={`${cloud.points.length} readings · ${cloud.groups.length} ${cloud.groups.length === 1 ? "group" : "groups"}`}>Trip conditions</SectionTitle>
      <Viewer cloud={cloud} focus={focus} />
      <div className="mt-3 flex flex-col gap-3">
        {cloud.groups.map((g) => (
          <GroupCard key={g.id} group={g} cloud={cloud} active={focus === g.id} dim={focus != null && focus !== g.id} onClick={() => setFocus(focus === g.id ? null : g.id)} />
        ))}
      </div>
      <p className="ui-caption m-0 mt-3">
        Each dot is one reading, placed by what the box was going through: the temperature inside and outside, humidity, how
        fast it was changing, and whether it was on the move. Similar readings sit together, and the groups are found from those
        numbers alone. Tap a group to pick out its dots.
      </p>
    </>
  );
}

// ---- The rotating cloud (canvas, no library).

interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
}
const HOME: Camera = { yaw: 0.7, pitch: -0.35, zoom: 1, panX: 0, panY: 0 };

function Viewer({ cloud, focus }: { cloud: TripCloud; focus: number | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ ...HOME });
  const spinning = useRef(!prefersReducedMotion());
  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null);
  const screen = useRef<{ x: number; y: number; z: number }[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null);
  const canTap = useCanTapTags();

  const groupOf = useMemo(() => {
    const out = new Array<TripGroup>(cloud.points.length);
    for (const g of cloud.groups) for (const i of g.members) out[i] = g;
    return out;
  }, [cloud]);

  // Everything the draw needs, read fresh each frame.
  const state = useRef({ cloud, focus, groupOf, hover: null as number | null });
  state.current = { cloud, focus, groupOf, hover: tip?.i ?? null };

  const draw = () => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const { cloud: c, focus: f, groupOf: gOf, hover } = state.current;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(el);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;

    // A soft pool of light behind the cloud.
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
    glow.addColorStop(0, token("--quiet", "#f5f8fa"));
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const pts = c.xyz.map((p) => project(p, cam.current, w, h));
    screen.current = pts;
    const order = pts.map((_, i) => i).sort((a, b) => pts[a].z - pts[b].z);
    for (const i of order) {
      const p = pts[i];
      const g = gOf[i];
      const depth = (p.z + 1.8) / 3.6; // 0 at the back, 1 at the front
      ctx.globalAlpha = f == null ? 0.35 + 0.55 * depth : g.id === f ? 0.95 : 0.07;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.6, 3.1 * p.f), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (hover != null && pts[hover]) {
      ctx.strokeStyle = token("--text", "#0b2545");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pts[hover].x, pts[hover].y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // "GROUP n" tags at each group's centre, like the points they name.
    ctx.font = "600 11px 'DM Sans', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const g of c.groups) {
      if (f != null && g.id !== f) continue;
      const p = project(g.centre, cam.current, w, h);
      const label = `GROUP ${g.id}`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 30;
      const x = p.x - bw / 2;
      const y = p.y - 13;
      ctx.fillStyle = token("--surface", "#ffffff");
      ctx.strokeStyle = token("--line", "#d5dde5");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, 26, 13);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(x + 12, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = token("--text", "#0b2545");
      ctx.fillText(label, x + 21, p.y + 0.5);
    }
  };

  // Redraw when the data, the focus or the hover changes; keep drawing while it spins.
  useEffect(draw);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let frame = 0;
    let visible = true;
    const tick = () => {
      if (spinning.current && visible) {
        cam.current.yaw += 0.0025;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const seen = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    seen.observe(el);
    const sized = new ResizeObserver(() => draw());
    sized.observe(el);
    // Zoom with a pinch or ⌘/Ctrl + scroll, so plain scrolling still moves the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      spinning.current = false;
      cam.current.zoom = clamp(cam.current.zoom * Math.exp(-e.deltaY * 0.004), 0.5, 5);
      draw();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      sized.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (x: number, y: number): number | null => {
    let best: number | null = null;
    let bestD = 12 * 12;
    screen.current.forEach((p, i) => {
      if (focus != null && groupOf[i].id !== focus) return;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    });
    return best;
  };

  const zoomBy = (factor: number) => {
    spinning.current = false;
    cam.current.zoom = clamp(cam.current.zoom * factor, 0.5, 5);
    draw();
  };

  const p = tip ? cloud.points[tip.i] : null;
  return (
    <div className="relative h-[320px] overflow-hidden rounded-2xl border border-line bg-surface lg:h-[400px]">
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: "pan-y" }}
        role="img"
        aria-label={`${cloud.points.length} readings in ${cloud.groups.length} groups: ${cloud.groups.map((g) => `group ${g.id}, ${g.name}, ${g.members.length} readings`).join("; ")}`}
        onPointerDown={(e) => {
          spinning.current = false;
          drag.current = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button !== 0 };
          e.currentTarget.setPointerCapture(e.pointerId);
          setTip(null);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            drag.current = { ...d, x: e.clientX, y: e.clientY };
            if (d.pan) {
              cam.current.panX += dx;
              cam.current.panY += dy;
            } else {
              cam.current.yaw += dx * 0.01;
              cam.current.pitch = clamp(cam.current.pitch + dy * 0.01, -1.45, 1.45);
            }
            draw();
            return;
          }
          if (e.pointerType !== "mouse") return;
          const r = e.currentTarget.getBoundingClientRect();
          const i = pick(e.clientX - r.left, e.clientY - r.top);
          setTip(i == null ? null : { x: e.clientX - r.left, y: e.clientY - r.top, i });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => setTip(null)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <p className="pointer-events-none absolute left-4 top-3 m-0 font-mono text-[11px] uppercase tracking-[0.08em] text-neutral-500">
        {canTap ? "Swipe sideways to rotate" : "Drag to rotate · Shift+drag to pan"}
      </p>
      <div className="absolute bottom-3 left-3 flex gap-2">
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in" className="pill !min-h-9 !min-w-9 bg-surface">
          +
        </button>
        <button onClick={() => zoomBy(0.8)} aria-label="Zoom out" className="pill !min-h-9 !min-w-9 bg-surface">
          −
        </button>
        <button
          onClick={() => {
            cam.current = { ...HOME };
            spinning.current = !prefersReducedMotion();
            draw();
          }}
          className="pill !min-h-9 bg-surface font-mono text-[11px] uppercase tracking-[0.08em]"
        >
          Reset
        </button>
      </div>
      {p && tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-xl border border-line bg-surface px-3 py-2 text-[13px] leading-5 shadow-sm"
          style={{ left: Math.min(tip.x + 14, 9999), top: tip.y + 14 }}
        >
          <span className="font-bold">{time(p.ts, p.tz)}</span> · {p.temp.toFixed(1)} °C inside
          {p.outside != null && <>, {p.outside.toFixed(0)} °C outside</>}
          {p.rh != null && <>, {Math.round(p.rh)}% RH</>}
          <br />
          <span className="text-neutral-500">
            {p.node} · group {groupOf[tip.i].id}
          </span>
        </div>
      )}
    </div>
  );
}

function project(p: [number, number, number], cam: Camera, w: number, h: number) {
  const [x, y, z] = p;
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const f = 3 / (3 - z2); // a little perspective: nearer dots are bigger
  const s = Math.min(w, h) * 0.4 * cam.zoom;
  return { x: w / 2 + cam.panX + x1 * f * s, y: h / 2 + cam.panY - y2 * f * s, z: z2, f };
}

// ---- One card per group: what it was, for how long, and what it cost.

function GroupCard({ group: g, cloud, active, dim, onClick }: { group: TripGroup; cloud: TripCloud; active: boolean; dim: boolean; onClick: () => void }) {
  const harm: string[] = [];
  if (g.freezeMin > 0) harm.push(`${duration(g.freezeMin)} at or below ${cloud.freezeLine.toFixed(1)} °C: freeze-exposed`);
  if (g.heatMin > 0) harm.push(`${duration(g.heatMin)} above the range`);
  if (g.budgetShare != null) harm.push(`${Math.round(g.budgetShare * 100)}% of this trip's budget use`);
  const legs = g.legs.length > 2 ? `${g.legs.slice(0, 2).join(", ")} and ${g.legs.length - 2} more` : g.legs.join(", ");
  const when = g.stretches === 1 ? `${time(g.first, g.tz)} to ${time(g.last, g.tz)}` : `${g.stretches} stretches from ${time(g.first, g.tz)} to ${time(g.last, g.tz)}`;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="panel w-full p-4 text-left transition-opacity"
      style={{ opacity: dim ? 0.5 : 1, borderColor: active ? g.color : undefined, boxShadow: active ? `inset 3px 0 0 ${g.color}` : undefined }}
    >
      <span className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.color }} />
        <span className="font-display font-semibold tracking-[-0.01em]">Group {g.id}</span>
        <span className="font-mono text-xs text-neutral-500">{g.members.length} readings</span>
      </span>
      <span className="ui-heading mt-1 block">{g.name}</span>
      <span className="mt-1 block text-[15px]">
        {duration(g.minutes)} ({Math.round(g.share * 100)}% of the trip) · {g.meanTemp.toFixed(1)} °C inside ({g.minTemp.toFixed(1)} to {g.maxTemp.toFixed(1)})
        {g.meanOutside != null && ` · ${g.meanOutside.toFixed(0)} °C outside`}
        {g.meanRh != null && ` · ${Math.round(g.meanRh)}% RH`}
      </span>
      <span className="mt-1 block text-[15px] font-semibold">{harm.length ? harm.join(" · ") : "Nothing out of range, and the budget barely moved"}</span>
      <span className="ui-caption mt-1 block">
        {when} · {legs}
      </span>
      <span className="ui-caption mt-2 block">
        Examples:{" "}
        {g.examples
          .map((i) => cloud.points[i])
          .map((p) => `${time(p.ts, p.tz)}, ${p.temp.toFixed(1)} °C${p.outside != null ? ` (${p.outside.toFixed(0)} °C outside)` : ""}`)
          .join(" · ")}
      </span>
    </button>
  );
}

function duration(min: number): string {
  if (min < 90) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(min < 600 ? 1 : 0)} h`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
