import "leaflet/dist/leaflet.css";

import { divIcon, latLngBounds } from "leaflet";
import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, useMap, useMapEvents } from "react-leaflet";
import { Link } from "react-router";

import { SEVERITY_ORDER } from "../lib/format";
import type { BoxSummary, Verdict } from "../types";
import { VERDICT_KEY, VerdictBadge, type VerdictKey } from "./Brand";
import { coarsePointer, MapChrome, MapFrame, Tiles } from "./MapBase";

type Located = BoxSummary & { lat: number; lon: number };

// The verdict's signal colour and mark, as on the verdict cards.
const FILL: Record<VerdictKey, string> = { use: "var(--signal-use)", quarantine: "var(--signal-quarantine)", discard: "var(--signal-discard)" };
const INK: Record<VerdictKey, string> = { use: "var(--on-signal-use)", quarantine: "var(--on-signal-quarantine)", discard: "var(--on-signal-discard)" };
const GLYPH: Record<VerdictKey, string> = {
  use: '<polyline fill="none" points="35,51 46,62 66,40"/>',
  quarantine: '<path fill="none" d="M50 33v18"/><circle cx="50" cy="65" r="3"/>',
  discard: '<path fill="none" d="M39 39 61 61M61 39 39 61"/>',
};
const KEYS: VerdictKey[] = ["discard", "quarantine", "use"];
const GROUP_PX = 44; // markers closer than this on screen join one group

