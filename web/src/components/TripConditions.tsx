import { useEffect, useMemo, useRef, useState } from "react";

import { useCanTapTags } from "../lib/device";
import { embedTrip, scale, type TripAxis, type TripCloud, type TripGroup } from "../lib/embed";
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
        Each dot is one reading: across is the temperature inside the box, up is the temperature outside, and back is when on
        the trip it was taken. Colours are groups of readings taken in similar conditions. Tap a group to pick out its dots.
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
// A little from above and the left: across and up face you, time recedes to the upper right.
const HOME: Camera = { yaw: -0.36, pitch: 0.32, zoom: 1, panX: 0, panY: 0 };

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
    const frame = fitFrame(w, h);
    const at = (x: number, y: number, z: number) => project([x, y, z], cam.current, frame);
    const line = (a: [number, number, number], b: [number, number, number]) => {
      const p = at(...a);
      const q = at(...b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    };
    const [ax, ay, az] = c.axes;
    const zOf = (t: number) => -scale(az, t); // time runs back: hour 0 at the front
    const muted = token("--text-muted", "#5b6b7b");
    const hair = token("--border", "#e4ecf1");
    const mono = "500 10px 'Geist Mono', ui-monospace, monospace";

    // The floor (the bottom of the box of axes): a grid, the product's safe
    // range shaded, and the freeze line.
    ctx.lineWidth = 1;
    ctx.strokeStyle = hair;
    for (const t of ax.ticks) line([scale(ax, t), -1, -1], [scale(ax, t), -1, 1]);
    for (const t of az.ticks) line([-1, -1, zOf(t)], [1, -1, zOf(t)]);
    const lo = Math.max(-1, scale(ax, c.safe[0]));
    const hi = Math.min(1, scale(ax, c.safe[1]));
    if (hi > lo) {
      const corners = [at(lo, -1, -1), at(hi, -1, -1), at(hi, -1, 1), at(lo, -1, 1)];
      ctx.fillStyle = token("--band", "#e3f8f6");
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      const mid = at((lo + hi) / 2, -1, -1);
      ctx.font = mono;
      ctx.fillStyle = token("--text-accent", "#0b7a73");
      ctx.textAlign = "center";
      ctx.fillText(`SAFE ${c.safe[0]}–${c.safe[1]} °C`, mid.x, mid.y - 8);
    }
    if (c.freezeSensitive && c.freezeLine >= ax.min && c.freezeLine <= ax.max) {
      const fx = scale(ax, c.freezeLine);
      ctx.strokeStyle = "#7c3aed";
      ctx.setLineDash([4, 4]);
      line([fx, -1, -1], [fx, -1, 1]);
      ctx.setLineDash([]);
      const top = at(fx, -1, -1);
      ctx.font = mono;
      ctx.fillStyle = "#7c3aed";
      ctx.textAlign = "center";
      ctx.fillText("FREEZE", top.x, top.y - 8);
    }

    // Three axes from the near bottom corner, with round ticks and a title each.
    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.7;
    line([-1, -1, 1], [1, -1, 1]);
    if (ay.ticks.length) line([-1, -1, 1], [-1, 1, 1]);
    line([-1, -1, 1], [-1, -1, -1]);
    ctx.globalAlpha = 1;
    ctx.font = mono;
    ctx.fillStyle = muted;
    const tickLabel = (t: number) => `${Number.isInteger(t) ? t : t.toFixed(1)}`;
    ctx.textAlign = "center";
    for (const t of ax.ticks) {
      const p = at(scale(ax, t), -1, 1);
      ctx.fillText(tickLabel(t), p.x, p.y + 14);
    }
    ctx.textAlign = "right";
    for (const t of ay.ticks) {
      const p = at(-1, scale(ay, t), 1);
      ctx.fillText(tickLabel(t), p.x - 6, p.y + 3);
    }
    for (const t of az.ticks) {
      const p = at(-1, -1, zOf(t));
      ctx.fillText(tickLabel(t), p.x - 6, p.y + 12);
    }
    ctx.font = "600 10px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = token("--text", "#0b2545");
    const title = (a: TripAxis, x: number, y: number, z: number, dx: number, dy: number, align: CanvasTextAlign) => {
      if (!a.title) return;
      const p = at(x, y, z);
      ctx.textAlign = align;
      ctx.fillText(`${a.title.toUpperCase()} ${a.unit}`, p.x + dx, p.y + dy);
    };
    title(ax, 1, -1, 1, 0, 30, "right");
    title(ay, -1, 1, 1, 0, -10, "center");
    title(az, -1, -1, -1, 0, -10, "center");

    // The readings, back to front.
    const pts = c.xyz.map((p) => project(p, cam.current, frame));
    screen.current = pts;
    const order = pts.map((_, i) => i).sort((a, b) => pts[a].z - pts[b].z);
    for (const i of order) {
      const p = pts[i];
      const g = gOf[i];
      const depth = (p.z + 1.8) / 3.6; // 0 at the back, 1 at the front
      ctx.globalAlpha = f == null ? 0.45 + 0.5 * depth : g.id === f ? 0.95 : 0.07;
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

    // A small numbered marker at each group's centre (the cards below name
    // them); markers that would overlap step aside.
    ctx.font = "600 9px 'Geist Mono', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const R = 8;
    const placed: { x: number; y: number }[] = [];
    const marks = c.groups
      .filter((g) => f == null || g.id === f)
      .map((g) => ({ g, p: project(g.centre, cam.current, frame) }))
      .sort((a, b) => a.p.y - b.p.y);
    for (const { g, p } of marks) {
      const x = p.x;
      let y = p.y;
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((o) => Math.hypot(o.x - x, o.y - y) < 2 * R + 3);
        if (!hit) break;
        y = hit.y + 2 * R + 3;
      }
      placed.push({ x, y });
      ctx.fillStyle = g.color;
      ctx.strokeStyle = token("--surface", "#ffffff");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(g.id), x, y + 0.5);
    }
    ctx.textBaseline = "alphabetic";
  };

  // Redraw when the data, the focus or the hover changes; keep drawing while it spins.
  useEffect(draw);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let frame = 0;
    let visible = true;
    let swayT = 0;
    const tick = () => {
      if (spinning.current && visible) {
        swayT += 1 / 60;
        cam.current.yaw = HOME.yaw + 0.22 * Math.sin(swayT * 0.35);
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
    <div className="relative h-[340px] overflow-hidden rounded-2xl border border-line bg-surface lg:h-[440px]">
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
      <div className="absolute right-3 top-3 flex gap-2">
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

/** Rotate a point by the camera and add a little perspective (nearer is bigger). */
function turn([x, y, z]: [number, number, number], yaw: number, pitch: number) {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  const f = 3 / (3 - z2);
  return { x: x1 * f, y: y2 * f, z: z2, f };
}

interface Frame {
  s: number; // pixels per unit
  midX: number; // centre of the box of axes, in turned units
  midY: number;
  cx: number; // where that centre sits on the canvas
  cy: number;
}

// Room around the box of axes for tick labels, titles and the controls.
const PAD = { l: 52, r: 30, t: 64, b: 46 };

/** Fit the whole box of axes (seen from the home angle) inside the canvas. */
function fitFrame(w: number, h: number): Frame {
  const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => turn([x, y, z], HOME.yaw, HOME.pitch))));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.max(10, Math.min((w - PAD.l - PAD.r) / (maxX - minX), (h - PAD.t - PAD.b) / (maxY - minY)));
  return { s, midX: (minX + maxX) / 2, midY: (minY + maxY) / 2, cx: PAD.l + (w - PAD.l - PAD.r) / 2, cy: PAD.t + (h - PAD.t - PAD.b) / 2 };
}

function project(p: [number, number, number], cam: Camera, frame: Frame) {
  const t = turn(p, cam.yaw, cam.pitch);
  const k = frame.s * cam.zoom;
  return { x: frame.cx + cam.panX + (t.x - frame.midX) * k, y: frame.cy + cam.panY - (t.y - frame.midY) * k, z: t.z, f: t.f };
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
