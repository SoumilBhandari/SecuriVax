import "leaflet/dist/leaflet.css";

import { latLngBounds } from "leaflet";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import { Link } from "react-router";

import { Card, ErrorNote, Layout, Spinner } from "../components/Layout";
import { VerdictChip } from "../components/Verdict";
import { api } from "../lib/api";
import { eat, RISK_COLOR, RISK_STYLE, weatherSource } from "../lib/format";
import type { CarrierPerformance, StoreRisk, StoresAtRisk } from "../types";

export default function ClimatePage() {
  const [stores, setStores] = useState<StoresAtRisk | null>(null);
  const [carriers, setCarriers] = useState<CarrierPerformance[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.storesAtRisk().then(setStores).catch((e: Error) => setError(e.message));
    api.carriers().then(setCarriers).catch(() => setCarriers([]));
  }, []);

  return (
    <Layout back>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Environmental intelligence</h1>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-slate-600">
        Weather forecasts against the cold chain: which stores and clinics the heat is about to hit, and how each carrier
        really holds up. None of this changes a box's verdict.
      </p>
      {error && <ErrorNote error={error} />}
      {!stores && !error && <Spinner label="Fetching the forecast" />}

      {stores && (
        <>
          <div className="mb-4 rounded-2xl bg-slate-900 p-4 text-white">
            <p className="text-lg font-semibold leading-snug">{stores.summary}</p>
            <p className="mt-1 text-xs text-slate-400">{weatherSource(stores.source)} · updated {eat(stores.generated_at)}</p>
          </div>
          <Card title="Stores and clinics at risk" aside="next 72 h">
            <RiskMap sites={stores.facilities} />
            <ul className="mt-3 divide-y divide-slate-100">
              {stores.facilities.map((f) => (
                <Site key={f.id} site={f} />
              ))}
            </ul>
          </Card>
        </>
      )}

      <Card title="Carriers: model vs reality" aside="cold life from real trips">
        {!carriers ? (
          <Spinner />
        ) : (
          <ul className="space-y-4">
            {carriers.map((c) => (
              <CarrierRow key={c.node_id} carrier={c} />
            ))}
          </ul>
        )}
      </Card>

      <Link
        to="/plan"
        className="block rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-medium text-white hover:bg-slate-800"
      >
        Plan a trip from the forecast →
      </Link>
    </Layout>
  );
}

function RiskMap({ sites }: { sites: StoreRisk[] }) {
  if (sites.length === 0) return null;
  const bounds = latLngBounds(sites.map((s) => [s.lat, s.lon] as [number, number])).pad(0.2);
  return (
    <div className="h-56 overflow-hidden rounded-xl border border-slate-200">
      <MapContainer bounds={bounds} scrollWheelZoom={false} dragging={!coarsePointer()} className="h-full w-full">
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
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
              {s.name}: {s.risk}, peak {s.peak_c.toFixed(0)} °C {eat(s.peak_ts)}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

function Site({ site }: { site: StoreRisk }) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{site.name}</p>
          <p className="text-xs text-slate-500">
            Peak {site.peak_c.toFixed(1)} °C {eat(site.peak_ts)} · {site.hours_above_30_next_72h} h above 30 °C ahead ·{" "}
            {site.hours_above_30_past_7d} h in the past week
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ${RISK_STYLE[site.risk]}`}>
          {site.risk}
        </span>
      </div>
      <Forecast points={site.forecast} />
      {site.actions.map((a) => (
        <p key={a} className="mt-1 text-sm text-slate-700">
          {a}
        </p>
      ))}
      {site.stock.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {site.stock.map((b) => (
            <Link key={b.id} to={`/box/${b.id}`} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs">
              <span className="font-medium text-slate-800">{b.id}</span>
              <VerdictChip verdict={b.verdict} />
            </Link>
          ))}
        </div>
      )}
    </li>
  );
}

/** 72 h forecast strip with the 30 °C line. */
function Forecast({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null;
  const temps = points.map(([, c]) => c);
  const lo = Math.min(...temps, 15);
  const hi = Math.max(...temps, 35);
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const x = (t: number) => ((t - t0) / (t1 - t0)) * 300;
  const y = (c: number) => 36 - ((c - lo) / (hi - lo)) * 32;
  return (
    <svg viewBox="0 0 300 40" className="mt-2 h-10 w-full" role="img" aria-label="72-hour temperature forecast">
      <line x1={0} x2={300} y1={y(30)} y2={y(30)} className="stroke-orange-300" strokeDasharray="3 3" />
      <polyline
        points={points.map(([t, c]) => `${x(t).toFixed(1)},${y(c).toFixed(1)}`).join(" ")}
        fill="none"
        className="stroke-slate-700"
        strokeWidth={1.3}
      />
      <text x={298} y={y(30) - 2} textAnchor="end" className="fill-orange-400 text-[8px]">
        30 °C
      </text>
    </svg>
  );
}

const RATING_STYLE: Record<CarrierPerformance["rating"], string> = {
  "as rated": "bg-emerald-50 text-emerald-800 ring-emerald-200",
  underperforming: "bg-amber-50 text-amber-800 ring-amber-200",
  failing: "bg-red-100 text-red-800 ring-red-300",
  untested: "bg-slate-100 text-slate-600 ring-slate-200",
};

function CarrierRow({ carrier }: { carrier: CarrierPerformance }) {
  const share = carrier.effective_cold_life_h == null ? null : Math.min(carrier.effective_cold_life_h / carrier.rated_cold_life_h, 1);
  return (
    <li>
      <div className="flex items-center justify-between gap-2">
        <Link to={`/node/${carrier.node_id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
          {carrier.label}
        </Link>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ${RATING_STYLE[carrier.rating]}`}>
          {carrier.rating}
        </span>
      </div>
      {share != null && (
        <div className="mt-2">
          <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full ${share >= 0.8 ? "bg-emerald-500" : share >= 0.4 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${Math.max(share * 100, 2)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {carrier.effective_cold_life_h} h of cold on its worst trip vs {carrier.rated_cold_life_h} h rated ·{" "}
            {carrier.legs.length} trips checked
          </p>
        </div>
      )}
      <p className="mt-1 text-sm text-slate-700">{carrier.note}</p>
    </li>
  );
}

/** On phones a one-finger drag should scroll the page, not pan the map. */
function coarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}
