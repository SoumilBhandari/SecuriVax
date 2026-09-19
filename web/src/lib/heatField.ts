import type { HeatGrid } from "../types";

/**
 * Temperature to colour for the forecast field: the blue-to-red scale weather
 * maps use (ColorBrewer's RdYlBu), so it reads at a glance. It's labelled in
 * °C on the page, apart from the verdict badges.
 */
export const HEAT_STOPS: [number, [number, number, number]][] = [
  [8, [49, 54, 149]],
  [14, [69, 117, 180]],
  [19, [116, 173, 209]],
  [23, [171, 217, 233]],
  [26, [254, 224, 144]],
  [30, [253, 174, 97]],
  [34, [244, 109, 67]],
  [38, [215, 48, 39]],
  [42, [165, 0, 38]],
];
export const HEAT_LINE_C = 30;
const OPACITY = 0.62;

export function heatColour(t: number): [number, number, number] {
  if (t <= HEAT_STOPS[0][0]) return HEAT_STOPS[0][1];
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = HEAT_STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * f) as [number, number, number];
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const fromMercY = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

/** A grid value at a fractional row/column, bilinear over the cells that have data. */
function sample(g: HeatGrid, frame: (number | null)[], row: number, col: number): number | null {
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
  return weight > 0.02 ? sum / weight : null;
}

/** Outside temperature at a point, from one frame of the field. */
export function heatAt(g: HeatGrid, frameIndex: number, lat: number, lon: number): number | null {
  return sample(g, g.frames[frameIndex], (g.lats[0] - lat) / g.step_deg, (lon - g.lons[0]) / g.step_deg);
}

/**
 * One frame as an image for the map, drawn in the map's own (Mercator)
 * projection so it lines up with the land at any zoom: sampled per pixel,
 * softened, faded out at the edge of the region, then the 30 °C line drawn
 * crisp on top. Returns a data URL.
 */
export function renderHeat(g: HeatGrid, frameIndex: number, lineColour: string): string {
  const [[south, west], [north, east]] = g.bounds;
  const perCell = 14;
  const width = g.cols * perCell;
  const yTop = mercY(north);
  const yBottom = mercY(south);
  const height = Math.round((width * (yTop - yBottom)) / (((east - west) * Math.PI) / 180));
  const frame = g.frames[frameIndex];

  // 1. The field, per pixel.
  const temps = new Float32Array(width * height).fill(NaN);
  for (let y = 0; y < height; y++) {
    const lat = fromMercY(yTop - ((y + 0.5) / height) * (yTop - yBottom));
    const row = (g.lats[0] - lat) / g.step_deg;
    for (let x = 0; x < width; x++) {
      const lon = west + ((x + 0.5) / width) * (east - west);
      const t = sample(g, frame, row, (lon - g.lons[0]) / g.step_deg);
      if (t != null) temps[y * width + x] = t;
    }
  }
  const field = document.createElement("canvas");
  field.width = width;
  field.height = height;
  const fctx = field.getContext("2d")!;
  const img = fctx.createImageData(width, height);
  const edge = perCell * 2.5; // fade the region's border out over a couple of cells
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = temps[i];
      if (Number.isNaN(t)) continue;
      const border = Math.min(x, y, width - 1 - x, height - 1 - y);
      const fade = Math.min(1, border / edge);
      const [r, gr, b] = heatColour(t);
      img.data.set([r, gr, b, Math.round(OPACITY * fade * fade * 255)], i * 4);
    }
  }
  fctx.putImageData(img, 0, 0);

  // 2. Softened: the grid is coarse, and a gentle blur hides its facets.
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  ctx.filter = `blur(${Math.round(perCell * 0.45)}px)`;
  ctx.drawImage(field, 0, 0);
  ctx.filter = "none";

  // 3. The 30 °C line, crisp: pixels where the field crosses it.
  const line = lineColour.match(/\d+/g)?.map(Number) ?? [11, 37, 69];
  const lineImg = ctx.getImageData(0, 0, width, height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const t = temps[i];
      if (Number.isNaN(t) || Math.min(x, y, width - 1 - x, height - 1 - y) < edge) continue;
      const right = temps[i + 1];
      const below = temps[i + width];
      const crosses = [right, below].some((n) => !Number.isNaN(n) && (t - HEAT_LINE_C) * (n - HEAT_LINE_C) < 0);
      if (crosses) lineImg.data.set([line[0], line[1], line[2], 200], i * 4);
    }
  }
  ctx.putImageData(lineImg, 0, 0);
  return out.toDataURL("image/png");
}
