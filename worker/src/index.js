// nickmade-queue: the live sections of the Movies and Games pages: visitor suggestions for "In the Queue",
// Nick's "Recently Watched"/"Recently Played" lists, and Nick's site-added picks for other sections.
// The queue and watched routes take a page (?page= or "page" in the body): movies (default) or games.
//
//   GET    /search?q=title      title autocomplete (IMDb suggestions); &kind=game searches video games instead of movies
//   GET    /queue               visitor submissions + whether the queue is open + this visitor's remaining count
//   POST   /queue               { imdbId, name, visitorId } -> adds a movie
//                               with Authorization: Bearer ADMIN_TOKEN it's Nick's own pick:
//                               no name, no per-visitor limit, allowed past the cap
//   GET    /admin/check         200 if the Authorization token is the admin token
//   DELETE /queue/:imdbId       remove a submission (needs Authorization: Bearer ADMIN_TOKEN)
//   GET    /watched             Recently Watched, newest first
//   POST   /watched             { imdbId, date: "YYYY-MM-DD", rating: 0.5-5 in halves, optional } (admin) -> adds a movie; also drops it from the queue
//   PATCH  /watched/:id         { rating, date } (admin) -> change the rating and/or date watched
//   DELETE /watched/:id         remove one (admin)
//   GET    /lists?page=movies   Nick's site-added picks for each live section of a page: { lists: { <key>: [items] } }
//   POST   /lists               { page, list, imdbId } (admin) -> adds a movie/game to that section
//   DELETE /lists/:page/:list/:imdbId  remove one (admin)
//   GET    /xbox/recent         (admin) your most recently played Xbox games via OpenXBL, with playtime and achievements
//   POST   /xbox/import         { games: [{ titleId, date }] } (admin) -> logs them in Games' Recently Played
//   POST   /xbox/sync           (admin) run the nightly Recently Played refresh now (see scheduled() below)
//                               (or refreshes their Xbox stats if already there), poster from PosterSpy or the Xbox store
//   GET    /spotify/top?playlist=<id>  the first song on a public Spotify playlist (home page "Lately" strip)
//   GET    /spotify/now         what Nick is playing on Spotify now, or his last played song (home "Lately" strip)
//   GET    /spotify/recent      his last 10 songs (now playing first, marked live) for the Music page
//   POST   /spotify/auth-url    (admin) a Spotify sign-in link for connecting his account (tools/spotify_connect.py)
//   GET    /spotify/callback    where Spotify sends him back after he agrees; saves the refresh token
//   GET    /img?u=url           image proxy for posters (allowlisted hosts only)
//
// Storage: one KV namespace (QUEUE). Keys (Movies keeps the original unprefixed names):
//   queue / queue:games            JSON array of queue submissions
//   watched / watched:games        JSON array of Recently Watched / Recently Played
//   lists:<page>                   JSON object { <section key>: [items] } for the other live sections
//   visitor:<hash> / visitor:games:<hash>  number of queue submissions from that visitor (browser id or hashed IP)
//   spotify:refresh / spotify:access / spotify:now / spotify:state:<x>  Spotify login and a 1-minute cache
//   xbox:recent                    10-minute cache of /xbox/recent (OpenXBL allows 150 requests/hour, shared with the Montage app)

const PER_VISITOR = 3;
const MOVIE_TYPES = new Set(["movie", "tvMovie", "video"]);
const GAME_TYPES = new Set(["videoGame"]);
const PAGES = { movies: "movie", games: "game" }; // page -> kind of title it lists

function pageOf(p) {
  return PAGES[p] ? p : "movies";
}
function queueKey(page) {
  return page === "movies" ? "queue" : "queue:" + page;
}
function watchedKey(page) {
  return page === "movies" ? "watched" : "watched:" + page;
}
const IMG_HOSTS = ["m.media-amazon.com", "alternativemovieposters.com", "store-images.s-microsoft.com", "media.posterspy.com"];
const XBOX_RECENT = 30; // how many recent Xbox games /xbox/recent lists
const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fag", "retard", "bitch", "whore", "slut", "nazi", "rape", "porn", "dick", "cock", "pussy"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/search" && request.method === "GET") return await search(url, cors, ctx);
      if (url.pathname === "/xbox/recent" && request.method === "GET") return await xboxRecent(request, env, cors);
      if (url.pathname === "/xbox/import" && request.method === "POST") return await xboxImport(request, env, cors);
      if (url.pathname === "/xbox/sync" && request.method === "POST") {
        if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
        try { return json(await syncRecentlyPlayed(env), 200, cors); } catch (e) {
          if (e instanceof XblError) return json({ error: e.message }, 502, cors);
          throw e;
        }
      }
      if (url.pathname === "/lists" && request.method === "GET") return await getLists(url, env, cors);
      if (url.pathname === "/lists" && request.method === "POST") return await addToList(request, env, cors);
      if (url.pathname.startsWith("/lists/") && request.method === "DELETE") return await removeFromList(request, url, env, cors);
      if (url.pathname === "/img" && request.method === "GET") return await image(url, ctx);
      if (url.pathname === "/spotify/now" && request.method === "GET") return await spotifyNow(env, cors);
      if (url.pathname === "/spotify/recent" && request.method === "GET") return await spotifyRecent(env, cors);
      if (url.pathname === "/spotify/auth-url" && request.method === "POST") return await spotifyAuthUrl(request, url, env, cors);
      if (url.pathname === "/spotify/callback" && request.method === "GET") return await spotifyCallback(url, env);
      if (url.pathname === "/spotify/top" && request.method === "GET") return await spotifyTop(url, cors);
      if (url.pathname === "/queue" && request.method === "GET") return await listQueue(request, url, env, cors);
      if (url.pathname === "/queue" && request.method === "POST") return await addToQueue(request, env, cors);
      if (url.pathname === "/admin/check" && request.method === "GET") {
        return isAdmin(request, env) ? json({ ok: true }, 200, cors) : json({ error: "Wrong password." }, 401, cors);
      }
      if (url.pathname.startsWith("/queue/") && request.method === "DELETE") return await removeFromQueue(request, url, env, cors);
      if (url.pathname === "/watched" && request.method === "GET") {
        return json({ items: sortWatched(await getList(env, watchedKey(pageOf(url.searchParams.get("page"))))) }, 200, cors);
      }
      if (url.pathname === "/watched" && request.method === "POST") return await addWatched(request, env, cors);
      if (url.pathname.startsWith("/watched/") && request.method === "PATCH") return await editWatched(request, url, env, cors);
      if (url.pathname.startsWith("/watched/") && request.method === "DELETE") return await removeWatched(request, url, env, cors);
      return json({ error: "Not found" }, 404, cors);
    } catch (err) {
      return json({ error: "Something went wrong. Try again in a bit." }, 500, cors);
    }
  },

  // Cron triggers (wrangler.toml) fire at 05:00 and 06:00 UTC; only the one that lands on midnight in
  // TIMEZONE (America/Chicago: 05:00 in daylight time, 06:00 in standard time) does the work.
  async scheduled(event, env, ctx) {
    if (hourIn(env.TIMEZONE, new Date(event.scheduledTime)) !== 0) return;
    ctx.waitUntil(syncRecentlyPlayed(env).catch((e) => console.log("nightly Xbox sync failed:", e.message)));
  },
};

