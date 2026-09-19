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
 * Esri's light and dark grey canvas: base maps made to sit under data, with
 * the place names as a separate layer so they can go above the heat. No key.
 */
const ESRI = "https://services.arcgisonline.com/arcgis/rest/services/Canvas";
export const BASEMAP = {
  base: (theme: "light" | "dark") => `${ESRI}/World_${theme === "dark" ? "Dark" : "Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  labels: (theme: "light" | "dark") => `${ESRI}/World_${theme === "dark" ? "Dark" : "Light"}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> (Esri, HERE, Garmin, &copy; OpenStreetMap)',
  maxNativeZoom: 16,
};
