// Records Nick's Office (play/office/) for the home page's Play tile (make_play_clip.py adds the other games and
// encodes): the room's 320x200 canvas, exactly, frame by frame. The page runs on a fake clock (requestAnimationFrame
// and performance.now are replaced), so every video frame is two steps of its 60 fps loop, however long a capture takes.
// Things are clicked through its test hook, window.NMOffice: The Dude, the SNES, the cat, the VW bus say their lines,
// the room turns, the window takes it to night.
// Usage: node record_play.js <work folder>   (needs puppeteer-core, and the site on localhost:8000)
// Writes <work>/play-raw/NNNN.png (320x200).
const fs = require("fs"), path = require("path");
const puppeteer = require("puppeteer-core");
const OUT = path.join(process.argv[2] || "clip-work", "play-raw");
// [video frame, what happens]
const SCRIPT = [  // 3 seconds, the same as each of the other games get in the tile
  [0, "night:0"], [4, "hover:dude"], [6, "click:dude"],
  [28, "turn:1"], [31, "click:cat"],
  [50, "turn:2"], [51, "night:1"], [55, "click:snes"],
  [72, "turn:3"], [74, "click:vw"],
];
const FRAMES = 90;

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    let T = 0;
    const queue = [];
    window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
    window.cancelAnimationFrame = () => {};
    performance.now = () => T;
    window.__tick = (ms) => { T += ms; queue.splice(0).forEach((cb) => cb(T)); };
    try { localStorage.setItem("nm-office-sound", "0"); } catch (e) {}
  });
  await page.goto("http://localhost:8000/play/office/", { waitUntil: "networkidle0" });
  await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__tick(1000 / 60); }); // settle
  for (let n = 0; n < FRAMES; n++) {
    for (const [at, what] of SCRIPT) {
      if (at !== n) continue;
      const [verb, arg] = what.split(":");
      await page.evaluate((verb, arg) => {
        const o = window.NMOffice;
        if (verb === "hover") o.hover(arg);
        if (verb === "click") { o.click(arg); const c = document.querySelector(".office-card"); if (c) c.hidden = true; }
        if (verb === "turn") o.turn(+arg);
        if (verb === "night") o.night(arg === "1");
      }, verb, arg);
    }
    const png = await page.evaluate(() => { window.__tick(1000 / 60); window.__tick(1000 / 60); return document.getElementById("office").toDataURL("image/png"); });
    fs.writeFileSync(path.join(OUT, String(n).padStart(4, "0") + ".png"), Buffer.from(png.split(",")[1], "base64"));
  }
  console.log(FRAMES + " frames");
  await browser.close();
})();