// ---------- helpers ----------

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
  });
}

function isAdmin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/, "");
  return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// Two identities per visitor: the random id their browser keeps, and their IP (hashed, never stored raw).
// Each page has its own 3-per-visitor allowance.
async function visitorKeys(request, visitorId, env, page) {
  const salt = env.SALT || "nickmade";
  const prefix = page === "movies" ? "visitor:" : "visitor:" + page + ":";
  const keys = [];
  if (visitorId && /^[a-z0-9-]{8,64}$/i.test(visitorId)) keys.push(prefix + (await sha256(salt + "id:" + visitorId)));
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) keys.push(prefix + (await sha256(salt + "ip:" + ip)));
  return keys;
}

async function usedBy(keys, env) {
  let used = 0;
  for (const k of keys) used = Math.max(used, parseInt(await env.QUEUE.get(k), 10) || 0);
  return used;
}

async function getList(env, key) {
  try { return JSON.parse((await env.QUEUE.get(key)) || "[]"); } catch (e) { return []; }
}

function getQueue(env, page) {
  return getList(env, queueKey(page));
}

function normalize(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

// Your own "In the Queue" titles, read from the live site's list.js so the cap stays right when you edit it.
async function ownerQueueTitles(env, page) {
  try {
    const res = await fetch(env.SITE_URL.replace(/\/$/, "") + "/" + page + "/list.js", { cf: { cacheTtl: 300 } });
    const text = await res.text();
    let start = text.indexOf('live: "queue"');
    if (start < 0) start = text.indexOf('title: "In the Queue"');
    if (start < 0) throw new Error("no queue section");
    const open = text.indexOf("items: [", start);
    if (open < 0) throw new Error("no items");
    if (text[open + 8] === "]") return []; // items: []
    const end = text.indexOf("\n    ]", open);
    const section = text.slice(open, end > 0 ? end : undefined);
    return [...section.matchAll(/\{\s*title:\s*"([^"]+)"/g)].map((m) => m[1]);
  } catch (e) {
    return null;
  }
}

async function queueState(env, page) {
  const limit = parseInt(env.QUEUE_LIMIT, 10) || 10;
  const owner = await ownerQueueTitles(env, page);
  const ownerCount = owner ? owner.length : page === "movies" ? parseInt(env.OWNER_QUEUE_FALLBACK, 10) || 0 : 0;
  const items = await getQueue(env, page);
  return { limit, owner: owner || [], items, open: ownerCount + items.length < limit, remaining: Math.max(0, limit - ownerCount - items.length) };
}

// ---------- routes ----------

async function search(url, cors, ctx) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  if (q.length < 2) return json({ results: [] }, 200, cors);
  const res = await fetch("https://v3.sg.media-imdb.com/suggestion/x/" + encodeURIComponent(q.toLowerCase()) + ".json", {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  const data = await res.json();
  const types = url.searchParams.get("kind") === "game" ? GAME_TYPES : MOVIE_TYPES;
  const results = (data.d || [])
    .filter((r) => /^tt\d+$/.test(r.id) && types.has(r.qid))
    .slice(0, 8)
    .map((r) => ({ id: r.id, title: r.l, year: r.y || null, stars: r.s || "", image: r.i ? r.i.imageUrl : null }));
  return json({ results }, 200, cors);
}

async function image(url, ctx) {
  const u = url.searchParams.get("u") || "";
  let target;
  try { target = new URL(u); } catch (e) { return new Response("Bad url", { status: 400 }); }
  if (target.protocol !== "https:" || !IMG_HOSTS.includes(target.hostname)) return new Response("Not allowed", { status: 403 });
  const res = await fetch(target.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 (nickmade.net queue)" },
    cf: { cacheTtl: 86400 * 30, cacheEverything: true },
  });
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=2592000",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function listQueue(request, url, env, cors) {
  const page = pageOf(url.searchParams.get("page"));
  const state = await queueState(env, page);
  const keys = await visitorKeys(request, url.searchParams.get("visitorId"), env, page);
  const used = await usedBy(keys, env);
  return json({
    items: state.items.map(publicItem),
    open: state.open,
    remaining: state.remaining,
    yourRemaining: Math.max(0, PER_VISITOR - used),
    perVisitor: PER_VISITOR,
  }, 200, cors);
}

function publicItem(it) {
  return { imdbId: it.imdbId, title: it.title, year: it.year, image: it.image, credit: it.credit, suggestedBy: it.suggestedBy || null, owner: !!it.owner };
}

async function addToQueue(request, env, cors) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400, cors); }
  const imdbId = String(body.imdbId || "");
  const name = String(body.name || "").replace(/\s+/g, " ").trim();
  const owner = isAdmin(request, env);
  const page = pageOf(body.page);
  const noun = PAGES[page];

  if (!/^tt\d{5,10}$/.test(imdbId)) return json({ error: "Pick a " + noun + " from the list." }, 400, cors);
  let keys = [];
  let used = 0;
  if (!owner) {
    if (name.length < 1 || name.length > 40) return json({ error: "Add your name (up to 40 characters)." }, 400, cors);
    const lowered = normalize(name).replace(/ /g, "");
    if (BLOCKED.some((w) => lowered.includes(w))) return json({ error: "Please use a different name." }, 400, cors);
    keys = await visitorKeys(request, body.visitorId, env, page);
    used = await usedBy(keys, env);
    if (used >= PER_VISITOR) return json({ error: "You've already added " + PER_VISITOR + " " + noun + "s. Thanks!" }, 429, cors);
  }

  const state = await queueState(env, page);
  if (!state.open && !owner) return json({ error: "Not taking submissions at this time." }, 409, cors);
  if (state.items.some((it) => it.imdbId === imdbId)) return json({ error: "That one's already in the queue." }, 409, cors);

  const movie = await lookupMovie(imdbId, noun);
  if (!movie) return json({ error: "Couldn't find that " + noun + "." }, 404, cors);
  if (state.owner.some((t) => normalize(t) === normalize(movie.title))) return json({ error: "That one's already in the queue." }, 409, cors);

  const item = { ...movie, suggestedBy: owner ? null : name, owner, createdAt: new Date().toISOString() };

  // Re-read right before writing to keep the cap honest if two people submit at once
  const latest = await queueState(env, page);
  if (!latest.open && !owner) return json({ error: "Not taking submissions at this time." }, 409, cors);
  latest.items.push(item);
  await env.QUEUE.put(queueKey(page), JSON.stringify(latest.items));
  for (const k of keys) await env.QUEUE.put(k, String(used + 1));

  return json({
    item: publicItem(item),
    open: latest.remaining - 1 > 0,
    remaining: Math.max(0, latest.remaining - 1),
    yourRemaining: owner ? PER_VISITOR : Math.max(0, PER_VISITOR - used - 1),
  }, 201, cors);
}

