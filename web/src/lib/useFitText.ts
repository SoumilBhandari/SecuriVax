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
    const fit = () => {
      t.style.fontSize = `${max}px`;
      const width = t.scrollWidth;
      const room = b.clientWidth;
      const size = Math.max(min, Math.min(max, Math.floor((max * room) / Math.max(width, 1))));
      t.style.fontSize = `${size}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, ...deps]);

  return { box, text };
}
