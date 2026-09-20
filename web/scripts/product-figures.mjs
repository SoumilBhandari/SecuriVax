#!/usr/bin/env node
/**
 * Frames the raw screens from product-shots.mjs: the four verdicts inside drawn
 * iPhones, and the fleet views inside a browser window.
 *
 *   node scripts/product-figures.mjs
 *
 * Writes docs/img/verdicts.png and docs/img/dashboard.png.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const shots = resolve(import.meta.dirname, "..", "..", "docs", "img", "shots");
const out = resolve(import.meta.dirname, "..", "..", "docs", "img");
await mkdir(out, { recursive: true });

/** An iPhone 16 Pro drawn around a 402x874 screen: rail, island, buttons. */
const phoneCss = `
  .phone { position: relative; width: 426px; height: 898px; flex: 0 0 auto; }
  .phone .rail {
    position: absolute; inset: 0; border-radius: 68px;
    background: linear-gradient(145deg, #6f7479 0%, #b9bec3 16%, #83888d 38%, #5d6266 62%, #a8adb2 84%, #6b7075 100%);
    box-shadow: 0 34px 70px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.4);
  }
  .phone .glass {
    position: absolute; inset: 7px; border-radius: 61px; background: #0a0a0c;
    box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.10);
  }
  .phone .screen {
    position: absolute; inset: 12px; border-radius: 56px; overflow: hidden; background: #000;
  }
  .phone .screen img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .phone .island {
    position: absolute; left: 50%; top: 24px; transform: translateX(-50%);
    width: 122px; height: 35px; border-radius: 18px; background: #000; z-index: 3;
  }
  .phone .island::after {
    content: ""; position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
    width: 11px; height: 11px; border-radius: 50%;
    background: radial-gradient(circle at 34% 34%, #253044 0%, #0a0d14 62%);
  }
  .phone .btn { position: absolute; background: linear-gradient(180deg, #9aa0a5, #6d7378); border-radius: 2px; }
  .phone .btn.l { left: -2.5px; width: 3.5px; }
  .phone .btn.r { right: -2.5px; width: 3.5px; }
  .phone .gloss {
    position: absolute; inset: 12px; border-radius: 56px; z-index: 4; pointer-events: none;
    background: linear-gradient(118deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0) 26%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.05) 100%);
  }
`;

function phone(file) {
  return `
  <div class="phone">
    <div class="rail"></div>
    <div class="btn l" style="top: 168px; height: 34px;"></div>
    <div class="btn l" style="top: 232px; height: 62px;"></div>
    <div class="btn l" style="top: 312px; height: 62px;"></div>
    <div class="btn r" style="top: 262px; height: 96px;"></div>
    <div class="glass"></div>
    <div class="screen"><img src="shots/${file}" /></div>
    <div class="island"></div>
    <div class="gloss"></div>
  </div>`;
}

const VERDICTS = [
  { file: "phone-use.png", tag: "USE", tint: "#2e9e6b", line: "RTS,S malaria vaccine · 2% of budget", sub: "Safe to use" },
  { file: "phone-use-first.png", tag: "USE FIRST", tint: "#2e9e6b", line: "Malaria rapid test · 60% of budget", sub: "Bring it to the front" },
  { file: "phone-quarantine.png", tag: "QUARANTINE", tint: "#d8a11a", line: "Pentavalent · froze at −2.4 °C for 90 min", sub: "Run the shake test" },
  { file: "phone-discard.png", tag: "DISCARD", tint: "#cf3b3b", line: "Comirnaty · 3.2× the budget spent", sub: "Do not use" },
];

const verdictsHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1990px; height: 1268px; background: #08090a; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; padding: 48px 56px 40px;
  }
  .head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 34px; }
  h1 { font-size: 46px; font-weight: 800; letter-spacing: -0.035em; }
  .head p { font-size: 20px; color: #9aa3ad; letter-spacing: -0.012em; max-width: 660px; text-align: right; line-height: 1.42; }
  .row { display: flex; gap: 38px; justify-content: center; }
  .cell { display: flex; flex-direction: column; align-items: center; }
  .cap { margin-top: 22px; text-align: center; }
  .cap .tag { font-size: 23px; font-weight: 800; letter-spacing: 0.02em; }
  .cap .line { font-size: 18px; color: #c3cad2; margin-top: 7px; letter-spacing: -0.01em; }
  .cap .sub { font-size: 16px; color: #7d8792; margin-top: 3px; letter-spacing: -0.008em; }
  ${phoneCss}
</style></head><body>
  <div class="head">
    <h1>One trip. Four products. Four answers.</h1>
    <p>Every box in the same cold chain gets its own verdict, because vaccines don't fail at the same rate. Tapping the sticker opens this on any phone, with no account.</p>
  </div>
  <div class="row">
    ${VERDICTS.map((v) => `<div class="cell">${phone(v.file)}<div class="cap"><div class="tag" style="color:${v.tint}">${v.tag}</div><div class="line">${v.line}</div><div class="sub">${v.sub}</div></div></div>`).join("")}
  </div>
</body></html>`;

/** A browser window around a 1440x900 capture. */
const deskCss = `
  .win { position: relative; border-radius: 16px; overflow: hidden; background: #131417;
         box-shadow: 0 30px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.07); }
  .bar { height: 44px; display: flex; align-items: center; gap: 9px; padding: 0 17px; background: #1c1e22; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .url { flex: 1; margin: 0 14px; height: 26px; border-radius: 7px; background: #26292e;
         display: flex; align-items: center; padding: 0 13px; font-size: 13px; color: #97a0aa; letter-spacing: -0.006em; }
  .win img { display: block; width: 100%; }
`;

const deskHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 2260px; height: 1620px; background: #08090a; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; padding: 60px 64px 50px;
  }
  .head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 40px; }
  h1 { font-size: 46px; font-weight: 800; letter-spacing: -0.035em; }
  .head p { font-size: 21px; color: #9aa3ad; max-width: 760px; text-align: right; line-height: 1.4; letter-spacing: -0.012em; }
  .grid { display: grid; grid-template-columns: 1.42fr 1fr; gap: 34px; align-items: start; }
  .stack { display: flex; flex-direction: column; gap: 30px; }
  .cap { font-size: 17px; color: #8b949e; margin-top: 12px; letter-spacing: -0.008em; }
  .cap b { color: #dfe5eb; font-weight: 700; }
  ${deskCss}
</style></head><body>
  <div class="head">
    <h1>The fleet, for whoever is dispatching it</h1>
    <p>The same verdicts across every box in flight, the live signal as it lands, and the 90-day backtest that says what any of it is worth.</p>
  </div>
  <div class="grid">
    <div>
      <div class="win">
        <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
          <div class="url">securivax.com/boxes</div></div>
        <img src="shots/desk-boxes.png" />
      </div>
      <div class="cap"><b>Every box in flight.</b> Filter by verdict, search by product or place, or switch to the map.</div>
      <div class="win" style="margin-top: 30px;">
        <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
          <div class="url">securivax.com/impact</div></div>
        <img src="shots/desk-impact.png" />
      </div>
      <div class="cap"><b>90 days of real ERA5 weather, 360 trips, 20 seeds.</b> A threshold logger bins 1,100 good doses and costs more than doing nothing.</div>
    </div>
    <div class="stack">
      <div>
        <div class="win">
          <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
            <div class="url">securivax.com/live</div></div>
          <img src="shots/desk-live.png" />
        </div>
        <div class="cap"><b>Every reading as it reaches the server.</b> Server-sent events, last-good data kept on failure.</div>
      </div>
      <div>
        <div class="win">
          <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
            <div class="url">securivax.com/climate</div></div>
          <img src="shots/desk-climate.png" />
        </div>
        <div class="cap"><b>Heat risk ahead, and each carrier's real cold life.</b> A particle filter learns it from that carrier's own past trips.</div>
      </div>
    </div>
  </div>
</body></html>`;

await writeFile(resolve(out, "_verdicts.html"), verdictsHtml);
await writeFile(resolve(out, "_dashboard.html"), deskHtml);

const browser = await chromium.launch();
for (const [file, w, h, name] of [
  ["_verdicts.html", 1990, 1268, "verdicts"],
  ["_dashboard.html", 2260, 1620, "dashboard"],
]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.6 })).newPage();
  await page.goto(`file://${resolve(out, file)}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(`${name}.png`);
}
await browser.close();
await rm(resolve(out, "_verdicts.html"));
await rm(resolve(out, "_dashboard.html"));
