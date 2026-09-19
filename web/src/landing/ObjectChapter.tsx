import { useRef, type ReactNode } from "react";

import { useWide } from "../lib/useWide";
import { type Anchor, type Ground } from "./placeholders";
import { Sequence, type SequenceHandle } from "./Sequence";
import { chapterHeight, reveal, useChapter } from "./useChapter";

/**
 * A chapter built around one rendered object: the reader scrolls, the object
 * moves through its sequence, and the words for it rise in beside it. On a
 * phone the words sit above the object; on a laptop they take the left
 * column and the object the right. An unpinned chapter is one screen tall
 * and plays as it scrolls into view, so the page can end on it.
 */
export function ObjectChapter({
  id,
  ground,
  eyebrow,
  title,
  text,
  children,
  aside,
  viewports = 2.4,
  align = "left",
  pin = true,
}: {
  id: string;
  ground: Ground;
  eyebrow?: string;
  title: string;
  text: string;
  /** Anything after the text: buttons on the closing chapter. */
  children?: ReactNode;
  /** A panel that draws in during the chapter, beside the words. */
  aside?: ReactNode;
  viewports?: number;
  align?: "left" | "centre";
  pin?: boolean;
}) {
  const section = useRef<HTMLElement>(null);
  const seq = useRef<SequenceHandle>(null);
  const copy = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wide = useWide();
  // Where the object sits so the words, and any panel, have room beside or below it.
  const at: Anchor =
    align === "centre"
      ? { ax: 0.5, ay: wide ? 0.33 : 0.28, scale: wide ? 0.72 : 0.5 }
      : aside
        ? wide
          ? { ax: 0.63, ay: 0.46, scale: 0.72 }
          : { ax: 0.5, ay: 0.5, scale: 0 } // a phone has no room for both; the panel is the point
        : wide
          ? { ax: 0.68, ay: 0.52, scale: 0.95 }
          : { ax: 0.5, ay: 0.66, scale: 0.72 };

  useChapter(
    section,
    (tl) => {
      const o = { p: 0 };
      tl.to(o, { p: 1, duration: 0.84, onUpdate: () => seq.current?.draw(o.p) }, 0.08);
      if (copy.current) reveal(tl, copy.current.children, pin ? 0.03 : 0.2);
      if (panel.current)
        tl.fromTo(
          panel.current,
          { clipPath: "inset(0 100% 0 0 round 18px)", opacity: 0.4 },
          { clipPath: "inset(0 0% 0 0 round 18px)", opacity: 1, duration: 0.3, ease: "power2.out", immediateRender: true },
          0.38,
        );
    },
    [wide],
    pin ? {} : { start: "top 85%", end: "bottom bottom" },
  );

  return (
    <section ref={section} data-theme={ground} className="chapter" style={pin ? chapterHeight(viewports) : undefined} aria-label={title}>
      <div className={`chapter__view ${pin ? "" : "chapter__view--free"}`}>
        <Sequence ref={seq} id={id} ground={ground} at={at} className="absolute inset-0" />
        <div className={`chapter__copy ${align === "centre" ? "chapter__copy--centre" : ""}`}>
          <div ref={copy}>
            {eyebrow && <p className="eyebrow m-0 mb-4">{eyebrow}</p>}
            <h2 className="ui-title-1 m-0">{title}</h2>
            <p className="m-0 mt-5 max-w-[38ch] text-[17px] leading-7 text-neutral-500 lg:text-[19px] lg:leading-8">{text}</p>
            {children}
          </div>
        </div>
        {aside && (
          <div ref={panel} className="chapter__aside">
            {aside}
          </div>
        )}
      </div>
    </section>
  );
}
