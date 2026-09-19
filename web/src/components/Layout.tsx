import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { ARM_TTL_MS, clearArm, getArm, type Arm } from "../lib/tap";
import { asset, SNAPSHOT } from "../lib/snapshot";
import { BackIcon, TapIcon, XIcon } from "./Icons";

export function Layout({ back, children }: { back?: boolean; children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
          {back && <BackIcon className="text-slate-500" />}
          <img src={asset("/icon.svg")} alt="" className="h-7 w-7" />
          Vialtality
        </Link>
        <nav className="-mr-2 flex text-sm text-muted [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_a]:px-2">
          <Link to="/climate" className="hover:text-slate-800">
            Climate
          </Link>
          <Link to="/plan" className="hover:text-slate-800">
            Plan
          </Link>
          <Link to="/impact" className="hover:text-slate-800">
            Impact
          </Link>
        </nav>
      </header>
      {SNAPSHOT && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Snapshot of the app from {new Date(SNAPSHOT.taken_at * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
          Every page opens; loading boxes, reading a VVM photo or asking the agent needs the live app.
        </p>
      )}
      <ArmBanner />
      {children}
    </div>
  );
}

/** Shows the half-finished two-tap link, with a countdown. */
function ArmBanner() {
  const [arm, setArmState] = useState<Arm | null>(getArm);
  const [, tick] = useState(0);

  useEffect(() => {
    const refresh = () => setArmState(getArm());
    window.addEventListener("vialtality-arm", refresh);
    const timer = setInterval(() => {
      refresh();
      tick((n) => n + 1);
    }, 1000);
    return () => {
      window.removeEventListener("vialtality-arm", refresh);
      clearInterval(timer);
    };
  }, []);

  if (!arm) return null;
  const left = Math.max(0, Math.ceil((ARM_TTL_MS - (Date.now() - arm.at)) / 1000));
  const next = arm.kind === "node" ? `a box to load it into ${arm.id}` : `a carrier to load ${arm.id} into it`;
  return (
    <div role="status" className="mb-4 flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">
      <TapIcon className="shrink-0 animate-pulse text-sky-300" />
      <p className="flex-1">
        Now tap {next}. <span className="text-slate-400">{left}s</span>
      </p>
      <button onClick={clearArm} aria-label="Cancel the pending link" className="flex h-11 w-11 items-center justify-center rounded text-slate-300 hover:text-white">
        <XIcon size={16} />
      </button>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div role="status" className={`fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[1000] mx-auto max-w-md rounded-xl px-4 py-3 text-center text-sm text-white shadow-lg ${message.startsWith("Couldn't") ? "bg-bad" : "bg-slate-900"}`}>
      {message}
    </div>
  );
}

export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {aside && <div className="text-xs text-slate-500">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: string }) {
  return <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>;
}
