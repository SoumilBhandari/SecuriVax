import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";

import { Logo, ThemeToggle } from "../components/Brand";
import { ChevronRightIcon } from "../components/Icons";
import { TripChart } from "../components/TripChart";
import { TripConditions } from "../components/TripConditions";
import { VerdictHero } from "../components/Verdict";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BoxSummary, FleetSummary, Impact, Report, StoreRisk } from "../types";

// The map screens pull in Leaflet: load them after the page.
const ShipmentsView = lazy(() => import("../components/ShipmentsMap"));
const RiskMap = lazy(() => import("../components/RiskMap"));

/**
 * The front door ("/"): what SecuriVax is, in a minute, with the real boxes
 * moving through the hero and the real numbers underneath. The app itself
 * starts at /boxes; stickers open /box/… and /node/… directly.
 */
export default function LandingPage() {
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [fleet, setFleet] = useState<FleetSummary | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);

  useEffect(() => {
    api.boxes().then(setBoxes).catch(() => {});
    api.fleet().then(setFleet).catch(() => {});
    api.impact().then(setImpact).catch(() => {});
  }, []);

  const toCheck = boxes.filter((b) => b.verdict === "QUARANTINE" || b.verdict === "DISCARD").length;
  return (
    <div className="min-h-dvh overflow-x-hidden bg-bg text-text">
      <Hero boxes={boxes} toCheck={toCheck} />
      <HowItWorks />
      <Numbers fleet={fleet} impact={impact} />
      <Views />
      <Closing />
      <Footer />
    </div>
  );
}

// ---- Top bar

function Nav() {
  const { user } = useAuth();
  return (
    <nav className="pointer-events-none relative z-30 mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-6 lg:px-10 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
      <Link to="/" aria-label="SecuriVax" className="flex">
        <Logo height={28} />
      </Link>
      <div className="flex items-center gap-6">
        <a href="#how" className="mono-label hidden no-underline hover:text-text md:inline">
          How it works
        </a>
        <Link to="/live" className="mono-label hidden no-underline hover:text-text md:inline">
          Live
        </Link>
        <Link to="/impact" className="mono-label hidden no-underline hover:text-text md:inline">
          Impact
        </Link>
        <span className="hidden sm:flex">
          <ThemeToggle />
        </span>
        {!user && (
          <Link to="/login" className="mono-label no-underline hover:text-text">
            Sign in
          </Link>
        )}
        <Link to="/boxes" className="pill-btn pill-btn--solid !min-h-10 !px-4 !text-sm">
          Open the app
        </Link>
      </div>
    </nav>
  );
}

// ---- Hero: the words on the left; the app's own screens, live, fanned out on the right

function Hero({ boxes, toCheck }: { boxes: BoxSummary[]; toCheck: number }) {
  const doses = boxes.reduce((n, b) => n + b.quantity, 0);
  const screens = useScreens(boxes);
  const wide = useWide();
  return (
    <header className="relative lg:min-h-[100dvh]">
      <Nav />
      {/* Full width over the stack: the pointer passes through to the screens, except on the links. */}
      <div className="pointer-events-none relative z-20 mx-auto max-w-7xl px-6 pb-10 pt-8 lg:px-10 lg:pt-24 [&_a]:pointer-events-auto">
        <div className="max-w-lg">
          <p className="mono-label rise-in m-0">Vaccine cold chain · HopHacks 2026</p>
          <h1 className="rise-in m-0 mt-5 font-display text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[58px]" style={{ "--i": 1 } as CSSProperties}>
            Is this vaccine
            <br />
            still good?
          </h1>
          <p className="rise-in m-0 mt-6 max-w-md text-[17px] leading-7 text-neutral-500" style={{ "--i": 2 } as CSSProperties}>
            SecuriVax follows each box from the depot to the clinic and turns its temperature history into one call a health
            worker can act on: use it, hold it, or throw it away.
          </p>
          <div className="rise-in mt-8 flex flex-wrap gap-3" style={{ "--i": 3 } as CSSProperties}>
            <Link to="/boxes" className="pill-btn pill-btn--solid">
              Open the app
            </Link>
            <Link to="/live" className="pill-btn">
              Watch it live
            </Link>
          </div>
          {boxes.length > 0 && (
            <p className="mono-label rise-in m-0 mt-10" style={{ "--i": 4 } as CSSProperties}>
              {boxes.length} boxes · {doses.toLocaleString()} doses and tests · {toCheck} to check now
            </p>
          )}
        </div>
      </div>
      {screens.length > 0 &&
        (wide ? (
          <Stack screens={screens} />
        ) : (
          <div className="relative z-20 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-12 [scrollbar-width:none]">
            {screens.map((sc, i) => (
              <div key={sc.key} className="w-[300px] shrink-0 snap-start">
                <ScreenCard screen={sc} index={i} width={300} />
              </div>
            ))}
          </div>
        ))}
    </header>
  );
}

