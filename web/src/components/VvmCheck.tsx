import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { pct } from "../lib/format";
import { asset } from "../lib/snapshot";
import type { LabelCheck, VvmResult, Witnesses } from "../types";

const STAGES: Record<number, string> = {
  1: "Stage 1 · fresh",
  2: "Stage 2 · usable",
  3: "Stage 3 · discard point",
  4: "Stage 4 · past discard",
};

/**
 * The second witness: photograph the vial's VVM, measure it, and compare it
 * with what the temperature record predicts. Nothing counts until the health
 * worker confirms it; a confirmed photo also teaches the stability model.
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
  onConfirmed: (message: string) => void;
}) {
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VvmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noLiveCamera, setNoLiveCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraApp = useRef<HTMLInputElement>(null);

  const submit = (image: string) => {
    setBusy(true);
    setError(null);
    setCamera(false);
    api
      .checkVvm(boxId, image)
      .then(setResult)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const fromFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ""; // so picking the same photo again still fires
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      submit(cropSquare(img, img.naturalWidth, img.naturalHeight, 1));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That photo couldn't be opened. Try a JPEG or PNG.");
    };
    img.src = url;
  };

  const confirm = (stage?: number) => {
    if (!result?.check_id) return;
    setBusy(true);
    api
      .confirmVvm(boxId, result.check_id, stage)
      .then((res) => {
        setResult(null);
        const n = res.learned_rate.photos;
        onConfirmed(`Label confirmed. It now also calibrates this product's model (${n} field photo${n === 1 ? "" : "s"}).`);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div id="vvm">
      {latest && !result && !camera && <LatestLabel latest={latest} />}
      {highlight && !result && !camera && (
        <p className="mb-3 rounded-xl p-3 text-sm" style={{ background: "var(--color-warn-tint)", color: "var(--color-warn-fg)" }}>
          The temperature record is borderline. A photo of the VVM label settles it.
        </p>
      )}

      {camera ? (
        <Camera
          onCapture={submit}
          onCancel={() => setCamera(false)}
          onError={() => {
            setCamera(false);
            setNoLiveCamera(true);
          }}
        />
      ) : busy && !result ? (
        <p className="flex items-center gap-2 py-6 text-sm text-neutral-400" aria-live="polite">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-accent-400" />
          Measuring the square against the ring…
        </p>
      ) : !result ? (
        <div>
          {noLiveCamera ? (
            <button onClick={() => cameraApp.current?.click()} className="btn-accent">
              Open the camera
            </button>
          ) : (
            <button onClick={() => setCamera(true)} className="btn-accent">
              Scan the VVM label
            </button>
          )}
          <button onClick={() => fileRef.current?.click()} className="mt-1 w-full text-sm text-neutral-400 underline-offset-2 hover:underline">
            or choose a photo
          </button>
          <p className="mt-2 text-xs leading-snug text-neutral-400">
            The camera compares the inner square's brightness with the ring around it. Lighter than the ring: usable. As
            dark or darker: discard point. It then checks the result against what the temperature record predicts.
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            No VVM to hand? Open the{" "}
            <a href={asset("/vvm-target.html")} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              test target
            </a>{" "}
            on another screen, or print the test card from the Tags page.
          </p>
        </div>
      ) : null}
      <input ref={cameraApp} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => fromFile(e.target)} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => fromFile(e.target)} />
      {error && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--color-bad)" }}>{error}</p>}
      {result && <Result result={result} busy={busy} onConfirm={confirm} onRetry={() => setResult(null)} />}
    </div>
  );
}

function LatestLabel({ latest }: { latest: LabelCheck }) {
  return (
    <div className="tile mb-3 !p-3 text-sm">
      <p>
        Last confirmed label: <b>{STAGES[latest.stage]}</b>
        {latest.rho != null && <span className="text-neutral-400"> (square/ring {latest.rho.toFixed(2)})</span>}
      </p>
      <p className="text-xs text-neutral-400">
        The record said {pct(latest.sensor_budget)}
        {latest.predicted_stage != null && `, stage ${latest.predicted_stage}`} ·{" "}
        {latest.flagged ? <span className="font-semibold" style={{ color: "var(--color-warn)" }}>flagged: they disagreed</span> : "they agreed"}
      </p>
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
      <div role="alert" className="rounded-xl p-3" style={{ background: "var(--color-warn-tint)", color: "var(--color-warn-fg)" }}>
        <p className="m-0 text-sm">{result.message}</p>
        <button onClick={onRetry} className="mt-1 font-semibold underline underline-offset-2">
          Try again
        </button>
      </div>
    );
  }
  const reading = result.reading!;
  const w = result.witnesses!;
  const gemini = result.gemini;
  const span = w.predicted_stages[0] === w.predicted_stages[1] ? `${w.predicted_stages[0]}` : `${w.predicted_stages[0]}–${w.predicted_stages[1]}`;
  return (
    <div className="space-y-3">
      <div role="status" className="rounded-xl p-3" style={w.flagged ? { background: "var(--color-warn-tint)", color: "var(--color-warn-fg)" } : { background: "var(--color-good-tint)", color: "var(--color-good-fg)" }}>
        <p className="font-semibold">{w.flagged ? "Camera and record disagree" : "Camera and record agree"}</p>
        <p className="mt-0.5 text-sm leading-snug">{w.text}</p>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line text-sm">
        <div className="p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-accent-300">Camera sees</p>
          <p className="mt-1 font-semibold">{STAGES[reading.stage]}</p>
          <p className="text-xs text-neutral-400">
            Square {reading.past_endpoint ? "as dark as" : "lighter than"} the ring · {reading.rho.toFixed(2)}
            {reading.near_cutoff && " · close to the line"}
          </p>
        </div>
        <div className="border-l border-line p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#8fb3ff]">Record predicts</p>
          <p className="mt-1 font-semibold">Stage {span}</p>
          <p className="text-xs text-neutral-400">
            {pct(w.sensor)} of the budget ({pct(w.sensor_range[0])}–{pct(w.sensor_range[1])})
          </p>
        </div>
      </div>
      <RatioScale witnesses={w} />

      {gemini && gemini.stage != null && (
        <p className="text-xs text-neutral-400">
          Gemini's second look: {STAGES[gemini.stage]} ({pct(gemini.confidence)} sure)
          {gemini.stage !== reading.stage && <span className="font-semibold" style={{ color: "var(--color-warn)" }}> · differs from the camera, look carefully</span>}
        </p>
      )}

      {!correcting ? (
        <div className="flex gap-2">
          <button onClick={() => onConfirm()} disabled={busy} className="btn-accent flex-1">
            Confirm: the label looks like this
          </button>
          <button onClick={() => setCorrecting(true)} className="btn-quiet">
            It's different
          </button>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm">Which stage does the label show?</p>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((s) => (
              <button key={s} onClick={() => onConfirm(s)} disabled={busy} className="btn-quiet !px-2 text-sm">
                {STAGES[s]}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={onRetry} className="w-full text-sm text-neutral-400 underline-offset-2 hover:underline">
        Retake the photo
      </button>
    </div>
  );
}

/** Where the label sits on the square-to-ring scale, the discard line, and where the record expects it. */
function RatioScale({ witnesses: w }: { witnesses: Witnesses }) {
  if (w.rho == null || w.cutoff == null) return null;
  const lo = 0.4;
  const hi = Math.max(3.2, w.rho + 0.2, w.predicted_rho_range?.[1] ?? 0);
  const x = (r: number) => `${((Math.min(Math.max(r, lo), hi) - lo) / (hi - lo)) * 100}%`;
  const range = w.predicted_rho_range;
  return (
    <figure aria-label={`Square to ring ratio ${w.rho.toFixed(2)}; discard at ${w.cutoff} or below`}>
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-3 h-2 rounded-full" style={{ background: "var(--color-good-tint)" }} />
        <div className="absolute left-0 top-3 h-2 rounded-l-full" style={{ width: x(w.cutoff), background: "var(--color-bad-tint)" }} />
        {range && (
          <div className="absolute top-2 h-4 rounded bg-[#8fb3ff]/30 ring-1 ring-[#8fb3ff]" style={{ left: x(range[0]), width: `calc(${x(range[1])} - ${x(range[0])})` }} />
        )}
        <div className="absolute top-0 h-8 w-0.5" style={{ left: x(w.cutoff), background: "var(--color-bad)" }}/>
        <div className="absolute top-1.5 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white bg-accent-500 shadow" style={{ left: x(w.rho) }} />
      </div>
      <figcaption className="mt-1 flex justify-between text-[11px] text-neutral-400">
        <span>darker than ring · discard</span>
        <span>lighter · usable</span>
      </figcaption>
      <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-neutral-400">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-accent-500 align-middle" />camera</span>
        <span><span className="mr-1 inline-block h-2.5 w-4 rounded bg-[#8fb3ff]/30 align-middle ring-1 ring-[#8fb3ff]" />record's range</span>
        <span><span className="mr-1 inline-block h-3 w-0.5 align-middle" style={{ background: "var(--color-bad)" }} />discard line</span>
      </p>
    </figure>
  );
}

