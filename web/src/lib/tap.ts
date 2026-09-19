// NFC tags hold plain URLs (…/node/CAR-02?tap=1, …/box/BOX-0042?tap=1), so any
// phone can read them with no app. Linking a box to a node takes two taps in
// either order: the first tap "arms" a pending link here, the second completes it.
//
// iPhones open tag URLs in the browser, never in a home-screen web app, and
// the two keep separate storage, so both taps must happen in the browser.

const KEY = "vialtality.arm";
export const ARM_TTL_MS = 2 * 60 * 1000;

export interface Arm {
  kind: "node" | "box";
  id: string;
  at: number;
}

export function getArm(): Arm | null {
  try {
    const arm = JSON.parse(localStorage.getItem(KEY) ?? "null") as Arm | null;
    return arm && Date.now() - arm.at < ARM_TTL_MS ? arm : null;
  } catch {
    return null;
  }
}

export function setArm(kind: Arm["kind"], id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ kind, id, at: Date.now() }));
  } catch {
    /* private mode: tap-to-link falls back to the manual picker */
  }
  window.dispatchEvent(new Event("vialtality-arm"));
}

export function clearArm(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("vialtality-arm"));
}

/** True once per page load if the URL came from an NFC tag; strips ?tap=1. */
export function takeTap(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("tap") !== "1") return false;
  url.searchParams.delete("tap");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return true;
}
