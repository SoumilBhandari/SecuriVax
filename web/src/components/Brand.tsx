/**
 * The SecuriVax kit's components (components/bundle.js in the brand kit),
 * ported to React with types. Class names match the kit's CSS in index.css.
 */
import { useState, type ReactNode } from "react";

import logoDark from "../assets/brand/securivax-lockup-horizontal-dark.svg";
import logoLight from "../assets/brand/securivax-lockup-horizontal-light.svg";
import { getThemePref, setThemePref, type ThemePref } from "../lib/theme";
import type { Verdict } from "../types";
import { MoonIcon, SunIcon, SystemIcon } from "./Icons";

/** The kit has three verdict words: USE_FIRST reads as USE, with its own line. */
export type VerdictKey = "use" | "quarantine" | "discard";

export const VERDICT_KEY: Record<Verdict, VerdictKey> = {
  USE: "use",
  USE_FIRST: "use",
  QUARANTINE: "quarantine",
  DISCARD: "discard",
};

const WORD: Record<VerdictKey, string> = { use: "Use", quarantine: "Quarantine", discard: "Discard" };
const word = (v: Verdict) => (v === "USE_FIRST" ? "Use first" : WORD[VERDICT_KEY[v]]);

/** The horizontal lockup; the light file on light grounds and the dark one on Ink. */
export function Logo({ height = 30 }: { height?: number }) {
  return (
    <span className="inline-flex" style={{ height }}>
      <img src={logoLight} alt="SecuriVax" className="logo-light h-full w-auto" />
      <img src={logoDark} alt="" aria-hidden="true" className="logo-dark h-full w-auto" />
    </span>
  );
}

/** The mark in the ring's centre: the brand's V, or a verdict's ✓, ! or ✕. */
export type RingMark = "v" | "check" | "alert" | "cross";

export const VERDICT_MARK: Record<VerdictKey, RingMark> = { use: "check", quarantine: "alert", discard: "cross" };

function Mark({ mark }: { mark: RingMark }) {
  const common = { className: "sv-ring__glyph", fill: "none", strokeWidth: 9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (mark === "check") return <polyline {...common} points="35,51 46,62 66,40" />;
  if (mark === "cross") return <path {...common} d="M39 39 61 61M61 39 39 61" />;
  if (mark === "alert")
    return (
      <>
        <path {...common} d="M50 33v18" />
        <circle cx={50} cy={65} r={5.5} className="sv-ring__dot" />
      </>
    );
  return <polyline {...common} points="38,43 50,58 62,43" />;
}

/** How much of the stability budget is spent: the arc is spent, the track remains. */
export function BudgetRing({
  value,
  size = 96,
  tone = "surface",
  glyph = true,
  mark = "v",
  label,
}: {
  value: number; // percent, 0 to 100
  size?: number;
  /** surface: on bg or surface. inverse: on Ink. signal: on a verdict's colour, drawn in its text colour. */
  tone?: "surface" | "inverse" | "signal";
  glyph?: boolean;
  mark?: RingMark;
  label?: string;
}) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <svg
      className={`sv-ring${tone === "surface" ? "" : ` sv-ring--${tone}`}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label ?? `${Math.round(v)}% of stability budget used`}
    >
      <circle className="sv-ring__track" cx={50} cy={50} r={40} fill="none" strokeWidth={11} />
      {v >= 100 ? (
        <circle className="sv-ring__arc" cx={50} cy={50} r={40} fill="none" strokeWidth={11} />
      ) : v > 0 ? (
        <circle
          className="sv-ring__arc"
          cx={50}
          cy={50}
          r={40}
          fill="none"
          strokeWidth={11}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${v} ${100 - v}`}
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dasharray 700ms ease" }}
        />
      ) : null}
      {glyph && <Mark mark={mark} />}
    </svg>
  );
}

/** A verdict's word on its signal fill. Signals are for verdicts only. USE_FIRST
 * shares USE's green but says so, so it's never read as a plain USE. */
export function VerdictBadge({ verdict, children }: { verdict: Verdict; children?: ReactNode }) {
  const key = VERDICT_KEY[verdict];
  return <span className={`sv-badge sv-badge--${key}`}>{children ?? (verdict === "USE_FIRST" ? "Use first" : WORD[key])}</span>;
}

/**
 * The answer, first on the screen: the ring with the verdict's mark, VERDICT,
 * the word and one instruction, on the verdict's own colour (green, amber or
 * red) so a flip is seen before it's read. The team's call over the kit's
 * single Ink card: the verdict changing is the moment the demo is about.
 */
export function VerdictCard({ verdict, budgetUsed, note, ringSize = 64 }: { verdict: Verdict; budgetUsed: number; note: ReactNode; ringSize?: number }) {
  const key = VERDICT_KEY[verdict];
  return (
    <section className={`sv-verdict sv-verdict--${key}`} aria-label={`Verdict: ${word(verdict)}`}>
      <BudgetRing value={budgetUsed} tone="signal" size={ringSize} mark={VERDICT_MARK[key]} />
      <div>
        <p className="sv-verdict__eyebrow">Verdict</p>
        <p className={`sv-verdict__word${verdict === "USE_FIRST" ? " sv-verdict__word--discard" : key === "use" ? "" : ` sv-verdict__word--${key}`}`}>
          {word(verdict)}
        </p>
        <p className="sv-verdict__note">{note}</p>
      </div>
    </section>
  );
}

/** Label and value rows with hairline dividers. */
export function DataList({ rows }: { rows: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="sv-data">
      {rows.map((r, i) => (
        <div key={i} className="sv-data__row">
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemePref, string> = { system: "Theme: same as this device", light: "Theme: light", dark: "Theme: dark" };

/** Light, dark, or the device's setting, in turn. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const Icon = pref === "light" ? SunIcon : pref === "dark" ? MoonIcon : SystemIcon;
  return (
    <button
      className="back-btn"
      aria-label={`${THEME_LABEL[pref]}. Switch to ${NEXT[pref] === "system" ? "this device's setting" : NEXT[pref]}`}
      title={THEME_LABEL[pref]}
      onClick={() => {
        const next = NEXT[pref];
        setThemePref(next);
        setPref(next);
      }}
    >
      <Icon size={20} />
    </button>
  );
}
