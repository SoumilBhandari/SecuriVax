import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { Logo } from "../components/Brand";
import { ChevronRightIcon } from "../components/Icons";
import { Reveal } from "../components/Reveal";
import { DecideChapter, TraceChapter } from "../landing/DataChapters";
import { Hero } from "../landing/Hero";
import { ObjectChapter } from "../landing/ObjectChapter";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { countTo, gsap, prefersReducedMotion, ScrollTrigger, useGSAP } from "../lib/motion";
import { useGround, useScrolled } from "../landing/useNavGround";
import type { BoxSummary, FleetSummary, Impact, Report } from "../types";

/**
 * The front door ("/"): an Apple-style scroll story around the carrier. It
 * art-directs its own grounds and ignores the app's theme. The app itself
 * starts at /boxes; stickers open /box/… and /node/… directly.
 */
export default function LandingPage() {
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [fleet, setFleet] = useState<FleetSummary | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [trip, setTrip] = useState<Report | null>(null);

  useEffect(() => {
    api
      .boxes()
      .then((all) => {
        setBoxes(all);
        // The trace chapter wants a trip that went wrong.
        const bad = all.find((b) => b.id === "BOX-NG-0442") ?? all.find((b) => b.verdict === "DISCARD") ?? all.find((b) => b.verdict === "QUARANTINE") ?? all[0];
        if (bad) api.report(bad.id).then(setTrip).catch(() => {});
      })
      .catch(() => {});
    api.fleet().then(setFleet).catch(() => {});
    api.impact().then(setImpact).catch(() => {});
  }, []);

  // The theme colour of the status bar follows the page's own ground, not the app's theme.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const was = meta?.getAttribute("content");
    meta?.setAttribute("content", "#000000");
    return () => {
      if (was) meta?.setAttribute("content", was);
    };
  }, []);

  const toCheck = boxes.filter((b) => b.verdict === "QUARANTINE" || b.verdict === "DISCARD").length;
  const doses = boxes.reduce((n, b) => n + b.quantity, 0);
  const line = boxes.length ? `${boxes.length} boxes · ${doses.toLocaleString()} doses and tests · ${toCheck} to check now` : null;
  const spotlight = boxes.find((b) => b.id === "BOX-KO-0915") ?? boxes.find((b) => b.verdict === "QUARANTINE") ?? null;
  const root = useRef<HTMLDivElement>(null);
  const ground = useGround(root);
  const scrolled = useScrolled();

  return (
    <div ref={root} data-theme="light" className="landing overflow-x-clip bg-bg text-text">
      <Nav ground={ground} scrolled={scrolled} />
      <Hero line={line} spotlight={spotlight} />
      <TraceChapter report={trip} />
      <HowItWorks />
      <ObjectChapter
        id="B"
        ground="light"
        eyebrow="01"
        title="Tag it"
        text="An NFC sticker on every box and every carrier. Tap the carrier, then the box, and the box is loaded. Phones read the stickers with no app to install."
      />
      <ObjectChapter
        id="C"
        ground="dark"
        eyebrow="02"
        title="Sense it"
        text="A small node in the cold box logs the temperature and uploads over WiFi, keeping every reading until the server confirms it. Readings show up live as they land."
      />
      <DecideChapter />
      <Numbers fleet={fleet} impact={impact} />
      <Views />
      <ObjectChapter id="F" ground="dark" title="See it on a real box." text={CLOSING} align="centre" pin={false}>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to="/box/BOX-KO-0915" viewTransition className="pill-btn pill-btn--solid">
            Open BOX-KO-0915
          </Link>
          <Link to="/boxes" viewTransition className="pill-btn">
            All boxes
          </Link>
        </div>
      </ObjectChapter>
      <Footer />
    </div>
  );
}

const CLOSING =
  "BOX-KO-0915 rode a motorbike to an outreach session and froze on the way, most likely because the ice packs went in straight from the freezer.";

// ---- The nav: transparent over the hero, then a floating glass capsule in the colours of the chapter under it.

function Nav({ ground, scrolled }: { ground: "light" | "dark"; scrolled: boolean }) {
  const { user } = useAuth();
  return (
    <div data-theme={ground} className={`landing-nav${scrolled ? " landing-nav--scrolled" : ""}`}>
      <nav className="landing-nav__bar" aria-label="Site">
        <Link to="/" aria-label="SecuriVax" className="flex">
          <Logo height={22} />
        </Link>
        <div className="landing-nav__links hidden md:flex">
          <a href="#how" className="landing-nav__link">
            How it works
          </a>
          <Link to="/live" viewTransition className="landing-nav__link">
            Live
          </Link>
          <Link to="/impact" viewTransition className="landing-nav__link">
            Impact
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {!user && (
            <Link to="/login" viewTransition className="landing-nav__link">
              Sign in
            </Link>
          )}
          <Link to="/boxes" viewTransition className="landing-nav__cta">
            Open the app
          </Link>
        </div>
      </nav>
    </div>
  );
}

// ---- How it works: the heading over the three steps, each its own chapter below.

function HowItWorks() {
  return (
    <section id="how" data-theme="light" className="scroll-mt-4 bg-bg text-text">
      <div className="mx-auto max-w-[1180px] px-6 pb-4 pt-20 lg:px-10 lg:pt-28">
        <Reveal>
          <p className="eyebrow m-0">How it works</p>
          <h2 className="ui-title-1 m-0 mt-4 max-w-lg">From a sticker to a decision</h2>
        </Reveal>
      </div>
    </section>
  );
}

