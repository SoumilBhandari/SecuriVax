/** Scroll-driven values the objects read every frame: progress 0..1 of their chapter. */
export interface Drive {
  p: number;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/** Eased 0..1 for the stretch of a chapter between `a` and `b`. */
export const between = (t: number, a: number, b: number) => ease((t - a) / (b - a));
