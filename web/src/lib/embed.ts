// A box's trip as a point cloud: every reading becomes a vector of what the
// box was going through (inside and outside temperature, humidity, how fast
// the temperature moved, whether it was on the move), PCA flattens
// the vectors to 3-D for the picture, and k-means finds the groups. All of it
// runs on the report's own numbers: no model is asked anything.

import type { PointStatus, Report } from "../types";

export interface TripPoint {
  ts: number;
  temp: number;
  rh: number | null;
  outside: number | null;
  rate: number; // °C per hour since the reading before
  speed: number; // km/h since the reading before, from the carrier's position
  budgetStep: number; // share of the budget used since the reading before
  status: PointStatus;
  node: string;
  tz: string | null;
  stepS: number; // time this reading stands for
}

export interface TripGroup {
  id: number; // 1-based, coldest first
  name: string;
  color: string;
  members: number[];
  centre: [number, number, number]; // in the picture's space
  minutes: number;
  share: number; // of the monitored time
  meanTemp: number;
  minTemp: number;
  maxTemp: number;
  meanRh: number | null;
  meanOutside: number | null;
  freezeMin: number;
  heatMin: number;
  budget: number;
  budgetShare: number | null; // of what the whole trip used; null when it barely moved
  first: number;
  last: number;
  stretches: number;
  legs: string[];
  tz: string | null;
  examples: number[];
}

export interface TripCloud {
  points: TripPoint[];
  xyz: [number, number, number][];
  groups: TripGroup[];
  freezeLine: number;
}

const FEATURES: { key: string; weight: number }[] = [
  { key: "temp", weight: 2 },
  { key: "outside", weight: 1 },
  { key: "rh", weight: 0.7 },
  { key: "rate", weight: 1 },
  { key: "moving", weight: 1.2 },
];
// Not features: budget speed follows from temperature for one product (and the
// report rounds the budget, which would split groups on noise), and time of
// day is mostly the outside temperature again. Both still describe the groups.
const MIN_POINTS = 12;
const SPEED_WINDOW_S = 45 * 60;
const MOVING_KMH = 5;
const TRIP_BUDGET_FLOOR = 0.0005; // below this the trip used ~nothing: shares would be noise

export function embedTrip(report: Report): TripCloud | null {
  const points = tripPoints(report);
  if (points.length < MIN_POINTS) return null;

  // Feature matrix: fill a missing value with its column's mean, standardise,
  // drop columns that never change, weight what matters most (temperature).
  const raw = points.map(
    (p): Record<string, number | null> => ({
      temp: p.temp,
      outside: p.outside,
      rh: p.rh,
      rate: Math.sign(p.rate) * Math.log1p(Math.abs(p.rate)), // a jump between legs shouldn't outweigh a whole stretch
      moving: Math.log10(1 + p.speed),
    }),
  );
  const cols: number[][] = [];
  for (const { key, weight } of FEATURES) {
    const present = raw.map((r) => r[key]).filter((v): v is number => v != null && Number.isFinite(v));
    if (present.length < points.length / 2) continue;
    const mean = present.reduce((a, b) => a + b, 0) / present.length;
    const col = raw.map((r) => (r[key] != null && Number.isFinite(r[key]) ? (r[key] as number) : mean));
    const sd = Math.sqrt(col.reduce((a, v) => a + (v - mean) ** 2, 0) / col.length);
    if (sd < 1e-6) continue;
    cols.push(col.map((v) => ((v - mean) / sd) * weight));
  }
  if (cols.length === 0) return null;
  const X = points.map((_, i) => cols.map((c) => c[i]));

  const xyz = pca3(X);
  const labels = mergeAlike(points, bestKMeans(X));
  const groups = describe(points, xyz, X, labels, report.budget_used - report.initial_budget_used);
  return { points, xyz, groups, freezeLine: freezeLineOf(report) };
}

