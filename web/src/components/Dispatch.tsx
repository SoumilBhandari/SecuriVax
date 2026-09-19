import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { AgentAdvice, Facility } from "../types";

const ACTION_STYLE: Record<AgentAdvice["recommendation"]["action"], string> = {
  CONTINUE: "bg-emerald-50 text-emerald-900",
  DIVERT: "bg-orange-50 text-orange-900",
  HOLD: "bg-red-50 text-red-900",
  UNKNOWN: "bg-slate-100 text-slate-800",
};

const TOOL_LABEL: Record<string, string> = {
  get_carrier_status: "checked the carrier and its forecast",
  find_facilities: "looked up nearby fridges",
  breach_chance_before_arrival: "checked the risk of reaching",
};

/** Ask the location agent what this carrier should do; a person accepts it. */
export function Dispatch({ nodeId }: { nodeId: string }) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [destination, setDestination] = useState("");
  const [advice, setAdvice] = useState<AgentAdvice | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api.facilities().then(setFacilities).catch(() => {});
  }, []);

  const ask = () => {
    setBusy(true);
    setAccepted(null);
    setFailure(null);
    api
      .agent(nodeId, destination || null)
      .then(setAdvice)
      .catch((e: Error) => setFailure(`The agent couldn't answer: ${e.message}`))
      .finally(() => setBusy(false));
  };

  const accept = () => {
    if (!advice) return;
    const { action, facility_id } = advice.recommendation;
    setAccepting(true);
    api
      .decide(nodeId, action, facility_id)
      .then(() => setAccepted(`Logged: ${action.toLowerCase()} for every box inside.`))
      .catch((e: Error) => setFailure(`Couldn't log it: ${e.message}`))
      .finally(() => setAccepting(false));
  };

  const rec = advice?.recommendation;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select
          value={destination}
          onChange={(e) => {
            setDestination(e.target.value);
            setAdvice(null); // advice was for the old destination
          }}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          aria-label="Destination"
        >
          <option value="">Heading to… (optional)</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button onClick={ask} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
      {failure && <p role="alert" className="text-sm text-bad">{failure}</p>}
      {rec && (
        <div className={`rounded-xl p-3 ${ACTION_STYLE[rec.action]}`}>
          <p className="text-xs font-semibold tracking-wider">
            {rec.action}
            {rec.facility_name && ` → ${rec.facility_name}${rec.eta_min != null ? ` (${rec.eta_min} min)` : ""}`}
          </p>
          <p className="mt-1 text-sm">{rec.summary}</p>
          <ul className="mt-1 list-disc pl-5 text-xs opacity-80">
            {rec.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {accepted ? (
            <p className="mt-2 text-xs font-medium">{accepted}</p>
          ) : (
            <button onClick={accept} disabled={accepting || rec.action === "UNKNOWN"} className="mt-2 rounded-lg bg-white/80 px-4 text-sm font-semibold text-slate-900 disabled:opacity-50">
              {accepting ? "Logging…" : "Accept and log"}
            </button>
          )}
        </div>
      )}
      {advice && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">
            What the {advice.source === "gemini" ? "Gemini agent" : "fallback rule"} looked at ({advice.steps.length} steps)
          </summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {advice.steps.map((s, i) => (
              <li key={i}>
                {TOOL_LABEL[s.tool] ?? s.tool}
                {typeof s.args.facility_id === "string" ? ` ${s.args.facility_id}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