/** The Boxes page's map view: the verdict split, the map, its key, and what isn't on it. */
export default function ShipmentsView({ boxes }: { boxes: BoxSummary[] }) {
  const unplaced = boxes.filter((b) => b.lat == null || b.lon == null);
  return (
    <div>
      <ShipmentsShare boxes={boxes} />
      <ShipmentsMap boxes={boxes} />
      <div className="ui-caption mt-2 flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Map key">
        {KEYS.slice()
          .reverse()
          .map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2 border-white" style={{ background: FILL[k] }} />
              {k === "quarantine" ? "On hold" : WORD[k]}
            </span>
          ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-[3px]" style={{ borderColor: "var(--signal-use)", borderRightColor: "var(--signal-discard)" }} />
          Several shipments: click to zoom in
        </span>
        <span>Line: from where the trip started, dashed while on the road. Bigger pin: more doses.</span>
      </div>
      {unplaced.length > 0 && (
        <p className="ui-caption m-0 mt-2">
          Not on the map (no position reported yet): {unplaced.map((b) => b.id).join(", ")}.
        </p>
      )}
    </div>
  );
}

/**
 * Every shipment where it is now (its carrier's last position, or where it was
 * delivered), coloured by verdict, with a line back to where the trip started.
 * Shipments close together at the current zoom join one ring that shows how
 * many of them are fine, on hold or to be thrown away; click it to zoom in.
 */
function ShipmentsMap({ boxes }: { boxes: BoxSummary[] }) {
  const located = boxes.filter((b): b is Located => b.lat != null && b.lon != null);
  if (located.length === 0) return null;
  const bounds = latLngBounds(located.flatMap((b) => [[b.lat, b.lon] as [number, number], ...(b.from_lat != null && b.from_lon != null ? [[b.from_lat, b.from_lon] as [number, number]] : [])])).pad(0.15);
  return (
    <MapFrame className="h-[420px] lg:h-[min(620px,calc(100dvh-300px))]">
      <MapContainer bounds={bounds} scrollWheelZoom={false} dragging={!coarsePointer()} zoomControl={false} attributionControl={false} className="h-full w-full">
        <Tiles />
        <MapChrome />
        {located.map((b) =>
          b.from_lat != null && b.from_lon != null ? (
            <Trip key={`trip-${b.id}`} box={b} />
          ) : null,
        )}
        <Groups boxes={located} />
      </MapContainer>
    </MapFrame>
  );
}

/** Where the trip started (a small ring) and a straight line to where the box is now. */
function Trip({ box: b }: { box: Located }) {
  const key = VERDICT_KEY[b.verdict];
  const from: [number, number] = [b.from_lat!, b.from_lon!];
  return (
    <>
      <Polyline
        positions={[from, [b.lat, b.lon]]}
        className={`sv-trip sv-trip--${key}${b.current_node_id ? " sv-trip--moving" : ""}`}
        pathOptions={{ weight: 3, opacity: 0.8 }}
        interactive={false}
      />
      <CircleMarker center={from} radius={4} className={`sv-trip-start sv-trip--${key}`} pathOptions={{ weight: 2, fillOpacity: 1 }} interactive={false} />
    </>
  );
}

function Groups({ boxes }: { boxes: Located[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  // Greedy grouping in screen pixels at this zoom, worst verdicts first so
  // they anchor their group.
  const groups = useMemo(() => {
    const sorted = [...boxes].sort((a, b) => SEVERITY_ORDER[a.verdict] - SEVERITY_ORDER[b.verdict] || b.quantity - a.quantity);
    const out: { at: ReturnType<typeof map.project>; members: Located[] }[] = [];
    for (const b of sorted) {
      const p = map.project([b.lat, b.lon], zoom);
      const near = out.find((g) => g.at.distanceTo(p) < GROUP_PX);
      if (near) near.members.push(b);
      else out.push({ at: p, members: [b] });
    }
    return out.map((g) => g.members);
  }, [boxes, zoom, map]);

  const biggest = Math.max(...boxes.map((b) => b.quantity), 1);
  return (
    <>
      {groups.map((members) =>
        members.length === 1 ? (
          <Single key={members[0].id} box={members[0]} biggest={biggest} />
        ) : (
          <Group key={members.map((m) => m.id).join()} members={members} />
        ),
      )}
    </>
  );
}

function Single({ box: b, biggest }: { box: Located; biggest: number }) {
  const key = VERDICT_KEY[b.verdict];
  // Bigger shipments get bigger markers (by area), within a readable range.
  const size = Math.round(26 + 18 * Math.sqrt(b.quantity / biggest));
  const icon = useMemo(
    () =>
      divIcon({
        className: "sv-pin",
        iconSize: [size, size],
        html: `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><circle cx="50" cy="50" r="45" style="fill:${FILL[key]}" stroke="#fff" stroke-width="8"/><g style="fill:${INK[key]};stroke:${INK[key]}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">${GLYPH[key]}</g></svg>`,
      }),
    [key, size],
  );
  return (
    <Marker position={[b.lat, b.lon]} icon={icon} title={`${b.id}: ${b.product_name}, ${label(b.verdict)}`}>
      <Popup>
        <BoxLine box={b} />
      </Popup>
    </Marker>
  );
}

/** A ring split by verdict, with the number of shipments in the middle. */
function Group({ members }: { members: Located[] }) {
  const map = useMap();
  const counts = KEYS.map((k) => members.filter((m) => VERDICT_KEY[m.verdict] === k).length);
  const size = Math.min(40 + members.length * 4, 64);
  const icon = useMemo(() => {
    const r = 38;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = KEYS.map((k, i) => {
      const len = (counts[i] / members.length) * c;
      const arc = len
        ? `<circle cx="50" cy="50" r="${r}" fill="none" style="stroke:${FILL[k]}" stroke-width="16" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"/>`
        : "";
      offset += len;
      return arc;
    }).join("");
    return divIcon({
      className: "sv-pin",
      iconSize: [size, size],
      html: `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><circle cx="50" cy="50" r="47" fill="#fff"/>${arcs}<text x="50" y="50" dy="0.35em" text-anchor="middle" font-size="30" font-weight="700" fill="#1d1d1f" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif">${members.length}</text></svg>`,
    });
  }, [counts.join(), members.length, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const spread = latLngBounds(members.map((m) => [m.lat, m.lon] as [number, number]));
  const samePlace = spread.getNorthEast().distanceTo(spread.getSouthWest()) < 200; // metres: one carrier or store
  const summary = KEYS.map((k, i) => (counts[i] ? `${counts[i]} ${WORD[k].toLowerCase()}` : null)).filter(Boolean).join(", ");
  return (
    <Marker
      position={spread.getCenter()}
      icon={icon}
      title={`${members.length} shipments: ${summary}${samePlace ? "" : ". Click to zoom in"}`}
      eventHandlers={samePlace ? undefined : { click: () => map.flyToBounds(spread.pad(0.6), { maxZoom: 11, duration: 0.6 }) }}
    >
      {samePlace && (
        <Popup>
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <BoxLine key={m.id} box={m} />
            ))}
          </div>
        </Popup>
      )}
    </Marker>
  );
}

const WORD: Record<VerdictKey, string> = { use: "Use", quarantine: "Quarantine", discard: "Discard" };

const SHARE: { verdict: Verdict; label: string; color: string; opacity?: number }[] = [
  { verdict: "USE", label: "Use", color: "var(--signal-use)" },
  { verdict: "USE_FIRST", label: "Use first", color: "var(--signal-use)", opacity: 0.55 },
  { verdict: "QUARANTINE", label: "On hold", color: "var(--signal-quarantine)" },
  { verdict: "DISCARD", label: "To discard", color: "var(--signal-discard)" },
];

/** Every dose and test in the shipments shown, split by verdict: what's fine, on hold, or to be thrown away. */
function ShipmentsShare({ boxes }: { boxes: BoxSummary[] }) {
  const total = boxes.reduce((n, b) => n + b.quantity, 0);
  if (!total) return null;
  const parts = SHARE.map((s) => {
    const mine = boxes.filter((b) => b.verdict === s.verdict);
    return { ...s, boxes: mine.length, quantity: mine.reduce((n, b) => n + b.quantity, 0) };
  });
  return (
    <section className="mb-3" aria-label="Doses and tests by verdict">
      <div className="flex h-4 overflow-hidden rounded-full bg-neutral-800" role="img" aria-label={parts.map((p) => `${p.label}: ${p.quantity.toLocaleString()}`).join(", ")}>
        {parts.map((p) =>
          p.quantity ? <span key={p.verdict} style={{ width: `${(p.quantity / total) * 100}%`, background: p.color, opacity: p.opacity }} /> : null,
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {parts.map((p) => (
          <div key={p.verdict} className="flex items-start gap-2">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color, opacity: p.opacity }} />
            <span className="flex flex-col">
              <span className="font-display text-lg font-semibold leading-6 tabular-nums tracking-[-0.01em]">{p.quantity.toLocaleString()}</span>
              <span className="ui-caption">
                {p.label} · {p.boxes} {p.boxes === 1 ? "box" : "boxes"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
const label = (v: Verdict) => (v === "USE_FIRST" ? "use first" : WORD[VERDICT_KEY[v]].toLowerCase());

function BoxLine({ box: b }: { box: Located }) {
  const unit = b.product_kind === "vaccine" ? "doses" : "tests";
  return (
    <div className="flex min-w-[200px] flex-col gap-1 font-sans">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/box/${b.id}`} className="font-bold text-text">
          {b.id}
        </Link>
        <VerdictBadge verdict={b.verdict} />
      </div>
      <span className="text-[13px] text-text">{b.product_name}</span>
      <span className="text-[12px] text-neutral-500">
        {b.quantity.toLocaleString()} {unit} · {b.origin ? `${b.origin} → ${b.destination}` : "not dispatched"} · {b.status.toLowerCase()}
      </span>
    </div>
  );
}

