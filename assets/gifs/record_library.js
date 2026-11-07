// Records the frames for the home page's Library tile (make_library_clip.py draws the pointer and encodes them): the
// real Library pages with their real covers, driven step by step in headless Chrome at 2x, one screenshot per frame.
// (Nick, 2026-11-06: "make it specific towards the libraries and the way they look and their images"; until then the
// tile was a drawn shelf.)
//   1. Movies: a pan down the A–Z shelf (the cases and their letter tabs), a case pulled up off the shelf
//   2. Vinyl: the covers with their bin tabs; a record slides out of its sleeve, then its card opens (the record
//      pulled out)
//   3. Books: a book's card opens (its pages and cover fall shut)
//   4. Board games: the boxes with players, time and complexity under them; one lifts
// The pages' own CSS animations are stepped frame by frame (each paused and moved on 1/30 s per frame), so they play
// at their real speed in the video however long a screenshot takes.
// Usage: node record_library.js <work folder>   (needs puppeteer-core, the local site on :8000 and Worker on :8787)
// Writes <work>/library-raw/NNNN.png (1920x1200), cursor.json [[x, y, click], ...] in 960x600 units, scenes.json.
const fs = require("fs"), path = require("path");
const puppeteer = require("puppeteer-core");
const OUT = path.join(process.argv[2] || "clip-work", "library-raw");
const VW = 960, VH = 600, SITE = "http://localhost:8000";
const ease = (u) => u * u * (3 - 2 * u);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("nm-wall-bg", "0"); } catch (e) {} // no poster wall behind (too busy at tile size)
    // the animation clock: every CSS animation/transition is paused and moved on by hand, 1/30 s a frame
    window.__m = new Map(); window.__clk = 0;
    window.__tick = (dt) => {
      const now = (window.__clk += dt);
      document.getAnimations().forEach((a) => {
        if (!window.__m.has(a)) window.__m.set(a, [a.currentTime || 0, now - dt]);
        const [b, t0] = window.__m.get(a);
        a.pause(); a.currentTime = b + (now - t0);
      });
    };
  });
  let n = 0, clip = null;
  const cursor = [], scenes = [];
  async function shot(px, py, click) {
    await page.evaluate(() => window.__tick(1000 / 30));
    await page.screenshot({ path: path.join(OUT, String(n++).padStart(4, "0") + ".png"), clip });
    cursor.push([(px - clip.x) * VW / clip.width, (py - clip.y) * VH / clip.height, click ? 1 : 0]);
  }
  async function move(from, to, frames, hover) {
    for (let i = 1; i <= frames; i++) {
      const u = ease(i / frames), x = from[0] + (to[0] - from[0]) * u, y = from[1] + (to[1] - from[1]) * u;
      if (hover) await page.mouse.move(x, y);
      await shot(x, y);
    }
    return to;
  }
  async function hold(at, frames) { for (let i = 0; i < frames; i++) await shot(at[0], at[1]); }
  const rects = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }), sel);
  const mid = (r) => [r.x + r.w / 2, r.y + r.h * 0.45];
  async function open(url, sel, width) {
    await page.setViewport({ width, height: 2400, deviceScaleFactor: 2 }); // tall: nothing scrolls, so the clip pans instead
    await page.goto(SITE + url, { waitUntil: "networkidle0", timeout: 90000 });
    await page.waitForSelector(sel, { timeout: 60000 });
    await page.evaluate(async () => { // every picture in view drawn
      await Promise.all([...document.images].filter((i) => i.getBoundingClientRect().top < 2400).map((i) => { i.loading = "eager"; return i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }); }));
    });
    await wait(600);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  const W = (width) => ({ width, height: width * VH / VW });
  // a card (a modal dialog) opens in the middle of the window: size the window so its middle is the clip's
  async function centreOn(y, width) {
    await page.setViewport({ width, height: Math.round(2 * (y + width * VH / VW / 2)), deviceScaleFactor: 2 });
    await wait(300);
  }
  // the clip just above the first item, the window sized so a card opens in the clip's middle (resizing can move the
  // page: the Vinyl page's head depends on the window's height), measured again until it holds still
  async function settle(sel, above, k0 = 0) {
    let r = await rects(sel), y = r[k0].y - above;
    for (let k = 0; k < 5; k++) {
      await centreOn(y, 900);
      r = await rects(sel);
      if (Math.abs(r[k0].y - above - y) < 2) break;
      y = r[k0].y - above;
    }
    clip = { x: 0, ...W(900), y: r[k0].y - above };
    return r;
  }
  // after a click opens a card: hold, panning onto the card if it isn't in the clip's middle
  async function cardHold(at, frames, toTop) { // (toTop: a tall card, the camera on its top: the sleeve and record)
    const d = await page.evaluate(() => { const e = document.querySelector("dialog[open]"); if (!e) return null; const r = e.getBoundingClientRect(); return [r.y, r.y + r.height / 2]; });
    const y0 = clip.y, y1 = d == null ? y0 : toTop ? d[0] - 24 : d[1] - clip.height / 2;
    for (let i = 1; i <= frames; i++) { clip = { ...clip, y: y0 + (y1 - y0) * ease(Math.min(1, i / 10)) }; await shot(at[0], at[1]); }
  }

  // ---- 1. Movies: down the A–Z shelf ----
  scenes.push(n);
  await open("/library/movies/", ".slot-btn", 900);
  let slots = await rects(".slot-btn");
  // start where the most letter tabs come up during the pan (the # section alone is longer than it)
  await page.setViewport({ width: 900, height: 20000, deviceScaleFactor: 2 });
  await wait(400);
  slots = await rects(".slot-btn");
  const tabs = (await rects(".case-tab")).map((r) => r.y);
  let top = slots[0].y - 70, best = -1;
  for (const t of tabs) for (const off of [100, 250, 400]) {
    const y = t - off, k = tabs.filter((u) => u > y + 30 && u < y + 760 + 480).length;
    if (k > best) { best = k; top = y; }
  }
  await page.evaluate(async (y0) => { // the pictures along the way drawn
    await Promise.all([...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.top > y0 - 200 && r.top < y0 + 1600; })
      .map((i) => { i.loading = "eager"; return i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }); }));
  }, top);
  await wait(500);
  clip = { x: 0, ...W(900), y: top };
  let at = [700, top + 420];
  await hold(at, 6);
  for (let i = 1; i <= 84; i++) { // the shelf rises past, the A and B tabs coming up (the pointer rides along)
    clip = { ...clip, y: top + 760 * ease(i / 84) };
    at = [at[0] - 1.8, clip.y + 420 - i * 1.2];
    await shot(at[0], at[1]);
  }
  const lift = slots.filter((r) => r.y > clip.y + 120 && r.y + r.h < clip.y + clip.height - 40)[2] || slots[8];
  at = await move(at, mid(lift), 16, true);
  await hold(at, 22);

  // ---- 2. Vinyl: a record out of its sleeve, then its card ----
  await page.mouse.move(0, 0);
  scenes.push(n);
  await open("/library/vinyl/", ".coll-item.record", 900);
  // (the second row: Bad Books on red vinyl and II: Revisited on yellow and blue marble; black records barely show)
  const recs = await settle(".coll-item.record .sleeve", 50, 4);
  at = [mid(recs[4])[0] + 40, clip.y + 520];
  await hold(at, 4);
  at = await move(at, mid(recs[4]), 14, true);
  await hold(at, 18);
  at = await move(at, mid(recs[6]), 16, true);
  await hold(at, 16);
  await page.mouse.click(at[0], at[1]);
  await shot(at[0], at[1], true);
  await page.mouse.move(at[0], at[1] + 300); // (off the card, so nothing in it is hovered)
  await cardHold(at, 50, true);

  // ---- 3. Books: a card opens, the book falls shut ----
  scenes.push(n);
  await open("/library/books/", ".coll-item.book-cover", 900);
  const books = await settle(".coll-item.book-cover", 40);
  at = [mid(books[3])[0] + 60, clip.y + 520];
  await hold(at, 4);
  at = await move(at, mid(books[2]), 16, true);
  await hold(at, 6);
  await page.mouse.click(at[0], at[1]);
  await shot(at[0], at[1], true);
  await page.mouse.move(at[0], at[1] + 300);
  await cardHold(at, 76); // (a second longer than first made: Nick, 2026-11-06)

  // ---- 4. Board games: the boxes, one lifting, its card opened and scrolled to its How to Play video ----
  // (Nick, 2026-11-06: a second longer, "open one and scroll to show that it has a youtube how to play video")
  scenes.push(n);
  await open("/library/board-games/", ".coll-item.game-box", 900);
  const yt = {};
  (await (await fetch("http://localhost:8787/collection/games")).json()).items.forEach((g) => { if (g.howto && g.howto.yt) yt[g.id] = 1; });
  const gids = await page.evaluate(() => [...document.querySelectorAll(".coll-item.game-box")].map((e) => e.dataset.id));
  const gk = Math.max(0, gids.slice(0, 10).findIndex((id) => yt[id])); // the first box near the top with a video
  const games = await settle(".coll-item.game-box", 40, gk - (gk % 5));
  const g0 = games[gk - (gk % 5)];
  at = [mid(g0)[0] - 30, clip.y + 500];
  await hold(at, 6);
  at = await move(at, mid(games[gk]), 18, true);
  await hold(at, 18);
  await page.mouse.click(at[0], at[1]);
  await shot(at[0], at[1], true);
  await page.mouse.move(at[0], at[1] + 300);
  await cardHold(at, 34, true);
  // the video's player loads (YouTube's, in real time) while the card sits
  await page.waitForFunction(() => { const f = document.querySelector("dialog[open] .coll-howto iframe"); return f && !f.dataset.src; }, { timeout: 30000 }).catch(() => {});
  await wait(3500);
  await hold(at, 10);
  // scroll the card down to it: the card's own scroller first, the camera for the rest
  const sc = await page.evaluate(() => {
    const f = document.querySelector("dialog[open] .coll-howto"); if (!f) return null;
    let el = f.parentElement;
    while (el && el.tagName !== "DIALOG" && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    if (el && el.tagName === "DIALOG" && !(el.scrollHeight > el.clientHeight + 4)) el = null;
    window.__scroller = el;
    const r = f.getBoundingClientRect();
    return { top: r.y, h: r.height, s0: el ? el.scrollTop : 0, max: el ? el.scrollHeight - el.clientHeight - el.scrollTop : 0 };
  });
  if (sc) {
    const need = sc.top + sc.h / 2 - (clip.y + clip.height / 2);
    const byScroll = Math.max(0, Math.min(need, sc.max)), byPan = need - byScroll, y0 = clip.y;
    for (let i = 1; i <= 36; i++) {
      const u = ease(i / 36);
      await page.evaluate((t) => { if (window.__scroller) window.__scroller.scrollTop = t; }, sc.s0 + byScroll * u);
      clip = { ...clip, y: y0 + byPan * u };
      await shot(at[0], at[1]);
    }
  }
  await hold(at, 40);

  fs.writeFileSync(path.join(OUT, "cursor.json"), JSON.stringify(cursor));
  fs.writeFileSync(path.join(OUT, "scenes.json"), JSON.stringify(scenes));
  console.log(n + " frames, scenes at " + scenes.join(", "));
  await browser.close();
})();
