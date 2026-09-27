// nickmade-queue: visitor submissions for the Movies page "In the Queue" section.
//
//   GET    /search?q=title      movie title autocomplete (IMDb suggestions)
//   GET    /queue               visitor submissions + whether the queue is open + this visitor's remaining count
//   POST   /queue               { imdbId, name, visitorId } -> adds a movie
//   DELETE /queue/:imdbId       remove a submission (needs Authorization: Bearer ADMIN_TOKEN)
//   GET    /img?u=url           image proxy for posters (allowlisted hosts only)
//
// Storage: one KV namespace (QUEUE). Keys:
//   queue            JSON array of submissions
//   visitor:<hash>   number of submissions from that visitor (browser id or hashed IP)

const PER_VISITOR = 3;
const MOVIE_TYPES = new Set(["movie", "tvMovie", "video"]);
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
      if (url.pathname === "/img" && request.method === "GET") return await image(url, ctx);
      if (url.pathname === "/queue" && request.method === "GET") return await listQueue(request, url, env, cors);
      if (url.pathname === "/queue" && request.method === "POST") return await addToQueue(request, env, cors);
      if (url.pathname.startsWith("/queue/") && request.method === "DELETE") return await removeFromQueue(request, url, env, cors);
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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// Two identities per visitor: the random id their browser keeps, and their IP (hashed, never stored raw).
async function visitorKeys(request, visitorId, env) {
  const salt = env.SALT || "nickmade";
  const keys = [];
  if (visitorId && /^[a-z0-9-]{8,64}$/i.test(visitorId)) keys.push("visitor:" + (await sha256(salt + "id:" + visitorId)));
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) keys.push("visitor:" + (await sha256(salt + "ip:" + ip)));
  return keys;
}

async function usedBy(keys, env) {
  let used = 0;
  for (const k of keys) used = Math.max(used, parseInt(await env.QUEUE.get(k), 10) || 0);
  return used;
}

async function getQueue(env) {
  try { return JSON.parse((await env.QUEUE.get("queue")) || "[]"); } catch (e) { return []; }
}

function normalize(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

// Your own "In the Queue" movies, read from the live site so the cap stays right when you edit list.js.
async function ownerQueueTitles(env) {
  try {
    const res = await fetch(env.SITE_URL.replace(/\/$/, "") + "/movies/list.js", { cf: { cacheTtl: 300 } });
    const text = await res.text();
    const start = text.indexOf('title: "In the Queue"');
    if (start < 0) throw new Error("no queue section");
    const end = text.indexOf("\n    ]", start);
    const section = text.slice(start, end > 0 ? end : undefined);
    return [...section.matchAll(/\{\s*title:\s*"([^"]+)"/g)].map((m) => m[1]);
  } catch (e) {
    return null;
  }
}

async function queueState(env) {
  const limit = parseInt(env.QUEUE_LIMIT, 10) || 10;
  const owner = await ownerQueueTitles(env);
  const ownerCount = owner ? owner.length : parseInt(env.OWNER_QUEUE_FALLBACK, 10) || 0;
  const items = await getQueue(env);
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
  const results = (data.d || [])
    .filter((r) => /^tt\d+$/.test(r.id) && MOVIE_TYPES.has(r.qid))
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
  const state = await queueState(env);
  const keys = await visitorKeys(request, url.searchParams.get("visitorId"), env);
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
  return { imdbId: it.imdbId, title: it.title, year: it.year, image: it.image, credit: it.credit, suggestedBy: it.suggestedBy };
}

async function addToQueue(request, env, cors) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400, cors); }
  const imdbId = String(body.imdbId || "");
  const name = String(body.name || "").replace(/\s+/g, " ").trim();

  if (!/^tt\d{5,10}$/.test(imdbId)) return json({ error: "Pick a movie from the list." }, 400, cors);
  if (name.length < 1 || name.length > 40) return json({ error: "Add your name (up to 40 characters)." }, 400, cors);
  const lowered = normalize(name).replace(/ /g, "");
  if (BLOCKED.some((w) => lowered.includes(w))) return json({ error: "Please use a different name." }, 400, cors);

  const keys = await visitorKeys(request, body.visitorId, env);
  const used = await usedBy(keys, env);
  if (used >= PER_VISITOR) return json({ error: "You've already added " + PER_VISITOR + " movies. Thanks!" }, 429, cors);

  const state = await queueState(env);
  if (!state.open) return json({ error: "Not taking submissions at this time." }, 409, cors);
  if (state.items.some((it) => it.imdbId === imdbId)) return json({ error: "That one's already in the queue." }, 409, cors);

  // Look the movie up by id so the title/year/poster come from IMDb, not the browser
  const res = await fetch("https://v3.sg.media-imdb.com/suggestion/x/" + imdbId + ".json");
  const data = await res.json();
  const movie = (data.d || []).find((r) => r.id === imdbId);
  if (!movie || !MOVIE_TYPES.has(movie.qid)) return json({ error: "Couldn't find that movie." }, 404, cors);
  if (state.owner.some((t) => normalize(t) === normalize(movie.l))) return json({ error: "That one's already in the queue." }, 409, cors);

  const art = await findAlternativeArt(movie.l, movie.y);
  const item = {
    imdbId,
    title: movie.l,
    year: movie.y || null,
    image: art ? art.image : movie.i ? movie.i.imageUrl : null,
    credit: art ? { artist: art.artist, url: art.url } : { label: "Official poster", artist: "" },
    suggestedBy: name,
    createdAt: new Date().toISOString(),
  };

  // Re-read right before writing to keep the cap honest if two people submit at once
  const latest = await queueState(env);
  if (!latest.open) return json({ error: "Not taking submissions at this time." }, 409, cors);
  latest.items.push(item);
  await env.QUEUE.put("queue", JSON.stringify(latest.items));
  for (const k of keys) await env.QUEUE.put(k, String(used + 1));

  return json({
    item: publicItem(item),
    open: latest.remaining - 1 > 0,
    yourRemaining: Math.max(0, PER_VISITOR - used - 1),
  }, 201, cors);
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
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/, "");
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ error: "Unauthorized" }, 401, cors);
  const id = decodeURIComponent(url.pathname.split("/")[2] || "");
  const items = await getQueue(env);
  const kept = items.filter((it) => it.imdbId !== id);
  await env.QUEUE.put("queue", JSON.stringify(kept));
  return json({ removed: items.length - kept.length }, 200, cors);
}
