import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { SNAPSHOT } from "../lib/snapshot";
import { ARM_TTL_MS, clearArm, getArm, type Arm } from "../lib/tap";
import { BackIcon, BoxIcon, ChevronDownIcon, ClimateIcon, ImpactIcon, PlanIcon, PulseIcon, TapIcon, XIcon } from "./Icons";

/** The phone-width column, the bottom tab bar, and the banners every page shares. */
export function Layout({ children }: { back?: boolean; children: ReactNode }) {
  return (
    <div className="shell">
      {SNAPSHOT && (
        <p className="mb-2 mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-snug text-neutral-400">
          Snapshot of the app from{" "}
          {new Date(SNAPSHOT.taken_at * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
          Every page opens; loading boxes, reading a VVM photo or asking the agent needs the live app.
        </p>
      )}
      <ArmBanner />
      {children}
      <TabBar />
    </div>
  );
}

const TABS = [
  { to: "/", label: "Boxes", Icon: BoxIcon, match: (p: string) => p === "/" || p.startsWith("/box") || p.startsWith("/node") || p.startsWith("/tags") },
  { to: "/live", label: "Live", Icon: PulseIcon, match: (p: string) => p.startsWith("/live") },
  { to: "/climate", label: "Climate", Icon: ClimateIcon, match: (p: string) => p.startsWith("/climate") },
  { to: "/plan", label: "Plan", Icon: PlanIcon, match: (p: string) => p.startsWith("/plan") },
  { to: "/impact", label: "Impact", Icon: ImpactIcon, match: (p: string) => p.startsWith("/impact") },
];

function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-1/2 z-[1100] grid w-full max-w-[480px] -translate-x-1/2 grid-cols-5 gap-1 px-3 pt-2 backdrop-blur-md"
      style={{
        paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
        background:
          "linear-gradient(90deg, transparent, var(--color-neutral-800) 48px, var(--color-neutral-800) calc(100% - 48px), transparent) top / 100% 1px no-repeat, color-mix(in srgb, var(--color-bg) 92%, transparent)",
      }}
    >
      {TABS.map(({ to, label, Icon, match }) => {
        const current = match(pathname);
        return (
          <Link
            key={to}
            to={to}
            aria-current={current ? "page" : undefined}
            className="flex min-h-[50px] flex-col items-center justify-center gap-[3px] rounded-[10px] text-[11px] font-medium"
            style={{ background: current ? "var(--color-accent-900)" : "transparent", color: current ? "var(--color-accent-300)" : "var(--color-neutral-500)" }}
          >
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Back button and a small label above a page's title. */
export function BackHeader({ eyebrow }: { eyebrow?: ReactNode }) {
  const navigate = useNavigate();
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/"));
  return (
    <div className="flex items-center gap-3 pb-2.5 pt-4">
      <button onClick={back} aria-label="Back" className="back-btn">
        <BackIcon size={22} />
      </button>
      {eyebrow && <span className="text-[13px] uppercase tracking-[0.06em] text-neutral-500">{eyebrow}</span>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-title flex items-baseline justify-between gap-3">
      <h3 className="m-0 font-semibold">{children}</h3>
      {aside && <span className="normal-case tracking-normal text-neutral-500">{aside}</span>}
    </div>
  );
}

/** A plain surface with a title, for forms and lists. */
export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel mb-3 p-5">
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          {aside && <div className="text-xs text-neutral-500">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** "More detail": one panel of rows that each open in place. */
export function Details({ children }: { children: ReactNode }) {
  return <div className="panel flex flex-col">{children}</div>;
}

export function Detail({
  title,
  children,
  first = false,
  onOpen,
}: {
  title: string;
  children: ReactNode;
  first?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!first && <div className="rule" />}
      <button
        className="acc-btn"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <span>{title}</span>
        <ChevronDownIcon size={20} className="shrink-0 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </>
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
    <div role="status" className="mt-4 flex items-center gap-3 rounded-xl border border-accent-700 bg-surface px-4 py-3 text-sm text-neutral-200">
      <TapIcon className="shrink-0 text-accent-400" style={{ animation: "vt-pulse 1.2s infinite" }} />
      <p className="m-0 flex-1">
        Now tap {next}. <span className="text-neutral-500">{left}s</span>
      </p>
      <button onClick={clearArm} aria-label="Cancel the pending link" className="grid h-11 w-11 place-items-center text-neutral-400 hover:text-neutral-100">
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
  const failed = message.startsWith("Couldn't");
  return (
    <div
      role={failed ? "alert" : "status"}
      onClick={onDone}
      className="fixed bottom-24 left-1/2 z-[1200] w-[min(420px,calc(100%-48px))] -translate-x-1/2 cursor-pointer rounded-xl px-5 py-3.5 text-center text-sm shadow-[0_0_0_1px_#9397ab,0_16px_40px_rgba(0,0,0,.65)]"
      style={{ background: failed ? "var(--color-bad-tint)" : "var(--color-neutral-900)", color: failed ? "var(--color-bad-fg)" : "var(--color-neutral-100)" }}
    >
      {message}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-accent-400" />
      {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ background: "var(--color-bad-tint)", color: "var(--color-bad-fg)" }}>
      <p className="m-0">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-quiet mt-3">
          Try again
        </button>
      )}
    </div>
  );
}