// Look the title up by id so the title/year/poster come from IMDb, not the browser.
// Poster: alternative art if AMP (movies only) or PosterSpy has it; otherwise the official IMDb poster/box art.
async function lookupMovie(imdbId, kind) {
  const res = await fetch("https://v3.sg.media-imdb.com/suggestion/x/" + imdbId + ".json");
  const data = await res.json();
  const movie = (data.d || []).find((r) => r.id === imdbId);
  if (!movie || !(kind === "game" ? GAME_TYPES : MOVIE_TYPES).has(movie.qid)) return null;
  const art = (kind === "game" ? null : await findAlternativeArt(movie.l, movie.y)) || await findPosterSpyArt(movie.l);
  return {
    imdbId,
    title: movie.l,
    year: movie.y || null,
    image: art ? art.image : movie.i ? movie.i.imageUrl : null,
    credit: art ? { artist: art.artist, url: art.url } : { label: "Official poster", artist: "" },
  };
}

// Search alternativemovieposters.com for "<Title> by <Artist>" and use the first exact title match.
async function findAlternativeArt(title, year) {
  try {
    const res = await fetch("https://alternativemovieposters.com/?s=" + encodeURIComponent(title), {
      headers: { "User-Agent": "Mozilla/5.0 (nickmade.net queue)" },
    });
    const html = await res.text();
    const want = normalize(title);
    const seen = new Set();
    for (const m of html.matchAll(/href="(https:\/\/alternativemovieposters\.com\/amp\/[^"]+)"[^>]*>([^<]+?) by ([^<]+)</g)) {
      const [, link, t, artist] = m;
      if (seen.has(link)) continue;
      seen.add(link);
      const got = normalize(decode(t));
      if (got !== want && !got.startsWith(want + " ")) continue;
      // Skip sequels that merely start with the same words (e.g. "Blade Runner 2049" for "Blade Runner")
      if (got !== want && /^\d/.test(got.slice(want.length + 1))) continue;
      const page = await (await fetch(link, { headers: { "User-Agent": "Mozilla/5.0 (nickmade.net queue)" } })).text();
      const img = (page.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
      if (img && /\.(jpe?g|png)$/i.test(img)) return { image: img, artist: decode(artist).trim(), url: link };
    }
  } catch (e) {}
  return null;
}

