import { ContactShadows, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { forwardRef, Suspense, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Group, MathUtils, PMREMGenerator, type PerspectiveCamera as Cam, Vector3 } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import type { Anchor, Ground } from "../placeholders";
import { Device } from "./device";
import { between, type Drive } from "./drive";
import { SenseScene } from "./sense";
import { TagScene } from "./tag";

export interface ObjectViewHandle {
  set(progress: number, at: Anchor, extra?: { spin?: number; bob?: number }): void;
}

/** What each sequence shows, how the camera moves through it, and how big it is. */
interface Shot {
  /** Bounding radius of the object in scene units, for framing. */
  radius: number;
  /** Where the object's centre is, so the camera looks there. */
  centre: [number, number, number];
  /** Camera orbit: [azimuth, elevation] in radians at p = 0 and p = 1. */
  orbit: [[number, number], [number, number]];
  /** Distance multiplier at p = 0 and p = 1 (1 = fills the frame's height comfortably). */
  dolly: [number, number];
  fov: number;
  render: (drive: Drive) => React.ReactNode;
}

const SHOTS: Record<string, Shot> = {
  A: {
    radius: 0.38,
    centre: [0, 0.11, 0],
    orbit: [
      [1.12, 0.42],
      [0.88, 0.62],
    ],
    dolly: [1.02, 1.3],
    fov: 30,
    render: (d) => <Device drive={d} open={(p) => between(p, 0.14, 0.86)} />,
  },
  B: {
    radius: 0.58,
    centre: [0.08, 0.24, 0],
    orbit: [
      [0.34, 0.26],
      [0.06, 0.38],
    ],
    dolly: [1.06, 0.96],
    fov: 30,
    render: (d) => <TagScene drive={d} />,
  },
  C: {
    // The node and a phone side by side: seen from the front, so the screen
    // is readable, and wide enough to hold both.
    radius: 1.05,
    centre: [0.16, 0.34, 0],
    orbit: [
      [0.44, 0.26],
      [0.24, 0.36],
    ],
    dolly: [1.04, 0.98],
    fov: 30,
    render: (d) => <SenseScene drive={d} />,
  },
  F: {
    radius: 0.33,
    centre: [0, 0.075, 0],
    orbit: [
      [1.18, 0.34],
      [0.96, 0.46],
    ],
    dolly: [1.0, 1.16],
    fov: 30,
    render: (d) => <Device drive={d} open={() => 0} />,
  },
};

/**
 * One chapter's object, rendered live: a camera that orbits and dollies with
 * the chapter's progress, the object lit by a studio environment and a soft
 * key light, and a contact shadow under it. The anchor shifts and scales the
 * object in the frame so words can share it.
 */
export const ObjectView = forwardRef<ObjectViewHandle, { id: string; ground: Ground; initial: Anchor; onReady?: () => void; onLost?: () => void }>(
  function ObjectView({ id, ground, initial, onReady, onLost }, ref) {
  const drive = useRef<Drive & { at: Anchor; spin: number; bob: number; invalidate: () => void }>({ p: 0, at: initial, spin: 0, bob: 0, invalidate: () => {} });
  useImperativeHandle(ref, () => ({
    set(p, at, extra) {
      drive.current.p = p;
      drive.current.at = at;
      drive.current.spin = extra?.spin ?? 0;
      drive.current.bob = extra?.bob ?? 0;
      drive.current.invalidate();
    },
  }));
  const shot = SHOTS[id];
  if (!shot) return null;
  const phone = typeof window !== "undefined" && window.innerWidth < 768;
  return (
    <Canvas
      frameloop="demand"
      // A phone runs four of these chapters at once, each with its own context
      // and environment map. At this size the extra pixels and the multisample
      // buy nothing anyone can see, and they are what makes a mid-range phone
      // drop a context part way down the page.
      dpr={phone ? [1, 1.5] : [1, 2]}
      shadows={!phone}
      gl={{ antialias: !phone, alpha: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0, background: "transparent" }}
      onCreated={({ gl, invalidate }) => {
        gl.localClippingEnabled = true;
        drive.current.invalidate = invalidate;
        // Proof that a context really exists. Creating one can fail inside a
        // promise, where a React error boundary never sees it, so the chapter
        // waits for this instead of assuming.
        onReady?.();
        gl.domElement.addEventListener("webglcontextlost", () => onLost?.());
      }}
    >
      <Studio ground={ground} />
      <Suspense fallback={null}>
        <Rig shot={shot} drive={drive.current} />
      </Suspense>
    </Canvas>
  );
});

/** Studio lighting: a room environment for reflections and fill, one soft key with shadows. */
function Studio({ ground }: { ground: Ground }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = ground === "dark" ? 0.5 : 0.62;
    invalidate();
    return () => {
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, ground, invalidate]);
  return (
    <>
      <directionalLight position={[-2.5, 4.5, 3]} intensity={ground === "dark" ? 2.0 : 2.3} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-radius={6}>
        <orthographicCamera attach="shadow-camera" args={[-2, 2, 2, -2, 0.5, 12]} />
      </directionalLight>
      <directionalLight position={[3, 1.5, 1]} intensity={ground === "dark" ? 0.5 : 0.6} />
      <directionalLight position={[1, 3, -4]} intensity={ground === "dark" ? 1.4 : 0.9} />
    </>
  );
}

/** The camera and the object, placed by the chapter's progress and anchor every frame. */
function Rig({ shot, drive }: { shot: Shot; drive: Drive & { at: Anchor; spin: number; bob: number } }) {
  const cam = useRef<Cam>(null);
  const group = useRef<Group>(null);
  const { size, invalidate } = useThree();
  const centre = useMemo(() => new Vector3(...shot.centre), [shot]);
  const tmp = useMemo(() => new Vector3(), []);

  // Re-render when the box resizes or the object first mounts.
  useEffect(() => {
    invalidate();
  }, [size, invalidate]);

  useFrame(() => {
    const c = cam.current;
    const g = group.current;
    if (!c || !g) return;
    const p = drive.p;
    const { at } = drive;
    const az = MathUtils.lerp(shot.orbit[0][0], shot.orbit[1][0], p) + drive.spin;
    const el = MathUtils.lerp(shot.orbit[0][1], shot.orbit[1][1], p);
    const dolly = MathUtils.lerp(shot.dolly[0], shot.dolly[1], p);
    // Distance so the object's bounding sphere fills about 62% of the frame's height.
    const fill = 0.62 * Math.max(0.35, at.scale);
    const dist = (shot.radius / (fill * Math.tan(MathUtils.degToRad(shot.fov) / 2))) * dolly;
    c.fov = shot.fov;
    c.aspect = size.width / size.height;
    c.updateProjectionMatrix();
    c.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist).add(centre);
    c.lookAt(centre);
    // Shift the object in the frame by the anchor: move the group across the view plane.
    const visibleH = 2 * dist * Math.tan(MathUtils.degToRad(shot.fov) / 2);
    const dx = (at.ax - 0.5) * visibleH * c.aspect;
    const dy = (0.5 - at.ay) * visibleH;
    tmp.set(dx, dy + drive.bob, 0).applyQuaternion(c.quaternion);
    g.position.copy(tmp);
  });

  return (
    <>
      <PerspectiveCamera ref={cam} makeDefault fov={shot.fov} near={0.05} far={50} position={[0, 1, 4]} />
      <group ref={group}>
        {shot.render(drive)}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.7} scale={3.2} blur={2.2} far={1.6} resolution={512} frames={1} />
      </group>
    </>
  );
}