function freezeLineOf(report: Report): number {
  const lines = report.segments.map((s) => s.freeze_guard_c).filter((v): v is number => v != null);
  return lines.length ? Math.max(...lines) : -0.5;
}

function tripPoints(report: Report): TripPoint[] {
  const out: TripPoint[] = [];
  for (const seg of report.segments) {
    const series = seg.series ?? [];
    const track = [...(seg.route ?? [])].sort((a, b) => a.ts - b.ts);
    const status = new Map((seg.route ?? []).map((r) => [r.ts, r.status]));
    const ambient = seg.environment?.ambient ?? [];
    const gaps = series.slice(1).map((p, i) => p.ts - series[i].ts).sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 600;
    series.forEach((p, i) => {
      const prev = i > 0 ? series[i - 1] : null;
      const dt = prev ? Math.max(p.ts - prev.ts, 1) : typical;
      // Speed over ±45 min: trackers report less often than the thermometer.
      const before = nearestPoint(track, p.ts - SPEED_WINDOW_S);
      const after = nearestPoint(track, p.ts + SPEED_WINDOW_S);
      const span = before && after ? after.ts - before.ts : 0;
      out.push({
        ts: p.ts,
        temp: p.temp_c,
        rh: p.rh,
        outside: nearest(ambient, p.ts),
        rate: prev ? clamp(((p.temp_c - prev.temp_c) / dt) * 3600, -30, 30) : 0,
        speed: span >= 600 ? clamp(km(before!.lat, before!.lon, after!.lat, after!.lon) / (span / 3600), 0, 150) : 0,
        budgetStep: prev ? Math.max(0, p.budget - prev.budget) : 0,
        status: status.get(p.ts) ?? (p.temp_c <= (seg.freeze_guard_c ?? -0.5) ? "freeze" : "ok"),
        node: seg.node_label,
        tz: seg.tz ?? null,
        stepS: Math.min(dt, typical * 3), // a long gap isn't time the box spent in this state
      });
    });
  }
  return out;
}

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function nearestPoint<T extends { ts: number }>(track: T[], ts: number): T | null {
  if (!track.length) return null;
  let lo = 0;
  let hi = track.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(track[lo - 1].ts - ts) < Math.abs(track[lo].ts - ts) ? track[lo - 1] : track[lo];
}

function nearest(series: [number, number][], ts: number): number | null {
  if (!series.length) return null;
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] < ts) lo = mid + 1;
    else hi = mid;
  }
  const best = lo > 0 && Math.abs(series[lo - 1][0] - ts) < Math.abs(series[lo][0] - ts) ? lo - 1 : lo;
  return Math.abs(series[best][0] - ts) <= 3 * 3600 ? series[best][1] : null;
}

// ---- PCA: the three directions the readings differ along most.

function pca3(X: number[][]): [number, number, number][] {
  const d = X[0].length;
  const n = X.length;
  const C = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const row of X) for (let a = 0; a < d; a++) for (let b = a; b < d; b++) C[a][b] += row[a] * row[b];
  for (let a = 0; a < d; a++) for (let b = a; b < d; b++) C[b][a] = C[a][b] /= n;
  const { values, vectors } = jacobi(C);
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const axes = [0, 1, 2].map((k) => (k < d ? vectors.map((row) => row[order[k]]) : null));
  const out = X.map((row) => axes.map((ax) => (ax ? row.reduce((s, v, j) => s + v * ax[j], 0) : 0)) as [number, number, number]);
  // Scale so most readings fill the view; the few beyond ease in at the edge
  // instead of squeezing everyone else into the middle.
  const mags = out.flat().map(Math.abs).sort((a, b) => a - b);
  const scale = Math.max(mags[Math.floor(mags.length * 0.98)] ?? 0, 1e-9);
  const ease = (v: number) => (Math.abs(v) <= 1 ? v : Math.sign(v) * (1 + Math.tanh(Math.abs(v) - 1) * 0.35));
  return out.map((p) => p.map((v) => ease(v / scale)) as [number, number, number]);
}