// Search PosterSpy (fan posters for movies and games) and use the first portrait poster whose title is exactly this one.
// Artists title their own uploads ("ELDEN RING (2022) – Video Game Poster Design", "Alien (1979) Homage Poster"),
// so their "(year)", anything after a dash, "by <artist>", "#2" and filler words are dropped, and roman numerals read
// as numbers. What's left must equal the title, so "Alien Earth" isn't used for Alien, nor a plain "Gears of War"
// poster for "Gears of War: E-Day". Titles like "Gta 6 Tribute" are missed; that's the price of not guessing.
const POSTERSPY_FILLER = /\b(alternative|alternate|alt|official|tribute|homage|fan ?art|fanart|fan ?made|poster|posters|artwork|art|cover|design|variant|version|print|minimalist|minimal|illustration|concept|redesign|movie|film|video ?game|game)\b/g;
const ROMAN = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

function plainTitle(s) {
  return normalize(s).replace(/\b[ivx]+\b/g, (r) => ROMAN[r] || r);
}
// A PosterSpy upload's title as is, and without the filler words (only ever stripped from their side,
// so a real title like "The Game" still has to match in full)
function posterTitles(s) {
  const raw = s.replace(/\(\s*(19|20)\d\d\s*\)|#\s*\d+/g, " ");
  const clean = (x) => plainTitle(x).replace(/ (dir )?by .*$/, "");
  const t = clean(raw.split(/\s[–—|-]\s/)[0]);
  return [clean(raw), t, t.replace(POSTERSPY_FILLER, " ").replace(/\s+/g, " ").trim()];
}

async function findPosterSpyArt(title) {
  try {
    const res = await fetch("https://posterspy.com/?s=" + encodeURIComponent(title), {
      headers: { "User-Agent": "Mozilla/5.0 (nickmade.net queue)" },
    });
    const html = await res.text();
    const want = plainTitle(title);
    if (!want) return null;
    for (const card of html.split('class="wpps-poster-card').slice(1)) {
      const link = (card.match(/href="(https:\/\/posterspy\.com\/posters\/[^"]+)"/) || [])[1];
      const thumb = card.match(/<img src="(https:\/\/media\.posterspy\.com\/[^"]+)" width="(\d+)" height="(\d+)"/);
      const name = (card.match(/class="imagetitle">([^<]+)</) || [])[1];
      const artist = (card.match(/href="https:\/\/posterspy\.com\/profile\/[^"]+">([^<]+)</) || [])[1];
      if (!link || !thumb || !name || !artist) continue;
      if (!posterTitles(decode(name)).includes(want)) continue;
      const ratio = thumb[3] / thumb[2];
      if (ratio < 1.25 || ratio > 1.75) continue; // portrait (about 2:3) only
      const image = thumb[1].replace(/-\d+x\d+(\.\w+)$/, "$1"); // full size instead of the 480px thumbnail
      if (!/\.(jpe?g|png)$/i.test(image)) continue;
      return { image, artist: decode(artist).trim(), url: link };
    }
  } catch (e) {}
  return null;
}

function decode(s) {
  return s
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function removeFromQueue(request, url, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  const id = decodeURIComponent(url.pathname.split("/")[2] || "");
  const page = pageOf(url.searchParams.get("page"));
  const items = await getQueue(env, page);
  const kept = items.filter((it) => it.imdbId !== id);
  await env.QUEUE.put(queueKey(page), JSON.stringify(kept));
  return json({ removed: items.length - kept.length }, 200, cors);
}

// ---------- Recently Watched (owner only) ----------

function sortWatched(items) {
  return items.slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}

async function addWatched(request, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400, cors); }
  const imdbId = String(body.imdbId || "");
  const date = String(body.date || "");
  const page = pageOf(body.page);
  const noun = PAGES[page];
  if (!/^tt\d{5,10}$/.test(imdbId)) return json({ error: "Pick a " + noun + " from the list." }, 400, cors);
  const bad = checkWatched(date, body.rating);
  if (bad) return json({ error: bad }, 400, cors);
  const rating = toRating(body.rating);

  const movie = await lookupMovie(imdbId, noun);
  if (!movie) return json({ error: "Couldn't find that " + noun + "." }, 404, cors);
  const item = { ...movie, id: imdbId + "-" + date, date, rating, createdAt: new Date().toISOString() };

  const items = (await getList(env, watchedKey(page))).filter((it) => it.id !== item.id);
  items.push(item);
  await env.QUEUE.put(watchedKey(page), JSON.stringify(items));

  // Watching/playing something from the queue takes it out of the queue
  const queue = await getQueue(env, page);
  const kept = queue.filter((it) => it.imdbId !== imdbId);
  if (kept.length !== queue.length) await env.QUEUE.put(queueKey(page), JSON.stringify(kept));

  return json({ item, removedFromQueue: kept.length !== queue.length }, 201, cors);
}

function toRating(r) {
  return r == null || r === 0 ? null : Number(r);
}

function checkWatched(date, r) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return "Pick a date.";
  const rating = toRating(r);
  if (rating !== null && !(Number.isInteger(rating * 2) && rating >= 0.5 && rating <= 5)) return "Ratings go from half a star to 5 stars.";
  return null;
}

