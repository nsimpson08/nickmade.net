// Records the Cattery (play/cats/) for the home page's Play tile (make_play_clip.py crops and encodes it with the
// other games): the room's own canvas, exactly, frame by frame, while two rivals fight (lunges, then the brawl
// cloud). The page runs on a fake clock (requestAnimationFrame, performance.now and setTimeout are replaced), so
// every video frame is two steps of its 60 fps loop, however long a capture takes.
// It uses the room in the LOCAL Worker (npx wrangler dev on :8787), so that needs cats with rivals in it; one
// rival pair (the first one) is made to fight and the others aren't, so the tile can zoom in on it; the
// window shows daytime (the room's sky follows the clock: getHours/getMinutes say 12:30 PM); sound is off.
// Usage: node record_cattery.js <work folder> [frames] [event] [skip seconds] [name]   (needs puppeteer-core, the site on localhost:8000)
//   event: "storm" or "sunbeam" starts that room event first (through the local Worker, as Nick), with no landing fight;
//   skip: seconds of the room's life to run before recording (cats gathering in a sunbeam); name: the folder (default cattery-raw)
// Writes <work>/<name>/NNNN.png (the full room canvas).
const fs = require("fs"), path = require("path");
const puppeteer = require("puppeteer-core");
const OUT = path.join(process.argv[2] || "clip-work", process.argv[6] || "cattery-raw");
const FRAMES = +process.argv[3] || 300; // 10 s of fight; make_play_clip.py takes 4 s of it (CATTERY)
const EVENT = process.argv[4] && process.argv[4] !== "none" ? process.argv[4] : null, SKIP = +process.argv[5] || 0;
const TOKEN = (fs.readFileSync(path.join(__dirname, "../../worker/.dev.vars"), "utf8").match(/^ADMIN_TOKEN="?([^"\n]+)/m) || [])[1];
const event = (k) => fetch("http://localhost:8787/cats/event", { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ k }) });

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await event(EVENT || "stop");
  await page.evaluateOnNewDocument((noFight) => {
    let T = 0;
    const queue = [], timers = [];
    window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
    window.cancelAnimationFrame = () => {};
    performance.now = () => T;
    const realTimeout = window.setTimeout;
    window.__realTimeout = realTimeout;
    window.setTimeout = (cb, ms) => { timers.push({ at: T + (ms || 0), cb }); return timers.length; };
    window.__tick = (ms) => {
      T += ms;
      timers.filter((t) => t.at <= T).forEach((t) => { timers.splice(timers.indexOf(t), 1); t.cb(); });
      queue.splice(0).forEach((cb) => cb(T));
    };
    // one fight: the first of landingFights' 30% rolls passes, the rest fail; everything else stays random
    const r = Math.random;
    let rolls = 0;
    Math.random = () => (new Error().stack.includes("landingFights") ? (noFight || rolls++ ? 0.9 : 0.1) : r());
    // daytime in the window: only the hour the room reads is moved (the sky, the cats' bedtime), not the clock, so
    // room events and history times stay real
    Date.prototype.getHours = () => 12;
    Date.prototype.getMinutes = () => 30;
    try { localStorage.setItem("nm-cats-sound", "off"); localStorage.removeItem("nm-admin-token"); } catch (e) {}
  }, !!EVENT);
  await page.goto("http://localhost:8000/play/cats/", { waitUntil: "networkidle0" });
  for (let i = 0; i < 6; i++) await page.evaluate(() => window.__tick(1000 / 60)); // the room's first draw (the fights start when the room arrives)
  if (SKIP) await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__tick(1000 / 60); }, Math.round(SKIP * 60)); // let time pass
  for (let n = 0; n < FRAMES; n++) {
    const png = await page.evaluate(() => { window.__tick(1000 / 60); window.__tick(1000 / 60); return document.getElementById("room").toDataURL("image/png"); });
    fs.writeFileSync(path.join(OUT, String(n).padStart(4, "0") + ".png"), Buffer.from(png.split(",")[1], "base64"));
  }
  console.log(FRAMES + " frames");
  if (EVENT) await event("stop");
  await browser.close();
})();
