import { RoundedBox } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, ExtrudeGeometry, Group, LatheGeometry, Mesh, Path, Shape, Vector2 } from "three";

import markUrl from "../../assets/brand/securivax-mark-light.svg";
import { aluminium, card, cell, glass, graphite, ice, liner, liquid, paper, pcb, polymer, polymerWhite, teal } from "./materials";

/** Scroll-driven values the objects read every frame: progress 0..1 of their chapter. */
export interface Drive {
  p: number;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const between = (t: number, a: number, b: number) => ease((t - a) / (b - a));

/** A rounded rectangle, drawn into a Shape or a Path, centred on (0, 0). */
function roundedRect<T extends Shape | Path>(p: T, w: number, h: number, r: number): T {
  p.moveTo(-w / 2 + r, -h / 2);
  p.lineTo(w / 2 - r, -h / 2);
  p.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  p.lineTo(w / 2, h / 2 - r);
  p.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  p.lineTo(-w / 2 + r, h / 2);
  p.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  p.lineTo(-w / 2, -h / 2 + r);
  p.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return p;
}

/** The SecuriVax mark as a decal texture, painted once the SVG loads. */
function useMark(): CanvasTexture {
  const invalidate = useThree((s) => s.invalidate);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const t = new CanvasTexture(c);
    t.anisotropy = 4;
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, 256, 256);
      const s = Math.min(192 / img.width, 192 / img.height);
      ctx.drawImage(img, 128 - (img.width * s) / 2, 128 - (img.height * s) / 2, img.width * s, img.height * s);
      t.needsUpdate = true;
      invalidate();
    };
    img.src = markUrl;
    return t;
  }, [invalidate]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/** A flat decal that lies on a surface: the mark, printed. */
function Mark({ size, position, rotation }: { size: number; position: [number, number, number]; rotation?: [number, number, number] }) {
  const tex = useMark();
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={tex} transparent roughness={0.6} polygonOffset polygonOffsetFactor={-1} />
    </mesh>
  );
}

// ---- The carrier, built to the brief: a filleted body with an open cavity, a
// lift-off lid with a gasket line, a fold-flat handle, two latches, a badge,
// a dark liner, and what rides inside.

const CW = 1.0; // width
const CD = 0.7; // depth
const CH = 0.8; // body height
const LID_H = 0.11;
const WALL = 0.07;
const BEVEL = 0.02;

/**
 * The body walls as one extruded ring with a filleted rim. With `cutaway`
 * the front wall is left off, so the inside shows from the front.
 */
function walls(cutaway: boolean): ExtrudeGeometry {
  const shape = new Shape();
  if (cutaway) {
    // A "U": three walls, the back corners rounded, the front left open.
    const w = CW - BEVEL * 2;
    const d = CD - BEVEL * 2;
    const r = 0.06;
    const t = WALL - BEVEL;
    shape.moveTo(-w / 2, -d / 2);
    shape.lineTo(-w / 2, d / 2 - r);
    shape.quadraticCurveTo(-w / 2, d / 2, -w / 2 + r, d / 2);
    shape.lineTo(w / 2 - r, d / 2);
    shape.quadraticCurveTo(w / 2, d / 2, w / 2, d / 2 - r);
    shape.lineTo(w / 2, -d / 2);
    shape.lineTo(w / 2 - t, -d / 2);
    shape.lineTo(w / 2 - t, d / 2 - t);
    shape.lineTo(-w / 2 + t, d / 2 - t);
    shape.lineTo(-w / 2 + t, -d / 2);
    shape.closePath();
  } else {
    roundedRect(shape, CW - BEVEL * 2, CD - BEVEL * 2, 0.06);
    shape.holes.push(roundedRect(new Path(), CW - WALL * 2 + BEVEL * 2, CD - WALL * 2 + BEVEL * 2, 0.03));
  }
  const g = new ExtrudeGeometry(shape, {
    depth: CH - WALL - BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 5,
    curveSegments: 16,
  });
  g.computeVertexNormals();
  return g;
}