async function editWatched(request, url, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400, cors); }
  const id = decodeURIComponent(url.pathname.split("/")[2] || "");
  const page = pageOf(url.searchParams.get("page"));
  const items = await getList(env, watchedKey(page));
  const item = items.find((it) => it.id === id);
  if (!item) return json({ error: "Couldn't find that one. Try reloading." }, 404, cors);
  const date = body.date == null ? item.date : String(body.date);
  const bad = checkWatched(date, body.rating);
  if (bad) return json({ error: bad }, 400, cors);

  item.rating = toRating(body.rating);
  item.date = date;
  item.id = item.imdbId + "-" + date;
  // A new date could collide with another viewing of the same movie; keep the edited one
  const kept = items.filter((it) => it === item || it.id !== item.id);
  await env.QUEUE.put(watchedKey(page), JSON.stringify(kept));
  return json({ item }, 200, cors);
}

async function removeWatched(request, url, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  const id = decodeURIComponent(url.pathname.split("/")[2] || "");
  const page = pageOf(url.searchParams.get("page"));
  const items = await getList(env, watchedKey(page));
  const kept = items.filter((it) => it.id !== id);
  await env.QUEUE.put(watchedKey(page), JSON.stringify(kept));
  return json({ removed: items.length - kept.length }, 200, cors);
}

// ---------- Live sections on Movies/Games (owner only) ----------

async function readLists(env, page) {
  try { return JSON.parse((await env.QUEUE.get("lists:" + page)) || "{}"); } catch (e) { return {}; }
}

async function getLists(url, env, cors) {
  const page = url.searchParams.get("page") || "";
  if (!PAGES[page]) return json({ error: "Unknown page." }, 400, cors);
  return json({ lists: await readLists(env, page) }, 200, cors);
}

async function addToList(request, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400, cors); }
  const page = String(body.page || "");
  const key = String(body.list || "");
  const imdbId = String(body.imdbId || "");
  if (!PAGES[page] || !/^[a-z0-9-]{1,40}$/.test(key)) return json({ error: "Unknown section." }, 400, cors);
  if (!/^tt\d{5,10}$/.test(imdbId)) return json({ error: "Pick one from the list." }, 400, cors);

  const lists = await readLists(env, page);
  if ((lists[key] || []).some((it) => it.imdbId === imdbId)) return json({ error: "That one's already in this section." }, 409, cors);
  const found = await lookupMovie(imdbId, PAGES[page]);
  if (!found) return json({ error: "Couldn't find that one." }, 404, cors);
  const item = { ...found, createdAt: new Date().toISOString() };

  const latest = await readLists(env, page); // re-read after the slow poster lookup
  latest[key] = (latest[key] || []).filter((it) => it.imdbId !== imdbId).concat(item);
  await env.QUEUE.put("lists:" + page, JSON.stringify(latest));
  return json({ item }, 201, cors);
}

async function removeFromList(request, url, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  const [, , page, key, id] = url.pathname.split("/").map(decodeURIComponent);
  if (!PAGES[page]) return json({ error: "Unknown page." }, 400, cors);
  const lists = await readLists(env, page);
  const before = (lists[key] || []).length;
  lists[key] = (lists[key] || []).filter((it) => it.imdbId !== id);
  if (!lists[key].length) delete lists[key];
  await env.QUEUE.put("lists:" + page, JSON.stringify(lists));
  return json({ removed: before - (lists[key] || []).length }, 200, cors);
}

// ---------- Xbox (OpenXBL), owner only ----------

class XblError extends Error {}

