import "leaflet/dist/leaflet.css";

import { divIcon, latLngBounds } from "leaflet";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleMarker, ImageOverlay, MapContainer, Marker, Pane, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import { useNavigate } from "react-router";

import { api } from "../lib/api";
import { time } from "../lib/format";
import { HEAT_LINE_C, HEAT_STOPS, heatAt, renderHeat } from "../lib/heatField";
import { BASEMAP, useTheme } from "../lib/useTheme";
import type { HeatGrid, NodeSummary, StoreRisk } from "../types";
import { XIcon } from "./Icons";

type Layer = "forecast" | "satellite" | "plain";

// Risk isn't a verdict, so no signal colours: hotter sites are bigger and solid.
const RISK_RADIUS: Record<string, number> = { extreme: 8, high: 7, moderate: 5.5, low: 4.5 };
// Carriers show their inside temperature as a tag once the map is zoomed in
// enough for tags not to pile up; before that, a dot.
const TAG_ZOOM = 5;
const RISK_LEVELS = ["extreme", "high", "moderate", "low"] as const;

// NASA's satellite measurement of how hot the ground was (MODIS on Terra),
// daily, about a day behind: what was observed, next to what's forecast.
const SATELLITE_LAYER = "MODIS_Terra_Land_Surface_Temp_Day";
const satelliteDate = () => new Date(Date.now() - 86400e3).toISOString().slice(0, 10);

/**
 * The Climate map: the forecast heat field (or yesterday's satellite
 * measurement) under the stores and clinics, and every carrier on the road with
 * its inside temperature against the air outside it.
 */
