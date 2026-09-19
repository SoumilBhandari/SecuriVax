import { useState } from "react";

import { api } from "../lib/api";
import type { NodeSummary } from "../types";

/**
 * A low-power node checks in every few minutes and otherwise sleeps. Asking
 * to watch makes it stream a reading every 10 s for ten minutes, from its
 * next check-in.
 */
const ALWAYS_ON_S = 60;

export function WatchLive({ node, onAsked }: { node: NodeSummary; onAsked?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = node.live;
  // An always-on node (the stage demo checks in every few seconds, a simulated lane) streams anyway.
  if (!live || !node.checkin_s || node.checkin_s <= ALWAYS_ON_S) return null;

  const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const every = node.checkin_s >= 120 ? `${Math.round(node.checkin_s / 60)} min` : `${node.checkin_s} s`;
  const ask = () => {
    setBusy(true);
    setError(null);
    api
      .watchLive(node.id)
      .then(() => onAsked?.())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="card-soft flex flex-col gap-2 p-4">
      <p className="mono-label m-0">Low power · checks in every {every}</p>
      {live.state === "live" && live.until ? (
        <p className="m-0 text-[15px] font-semibold">Streaming live until {clock(live.until)}: a reading every 10 s.</p>
      ) : live.state === "asked" ? (
        <p className="m-0 text-[15px] font-semibold">
          Asked. It streams from its next check-in{live.next_checkin ? `, around ${clock(live.next_checkin)}` : ""}.
        </p>
      ) : (
        <button onClick={ask} disabled={busy} className="btn-secondary w-full">
          {busy ? "Asking…" : "Watch live for 10 minutes"}
        </button>
      )}
      {error && <p className="ui-caption m-0">{error.charAt(0).toUpperCase() + error.slice(1)}</p>}
    </div>
  );
}
