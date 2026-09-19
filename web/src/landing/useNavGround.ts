import { useEffect, useState, type RefObject } from "react";

/**
 * Which ground is under the nav right now: the theme of the landing page's
 * top-level section whose box covers the strip the nav sits in. Watched
 * with an observer whose root is trimmed to that strip.
 */
export function useGround(root: RefObject<HTMLElement | null>): "light" | "dark" {
  const [ground, setGround] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const sections = Array.from(el.querySelectorAll<HTMLElement>(":scope > [data-theme]:not(.landing-nav)"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setGround(e.target.getAttribute("data-theme") === "dark" ? "dark" : "light");
        }
      },
      { rootMargin: "-40px 0px -94% 0px", threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [root]);
  return ground;
}

/** True once the page has scrolled past its first few pixels. */
export function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}
