import type { ReactNode } from "react";
import { Link } from "react-router";

import { hours, pct, placeName, temp, time, weatherSource } from "../lib/format";
import type { EnvCode, Segment } from "../types";
import { AlertIcon, CheckIcon, FlameIcon, OfflineIcon, SnowIcon, ThermoIcon } from "./Icons";

const ENV: Record<EnvCode, { label: string; style: string; icon: ReactNode }> = {
  PROTECTED: { label: "Protected it", style: "bg-emerald-50 text-emerald-800", icon: <CheckIcon size={12} /> },
  TRACKING_AMBIENT: { label: "Followed outside air", style: "bg-orange-50 text-orange-800", icon: <ThermoIcon size={12} /> },
  HEAT_SOURCE: { label: "Hotter than outside", style: "bg-red-50 text-red-800", icon: <FlameIcon size={12} /> },
  FROZEN_PACKS: { label: "Frozen by its packs", style: "bg-violet-50 text-violet-800", icon: <SnowIcon size={12} /> },
  CALM: { label: "Mild weather", style: "bg-slate-100 text-slate-700", icon: <CheckIcon size={12} /> },
  NO_DATA: { label: "No weather data", style: "bg-slate-100 text-slate-500", icon: <AlertIcon size={12} /> },
};

const LOCATED_BY: Record<string, string> = {
  smarttag: "located by Samsung SmartTag",
  gps: "located by the node's GPS",
  phone: "located by phone",
};

/**
 * Chain of custody, one row per carrier or cold room. Each row shows how long
 * the box was there, the temperature range and the budget it cost; tapping it
 * opens the weather comparison (was it the weather or the equipment?).
 */
export function Custody({ segments, places }: { segments: Segment[]; places: Record<string, string> }) {
  if (segments.length === 0) {
    return <p className="text-sm text-muted">Not loaded into a monitored carrier yet.</p>;
  }
  const now = Date.now() / 1000;
  return (
    <ol className="divide-y divide-line">
      {segments.map((s) => {
        const env = s.environment;
        const code = env ? ENV[env.code] : null;
        const from = placeName(places, s.start_lat, s.start_lon);
        const to = placeName(places, s.end_lat, s.end_lon);
        const dur = hours(((s.end_ts ?? now) - s.start_ts) / 3600);
        return (
          <li key={`${s.node_id}-${s.start_ts}`}>
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none gap-3 py-2.5 [&::-webkit-details-marker]:hidden">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.end_ts ? "bg-faint" : "bg-ok"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{s.node_label}</p>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{pct(s.budget_used)}</span>
                  </div>
                  <p className="text-xs text-muted">
                    {time(s.start_ts)} · {s.end_ts ? dur : `${dur}, still inside`} · {temp(s.min_temp_c)} to {temp(s.max_temp_c)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {code && (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${code.style}`}>
                        {code.icon}
                        {code.label}
                      </span>
                    )}
                    {s.gaps.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        <OfflineIcon size={12} />
                        {s.gaps.length} gap{s.gaps.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <span aria-hidden className="mt-1 text-faint transition-transform group-open:rotate-90">›</span>
              </summary>
              <div className="mb-3 ml-5.5 space-y-2 rounded-xl bg-slate-50 p-3 text-xs text-muted">
                {env && <p className="text-sm leading-snug text-ink">{env.text}</p>}
                {env && (
                  <p>
                    Outside {env.ambient_min_c == null ? "–" : `${env.ambient_min_c.toFixed(0)}–${env.ambient_max_c!.toFixed(0)} °C`} · inside
                    mean {temp(env.inside_mean_c)} · sensor noise {env.noise_c == null ? "–" : `±${env.noise_c.toFixed(2)} °C`}
                  </p>
                )}
                {(from || to) && (
                  <p>
                    {from ?? "?"} → {s.end_ts ? (to ?? "?") : "now"}
                  </p>
                )}
                {s.gaps.map((g) => (
                  <p key={g.start_ts} className="flex items-center gap-1 text-amber-800">
                    <OfflineIcon size={12} />
                    {g.ongoing ? `No data since ${time(g.start_ts)}` : `No data ${time(g.start_ts)} to ${time(g.end_ts)}`}
                  </p>
                ))}
                <p>
                  {env ? weatherSource(env.source) : "No weather comparison"}
                  {s.located_by && ` · ${LOCATED_BY[s.located_by] ?? s.located_by}`}
                  {s.backup_label && ` · backup node ${s.backup_label}`} · {s.reading_count} readings ·{" "}
                  <Link to={`/node/${s.node_id}`} className="underline underline-offset-2">
                    carrier page
                  </Link>
                </p>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