/**
 * `open` (0..1) lifts the lid straight up and back and tilts it a little.
 * `cutaway` leaves the front wall off so the inside shows from the front.
 * `iceLeft` (0..1) thins the packs toward the walls.
 */
export function Carrier({ drive, open, cutaway = false, iceLeft }: { drive: Drive; open: (p: number) => number; cutaway?: boolean; iceLeft?: (p: number) => number }) {
  const lid = useRef<Group>(null);
  const packs = useRef<Group>(null);
  const ring = useMemo(() => walls(cutaway), [cutaway]);
  useEffect(() => () => ring.dispose(), [ring]);

  useFrame(() => {
    const o = open(drive.p);
    if (lid.current) {
      lid.current.position.set(0, CH + o * 0.4, -o * 0.14);
      lid.current.rotation.x = -o * 0.18;
    }
    if (packs.current && iceLeft) {
      const t = 0.2 + 0.8 * iceLeft(drive.p);
      packs.current.children.forEach((c, i) => {
        if (i < 2) c.scale.x = t;
        else c.scale.z = t;
      });
    }
  });

  const iw = CW - WALL * 2;
  const id = CD - WALL * 2;
  const floorY = WALL + BEVEL + 0.01;
  const ih = CH - floorY;
  const packT = 0.075;
  return (
    <group>
      {/* The floor slab, then the walls above it. Rotated so the extrusion runs up. */}
      <RoundedBox args={[CW - 0.003, floorY, CD - 0.003]} radius={0.03} smoothness={4} material={polymer} position={[0, floorY / 2, 0]} receiveShadow />
      <mesh geometry={ring} material={polymer} rotation={[-Math.PI / 2, 0, 0]} position={[0, WALL + BEVEL, 0]} castShadow receiveShadow />
      {/* The dark liner: the cavity's floor and walls, just inside the polymer. */}
      <mesh position={[0, floorY + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} material={liner} receiveShadow>
        <planeGeometry args={[iw, id]} />
      </mesh>
      <mesh position={[0, floorY + ih / 2, -id / 2 + 0.003]} material={liner}>
        <planeGeometry args={[iw, ih]} />
      </mesh>
      {!cutaway && (
        <mesh position={[0, floorY + ih / 2, id / 2 - 0.003]} rotation={[0, Math.PI, 0]} material={liner}>
          <planeGeometry args={[iw, ih]} />
        </mesh>
      )}
      <mesh position={[-iw / 2 + 0.003, floorY + ih / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={liner}>
        <planeGeometry args={[id, ih]} />
      </mesh>
      <mesh position={[iw / 2 - 0.003, floorY + ih / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={liner}>
        <planeGeometry args={[id, ih]} />
      </mesh>
      {/* The gasket: a thin teal line around the rim where the lid meets the body. */}
      <group position={[0, CH + 0.003, 0]}>
        <mesh position={[0, 0, CD / 2 - 0.03]} material={teal}>
          <boxGeometry args={[CW - 0.06, 0.006, 0.012]} />
        </mesh>
        <mesh position={[0, 0, -CD / 2 + 0.03]} material={teal}>
          <boxGeometry args={[CW - 0.06, 0.006, 0.012]} />
        </mesh>
        <mesh position={[CW / 2 - 0.03, 0, 0]} material={teal}>
          <boxGeometry args={[0.012, 0.006, CD - 0.06]} />
        </mesh>
        <mesh position={[-CW / 2 + 0.03, 0, 0]} material={teal}>
          <boxGeometry args={[0.012, 0.006, CD - 0.06]} />
        </mesh>
      </group>
      {/* Two latches on the front, straddling the seam, and the mark below them. */}
      {!cutaway && (
        <>
          <Latch x={-0.3} />
          <Latch x={0.3} />
          <Mark size={0.1} position={[0, CH * 0.5, CD / 2 + 0.001]} />
        </>
      )}
      {/* Contents. */}
      <group position={[0, floorY, 0]}>
        <group ref={packs}>
          <RoundedBox args={[packT, ih * 0.82, id * 0.84]} radius={0.02} smoothness={3} material={ice} position={[-iw / 2 + packT / 2 + 0.012, ih * 0.42, 0]} castShadow />
          <RoundedBox args={[packT, ih * 0.82, id * 0.84]} radius={0.02} smoothness={3} material={ice} position={[iw / 2 - packT / 2 - 0.012, ih * 0.42, 0]} castShadow />
          <RoundedBox args={[iw * 0.78, ih * 0.82, packT]} radius={0.02} smoothness={3} material={ice} position={[0, ih * 0.42, -id / 2 + packT / 2 + 0.012]} castShadow />
          {!cutaway && <RoundedBox args={[iw * 0.78, ih * 0.82, packT]} radius={0.02} smoothness={3} material={ice} position={[0, ih * 0.42, id / 2 - packT / 2 - 0.012]} castShadow />}
        </group>
        <Carton scale={0.3} position={[-0.17, 0, -0.03]} rotation={[0, 0.08, 0]} />
        <Carton scale={0.3} position={[0.17, 0, 0.03]} rotation={[0, -0.05, 0]} />
        {/* The puck in its recess on the inside of the front wall, ring lit; on the back wall when the front is cut away. */}
        <group
          position={[0, ih * 0.55, cutaway ? -id / 2 + packT + 0.03 : id / 2 - packT - 0.03]}
          rotation={[cutaway ? -Math.PI / 2 : Math.PI / 2, 0, 0]}
          scale={0.17}
        >
          <Puck drive={{ p: 0 }} explode={() => 0} />
        </group>
      </group>
      {/* The lid: a slab with a chamfer, the handle recess, the sticker, and the tag clipped under it. */}
      <group ref={lid} position={[0, CH, 0]}>
        <RoundedBox args={[CW, LID_H, CD]} radius={0.035} smoothness={5} material={polymer} position={[0, LID_H / 2, 0]} castShadow receiveShadow />
        <RoundedBox args={[CW - 0.05, 0.02, CD - 0.05]} radius={0.01} smoothness={3} material={graphite} position={[0, 0.006, 0]} />
        <RoundedBox args={[0.42, 0.03, 0.11]} radius={0.014} smoothness={4} material={graphite} position={[0, LID_H - 0.012, 0.02]} />
        <Handle position={[0, LID_H - 0.004, 0.02]} />
        <Sticker radius={0.06} position={[CW * 0.32, LID_H + 0.001, CD * 0.28]} />
        <group position={[-CW * 0.25, -0.03, -CD * 0.15]} rotation={[Math.PI / 2, 0, 0]} scale={0.32}>
          <Tag />
        </group>
      </group>
    </group>
  );
}

/** A latch: a graphite clip over the seam with a small lip. */
function Latch({ x }: { x: number }) {
  return (
    <group position={[x, CH, CD / 2]}>
      <RoundedBox args={[0.1, 0.16, 0.024]} radius={0.01} smoothness={4} material={graphite} position={[0, -0.02, 0.008]} castShadow />
      <RoundedBox args={[0.08, 0.03, 0.03]} radius={0.008} smoothness={3} material={graphite} position={[0, -0.08, 0.02]} castShadow />
    </group>
  );
}

/** A flat carry handle lying in its recess. */
function Handle({ position }: { position: [number, number, number] }) {
  const shape = useMemo(() => {
    const s = roundedRect(new Shape(), 0.36, 0.07, 0.03);
    s.holes.push(roundedRect(new Path(), 0.28, 0.028, 0.01));
    return s;
  }, []);
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} material={polymerWhite} castShadow>
      <extrudeGeometry args={[shape, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3 }]} />
    </mesh>
  );
}

// ---- The carton: a small box of ten vials with a printed line and its NFC sticker.

function labelTexture(text: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#86868b";
  ctx.font = '500 26px "SF Pro Text", -apple-system, sans-serif';
  ctx.fillText(text, 28, 216);
  ctx.fillStyle = "#1d1d1f";
  ctx.font = '600 34px "SF Pro Display", -apple-system, sans-serif';
  ctx.fillText("OPV", 28, 62);
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function Carton({ scale = 1, position, rotation, turn }: { scale?: number; position?: [number, number, number]; rotation?: [number, number, number]; turn?: number }) {
  const tex = useMemo(() => labelTexture("10 vials · 20 doses"), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const W = 1;
  const H = 0.47;
  const D = 0.63;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group rotation={[0, turn ?? 0, 0]} position={[0, H / 2, 0]}>
        <RoundedBox args={[W, H, D]} radius={0.025} smoothness={4} material={card} castShadow receiveShadow />
        <mesh position={[0, 0, D / 2 + 0.002]}>
          <planeGeometry args={[W * 0.92, H * 0.86]} />
          <meshStandardMaterial map={tex} roughness={0.85} />
        </mesh>
        <Sticker radius={0.13} position={[W * 0.22, H / 2 + 0.002, -D * 0.12]} />
      </group>
    </group>
  );
}

/** A round NFC sticker: white, with a ring and a dot in black. */
export function Sticker({ radius, position }: { radius: number; position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh material={paper} castShadow>
        <cylinderGeometry args={[radius, radius, 0.004, 48]} />
      </mesh>
      <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.5, radius * 0.62, 48]} />
        <meshStandardMaterial color="#1d1d1f" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.16, 32]} />
        <meshStandardMaterial color="#1d1d1f" roughness={0.7} />
      </mesh>
    </group>
  );
}

