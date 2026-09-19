import "leaflet/dist/leaflet.css";

import { latLngBounds, type LatLngExpression } from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";

import { placeName, time } from "../lib/format";
import type { PointStatus, Segment } from "../types";

// Not verdicts, so no signal colours: in-range is an Ink line, heat a heavier
// one, freezing a dashed one (styled by class in index.css), each named in the key.
const LEGEND: Record<PointStatus, string> = { ok: "In range", heat: "Too warm", freeze: "Frozen" };

/** Split a leg into runs of the same status so each run gets its colour. */
function runs(seg: Segment) {
  const out: { status: PointStatus; line: LatLngExpression[] }[] = [];
  for (const p of seg.route) {
    const last = out[out.length - 1];
    const here: LatLngExpression = [p.lat, p.lon];
    if (last && last.status === p.status) last.line.push(here);
    else out.push({ status: p.status, line: last ? [last.line[last.line.length - 1], here] : [here] });
  }
  return out;
}

export function RouteMap({ segments, places }: { segments: Segment[]; places: Record<string, string> }) {
  const all = segments.flatMap((s) => s.route.map((p) => [p.lat, p.lon] as [number, number]));
  if (all.length === 0) {
    return <p className="ui-caption m-0 py-6 text-center">No GPS fix recorded yet.</p>;
  }
  const bounds = latLngBounds(all).pad(0.15);
  const events = segments.flatMap((s) => s.runs.filter((r) => r.lat != null && r.kind !== "humid"));

  return (
    <div>
      <div className="h-64 overflow-hidden rounded-2xl border border-line">
        <MapContainer bounds={bounds} scrollWheelZoom={false} dragging={!coarsePointer()} className="h-full w-full" attributionControl>
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {segments.map((s) =>
            runs(s).map((r, i) => (
              <Polyline
                key={`${s.node_id}-${s.start_ts}-${i}`}
                positions={r.line}
                pathOptions={{ className: `route-line route-${r.status}` }}
              />
            )),
          )}
          {segments.map((s) => (
            <SegmentEnds key={`${s.node_id}-${s.start_ts}`} seg={s} places={places} />
          ))}
          {events.map((e) => (
            <CircleMarker
              key={`${e.kind}-${e.start_ts}`}
              center={[e.lat!, e.lon!]}
              radius={8}
              pathOptions={{ className: "route-event" }}
            >
              <Tooltip>
                {e.kind === "freeze" ? "Froze" : "Too warm"} near {placeName(places, e.lat, e.lon)}, {time(e.start_ts)}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <div className="ui-caption mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {(["ok", "heat", "freeze"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <svg width="20" height="8" aria-hidden="true">
              <line x1="1" x2="19" y1="4" y2="4" className={`route-line route-${k}`} />
            </svg>
            {LEGEND[k]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="4" className="route-end" />
          </svg>
          Handoff
        </span>
      </div>
    </div>
  );
}

function SegmentEnds({ seg, places }: { seg: Segment; places: Record<string, string> }) {
  const ends = [
    { lat: seg.start_lat, lon: seg.start_lon, label: `Loaded into ${seg.node_label}`, ts: seg.start_ts },
    ...(seg.end_ts ? [{ lat: seg.end_lat, lon: seg.end_lon, label: `Unloaded from ${seg.node_label}`, ts: seg.end_ts }] : []),
  ];
  return (
    <>
      {ends
        .filter((e) => e.lat != null && e.lon != null)
        .map((e) => (
          <CircleMarker
            key={e.label}
            center={[e.lat!, e.lon!]}
            radius={6}
            pathOptions={{ className: "route-end" }}
          >
            <Tooltip>
              {e.label}, {placeName(places, e.lat, e.lon)}, {time(e.ts)}
            </Tooltip>
          </CircleMarker>
        ))}
    </>
  );
}

export default RouteMap;

/** On phones a one-finger drag should scroll the page, not pan the map. */
function coarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}