type Light = "starting" | "glare" | "dark" | "ok";
const LIGHT_TEXT: Record<Light, string> = {
  starting: "Starting the camera…",
  glare: "Glare on the label: tilt the phone a little",
  dark: "Too dark: move to better light",
  ok: "Good light: hold steady",
};

/** Live camera with a circle guide and a live light check; returns the visible square as a JPEG. */
function Camera({ onCapture, onCancel, onError }: { onCapture: (img: string) => void; onCancel: () => void; onError: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const failed = useRef(onError);
  failed.current = onError;
  const [light, setLight] = useState<Light>("starting");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      failed.current(); // no camera API (e.g. plain http): fall back to the camera app
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop()); // cancelled while the prompt was up
          return;
        }
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => failed.current());
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Light check inside the guide, a few times a second: glare adds light the
  // ratio can't cancel, so catch it before the photo rather than after.
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const timer = setInterval(() => {
      const v = video.current;
      if (!v || !v.videoWidth || !ctx) return;
      const side = Math.min(v.videoWidth, v.videoHeight) * GUIDE;
      ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, 64, 64);
      const px = ctx.getImageData(0, 0, 64, 64).data;
      let clipped = 0;
      let sum = 0;
      let n = 0;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          if ((x - 31.5) ** 2 + (y - 31.5) ** 2 > 32 ** 2) continue;
          const i = (y * 64 + x) * 4;
          if (px[i] >= 245 && px[i + 1] >= 245 && px[i + 2] >= 245) clipped++;
          sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          n++;
        }
      }
      setLight(clipped / n > 0.02 ? "glare" : sum / n < 45 ? "dark" : "ok");
    }, 350);
    return () => clearInterval(timer);
  }, []);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    onCapture(cropSquare(v, v.videoWidth, v.videoHeight, 1));
  };

  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
        <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" onLoadedMetadata={() => setLight("ok")} />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`relative aspect-square rounded-full border-4 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-colors ${light === "ok" ? "border-[oklch(80%_0.12_152)]" : light === "starting" ? "border-white/80" : "border-[oklch(85%_0.13_84)]"}`}
            style={{ width: `${GUIDE * 100}%` }}
          >
            <div className="absolute inset-[27%] rounded-sm border-2 border-dashed border-white/70" />
          </div>
        </div>
        <p className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-center text-sm text-white" aria-live="polite">
          {LIGHT_TEXT[light]}
        </p>
      </div>
      <p className="mt-2 text-center text-xs text-neutral-400">Line the VVM up inside the circle, square in the middle.</p>
      <div className="mt-2 flex gap-2">
        <button onClick={capture} disabled={light === "starting"} className="btn-accent flex-1">
          Take photo
        </button>
        <button onClick={onCancel} className="btn-quiet">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The guide circle's diameter as a share of the square view: leaves paper around the label for the reader. */
const GUIDE = 0.45;

/** Crop the centred square (what the square viewfinder shows) and shrink it. */
function cropSquare(source: CanvasImageSource, w: number, h: number, share: number): string {
  const side = Math.min(w, h) * share;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 480;
  canvas.getContext("2d")!.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 480, 480);
  return canvas.toDataURL("image/jpeg", 0.9);
}
