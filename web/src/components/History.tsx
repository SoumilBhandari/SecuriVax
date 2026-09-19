import { time } from "../lib/format";
import type { HistoryEvent } from "../types";

const WORDS: Record<HistoryEvent["action"], string> = {
  load: "Loaded into",
  transfer: "Handed over to",
  unload: "Unloaded from",
  checkpoint: "Checkpoint",
  receive: "Picked up",
};

/** Every custody event, oldest first: what happened, where, when, and who. */
export function History({ events }: { events: HistoryEvent[] }) {
  if (events.length === 0) return <p className="ui-caption m-0">Nothing logged yet.</p>;
  return (
    <ol className="panel m-0 list-none p-0">
      {events.map((e, i) => {
        const what =
          e.action === "checkpoint"
            ? `Checkpoint${e.facility ? ` at ${e.facility}` : e.lat != null ? ` at ${e.lat.toFixed(3)}, ${e.lon?.toFixed(3)}` : ""}`
            : e.action === "receive"
              ? `Picked up${e.facility ? ` at ${e.facility}` : ""}`
              : `${WORDS[e.action]} ${e.node_label ?? e.node_id ?? "a carrier"}`;
        const done = e.action === "receive";
        return (
          <li key={`${e.ts}-${i}`} className={`flex gap-3 px-4 py-3 ${i ? "border-t border-line" : ""}`}>
            <span
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: done ? "var(--signal-use)" : e.action === "checkpoint" ? "var(--glacier-500)" : "var(--text)" }}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{what}</span>
              <span className="ui-caption block">
                {time(e.ts)}
                {e.by && ` · ${e.by}`}
                {e.note && ` · ${e.note}`}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
