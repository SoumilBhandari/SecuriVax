import "leaflet/dist/leaflet.css";

import { latLngBounds, type LatLngExpression } from "leaflet";
import { CircleMarker, MapContainer, Polyline, Tooltip } from "react-leaflet";

import { placeName, time } from "../lib/format";
import type { PointStatus, Segment } from "../types";
import { coarsePointer, MapChrome, MapFrame, Tiles } from "./MapBase";

// In range is the ink line; an excursion gets its own colour, neither of them a verdict signal.
const COLORS: Record<PointStatus, string> = { ok: "var(--line)", heat: "#e8590c", freeze: "#4f7bd9" };
const HANDOFF = "var(--accent-deep)";
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

function RouteMap({ segments, places, height = "h-64" }: { segments: Segment[]; places: Record<string, string>; height?: string }) {
  const all = segments.flatMap((s) => s.route.map((p) => [p.lat, p.lon] as [number, number]));
  if (all.length === 0) {
    return <p className="ui-caption m-0 py-6 text-center">No GPS fix recorded yet.</p>;
  }
  const bounds = latLngBounds(all).pad(0.15);
  const events = segments.flatMap((s) => s.runs.filter((r) => r.lat != null && r.kind !== "humid"));

  return (
    <div>
      <MapFrame className={height}>
        <MapContainer bounds={bounds} scrollWheelZoom={false} dragging={!coarsePointer()} zoomControl={false} attributionControl={false} className="h-full w-full">
          <Tiles />
          <MapChrome />
          {segments.map((s) =>
            runs(s).map((r, i) => (
              <Polyline
                key={`${s.node_id}-${s.start_ts}-${i}`}
                positions={r.line}
                pathOptions={{ color: COLORS[r.status], weight: r.status === "ok" ? 4 : 6, opacity: 0.9 }}
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
              pathOptions={{ color: "#fff", weight: 2, fillColor: e.kind === "freeze" ? COLORS.freeze : COLORS.heat, fillOpacity: 1 }}
            >
              <Tooltip>
                {e.kind === "freeze" ? "Froze" : "Too warm"} near {placeName(places, e.lat, e.lon)}, {time(e.start_ts)}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </MapFrame>
      <div className="ui-caption mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {(["ok", "heat", "freeze"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1 w-4 rounded" style={{ background: COLORS[k] }} />
            {LEGEND[k]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 bg-white" style={{ borderColor: HANDOFF }} />
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
            pathOptions={{ color: HANDOFF, weight: 3, fillColor: "#fff", fillOpacity: 1 }}
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

