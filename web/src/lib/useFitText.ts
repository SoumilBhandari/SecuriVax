import { useLayoutEffect, useRef, type DependencyList } from "react";

/**
 * A single line of text sized to fill its box: the verdict word on the field,
 * where "QUARANTINE" and "USE" must both run edge to edge. Measures at the
 * largest size, scales down to fit, and re-measures when the box resizes.
 */
export function useFitText(deps: DependencyList = [], { min = 32, max = 128 }: { min?: number; max?: number } = {}) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const b = box.current;
    const t = text.current;
    if (!b || !t) return;
    // Measured from whatever size it is at now, never by setting it to `max`
    // first. Setting it to max resizes the box, which wakes the observer
    // below, which measures at max again: the word never settles and is left
    // at full size, running off its box. Scaling from the current size is
    // idempotent — once it fits, re-running changes nothing and the loop ends.
    const fit = () => {
      const now = parseFloat(getComputedStyle(t).fontSize) || max;
      const perPx = t.scrollWidth / Math.max(now, 1); // width of the word per px of font size
      const room = b.clientWidth;
      if (!perPx || !room) return;
      const size = Math.max(min, Math.min(max, Math.floor(room / perPx)));
      if (Math.abs(size - now) >= 1) t.style.fontSize = `${size}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    // The display font arrives after the first paint, and it is wider than the
    // fallback it was measured against, so a size chosen before it lands is too
    // big and the word runs past its box. `ready` covers the usual case;
    // `loadingdone` catches a face that starts loading after it resolved, which
    // is what leaves "QUARANTINE" clipped to "QUARA" on a slow connection.
    document.fonts?.ready.then(fit).catch(() => {});
    document.fonts?.addEventListener?.("loadingdone", fit);
    return () => {
      ro.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, ...deps]);

  return { box, text };
}