async function xbl(env, path, body) {
  if (!env.OPENXBL_API_KEY) throw new XblError("OPENXBL_API_KEY isn't set on the Worker.");
  const res = await fetch("https://xbl.io/api/v2" + path, {
    method: body ? "POST" : "GET",
    headers: { "X-Authorization": env.OPENXBL_API_KEY, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) throw new XblError("Xbox lookup limit reached for this hour. Try again later.");
  if (res.status === 401 || res.status === 403) throw new XblError("OpenXBL rejected the API key.");
  if (!res.ok) throw new XblError("Xbox Live didn't answer (" + res.status + "). Try again in a bit.");
  const data = await res.json();
  return data.content || data;
}

function cleanTitle(name) {
  return String(name || "").replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

// Your latest Xbox games: title history (newest first) plus MinutesPlayed for each, in 2 OpenXBL requests
async function recentXboxGames(env) {
  const cached = await env.QUEUE.get("xbox:recent", "json");
  if (cached) return cached;
  const history = await xbl(env, "/titles");
  const games = (history.titles || [])
    .filter((t) => t.type === "Game" && t.titleHistory && t.titleHistory.lastTimePlayed)
    .slice(0, XBOX_RECENT)
    .map((t) => ({
      titleId: String(t.titleId),
      name: cleanTitle(t.name),
      lastPlayed: t.titleHistory.lastTimePlayed,
      percent: t.achievement ? t.achievement.progressPercentage : null,
      gamerscore: t.achievement ? t.achievement.currentGamerscore : null,
      totalGamerscore: t.achievement ? t.achievement.totalGamerscore : null,
      image: t.displayImage ? t.displayImage.replace(/^http:/, "https:") : null,
      minutes: null,
    }));
  if (games.length) {
    try {
      const stats = await xbl(env, "/player/stats", {
        xuids: [String(history.xuid)],
        stats: games.map((g) => ({ name: "MinutesPlayed", titleId: g.titleId })),
      });
      const minutes = {};
      for (const list of stats.statlistscollection || []) {
        for (const st of list.stats || []) if (st.value != null) minutes[String(st.titleid)] = parseInt(st.value, 10);
      }
      games.forEach((g) => { if (minutes[g.titleId] >= 0) g.minutes = minutes[g.titleId]; });
    } catch (e) { /* playtime is a nice-to-have */ }
  }
  await env.QUEUE.put("xbox:recent", JSON.stringify(games), { expirationTtl: 600 });
  return games;
}

async function xboxRecent(request, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  try {
    return json({ games: await recentXboxGames(env) }, 200, cors);
  } catch (e) {
    if (e instanceof XblError) return json({ error: e.message }, 502, cors);
    throw e;
  }
}

// A plausible release date: the store uses placeholders like 9998-12-30 for some titles
function realDate(iso) {
  const d = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const year = parseInt(d.slice(0, 4), 10);
  return year >= 1970 && year <= new Date().getFullYear() + 1 ? d : null;
}

// The Xbox store's portrait "Poster" art (2:3) and release date ("YYYY-MM-DD", or "YYYY" from the IMDb fallback)
async function xboxStoreInfo(env, titleId, name) {
  let image = null;
  let released = null;
  try {
    const data = await xbl(env, "/marketplace/title/" + titleId);
    const product = (data.Products || [])[0];
    if (product) {
      const images = ((product.LocalizedProperties || [])[0] || {}).Images || [];
      const pick = images.find((i) => i.ImagePurpose === "Poster") || images.find((i) => i.ImagePurpose === "BoxArt");
      image = pick ? "https:" + pick.Uri.replace(/^https?:/, "") : null;
      released = realDate(((product.MarketProperties || [])[0] || {}).OriginalReleaseDate);
      if (!released) {
        // Fallback 1, same response: pre-order release dates (early access editions come first, so take the latest)
        const dates = [...JSON.stringify(product.DisplaySkuAvailabilities || []).matchAll(/"PreOrderReleaseDate":"([^"]+)"/g)]
          .map((m) => realDate(m[1])).filter(Boolean).sort();
        released = dates.length ? dates[dates.length - 1] : null;
      }
    }
  } catch (e) { /* poster and date are best-effort */ }
  if (!released && name) released = await imdbGameYear(name); // fallback 2: IMDb (no OpenXBL request used)
  return { image, released };
}

// Release year of a video game on IMDb with exactly this title, as "YYYY"
async function imdbGameYear(name) {
  try {
    const res = await fetch("https://v3.sg.media-imdb.com/suggestion/x/" + encodeURIComponent(name.toLowerCase().slice(0, 60)) + ".json");
    const data = await res.json();
    const hit = (data.d || []).find((r) => GAME_TYPES.has(r.qid) && normalize(r.l) === normalize(name) && r.y);
    return hit ? String(hit.y) : null;
  } catch (e) {
    return null;
  }
}

async function xboxImport(request, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400, cors); }
  const picks = (body.games || []).filter((g) => /^\d{1,12}$/.test(String(g.titleId)) && /^\d{4}-\d{2}-\d{2}$/.test(String(g.date))).slice(0, 30);
  if (!picks.length) return json({ error: "Pick at least one game." }, 400, cors);

  let recent;
  try { recent = await recentXboxGames(env); } catch (e) {
    if (e instanceof XblError) return json({ error: e.message }, 502, cors);
    throw e;
  }
  const items = await getList(env, watchedKey("games"));
  let added = 0;
  let updated = 0;
  const importedTitles = [];
  for (const pick of picks) {
    const g = recent.find((r) => r.titleId === String(pick.titleId));
    if (!g) continue;
    const xbox = { titleId: g.titleId, minutes: g.minutes, percent: g.percent, gamerscore: g.gamerscore, totalGamerscore: g.totalGamerscore, lastPlayed: g.lastPlayed };
    const existing = items.find((it) => it.xbox && it.xbox.titleId === g.titleId);
    if (existing) {
      existing.xbox = xbox; // refresh the stats and move it to the latest play date; keep poster and rating
      existing.date = pick.date;
      existing.id = existing.imdbId + "-" + pick.date;
      if (!existing.released) { // added before release dates were kept
        const store = await xboxStoreInfo(env, g.titleId, g.name);
        existing.released = store.released;
        existing.year = store.released ? parseInt(store.released.slice(0, 4), 10) : existing.year;
      }
      updated++;
      continue;
    }
    const store = await xboxStoreInfo(env, g.titleId, g.name);
    const art = await findPosterSpyArt(g.name); // fan art first, else the store's poster
    items.push({
      imdbId: "xbl" + g.titleId,
      title: g.name,
      year: store.released ? parseInt(store.released.slice(0, 4), 10) : null,
      released: store.released,
      image: art ? art.image : store.image || g.image,
      credit: art ? { artist: art.artist, url: art.url } : { label: "Official poster", artist: "" },
      id: "xbl" + g.titleId + "-" + pick.date,
      date: pick.date,
      rating: null,
      xbox,
      createdAt: new Date().toISOString(),
    });
    importedTitles.push(g.name);
    added++;
  }
  await env.QUEUE.put(watchedKey("games"), JSON.stringify(items));

  // Playing something from the queue takes it out of the queue (matched by title, since queue games come from IMDb)
  const queue = await getQueue(env, "games");
  const kept = queue.filter((it) => !importedTitles.some((t) => normalize(t) === normalize(it.title)));
  if (kept.length !== queue.length) await env.QUEUE.put(queueKey("games"), JSON.stringify(kept));

  return json({ added, updated }, 200, cors);
}

// ---------- Nightly refresh of Games' Recently Played (owner's Xbox data) ----------

function hourIn(tz, date) {
  return parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(date), 10);
}

