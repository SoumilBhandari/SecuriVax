#!/usr/bin/env node
/**
 * Every scroll-driven chapter of the landing page, as frame sequences, for
 * handing to a designer.
 *
 *   node scripts/chapters.mjs [frames]
 *
 * Each chapter is a tall section whose inner view sticks while the reader
 * scrolls through it, and its animation is that scroll. This walks each one's
 * own scroll range and saves two sequences:
 *
 *   scene-NN.png    the whole composition, copy and background included
 *   object-NN.png   the 3D object alone on transparency, where there is one
 *
 * Needs the app running: `npm run dev` on :5173, or BASE=http://localhost:8010
 * for a production build. Frames land in docs/img/landing/<chapter>/; turn them
 * into looping previews and contact sheets with scripts/chapter-previews.py.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5173";
const FRAMES = Number(process.argv[2]) || 18;

const out = resolve(import.meta.dirname, "..", "..", "docs", "img", "landing");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  reducedMotion: "no-preference",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("  pageerror:", e.message.slice(0, 200)));

await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);

// Let every chapter's renderer come up before measuring anything: a chapter
// mounts its object when it comes within a screen of the viewport, so this
// walks the page once first.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(3000);

/**
 * Where each chapter's scroll starts and ends. A pinned chapter runs from its
 * top meeting the viewport's top to its bottom meeting the viewport's bottom;
 * the one unpinned chapter starts when its top has risen to 85% of the way up.
 */
const chapters = await page.evaluate(() =>
  [...document.querySelectorAll("section.chapter")].map((el, i) => {
    const pinned = el.style.height !== "";
    const top = el.getBoundingClientRect().top + window.scrollY;
    return {
      index: i + 1,
      label: el.getAttribute("aria-label") ?? `chapter-${i + 1}`,
      theme: el.getAttribute("data-theme") ?? "dark",
      pinned,
      from: pinned ? top : top - window.innerHeight * 0.85,
      to: top + el.offsetHeight - window.innerHeight,
    };
  }),
);
console.log(`${chapters.length} chapters\n`);

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

const manifest = [];
for (const c of chapters) {
  const dir = resolve(out, `${String(c.index).padStart(2, "0")}-${slug(c.label)}`);
  await mkdir(dir, { recursive: true });
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const p = i / (FRAMES - 1);
    await page.evaluate((y) => window.scrollTo(0, y), c.from + (c.to - c.from) * p);
    // The scrub lerps towards the new progress rather than jumping to it.
    await page.waitForTimeout(650);
    const name = `scene-${String(i + 1).padStart(2, "0")}.png`;
    await page.screenshot({ path: resolve(dir, name) });
    frames.push({ frame: i + 1, progress: Number(p.toFixed(3)), scene: name });
  }
  manifest.push({ ...c, dir: dir.slice(out.length + 1), frames });
  console.log(`  ${c.label}: ${FRAMES} scene frames`);
}

// Second pass: the object on its own. Everything drawn over it is hidden and
// every background behind it dropped, so what is left is what the renderer
// draws, which has an alpha channel. The chain that really paints is the
// chapter's own ground and the landing wrapper; miss either and it comes out
// opaque.
await page.addStyleTag({
  content: `
    .hero-glow, .hero-hint, .hero-chip-slot, nav, header, footer,
    h1, h2, p, a, .eyebrow, .pill-btn, .chapter__copy { opacity: 0 !important; }
    html, body, #root, .landing, section, .chapter, .chapter__view { background: transparent !important; }
  `,
});
await page.waitForTimeout(500);

for (const c of manifest) {
  const dir = resolve(out, c.dir);
  // The live renderer's canvas is the one the chapter hides its flat drawing
  // behind; a chapter drawn in SVG has none, and is skipped.
  const canvas = page.locator(`section.chapter >> nth=${c.index - 1}`).locator("canvas").nth(1);
  if (!(await canvas.count())) {
    console.log(`  ${c.label}: no object, scene frames only`);
    continue;
  }
  for (let i = 0; i < FRAMES; i++) {
    const p = i / (FRAMES - 1);
    await page.evaluate((y) => window.scrollTo(0, y), c.from + (c.to - c.from) * p);
    await page.waitForTimeout(650);
    const name = `object-${String(i + 1).padStart(2, "0")}.png`;
    await canvas.screenshot({ path: resolve(dir, name), omitBackground: true });
    c.frames[i].object = name;
  }
  console.log(`  ${c.label}: ${FRAMES} object frames (transparent)`);
}

await writeFile(
  resolve(out, "manifest.json"),
  JSON.stringify(
    {
      source: "SecuriVax landing page",
      viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
      note: "Each chapter animates on scroll. progress 0 is its first frame, 1 its last. scene-*.png is the whole composition; object-*.png is the 3D object alone, on transparency.",
      chapters: manifest,
    },
    null,
    2,
  ),
);

await browser.close();
console.log(`\nframes in ${out}`);
