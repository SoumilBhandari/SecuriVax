import { useGLTF } from "@react-three/drei";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, Box3, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, SRGBColorSpace, Vector3 } from "three";

import lockupUrl from "../../assets/brand/securivax-lockup-horizontal-light.svg";
import type { Drive } from "./drive";

/**
 * The node itself: the team's CAD, straight from Onshape (the board with its
 * ESP32-C3, the cell, and the two halves of the case), assembled into
 * `/hero/models/device.glb` by `web/hero-src/device/build.mjs`.
 *
 * The four parts are named nodes, so the page takes the case apart as the
 * reader scrolls: the lid rises, the cell and the board come out behind it,
 * and the base settles. Onshape's materials are flat fills, so every surface
 * is restyled here against the same palette the drawn objects use.
 */
const URL = "/hero/models/device.glb";

useGLTF.preload(URL);

/** How far each part travels from its place in the case, in metres, fully open. */
const LIFT: Record<string, number> = {
  TopCover: 0.098,
  Battery: 0.056,
  Board: 0.023,
  LowCover: -0.018,
};

/** The lid tips a little as it comes off, so it reads as a lid and not a slab. */
const TILT = 0.16;

/** The lid is the brighter half, so the seam between the two reads as a line. */
const lidWhite = () => new MeshPhysicalMaterial({ color: "#f4f4f6", roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.24 });
const baseWhite = () => new MeshPhysicalMaterial({ color: "#e3e3e8", roughness: 0.42, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.34 });

/** An SVG painted into a texture of a given size, at that aspect. */
function useSvg(url: string, width: number, height: number): CanvasTexture {
  const invalidate = useThree((s) => s.invalidate);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, width, height);
      const s = Math.min(width / img.width, height / img.height);
      ctx.drawImage(img, (width - img.width * s) / 2, (height - img.height * s) / 2, img.width * s, img.height * s);
      t.needsUpdate = true;
      invalidate();
    };
    img.src = url;
    return t;
  }, [url, width, height, invalidate]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/** A soft round glow, for the status light. */
function useGlow(): CanvasTexture {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(53,208,195,0.85)");
    g.addColorStop(0.45, "rgba(53,208,195,0.22)");
    g.addColorStop(1, "rgba(53,208,195,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/**
 * What is printed on the lid: the lockup along the length, and the status
 * light near the end, lit. Both ride on the lid, so they leave with it.
 */
function Badging({ top, length }: { top: number; length: number }) {
  const lockup = useSvg(lockupUrl, 1024, 241);
  const glow = useGlow();
  const printed = length * 0.46; // the lockup runs along about half the lid
  const y = top + 0.00006;

  return (
    <group>
      {/* Printed to read from the side the chapters look from, not the far side. */}
      <mesh position={[0, y, length * 0.04]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[printed, printed / 4.25]} />
        <meshStandardMaterial map={lockup} transparent side={DoubleSide} roughness={0.45} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      {/* The status light: a small lit pinhole with a soft bloom over it. */}
      <mesh position={[0, y, -length * 0.36]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.0009, 24]} />
        <meshStandardMaterial color="#35d0c3" emissive="#35d0c3" emissiveIntensity={1.8} roughness={0.3} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <mesh position={[0, y + 0.0002, -length * 0.36]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.0055, 0.0055]} />
        <meshBasicMaterial map={glow} transparent opacity={0.75} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * Onshape writes one flat fill per colour and exports the board itself white,
 * so colour alone can't say what a surface is. The board's own substrate is
 * found by area (it is the one big flat thing in there) and painted as a
 * board; everything else is read from the colour it was given: black plastic,
 * gold pads, a metal can, a white package.
 */
function restyle(source: MeshStandardMaterial, part: string, substrate: boolean): MeshStandardMaterial {
  if (part === "TopCover") return lidWhite();
  if (part === "LowCover") return baseWhite();
  if (substrate) return new MeshStandardMaterial({ color: "#11251d", roughness: 0.52, metalness: 0.12 });

  const c = source.color ?? new Color("#888888");
  const lumi = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const sat = max <= 0 ? 0 : (max - min) / max;

  if (lumi < 0.06) return new MeshStandardMaterial({ color: "#141618", roughness: 0.64, metalness: 0.06 });
  if (part === "Battery" && sat < 0.1) return new MeshStandardMaterial({ color: "#3a3a3e", roughness: 0.42, metalness: 0.45 });
  if (sat > 0.3 && c.r >= c.g && c.g > c.b) return new MeshStandardMaterial({ color: c, metalness: 0.9, roughness: 0.28 }); // gold pads and pins
  if (sat < 0.12 && lumi > 0.88) return new MeshStandardMaterial({ color: "#e8e8ea", roughness: 0.5, metalness: 0 }); // white packages
  if (sat < 0.12 && lumi > 0.3) return new MeshStandardMaterial({ color: c, metalness: 0.82, roughness: 0.3 }); // cans and shields
  return new MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1 });
}

/** Which named part an object belongs to. */
function partOf(o: Object3D): string {
  let e: Object3D | null = o;
  while (e) {
    if (LIFT[e.name] !== undefined) return e.name;
    e = e.parent;
  }
  return "";
}

/**
 * The scene is built around objects about half a unit across; the node is
 * 70 mm. Drawing it at eight times life size keeps one set of lights, shadow
 * cameras and framing numbers working for every chapter.
 */
const SCALE = 8;

export function Device({ drive, open }: { drive: Drive; open: (p: number) => number }) {
  const { scene } = useGLTF(URL);
  const root = useRef<Group>(null);

  // One copy per chapter, restyled once.
  const model = useMemo(() => {
    const copy = scene.clone(true);

    // The board's substrate: the widest flat thing under the Board node.
    const board = copy.getObjectByName("Board");
    let substrate: Object3D | null = null;
    if (board) {
      const box = new Box3();
      const size = new Vector3();
      let widest = 0;
      board.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        box.setFromObject(o).getSize(size);
        const area = size.x * size.z;
        if (area > widest) {
          widest = area;
          substrate = o;
        }
      });
    }

    // Where the lid's top face is, in the lid's own frame, and how long it is.
    const lid = copy.getObjectByName("TopCover");
    let badge: { top: number; length: number } | null = null;
    if (lid) {
      const lidBox = new Box3().setFromObject(lid);
      badge = { top: lidBox.max.y - lid.position.y, length: lidBox.max.z - lidBox.min.z };
    }

    const made: MeshStandardMaterial[] = [];
    copy.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const source = mesh.material as MeshStandardMaterial;
      const next = restyle(source, partOf(mesh), o === substrate);
      made.push(next);
      mesh.material = next;
    });
    return { copy, made, lid, badge };
  }, [scene]);

  useEffect(() => () => model.made.forEach((m) => m.dispose()), [model]);

  // Where each part sits when the case is shut, so the lift is an offset.
  const parts = useMemo(
    () =>
      Object.keys(LIFT)
        .map((name) => model.copy.getObjectByName(name))
        .filter((o): o is Object3D => Boolean(o))
        .map((o) => ({ o, name: o.name, y: o.position.y, rotX: o.rotation.x })),
    [model],
  );

  useFrame(() => {
    const e = open(drive.p);
    for (const part of parts) {
      part.o.position.y = part.y + LIFT[part.name] * e;
      if (part.name === "TopCover") part.o.rotation.x = part.rotX + TILT * e;
    }
  });

  return (
    <group ref={root} scale={SCALE}>
      <primitive object={model.copy} />
      {model.lid && model.badge && createPortal(<Badging top={model.badge.top} length={model.badge.length} />, model.lid)}
    </group>
  );
}
