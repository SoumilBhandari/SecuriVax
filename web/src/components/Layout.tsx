import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { useAuth } from "../lib/auth";
import { useCanTapTags } from "../lib/device";
import { SNAPSHOT } from "../lib/snapshot";
import { ARM_TTL_MS, clearArm, getArm, type Arm } from "../lib/tap";
import { Logo, ThemeToggle } from "./Brand";
import { BackIcon, BoxIcon, ChevronDownIcon, ClimateIcon, ImpactIcon, PulseIcon, SignInIcon, SignOutIcon, XIcon } from "./Icons";

/**
 * The page frame. On a phone: one column with a floating glass tab bar. From
 * laptop width up: a glass top bar with the sections centred, and the page in
 * a centred column under it.
 */
export function Layout({ hero, children }: { back?: boolean; hero?: ReactNode; children: ReactNode }) {
  return (
    <>
      <TopNav />
      {hero}
      <div className={hero ? "sheet-over" : undefined}>
        <div className={`shell${hero ? " shell--after-hero" : ""}`}>
          {SNAPSHOT && (
            <p className="ui-caption mb-2 mt-4 rounded-2xl border border-line bg-surface px-4 py-3">
              Snapshot of the app from{" "}
              {new Date(SNAPSHOT.taken_at * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
              Every page opens; loading boxes, reading a VVM photo or asking the agent needs the live app.
            </p>
          )}
          <ArmBanner />
          <main>{children}</main>
        </div>
      </div>
      <TabBar />
    </>
  );
}

/** The back button on a coloured field: a glass circle in the field's own text colour. */
export function BackOnField() {
  const navigate = useNavigate();
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/boxes", { viewTransition: true }));
  return (
    <button onClick={back} aria-label="Back" className="on-field-btn">
      <BackIcon size={22} />
    </button>
  );
}

/**
 * Two columns from laptop width up: the left one stays in view while the right
 * scrolls. On a phone they stack, left first. The narrow column keeps a
 * phone's width, so the verdict still fits "QUARANTINE".
 */
export function Split({ left, right, wide = "right" }: { left: ReactNode; right: ReactNode; wide?: "left" | "right" }) {
  const cols = wide === "right" ? "lg:grid-cols-[minmax(380px,5fr)_minmax(0,7fr)]" : "lg:grid-cols-[minmax(0,7fr)_minmax(380px,5fr)]";
  return (
    <div className={`lg:grid lg:items-start lg:gap-12 ${cols}`}>
      <div className={`scroll-quiet lg:sticky lg:top-[calc(var(--nav-h)+24px)] lg:max-h-[calc(100dvh-var(--nav-h)-48px)] lg:overflow-y-auto lg:pb-2 ${TOP}`}>{left}</div>
      <div className={TOP}>{right}</div>
    </div>
  );
}

/** Side by side, a column's opening section title lines up with the other column's top. */
const TOP = "lg:[&>.section-title:first-child]:mt-0";

const TABS = [
  { to: "/boxes", label: "Boxes", Icon: BoxIcon, match: (p: string) => p.startsWith("/box") || p.startsWith("/node") || p.startsWith("/tags") },
  { to: "/live", label: "Live", Icon: PulseIcon, match: (p: string) => p.startsWith("/live") },
  { to: "/climate", label: "Climate", Icon: ClimateIcon, match: (p: string) => p.startsWith("/climate") },
  { to: "/impact", label: "Impact", Icon: ImpactIcon, match: (p: string) => p.startsWith("/impact") },
];

/** The laptop's chrome: logo, the sections centred, who's signed in and the theme. */
function TopNav() {
  const { pathname } = useLocation();
  return (
    <header className="glass fixed inset-x-0 top-0 z-[1100] hidden h-[var(--nav-h)] border-b border-line lg:block">
      <div className="mx-auto grid h-full max-w-[1180px] grid-cols-[1fr_auto_1fr] items-center px-10">
        <Link to="/" aria-label="SecuriVax home" className="flex w-fit items-center">
          <Logo height={24} />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {TABS.map(({ to, label, match }) => {
            const current = match(pathname);
            return (
              <Link
                key={to}
                to={to}
                viewTransition
                aria-current={current ? "page" : undefined}
                className="rounded-full px-3.5 py-1.5 text-[14px] font-medium tracking-[-0.01em] transition-colors duration-200 hover:text-text"
                style={{ color: current ? "var(--text)" : "var(--text-muted)", background: current ? "var(--surface-2)" : "transparent" }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-end gap-2">
          <Account compact />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * The phone's chrome: a glass capsule floating off the bottom edge. Scrolling
 * down tucks the labels away; scrolling up brings them back.
 */
function TabBar() {
  const { pathname } = useLocation();
  const compact = useScrollingDown();
  const active = TABS.findIndex((t) => t.match(pathname));
  return (
    <nav
      aria-label="Main"
      className="glass-strong fixed bottom-0 left-1/2 z-[1100] w-[calc(100%-32px)] max-w-[440px] -translate-x-1/2 rounded-full shadow-float lg:hidden"
      style={{
        marginBottom: "max(16px, env(safe-area-inset-bottom, 0px))",
        border: "1px solid var(--border)",
        transition: "transform 0.45s var(--ease-out)",
      }}
    >
      <div className="relative grid p-1.5" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
        {/* The lens behind the chosen section slides into place. */}
        {active >= 0 && (
          <span
            aria-hidden="true"
            className="absolute inset-y-1.5 left-1.5 rounded-full"
            style={{
              width: `calc((100% - 12px) / ${TABS.length})`,
              background: "var(--surface-2)",
              transform: `translateX(${active * 100}%)`,
              transition: "transform 0.45s var(--ease-out)",
            }}
          />
        )}
        {TABS.map(({ to, label, Icon, match }) => {
          const current = match(pathname);
          return (
            <Link
              key={to}
              to={to}
              viewTransition
              aria-current={current ? "page" : undefined}
              className="relative flex flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-semibold tracking-[0.01em] no-underline transition-[color,min-height] duration-300"
              style={{ color: current ? "var(--text)" : "var(--text-muted)", minHeight: compact ? 44 : 50 }}
            >
              <Icon size={24} />
              <span
                className="overflow-hidden transition-[max-height,opacity] duration-300"
                style={{ maxHeight: compact ? 0 : 16, opacity: compact ? 0 : 1 }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** True while the reader is scrolling down and past the top; false as soon as they scroll up. */
function useScrollingDown(): boolean {
  const [down, setDown] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - last.current;
        if (Math.abs(delta) > 6) {
          setDown(delta > 0 && y > 80);
          last.current = y;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return down;
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
        <span className="eyebrow">Staff sign-in</span>
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
        <span className="truncate text-[15px] font-semibold">{user.name}</span>
        <span className="ui-footnote">{user.role === "operator" ? "Operator" : "View only"}</span>
      </span>
      <button onClick={out} aria-label="Sign out" title="Sign out" className="back-btn !h-9 !w-9">
        <SignOutIcon size={16} />
      </button>
    </div>
  );
}

/** Back button and the logo, above a page's eyebrow and title. */
export function BackHeader() {
  const navigate = useNavigate();
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/boxes", { viewTransition: true }));
  return (
    <div className="flex items-center gap-3 pb-6 pt-4 lg:pt-2">
      <button onClick={back} aria-label="Back" className="back-btn">
        <BackIcon size={22} />
      </button>
      <span className="flex lg:hidden">
        <Logo height={24} />
      </span>
    </div>
  );
}

/** A screen's eyebrow, title and one line under it. */
export function PageTitle({ eyebrow, title, sub, top = false }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; top?: boolean }) {
  return (
    <header className={top ? "mt-8" : ""}>
      <p className="eyebrow m-0 mb-2">{eyebrow}</p>
      <h1 className="ui-title m-0 mb-1.5">{title}</h1>
      {sub && <p className="ui-caption m-0 mb-7">{sub}</p>}
      {!sub && <div className="mb-7" />}
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
      {!first && <div className="rule mx-[18px]" />}
      <button
        className="acc-btn"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <span>{title}</span>
        <ChevronDownIcon size={20} className="shrink-0 transition-transform duration-300" style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && <div className="fade-in px-[18px] pb-5">{children}</div>}
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
    <div role="status" className="panel mt-4 flex items-center gap-3 px-4 py-3">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--accent)", animation: "vt-pulse 1.2s infinite" }} />
      <p className="m-0 flex-1">
        Now tap {next}. <span className="text-neutral-500">{left}s</span>
      </p>
      <button onClick={clearArm} aria-label="Cancel the pending link" className="grid h-11 w-11 place-items-center text-neutral-500 hover:text-text">
        <XIcon size={18} />
      </button>
    </div>
  );
}

/** A short message that floats above the tab bar, then leaves on its own. */
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
      className="modal-in fixed bottom-[104px] left-1/2 z-[1200] w-[min(420px,calc(100%-48px))] -translate-x-1/2 cursor-pointer rounded-full px-5 py-3 text-center text-[15px] font-medium tracking-[-0.02em] shadow-float backdrop-blur-xl lg:bottom-8"
      style={{ background: "var(--toast)", color: "#f5f5f7" }}
    >
      {message}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="ui-caption fade-in flex items-center justify-center gap-2 py-16">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-800 border-t-text" />
      {label}
    </div>
  );
}

/** A plain note: errors are said in words, not in a signal colour. */
export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="panel mt-4 px-5 py-4">
      <p className="m-0">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary mt-3 w-full">
          Try again
        </button>
      )}
    </div>
  );
}
