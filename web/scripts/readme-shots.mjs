#!/usr/bin/env node
/**
 * The screenshots the README embeds, taken from the running app.
 *
 *   BASE=https://securivax.onrender.com node scripts/readme-shots.mjs
 *
 * Each figure is a row of screens at tablet width: the app is still one column
 * there (the two-column layout starts at 1024), and the verdict word fits,
 * which headless Chromium cannot work out for itself at phone width.
 * They are written straight to docs/img/, replacing what is there.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:8010";
const out = resolve(import.meta.dirname, "..", "..", "docs", "img");
await mkdir(out, { recursive: true });

/** One figure: a name, and the phone screens that go in it left to right. */
const FIGURES = [
  {
    name: "overview",
    shots: [
      { route: "/boxes", scrollTo: 0 },
      { route: "/box/BOX-NG-0442", scrollTo: 0 },
      { route: "/box/BOX-SN-0834", scrollTo: 0 },
    ],
  },
  {
    name: "twin-vvm",
    shots: [
      { route: "/node/CD-TRK", scrollTo: 0 },
      { route: "/box/BOX-KO-0915", scrollTo: 0 },
      { route: "/climate", scrollTo: 300 },
    ],
  },
  { name: "impact", shots: [{ route: "/impact", scrollTo: 0 }] },
  {
    name: "environment",
    shots: [
      { route: "/climate", scrollTo: 0 },
      { route: "/box/BOX-NG-0442", scrollTo: 1400 },
    ],
  },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 820, height: 1180 },
  deviceScaleFactor: 2,
  hasTouch: true,
  colorScheme: "dark",
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("  pageerror:", e.message.slice(0, 160)));

// The fleet pages ask for a sign-in now; a single box or carrier does not.
await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 60000 });
const signedIn = await page.evaluate(
  async ([email, password]) => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return r.ok;
  },
  [process.env.LOGIN_EMAIL ?? "bhanda61@purdue.edu", process.env.LOGIN_PASSWORD ?? "12345678"],
);
console.log(`signed in = ${signedIn}`);

for (const fig of FIGURES) {
  const paths = [];
  for (const [i, shot] of fig.shots.entries()) {
    await page.goto(BASE + shot.route, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3500);
    // Headless Chromium cannot measure the fitted verdict word: scrollWidth
    // comes back clipped to the parent, so every fit lands back on the
    // measuring size and "QUARANTINE" renders as "QUARANTIN". Measure the inner
    // span's rect instead, which is the true text width, and apply the same
    // sum the app does — so the shot matches what a real browser draws.
    await page.evaluate(() => {
      const t = document.querySelector(".verdict-field__word");
      const box = t && t.parentElement;
      if (!t || !box) return;
      const inner = t.firstElementChild || t;
      const now = parseFloat(getComputedStyle(t).fontSize) || 128;
      const per = inner.getBoundingClientRect().width / now;
      if (per > 0 && box.clientWidth > 0) t.style.fontSize = `${Math.floor(box.clientWidth / per)}px`;
    });
    await page.waitForTimeout(400);
    if (shot.scrollTo) {
      await page.evaluate((y) => window.scrollTo(0, y), shot.scrollTo);
      await page.waitForTimeout(900);
    }
    const p = resolve(out, `_${fig.name}-${i}.png`);
    await page.screenshot({ path: p });
    paths.push(p);
    process.stdout.write(`  ${fig.name}[${i}] ${shot.route}\n`);
  }
  console.log(`${fig.name}: ${paths.length} screens`);
}

await browser.close();
console.log(`\nscreens in ${out} (composed by the figure step below)`);
