import { useSyncExternalStore } from "react";

// NFC stickers open a URL when a phone touches them; a computer can't read or
// write them. No web API says whether a device reads tags (iPhones read them
// outside the browser), so go by the pointer: touch-first devices get the tap
// flow; a computer with a mouse or trackpad gets clicks, a box picker, and QR
// codes that hand a page over to a phone.
const TOUCH = "(pointer: coarse)";

export function canTapTags(): boolean {
  return window.matchMedia?.(TOUCH).matches ?? true;
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(TOUCH);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

export function useCanTapTags(): boolean {
  return useSyncExternalStore(subscribe, canTapTags, () => true);
}