/** Eigen-decomposition of a small symmetric matrix (cyclic Jacobi). */
function jacobi(A: number[][]): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-12) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: a.map((r, i) => r[i]), vectors: v };
}

// ---- k-means, with k picked by silhouette: the most groups (up to four) that
// separate nearly as cleanly as the cleanest split, and none of them a speck.

function bestKMeans(X: number[][]): number[] {
  const smallest = Math.max(3, Math.ceil(X.length * 0.02));
  const tries: { k: number; labels: number[]; score: number }[] = [];
  for (let k = 2; k <= Math.min(4, Math.floor(X.length / smallest)); k++) {
    const labels = kmeans(X, k);
    const sizes = Array.from({ length: k }, (_, g) => labels.filter((l) => l === g).length);
    if (Math.min(...sizes) < smallest) continue;
    tries.push({ k, labels, score: silhouette(X, labels) });
  }
  if (!tries.length) return X.map(() => 0);
  const top = Math.max(...tries.map((t) => t.score));
  const good = tries.filter((t) => t.score >= top - 0.08);
  return good[good.length - 1].labels;
}

function kmeans(X: number[][], k: number): number[] {
  const rand = mulberry32(2026 + k);
  const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  // k-means++ seeding, from a fixed seed so the same trip always draws the same way.
  const centres: number[][] = [X[Math.floor(rand() * X.length)].slice()];
  while (centres.length < k) {
    const d2 = X.map((x) => Math.min(...centres.map((c) => dist(x, c))));
    const total = d2.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let pick = 0;
    for (; pick < X.length - 1 && r > d2[pick]; pick++) r -= d2[pick];
    centres.push(X[pick].slice());
  }
  let labels = X.map(() => 0);
  for (let iter = 0; iter < 60; iter++) {
    const next = X.map((x) => {
      let bi = 0;
      let bd = Infinity;
      centres.forEach((c, i) => {
        const d = dist(x, c);
        if (d < bd) [bi, bd] = [i, d];
      });
      return bi;
    });
    const moved = next.some((l, i) => l !== labels[i]);
    labels = next;
    centres.forEach((c, i) => {
      const mine = X.filter((_, j) => labels[j] === i);
      if (mine.length) for (let f = 0; f < c.length; f++) c[f] = mine.reduce((s, x) => s + x[f], 0) / mine.length;
    });
    if (!moved) break;
  }
  // Renumber so empty groups don't leave holes.
  const used = [...new Set(labels)];
  return labels.map((l) => used.indexOf(l));
}

/**
 * k-means will happily split a steady trip at 4.3 vs 4.6 °C: sensor noise, not
 * a different condition. Join in-range groups that are the same in practice:
 * inside within 1 °C, outside within 5 °C, and both moving or both standing.
 */
function mergeAlike(points: TripPoint[], labels: number[]): number[] {
  const k = Math.max(...labels) + 1;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const stats = Array.from({ length: k }, (_, g) => {
    const ps = points.filter((_, i) => labels[i] === g);
    return {
      temp: avg(ps.map((p) => p.temp))!,
      outside: avg(ps.map((p) => p.outside).filter((v): v is number => v != null)),
      moving: avg(ps.map((p) => (p.speed > MOVING_KMH ? 1 : 0)))! > 0.5,
      inRange: ps.every((p) => p.status === "ok") || ps.filter((p) => p.status !== "ok").length / ps.length < 0.1,
    };
  });
  const root = Array.from({ length: k }, (_, g) => g);
  const find = (g: number): number => (root[g] === g ? g : (root[g] = find(root[g])));
  for (let a = 0; a < k; a++)
    for (let b = a + 1; b < k; b++) {
      const [x, y] = [stats[a], stats[b]];
      const sameOutside = x.outside == null || y.outside == null || Math.abs(x.outside - y.outside) < 5;
      if (x.inRange && y.inRange && x.moving === y.moving && Math.abs(x.temp - y.temp) < 1 && sameOutside) root[find(b)] = find(a);
    }
  const roots = [...new Set(labels.map(find))];
  return labels.map((l) => roots.indexOf(find(l)));
}