/** Laptop width or wider: the fanned stack; below it, a row to swipe. Only one is drawn. */
function useWide(): boolean {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    const on = () => setWide(mq.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  return wide;
}

interface Screen {
  key: string;
  label: string;
  sub: string;
  body: ReactNode;
}

/** The real screens, with real data: the same components the app draws. */
function useScreens(boxes: BoxSummary[]): Screen[] {
  const byId = (id: string, fallback: (b: BoxSummary) => boolean) => (boxes.find((b) => b.id === id) ?? boxes.find(fallback))?.id ?? null;
  const verdictId = byId("BOX-KO-0915", (b) => b.verdict === "QUARANTINE");
  const tripId = byId("BOX-NG-0442", (b) => b.verdict === "DISCARD");
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [sites, setSites] = useState<StoreRisk[] | null>(null);

  useEffect(() => {
    for (const id of [verdictId, tripId]) {
      if (id) api.report(id).then((r) => setReports((all) => ({ ...all, [id]: r }))).catch(() => {});
    }
  }, [verdictId, tripId]);
  useEffect(() => {
    api.storesAtRisk().then((s) => setSites(s.facilities)).catch(() => {});
  }, []);

  const v = verdictId ? reports[verdictId] : undefined;
  const t = tripId ? reports[tripId] : undefined;
  const out: (Screen | null)[] = [
    v
      ? {
          key: "verdict",
          label: "The verdict",
          sub: v.box.id,
          body: (
            <>
              <p className="eyebrow m-0 mb-1">{v.box.id}</p>
              <p className="ui-heading m-0 mb-4">{v.product.name}</p>
              <VerdictHero report={v} stale={null} />
            </>
          ),
        }
      : null,
    t ? { key: "trip", label: "Trip conditions", sub: t.box.id, body: <TripConditions report={t} /> } : null,
    boxes.length
      ? {
          key: "map",
          label: "Shipments map",
          sub: `${boxes.length} boxes`,
          body: (
            <Suspense fallback={null}>
              <ShipmentsView boxes={boxes} />
            </Suspense>
          ),
        }
      : null,
    t
      ? {
          key: "chart",
          label: "Temperature over the trip",
          sub: t.box.id,
          body: <TripChart segments={t.segments} product={t.product} budgetUsed={t.budget_used} />,
        }
      : null,
    sites
      ? {
          key: "heat",
          label: "Heat ahead",
          sub: `${sites.length} sites · 72 h`,
          body: (
            <Suspense fallback={null}>
              <RiskMap sites={sites} />
            </Suspense>
          ),
        }
      : null,
  ];
  return out.filter((sc): sc is Screen => sc != null);
}

/**
 * Laptops: the screens fanned along a diagonal, drifting slowly and moving
 * with the page as it scrolls. Hovering one holds the stack and slides that
 * screen up in place, like a file pulled up out of a drawer.
 * They fade out under the words and at both ends of the diagonal.
 */
const DRIFT = 0.06; // screens per second
const EASE_S = 0.45; // how long the drift takes to settle when a hover stops or starts it

function Stack({ screens }: { screens: Screen[] }) {
  const [offset, setOffset] = useState(0);
  const held = useRef(false);
  const n = screens.length;

  // One loop moves everything. The drift eases down to a stop under the
  // pointer and back up after it (never an abrupt halt), and the scroll
  // position is followed smoothly rather than jumped to.
  useEffect(() => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = performance.now();
    let speed = still ? 0 : DRIFT;
    let drift = 0;
    let shownScroll = window.scrollY;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      if (!document.hidden) {
        const target = still || held.current ? 0 : DRIFT;
        speed += (target - speed) * (1 - Math.exp(-dt / (EASE_S / 3)));
        drift += speed * dt;
        shownScroll += (window.scrollY - shownScroll) * (still ? 1 : 1 - Math.exp(-dt / 0.12));
        setOffset(drift + shownScroll / 320);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="lp-stack pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {screens.map((sc, i) => {
        const r = (((i + offset) % n) + n) % n; // 0: back, top right; n: front, bottom left
        const d = r - n / 2;
        const edge = Math.min(1, r / 0.7, (n - r) / 0.7); // invisible where a card wraps round
        return (
          <div
            key={sc.key}
            className="pointer-events-auto absolute w-[480px]"
            style={{
              left: `calc(64% + ${d * -12}rem)`,
              top: `calc(47% + ${d * 8}rem)`,
              zIndex: Math.round(r * 10),
              opacity: edge,
              transform: "translate(-50%, -50%) skewY(-6deg)",
            }}
            onMouseEnter={() => (held.current = true)}
            onMouseLeave={() => (held.current = false)}
          >
            <div className="rise-in" style={{ "--i": 3 + i } as CSSProperties}>
              <ScreenCard screen={sc} index={i} width={480} hoverLift />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SCREEN_W = 428; // the app's own column width inside a card

/** A screen in a frame, to look at (not a link): a mono title bar, then the live component, drawn at the app's width and scaled to fit. */
function ScreenCard({ screen, index, width, hoverLift = false }: { screen: Screen; index: number; width: number; hoverLift?: boolean }) {
  const inner = width - 32;
  const scale = inner / SCREEN_W;
  const height = Math.round((width * 10) / 16);
  return (
    <div className="group block cursor-default select-none text-text">
      <span className="mono-label mb-2 block opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        {screen.label} · {screen.sub}
      </span>
      <span
        className={`lp-screen block ${hoverLift ? "lp-screen--lift" : ""}`}
        style={{ height }}
      >
        <span className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <span className="mono-label truncate">
            0{index + 1} · {screen.label}
          </span>
          <span className="mono-label shrink-0">{screen.sub}</span>
        </span>
        <span className="pointer-events-none block overflow-hidden px-4 pt-3" style={{ height: height - 41 }} aria-hidden="true" inert>
          <span className="lp-screen__body block origin-top-left" style={{ width: SCREEN_W, transform: `scale(${scale})` }}>
            {screen.body}
          </span>
        </span>
      </span>
    </div>
  );
}

// ---- How it works

const STEPS = [
  {
    title: "Tag it",
    text: "An NFC sticker on every box and every carrier. Tap the carrier, then the box, and the box is loaded. Phones read the stickers with no app to install.",
  },
  {
    title: "Sense it",
    text: "A small node in the cold box logs the temperature and uploads over WiFi, keeping every reading until the server confirms it. Readings show up live as they land.",
  },
  {
    title: "Decide",
    text: "Each product's stability budget is spent with the Arrhenius equation, freezing is checked on its own, and the box gets one verdict: use, use first, quarantine or discard. A photo of the VVM label is the second witness.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-4 border-t border-line">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-28">
        <p className="mono-label m-0">How it works</p>
        <h2 className="m-0 mt-4 max-w-lg font-display text-[32px] font-semibold leading-tight tracking-[-0.02em]">From a sticker to a decision</h2>
        <div className="mt-14 grid lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className={`py-10 lg:py-0 ${i > 0 ? "border-t border-line lg:border-t-0 lg:pl-12" : ""} ${i < 2 ? "lg:border-r lg:border-line lg:pr-12" : ""}`}>
              <span className="mono-label">0{i + 1}</span>
              <h3 className="m-0 mt-4 font-display text-xl font-semibold tracking-[-0.01em]">{s.title}</h3>
              <p className="m-0 mt-3 text-[15px] leading-6 text-neutral-500">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- The numbers, all of them from the running system

function Numbers({ fleet, impact }: { fleet: FleetSummary | null; impact: Impact | null }) {
  const s = impact?.sweep.summary;
  const trips = (p: "status_quo" | "vialtality_planned") => (s ? Math.round(s[p].trips_breached.mean) : null);
  const unsafeCut = s ? Math.round((1 - s.vialtality_planned.unsafe_used.mean / Math.max(s.status_quo.unsafe_used.mean, 1)) * 100) : null;
  const stats = [
    { value: fleet ? fleet.doses_tracked.toLocaleString() : "–", label: "Doses and tests tracked now" },
    { value: fleet ? String(fleet.counts.QUARANTINE + fleet.counts.DISCARD) : "–", label: "Boxes to check today" },
    { value: trips("status_quo") != null ? `${trips("status_quo")} → ${trips("vialtality_planned")}` : "–", label: "Trips out of 2–8 °C, today vs planned" },
    { value: unsafeCut != null ? `−${unsafeCut}%` : "–", label: "Heat-spent or freeze-exposed doses given" },
  ];
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 text-center lg:grid-cols-4">
          {stats.map((st) => (
            <div key={st.label}>
              <span className="block font-display text-[34px] font-semibold tabular-nums tracking-[-0.02em]">{st.value}</span>
              <span className="mono-label mt-2 block">{st.label}</span>
            </div>
          ))}
        </div>
        {impact && (
          <p className="ui-caption m-0 mx-auto mt-10 max-w-xl text-center">
            The last two are from a backtest: {impact.run.trips} outreach trips over {impact.run.days} days on the real hourly
            weather at the district's clinics, decided four ways. A simulation, not a field trial.{" "}
            <Link to="/impact" className="underline underline-offset-2">
              See the backtest
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

// ---- What's inside, each one a link into the real thing

const VIEWS = [
  { to: "/box/BOX-KO-0915", title: "The verdict", text: "Tap a box: use, use first, quarantine or discard, with the reasons and what to do next." },
  { to: "/box/BOX-NG-0442", title: "Trip conditions", text: "Every reading as a dot you can turn, grouped by what the box went through and what each stretch cost." },
  { to: "/boxes?view=map", title: "Shipments map", text: "Every box where it is now, by verdict, with the ones on hold or to be thrown away easy to spot." },
  { to: "/climate", title: "Heat ahead", text: "The weather forecast against every store and clinic for the next 72 hours, before the heat arrives." },
];

function Views() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-28">
        <p className="mono-label m-0">Inside the app</p>
        <h2 className="m-0 mt-4 max-w-lg font-display text-[32px] font-semibold leading-tight tracking-[-0.02em]">Everything is live. Open any of it.</h2>
        <div className="mt-12 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
          {VIEWS.map((v) => (
            <Link key={v.to} to={v.to} className="group border-t border-line py-6 text-text no-underline">
              <span className="flex items-center justify-between gap-3">
                <span className="font-display text-lg font-semibold tracking-[-0.01em]">{v.title}</span>
                <ChevronRightIcon size={18} className="text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-text" />
              </span>
              <span className="mt-2 block text-[15px] leading-6 text-neutral-500">{v.text}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col items-center px-6 py-24 text-center lg:px-10">
        <h2 className="m-0 font-display text-[32px] font-semibold tracking-[-0.02em]">See it on a real box.</h2>
        <p className="m-0 mt-4 max-w-md text-[15px] leading-6 text-neutral-500">
          BOX-KO-0915 rode a motorbike to an outreach session and froze on the way, most likely because the ice packs went in
          straight from the freezer.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/box/BOX-KO-0915" className="pill-btn pill-btn--solid">
            Open BOX-KO-0915
          </Link>
          <Link to="/boxes" className="pill-btn">
            All boxes
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row lg:px-10">
        <Logo height={22} />
        <span className="mono-label text-center">Decision support with a human in the loop · not a clinical determination</span>
        <span className="mono-label">HopHacks 2026</span>
      </div>
    </footer>
  );
}
