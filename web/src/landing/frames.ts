/**
 * The hero render: frame sequences scrubbed by scroll, described by
 * /hero/manifest.json (written by the render pipeline in docs/hero-3d-brief.md).
 * Until the render lands the manifest is missing and every chapter draws its
 * placeholder instead, so the page works end to end either way.
 */

export interface SequenceInfo {
  id: string;
  name: string;
  ground: "light" | "dark";
  frames: number;
  crops: Record<"landscape" | "portrait", { width: number; height: number }>;
}

export interface Manifest {
  sequences: SequenceInfo[];
}

export type Crop = "landscape" | "portrait";

let manifest: Promise<Manifest | null> | null = null;

/** The manifest, fetched once; null when there's no render yet. */
function loadManifest(): Promise<Manifest | null> {
  if (!manifest) {
    manifest = fetch("/hero/manifest.json", { cache: "force-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null);
  }
  return manifest;
}

const PARALLEL = 6;

/**
 * One sequence's frames for one crop, loaded in the background a few at a
 * time. `at(progress)` returns the nearest frame that has arrived, so the
 * canvas never waits: early scrolls show the closest loaded frame.
 */
export class Frames {
  readonly images: (HTMLImageElement | null)[];
  private started = false;

  constructor(
    readonly info: SequenceInfo,
    readonly crop: Crop,
  ) {
    this.images = new Array(info.frames).fill(null);
  }

  url(i: number): string {
    return `/hero/${this.info.id}/${this.crop}/${String(i + 1).padStart(4, "0")}.webp`;
  }

  /** Start loading; the first, middle and last frames come first. */
  start(onFrame?: () => void): void {
    if (this.started) return;
    this.started = true;
    const n = this.info.frames;
    const order = [0, n - 1, Math.floor(n / 2), ...Array.from({ length: n }, (_, i) => i)];
    const seen = new Set<number>();
    const queue = order.filter((i) => !seen.has(i) && seen.add(i));
    let inFlight = 0;
    const next = () => {
      while (inFlight < PARALLEL && queue.length) {
        const i = queue.shift()!;
        inFlight++;
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          this.images[i] = img;
          inFlight--;
          onFrame?.();
          next();
        };
        img.onerror = () => {
          inFlight--;
          next();
        };
        img.src = this.url(i);
      }
    };
    next();
  }

  /** The frame for a progress in [0, 1], or the nearest one that has loaded. */
  at(progress: number): HTMLImageElement | null {
    const n = this.info.frames;
    const want = Math.max(0, Math.min(n - 1, Math.round(progress * (n - 1))));
    if (this.images[want]) return this.images[want];
    for (let d = 1; d < n; d++) {
      const lo = want - d;
      const hi = want + d;
      if (lo >= 0 && this.images[lo]) return this.images[lo];
      if (hi < n && this.images[hi]) return this.images[hi];
    }
    return null;
  }
}

const cache = new Map<string, Frames>();

/** The frames for a sequence id in a crop, shared across the page. */
export async function framesFor(id: string, crop: Crop): Promise<Frames | null> {
  const m = await loadManifest();
  const info = m?.sequences.find((s) => s.id === id);
  if (!info) return null;
  const key = `${id}:${crop}`;
  let f = cache.get(key);
  if (!f) {
    f = new Frames(info, crop);
    cache.set(key, f);
  }
  return f;
}
