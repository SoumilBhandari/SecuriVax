/**
 * Stand-ins for the hero render, drawn on a canvas from the same brief the
 * render follows (docs/hero-3d-brief.md): a carrier, a box, the sensor puck,
 * a vial. Flat, in the neutral palette, teal only on the gasket and the ring.
 * Each takes the scroll progress of its chapter, 0 to 1.
 */

export type Ground = "light" | "dark";
/** Where the object sits: its centre as fractions of the box, and a size multiplier. */
export interface Anchor {
  ax: number;
  ay: number;
  scale: number;
}
export const CENTRED: Anchor = { ax: 0.5, ay: 0.55, scale: 1 };
export type Placeholder = (ctx: CanvasRenderingContext2D, w: number, h: number, p: number, ground: Ground, at: Anchor) => void;

const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const between = (t: number, a: number, b: number) => ease((t - a) / (b - a));

function palette(ground: Ground) {
  return ground === "light"
    ? { bg: "#ffffff", bg2: "#f5f5f7", body: "#f2f2f4", side: "#dededf", edge: "#c9c9cc", dark: "#2c2c2e", dark2: "#3a3a3c", shadow: "rgba(0,0,0,0.16)", white: "#ffffff", label: "#86868b" }
    : { bg: "#000000", bg2: "#0a0a0a", body: "#e8e8ea", side: "#b9b9bd", edge: "#9a9a9e", dark: "#1c1c1e", dark2: "#2c2c2e", shadow: "rgba(0,0,0,0.6)", white: "#ffffff", label: "#6e6e73" };
}

function ground(ctx: CanvasRenderingContext2D, w: number, h: number, g: Ground) {
  const c = palette(g);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, c.bg);
  grad.addColorStop(1, c.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function contactShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The carrier from a three-quarter front view, drawn as three faces. `lift`
 * raises the lid straight up and back; `open` (0..1) also fades the inside in.
 */
/**
 * The node, flat: the case as a stack of slabs that comes apart into lid,
 * cell, board and base. This is what a browser without WebGL is shown, so it
 * has to read as the same object the render shows.
 */
function device(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, open: number, g: Ground) {
  const c = palette(g);
  const W = size;
  const sk = size * 0.16;
  const gap = open * size * 0.13;
  const slab = (dy: number, th: number, face: string, top: string) => {
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(cx - W / 2, cy + dy);
    ctx.lineTo(cx - W / 2 + sk, cy + dy - sk * 0.5);
    ctx.lineTo(cx + W / 2 + sk, cy + dy - sk * 0.5);
    ctx.lineTo(cx + W / 2, cy + dy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = face;
    rr(ctx, cx - W / 2, cy + dy, W, th, Math.min(6, th / 2));
    ctx.fill();
  };
  contactShadow(ctx, cx, cy + size * 0.3, W * 0.58, W * 0.1, c.shadow);
  slab(size * 0.12, size * 0.1, "#eeeef1", "#f7f7f9"); // the base
  slab(size * 0.02 - gap * 0.8, size * 0.02, "#11251d", "#1b3a2f"); // the board
  slab(-size * 0.06 - gap * 1.7, size * 0.025, "#3a3a3e", "#4a4a4f"); // the cell
  slab(-size * 0.16 - gap * 2.8, size * 0.035, "#f2f2f4", "#fbfbfd"); // the lid
}

/** A: the node, which comes apart as the reader scrolls. */
const heroReveal: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const size = Math.min(w * 0.5, h * 0.55) * at.scale;
  device(ctx, w * at.ax, h * at.ay, size, between(p, 0.14, 0.86), g);
};

/** B: the box alone, turning so the sticker catches the light. */
const tagIt: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const c = palette(g);
  const size = Math.min(w * 0.42, h * 0.5) * at.scale;
  const turn = -0.35 + between(p, 0.1, 0.9) * 0.7; // radians of skew
  const cx = w * at.ax;
  const cy = h * at.ay;
  const W = size;
  const H = size * 0.5;
  const D = size * 0.55;
  const sk = Math.sin(turn) * D * 0.6;
  contactShadow(ctx, cx, cy + H * 0.62, W * 0.7, W * 0.16, c.shadow);
  // Side.
  ctx.fillStyle = c.side;
  ctx.beginPath();
  ctx.moveTo(cx + W / 2, cy - H / 2);
  ctx.lineTo(cx + W / 2 + sk, cy - H / 2 - Math.abs(sk) * 0.5);
  ctx.lineTo(cx + W / 2 + sk, cy + H / 2 - Math.abs(sk) * 0.5);
  ctx.lineTo(cx + W / 2, cy + H / 2);
  ctx.closePath();
  ctx.fill();
  // Front.
  ctx.fillStyle = g === "light" ? "#fafafa" : "#ececee";
  rr(ctx, cx - W / 2, cy - H / 2, W, H, 6);
  ctx.fill();
  ctx.fillStyle = c.label;
  ctx.font = `500 ${Math.round(size * 0.05)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText("OPV · 10 vials · 20 doses", cx - W / 2 + size * 0.06, cy + H / 2 - size * 0.06);
  // Top with the sticker; the sticker brightens at the midpoint.
  ctx.fillStyle = g === "light" ? "#ffffff" : "#f5f5f7";
  ctx.beginPath();
  ctx.moveTo(cx - W / 2, cy - H / 2);
  ctx.lineTo(cx - W / 2 + sk, cy - H / 2 - Math.abs(sk) * 0.5);
  ctx.lineTo(cx + W / 2 + sk, cy - H / 2 - Math.abs(sk) * 0.5);
  ctx.lineTo(cx + W / 2, cy - H / 2);
  ctx.closePath();
  ctx.fill();
  const glint = 1 - Math.min(1, Math.abs(p - 0.5) * 4);
  const sx = cx + sk * 0.5;
  const sy = cy - H / 2 - Math.abs(sk) * 0.25;
  ctx.fillStyle = `rgba(255,255,255,${0.7 + 0.3 * glint})`;
  ctx.beginPath();
  ctx.ellipse(sx, sy, size * 0.08, size * 0.08 * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1d1d1f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(sx, sy, size * 0.05, size * 0.05 * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#1d1d1f";
  ctx.beginPath();
  ctx.ellipse(sx, sy, size * 0.015, size * 0.015 * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  if (glint > 0) {
    ctx.strokeStyle = `rgba(53,208,195,${glint * 0.9})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, size * 0.11 + glint * 6, (size * 0.11 + glint * 6) * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
};

/** C: the node, fully apart. */
const senseIt: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const size = Math.min(w * 0.42, h * 0.5) * at.scale;
  device(ctx, w * at.ax, h * at.ay, size, between(p, 0.06, 0.94), g);
};

/** F: the carrier closed again, pulling back into frame. */
const closing: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const size = Math.min(w * 0.46, h * 0.52) * at.scale * (1 + p * 0.06);
  device(ctx, w * at.ax, h * at.ay, size, 0, g);
};

export const PLACEHOLDERS: Record<string, Placeholder> = { A: heroReveal, B: tagIt, C: senseIt, F: closing };
