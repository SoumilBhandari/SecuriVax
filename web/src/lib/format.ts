import type { Verdict } from "../types";

export const pct = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

export const temp = (c: number | null | undefined) => (c == null ? "–" : `${c.toFixed(1)} °C`);

export const humidity = (rh: number | null | undefined) => (rh == null ? "–" : `${Math.round(rh)}%`);

/**
 * One time format everywhere: the phone's own time zone, labelled, with the
 * date once it's more than a day away (a supervisor in Baltimore and a nurse
 * in Kano both read their own clock, and know which one it is).
 */
export function time(ts: number | null | undefined): string {
  if (!ts) return "–";
  const d = new Date(ts * 1000);
  const far = Math.abs(Date.now() - d.getTime()) > 86400e3;
  return d.toLocaleString(undefined, {
    ...(far ? { day: "numeric", month: "short" } : { weekday: "short" }),
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "never";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function hours(h: number | null | undefined): string {
  if (h == null) return "–";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  if (h < 24 * 365) return `${Math.round(h / 24)} days`;
  return `${(h / 24 / 365).toFixed(1)} years`;
}

/** How a demo node's clock compares to real time, e.g. "1 min = 2 days". */
export function demoRate(scale: number): string {
  return `1 real min = ${hours(scale / 60)} of product time`;
}

/** Matches the backend's ~100 m place buckets. */
export const placeKey = (lat: number, lon: number) => `place:${lat.toFixed(3)},${lon.toFixed(3)}`;

export function placeName(
  places: Record<string, string>,
  lat: number | null,
  lon: number | null,
): string | null {
  if (lat == null || lon == null) return null;
  return places[placeKey(lat, lon)] ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

/** Each verdict: its name, a strong colour, a light text colour and a dark tint (Nocturne tokens). */
export const VERDICT_STYLE: Record<Verdict, { label: string; color: string; fg: string; tint: string }> = {
  USE: { label: "Use", color: "var(--color-good)", fg: "var(--color-good-fg)", tint: "var(--color-good-tint)" },
  USE_FIRST: { label: "Use first", color: "var(--color-warn)", fg: "var(--color-warn-fg)", tint: "var(--color-warn-tint)" },
  QUARANTINE: { label: "Quarantine", color: "var(--color-hot)", fg: "var(--color-hot-fg)", tint: "var(--color-hot-tint)" },
  DISCARD: { label: "Discard", color: "var(--color-bad)", fg: "var(--color-bad-fg)", tint: "var(--color-bad-tint)" },
};

export const SEVERITY_ORDER: Record<Verdict, number> = { DISCARD: 0, QUARANTINE: 1, USE_FIRST: 2, USE: 3 };

/** Kept for older call sites: same as time(). */
export const eat = time;

/** Heat risk for a store or clinic, on the same scale as the verdicts. */
export const RISK_STYLE: Record<string, { color: string; fg: string; tint: string }> = {
  extreme: { color: "var(--color-bad)", fg: "var(--color-bad-fg)", tint: "var(--color-bad-tint)" },
  high: { color: "var(--color-hot)", fg: "var(--color-hot-fg)", tint: "var(--color-hot-tint)" },
  moderate: { color: "var(--color-warn)", fg: "var(--color-warn-fg)", tint: "var(--color-warn-tint)" },
  low: { color: "var(--color-good)", fg: "var(--color-good-fg)", tint: "var(--color-good-tint)" },
};

/** For drawing on the map, where CSS variables don't reach. */
export const RISK_COLOR: Record<string, string> = {
  extreme: "#e5534b",
  high: "#e8814a",
  moderate: "#d9a441",
  low: "#4fb286",
};

export function weatherSource(source: string): string {
  if (source === "open-meteo") return "Weather: Open-Meteo";
  if (source === "model") return "Weather: offline climate model (not observed)";
  return "Weather: Open-Meteo + offline model";
}

/** "in 4.6 h" style, from now. */
export function fromNow(ts: number | null | undefined): string {
  if (!ts) return "–";
  const h = (ts - Date.now() / 1000) / 3600;
  if (h < 0) return "now";
  return h < 1 ? `in ${Math.round(h * 60)} min` : `in ${h.toFixed(1)} h`;
}
