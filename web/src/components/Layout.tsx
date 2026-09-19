import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { SNAPSHOT } from "../lib/snapshot";
import { ARM_TTL_MS, clearArm, getArm, type Arm } from "../lib/tap";
import { Logo } from "./Brand";
import { BackIcon, BoxIcon, ChevronDownIcon, ClimateIcon, ImpactIcon, PlanIcon, PulseIcon, XIcon } from "./Icons";

/** The phone-width column, the bottom tab bar, and the banners every page shares. */
export function Layout({ children }: { back?: boolean; children: ReactNode }) {
  return (
    <div className="shell">
      {SNAPSHOT && (
        <p className="ui-caption mb-2 mt-4 rounded-2xl border border-line bg-surface px-4 py-3">
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
      className="fixed bottom-0 left-1/2 z-[1100] grid w-full max-w-[480px] -translate-x-1/2 grid-cols-5 gap-1 border-t border-line bg-surface px-3 pt-1.5"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}
    >
      {TABS.map(({ to, label, Icon, match }) => {
        const current = match(pathname);
        return (
          <Link
            key={to}
            to={to}
            aria-current={current ? "page" : undefined}
            className="-mt-1.5 flex min-h-[52px] flex-col items-center justify-center gap-1 border-t-2 pt-1.5 text-xs no-underline hover:text-text"
            style={{
              borderColor: current ? "var(--text)" : "transparent",
              color: current ? "var(--text)" : "var(--text-muted)",
              fontWeight: current ? 700 : 500,
            }}
          >
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Back button and the logo, above a page's eyebrow and title. */
export function BackHeader() {
  const navigate = useNavigate();
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/"));
  return (
    <div className="flex items-center gap-3 pb-6 pt-4">
      <button onClick={back} aria-label="Back" className="back-btn">
        <BackIcon size={22} />
      </button>
      <Logo height={26} />
    </div>
  );
}

/** A screen's eyebrow, title and one line under it. */
export function PageTitle({ eyebrow, title, sub, top = false }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; top?: boolean }) {
  return (
    <header className={top ? "mt-8" : ""}>
      <p className="eyebrow m-0 mb-2">{eyebrow}</p>
      <h1 className="ui-title m-0 mb-1">{title}</h1>
      {sub && <p className="ui-caption m-0 mb-6">{sub}</p>}
      {!sub && <div className="mb-6" />}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-title flex items-baseline justify-between gap-3">
      <h3 className="m-0 font-sans text-xs font-bold tracking-[0.14em]">{children}</h3>
      {aside && <span className="text-right normal-case tracking-normal">{aside}</span>}
    </div>
  );
}

/** A plain surface with a title, for forms and lists. */
export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel mb-3 p-4">
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="ui-heading m-0">{title}</h2>
          {aside && <div className="ui-caption">{aside}</div>}
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
      {open && <div className="px-4 pb-4">{children}</div>}
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
    <div role="status" className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--glacier-500)", animation: "vt-pulse 1.2s infinite" }} />
      <p className="m-0 flex-1">
        Now tap {next}. <span className="text-neutral-500">{left}s</span>
      </p>
      <button onClick={clearArm} aria-label="Cancel the pending link" className="grid h-11 w-11 place-items-center text-neutral-500 hover:text-text">
        <XIcon size={18} />
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
      className="fixed bottom-[100px] left-1/2 z-[1200] w-[min(420px,calc(100%-48px))] -translate-x-1/2 cursor-pointer rounded-xl px-4 py-3 text-center text-[15px]"
      style={{ background: "var(--toast)", color: "var(--white)" }}
    >
      {message}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="ui-caption flex items-center justify-center gap-2 py-16">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-800 border-t-text" />
      {label}
    </div>
  );
}

/** A plain note: errors are said in words, not in a signal colour. */
export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-4 rounded-2xl border-[1.5px] border-line-strong bg-surface px-4 py-3">
      <p className="m-0">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary mt-3 w-full">
          Try again
        </button>
      )}
    </div>
  );
}

