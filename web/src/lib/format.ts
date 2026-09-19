import type { Verdict } from "../types";

export const pct = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

export const temp = (c: number | null | undefined) => (c == null ? "–" : `${c.toFixed(1)} °C`);

export const humidity = (rh: number | null | undefined) => (rh == null ? "–" : `${Math.round(rh)}%`);

export function time(ts: number | null | undefined): string {
  if (!ts) return "–";
  return new Date(ts * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
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

export const VERDICT_STYLE: Record<Verdict, { card: string; chip: string; bar: string; label: string }> = {
  USE: {
    card: "bg-emerald-50 border-emerald-300 text-emerald-950",
    chip: "bg-emerald-100 text-emerald-800 ring-emerald-300",
    bar: "bg-emerald-500",
    label: "Use",
  },
  QUARANTINE: {
    card: "bg-amber-50 border-amber-300 text-amber-950",
    chip: "bg-amber-100 text-amber-900 ring-amber-300",
    bar: "bg-amber-500",
    label: "Quarantine",
  },
  DISCARD: {
    card: "bg-red-50 border-red-300 text-red-950",
    chip: "bg-red-100 text-red-800 ring-red-300",
    bar: "bg-red-500",
    label: "Discard",
  },
};

export const SEVERITY_ORDER: Record<Verdict, number> = { DISCARD: 0, QUARANTINE: 1, USE: 2 };

/** Clock time in East Africa Time, which the district schedules run on. */
export function eat(ts: number | null | undefined): string {
  if (!ts) return "–";
  return new Date((ts + 3 * 3600) * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export const RISK_STYLE: Record<string, string> = {
  extreme: "bg-red-100 text-red-800 ring-red-300",
  high: "bg-orange-100 text-orange-800 ring-orange-300",
  moderate: "bg-amber-50 text-amber-800 ring-amber-200",
  low: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

export const RISK_COLOR: Record<string, string> = {
  extreme: "#dc2626",
  high: "#ea580c",
  moderate: "#d97706",
  low: "#059669",
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
