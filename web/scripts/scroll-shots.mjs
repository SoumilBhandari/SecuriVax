#!/usr/bin/env node
/**
 * Screenshots of one route at several scroll positions, for pages whose
 * chapters pin and scrub (the landing page). Saved under
 * docs/img/overhaul/<name>/.
 *
 *   node scripts/scroll-shots.mjs <name> <route> [fractions...]
 *
 * Fractions are of the page's scroll height, default every 8%.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5173";
const [name = "scroll", route = "/", ...fr] = process.argv.slice(2);
const FRACTIONS = fr.length ? fr.map(Number) : Array.from({ length: 13 }, (_, i) => i / 12);
const SIZES = {
  phone: { width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  laptop: { width: 1440, height: 900, deviceScaleFactor: 1.5 },
};
const sizes = process.env.SIZE ? [process.env.SIZE] : Object.keys(SIZES);

const out = resolve(import.meta.dirname, "..", "..", "docs", "img", "overhaul", name);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const size of sizes) {
  const viewport = SIZES[size];
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.deviceScaleFactor, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch, colorScheme: "light" });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`  pageerror [${size}] ${e.message.slice(0, 300)}`));
  page.on("console", (m) => m.type() === "error" && console.error(`  console.error [${size}] ${m.text().slice(0, 300)}`));
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  for (const f of FRACTIONS) {
    // Step there so scroll-driven timelines see the motion, then let them settle.
    await page.evaluate(async (y) => {
      const from = window.scrollY;
      for (let i = 1; i <= 8; i++) {
        window.scrollTo(0, from + ((y - from) * i) / 8);
        await new Promise((r) => requestAnimationFrame(r));
      }
      window.scrollTo(0, y);
    }, Math.round(total * f));
    // Headless GL is slow to compile a chapter's first frame; give the scrubbed timelines time to settle.
    await page.waitForTimeout(Number(process.env.WAIT ?? 1600));
    const file = `${size}-${String(Math.round(f * 100)).padStart(3, "0")}.png`;
    await page.screenshot({ path: resolve(out, file) });
    console.log(`${name}/${file}`);
  }
  await context.close();
}
await browser.close();
