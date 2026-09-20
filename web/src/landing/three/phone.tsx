import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";

/**
 * The phone in a health worker's hand, shared by the chapters that need one:
 * an iPhone at its own size, with a titanium rail, glass on both faces, the
 * island, the buttons and the camera plateau that shows whenever it tilts.
 *
 * The screen is a texture the caller paints, so each chapter shows whatever
 * the app would be showing at that moment.
 */
export const PHONE = { w: 71.6 / 1000, h: 147.6 / 1000, t: 7.8 / 1000, r: 9.5 / 1000, bezel: 2.2 / 1000 };

const MM = 1000;
const PX_PER_MM = 8;

export type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** A screen to paint in millimetres, and the texture it feeds. */
export function useScreen() {
  const screen = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(PHONE.w * MM * PX_PER_MM);
    canvas.height = Math.round(PHONE.h * MM * PX_PER_MM);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    const paint = (fn: Paint) => {
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(PX_PER_MM, 0, 0, PX_PER_MM, 0, 0);
      fn(ctx, PHONE.w * MM, PHONE.h * MM);
      tex.needsUpdate = true;
    };
    return { canvas, tex, paint };
  }, []);
  useEffect(() => () => screen.tex.dispose(), [screen]);
  return screen;
}

/** The corners, the island and the home line, over whatever a chapter drew. */
export function screenFurniture(ctx: CanvasRenderingContext2D, w: number, h: number, lit: number) {
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.roundRect(w / 2 - 12.5, 3.4, 25, 7.6, 3.8);
  ctx.fill();
  if (lit > 0.01) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.roundRect(w / 2 - 17, h - 5, 34, 1.4, 0.7);
    ctx.fill();
  }
}

/** Clip to the screen's own rounded corners, so the body shows at the edges. */
export function screenClip(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, (PHONE.r - PHONE.bezel) * MM);
  ctx.clip();
}

export function Phone({ screen }: { screen: Texture }) {
  return (
    <>
      <RoundedBox args={[PHONE.w, PHONE.h, PHONE.t]} radius={PHONE.r} smoothness={7} castShadow receiveShadow>
        <meshStandardMaterial color="#8e8e93" roughness={0.26} metalness={0.95} />
      </RoundedBox>
      <RoundedBox args={[PHONE.w - 0.0016, PHONE.h - 0.0016, PHONE.t + 0.0002]} radius={PHONE.r - 0.0008} smoothness={7}>
        <meshPhysicalMaterial color="#111114" roughness={0.16} metalness={0.2} clearcoat={1} clearcoatRoughness={0.08} />
      </RoundedBox>
      <mesh position={[0, 0, PHONE.t / 2 + 0.0002]}>
        <planeGeometry args={[PHONE.w - PHONE.bezel * 2, PHONE.h - PHONE.bezel * 2]} />
        <meshBasicMaterial map={screen} transparent toneMapped={false} />
      </mesh>
      {[0.026, 0.008, -0.012].map((y, i) => (
        <mesh key={i} position={[-PHONE.w / 2 - 0.0004, y, 0]}>
          <boxGeometry args={[0.0012, i === 0 ? 0.006 : 0.011, 0.0042]} />
          <meshStandardMaterial color="#8e8e93" roughness={0.26} metalness={0.95} />
        </mesh>
      ))}
      <mesh position={[PHONE.w / 2 + 0.0004, 0.014, 0]}>
        <boxGeometry args={[0.0012, 0.016, 0.0042]} />
        <meshStandardMaterial color="#8e8e93" roughness={0.26} metalness={0.95} />
      </mesh>
      <group position={[-PHONE.w / 2 + 0.019, PHONE.h / 2 - 0.019, -PHONE.t / 2 - 0.0012]}>
        <RoundedBox args={[0.032, 0.032, 0.0024]} radius={0.008} smoothness={5}>
          <meshPhysicalMaterial color="#17171a" roughness={0.22} metalness={0.35} clearcoat={0.8} />
        </RoundedBox>
        {[
          [-0.0065, 0.0065],
          [0.0065, 0.0065],
          [0, -0.0075],
        ].map(([x, y], i) => (
          <mesh key={i} position={[x, y, -0.0016]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.0052, 0.0052, 0.0016, 24]} />
            <meshPhysicalMaterial color="#0a0a0c" roughness={0.08} metalness={0.6} clearcoat={1} />
          </mesh>
        ))}
      </group>
    </>
  );
}
