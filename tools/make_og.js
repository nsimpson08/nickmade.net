// Makes the link-preview images (Open Graph, 1200x630) in assets/og/: what iMessage, Discord, Slack and the like show
// when someone shares a nickmade.net link (1.7; Nick, 2026-10-22). Each one: the wordmark, the page's name and line
// in its section's color, and a picture of the page: the home page's tile frame for a section (assets/gifs/*.jpg),
// or a screenshot of the live page for the rest. Rerun after a tile or a page changes a lot:
//
//   NODE_PATH=<a folder with puppeteer-core> node tools/make_og.js            (all)
//   NODE_PATH=... node tools/make_og.js movies cats                           (just those)
//
// Needs Google Chrome. Screenshots come from https://nickmade.net (so they show real data); the cards are rendered
// in Chrome with the site's fonts and saved as JPEG.
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "assets", "og");
const SITE = "https://nickmade.net";
const C = { mint: "#7ee0b5", violet: "#a78bfa", amber: "#f5b451", pink: "#ff7eb6", sky: "#7cc4ff", coral: "#ff8a66", lime: "#c8f04f", fg: "#ecebe7" };

// name: [title, line, color, picture]  picture: "tile:<section>", "shot:<path>", "tiles" (home) or "" (words only)
const CARDS = {
  home: ["NickMade", "Games, movies, music, photography, and extras from Nick Simpson.", C.coral, "tiles"],
  games: ["Games", "Nick Simpson's favorite games, reviewed.", C.violet, "tile:games"],
  movies: ["Movies", "Nick Simpson's favorite movies, reviewed.", C.amber, "tile:movies"],
  library: ["Movie Library", "Every movie Nick owns on 4K, Blu\u2011ray, DVD, and VHS, shelved like a video store.", C.amber, "shot:/library/movies/"],
  music: ["Music", "What Nick Simpson is listening to.", C.pink, "tile:music"],
  photography: ["Photography", "Photography by Nick Simpson, in full resolution.", C.sky, "tile:photography"],
  play: ["Play", "Browser games by Nick Simpson. Free to play, nothing to install.", C.coral, "tile:play"],
  cats: ["The Cattery", "Make your own pixel-art cat and move it in with everyone else's.", C.coral, "shot:/play/cats/"],
  office: ["Nick's Office", "Look around Nick's office in pixel art. Most things lead somewhere.", C.coral, "shot:/play/office/"],
  extras: ["Extras", "Hobbies, projects, and lists from Nick Simpson.", C.mint, "tile:extras"],
  golf: ["Golf", "Nick's recent rounds on Trackman, X-Golf, and real courses.", C.mint, "shot:/extras/golf/"],
  golfweather: ["Golf weather", "The best times to play golf this week near any US ZIP code.", C.mint, "shot:/extras/golf-weather/"],
  scorecard: ["Scorecard", "A simple score tracker for real golf courses, even with no signal.", C.mint, "shot:/extras/scorecard/"],
  rapture: ["Rapture: ADAM & Dice", "A pixel-art strategy board game beneath the sea.", C.mint, "shot:/extras/rapture/"],
  changelog: ["Changelog", "What's new on NickMade: every version of the site and what changed.", C.fg, ""],
  wishlist: ["Wishlist", "Things Nick would love. Claim one so nobody doubles up.", C.lime, ""],
};

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500&family=Unbounded:wght@600;800&display=swap">';
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const dataUrl = (file) => "data:image/jpeg;base64," + fs.readFileSync(file).toString("base64");

