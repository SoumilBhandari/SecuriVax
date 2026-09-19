/**
 * Snapshot mode (VITE_SNAPSHOT=1 builds only; compiled out otherwise): the
 * whole app in one HTML file, answering its API calls from data saved from a
 * running server, so every page and tab can be opened without a backend.
 */

export interface Snapshot {
  taken_at: number;
  get: Record<string, unknown>;
  post: Record<string, unknown>;
}

export const SNAPSHOT: Snapshot | null = import.meta.env.VITE_SNAPSHOT ? read() : null;

function read(): Snapshot | null {
  try {
    return JSON.parse(document.getElementById("vt-snapshot")?.textContent ?? "null");
  } catch {
    return null;
  }
}

/** Show the app as it was when the snapshot was taken, so "2 h ago" stays true. */
export function freezeClock(): void {
  if (!SNAPSHOT) return;
  const shift = SNAPSHOT.taken_at * 1000 - Date.now();
  const real = Date.now.bind(Date);
  Date.now = () => real() + shift;
}

/** A file from web/public: absolute in the app, relative in the snapshot. */
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}
