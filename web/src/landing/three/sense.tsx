import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial } from "three";

import { useLive } from "../../lib/useLive";
import { Device } from "./device";
import { between, type Drive } from "./drive";
import { Phone, screenClip, screenFurniture, useScreen } from "./phone";

/**
 * Sense it: the node taking a reading, and the reading arriving on a phone.
 *
 * The node sits shut and works — its light pulses and a ring goes out each
 * time it samples — while the phone comes up beside it and fills with what
 * the carrier is actually sending: the temperature, the humidity, and the
 * last few minutes of readings. The numbers are the live stream's own, the
 * same ones the Live page shows, so nothing here is staged.
 */

const TEAL = "#35d0c3";
/**
 * The node draws itself at eight times life size, so the phone is drawn at
 * eight too and the two keep their real proportions: a 148 mm phone beside a
 * 70 mm node, which is the point of the picture.
 */
const SCALE = 8;

const font = (size: number, weight = 400, mono = false) =>
  `${weight} ${size}px ${mono ? '"SF Mono", ui-monospace, Menlo, monospace' : '"SF Pro Text", -apple-system, system-ui, sans-serif'}`;

interface Shown {
  label: string;
  temp: number | null;
  rh: number | null;
  band: string;
  trail: number[];
}

/** The carrier's own page, as the app draws it: what it is, and what it reads. */
function dashboard(shown: Shown, lit: number, fill: number) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    screenClip(ctx, w, h);
    ctx.fillStyle = "#08090a";
    ctx.fillRect(0, 0, w, h);

    const a = Math.min(1, lit * 1.5);
    if (a > 0.01) {
      ctx.globalAlpha = a;

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = font(3.4, 600);
      ctx.fillText("9:41", 6, 8.4);

      // Live, and which carrier.
      ctx.fillStyle = TEAL;
      ctx.beginPath();
      ctx.arc(7, 20, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = font(2.6, 700, true);
      ctx.fillText("LIVE", 10.5, 21);
      ctx.fillStyle = "rgba(235,235,245,0.6)";
      ctx.font = font(3, 500);
      ctx.fillText(shown.label, 6, 28);

      // What it reads now.
      ctx.fillStyle = "#ffffff";
      ctx.font = font(17, 700);
      ctx.fillText(shown.temp == null ? "–" : `${shown.temp.toFixed(1)}°`, 6, 52);
      ctx.font = font(4.6, 500);
      ctx.fillStyle = "rgba(235,235,245,0.65)";
      ctx.fillText("inside the carrier", 6, 60);

      if (shown.rh != null) {
        ctx.fillStyle = "#ffffff";
        ctx.font = font(8, 600);
        ctx.fillText(`${Math.round(shown.rh)}%`, 6, 76);
        ctx.font = font(4, 500);
        ctx.fillStyle = "rgba(235,235,245,0.65)";
        ctx.fillText("humidity", 6, 83);
      }

      // In range, or not: the band the server put it in.
      const ok = shown.band === "ok";
      const pill = ok ? "in range" : shown.band === "warm" ? "too warm" : shown.band === "cold" ? "cold" : "freezing";
      ctx.fillStyle = ok ? "rgba(53,208,195,0.16)" : "rgba(242,176,30,0.18)";
      ctx.beginPath();
      ctx.roundRect(w - 6 - 22, 44, 22, 6, 3);
      ctx.fill();
      ctx.fillStyle = ok ? TEAL : "#f2b01e";
      ctx.font = font(3, 700);
      ctx.textAlign = "center";
      ctx.fillText(pill, w - 6 - 11, 48.2);
      ctx.textAlign = "left";

      // The last few minutes, drawing as the reader scrolls.
      const trail = shown.trail;
      if (trail.length > 1) {
        const x0 = 6;
        const x1 = w - 6;
        const y0 = 96;
        const y1 = 128;
        const lo = Math.min(...trail) - 0.4;
        const hi = Math.max(...trail) + 0.4;
        const px = (i: number) => x0 + ((x1 - x0) * i) / (trail.length - 1);
        const py = (v: number) => y1 - ((v - lo) / Math.max(0.1, hi - lo)) * (y1 - y0);
        const upto = Math.max(2, Math.round(trail.length * fill));

        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(x0, y1 + 2);
        ctx.lineTo(x1, y1 + 2);
        ctx.stroke();

        ctx.strokeStyle = TEAL;
        ctx.lineWidth = 1.2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i < upto; i++) {
          const x = px(i);
          const y = py(trail[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = TEAL;
        ctx.beginPath();
        ctx.arc(px(upto - 1), py(trail[upto - 1]), 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(235,235,245,0.5)";
        ctx.font = font(2.6, 500);
        ctx.fillText("every reading, as it lands", 6, 136);
      }
      ctx.globalAlpha = 1;
    }

    screenFurniture(ctx, w, h, a);
    ctx.restore();
  };
}

/** A ring going out from the node each time it takes a reading. */
function Pulse({ strength }: { strength: { current: number } }) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const k = strength.current;
    g.visible = k > 0.01;
    if (!g.visible) return;
    g.children.forEach((ring, i) => {
      const t = (clock.elapsedTime * 0.55 + i / g.children.length) % 1;
      ring.scale.setScalar(0.5 + t * 2.4);
      const m = (ring as Mesh).material as MeshBasicMaterial;
      m.opacity = k * (1 - t) * 0.5;
    });
    invalidate();
  });
  return (
    <group ref={group} position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={SCALE}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <ringGeometry args={[0.03, 0.032, 64]} />
          <meshBasicMaterial color={TEAL} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function SenseScene({ drive }: { drive: Drive }) {
  const phone = useRef<Group>(null);
  const node = useRef<Group>(null);
  const sensing = useRef(0);
  const screen = useScreen();
  const painted = useRef({ lit: -1, fill: -1, temp: -999 });
  const live = useLive();

  const last = live.readings[live.readings.length - 1];
  const shown: Shown = {
    label: last?.label ?? "Carrier",
    temp: last?.temp_c ?? null,
    rh: last?.rh ?? null,
    band: last?.band ?? "ok",
    trail: live.readings.slice(-40).map((r) => r.temp_c),
  };

  useFrame(() => {
    const p = drive.p;
    sensing.current = between(p, 0.05, 0.3);

    // The node turns a little; the phone comes up beside it and stays.
    if (node.current) node.current.rotation.y = -0.35 + between(p, 0, 1) * 0.5;
    const up = between(p, 0.3, 0.62);
    const g = phone.current;
    if (g) {
      g.position.set(0.62, -0.62 + up * 0.92, 0.05 + up * 0.12);
      g.rotation.set(-0.1, -0.22 + up * 0.14, 0.05);
    }

    const lit = between(p, 0.36, 0.56);
    const fill = between(p, 0.56, 0.95);
    const temp = shown.temp ?? -999;
    const was = painted.current;
    if (Math.abs(lit - was.lit) > 0.02 || Math.abs(fill - was.fill) > 0.02 || Math.abs(temp - was.temp) > 0.05) {
      painted.current = { lit, fill, temp };
      screen.paint(dashboard(shown, lit, fill));
    }
  });

  return (
    <group>
      {/* Nearer the camera than the phone: a 70 mm node beside a 148 mm phone
          needs the perspective to hold its own. */}
      <group ref={node} position={[-0.46, 0, 0.32]}>
        <Device drive={drive} open={() => 0} />
        <Pulse strength={sensing} />
      </group>
      <group ref={phone} scale={SCALE}>
        <Phone screen={screen.tex} />
      </group>
    </group>
  );
}