// ---- The sensor puck: two shells, a lit ring, a board and a cell. Explodes on its axis.

/** A puck shell: a disc with a filleted edge, turned on a lathe. */
function shell(radius: number, height: number, fillet: number): LatheGeometry {
  const pts: Vector2[] = [new Vector2(0, 0), new Vector2(radius - fillet, 0)];
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    pts.push(new Vector2(radius - fillet + Math.sin(a) * fillet, fillet - Math.cos(a) * fillet));
  }
  pts.push(new Vector2(radius, height - fillet));
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    pts.push(new Vector2(radius - fillet + Math.cos(a) * fillet, height - fillet + Math.sin(a) * fillet));
  }
  pts.push(new Vector2(0, height));
  const g = new LatheGeometry(pts, 96);
  g.computeVertexNormals();
  return g;
}

export function Puck({ drive, explode }: { drive: Drive; explode: (p: number) => number }) {
  const top = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const board = useRef<Group>(null);
  const bottom = useRef<Mesh>(null);
  const topG = useMemo(() => shell(0.5, 0.075, 0.03), []);
  const bottomG = useMemo(() => shell(0.5, 0.06, 0.03), []);
  useEffect(
    () => () => {
      topG.dispose();
      bottomG.dispose();
    },
    [topG, bottomG],
  );
  useFrame(() => {
    const e = explode(drive.p);
    if (top.current) top.current.position.y = 0.085 + e * 0.42;
    if (ring.current) ring.current.position.y = 0.075 + e * 0.26;
    if (board.current) board.current.position.y = 0.062 + e * 0.13;
    if (bottom.current) bottom.current.position.y = -e * 0.14;
  });
  return (
    <group>
      <mesh ref={bottom} geometry={bottomG} material={polymerWhite} castShadow receiveShadow />
      <RoundedBox args={[0.5, 0.05, 0.34]} radius={0.02} smoothness={3} material={cell} position={[0, 0.04, 0]} castShadow />
      <group ref={board}>
        <mesh material={pcb} castShadow>
          <cylinderGeometry args={[0.44, 0.44, 0.012, 64]} />
        </mesh>
        <RoundedBox args={[0.12, 0.03, 0.12]} radius={0.006} material={aluminium} position={[-0.14, 0.02, 0.08]} castShadow />
        <RoundedBox args={[0.2, 0.02, 0.12]} radius={0.006} material={aluminium} position={[0.12, 0.016, -0.06]} castShadow />
        <mesh position={[0.05, 0.014, 0.16]} material={graphite}>
          <boxGeometry args={[0.05, 0.016, 0.05]} />
        </mesh>
      </group>
      <mesh ref={ring} material={teal}>
        <torusGeometry args={[0.498, 0.009, 16, 128]} />
      </mesh>
      <mesh ref={top} geometry={topG} material={polymerWhite} castShadow receiveShadow>
        <mesh position={[0.5, 0.04, 0]} rotation={[0, 0, Math.PI / 2]} material={graphite}>
          <boxGeometry args={[0.01, 0.02, 0.12]} />
        </mesh>
        <Mark size={0.3} position={[0, 0.0755, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      </mesh>
    </group>
  );
}

// ---- The location tag: a rounded oval with a lanyard hole.

export function Tag() {
  return (
    <group>
      <RoundedBox args={[0.4, 0.09, 0.3]} radius={0.045} smoothness={5} material={polymerWhite} castShadow receiveShadow />
      <mesh position={[0.15, 0, 0]} rotation={[Math.PI / 2, 0, 0]} material={graphite}>
        <torusGeometry args={[0.03, 0.008, 12, 32]} />
      </mesh>
    </group>
  );
}

// ---- The vial: glass, liquid, a crimp cap, a label, and the VVM whose square darkens.

function vvmTexture(): { texture: CanvasTexture; paint: (t: number) => void } {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const texture = new CanvasTexture(c);
  const paint = (t: number) => {
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = "#5b3e9b";
    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, Math.PI * 2);
    ctx.fill();
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
    ctx.fillStyle = `rgb(${mix(255, 91)}, ${mix(255, 62)}, ${mix(255, 155)})`;
    ctx.fillRect(72, 72, 112, 112);
    texture.needsUpdate = true;
  };
  paint(0);
  return { texture, paint };
}

export function Vial({ drive, darken }: { drive: Drive; darken: (p: number) => number }) {
  const vvm = useMemo(vvmTexture, []);
  useEffect(() => () => vvm.texture.dispose(), [vvm]);
  const last = useRef(-1);
  useFrame(() => {
    const t = darken(drive.p);
    if (Math.abs(t - last.current) > 0.01) {
      last.current = t;
      vvm.paint(t);
    }
  });
  const body = useMemo(() => {
    const pts = [
      new Vector2(0, 0),
      new Vector2(0.2, 0),
      new Vector2(0.235, 0.03),
      new Vector2(0.24, 0.55),
      new Vector2(0.22, 0.62),
      new Vector2(0.13, 0.68),
      new Vector2(0.125, 0.8),
      new Vector2(0.15, 0.8),
      new Vector2(0.15, 0.86),
      new Vector2(0, 0.86),
    ];
    return new LatheGeometry(pts, 96);
  }, []);
  const inside = useMemo(() => {
    const pts = [new Vector2(0, 0.02), new Vector2(0.2, 0.02), new Vector2(0.205, 0.05), new Vector2(0.21, 0.42), new Vector2(0, 0.42)];
    return new LatheGeometry(pts, 64);
  }, []);
  useEffect(
    () => () => {
      body.dispose();
      inside.dispose();
    },
    [body, inside],
  );
  return (
    <group>
      <mesh geometry={inside} material={liquid} />
      <mesh geometry={body} material={glass} castShadow />
      <mesh position={[0, 0.86, 0]} material={aluminium} castShadow>
        <cylinderGeometry args={[0.165, 0.165, 0.09, 64]} />
      </mesh>
      <mesh position={[0, 0.915, 0]} material={graphite}>
        <cylinderGeometry args={[0.12, 0.12, 0.02, 48]} />
      </mesh>
      <mesh position={[0, 0.34, 0]} material={paper}>
        <cylinderGeometry args={[0.243, 0.243, 0.24, 96, 1, true]} />
      </mesh>
      <mesh position={[0, 0.34, 0.244]}>
        <circleGeometry args={[0.075, 48]} />
        <meshStandardMaterial map={vvm.texture} transparent roughness={0.8} />
      </mesh>
    </group>
  );
}

export { between, ease };
