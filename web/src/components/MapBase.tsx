import { DomEvent } from "leaflet";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TileLayer, useMap } from "react-leaflet";

import { MinusIcon, PlusIcon } from "./Icons";

/**
 * Every map's shared ground: CARTO's near-monochrome tiles following the
 * theme, our own zoom buttons, and a one-line credit. Leaflet's own controls
 * are switched off on the containers that use this.
 */

function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** The app's theme, live: follows the toggle and the system. */
export function useTheme(): "light" | "dark" {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

/**
 * OpenStreetMap's tiles, drained of colour by a filter on the tile pane (see
 * .map-frame in index.css) so the pins are the only colour on the map. The
 * dark theme inverts them. No key, no limits, full zoom.
 */
export function Tiles(_: { theme?: "light" | "dark" }) {
  return <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />;
}

/** Zoom buttons and the credit, drawn over the map in the app's own style. */
export function MapChrome({ credit = true }: { credit?: boolean }) {
  const map = useMap();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    DomEvent.disableClickPropagation(ref.current);
    DomEvent.disableScrollPropagation(ref.current);
  }, []);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[1000]">
      <div className="pointer-events-auto absolute right-3 top-3 flex flex-col gap-1.5">
        <button type="button" className="map-btn" onClick={() => map.zoomIn()} aria-label="Zoom in">
          <PlusIcon size={18} />
        </button>
        <button type="button" className="map-btn" onClick={() => map.zoomOut()} aria-label="Zoom out">
          <MinusIcon size={18} />
        </button>
      </div>
      {credit && (
        <p className="map-credit pointer-events-auto m-0">
          ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{" "}
          contributors
        </p>
      )}
    </div>
  );
}

/** The rounded frame every map sits in. `theme` pins the tiles' look when the page art-directs its own ground. */
export function MapFrame({ className = "", theme, children }: { className?: string; theme?: "light" | "dark"; children: ReactNode }) {
  return (
    <div className={`map-frame ${className}`} data-map-theme={theme}>
      {children}
    </div>
  );
}

/** On phones a one-finger drag should scroll the page, not pan the map. */
export function coarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}
