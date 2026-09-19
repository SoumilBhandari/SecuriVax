import { lazy, Suspense, useState } from "react";
import { Link } from "react-router";

import { hours, pct, time } from "../lib/format";
import type { Segment } from "../types";
import { ErrorBoundary } from "./ErrorBoundary";
import { OfflineIcon } from "./Icons";

const RouteMap = lazy(() => import("./RouteMap"));

/** Same threshold as the engine: a shorter handoff is a blip, not a hole. */
const UNMONITORED_S = 15 * 60;

/**
 * Where the box has been: one stop per carrier or cold room, with how long it
 * stayed, the temperature range, the budget it cost, and what the weather says
 * about it. Time in no monitored carrier is shown, never hidden.
 */
export function Custody({ segments, places }: { segments: Segment[]; places: Record<string, string> }) {
  const [map, setMap] = useState(false);
  if (segments.length === 0) {
    return <p className="m-0 text-[15px] text-neutral-300">Not loaded into a monitored carrier yet.</p>;
  }
  const now = Date.now() / 1000;
  const last = segments[segments.length - 1];
  const hasRoute = segments.some((s) => s.route.length > 0);
  return (
    <div>
      <ol className="m-0 flex list-none flex-col p-0">
        {segments.map((s, i) => {
          const prev = i > 0 ? segments[i - 1] : null;
          const gap = prev?.end_ts != null ? s.start_ts - prev.end_ts : 0;
          const isLast = i === segments.length - 1;
          const span = s.end_ts ? hours((s.end_ts - s.start_ts) / 3600) : "still inside";
          const range = s.min_temp_c == null ? "no readings" : `${s.min_temp_c.toFixed(1)} to ${s.max_temp_c!.toFixed(1)} °C`;
          return (
            <li key={`${s.node_id}-${s.start_ts}`}>
              {gap > UNMONITORED_S && <Unmonitored text={`Unmonitored for ${hours(gap / 3600)}: no temperature record`} />}
              <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-3.5">
                <span className="flex flex-col items-center">
                  <span className="h-3.5 w-3.5 rounded-full" style={{ background: s.end_ts ? "#595d6c" : "var(--color-good)" }} />
                  {!isLast && <span className="my-1 w-0.5 flex-1 bg-divider" />}
                </span>
                <span className="flex flex-col gap-[3px] pb-[18px]">
                  <span className="flex justify-between gap-2.5">
                    <Link to={`/node/${s.node_id}`} className="text-base font-semibold text-text hover:text-accent-400">
                      {s.node_label}
                    </Link>
                    <span className="whitespace-nowrap text-sm text-neutral-400">{pct(s.budget_used)} of budget</span>
                  </span>
                  <span className="text-sm text-neutral-300">
                    {time(s.start_ts)} · {span} · {range}
                  </span>
                  {s.environment && <span className="mt-0.5 text-[15px] leading-[1.4]">{s.environment.text}</span>}
                  {s.gaps.map((g) => (
                    <span key={g.start_ts} className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--color-warn)" }}>
                      <OfflineIcon size={13} />
                      {g.ongoing ? `No data since ${time(g.start_ts)}` : `No data ${time(g.start_ts)} to ${time(g.end_ts)}`}
                    </span>
                  ))}
                  {s.backup_label && s.backup_filled > 0 && (
                    <span className="text-[13px] text-neutral-400">
                      Backup node {s.backup_label} filled {s.backup_filled} readings
                    </span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {last.end_ts != null && now - last.end_ts > UNMONITORED_S && (
        <Unmonitored text={`Not in a monitored carrier since ${time(last.end_ts)} (${hours((now - last.end_ts) / 3600)})`} />
      )}
      {hasRoute &&
        (map ? (
          <div className="mt-3">
            <ErrorBoundary label="The map">
              <Suspense fallback={<p className="text-sm text-neutral-400">Loading the map…</p>}>
                <RouteMap segments={segments} places={places} />
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : (
          <button onClick={() => setMap(true)} className="btn-quiet mt-2 w-full">
            Show the route on a map
          </button>
        ))}
    </div>
  );
}

function Unmonitored({ text }: { text: string }) {
  return (
    <p className="m-0 mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: "var(--color-warn-tint)", color: "var(--color-warn-fg)" }}>
      <OfflineIcon size={14} />
      {text}
    </p>
  );
}