function silhouette(X: number[][], labels: number[]): number {
  const step = Math.max(1, Math.floor(X.length / 300));
  const idx = X.map((_, i) => i).filter((i) => i % step === 0);
  const k = Math.max(...labels) + 1;
  if (k < 2) return -1;
  const d = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
  let total = 0;
  for (const i of idx) {
    const sums = new Array<number>(k).fill(0);
    const counts = new Array<number>(k).fill(0);
    for (const j of idx) {
      if (i === j) continue;
      sums[labels[j]] += d(X[i], X[j]);
      counts[labels[j]]++;
    }
    const own = labels[i];
    const a = counts[own] ? sums[own] / counts[own] : 0;
    const b = Math.min(...sums.map((s, g) => (g === own || !counts[g] ? Infinity : s / counts[g])));
    total += counts[own] && Number.isFinite(b) ? (b - a) / Math.max(a, b) : 0;
  }
  return total / idx.length;
}

// ---- Words for each group, from its numbers.

const PALETTE = {
  freeze: ["#7c3aed", "#6366f1"],
  cold: ["#2563eb", "#0284c7"],
  ok: ["#059669", "#0d9488", "#65a30d", "#0891b2", "#16a34a"],
  warm: ["#ea580c", "#dc2626", "#d97706"],
};

