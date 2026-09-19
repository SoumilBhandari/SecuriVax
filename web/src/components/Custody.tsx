import { Link } from "react-router";

import { pct, placeName, temp, time } from "../lib/format";
import type { Segment } from "../types";
import { OfflineIcon, PinIcon } from "./Icons";

/** Chain of custody: every node the box rode in, where it got on and off. */
export function Custody({ segments, places }: { segments: Segment[]; places: Record<string, string> }) {
  if (segments.length === 0) {
    return <p className="text-sm text-slate-500">Not loaded into a monitored carrier yet.</p>;
  }
  return (
    <ol className="relative ml-2 border-l-2 border-slate-200">
      {segments.map((s) => {
        const from = placeName(places, s.start_lat, s.start_lon);
        const to = placeName(places, s.end_lat, s.end_lon);
        return (
          <li key={`${s.node_id}-${s.start_ts}`} className="mb-5 ml-4 last:mb-0">
            <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-600" />
            <p className="text-xs text-slate-500">{time(s.start_ts)}</p>
            <p className="text-sm font-medium text-slate-900">
              Loaded into{" "}
              <Link to={`/node/${s.node_id}`} className="underline decoration-slate-300 underline-offset-2">
                {s.node_label}
              </Link>
            </p>
            {from && (
              <p className="flex items-center gap-1 text-xs text-slate-500">
                <PinIcon size={12} /> {from}
              </p>
            )}
            <div className="my-2 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2 text-center text-xs">
              <div>
                <p className="text-slate-500">Min</p>
                <p className="font-semibold text-slate-800">{temp(s.min_temp_c)}</p>
              </div>
              <div>
                <p className="text-slate-500">Max</p>
                <p className="font-semibold text-slate-800">{temp(s.max_temp_c)}</p>
              </div>
              <div>
                <p className="text-slate-500">Budget used</p>
                <p className="font-semibold text-slate-800">{pct(s.budget_used)}</p>
              </div>
            </div>
            {s.gaps.map((g) => (
              <p key={g.start_ts} className="mb-1 flex items-center gap-1 text-xs text-amber-700">
                <OfflineIcon size={12} />
                {g.ongoing ? `No data since ${time(g.start_ts)}` : `No data ${time(g.start_ts)} to ${time(g.end_ts)}`}
              </p>
            ))}
            {s.end_ts ? (
              <>
                <p className="text-xs text-slate-500">{time(s.end_ts)}</p>
                <p className="text-sm font-medium text-slate-900">Unloaded</p>
                {to && (
                  <p className="flex items-center gap-1 text-xs text-slate-500">
                    <PinIcon size={12} /> {to}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm font-medium text-emerald-700">Still inside · {s.reading_count} readings so far</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
