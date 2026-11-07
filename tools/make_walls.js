// For tools/make_walls.py: opens each page with the poster wall (localhost:8000, the local Worker on :8787) and prints
// what its background would pick, as JSON: { page: { home, items: [{ src, small, ratio }] } }.
// Usage: NODE_PATH=<folder with puppeteer-core> node tools/make_walls.js > walls.json
const puppeteer = require("puppeteer-core");
const SITE = process.env.SITE || "http://localhost:8000";
const PAGES = ["/", "/movies/", "/games/", "/music/", "/photography/", "/library/", "/library/movies/", "/library/vinyl/", "/library/books/", "/library/board-games/"];

(async () => {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const out = {};
  for (const path of PAGES) {
    const page = await browser.newPage();
    // the background off (nothing drawn), and no saved shelf lists: the page reads its pictures fresh
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem("nm-wall-bg", "0"); localStorage.setItem("nm-seen-version", "9"); } catch (e) {} });
    await page.goto(SITE + path, { waitUntil: "networkidle0", timeout: 120000 });
    await page.waitForFunction(() => window.NMWall, { timeout: 60000 });
    const got = await page.evaluate(async () => {
      const W = window.NMWall, list = await W.items();
      const abs = (u) => new URL(u, location.href).href;
      return { key: W.key, home: W.home, max: W.max,
        items: list.map((p) => ({ src: abs(p.src), small: abs(W.thumb(p.src)), ratio: p.ratio || W.ratio, video: !!p.video })) };
    });
    out[got.key] = got;
    process.stderr.write(path + " " + got.items.length + " pictures\n");
    await page.close();
  }
  process.stdout.write(JSON.stringify(out));
  await browser.close();
})();
