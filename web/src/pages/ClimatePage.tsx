import "leaflet/dist/leaflet.css";

import { latLngBounds } from "leaflet";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import { Link } from "react-router";

import { ChevronRightIcon } from "../components/Icons";
import { ErrorNote, Layout, SectionTitle, Spinner } from "../components/Layout";
import { VerdictChip } from "../components/Verdict";
import { api } from "../lib/api";
import { ago, RISK_COLOR, RISK_STYLE, time, weatherSource } from "../lib/format";
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
    <Layout>
      <h1 className="m-0 mb-1.5 mt-[26px] text-[34px] leading-[1.05]">Heat ahead</h1>
      <p className="m-0 mb-[18px] text-sm text-neutral-400">
        {stores ? `${weatherSource(stores.source)} · updated ${ago(stores.generated_at)}` : "Weather forecast against the cold chain"}
      </p>
      {error && <ErrorNote error={error} />}
      {!stores && !error && <Spinner label="Fetching the forecast" />}

      {stores && (
        <>
          <section className="rounded-[14px] bg-accent-900 p-[22px] text-accent-200">
            <p className="m-0 text-[19px] font-semibold leading-[1.3] tracking-[-0.02em] [text-wrap:pretty]">{stores.summary}</p>
            <p className="m-0 mt-2 text-sm opacity-80">None of this changes a box's verdict: it's what to do before the heat arrives.</p>
          </section>
          <div className="mt-3.5">
            <RiskMap sites={stores.facilities} />
          </div>
          <SectionTitle>Stores and clinics · next 72 h</SectionTitle>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {stores.facilities.map((f) => (
              <Site key={f.id} site={f} />
            ))}
          </ul>
        </>
      )}

      <SectionTitle aside="cold life from real trips">Carriers: model vs reality</SectionTitle>
      {!carriers ? (
        <Spinner />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {carriers.map((c) => (
            <CarrierRow key={c.node_id} carrier={c} />
          ))}
        </ul>
      )}

      <Link to="/plan" className="btn-accent mt-6 no-underline">
        Plan a trip from the forecast
        <ChevronRightIcon size={18} />
      </Link>
    </Layout>
  );
}

function RiskMap({ sites }: { sites: StoreRisk[] }) {
  if (sites.length === 0) return null;
  const bounds = latLngBounds(sites.map((s) => [s.lat, s.lon] as [number, number])).pad(0.2);
  return (
    <div className="h-56 overflow-hidden rounded-[14px] border border-line">
      <MapContainer bounds={bounds} scrollWheelZoom={false} dragging={!coarsePointer()} className="h-full w-full">
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
        {sites.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lon]}
            radius={s.kind === "store" ? 10 : 7}
            pathOptions={{ color: "#161826", weight: 2, fillColor: RISK_COLOR[s.risk], fillOpacity: 0.95 }}
          >
            <Tooltip>
              {s.name}: {s.risk}, peak {s.peak_c.toFixed(0)} °C {time(s.peak_ts)}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

function Site({ site }: { site: StoreRisk }) {
  const r = RISK_STYLE[site.risk];
  return (
    <li className="panel flex flex-col gap-1 px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-lg leading-tight">{site.name}</span>
        <span className="pill !px-2.5 !py-1 !text-xs capitalize" style={{ background: r.tint, color: r.fg }}>
          {site.risk}
        </span>
      </div>
      <span className="text-sm text-neutral-300">
        Peak {site.peak_c.toFixed(0)} °C {time(site.peak_ts)} · {site.hours_above_30_next_72h} h above 30 °C ahead
      </span>
      <Forecast points={site.forecast} />
      {site.actions.map((a) => (
        <span key={a} className="mt-1 text-[15px] leading-[1.4]">
          {a}
        </span>
      ))}
      {site.stock.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {site.stock.map((b) => (
            <Link key={b.id} to={`/box/${b.id}`} className="flex items-center gap-2 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200">
              {b.id}
              <VerdictChip verdict={b.verdict} small />
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
    <svg viewBox="0 0 300 40" className="mt-1 h-10 w-full" role="img" aria-label="72-hour temperature forecast">
      <line x1={0} x2={300} y1={y(30)} y2={y(30)} stroke="oklch(74% 0.14 48 / .7)" strokeDasharray="3 3" />
      <polyline points={points.map(([t, c]) => `${x(t).toFixed(1)},${y(c).toFixed(1)}`).join(" ")} fill="none" stroke="#e9e9ed" strokeWidth={1.3} />
      <text x={298} y={y(30) - 3} textAnchor="end" fontSize="8" fill="oklch(74% 0.14 48)">
        30 °C
      </text>
    </svg>
  );
}

const RATING: Record<CarrierPerformance["rating"], { color: string; tint: string }> = {
  "as rated": { color: "var(--color-good)", tint: "var(--color-good-tint)" },
  underperforming: { color: "var(--color-warn)", tint: "var(--color-warn-tint)" },
  failing: { color: "var(--color-bad)", tint: "var(--color-bad-tint)" },
  untested: { color: "var(--color-neutral-400)", tint: "var(--color-neutral-900)" },
};

function CarrierRow({ carrier }: { carrier: CarrierPerformance }) {
  const r = RATING[carrier.rating];
  const share = carrier.effective_cold_life_h == null ? null : Math.min(carrier.effective_cold_life_h / carrier.rated_cold_life_h, 1);
  return (
    <li className="panel flex flex-col gap-2 px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/node/${carrier.node_id}`} className="text-base font-semibold text-text hover:text-accent-400">
          {carrier.label}
        </Link>
        <span className="pill !px-2.5 !py-1 !text-xs capitalize" style={{ background: r.tint, color: r.color }}>
          {carrier.rating}
        </span>
      </div>
      {share != null && (
        <>
          <span className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, 2)}%`, background: r.color }} />
          </span>
          <span className="text-[13px] text-neutral-400">
            {carrier.effective_cold_life_h} h of cold on its worst trip vs {carrier.rated_cold_life_h} h rated · {carrier.legs.length} trips checked
          </span>
        </>
      )}
      <span className="text-sm text-neutral-300">{carrier.note}</span>
    </li>
  );
}

/** On phones a one-finger drag should scroll the page, not pan the map. */
function coarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}
