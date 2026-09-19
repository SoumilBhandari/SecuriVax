import "leaflet/dist/leaflet.css";

import { latLngBounds } from "leaflet";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import { Link } from "react-router";

import { ChevronRightIcon } from "../components/Icons";
import { ErrorNote, Layout, PageTitle, SectionTitle, Spinner } from "../components/Layout";
import { VerdictChip } from "../components/Verdict";
import { api } from "../lib/api";
import { ago, RISK_COLOR, time, weatherSource } from "../lib/format";
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
      <PageTitle
        top
        eyebrow="Climate"
        title="Heat ahead"
        sub={stores ? `${weatherSource(stores.source)} · updated ${ago(stores.generated_at)}` : "Weather forecast against the cold chain"}
      />
      {error && <ErrorNote error={error} />}
      {!stores && !error && <Spinner label="Fetching the forecast" />}

      {stores && (
        <>
          <section className="card-soft p-4">
            <p className="ui-heading m-0">{stores.summary}</p>
            <p className="ui-caption m-0 mt-2">None of this changes a box's verdict: it's what to do before the heat arrives.</p>
          </section>
          <div className="mt-3">
            <RiskMap sites={stores.facilities} />
          </div>
          <SectionTitle>Stores and clinics · next 72 h</SectionTitle>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
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
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {carriers.map((c) => (
            <CarrierRow key={c.node_id} carrier={c} />
          ))}
        </ul>
      )}

      <Link to="/plan" className="btn-primary mt-6">
        Plan a trip from the forecast
        <ChevronRightIcon size={18} />
      </Link>
    </Layout>
  );
}

/** The stores and clinics on OpenStreetMap, coloured by heat risk (the original map). */
function RiskMap({ sites }: { sites: StoreRisk[] }) {
  if (sites.length === 0) return null;
  const bounds = latLngBounds(sites.map((s) => [s.lat, s.lon] as [number, number])).pad(0.2);
  return (
    <div>
      <div className="h-56 overflow-hidden rounded-2xl border border-line">
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

function Site({ site }: { site: StoreRisk }) {
  return (
    <li className="panel flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-[17px] font-semibold leading-6 tracking-[-0.01em]">{site.name}</span>
        <span className="pill">{site.risk}</span>
      </div>
      <span className="ui-caption">
        Peak {site.peak_c.toFixed(0)} °C {time(site.peak_ts, site.tz)} · {site.hours_above_30_next_72h} h above 30 °C ahead
      </span>
      <Forecast points={site.forecast} />
      {site.actions.map((a) => (
        <span key={a} className="mt-1">
          {a}
        </span>
      ))}
      {site.stock.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {site.stock.map((b) => (
            <Link key={b.id} to={`/box/${b.id}`} className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-1.5 text-xs font-medium text-text no-underline hover:border-line-strong">
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
      <line x1={0} x2={300} y1={y(30)} y2={y(30)} stroke="var(--text-muted)" strokeDasharray="3 3" />
      <polyline points={points.map(([t, c]) => `${x(t).toFixed(1)},${y(c).toFixed(1)}`).join(" ")} fill="none" stroke="var(--line)" strokeWidth={1.5} strokeLinejoin="round" />
      <text x={298} y={y(30) - 3} textAnchor="end" fontSize="8" fill="var(--text-muted)">
        30 °C
      </text>
    </svg>
  );
}

function CarrierRow({ carrier }: { carrier: CarrierPerformance }) {
  const share = carrier.effective_cold_life_h == null ? null : Math.min(carrier.effective_cold_life_h / carrier.rated_cold_life_h, 1);
  return (
    <li className="panel flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/node/${carrier.node_id}`} className="font-display font-semibold tracking-[-0.01em] text-text no-underline hover:text-accent-300">
          {carrier.label}
        </Link>
        <span className="pill">{carrier.rating}</span>
      </div>
      {share != null && (
        <>
          <span className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, 2)}%`, background: "var(--line)" }} />
          </span>
          <span className="ui-caption">
            {carrier.effective_cold_life_h} h of cold on its worst trip vs {carrier.rated_cold_life_h} h rated · {carrier.legs.length} trips checked
          </span>
        </>
      )}
      <span className="text-[15px]">{carrier.note}</span>
    </li>
  );
}