function describe(
  points: TripPoint[],
  xyz: [number, number, number][],
  X: number[][],
  labels: number[],
  tripBudget: number,
): TripGroup[] {
  const k = Math.max(...labels) + 1;
  const total = points.reduce((s, p) => s + p.stepS, 0);
  const spent = points.reduce((s, p) => s + p.budgetStep, 0);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // Each group's numbers, plus what naming it needs (mean rate, hour, main leg).
  const drafts = Array.from({ length: k }, (_, g) => {
    const members = labels.flatMap((l, i) => (l === g ? [i] : []));
    const ps = members.map((i) => points[i]);
    const rh = ps.map((p) => p.rh).filter((v): v is number => v != null);
    const outside = ps.map((p) => p.outside).filter((v): v is number => v != null);
    const seconds = ps.reduce((s, p) => s + p.stepS, 0);
    const budget = ps.reduce((s, p) => s + p.budgetStep, 0);
    let stretches = 0;
    members.forEach((m, j) => {
      if (j === 0 || members[j - 1] !== m - 1) stretches++;
    });
    const legCount = new Map<string, number>();
    ps.forEach((p) => legCount.set(p.node, (legCount.get(p.node) ?? 0) + 1));
    const centreX = X[0].map((_, f) => mean(members.map((i) => X[i][f])));
    const examples = [...members]
      .sort((a, b) => X[a].reduce((s, v, f) => s + (v - centreX[f]) ** 2, 0) - X[b].reduce((s, v, f) => s + (v - centreX[f]) ** 2, 0))
      .slice(0, 3)
      .sort((a, b) => points[a].ts - points[b].ts);
    const group: TripGroup = {
      id: 0,
      name: "",
      color: "",
      members,
      centre: [0, 1, 2].map((a) => mean(members.map((i) => xyz[i][a]))) as [number, number, number],
      minutes: seconds / 60,
      share: total ? seconds / total : 0,
      meanTemp: mean(ps.map((p) => p.temp)),
      minTemp: Math.min(...ps.map((p) => p.temp)),
      maxTemp: Math.max(...ps.map((p) => p.temp)),
      meanRh: rh.length ? mean(rh) : null,
      meanOutside: outside.length ? mean(outside) : null,
      freezeMin: ps.filter((p) => p.status === "freeze").reduce((s, p) => s + p.stepS, 0) / 60,
      heatMin: ps.filter((p) => p.status === "heat").reduce((s, p) => s + p.stepS, 0) / 60,
      budget,
      budgetShare: tripBudget > TRIP_BUDGET_FLOOR && spent > 0 ? budget / spent : null,
      first: Math.min(...ps.map((p) => p.ts)),
      last: Math.max(...ps.map((p) => p.ts)),
      stretches,
      legs: [...legCount.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
      tz: ps[0]?.tz ?? null,
      examples,
    };
    return {
      group,
      meanRate: mean(ps.map((p) => p.rate)),
      meanHour: circularHour(ps),
      moving: mean(ps.map((p) => (p.speed > MOVING_KMH ? 1 : 0))) > 0.5,
      dominantLeg: [...legCount.entries()].find(([, c]) => c >= 0.8 * ps.length)?.[0] ?? null,
    };
  });

  drafts.sort((a, b) => a.group.meanTemp - b.group.meanTemp);
  const used = { freeze: 0, cold: 0, ok: 0, warm: 0 };
  drafts.forEach((d, i) => {
    const g = d.group;
    const band = g.freezeMin >= 30 ? "freeze" : g.heatMin >= g.minutes * 0.3 ? "warm" : g.meanTemp < 2 ? "cold" : g.meanTemp > 8 ? "warm" : "ok";
    const colors = PALETTE[band];
    const color = colors[used[band]++ % colors.length];
    let name: string;
    if (band === "freeze") name = "Freeze-exposed";
    else if (band === "cold") name = "Below 2 °C";
    else if (band === "warm") name = "Above 8 °C";
    else if (d.moving && g.meanOutside != null && g.meanOutside >= 30) name = "In range on a hot road";
    else if (d.meanRate > 1.5) name = "In range, warming";
    else if (d.meanRate < -1.5) name = "In range, cooling";
    else if (g.meanOutside != null && g.meanOutside >= 30) name = "In range in the heat";
    else name = "In range, steady";
    Object.assign(g, { id: i + 1, color, name });
  });

  // Groups with the same words: add the first thing that tells them all apart
  // (moving or standing, where, when), else their average temperature.
  const byName = new Map<string, typeof drafts>();
  for (const d of drafts) byName.set(d.group.name, [...(byName.get(d.group.name) ?? []), d]);
  for (const twins of byName.values()) {
    if (twins.length < 2) continue;
    const ways = [
      (t: (typeof twins)[number]) => (t.moving ? "on the road" : "standing"),
      (t: (typeof twins)[number]) => (t.dominantLeg ? shortLeg(t.dominantLeg) : ""),
      (t: (typeof twins)[number]) => partOfDay(t.meanHour),
      (t: (typeof twins)[number]) => `${t.group.meanTemp.toFixed(1)} °C on average`,
    ];
    const way = ways.find((w) => twins.every((t) => w(t)) && new Set(twins.map(w)).size === twins.length) ?? ways[3];
    for (const t of twins) t.group.name += `, ${way(t)}`;
  }
  return drafts.map((d) => d.group);
}

function shortLeg(label: string): string {
  return /carrier|truck|motorbike|cold box/i.test(label) ? "on the road" : /cold room|store|health centre|hospital|fridge/i.test(label) ? "in storage" : label;
}

function partOfDay(h: number): string {
  if (h >= 5 && h < 11) return "mornings";
  if (h >= 11 && h < 16) return "middle of the day";
  if (h >= 16 && h < 21) return "evenings";
  return "nights";
}

function circularHour(ps: TripPoint[]): number {
  let s = 0;
  let c = 0;
  for (const p of ps) {
    const a = (localHour(p.ts, p.tz) / 24) * 2 * Math.PI;
    s += Math.sin(a);
    c += Math.cos(a);
  }
  return ((Math.atan2(s, c) / (2 * Math.PI)) * 24 + 24) % 24;
}

function localHour(ts: number, tz: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz ?? undefined }).formatToParts(new Date(ts * 1000));
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h + m / 60;
  } catch {
    return new Date(ts * 1000).getHours();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