// "YYYY-MM-DD" for an ISO timestamp, in TIMEZONE (so a 11pm session counts for that evening's date)
function dateIn(tz, iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// For every game already in Recently Played, pull its latest played date, achievements, and playtime
// from Xbox (2 OpenXBL requests total, however many games). Games logged by hand get linked to Xbox
// the first time their title exactly matches one in the Xbox history. Ratings and posters are kept.
async function syncRecentlyPlayed(env) {
  const key = watchedKey("games");
  const items = await getList(env, key);
  if (!items.length) return { checked: 0, updated: 0 };

  const history = await xbl(env, "/titles");
  const titles = (history.titles || []).filter((t) => t.type === "Game");
  const byId = new Map(titles.map((t) => [String(t.titleId), t]));
  const byName = new Map(titles.map((t) => [normalize(cleanTitle(t.name)), t]));
  const matched = [];
  for (const it of items) {
    const t = it.xbox ? byId.get(it.xbox.titleId) : byName.get(normalize(it.title));
    if (t && t.titleHistory && t.titleHistory.lastTimePlayed) matched.push([it, t]);
  }
  if (!matched.length) return { checked: items.length, updated: 0 };

  const minutes = {};
  try {
    const stats = await xbl(env, "/player/stats", {
      xuids: [String(history.xuid)],
      stats: matched.map(([, t]) => ({ name: "MinutesPlayed", titleId: String(t.titleId) })),
    });
    for (const list of stats.statlistscollection || []) {
      for (const st of list.stats || []) if (st.value != null) minutes[String(st.titleid)] = parseInt(st.value, 10);
    }
  } catch (e) { /* keep the last known playtime */ }

  let updated = 0;
  for (const [it, t] of matched) {
    const id = String(t.titleId);
    const a = t.achievement || {};
    const xbox = {
      titleId: id,
      minutes: minutes[id] >= 0 ? minutes[id] : it.xbox ? it.xbox.minutes : null,
      percent: a.progressPercentage != null ? a.progressPercentage : null,
      gamerscore: a.currentGamerscore != null ? a.currentGamerscore : null,
      totalGamerscore: a.totalGamerscore != null ? a.totalGamerscore : null,
      lastPlayed: t.titleHistory.lastTimePlayed,
    };
    const date = dateIn(env.TIMEZONE, xbox.lastPlayed);
    if (JSON.stringify(xbox) === JSON.stringify(it.xbox) && date === it.date) continue;
    it.xbox = xbox;
    it.date = date;
    it.id = it.imdbId + "-" + date;
    updated++;
  }
  // Two entries can't share an id (same game and date); keep the first
  const seen = new Set();
  const kept = items.filter((it) => (seen.has(it.id) ? false : seen.add(it.id)));
  if (updated || kept.length !== items.length) await env.QUEUE.put(key, JSON.stringify(kept));
  const result = { checked: items.length, linked: matched.length, updated, at: new Date().toISOString() };
  await env.QUEUE.put("xbox:lastSync", JSON.stringify(result));
  return result;
}

// ---------- Spotify: top song of a public playlist ----------

// Spotify's embed page carries the playlist's track list in its __NEXT_DATA__ JSON, so no API key or
// login is needed. That JSON isn't a documented API: if it changes, this returns 502 and the page falls
// back to the playlist's name. Cached for an hour.
async function spotifyTop(url, cors) {
  const id = url.searchParams.get("playlist") || "";
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return json({ error: "Bad playlist id." }, 400, cors);
  const res = await fetch("https://open.spotify.com/embed/playlist/" + id, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) return json({ error: "Spotify didn't answer." }, 502, cors);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  let entity;
  try { entity = JSON.parse(m[1]).props.pageProps.state.data.entity; } catch (e) { entity = null; }
  const first = entity && (entity.trackList || [])[0];
  if (!first) return json({ error: "Couldn't read that playlist." }, 502, cors);
  const trackId = String(first.uri || "").split(":").pop();
  return new Response(JSON.stringify({
    playlist: entity.name || null,
    title: first.title,
    artist: first.subtitle || null,
    url: trackId ? "https://open.spotify.com/track/" + trackId : null,
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...cors } });
}

// ---------- Spotify: now playing / last played (owner's account) ----------
//
// One-time setup: a Spotify developer app (SPOTIFY_CLIENT_ID in wrangler.toml, SPOTIFY_CLIENT_SECRET as a
// secret) with this Worker's /spotify/callback as a redirect URI, then tools/spotify_connect.py to sign in.
// Scopes are read-only: currently playing and recently played.

const SPOTIFY_SCOPES = "user-read-currently-playing user-read-recently-played";

// Must match a redirect URI in the Spotify app exactly. Set per environment (wrangler dev reports the live
// hostname in request.url, so it can't be worked out from the request locally).
function spotifyRedirect(url, env) {
  return env.SPOTIFY_REDIRECT || url.origin + "/spotify/callback";
}

async function spotifyToken(env, params) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET),
    },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Spotify token request failed");
  return data;
}

async function spotifyAuthUrl(request, url, env, cors) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, cors);
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return json({ error: "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET on the Worker first." }, 500, cors);
  const state = crypto.randomUUID();
  await env.QUEUE.put("spotify:state:" + state, "1", { expirationTtl: 600 });
  const auth = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: spotifyRedirect(url, env),
    scope: SPOTIFY_SCOPES,
    state,
  });
  return json({ url: auth, redirect: spotifyRedirect(url, env) }, 200, cors);
}

