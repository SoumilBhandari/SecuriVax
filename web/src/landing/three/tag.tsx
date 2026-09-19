import { RoundedBox } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace } from "three";

import { between, type Drive } from "./objects";

/**
 * Tag it: the bOPV carton from the team's cutting sheet
 * (`docs/carton-sheet.pdf`) — 86 x 36 x 45 mm, printed as it is drawn — and a
 * phone that comes down to its label, reads the tag, and lights up with the
 * verdict.
 *
 * Every panel is painted into a canvas at twenty pixels to the millimetre, so
 * the type on the box is the type on the sheet rather than a picture of it.
 */

const MM = 1000;
/** The carton, in metres: the sheet's interior, near enough for board this thin. */
const BOX = { w: 86 / MM, h: 45 / MM, d: 36 / MM };
/** Where the SecuriVax label sits on the front panel, from the sheet: 35 x 27 mm. */
const LABEL = { w: 35 / MM, h: 27 / MM, x: 18.5 / MM, y: 0 };
/** A phone, near enough to the one in a health worker's hand. */
const PHONE = { w: 71 / MM, h: 146 / MM, t: 8 / MM };

/** The scene is drawn at four times life size, to sit with the other chapters. */
const SCALE = 4;

const INK = "#0b2545";
const TEAL = "#35d0c3";
const GREEN = "#157a52";

