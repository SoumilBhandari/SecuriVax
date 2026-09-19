import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, Color, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Vector3 } from "three";

import type { Drive } from "./objects";

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

const white = () => new MeshPhysicalMaterial({ color: "#eeeef1", roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.28 });

/**
 * Onshape writes one flat fill per colour and exports the board itself white,
 * so colour alone can't say what a surface is. The board's own substrate is
 * found by area (it is the one big flat thing in there) and painted as a
 * board; everything else is read from the colour it was given: black plastic,
 * gold pads, a metal can, a white package.
 */
function restyle(source: MeshStandardMaterial, part: string, substrate: boolean): MeshStandardMaterial {
  if (part === "TopCover" || part === "LowCover") return white();
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
    return { copy, made };
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
    </group>
  );
}
