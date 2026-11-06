// Records the frames for the home page's Extras tile (make_extras_clip.py draws the cursor and encodes them): the
// real pages, driven step by step in headless Chrome at 2x, one screenshot per video frame.
//   1. Golf: the Score Trend chart (localhost:8000/extras/golf/), the pointer sweeping across the rounds so the
//      chart's own crosshair and tooltip follow it
//   2. Golf weather (localhost:8000/extras/golf-weather/, the forecast live from the National Weather Service): it
//      opens on Plano; Hilton Head's ZIP (29928) typed over it, Check, its courses and week load, the pointer runs across today's hours with the page's tooltip
//      (until 2026-10-25 this was the Video Game Montage Maker, taken off the site)
// Usage: node record_extras.js <work folder>   (needs puppeteer-core: npm i puppeteer-core@23)
// Writes <work>/extras-raw/NNNN.png (1920x1200) and <work>/extras-raw/cursor.json [[x, y, click], ...] in 960x600 units.
const fs = require("fs"), path = require("path");
const puppeteer = require("puppeteer-core");
const OUT = path.join(process.argv[2] || "clip-work", "extras-raw");
const VW = 960, VH = 600;

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1000, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("nm-wall-bg", "0"); } catch (e) {} });
  let n = 0, clip = null;
  const cursor = [];
  // one frame: the clip region, and where the pointer is (page coordinates -> 960x600)
  async function shot(px, py, click) {
    await page.screenshot({ path: path.join(OUT, String(n++).padStart(4, "0") + ".png"), clip });
    cursor.push([(px - clip.x) * VW / clip.width, (py - clip.y) * VH / clip.height, click ? 1 : 0]);
  }
  const ease = (u) => u * u * (3 - 2 * u);
  async function move(from, to, frames, hover) {
    for (let i = 1; i <= frames; i++) {
      const u = ease(i / frames), x = from[0] + (to[0] - from[0]) * u, y = from[1] + (to[1] - from[1]) * u;
      if (hover) await page.mouse.move(x, y);
      await shot(x, y);
    }
    return to;
  }

  // The window is tall enough that nothing scrolls, so screenshot regions and pointer positions share coordinates.
  // ---- 1. Golf Score Trend ----
  await page.goto("http://localhost:8000/extras/golf/", { waitUntil: "networkidle0" });
  const svg = await page.evaluate(() => { const r = document.querySelector("svg").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const w = svg.w + 60, h = w * VH / VW;
  clip = { x: svg.x - 30, y: svg.y + svg.h + 30 - h, width: w, height: h };
  let at = [svg.x + svg.w + 40, svg.y + svg.h * 0.2];
  for (let i = 0; i < 6; i++) await shot(at[0], at[1]);
  at = await move(at, [svg.x + 30, svg.y + svg.h * 0.55], 14, false);
  at = await move(at, [svg.x + svg.w * 0.62, svg.y + svg.h * 0.6], 60, true);   // across to the best round
  for (let i = 0; i < 18; i++) await shot(at[0], at[1]);
  at = await move(at, [svg.x + svg.w * 0.95, svg.y + svg.h * 0.4], 24, true);
  await page.mouse.move(0, 0);

  // ---- 2. Golf weather ----
  await page.setViewport({ width: 1100, height: 2000, deviceScaleFactor: 2 });
  await page.goto("http://localhost:8000/extras/golf-weather/", { waitUntil: "networkidle0" });
  await page.waitForSelector(".gw-day .gw-h", { timeout: 40000 }); // it opens on Plano's week
  const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const form = await rect("#gw-search"), zip = await rect("#gw-zip"), go = await rect("#gw-search button");
  clip = { x: 40, y: form.y - 26, width: 1020, height: 1020 * VH / VW };
  at = [zip.x + 420, zip.y + 230];
  for (let i = 0; i < 4; i++) await shot(at[0], at[1]);
  const input = [zip.x + 50, zip.y + zip.h / 2];
  at = await move(at, input, 12, true);
  await page.mouse.click(input[0], input[1], { clickCount: 3 }); // (selects Plano's ZIP, to type over it)
  await shot(at[0], at[1], true);
  const before = await page.$eval(".gw-best", (e) => e.textContent);
  for (const ch of "29928") { await page.keyboard.type(ch); await shot(at[0], at[1]); await shot(at[0], at[1]); }
  const check = [go.x + go.w / 2, go.y + go.h / 2];
  at = await move(at, check, 10, true);
  await page.mouse.click(check[0], check[1]);
  await shot(at[0], at[1], true);
  // the week's forecast (the National Weather Service's, live): nearby courses, the best times, then a row per day
  await page.waitForFunction((b) => { const e = document.querySelector(".gw-best"); return e && e.textContent !== b && document.querySelector(".gw-day .gw-h"); }, { timeout: 40000 }, before);
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < 10; i++) await shot(at[0], at[1]);
  // across today's hours: the page's own tooltip follows the pointer
  const cells = await page.evaluate(() => [...document.querySelector(".gw-day").querySelectorAll(".gw-h")].map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  const bottom = clip.y + clip.height - 40, row = cells[0][1];
  if (row > bottom) { // pan down so the row is in view
    const y0 = clip.y;
    for (let i = 1; i <= 10; i++) { clip = { ...clip, y: y0 + (row - bottom) * ease(i / 10) }; await shot(at[0], at[1]); }
  }
  at = await move(at, cells[2], 14, true);
  at = await move(at, cells[Math.min(9, cells.length - 1)], 40, true);
  for (let i = 0; i < 16; i++) await shot(at[0], at[1]);
  fs.writeFileSync(path.join(OUT, "cursor.json"), JSON.stringify(cursor));
  console.log(n + " frames");
  await browser.close();
})();
