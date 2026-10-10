// Records the frames for the home page's Extras tile (make_extras_clip.py draws the cursor and encodes them): the
// real pages, driven step by step in headless Chrome at 2x, one screenshot per video frame.
//   1. Golf: the Score Trend chart (localhost:8000/extras/golf/), the pointer sweeping across the rounds so the
//      chart's own crosshair and tooltip follow it
//   2. Video Game Montage Maker, run locally with its password off (REQUIRE_PASSWORD=false PORT=5099 python app.py in
//      its folder), dark theme: the gamertag typed, Apply, Nick's recent Xbox games load, three get ticked
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

  // ---- 2. Montage Maker ----
  await page.setViewport({ width: 1100, height: 2600, deviceScaleFactor: 2 });
  await page.goto("http://localhost:5099/", { waitUntil: "networkidle2" });
  await page.click("#themeToggle");
  const box = await page.evaluate(() => { const r = document.querySelector("#trueAchievementsUserId").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  clip = { x: 40, y: box.y - 70, width: 1020, height: 1020 * VH / VW };
  const top = clip.y;
  const input = [box.x + 60, box.y + box.h / 2];
  at = [input[0] + 300, input[1] + 220];
  for (let i = 0; i < 4; i++) await shot(at[0], at[1]);
  at = await move(at, input, 12, true);
  await page.mouse.click(input[0], input[1]);
  await shot(at[0], at[1], true);
  for (const ch of "helloJimHalpert") { await page.keyboard.type(ch); await shot(at[0], at[1]); await shot(at[0], at[1]); }
  const apply = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Apply").getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
  at = await move(at, apply, 10, true);
  await page.mouse.click(apply[0], apply[1]);
  await shot(at[0], at[1], true);
  await page.waitForFunction(() => document.querySelectorAll(".form-check-input").length > 10, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 8; i++) await shot(at[0], at[1]);
  const spot = (t) => page.evaluate((t) => { const r = [...document.querySelectorAll(".form-check-input")].find((e) => e.value === t).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, t);
  // tick three games; the view pans down the list on the way to the ones further down
  for (const [title, pan] of [["Minecraft Dungeons II", 0], ["Forza Horizon 6", 150], ["Gears of War: Reloaded", 270]]) {
    const c = await spot(title), from = at, y0 = clip.y;
    for (let i = 1; i <= 12; i++) {
      const u = ease(i / 12);
      clip = { ...clip, y: y0 + (top + pan - y0) * u };
      at = [from[0] + (c[0] - from[0]) * u, from[1] + (c[1] - from[1]) * u];
      await page.mouse.move(at[0], at[1]);
      await shot(at[0], at[1]);
    }
    await page.mouse.click(c[0], c[1]);
    await shot(at[0], at[1], true);
    for (let i = 0; i < 4; i++) await shot(at[0], at[1]);
  }
  for (let i = 0; i < 12; i++) await shot(at[0], at[1]);
  fs.writeFileSync(path.join(OUT, "cursor.json"), JSON.stringify(cursor));
  console.log(n + " frames");
  await browser.close();
})();