export function HeatMap({ sites }: { sites: StoreRisk[] }) {
  const theme = useTheme();
  const [grid, setGrid] = useState<HeatGrid | null>(null);
  const [gridNote, setGridNote] = useState<string | null>(null);
  const [carriers, setCarriers] = useState<NodeSummary[]>([]);
  const [layer, setLayer] = useState<Layer>("forecast");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api
      .climateGrid()
      .then((g) => (g.available ? setGrid(g) : setGridNote(g.reason ?? "No forecast field yet.")))
      .catch((e: Error) => setGridNote(`The forecast field isn't available: ${e.message}`));
    api
      .nodes()
      .then((n) => setCarriers(n.filter((x) => (x.kind === "carrier" || x.kind === "cold_box") && !x.backup_for && x.latest?.lat != null)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!playing || !grid) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % grid.frames.length), 700);
    return () => clearInterval(t);
  }, [playing, grid]);

  useEffect(() => {
    if (!expanded) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = overflow;
    };
  }, [expanded]);

  const lineColour = theme === "dark" ? "rgb(255,255,255)" : "rgb(11,37,69)";
  const image = useMemo(() => (grid && layer === "forecast" ? renderHeat(grid, frame, lineColour) : null), [grid, frame, layer, lineColour]);
  if (sites.length === 0) return null;

  const view = { sites, carriers, grid, frame, layer, image, theme };
  const controls = (
    <Controls grid={grid} gridNote={gridNote} sites={sites} layer={layer} setLayer={setLayer} frame={frame} setFrame={setFrame} playing={playing} setPlaying={setPlaying} />
  );
  return (
    <div>
      <div className="relative h-72 overflow-hidden rounded-2xl border border-line">
        <MapBody {...view} interactive={false} />
        <button
          onClick={() => setExpanded(true)}
          className="absolute right-2.5 top-2.5 z-[1000] !min-h-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-bold text-text"
        >
          Explore
        </button>
      </div>
      {controls}
      {expanded &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label="Heat map" className="fixed inset-0 z-[1400] flex flex-col bg-bg">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="ui-heading m-0">Heat ahead</p>
              <button onClick={() => setExpanded(false)} aria-label="Close the map" className="back-btn">
                <XIcon size={20} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <MapBody {...view} interactive />
            </div>
            <div className="mx-auto w-full max-w-[720px] px-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}>
              {controls}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function MapBody({
  sites,
  carriers,
  grid,
  frame,
  layer,
  image,
  theme,
  interactive,
}: {
  sites: StoreRisk[];
  carriers: NodeSummary[];
  grid: HeatGrid | null;
  frame: number;
  layer: Layer;
  image: string | null;
  theme: "light" | "dark";
  interactive: boolean;
}) {
  const navigate = useNavigate();
  const bounds = latLngBounds(sites.map((s) => [s.lat, s.lon] as [number, number])).pad(0.12);
  const at = grid?.times[frame];
  return (
    <MapContainer
      bounds={bounds}
      scrollWheelZoom={interactive}
      dragging={interactive || !coarsePointer()}
      className="h-full w-full"
      minZoom={2}
      maxZoom={11}
    >
      <TileLayer key={`base-${theme}`} url={BASEMAP.base(theme)} attribution={BASEMAP.attribution} maxNativeZoom={BASEMAP.maxNativeZoom} />
      {layer === "forecast" && grid && image && <ImageOverlay url={image} bounds={grid.bounds} opacity={1} />}
      {/* Place names above the heat, so the map stays readable under it. */}
      <Pane name="labels" style={{ zIndex: 450, pointerEvents: "none" }}>
        <TileLayer key={`labels-${theme}`} url={BASEMAP.labels(theme)} maxNativeZoom={BASEMAP.maxNativeZoom} />
      </Pane>
      {layer === "satellite" && (
        <TileLayer
          url={`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${SATELLITE_LAYER}/default/${satelliteDate()}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`}
          attribution='Land surface temperature: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> (MODIS)'
          maxNativeZoom={7}
          opacity={0.75}
        />
      )}
      {sites.map((s) => (
        <CircleMarker key={`${s.id}-${s.risk}`} center={[s.lat, s.lon]} radius={RISK_RADIUS[s.risk] ?? 6} className={`risk-marker risk-${s.risk}`}>
          <Tooltip>
            <b>{s.name}</b>
            <br />
            {s.risk} heat risk · peak {s.peak_c.toFixed(0)} °C {time(s.peak_ts, s.tz)}
            {layer === "forecast" && at != null && forecastAt(s, at) != null && (
              <>
                <br />
                {forecastAt(s, at)!.toFixed(0)} °C at the slider's hour
              </>
            )}
          </Tooltip>
        </CircleMarker>
      ))}
      <Carriers carriers={carriers} grid={grid} frame={layer === "forecast" ? frame : 0} onOpen={(id) => navigate(`/node/${id}`)} />
    </MapContainer>
  );
}

/** Every carrier at its last fix: a dot, or its inside temperature once zoomed in. */
function Carriers({ carriers, grid, frame, onOpen }: { carriers: NodeSummary[]; grid: HeatGrid | null; frame: number; onOpen: (id: string) => void }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const map = useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const tags = (zoom ?? map.getZoom()) >= TAG_ZOOM;
  return (
    <>
      {carriers.map((c) => {
        const inside = c.latest!.temp_c;
        const outside = grid ? heatAt(grid, frame, c.latest!.lat!, c.latest!.lon!) : null;
        return (
          <Marker
            key={`${c.id}-${tags}`}
            position={[c.latest!.lat!, c.latest!.lon!]}
            icon={divIcon({
              className: "carrier-pin-wrap",
              html: tags ? `<span class="carrier-pin">${inside.toFixed(1)}°</span>` : `<span class="carrier-dot"></span>`,
              iconSize: tags ? [44, 22] : [12, 12],
              iconAnchor: tags ? [22, 11] : [6, 6],
            })}
            eventHandlers={{ click: () => onOpen(c.id) }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              <b>{c.label}</b>
              <br />
              Inside {inside.toFixed(1)} °C
              {outside != null && ` · outside ${outside.toFixed(0)} °C (forecast)`}
              <br />
              Tap to open
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

function Controls({
  grid,
  gridNote,
  sites,
  layer,
  setLayer,
  frame,
  setFrame,
  playing,
  setPlaying,
}: {
  grid: HeatGrid | null;
  gridNote: string | null;
  sites: StoreRisk[];
  layer: Layer;
  setLayer: (l: Layer) => void;
  frame: number;
  setFrame: (f: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
}) {
  const hottest = grid ? hottestAt(grid, frame, sites) : null;
  const at = grid?.times[frame];
  const ahead = at != null ? Math.max(0, Math.round((at - Date.now() / 1000) / 3600)) : 0;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Map layer">
        {(
          [
            ["forecast", "Forecast heat"],
            ["satellite", "Satellite, yesterday"],
            ["plain", "Map only"],
          ] as [Layer, string][]
        ).map(([id, label]) => (
          <button key={id} className="chip" aria-pressed={layer === id} onClick={() => setLayer(id)}>
            {label}
          </button>
        ))}
      </div>

      {layer === "forecast" &&
        (grid ? (
          <>
            <div className="flex items-center gap-3">
              <button onClick={() => setPlaying(!playing)} className="back-btn shrink-0" aria-label={playing ? "Pause" : "Play the next 72 hours"}>
                {playing ? <PauseGlyph /> : <PlayGlyph />}
              </button>
              <input
                type="range"
                min={0}
                max={grid.frames.length - 1}
                value={frame}
                onChange={(e) => {
                  setPlaying(false);
                  setFrame(Number(e.target.value));
                }}
                aria-label="Forecast hour"
                className="w-full accent-[var(--text)]"
              />
            </div>
            <p className="m-0 text-[15px]">
              <b>{ahead === 0 ? "Next hour" : `In ${ahead} h`}</b> · {time(at)}
              {hottest && (
                <span className="text-neutral-300">
                  {" "}
                  · hottest air on the map {hottest.temp.toFixed(0)} °C, near {hottest.near}
                </span>
              )}
            </p>
            <HeatKey />
            <p className="ui-caption m-0">
              {grid.source === "open-meteo" ? "Open-Meteo forecast" : "Climate model (the forecast is unreachable)"}: air temperature at 2 m
              over the region, every 3 hours, updated {time(grid.generated_at)}. The line is {HEAT_LINE_C} °C.
            </p>
          </>
        ) : (
          <p className="ui-caption m-0">{gridNote ?? "Fetching the forecast field…"}</p>
        ))}

      {layer === "satellite" && (
        <p className="ui-caption m-0">
          NASA's MODIS satellite: how hot the ground itself was on {satelliteDate()}, in NASA's colours (blue cooler, red
          hotter). It's the land surface, which runs hotter than the air by day; gaps are cloud.
        </p>
      )}

      <div className="ui-caption flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Map key">
        {RISK_LEVELS.map((r) => (
          <span key={r} className="inline-flex items-center gap-1.5 capitalize">
            <svg width={22} height={22} viewBox="-11 -11 22 22" aria-hidden="true">
              <circle r={Math.min(RISK_RADIUS[r], 10)} className={`risk-marker risk-${r}`} />
            </svg>
            {r}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="carrier-dot" /> carrier (zoom in for its inside temperature)
        </span>
      </div>
    </div>
  );
}

function HeatKey() {
  const lo = HEAT_STOPS[0][0];
  const hi = HEAT_STOPS[HEAT_STOPS.length - 1][0];
  const pos = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`;
  const gradient = HEAT_STOPS.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${pos(t)}`).join(", ");
  return (
    <div aria-label={`Heat key: ${lo} to ${hi} °C, line at ${HEAT_LINE_C} °C`}>
      <div className="relative h-3 rounded-full border border-line" style={{ background: `linear-gradient(90deg, ${gradient})` }}>
        <span className="absolute -top-1 bottom-[-4px] w-0.5 bg-text" style={{ left: pos(HEAT_LINE_C) }} />
      </div>
      <div className="ui-caption relative mt-1 h-4">
        {[10, 20, 30, 40].map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: pos(t) }}>
            {t}°
          </span>
        ))}
      </div>
    </div>
  );
}

const PlayGlyph = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7z" fill="currentColor" />
  </svg>
);
const PauseGlyph = (): ReactNode => (
  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
  </svg>
);

/** A site's own hourly forecast at a moment (the nearest hour). */
function forecastAt(site: StoreRisk, ts: number): number | null {
  let best: [number, number] | null = null;
  for (const p of site.forecast) if (!best || Math.abs(p[0] - ts) < Math.abs(best[0] - ts)) best = p;
  return best && Math.abs(best[0] - ts) <= 2 * 3600 ? best[1] : null;
}

/** The hottest cell in a frame, and the nearest site to name it by. */
function hottestAt(g: HeatGrid, frame: number, sites: StoreRisk[]): { temp: number; near: string } | null {
  let best = -1;
  g.frames[frame].forEach((v, i) => {
    if (v != null && (best < 0 || v > (g.frames[frame][best] ?? -Infinity))) best = i;
  });
  if (best < 0) return null;
  const lat = g.lats[Math.floor(best / g.cols)];
  const lon = g.lons[best % g.cols];
  const nearest = sites.reduce((a, s) => ((s.lat - lat) ** 2 + (s.lon - lon) ** 2 < (a.lat - lat) ** 2 + (a.lon - lon) ** 2 ? s : a));
  return { temp: g.frames[frame][best]!, near: nearest.name.split(" · ")[0] };
}

/** On phones a one-finger drag should scroll the page, not pan the small map. */
function coarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}
