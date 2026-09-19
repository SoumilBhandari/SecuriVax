/**
 * The device, assembled from the four Onshape exports into one glb whose four
 * root nodes the page can move independently: TopCover, Battery, Board,
 * LowCover. Every part is exported in its own frame, so each is recentred and
 * then placed in a stack that is tidy when closed and reads when exploded.
 * Real-world metres throughout: the case is 30 x 18 x 70 mm.
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { dedup, mergeDocuments, prune, unpartition, weld } from "@gltf-transform/functions";

const io = new NodeIO();

// mm -> m
const mm = (v) => v / 1000;

/** The bounding box of a scene, in its own frame, after node transforms. */
function bounds(doc) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const p = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
        lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x);
        lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y);
        lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z);
      }
    }
  }
  return { lo, hi, size: hi.map((v, i) => v - lo[i]), centre: hi.map((v, i) => (v + lo[i]) / 2) };
}

const parts = [
  // name, file, quarter turns about X (the battery lies flat), the base height in mm
  { name: "LowCover", file: "low.gltf", rotX: 0, baseY: 0 },
  { name: "Board", file: "board.gltf", rotX: 0, baseY: 3 },
  { name: "Battery", file: "battery.gltf", rotX: -1, baseY: 9.5 },
  { name: "TopCover", file: "top.gltf", rotX: 0, baseY: 16 },
];

const out = new Document();
const scene = out.createScene("device");

for (const part of parts) {
  const doc = await io.read(part.file);
  const b = bounds(doc);
  console.log(`${part.name.padEnd(9)} raw size(mm) = ${b.size.map((v) => (v * 1000).toFixed(1)).join(" x ")}`);

  mergeDocuments(out, doc);
  // The merged document brings its own scene: take its roots and drop it.
  const scenes = out.getRoot().listScenes().filter((s) => s !== scene);
  const group = out.createNode(part.name);
  for (const s of scenes) {
    for (const child of s.listChildren()) group.addChild(child);
    s.dispose();
  }

  // Recentre the part on its own centre, turn it, then sit it at its height.
  const inner = out.createNode(`${part.name}__centred`);
  for (const child of group.listChildren()) inner.addChild(child);
  inner.setTranslation([-b.centre[0], -b.centre[1], -b.centre[2]]);
  group.addChild(inner);

  const q = part.rotX === 0 ? [0, 0, 0, 1] : [Math.sin((part.rotX * Math.PI) / 4), 0, 0, Math.cos((part.rotX * Math.PI) / 4)];
  group.setRotation(q);
  // Height of the part along Y once turned.
  const h = part.rotX === 0 ? b.size[1] : b.size[2];
  group.setTranslation([0, mm(part.baseY) + h / 2, 0]);
  scene.addChild(group);
}

await out.transform(dedup(), weld(), prune(), unpartition());

await io.write("device_raw.glb", out);
const after = bounds(out);
console.log("assembled size(mm) =", after.size.map((v) => (v * 1000).toFixed(1)).join(" x "), " base y(mm) =", (after.lo[1] * 1000).toFixed(1));
console.log("nodes:", out.getRoot().listScenes()[0].listChildren().map((n) => n.getName()).join(", "));