type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** A panel of the carton, painted at 20 px/mm. */
function usePanel(widthMm: number, heightMm: number, paint: Paint, deps: unknown[] = []): CanvasTexture {
  const invalidate = useThree((s) => s.invalidate);
  const tex = useMemo(() => {
    const px = 20;
    const c = document.createElement("canvas");
    c.width = Math.round(widthMm * px);
    c.height = Math.round(heightMm * px);
    const ctx = c.getContext("2d")!;
    ctx.scale(px, px); // draw in millimetres
    paint(ctx, widthMm, heightMm);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    invalidate();
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthMm, heightMm, invalidate, ...deps]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

const font = (size: number, weight = 400, mono = false) =>
  `${weight} ${size}px ${mono ? '"SF Mono", ui-monospace, Menlo, monospace' : '"SF Pro Text", -apple-system, system-ui, sans-serif'}`;

/** The drop from the mark, drawn straight rather than loaded, so a panel paints in one pass. */
function drop(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, body = INK) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(50, 0);
  ctx.bezierCurveTo(50, 0, 12, 42, 12, 66);
  ctx.arc(50, 66, 38, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = TEAL;
  ctx.beginPath();
  ctx.moveTo(44, 71);
  ctx.lineTo(41, 86);
  ctx.lineTo(59, 86);
  ctx.lineTo(56, 71);
  ctx.arc(50, 66, 11, 0.6, Math.PI - 0.6, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The front panel: the lockup, what is in the box, and the area kept clear for the label. */
const front: Paint = (ctx, w, h) => {
  ctx.fillStyle = "#fdfdfc";
  ctx.fillRect(0, 0, w, h);
  const m = 5;

  drop(ctx, m, 4, 6);
  ctx.fillStyle = INK;
  ctx.font = font(5.2, 700);
  ctx.fillText("SecuriVax", m + 7.5, 9.4);

  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(m, 12.5);
  ctx.lineTo(m + 38, 12.5);
  ctx.stroke();

  ctx.font = font(9, 700);
  ctx.fillText("bOPV", m, 21.5);

  ctx.fillStyle = "#3d4a5c";
  ctx.font = font(2.5);
  ctx.fillText("Bivalent Oral Poliovirus Vaccine", m, 26);
  ctx.fillText("(types 1 and 3), live attenuated", m, 29.3);

  ctx.fillStyle = INK;
  ctx.font = font(3.6, 700);
  ctx.fillText("10 vials × 2 mL", m, 35);
  ctx.fillStyle = "#3d4a5c";
  ctx.font = font(2.5);
  ctx.fillText("20 doses per vial · 200 doses", m, 38.8);

  // The for-oral-use pill.
  ctx.fillStyle = "#e7f6f3";
  const pw = 22;
  ctx.beginPath();
  ctx.roundRect(m, 40.6, pw, 3.4, 1.7);
  ctx.fill();
  ctx.fillStyle = "#0b7a73";
  ctx.font = font(2.1, 700);
  ctx.fillText("FOR ORAL USE ONLY", m + 2, 42.9);

  // The label area, kept clear for the tag.
  const lx = w / 2 + LABEL.x * MM - (LABEL.w * MM) / 2;
  const ly = h / 2 - (LABEL.h * MM) / 2;
  ctx.fillStyle = "#eaf6f4";
  ctx.beginPath();
  ctx.roundRect(lx, ly, LABEL.w * MM, LABEL.h * MM, 1.2);
  ctx.fill();
  ctx.setLineDash([1.2, 1]);
  ctx.strokeStyle = "#8fc9c2";
  ctx.lineWidth = 0.3;
  ctx.stroke();
  ctx.setLineDash([]);
  drop(ctx, lx + LABEL.w * MM / 2 - 2.2, ly + 5, 4.4);
  ctx.fillStyle = INK;
  ctx.font = font(2.2, 700);
  ctx.textAlign = "center";
  ctx.fillText("SECURIVAX", lx + (LABEL.w * MM) / 2, ly + 14.5);
  ctx.fillText("LABEL AREA", lx + (LABEL.w * MM) / 2, ly + 17.8);
  ctx.fillStyle = "#6b8894";
  ctx.font = font(1.8);
  ctx.fillText("35 × 27 mm", lx + (LABEL.w * MM) / 2, ly + 22);
  ctx.textAlign = "left";
};

/** The lot panel, as on the sheet: lot, expiry, manufacture, serial. */
const side: Paint = (ctx, w, h) => {
  ctx.fillStyle = "#fdfdfc";
  ctx.fillRect(0, 0, w, h);
  const m = 4;
  drop(ctx, m, 4, 5);
  const row = (label: string, value: string, y: number) => {
    ctx.fillStyle = "#6b8894";
    ctx.font = font(1.9, 500, true);
    ctx.fillText(label, m, y);
    ctx.fillStyle = INK;
    ctx.font = font(3.2, 700);
    ctx.fillText(value, m, y + 4.2);
  };
  row("LOT", "OPV-4471B", 15);
  row("EXP", "2028-03", 24);
  row("MFG", "2026-08", 33);
  row("BOX SERIAL", "SVX-00147", 42);
};

/** The other side: the round sticker that asks for the tap. */
const tapPanel: Paint = (ctx, w, h) => {
  ctx.fillStyle = "#fdfdfc";
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2 - 4;
  const r = 13;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  drop(ctx, cx - 3.4, cy - 8, 6.8, "#ffffff");
  ctx.fillStyle = "#ffffff";
  ctx.font = font(2.6, 700);
  ctx.textAlign = "center";
  ctx.fillText("TAP TO CHECK", cx, cy + 6);
  ctx.fillStyle = "#3d4a5c";
  ctx.font = font(2.1);
  ctx.fillText("Tap this box", cx, cy + r + 5);
  ctx.fillText("before you open it.", cx, cy + r + 8);
  ctx.textAlign = "left";
};

/** The top flap: how it is stored. */
const top: Paint = (ctx, w, h) => {
  ctx.fillStyle = "#fbfbfa";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = INK;
  ctx.font = font(3.4, 700);
  ctx.textAlign = "center";
  ctx.fillText("STORE AT −20 °C, OR AT +2 °C TO +8 °C", w / 2, h / 2);
  ctx.fillStyle = "#6b8894";
  ctx.font = font(2.1);
  ctx.fillText("Do not refreeze after thawing. Protect from light.", w / 2, h / 2 + 4);
  ctx.textAlign = "left";
};

/** The phone's screen: dark until the tag is read, then the verdict. */
function screenPaint(lit: number): Paint {
  return (ctx, w, h) => {
    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(0, 0, w, h);
    if (lit <= 0.01) return;
    ctx.globalAlpha = Math.min(1, lit * 1.4);
    ctx.fillStyle = GREEN;
    ctx.fillRect(0, 0, w, h * 0.62);
    ctx.fillStyle = "#ffffff";
    ctx.font = font(6, 600);
    ctx.fillText("USE", w * 0.1, h * 0.3);
    ctx.font = font(3, 500);
    ctx.fillText("Safe to use", w * 0.1, h * 0.4);
    ctx.font = font(2.4, 500, true);
    ctx.globalAlpha = Math.min(1, lit * 1.4) * 0.85;
    ctx.fillText("SVX-00147", w * 0.1, h * 0.14);
    ctx.globalAlpha = Math.min(1, lit * 1.4);
    ctx.fillStyle = "#e8e8ea";
    ctx.font = font(2.6, 500);
    ctx.fillText("Budget used", w * 0.1, h * 0.72);
    ctx.fillText("Witnesses", w * 0.1, h * 0.8);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = font(2.6, 700);
    ctx.fillText("31%", w * 0.9, h * 0.72);
    ctx.fillText("4 records", w * 0.9, h * 0.8);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  };
}

/** The rings that go out from the label while the phone reads it. */
function Rings({ atRead }: { atRead: { current: number } }) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const strength = atRead.current ?? 0;
    g.visible = strength > 0.01;
    if (!g.visible) return;
    g.children.forEach((ring, i) => {
      const t = (clock.elapsedTime * 0.9 + i / g.children.length) % 1;
      const s = 0.4 + t * 1.6;
      ring.scale.setScalar(s);
      const m = (ring as Mesh).material as MeshBasicMaterial;
      m.opacity = strength * (1 - t) * 0.7;
    });
    invalidate(); // the rings pulse on their own, so keep asking for frames while they show
  });
  return (
    <group ref={group} position={[LABEL.x, LABEL.y, BOX.d / 2 + 0.001]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <ringGeometry args={[0.011, 0.0125, 48]} />
          <meshBasicMaterial color={TEAL} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function TagScene({ drive }: { drive: Drive }) {
  const phone = useRef<Group>(null);
  const carton = useRef<Group>(null);
  const read = useRef(0);
  const invalidate = useThree((s) => s.invalidate);

  const frontTex = usePanel(BOX.w * MM, BOX.h * MM, front);
  const sideTex = usePanel(BOX.d * MM, BOX.h * MM, side);
  const tapTex = usePanel(BOX.d * MM, BOX.h * MM, tapPanel);
  const topTex = usePanel(BOX.w * MM, BOX.d * MM, top);

  // The screen is repainted as it lights, which is cheap at this size.
  const screen = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = Math.round(PHONE.w * MM * 8);
    c.height = Math.round(PHONE.h * MM * 8);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return { canvas: c, tex: t, lit: -1 };
  }, []);
  useEffect(() => () => screen.tex.dispose(), [screen]);

  const board = useMemo(
    () => [
      new MeshStandardMaterial({ map: sideTex, roughness: 0.82 }), // +x
      new MeshStandardMaterial({ map: tapTex, roughness: 0.82 }), // -x
      new MeshStandardMaterial({ map: topTex, roughness: 0.82 }), // +y
      new MeshStandardMaterial({ color: "#f4f4f2", roughness: 0.85 }), // -y
      new MeshStandardMaterial({ map: frontTex, roughness: 0.8 }), // +z
      new MeshStandardMaterial({ color: "#f7f7f5", roughness: 0.85 }), // -z
    ],
    [sideTex, tapTex, topTex, frontTex],
  );
  useEffect(() => () => board.forEach((m) => m.dispose()), [board]);

  useFrame(() => {
    const p = drive.p;
    // The carton turns a little to present its front; the phone comes down to
    // the label, holds while the tag is read, and eases back with the verdict.
    const turn = -0.5 + between(p, 0, 0.55) * 0.42;
    if (carton.current) carton.current.rotation.y = turn;

    const approach = between(p, 0.18, 0.56);
    const settle = between(p, 0.72, 1);
    const g = phone.current;
    if (g) {
      // It comes in high and to the right and ends with its back over the
      // label, close enough to read the tag through the board.
      // It ends leaning in from the right with its lower corner over the
      // label, so the box and what the phone says are both in the picture.
      const hold = { x: LABEL.x + PHONE.w * 0.52, y: BOX.h / 2 + PHONE.h * 0.3, z: BOX.d / 2 + 0.014 };
      g.position.set(
        hold.x + (1 - approach) * 0.05,
        hold.y + (1 - approach) * 0.055 + settle * 0.012,
        hold.z + (1 - approach) * 0.07 + settle * 0.02,
      );
      g.rotation.set(-0.2 + approach * 0.14 - settle * 0.05, -0.5 + approach * 0.34, 0.5 - approach * 0.22);
    }

    read.current = Math.min(between(p, 0.5, 0.62), 1 - between(p, 0.86, 1));

    const lit = between(p, 0.58, 0.72);
    if (Math.abs(lit - screen.lit) > 0.02) {
      screen.lit = lit;
      const ctx = screen.canvas.getContext("2d")!;
      const px = screen.canvas.width / (PHONE.w * MM);
      ctx.setTransform(px, 0, 0, px, 0, 0);
      screenPaint(lit)(ctx, PHONE.w * MM, PHONE.h * MM);
      screen.tex.needsUpdate = true;
      invalidate();
    }
  });

  return (
    <group scale={SCALE}>
      <group ref={carton} position={[0, BOX.h / 2, 0]}>
        <mesh castShadow receiveShadow material={board}>
          <boxGeometry args={[BOX.w, BOX.h, BOX.d]} />
        </mesh>
        <Rings atRead={read} />
      </group>

      <group ref={phone}>
        <RoundedBox args={[PHONE.w, PHONE.h, PHONE.t]} radius={0.007} smoothness={5} castShadow>
          <meshStandardMaterial color="#1c1c1e" roughness={0.38} metalness={0.55} />
        </RoundedBox>
        {/* The screen sits just proud of the body. */}
        <mesh position={[0, 0, PHONE.t / 2 + 0.0004]}>
          <planeGeometry args={[PHONE.w * 0.92, PHONE.h * 0.94]} />
          <meshBasicMaterial map={screen.tex} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
