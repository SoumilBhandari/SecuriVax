import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useSignInFirst } from "../lib/auth";
import { byDistance, getPosition, type Fix } from "../lib/geo";
import type { Facility, Report } from "../types";

// The two field scans. A driver taps the box's NFC sticker on the way: log a
// checkpoint (where it is now). The clinic scans the box's QR code: confirm
// the pickup (where it arrived). Both take the phone's position.

const NEAR_KM = 3;

export function FieldAction({
  kind,
  report,
  onDone,
  onClose,
}: {
  kind: "checkpoint" | "pickup";
  report: Report;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [fix, setFix] = useState<Fix | null | undefined>(undefined); // undefined: still looking
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facility, setFacility] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPosition().then(setFix);
    api.facilities().then(setFacilities).catch(() => setFacilities([]));
  }, []);

  const sorted = byDistance(facilities, fix ?? null);
  const near = sorted[0] && sorted[0].km != null && sorted[0].km <= NEAR_KM ? sorted[0] : null;
  // Pickup: the nearest clinic, else the one named like the box's destination.
  useEffect(() => {
    if (kind !== "pickup" || facility || !sorted.length) return;
    const dest = report.box.destination?.toLowerCase();
    const guess = near ?? sorted.find((f) => dest && f.name.toLowerCase().includes(dest));
    if (guess) setFacility(guess.id);
  }, [kind, facility, sorted, near, report.box.destination]);

  const signInFirst = useSignInFirst();
  const place = () => ({ lat: fix?.lat ?? null, lon: fix?.lon ?? null, accuracy_m: fix?.accuracy ?? null, note: note.trim() });
  const submit = () => {
    if (signInFirst(`/box/${report.box.id}?${kind}=1`)) return; // back to this card after signing in
    setBusy(true);
    setError(null);
    const call =
      kind === "checkpoint"
        ? api.checkpoint(report.box.id, place()).then((r) => `Checkpoint logged${r.facility ? ` at ${r.facility}` : fix ? "" : " (no location)"}.`)
        : api.receive(report.box.id, { ...place(), facility_id: facility || null }).then((r) => `Picked up${r.facility ? ` at ${r.facility}` : ""}. Its trip has ended.`);
    call
      .then(onDone)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const where =
    fix === undefined
      ? "Finding where you are…"
      : fix === null
        ? "No location from this phone: it'll be logged without one."
        : near
          ? `At ${near.name}`
          : sorted[0]?.km != null
            ? `${sorted[0].km.toFixed(1)} km from ${sorted[0].name}`
            : `${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)}`;

  return (
    <section className="rise-in panel mb-4 flex flex-col gap-3 p-4" style={{ borderColor: "var(--border-strong)" }}>
      <div className="flex items-center justify-between gap-3">
        <p className="mono-label m-0">{kind === "checkpoint" ? "NFC · checkpoint" : "QR · pickup"}</p>
        <button onClick={onClose} className="mono-label !min-h-0 bg-transparent hover:text-text">
          Not now
        </button>
      </div>
      <p className="ui-heading m-0">{kind === "checkpoint" ? `Log where ${report.box.id} is now?` : `Picking up ${report.box.id}?`}</p>
      <p className="ui-caption m-0">{where}</p>
      {kind === "pickup" && (
        <select value={facility} onChange={(e) => setFacility(e.target.value)} className="select-pill w-full" aria-label="Where it's picked up">
          <option value="">Choose the clinic or store…</option>
          {sorted.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.km != null ? ` · ${f.km.toFixed(f.km < 10 ? 1 : 0)} km` : ""}
            </option>
          ))}
        </select>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional)" className="select-pill w-full" />
      {error && (
        <p role="alert" className="m-0 text-sm font-medium" style={{ color: "var(--signal-discard)" }}>
          {error.charAt(0).toUpperCase() + error.slice(1)}
        </p>
      )}
      <button onClick={submit} disabled={busy || fix === undefined || (kind === "pickup" && !facility)} className="btn-primary">
        {busy ? "Saving…" : kind === "checkpoint" ? "Log checkpoint" : "Confirm pickup"}
      </button>
    </section>
  );
}
