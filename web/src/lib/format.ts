import type { Verdict } from "../types";

export const pct = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

export const temp = (c: number | null | undefined) => (c == null ? "–" : `${c.toFixed(1)} °C`);

export const humidity = (rh: number | null | undefined) => (rh == null ? "–" : `${Math.round(rh)}%`);

/**
 * One time format everywhere: the phone's own time zone, labelled, with the
 * date once it's more than a day away (a supervisor in Baltimore and a nurse
 * in Kano both read their own clock, and know which one it is).
 */
export function time(ts: number | null | undefined, tz?: string | null): string {
  if (!ts) return "–";
  if (tz) return siteTime(ts, tz);
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
const placeKey = (lat: number, lon: number) => `place:${lat.toFixed(3)},${lon.toFixed(3)}`;

export function placeName(
  places: Record<string, string>,
  lat: number | null,
  lon: number | null,
): string | null {
  if (lat == null || lon == null) return null;
  return places[placeKey(lat, lon)] ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

export const SEVERITY_ORDER: Record<Verdict, number> = { DISCARD: 0, QUARANTINE: 1, USE_FIRST: 2, USE: 3 };

export const RISK_ORDER: Record<string, number> = { extreme: 0, high: 1, moderate: 2, low: 3 };

/** Heat risk on the map: the original red, orange, amber and green. */
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

/**
 * A time at a site, on the site's own clock: "Sun 06:00 local (GMT+1)". Heat at
 * a clinic in Kinshasa peaks at its local hour, not the viewer's; the planner
 * writes departures the same way, so one departure is never shown two ways.
 */
function siteTime(ts: number, tz: string): string {
  const d = new Date(ts * 1000);
  const far = Math.abs(Date.now() - d.getTime()) > 86400e3;
  try {
    const clock = d.toLocaleString("en-GB", {
      timeZone: tz,
      ...(far ? { day: "numeric", month: "short" } : { weekday: "short" }),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")
      ?.value.replace(/^GMT\+0$/, "GMT"); // as the server writes it
    return `${clock.replace(",", "")} local${offset ? ` (${offset})` : ""}`;
  } catch {
    return time(ts); // an unknown zone: fall back to the viewer's clock
  }
}
