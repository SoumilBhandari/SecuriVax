import { useState } from "react";

import { api } from "../lib/api";
import { useSignInFirst } from "../lib/auth";

/** Puts the live stage demo (DEMO-01, BOX-9001/9002) back to the start. */
export function StageReset({ onDone }: { onDone?: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const signInFirst = useSignInFirst();
  const reset = () => {
    if (signInFirst()) return;
    if (!window.confirm("Reset the stage demo? DEMO-01's readings and BOX-9001/9002's history are cleared. The lanes stay.")) return;
    setBusy(true);
    api
      .resetStage()
      .then(() => {
        const msg = "Stage demo reset: BOX-9001 and BOX-9002 are fresh and unloaded.";
        setNote(msg);
        onDone?.(msg);
      })
      .catch((e: Error) => setNote(`Couldn't reset: ${e.message}`))
      .finally(() => setBusy(false));
  };
  return (
    <div>
      <button onClick={reset} disabled={busy} className="btn-secondary w-full">
        {busy ? "Resetting…" : "Reset the stage demo"}
      </button>
      {note && !onDone && <p role="status" className="ui-caption m-0 mt-2">{note}</p>}
    </div>
  );
}
