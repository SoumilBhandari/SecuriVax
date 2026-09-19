import "leaflet/dist/leaflet.css";

import { latLngBounds, type LatLngBounds } from "leaflet";
import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";

import { RISK_COLOR, time } from "../lib/format";
import type { StoreRisk } from "../types";

/**
 * The stores and clinics on OpenStreetMap, coloured by heat risk (the original
 * map). With `onSelect`, a click on a site picks it, and the map flies to the
 * `selected` one (and back out when nothing is).
 */
function RiskMap({
  sites,
  selected = null,
  onSelect,
  legend = true,
}: {
  sites: StoreRisk[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  legend?: boolean;
}) {
  if (sites.length === 0) return null;
  const bounds = latLngBounds(sites.map((s) => [s.lat, s.lon] as [number, number])).pad(0.2);
  return (
    <div>
      <div className="h-56 overflow-hidden rounded-2xl border border-line lg:h-[min(600px,calc(100dvh-250px))]">
        <MapContainer bounds={bounds} scrollWheelZoom={false} className="h-full w-full">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {sites.map((s) => (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lon]}
              radius={s.kind === "store" ? 11 : 8}
              pathOptions={{ color: "#fff", weight: 2, fillColor: RISK_COLOR[s.risk], fillOpacity: 0.95 }}
              eventHandlers={onSelect ? { click: () => onSelect(s.id) } : undefined}
            >
              <Tooltip>
                {s.name}: {s.risk}, peak {s.peak_c.toFixed(0)} °C {time(s.peak_ts, s.tz)}
              </Tooltip>
            </CircleMarker>
          ))}
          {onSelect && <FlyTo site={sites.find((s) => s.id === selected) ?? null} all={bounds} />}
        </MapContainer>
      </div>
      {legend && (
        <div className="ui-caption mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Heat risk key">
          {(["extreme", "high", "moderate", "low"] as const).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5 capitalize">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_COLOR[r] }} />
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Fly to the picked site, or back out to all of them. */
function FlyTo({ site, all }: { site: StoreRisk | null; all: LatLngBounds }) {
  const map = useMap();
  const key = site?.id ?? "";
  useEffect(() => {
    if (site) map.flyTo([site.lat, site.lon], Math.max(map.getZoom(), 6), { duration: 0.6 });
    else map.flyToBounds(all, { duration: 0.6 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default RiskMap;
