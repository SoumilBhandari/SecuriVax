import type { ReactNode } from "react";

import { temp, weatherSource } from "../lib/format";
import type { EnvCode, Segment } from "../types";
import { AlertIcon, CheckIcon, FlameIcon, SnowIcon, ThermoIcon } from "./Icons";

const CODE: Record<EnvCode, { label: string; style: string; icon: ReactNode }> = {
  PROTECTED: { label: "Carrier protected it", style: "bg-emerald-50 text-emerald-800", icon: <CheckIcon size={14} /> },
  TRACKING_AMBIENT: { label: "Followed the outside air", style: "bg-orange-50 text-orange-800", icon: <ThermoIcon size={14} /> },
  HEAT_SOURCE: { label: "Hotter than outside", style: "bg-red-50 text-red-800", icon: <FlameIcon size={14} /> },
  FROZEN_PACKS: { label: "Frozen by its own packs", style: "bg-violet-50 text-violet-800", icon: <SnowIcon size={14} /> },
  CALM: { label: "Mild weather", style: "bg-slate-100 text-slate-700", icon: <CheckIcon size={14} /> },
  NO_DATA: { label: "Not enough data", style: "bg-slate-100 text-slate-500", icon: <AlertIcon size={14} /> },
};

const LOCATED_BY: Record<string, string> = {
  smarttag: "Located by Samsung SmartTag",
  gps: "Located by the node's GPS",
  phone: "Located by phone",
};

/** Inside vs outside, per leg: was it the weather or the equipment? */
export function Environment({ segments }: { segments: Segment[] }) {
  const legs = segments.filter((s) => s.environment);
  if (legs.length === 0) return <p className="text-sm text-slate-500">No legs yet.</p>;
  return (
    <div className="space-y-4">
      {legs.map((s) => {
        const env = s.environment!;
        const code = CODE[env.code];
        return (
          <div key={`${s.node_id}-${s.start_ts}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-900">{s.node_label}</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${code.style}`}>
                {code.icon}
                {code.label}
              </span>
            </div>
            <p className="text-sm leading-snug text-slate-700">{env.text}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-50 p-2">
                <dt className="text-slate-500">Outside</dt>
                <dd className="font-semibold text-slate-800">
                  {env.ambient_min_c == null ? "–" : `${env.ambient_min_c.toFixed(0)}–${env.ambient_max_c!.toFixed(0)} °C`}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <dt className="text-slate-500">Inside, mean</dt>
                <dd className="font-semibold text-slate-800">{temp(env.inside_mean_c)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <dt className="text-slate-500">Sensor noise</dt>
                <dd className="font-semibold text-slate-800">{env.noise_c == null ? "–" : `±${env.noise_c.toFixed(2)} °C`}</dd>
              </div>
            </dl>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {weatherSource(env.source)}
              {s.located_by && ` · ${LOCATED_BY[s.located_by] ?? s.located_by}`}
              {s.backup_label && ` · backup node ${s.backup_label}`}
            </p>
          </div>
        );
      })}
      <p className="text-[11px] leading-snug text-slate-400">
        Weather never changes the verdict. It shows whether a problem came from the environment or the equipment.
      </p>
    </div>
  );
}
