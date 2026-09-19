import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * An iOS segmented control: the chosen option sits on a raised pill that
 * slides between positions. Options may carry a count or be an icon alone.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: ReactNode; count?: number; title?: string }[];
  label: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = () => {
      const active = el.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    document.fonts?.ready.then(place).catch(() => {});
    return () => ro.disconnect();
  }, [value, options.length]);

  return (
    <div ref={root} role="group" aria-label={label} className={`segmented ${className}`}>
      {pill && <span aria-hidden="true" className="segmented__pill" style={{ left: pill.left, width: pill.width }} />}
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="segmented__btn"
          aria-pressed={value === o.id}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.count != null && <span className="segmented__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
