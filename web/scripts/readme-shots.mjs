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

for (const fig of FIGURES) {
  const paths = [];
  for (const [i, shot] of fig.shots.entries()) {
    await page.goto(BASE + shot.route, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3500);
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
console.log(`\nscreens in ${out} (compose with scripts/readme-figures.py)`);
