import { useEffect, useState } from "react";

/** The theme on the page right now, following the toggle and the phone. */
export function useTheme(): "light" | "dark" {
  const read = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  const [theme, setTheme] = useState<"light" | "dark">(read);
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(read()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);
  return theme;
}

/**
 * OpenStreetMap's own map: free with credit and no key (CARTO's now wants one).
 * In the dark theme only this layer is darkened (the `basemap-dark` class), so
 * the heat and satellite layers above it keep their true colours.
 */
export const BASEMAP = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  className: (theme: "light" | "dark") => (theme === "dark" ? "basemap basemap-dark" : "basemap"),
};
