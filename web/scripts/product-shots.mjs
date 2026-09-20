#!/usr/bin/env node
/**
 * The product screenshots the README embeds: the four verdicts on a phone, and
 * the fleet views on a laptop.
 *
 *   BASE=https://securivax.onrender.com node scripts/product-shots.mjs
 *
 * Phone shots are taken at an iPhone's own size so they sit inside a drawn
 * bezel without resampling. The fleet pages need an account now, so this signs
 * in first; set LOGIN_EMAIL and LOGIN_PASSWORD, or it falls back to the demo
 * viewer. Raw screens land in docs/img/shots/ and are composed into figures by
 * scripts/product-figures.mjs.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:8010";
const EMAIL = process.env.LOGIN_EMAIL ?? "bhanda61@purdue.edu";
const PASSWORD = process.env.LOGIN_PASSWORD ?? "12345678";

const out = resolve(import.meta.dirname, "..", "..", "docs", "img", "shots");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

/** iPhone 16 Pro, at its own points so the bezel drawn around it is true to size. */
const PHONE = { width: 402, height: 874 };
const LAPTOP = { width: 1440, height: 900 };

const PHONES = [
  { name: "use", route: "/box/BOX-KE-0231" },
  { name: "use-first", route: "/box/BOX-SN-0834" },
  { name: "quarantine", route: "/box/BOX-KO-0915" },
  { name: "discard", route: "/box/BOX-NG-0442" },
  { name: "carrier", route: "/node/KO-VC" },
  { name: "fleet", route: "/boxes", auth: true },
];

const DESKS = [
  { name: "boxes", route: "/boxes", auth: true },
  { name: "box", route: "/box/BOX-NG-0442" },
  { name: "live", route: "/live", auth: true },
  { name: "climate", route: "/climate", auth: true },
  { name: "impact", route: "/impact", auth: true },
];

const browser = await chromium.launch();

async function shoot(list, viewport, dpr, tag) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    colorScheme: "dark",
    reducedMotion: "reduce",
    hasTouch: viewport.width < 500,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("  pageerror:", e.message.slice(0, 140)));

  // One sign-in for the whole context; the sticker pages don't need it.
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
    [EMAIL, PASSWORD],
  );
  console.log(`  ${tag}: signed in = ${signedIn}`);

  for (const s of list) {
    await page.goto(BASE + s.route, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3200);
    // Headless can't size the fitted verdict word; a real browser settles it to
    // the box. Run the same calculation so the shot matches a real phone.
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
    await page.screenshot({ path: resolve(out, `${tag}-${s.name}.png`) });
    process.stdout.write(`  ${tag}-${s.name}  ${s.route}\n`);
  }
  await context.close();
}

await shoot(PHONES, PHONE, 3, "phone");
await shoot(DESKS, LAPTOP, 2, "desk");

await writeFile(
  resolve(out, "manifest.json"),
  JSON.stringify({ base: BASE, phone: PHONE, laptop: LAPTOP, phones: PHONES, desks: DESKS }, null, 2),
);
await browser.close();
console.log(`\nscreens in ${out}`);
