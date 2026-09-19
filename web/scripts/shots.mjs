#!/usr/bin/env node
/**
 * Screenshots of the running dev server for review: each route at phone and
 * laptop width, in light and dark, saved under docs/img/overhaul/<name>/.
 *
 *   node scripts/shots.mjs <name> [route ...]
 *
 * With no routes, shoots the main screens. Needs `npm run dev:remote` (or
 * `npm run dev`) on :5173 first. Set BASE to point elsewhere.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5173";
const [name = "review", ...routes] = process.argv.slice(2);
const ROUTES = routes.length ? routes : ["/", "/boxes", "/box/BOX-KO-0915", "/node/DEMO-01", "/stage", "/live", "/climate", "/plan", "/impact"];
const SIZES = {
  phone: { width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  laptop: { width: 1440, height: 900, deviceScaleFactor: 2 },
};
const SCHEMES = ["light", "dark"];

const out = resolve(import.meta.dirname, "..", "..", "docs", "img", "overhaul", name);
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
for (const [size, viewport] of Object.entries(SIZES)) {
  for (const scheme of SCHEMES) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.deviceScaleFactor, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch, colorScheme: scheme, reducedMotion: "no-preference" });
    const page = await context.newPage();
    page.on("console", (m) => m.type() === "error" && console.error(`  console.error [${size}/${scheme}] ${m.text().slice(0, 300)}`));
    page.on("pageerror", (e) => console.error(`  pageerror [${size}/${scheme}] ${e.message.slice(0, 300)}`));
    for (const route of ROUTES) {
      const slug = route === "/" ? "landing" : route.replace(/^\//, "").replace(/[/?=&]+/g, "-");
      try {
        await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
        await page.evaluate(() => document.fonts.ready);
        // Let the entrance motion finish and lazy maps settle.
        await page.waitForTimeout(1600);
        const file = `${slug}-${size}-${scheme}.png`;
        await page.screenshot({ path: resolve(out, file), fullPage: process.env.FULL !== "0" });
        console.log(`${name}/${file}`);
      } catch (e) {
        console.error(`FAILED ${route} ${size} ${scheme}: ${e.message}`);
      }
    }
    await context.close();
  }
}
await browser.close();
