import type { HeatGrid } from "../types";

/**
 * Temperature to colour for the forecast field. Not a verdict, so none of the
 * signal colours: cool is clear, then Glacier, sand, orange, plum and deep
 * purple for the hottest air. The 30 °C line (where the app starts counting
 * heat hours) is drawn over it.
 */
export const HEAT_STOPS: [number, [number, number, number, number]][] = [
  [16, [157, 235, 228, 0]],
  [21, [157, 235, 228, 0.3]],
  [26, [243, 222, 180, 0.45]],
  [30, [236, 146, 78, 0.58]],
  [35, [150, 44, 96, 0.66]],
  [40, [59, 15, 79, 0.74]],
];
export const HEAT_LINE_C = 30;

function colour(t: number): [number, number, number, number] {
  if (t <= HEAT_STOPS[0][0]) return HEAT_STOPS[0][1];
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = HEAT_STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2, 3].map((k) => c0[k] + (c1[k] - c0[k]) * f) as [number, number, number, number];
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const fromMercY = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

/** A grid value at a fractional row/column, bilinear over the cells that have
 * data, with how much of the neighbourhood had data (0-1, for fading the edge). */
function sampleWeighted(g: HeatGrid, frame: (number | null)[], row: number, col: number): [number, number] | null {
  const r0 = Math.max(0, Math.min(g.rows - 1, Math.floor(row)));
  const c0 = Math.max(0, Math.min(g.cols - 1, Math.floor(col)));
  const r1 = Math.min(g.rows - 1, r0 + 1);
  const c1 = Math.min(g.cols - 1, c0 + 1);
  const fr = Math.max(0, Math.min(1, row - r0));
  const fc = Math.max(0, Math.min(1, col - c0));
  let sum = 0;
  let weight = 0;
  for (const [r, c, w] of [
    [r0, c0, (1 - fr) * (1 - fc)],
    [r0, c1, (1 - fr) * fc],
    [r1, c0, fr * (1 - fc)],
    [r1, c1, fr * fc],
  ] as const) {
    const v = frame[r * g.cols + c];
    if (v != null && w > 0) {
      sum += v * w;
      weight += w;
    }
  }
  return weight > 0.02 ? [sum / weight, weight] : null;
}

function sample(g: HeatGrid, frame: (number | null)[], row: number, col: number): number | null {
  const got = sampleWeighted(g, frame, row, col);
  return got && got[1] > 0.25 ? got[0] : null;
}

/** Outside temperature at a point, from one frame of the field. */
export function heatAt(g: HeatGrid, frameIndex: number, lat: number, lon: number): number | null {
  return sample(g, g.frames[frameIndex], (g.lats[0] - lat) / g.step_deg, (lon - g.lons[0]) / g.step_deg);
}

/**
 * One frame as an image for the map, drawn in the map's own (Mercator)
 * projection so the heat lines up with the land at any zoom. Returns a data URL.
 */
export function renderHeat(g: HeatGrid, frameIndex: number, lineColour: string): string {
  const [[south, west], [north, east]] = g.bounds;
  const width = g.cols * 10;
  const yTop = mercY(north);
  const yBottom = mercY(south);
  const height = Math.round((width * (yTop - yBottom)) / (((east - west) * Math.PI) / 180));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  const frame = g.frames[frameIndex];
  const line = lineColour.match(/\d+/g)?.map(Number) ?? [11, 37, 69];
  const temps = new Float32Array(width * height).fill(NaN);
  const cover = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const lat = fromMercY(yTop - ((y + 0.5) / height) * (yTop - yBottom));
    const row = (g.lats[0] - lat) / g.step_deg;
    for (let x = 0; x < width; x++) {
      const lon = west + ((x + 0.5) / width) * (east - west);
      const got = sampleWeighted(g, frame, row, (lon - g.lons[0]) / g.step_deg);
      if (got) [temps[y * width + x], cover[y * width + x]] = got;
    }
  }
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    if (Number.isNaN(t)) continue;
    // The 30 °C line: where this pixel and its right or lower neighbour straddle it.
    const right = i % width < width - 1 ? temps[i + 1] : NaN;
    const below = i + width < temps.length ? temps[i + width] : NaN;
    const onLine = cover[i] > 0.5 && [right, below].some((n) => !Number.isNaN(n) && (t - HEAT_LINE_C) * (n - HEAT_LINE_C) <= 0 && t !== n);
    const [r, gr, b, a] = onLine ? [line[0], line[1], line[2], 0.9] : colour(t);
    // Ease the edge of the data in over the outer half cell.
    const fade = Math.min(1, cover[i] * cover[i] * 1.6);
    img.data.set([r, gr, b, Math.round(a * fade * 255)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