function page(title, message) {
  return new Response('<!doctype html><meta charset="utf-8"><title>' + title + '</title>' +
    '<body style="background:#000;color:#ecebe7;font:17px system-ui;display:grid;place-items:center;min-height:90vh;text-align:center">' +
    '<div><h1 style="font-size:1.4rem">' + title + "</h1><p style=\"color:#8a8882\">" + message + "</p></div>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function spotifyCallback(url, env) {
  const state = url.searchParams.get("state") || "";
  if (!state || !(await env.QUEUE.get("spotify:state:" + state))) return page("Link expired", "Run tools/spotify_connect.py again.");
  await env.QUEUE.delete("spotify:state:" + state);
  if (url.searchParams.get("error")) return page("Not connected", "Spotify said: " + url.searchParams.get("error"));
  try {
    const t = await spotifyToken(env, { grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: spotifyRedirect(url, env) });
    await env.QUEUE.put("spotify:refresh", t.refresh_token);
    await env.QUEUE.put("spotify:access", t.access_token, { expirationTtl: Math.max(60, (t.expires_in || 3600) - 120) });
    await env.QUEUE.delete("spotify:now");
  } catch (e) {
    return page("Not connected", String(e.message));
  }
  return page("Spotify connected", "The home page will show what you're listening to. You can close this tab.");
}

async function spotifyAccess(env) {
  const cached = await env.QUEUE.get("spotify:access");
  if (cached) return cached;
  const refresh = await env.QUEUE.get("spotify:refresh");
  if (!refresh) return null;
  const t = await spotifyToken(env, { grant_type: "refresh_token", refresh_token: refresh });
  if (t.refresh_token) await env.QUEUE.put("spotify:refresh", t.refresh_token);
  await env.QUEUE.put("spotify:access", t.access_token, { expirationTtl: Math.max(60, (t.expires_in || 3600) - 120) });
  return t.access_token;
}

function trackInfo(track) {
  const images = (track.album && track.album.images) || [];
  // Spotify lists album art largest first (640, 300, 64); take the ~300px one for cards
  const art = images.find((i) => i.width && i.width <= 320) || images[images.length - 1] || images[0];
  return {
    title: track.name,
    artist: (track.artists || []).map((a) => a.name).join(", ") || null,
    album: track.album ? track.album.name : null,
    image: art ? art.url : null,
    url: track.external_urls ? track.external_urls.spotify : null,
    durationMs: track.duration_ms || null,
  };
}

// Now playing if something is, else the last played song. Cached a minute so visitors don't each ask Spotify,
// but not past the end of the song that's playing. progressMs + fetchedAt let the page run the progress bar.
async function spotifyNow(env, cors) {
  const cached = await env.QUEUE.get("spotify:now", "json");
  const songOver = cached && cached.nowPlaying && cached.durationMs &&
    Date.now() - Date.parse(cached.fetchedAt) > cached.durationMs - (cached.progressMs || 0);
  if (cached && !songOver) return json(cached, 200, cors);
  let out = null;
  try {
    const token = await spotifyAccess(env);
    if (!token) return json({ error: "Spotify isn't connected." }, 404, cors);
    const auth = { headers: { Authorization: "Bearer " + token } };
    const cur = await fetch("https://api.spotify.com/v1/me/player/currently-playing", auth);
    if (cur.status === 200) {
      const d = await cur.json();
      if (d.is_playing && d.item && d.currently_playing_type === "track") {
        out = { ...trackInfo(d.item), nowPlaying: true, playedAt: new Date().toISOString(), progressMs: d.progress_ms || 0 };
      }
    }
    if (!out) {
      const rec = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=1", auth);
      if (rec.ok) {
        const item = ((await rec.json()).items || [])[0];
        if (item) out = { ...trackInfo(item.track), nowPlaying: false, playedAt: item.played_at };
      }
    }
  } catch (e) {
    return json({ error: "Spotify didn't answer." }, 502, cors);
  }
  if (!out) return json({ error: "Nothing played yet." }, 404, cors);
  out.fetchedAt = new Date().toISOString();
  await env.QUEUE.put("spotify:now", JSON.stringify(out), { expirationTtl: 60 });
  return json(out, 200, cors);
}

// Up to 10 songs, newest first: what's playing now (live: true) and then recently played. Cached a minute.
async function spotifyRecent(env, cors) {
  const cached = await env.QUEUE.get("spotify:recent", "json");
  if (cached) return json(cached, 200, cors);
  const items = [];
  try {
    const token = await spotifyAccess(env);
    if (!token) return json({ error: "Spotify isn't connected." }, 404, cors);
    const auth = { headers: { Authorization: "Bearer " + token } };
    const cur = await fetch("https://api.spotify.com/v1/me/player/currently-playing", auth);
    if (cur.status === 200) {
      const d = await cur.json();
      if (d.is_playing && d.item && d.currently_playing_type === "track") items.push({ ...trackInfo(d.item), live: true, playedAt: new Date().toISOString() });
    }
    const rec = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=10", auth);
    if (rec.ok) {
      for (const it of (await rec.json()).items || []) {
        if (items.length >= 10) break;
        items.push({ ...trackInfo(it.track), live: false, playedAt: it.played_at });
      }
    }
  } catch (e) {
    return json({ error: "Spotify didn't answer." }, 502, cors);
  }
  const out = { items, fetchedAt: new Date().toISOString() };
  await env.QUEUE.put("spotify:recent", JSON.stringify(out), { expirationTtl: 60 });
  return json(out, 200, cors);
}
