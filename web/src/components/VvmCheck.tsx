import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { pct } from "../lib/format";
import type { LabelCheck, VvmResult } from "../types";

const STAGES: Record<number, string> = {
  1: "Stage 1: fresh",
  2: "Stage 2: use",
  3: "Stage 3: discard point",
  4: "Stage 4: beyond discard",
};

/**
 * The second witness: photograph the vial's VVM, measure it, compare with the
 * sensor record. Nothing counts until the health worker confirms it.
 */
export function VvmCheck({
  boxId,
  latest,
  highlight,
  onConfirmed,
}: {
  boxId: string;
  latest: LabelCheck | null;
  highlight: boolean;
  onConfirmed: () => void;
}) {
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VvmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (image: string) => {
    setBusy(true);
    setError(null);
    api
      .checkVvm(boxId, image)
      .then(setResult)
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setCamera(false);
      });
  };

  const fromFile = (file: File) => {
    const img = new Image();
    img.onload = () => submit(cropCenter(img, img.naturalWidth, img.naturalHeight));
    img.src = URL.createObjectURL(file);
  };

  const confirm = (stage?: number) => {
    if (!result?.check_id) return;
    setBusy(true);
    api
      .confirmVvm(boxId, result.check_id, stage)
      .then(() => {
        setResult(null);
        onConfirmed();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div id="vvm" className={highlight ? "rounded-xl ring-2 ring-amber-400 ring-offset-4" : ""}>
      {latest && !result && (
        <p className="mb-3 text-sm text-slate-700">
          Last confirmed label: <span className="font-medium">{STAGES[latest.stage]}</span> ({pct(latest.progress)}), sensor said{" "}
          {pct(latest.sensor_budget)}.
        </p>
      )}
      {highlight && !result && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          The sensor verdict is borderline. A photo of the VVM label settles it.
        </p>
      )}

      {camera ? (
        <Camera onCapture={submit} onCancel={() => setCamera(false)} onError={() => { setCamera(false); fileRef.current?.click(); }} />
      ) : !result ? (
        <div className="flex gap-2">
          <button
            onClick={() => setCamera(true)}
            disabled={busy}
            className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Reading…" : "Check the VVM label"}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
          >
            Upload
          </button>
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && fromFile(e.target.files[0])}
      />
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {result && <Result result={result} busy={busy} onConfirm={confirm} onRetry={() => setResult(null)} />}
    </div>
  );
}

function Result({
  result,
  busy,
  onConfirm,
  onRetry,
}: {
  result: VvmResult;
  busy: boolean;
  onConfirm: (stage?: number) => void;
  onRetry: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  if (!result.found) {
    return (
      <div className="mt-2">
        <p className="text-sm text-amber-800">{result.message}</p>
        <button onClick={onRetry} className="mt-2 text-sm underline">
          Try again
        </button>
      </div>
    );
  }
  const { reading, witnesses, gemini } = result;
  const agree = witnesses!.code === "AGREE";
  return (
    <div className="mt-1 space-y-3">
      <Bars label={witnesses!.label} sensor={witnesses!.sensor} />
      <p className={`rounded-lg p-2 text-sm ${agree ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
        {witnesses!.text}
      </p>
      <p className="text-sm text-slate-700">
        Camera: <span className="font-medium">{STAGES[reading!.stage]}</span>
        {gemini && gemini.stage != null && (
          <>
            {" "}· Gemini: <span className="font-medium">{STAGES[gemini.stage]}</span> ({pct(gemini.confidence)} sure)
            {gemini.stage !== reading!.stage && <span className="text-amber-700"> (they differ: look carefully)</span>}
          </>
        )}
      </p>
      {!correcting ? (
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm()}
            disabled={busy}
            className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm: label looks like this
          </button>
          <button onClick={() => setCorrecting(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            It's different
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((s) => (
            <button
              key={s}
              onClick={() => onConfirm(s)}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              {STAGES[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Bars({ label, sensor }: { label: number; sensor: number }) {
  const row = (name: string, v: number, color: string) => (
    <div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>{name}</span>
        <span className="tabular-nums">{pct(v)}</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(v, 1.2) / 1.2 * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-slate-900/50" style={{ left: `${(1 / 1.2) * 100}%` }} />
      </div>
    </div>
  );
  return (
    <div className="space-y-2">
      {row("VVM label (camera)", label, "bg-violet-500")}
      {row("Sensor record (black box)", sensor, "bg-sky-600")}
      <p className="text-[11px] text-slate-400">The line marks the discard point (100%).</p>
    </div>
  );
}

/** Live camera with a circle guide; returns the guide region as a JPEG. */
function Camera({ onCapture, onCancel, onError }: { onCapture: (img: string) => void; onCancel: () => void; onError: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const failed = useRef(onError);
  failed.current = onError;

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (!navigator.mediaDevices) {
      failed.current(); // no camera API (e.g. plain http): fall back to the file picker
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => failed.current());
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    onCapture(cropCenter(v, v.videoWidth, v.videoHeight));
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={video} autoPlay playsInline muted className="block w-full" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="aspect-square w-[55%] rounded-full border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      </div>
      <p className="mt-1 text-center text-xs text-slate-500">Fill the circle with the VVM, avoid glare, hold steady.</p>
      <div className="mt-2 flex gap-2">
        <button onClick={capture} className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Take photo
        </button>
        <button onClick={onCancel} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Crop the square around the guide circle (a bit larger) and shrink it. */
function cropCenter(source: CanvasImageSource, w: number, h: number): string {
  const side = Math.min(w, h) * 0.7;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 480;
  canvas.getContext("2d")!.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 480, 480);
  return canvas.toDataURL("image/jpeg", 0.88);
}
