import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useSignInFirst } from "../lib/auth";
import type { AgentAdvice, Facility } from "../types";

const TOOL_LABEL: Record<string, string> = {
  get_carrier_status: "checked the carrier and its forecast",
  find_facilities: "looked up nearby fridges",
  breach_chance_before_arrival: "checked the risk of reaching",
};

function title(rec: AgentAdvice["recommendation"]): string {
  if (rec.action === "CONTINUE") return "Carry on";
  if (rec.action === "DIVERT") return `Divert to ${rec.facility_name}`;
  if (rec.action === "HOLD") return "Hold here";
  return "Unclear";
}

/** Ask the location agent what this carrier should do; a person accepts it. */
export function Dispatch({ nodeId }: { nodeId: string }) {
  const [facilities, setFacilities] = useState<(Facility & { road_km: number | null })[]>([]);
  const [destination, setDestination] = useState("");
  const [advice, setAdvice] = useState<AgentAdvice | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api.destinations(nodeId).then(setFacilities).catch(() => {});
  }, [nodeId]);

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

  const signInFirst = useSignInFirst();
  const accept = () => {
    if (!advice || signInFirst()) return;
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
    <div>
      {rec && (
        <section className="card-soft mb-3 p-4">
          <p className="m-0 mb-2 font-display text-[22px] font-semibold leading-7 tracking-[-0.02em]">
            {title(rec)}
            {rec.action === "DIVERT" && rec.eta_min != null && <span className="font-sans text-base font-normal text-neutral-500"> · {rec.eta_min} min</span>}
          </p>
          <p className="m-0 mb-3 [text-wrap:pretty]">{rec.summary}</p>
          {rec.reasons.length > 0 && (
            <ul className="ui-caption m-0 mb-4 list-disc pl-5">
              {rec.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {accepted ? (
            <p className="m-0 font-bold">{accepted}</p>
          ) : (
            <button onClick={accept} disabled={accepting || rec.action === "UNKNOWN"} className="btn-primary">
              {accepting ? "Logging…" : "Accept and log"}
            </button>
          )}
          <details className="ui-caption mt-3">
            <summary className="cursor-pointer">
              What the {advice!.source === "gemini" ? "Gemini agent" : "fallback rule"} looked at ({advice!.steps.length} steps)
            </summary>
            <ol className="mt-1 list-decimal pl-5">
              {advice!.steps.map((s, i) => (
                <li key={i}>
                  {TOOL_LABEL[s.tool] ?? s.tool}
                  {typeof s.args.facility_id === "string" ? ` ${s.args.facility_id}` : ""}
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}
      <div className="flex gap-2">
        <select
          value={destination}
          onChange={(e) => {
            setDestination(e.target.value);
            setAdvice(null); // advice was for the old destination
          }}
          className="select-pill flex-1"
          aria-label="Heading to"
        >
          <option value="">Heading to (optional)</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.road_km != null ? ` · ${f.road_km} km` : ""}
            </option>
          ))}
        </select>
        <button onClick={ask} disabled={busy} className={rec ? "btn-secondary" : "btn-primary !w-auto"}>
          {busy ? "Thinking…" : rec ? "Ask again" : "Ask the agent"}
        </button>
      </div>
      {failure && (
        <p role="alert" className="m-0 mt-2 font-bold">
          {failure}
        </p>
      )}
    </div>
  );
}
