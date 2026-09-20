#!/usr/bin/env node
/**
 * The device opening up, as a frame sequence, for handing to a designer.
 *
 *   node scripts/explode.mjs [frames]
 *
 * Drives the hero chapter by scroll, which is what really animates the shot:
 * the four parts lift apart over progress 0.14 to 0.86 while the camera
 * orbits and dollies. Everything drawn over the object is hidden and every
 * background behind it is dropped, so that the object, which renders with
 * alpha, comes out on transparency.
 *
 * Needs the app running: `npm run dev` on :5173, or BASE=http://localhost:8010
 * for a production build. Frames land in docs/img/explode/, and
 * `scripts/crop-explode.py` trims them all to one box afterwards.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5173";
const FRAMES = Number(process.argv[2]) || 24;
// A little before the parts start to lift and a little after they settle.
const FROM = 0.08;
const TO = 0.92;

const out = resolve(import.meta.dirname, "..", "..", "docs", "img", "explode");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1200, height: 1100 },
  deviceScaleFactor: 3,
  colorScheme: "dark",
  reducedMotion: "no-preference",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("  pageerror:", e.message.slice(0, 200)));

await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);

// Everything that shares the object's frame, and every background behind it.
// The chain that actually paints is the chapter's own black and the landing
// wrapper's light grey; miss either and the frames come out opaque.
await page.addStyleTag({
  content: `
    .hero-glow, .hero-hint, .hero-chip-slot, nav, header,
    h1, .hero-eyebrow, .ui-title-3, .pill-btn, .eyebrow { opacity: 0 !important; }
    html, body, #root, .landing, section, .chapter, .chapter__view { background: transparent !important; }
  `,
});

// The live renderer replaces the flat drawing only once it really has a
// context; until then there is nothing worth capturing.
await page.waitForFunction(() => [...document.querySelectorAll("canvas")].some((c) => c.style.opacity === "0"), null, { timeout: 45000 });
await page.waitForTimeout(2500);

const canvas = page.locator("section canvas").nth(1);
const shots = [];
for (let i = 0; i < FRAMES; i++) {
  const p = FROM + ((TO - FROM) * i) / (FRAMES - 1);
  // The hero is three viewports tall and pinned, so its progress runs over
  // the two viewports of scroll between its top and its bottom.
  await page.evaluate((y) => window.scrollTo(0, y * 2 * window.innerHeight), p);
  // The scrub lerps towards the new progress rather than jumping to it.
  await page.waitForTimeout(700);
  const name = `explode-${String(i + 1).padStart(2, "0")}.png`;
  await canvas.screenshot({ path: resolve(out, name), omitBackground: true });
  shots.push({ frame: i + 1, progress: Number(p.toFixed(3)), file: name });
  process.stdout.write(`  ${name}  p=${p.toFixed(3)}\n`);
}

await writeFile(
  resolve(out, "frames.json"),
  JSON.stringify(
    {
      source: "SecuriVax landing hero, shot A",
      parts: ["top cover (lockup + status LED)", "LiPo cell", "PCB (ESP32 + sensor headers)", "enclosure base"],
      explodeRange: [0.14, 0.86],
      capturedRange: [FROM, TO],
      note: "The camera orbits and dollies across the same progress, so the parts move and the view moves together, exactly as the site plays it.",
      frames: shots,
    },
    null,
    2,
  ),
);

await browser.close();
console.log(`\n${FRAMES} frames in ${out}`);
