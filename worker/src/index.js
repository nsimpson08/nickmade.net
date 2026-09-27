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
//   GET    /img?u=url           image proxy for posters (allowlisted hosts only)
//
// Storage: one KV namespace (QUEUE). Keys (Movies keeps the original unprefixed names):
//   queue / queue:games            JSON array of queue submissions
//   watched / watched:games        JSON array of Recently Watched / Recently Played
//   lists:<page>                   JSON object { <section key>: [items] } for the other live sections
//   visitor:<hash> / visitor:games:<hash>  number of queue submissions from that visitor (browser id or hashed IP)

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
const IMG_HOSTS = ["m.media-amazon.com", "alternativemovieposters.com"];
const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fag", "retard", "bitch", "whore", "slut", "nazi", "rape", "porn", "dick", "cock", "pussy"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/search" && request.method === "GET") return await search(url, cors, ctx);
      if (url.pathname === "/lists" && request.method === "GET") return await getLists(url, env, cors);
      if (url.pathname === "/lists" && request.method === "POST") return await addToList(request, env, cors);
      if (url.pathname.startsWith("/lists/") && request.method === "DELETE") return await removeFromList(request, url, env, cors);
      if (url.pathname === "/img" && request.method === "GET") return await image(url, ctx);
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
// Poster: for movies, alternative art if AMP has it; otherwise (and for games) the official IMDb poster/box art.
async function lookupMovie(imdbId, kind) {
  const res = await fetch("https://v3.sg.media-imdb.com/suggestion/x/" + imdbId + ".json");
  const data = await res.json();
  const movie = (data.d || []).find((r) => r.id === imdbId);
  if (!movie || !(kind === "game" ? GAME_TYPES : MOVIE_TYPES).has(movie.qid)) return null;
  const art = kind === "game" ? null : await findAlternativeArt(movie.l, movie.y);
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