// ---- The numbers, all of them from the running system, counting up as they come into view.

function Numbers({ fleet, impact }: { fleet: FleetSummary | null; impact: Impact | null }) {
  const root = useRef<HTMLElement>(null);
  const s = impact?.sweep.summary;
  const trips = (p: "status_quo" | "vialtality_planned") => (s ? Math.round(s[p].trips_breached.mean) : null);
  const unsafeCut = s ? Math.round((1 - s.vialtality_planned.unsafe_used.mean / Math.max(s.status_quo.unsafe_used.mean, 1)) * 100) : null;
  const stats: { n: number | null; format: (n: number) => string; label: string }[] = [
    { n: fleet?.doses_tracked ?? null, format: (n) => Math.round(n).toLocaleString(), label: "Doses and tests tracked now" },
    { n: fleet ? fleet.counts.QUARANTINE + fleet.counts.DISCARD : null, format: (n) => String(Math.round(n)), label: "Boxes to check today" },
    { n: trips("vialtality_planned"), format: (n) => `${trips("status_quo")} → ${Math.round(n)}`, label: "Trips out of 2–8 °C, today vs planned" },
    { n: unsafeCut, format: (n) => `−${Math.round(n)}%`, label: "Heat-spent or freeze-exposed doses given" },
  ];
  const ready = stats.every((st) => st.n != null);

  useGSAP(
    () => {
      if (!root.current || !ready) return;
      const els = Array.from(root.current.querySelectorAll<HTMLElement>("[data-count]"));
      ScrollTrigger.create({
        trigger: root.current,
        start: "top 75%",
        once: true,
        onEnter: () => {
          els.forEach((el, i) => {
            const st = stats[i];
            if (st.n == null) return;
            countTo(el, st.n, st.format, 1.4);
          });
          if (!prefersReducedMotion()) gsap.from(els, { y: 14, opacity: 0, duration: 0.8, stagger: 0.08, ease: "expo.out" });
        },
      });
    },
    { scope: root, dependencies: [ready] },
  );

  return (
    <section ref={root} data-theme="light" className="border-t border-line bg-bg text-text">
      <div className="mx-auto max-w-[1180px] px-6 py-20 lg:px-10 lg:py-28">
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 text-center lg:grid-cols-4">
          {stats.map((st) => (
            <div key={st.label}>
              <span data-count className="block font-display text-[40px] font-semibold tabular-nums tracking-[-0.02em] lg:text-[56px]">
                {st.n != null ? st.format(st.n) : "–"}
              </span>
              <span className="ui-caption mt-3 block">{st.label}</span>
            </div>
          ))}
        </div>
        {impact && (
          <p className="ui-caption m-0 mx-auto mt-12 max-w-xl text-center">
            The last two are from a backtest: {impact.run.trips} outreach trips over {impact.run.days} days on the real hourly weather at the
            district's clinics, decided four ways. A simulation, not a field trial.{" "}
            <Link to="/impact" viewTransition className="underline underline-offset-2">
              See the backtest
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

// ---- What's inside, each one a link into the real thing.

const VIEWS = [
  { to: "/box/BOX-KO-0915", title: "The verdict", text: "Tap a box: use, use first, quarantine or discard, with the reasons and what to do next." },
  { to: "/box/BOX-NG-0442", title: "Trip conditions", text: "Every reading as a dot you can turn, grouped by what the box went through and what each stretch cost." },
  { to: "/boxes?view=map", title: "Shipments map", text: "Every box where it is now, by verdict, with the ones on hold or to be thrown away easy to spot." },
  { to: "/climate", title: "Heat ahead", text: "The weather forecast against every store and clinic for the next 72 hours, before the heat arrives." },
];

function Views() {
  return (
    <section data-theme="light" className="border-t border-line bg-bg text-text">
      <div className="mx-auto max-w-[1180px] px-6 py-20 lg:px-10 lg:py-28">
        <Reveal>
          <p className="eyebrow m-0">Inside the app</p>
          <h2 className="ui-title-1 m-0 mt-4 max-w-lg">Everything is live. Open any of it.</h2>
        </Reveal>
        <Reveal each className="mt-12 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
          {VIEWS.map((v) => (
            <Link key={v.to} to={v.to} viewTransition className="group border-t border-line py-6 text-text no-underline">
              <span className="flex items-center justify-between gap-3">
                <span className="ui-heading">{v.title}</span>
                <ChevronRightIcon size={18} className="text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-text" />
              </span>
              <span className="mt-2 block text-[15px] leading-6 text-neutral-500">{v.text}</span>
            </Link>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer data-theme="dark" className="bg-bg text-text">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-6 py-6 lg:px-10 lg:py-10">
        <Logo height={18} />
        <span className="ui-footnote hidden text-center sm:inline">Decision support with a human in the loop · not a clinical determination</span>
        <span className="ui-footnote">HopHacks 2026</span>
      </div>
      <p className="ui-footnote m-0 px-6 pb-6 text-center sm:hidden">Decision support with a human in the loop · not a clinical determination</p>
    </footer>
  );
}
