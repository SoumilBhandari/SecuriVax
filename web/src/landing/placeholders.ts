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

const TEAL = "#35d0c3";
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
function carrier(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, lift: number, g: Ground, cutaway = 0, ice = 1) {
  const c = palette(g);
  const W = size; // front width
  const D = size * 0.55; // depth (drawn as a slanted top)
  const H = size * 0.72;
  const skew = D * 0.5;
  const x0 = cx - W / 2;
  const y0 = cy - H / 2 + D * 0.15;

  contactShadow(ctx, cx + skew * 0.35, y0 + H + 6, W * 0.72, W * 0.16, c.shadow);

  // Right side face.
  ctx.fillStyle = c.side;
  ctx.beginPath();
  ctx.moveTo(x0 + W, y0);
  ctx.lineTo(x0 + W + skew, y0 - D * 0.35);
  ctx.lineTo(x0 + W + skew, y0 - D * 0.35 + H);
  ctx.lineTo(x0 + W, y0 + H);
  ctx.closePath();
  ctx.fill();

  // Front face (or the cutaway: a darker interior slab).
  if (cutaway > 0) {
    ctx.fillStyle = c.dark;
    rr(ctx, x0, y0, W, H, 10);
    ctx.fill();
    // Ice packs lining the walls, thinning with `ice`.
    const t = W * 0.08 * ice;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    rr(ctx, x0 + W * 0.05, y0 + H * 0.12, t, H * 0.8, 6);
    ctx.fill();
    rr(ctx, x0 + W * 0.95 - t, y0 + H * 0.12, t, H * 0.8, 6);
    ctx.fill();
    // Two boxes and the node.
    ctx.fillStyle = "#fafafa";
    rr(ctx, x0 + W * 0.22, y0 + H * 0.42, W * 0.24, H * 0.42, 6);
    ctx.fill();
    rr(ctx, x0 + W * 0.52, y0 + H * 0.42, W * 0.24, H * 0.42, 6);
    ctx.fill();
    ctx.fillStyle = "#f5f5f7";
    ctx.beginPath();
    ctx.arc(x0 + W * 0.5, y0 + H * 0.26, W * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x0 + W * 0.5, y0 + H * 0.26, W * 0.05, 0, Math.PI * 2);
    ctx.stroke();
    // Frost on the liner, receding.
    ctx.fillStyle = `rgba(255,255,255,${0.12 * ice})`;
    rr(ctx, x0, y0, W, H, 10);
    ctx.fill();
  } else {
    ctx.fillStyle = c.body;
    rr(ctx, x0, y0, W, H, 10);
    ctx.fill();
  }

  // The open top, seen once the lid lifts.
  const openness = ease(lift);
  if (openness > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, openness * 1.6);
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + skew, y0 - D * 0.35);
    ctx.lineTo(x0 + W + skew, y0 - D * 0.35);
    ctx.lineTo(x0 + W, y0);
    ctx.closePath();
    ctx.fill();
    // Inside: two boxes, the ice, and the node with its ring lit.
    const inset = (fx: number, fy: number): [number, number] => [x0 + fx * W + fy * skew, y0 - fy * D * 0.35];
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    const pack = (fx: number, fw: number) => {
      const [ax, ay] = inset(fx, 0.12);
      const [bx, by] = inset(fx + fw, 0.12);
      const [cx2, cy2] = inset(fx + fw, 0.88);
      const [dx, dy] = inset(fx, 0.88);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(dx, dy);
      ctx.closePath();
      ctx.fill();
    };
    pack(0.04, 0.09);
    pack(0.87, 0.09);
    ctx.fillStyle = "#fafafa";
    const box = (fx: number) => {
      const [ax, ay] = inset(fx, 0.25);
      const [bx, by] = inset(fx + 0.3, 0.25);
      const [cx2, cy2] = inset(fx + 0.3, 0.75);
      const [dx, dy] = inset(fx, 0.75);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(dx, dy);
      ctx.closePath();
      ctx.fill();
    };
    box(0.18);
    box(0.52);
    const [nx, ny] = inset(0.5, 0.06);
    ctx.fillStyle = "#f5f5f7";
    ctx.beginPath();
    ctx.ellipse(nx, ny + 4, W * 0.045, W * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(nx, ny + 5, W * 0.045, W * 0.02, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // The lid: a slab on top, lifting straight up and sliding back.
  const ly = -openness * size * 0.42;
  const lx = openness * size * 0.14;
  const lidH = size * 0.06;
  ctx.save();
  ctx.translate(lx, ly);
  if (openness > 0) contactShadow(ctx, cx + skew * 0.5, y0 - lidH + D * 0.05, W * 0.6, W * 0.14, `rgba(0,0,0,${0.12 * openness})`);
  ctx.fillStyle = c.side;
  ctx.beginPath();
  ctx.moveTo(x0 + W, y0 - lidH);
  ctx.lineTo(x0 + W + skew, y0 - lidH - D * 0.35);
  ctx.lineTo(x0 + W + skew, y0 - D * 0.35);
  ctx.lineTo(x0 + W, y0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c.body;
  rr(ctx, x0, y0 - lidH, W, lidH, 4);
  ctx.fill();
  // Gasket line in teal along the front edge of the lid.
  ctx.fillStyle = TEAL;
  ctx.fillRect(x0 + 6, y0 - 2, W - 12, 2);
  // Top face.
  ctx.fillStyle = g === "light" ? "#fafafa" : "#f2f2f4";
  ctx.beginPath();
  ctx.moveTo(x0, y0 - lidH);
  ctx.lineTo(x0 + skew, y0 - lidH - D * 0.35);
  ctx.lineTo(x0 + W + skew, y0 - lidH - D * 0.35);
  ctx.lineTo(x0 + W, y0 - lidH);
  ctx.closePath();
  ctx.fill();
  // Handle recess and the NFC sticker.
  ctx.fillStyle = c.dark2;
  ctx.beginPath();
  ctx.ellipse(x0 + W * 0.5 + skew * 0.5, y0 - lidH - D * 0.17, W * 0.18, D * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.white;
  ctx.beginPath();
  ctx.ellipse(x0 + W * 0.82 + skew * 0.2, y0 - lidH - D * 0.07, W * 0.035, D * 0.02, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(x0 + W * 0.82 + skew * 0.2, y0 - lidH - D * 0.07, W * 0.02, D * 0.012, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** A: the carrier, then its lid lifts to show what's inside. */
export const heroReveal: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const size = Math.min(w * 0.55, h * 0.62) * at.scale;
  const lift = between(p, 0.15, 0.85);
  carrier(ctx, w * at.ax - size * 0.12, h * at.ay, size, lift, g);
};

/** B: the box alone, turning so the sticker catches the light. */
export const tagIt: Placeholder = (ctx, w, h, p, g, at) => {
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
  ctx.font = `500 ${Math.round(size * 0.05)}px "SF Pro Text", -apple-system, sans-serif`;
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

/** C: the puck, exploded into shell, ring, board and battery. */
export const senseIt: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const c = palette(g);
  const R = Math.min(w, h) * 0.17 * at.scale;
  const cx = w * at.ax;
  const cy = h * at.ay;
  const ex = between(p, 0.1, 0.9);
  const disc = (dy: number, r: number, thick: number, fill: string, stroke?: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(cx, cy + dy + thick, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - r, cy + dy, r * 2, thick);
    ctx.beginPath();
    ctx.ellipse(cx, cy + dy, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + dy, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };
  contactShadow(ctx, cx, cy + R * 0.9, R * 1.3, R * 0.35, c.shadow);
  disc(R * 0.25 + ex * R * 0.5, R, R * 0.18, "#e9e9eb"); // bottom shell
  disc(R * 0.1 - ex * R * 0.1, R * 0.86, R * 0.12, "#b8b8bd"); // battery
  disc(-R * 0.05 - ex * R * 0.55, R * 0.9, R * 0.06, "#10231c"); // board
  // Ring: a thin teal ellipse.
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy - R * 0.15 - ex * R * 1.05, R, R * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  disc(-R * 0.25 - ex * R * 1.6, R, R * 0.2, "#f5f5f7"); // top shell
  ctx.fillStyle = c.edge;
  ctx.fillRect(cx + R * 0.75, cy - R * 0.25 - ex * R * 1.6 + R * 0.06, R * 0.18, 3); // the vent slot
};

/** D: a vial, macro, the VVM square darkening. */
export const twoWitnesses: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const c = palette(g);
  const H = Math.min(h * 0.62, w * 0.9) * at.scale;
  const W = H * 0.36;
  const cx = w * at.ax;
  const cy = h * at.ay;
  contactShadow(ctx, cx, cy + H * 0.52, W * 1.1, W * 0.22, c.shadow);
  // Glass body.
  ctx.fillStyle = g === "light" ? "rgba(235,238,240,0.9)" : "rgba(220,224,228,0.9)";
  rr(ctx, cx - W / 2, cy - H * 0.36, W, H * 0.86, W * 0.16);
  ctx.fill();
  // Liquid.
  ctx.fillStyle = "rgba(244,200,214,0.75)";
  rr(ctx, cx - W / 2 + 4, cy - H * 0.06, W - 8, H * 0.52, W * 0.14);
  ctx.fill();
  // Cap.
  ctx.fillStyle = "#b8b8bd";
  rr(ctx, cx - W * 0.42, cy - H * 0.5, W * 0.84, H * 0.16, 6);
  ctx.fill();
  ctx.fillStyle = "#8e8e93";
  rr(ctx, cx - W * 0.34, cy - H * 0.53, W * 0.68, H * 0.05, 4);
  ctx.fill();
  // Label.
  ctx.fillStyle = "#ffffff";
  rr(ctx, cx - W / 2 + 2, cy - H * 0.3, W - 4, H * 0.3, 4);
  ctx.fill();
  // VVM: purple circle, the square inside darkening.
  const r = W * 0.17;
  const vx = cx;
  const vy = cy - H * 0.15;
  ctx.fillStyle = "#5b3e9b";
  ctx.beginPath();
  ctx.arc(vx, vy, r, 0, Math.PI * 2);
  ctx.fill();
  const t = between(p, 0.15, 0.85);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  ctx.fillStyle = `rgb(${mix(255, 91)}, ${mix(255, 62)}, ${mix(255, 155)})`;
  ctx.fillRect(vx - r * 0.5, vy - r * 0.5, r, r);
  ctx.fillStyle = c.label;
  ctx.font = `500 ${Math.round(W * 0.09)}px "SF Pro Text", -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("OPV", cx, cy - H * 0.26 + W * 0.09);
  ctx.textAlign = "start";
};

/** E: the carrier cut away, the ice thinning as the hours pass. */
export const theTwin: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const size = Math.min(w * 0.55, h * 0.62) * at.scale;
  carrier(ctx, w * at.ax - size * 0.12, h * at.ay, size, 1, g, 1, 1 - between(p, 0.1, 0.9) * 0.8);
};

/** F: the carrier closed again, pulling back into frame. */
export const closing: Placeholder = (ctx, w, h, p, g, at) => {
  ground(ctx, w, h, g);
  const size = Math.min(w * 0.55, h * 0.62) * at.scale * (1.25 - between(p, 0, 1) * 0.35);
  carrier(ctx, w * at.ax - size * 0.12, h * at.ay, size, 0, g);
};

export const PLACEHOLDERS: Record<string, Placeholder> = { A: heroReveal, B: tagIt, C: senseIt, D: twoWitnesses, E: theTwin, F: closing };
