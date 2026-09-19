import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { useAuth } from "../lib/auth";
import { useCanTapTags } from "../lib/device";
import { SNAPSHOT } from "../lib/snapshot";
import { ARM_TTL_MS, clearArm, getArm, type Arm } from "../lib/tap";
import { Logo, ThemeToggle } from "./Brand";
import { BackIcon, BoxIcon, ChevronDownIcon, ClimateIcon, ImpactIcon, PlanIcon, PulseIcon, SignInIcon, SignOutIcon, XIcon } from "./Icons";

/**
 * The page frame: on a phone, one column with the tab bar at the bottom; from
 * laptop width up, a sidebar on the left and the page using the width.
 */
export function Layout({ children }: { back?: boolean; children: ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="lg:pl-[248px]">
        <div className="shell">
          {SNAPSHOT && (
            <p className="ui-caption mb-2 mt-4 rounded-2xl border border-line bg-surface px-4 py-3">
              Snapshot of the app from{" "}
              {new Date(SNAPSHOT.taken_at * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
              Every page opens; loading boxes, reading a VVM photo or asking the agent needs the live app.
            </p>
          )}
          <ArmBanner />
          <main className="rise-in">{children}</main>
          <TabBar />
        </div>
      </div>
    </>
  );
}

/**
 * Two columns from laptop width up: the left one stays in view while the right
 * scrolls. On a phone they stack, left first, exactly as before. The narrow
 * column keeps a phone's width, so the verdict card still fits "QUARANTINE".
 */
export function Split({ left, right, wide = "right" }: { left: ReactNode; right: ReactNode; wide?: "left" | "right" }) {
  const cols = wide === "right" ? "lg:grid-cols-[minmax(380px,5fr)_minmax(0,7fr)]" : "lg:grid-cols-[minmax(0,7fr)_minmax(380px,5fr)]";
  return (
    <div className={`lg:grid lg:items-start lg:gap-10 ${cols}`}>
      <div className={`lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:pb-2 [scrollbar-width:thin] ${TOP}`}>{left}</div>
      <div className={TOP}>{right}</div>
    </div>
  );
}

/** Side by side, a column's opening section title lines up with the other column's top. */
const TOP = "lg:[&>.section-title:first-child]:mt-0";

/** The desktop navigation: the logo, the five sections and the theme. */
function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="fixed inset-y-0 left-0 z-[1100] hidden w-[248px] flex-col border-r border-line bg-surface px-5 py-7 lg:flex">
      <Link to="/" className="mb-10 px-3" aria-label="SecuriVax home">
        <Logo height={30} />
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {TABS.map(({ to, label, Icon, match }) => {
          const current = match(pathname);
          return (
            <Link
              key={to}
              to={to}
              aria-current={current ? "page" : undefined}
              className="group relative flex min-h-10 items-center gap-3 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] no-underline transition-colors hover:text-text"
              style={{ color: current ? "var(--text)" : "var(--text-muted)" }}
            >
              <span
                className="absolute inset-y-2 left-0 w-0.5 rounded-full transition-opacity"
                style={{ background: "var(--text)", opacity: current ? 1 : 0 }}
                aria-hidden="true"
              />
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-line px-3 pt-5">
        <Account />
        <div className="mt-4 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500">Theme</span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

/** Who's signed in and the way out; signed out, the way in for staff. */
export function Account({ compact = false }: { compact?: boolean }) {
  const { user, ready, signOut } = useAuth();
  const { pathname } = useLocation();
  if (!ready) return null;
  if (!user) {
    const to = `/login?next=${encodeURIComponent(pathname)}`;
    return compact ? (
      <Link to={to} aria-label="Staff sign-in" title="Staff sign-in" className="back-btn">
        <SignInIcon size={18} />
      </Link>
    ) : (
      <Link to={to} className="flex items-center justify-between gap-3 text-text no-underline">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500">Staff sign-in</span>
        <span className="back-btn !h-9 !w-9">
          <SignInIcon size={16} />
        </span>
      </Link>
    );
  }
  const out = () => void signOut();
  if (compact) {
    return (
      <button onClick={out} aria-label={`Sign out ${user.name}`} title={`Sign out (${user.name})`} className="back-btn">
        <SignOutIcon size={18} />
      </button>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{user.name}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">{user.role === "operator" ? "Operator" : "View only"}</span>
      </span>
      <button onClick={out} aria-label="Sign out" title="Sign out" className="back-btn !h-9 !w-9">
        <SignOutIcon size={16} />
      </button>
    </div>
  );
}

const TABS = [
  { to: "/boxes", label: "Boxes", Icon: BoxIcon, match: (p: string) => p.startsWith("/box") || p.startsWith("/node") || p.startsWith("/tags") },
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
      className="fixed bottom-0 left-1/2 z-[1100] grid w-full max-w-[480px] -translate-x-1/2 grid-cols-5 gap-1 border-t border-line bg-surface px-3 pt-1.5 lg:hidden"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}
    >
      {TABS.map(({ to, label, Icon, match }) => {
        const current = match(pathname);
        return (
          <Link
            key={to}
            to={to}
            aria-current={current ? "page" : undefined}
            className="-mt-1.5 flex min-h-[52px] flex-col items-center justify-center gap-1 border-t-2 pt-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] no-underline hover:text-text"
            style={{
              borderColor: current ? "var(--text)" : "transparent",
              color: current ? "var(--text)" : "var(--text-muted)",
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
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/boxes"));
  return (
    <div className="flex items-center gap-3 pb-6 pt-4">
      <button onClick={back} aria-label="Back" className="back-btn">
        <BackIcon size={22} />
      </button>
      <span className="flex lg:hidden">
        <Logo height={26} />
      </span>
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
      <h3 className="m-0">{children}</h3>
      {aside && <span className="text-right normal-case tracking-normal">{aside}</span>}
    </div>
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

/** Shows the half-finished two-tap link, with a countdown (never on a computer: it can't tap). */
function ArmBanner() {
  const [arm, setArmState] = useState<Arm | null>(getArm);
  const [, tick] = useState(0);
  const canTap = useCanTapTags();

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

  if (!arm || !canTap) return null;
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
      className="fixed bottom-[100px] left-1/2 z-[1200] w-[min(420px,calc(100%-48px))] -translate-x-1/2 cursor-pointer rounded-xl px-4 py-3 text-center text-[15px] lg:bottom-8 lg:left-[calc(50%+124px)]"
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