function card(name, [title, line, color, pic], shot) {
  let picture = "";
  if (pic === "tiles") {
    picture = '<div class="tiles">' + ["games", "movies", "music", "photography", "play", "extras"]
      .map((s) => '<img src="' + dataUrl(path.join(ROOT, "assets/gifs", s + ".jpg")) + '">').join("") + "</div>";
  } else if (pic.startsWith("tile:")) picture = '<img class="frame" src="' + dataUrl(path.join(ROOT, "assets/gifs", pic.slice(5) + ".jpg")) + '">';
  else if (shot) picture = '<img class="frame" src="' + dataUrl(shot) + '">';
  const words = !picture;
  const url = name === "home" ? "nickmade.net" : "nickmade.net" + ({ cats: "/play/cats", office: "/play/office", library: "/library/movies", golf: "/extras/golf", golfweather: "/extras/golf-weather", scorecard: "/extras/scorecard", rapture: "/extras/rapture" }[name] || "/" + name);
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #000; color: #ecebe7; font-family: "Space Grotesk", sans-serif; position: relative;
    background: radial-gradient(70% 90% at ${words ? "50%" : "0%"} 0%, ${color}2e, transparent 70%), #000; }
  .text { position: absolute; left: 72px; top: 64px; bottom: 64px; width: ${words ? 1056 : 490}px; display: flex; flex-direction: column; }
  .mark { font-family: Unbounded; font-weight: 800; font-size: 34px; letter-spacing: -0.04em; }
  .mark span { color: ${color}; }
  h1 { margin-top: auto; font-family: Unbounded; font-weight: 800; font-size: ${title.length > 14 ? 58 : words ? 110 : 84}px; line-height: 1; letter-spacing: -0.045em; }
  h1 span { color: ${color}; }
  p { margin-top: 22px; font-size: ${words ? 34 : 29}px; line-height: 1.35; color: #b3b1ab; max-width: ${words ? 900 : 520}px; }
  .url { margin-top: 34px; font-size: 22px; color: #6b6964; letter-spacing: 0.02em; }
  .frame { position: absolute; right: 64px; top: 50%; transform: translateY(-50%); width: 520px; height: 292px; object-fit: cover; border-radius: 22px;
    border: 1px solid #2a2a2e; box-shadow: 0 30px 80px ${color}33; }
  .tiles { position: absolute; right: 64px; top: 50%; transform: translateY(-50%); display: grid; grid-template-columns: 250px 250px; gap: 14px; }
  .tiles img { width: 250px; height: 141px; object-fit: cover; border-radius: 14px; border: 1px solid #2a2a2e; }
  </style></head><body>
  <div class="text"><div class="mark">Nick<span>Made</span></div>
  ${name === "home" ? "" : `<h1>${esc(title)}<span>.</span></h1>`}${name === "home" ? `<h1>Nick<span>Made</span><span>.</span></h1>` : ""}
  <p>${esc(line)}</p><div class="url">${url}</div></div>${picture}</body></html>`;
}

(async () => {
  const want = process.argv.slice(2);
  const names = Object.keys(CARDS).filter((n) => !want.length || want.includes(n));
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "og-"));
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const page = await browser.newPage(); // live pages, for screenshots
  const cardPage = await browser.newPage(); // the cards
  for (const name of names) {
    const spec = CARDS[name];
    let shot = null;
    if (spec[3].startsWith("shot:")) {
      // the live page at 1040x585, shown at half size in the card (sharp), after it has drawn
      await page.setViewport({ width: 1040, height: 585, deviceScaleFactor: 1 });
      await page.goto(SITE + spec[3].slice(5), { waitUntil: "networkidle2", timeout: 45000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 4000));
      shot = path.join(tmp, name + ".jpg");
      await page.screenshot({ path: shot, type: "jpeg", quality: 92 });
    }
    await cardPage.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await cardPage.setContent(card(name, spec, shot), { waitUntil: "load" });
    // a long name shrinks until it fits beside the picture
    await cardPage.evaluate(async () => {
      await document.fonts.ready;
      const h = document.querySelector("h1"), box = document.querySelector(".text");
      let size = parseFloat(getComputedStyle(h).fontSize); // (a word wider than the space, like "Photography")
      while (h.scrollWidth > box.clientWidth && size > 40) { size -= 2; h.style.fontSize = size + "px"; }
    });
    const file = path.join(OUT, name + ".jpg");
    await cardPage.screenshot({ path: file, type: "jpeg", quality: 86 });
    console.log(name, Math.round(fs.statSync(file).size / 1024) + " KB");
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})();
