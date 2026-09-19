import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { AgentAdvice, Facility } from "../types";

const TONE: Record<AgentAdvice["recommendation"]["action"], { bg: string; fg: string }> = {
  CONTINUE: { bg: "var(--color-good-tint)", fg: "var(--color-good-fg)" },
  DIVERT: { bg: "var(--color-warn-tint)", fg: "var(--color-warn-fg)" },
  HOLD: { bg: "var(--color-bad-tint)", fg: "var(--color-bad-fg)" },
  UNKNOWN: { bg: "var(--color-neutral-900)", fg: "var(--color-neutral-200)" },
};

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
  const tone = rec ? TONE[rec.action] : null;
  return (
    <div>
      {rec && tone && (
        <section className="mb-2.5 rounded-[14px] px-[22px] py-5" style={{ background: tone.bg, color: tone.fg }}>
          <p className="m-0 mb-2 text-[22px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {title(rec)}
            {rec.action === "DIVERT" && rec.eta_min != null && <span className="text-base font-normal opacity-80"> · {rec.eta_min} min</span>}
          </p>
          <p className="m-0 mb-3 text-base leading-[1.45] [text-wrap:pretty]">{rec.summary}</p>
          {rec.reasons.length > 0 && (
            <ul className="m-0 mb-4 list-disc pl-5 text-sm opacity-85">
              {rec.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {accepted ? (
            <p className="m-0 text-sm font-medium">{accepted}</p>
          ) : (
            <button onClick={accept} disabled={accepting || rec.action === "UNKNOWN"} className="btn-outline">
              {accepting ? "Logging…" : "Accept and log"}
            </button>
          )}
          <details className="mt-3 text-[13px] opacity-80">
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
          <option value="">Heading to…</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button onClick={ask} disabled={busy} className={rec ? "btn-quiet" : "btn-outline"}>
          {busy ? "Thinking…" : rec ? "Ask again" : "Ask the agent"}
        </button>
      </div>
      {failure && (
        <p role="alert" className="m-0 mt-2 text-sm" style={{ color: "var(--color-bad)" }}>
          {failure}
        </p>
      )}
    </div>
  );
}
