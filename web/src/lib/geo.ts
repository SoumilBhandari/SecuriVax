import type { Facility } from "../types";

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
}

/** The phone's position, or null (no permission, no signal) after at most `waitMs`. */
export function getPosition(waitMs = 8000): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: waitMs, maximumAge: 60_000 },
    );
  });
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Facilities nearest first (all of them when there's no fix). */
export function byDistance(facilities: Facility[], fix: Fix | null): (Facility & { km: number | null })[] {
  return facilities
    .map((f) => ({ ...f, km: fix ? km(fix, f) : null }))
    .sort((a, b) => (a.km ?? 0) - (b.km ?? 0) || a.name.localeCompare(b.name));
}
