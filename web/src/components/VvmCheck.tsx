import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { useCanTapTags } from "../lib/device";
import { pct } from "../lib/format";
import { asset } from "../lib/snapshot";
import { PhoneIcon, UploadIcon } from "./Icons";
import { QrCode } from "./QrCode";
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
  const canTap = useCanTapTags(); // false on a computer: no phone camera in hand
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
    if (file) readPhoto(file);
  };

  const readPhoto = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("That isn't a photo. Try a JPEG or PNG.");
      return;
    }
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
        <p className="mb-3 rounded-xl border-[1.5px] border-line-strong p-3 font-bold">
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
      ) : !result && !canTap ? (
        <FromComputer boxId={boxId} onChoose={() => fileRef.current?.click()} onDrop={readPhoto} onWebcam={() => setCamera(true)} webcamFailed={noLiveCamera} />
      ) : !result ? (
        <div>
          {noLiveCamera ? (
            <button onClick={() => cameraApp.current?.click()} className="btn-primary">
              Open the camera
            </button>
          ) : (
            <button onClick={() => setCamera(true)} className="btn-primary">
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
      {error && <p role="alert" className="mt-2 font-bold">{error}</p>}
      {result && <Result result={result} busy={busy} onConfirm={confirm} onRetry={() => setResult(null)} />}
    </div>
  );
}

function LatestLabel({ latest }: { latest: LabelCheck }) {
  return (
    <div className="tile mb-3 text-[15px]">
      <p>
        Last confirmed label: <b>{STAGES[latest.stage]}</b>
        {latest.rho != null && <span className="text-neutral-500"> (square/ring {latest.rho.toFixed(2)})</span>}
      </p>
      <p className="ui-caption">
        The record said {pct(latest.sensor_budget)}
        {latest.predicted_stage != null && `, stage ${latest.predicted_stage}`} ·{" "}
        {latest.flagged ? <span className="font-bold text-text">flagged: they disagreed</span> : "they agreed"}
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
      <div role="alert" className="rounded-xl border-[1.5px] border-line-strong p-3">
        <p className="m-0">{result.message}</p>
        <button onClick={onRetry} className="mt-1 font-bold underline underline-offset-2">
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
      <div role="status" className={`rounded-xl p-3 ${w.flagged ? "border-[1.5px] border-line-strong" : "border border-line"}`}>
        <p className="ui-heading">{w.flagged ? "Camera and record disagree" : "Camera and record agree"}</p>
        <p className="mt-1">{w.text}</p>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line">
        <div className="p-3">
          <p className="eyebrow">Camera sees</p>
          <p className="mt-1 font-bold">{STAGES[reading.stage]}</p>
          <p className="ui-caption">
            Square {reading.past_endpoint ? "as dark as" : "lighter than"} the ring · {reading.rho.toFixed(2)}
            {reading.near_cutoff && " · close to the line"}
          </p>
        </div>
        <div className="border-l border-line p-3">
          <p className="eyebrow">Record predicts</p>
          <p className="mt-1 font-bold">Stage {span}</p>
          <p className="ui-caption">
            {pct(w.sensor)} of the budget ({pct(w.sensor_range[0])}–{pct(w.sensor_range[1])})
          </p>
        </div>
      </div>
      <RatioScale witnesses={w} />

      {gemini && gemini.stage != null && (
        <p className="ui-caption">
          Gemini's second look: {STAGES[gemini.stage]} ({pct(gemini.confidence)} sure)
          {gemini.stage !== reading.stage && <span className="font-bold text-text"> · differs from the camera, look carefully</span>}
        </p>
      )}

      {!correcting ? (
        <div className="flex gap-2">
          <button onClick={() => onConfirm()} disabled={busy} className="btn-primary flex-1 !text-base">
            Confirm the reading
          </button>
          <button onClick={() => setCorrecting(true)} className="btn-secondary">
            It's different
          </button>
        </div>
      ) : (
        <div>
          <p className="mb-2">Which stage does the label show?</p>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((s) => (
              <button key={s} onClick={() => onConfirm(s)} disabled={busy} className="btn-secondary !px-2 !text-sm">
                {STAGES[s]}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={onRetry} className="w-full text-sm text-neutral-500 underline-offset-2 hover:underline">
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
        <div className="absolute inset-x-0 top-3 h-2 rounded-full" style={{ background: "var(--ring-track)" }} />
        <div className="absolute left-0 top-3 h-2 rounded-l-full" style={{ width: x(w.cutoff), background: "var(--ink-300)" }} />
        {range && (
          <div className="absolute top-2 h-4 rounded border-[1.5px] border-line-strong" style={{ left: x(range[0]), width: `calc(${x(range[1])} - ${x(range[0])})` }} />
        )}
        <div className="absolute top-0 h-8 w-0.5 bg-text" style={{ left: x(w.cutoff) }} />
        <div className="absolute top-1.5 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-text" style={{ left: x(w.rho), background: "var(--glacier-500)" }} />
      </div>
      <figcaption className="ui-caption mt-1 flex justify-between">
        <span>darker than ring · discard</span>
        <span>lighter · usable</span>
      </figcaption>
      <p className="ui-caption mt-1 flex flex-wrap gap-x-3">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-text align-middle" style={{ background: "var(--glacier-500)" }} />camera</span>
        <span><span className="mr-1 inline-block h-2.5 w-4 rounded border-[1.5px] border-line-strong align-middle" />record's range</span>
        <span><span className="mr-1 inline-block h-3 w-0.5 bg-text align-middle" />discard line</span>
      </p>
    </figure>
  );
}

/**
 * The label check on a computer: a photo from the disk (or dropped on the
 * panel), the webcam, or a QR code that opens the same check on a phone,
 * whose camera is the better tool for a vial.
 */
function FromComputer({
  boxId,
  onChoose,
  onDrop,
  onWebcam,
  webcamFailed,
}: {
  boxId: string;
  onChoose: () => void;
  onDrop: (file: File) => void;
  onWebcam: () => void;
  webcamFailed: boolean;
}) {
  const [over, setOver] = useState(false);
  const handoff = `${window.location.origin}/box/${encodeURIComponent(boxId)}?vvm=1`;
  return (
    <div>
      <div
        onDragOver={(e) => {
          if (![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onDrop(file);
        }}
        className="rounded-2xl border-[1.5px] border-dashed p-4 text-center transition-colors"
        style={{ borderColor: over ? "var(--glacier-500)" : "var(--border-strong)", background: over ? "var(--quiet)" : undefined }}
      >
        <button onClick={onChoose} className="btn-primary">
          <UploadIcon size={20} />
          Choose a photo of the label
        </button>
        <p className="ui-caption m-0 mt-2">or drop one here</p>
      </div>
      {webcamFailed ? (
        <p className="ui-caption m-0 mt-3 text-center">This computer's camera didn't start. Use a photo, or a phone below.</p>
      ) : (
        <button onClick={onWebcam} className="btn-secondary mt-3 w-full">
          Use this computer's camera
        </button>
      )}
      <div className="mt-4 flex items-center gap-4 rounded-2xl border border-line p-3">
        <QrCode text={handoff} size={112} label="QR code that opens this label check on a phone" />
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 font-display font-semibold tracking-[-0.01em]">
            <PhoneIcon size={18} />
            Or use a phone's camera
          </p>
          <p className="ui-caption m-0 mt-1">
            Scan this with a phone to open the same check there. A confirmed result shows on this page within a minute.
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-snug text-neutral-400">
        The check compares the inner square's brightness with the ring around it. Lighter than the ring: usable. As dark
        or darker: discard point. It then checks the result against what the temperature record predicts.
      </p>
      <p className="mt-2 text-xs text-neutral-400">
        No VVM to hand? Open the{" "}
        <a href={asset("/vvm-target.html")} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          test target
        </a>{" "}
        on a phone and hold it up to the camera, or print the test card from the Tags page.
      </p>
    </div>
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
  const canTap = useCanTapTags(); // a webcam: the label moves, not the camera

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
            className={`relative aspect-square rounded-full border-4 shadow-[0_0_0_9999px_rgba(11,37,69,0.5)] transition-colors ${light === "ok" ? "border-[var(--glacier-500)]" : light === "starting" ? "border-white/80" : "border-dashed border-white"}`}
            style={{ width: `${GUIDE * 100}%` }}
          >
            <div className="absolute inset-[27%] rounded-sm border-2 border-dashed border-white/70" />
          </div>
        </div>
        <p className="absolute inset-x-0 bottom-0 px-3 py-2 text-center text-sm text-white" style={{ background: "color-mix(in srgb, var(--ink-900) 70%, transparent)" }} aria-live="polite">
          {light === "glare" && !canTap ? "Glare on the label: tilt it a little" : LIGHT_TEXT[light]}
        </p>
      </div>
      <p className="ui-caption mt-2 text-center">Line the VVM up inside the circle, square in the middle.</p>
      <div className="mt-2 flex gap-2">
        <button onClick={capture} disabled={light === "starting"} className="btn-primary flex-1">
          Take photo
        </button>
        <button onClick={onCancel} className="btn-secondary">
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
