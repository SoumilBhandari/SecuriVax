import "leaflet/dist/leaflet.css";

import { latLngBounds } from "leaflet";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";

import { RISK_COLOR, time } from "../lib/format";
import type { StoreRisk } from "../types";

/** The stores and clinics on OpenStreetMap, coloured by heat risk (the original map). */
export function RiskMap({ sites }: { sites: StoreRisk[] }) {
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
            >
              <Tooltip>
                {s.name}: {s.risk}, peak {s.peak_c.toFixed(0)} °C {time(s.peak_ts, s.tz)}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <div className="ui-caption mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Heat risk key">
        {(["extreme", "high", "moderate", "low"] as const).map((r) => (
          <span key={r} className="inline-flex items-center gap-1.5 capitalize">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_COLOR[r] }} />
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

export default RiskMap;
