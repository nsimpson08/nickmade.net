// Nick's Nine leaderboard (extras/golf-game): visitors save their round when they finish the 9th hole.
//
//   GET    /golf/leaderboard?visitorId=   { entries: best rounds first (top 100), each { id, name, score, toPar, ghost, date,
//                                          owner?, mine? } }
//   POST   /golf/leaderboard   { name, holes: [9 hole scores], ghost, visitorId, version } -> { entry, rank, entries }
//                              with Authorization: Bearer ADMIN_TOKEN (owner mode) the round is marked as Nick's own
//   DELETE /golf/leaderboard/:id  (admin) remove a round
//
// Storage (the QUEUE namespace): golf:leaderboard  JSON array of rounds, best 200 kept
//                                golf:saves:<hash>:<YYYY-MM-DD>  rounds saved by a visitor that day (expires after 2 days)
// The game runs in the browser, so a determined visitor could fake a score; these checks stop typos and casual abuse,
// and Nick can remove anything with the DELETE route.

const KEY = "golf:leaderboard";
const KEEP = 200;
const SHOW = 100;
const PER_DAY = 10;
const PARS = [4, 3, 5, 4, 4, 3, 5, 4, 4]; // must match the game's holes (src/sim/holes.ts); the pick-up limit is 2 x par + 1
const PAR = PARS.reduce((s, p) => s + p, 0);

export async function golfRoute(request, url, env, cors, h) {
  if (url.pathname === "/golf/leaderboard" && request.method === "GET") return list(url, env, cors, h);
  if (url.pathname === "/golf/leaderboard" && request.method === "POST") return save(request, env, cors, h);
  if (url.pathname.startsWith("/golf/leaderboard/") && request.method === "DELETE") return remove(request, url, env, cors, h);
  return null;
}

async function board(env) {
  try { return JSON.parse((await env.QUEUE.get(KEY)) || "[]"); } catch (e) { return []; }
}

// best score first; ties go to whoever posted it first
const order = (a, b) => a.score - b.score || a.date.localeCompare(b.date);

async function by(visitorId, env, h) {
  if (!visitorId || !/^[a-z0-9-]{8,64}$/i.test(visitorId)) return null;
  return h.sha256((env.SALT || "nickmade") + "golf:" + visitorId);
}

function publicEntry(e, mine) {
  const out = { id: e.id, name: e.name, score: e.score, toPar: e.score - PAR, ghost: e.ghost, date: e.date };
  if (e.owner) out.owner = true;
  if (mine && e.by === mine) out.mine = true;
  return out;
}

async function list(url, env, cors, h) {
  const mine = await by(url.searchParams.get("visitorId"), env, h);
  const entries = (await board(env)).sort(order).slice(0, SHOW).map((e) => publicEntry(e, mine));
  return h.json({ entries, par: PAR }, 200, cors);
}

async function save(request, env, cors, h) {
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const owner = h.isAdmin(request, env);
  const name = String(body.name || "").replace(/\s+/g, " ").trim();
  if (!owner) {
    if (name.length < 1 || name.length > 24) return h.json({ error: "Add your name (up to 24 characters)." }, 400, cors);
    if (h.BLOCKED.some((w) => h.normalize(name).replace(/ /g, "").includes(w))) return h.json({ error: "Please use a different name." }, 400, cors);
    if (/https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ru|xyz|ly|gg|me|info|biz|link|site|online|app)\b/i.test(name)) return h.json({ error: "Names can't include links." }, 400, cors);
  }
  const holes = Array.isArray(body.holes) ? body.holes.map((n) => Number(n)) : [];
  if (holes.length !== PARS.length || holes.some((n, i) => !Number.isInteger(n) || n < 1 || n > PARS[i] * 2 + 1)) {
    return h.json({ error: "That round doesn't add up." }, 400, cors);
  }
  const score = holes.reduce((s, n) => s + n, 0);
  const ghost = Number.isInteger(body.ghost) && body.ghost >= 9 && body.ghost <= 99 ? body.ghost : null;

  // a few saves a day per visitor (browser id and hashed IP, like the queue)
  const day = new Date().toISOString().slice(0, 10);
  const ids = [];
  const vid = await by(body.visitorId, env, h);
  if (vid) ids.push(vid);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) ids.push(await h.sha256((env.SALT || "nickmade") + "golf-ip:" + ip));
  if (!owner) {
    let used = 0;
    for (const id of ids) used = Math.max(used, parseInt(await env.QUEUE.get("golf:saves:" + id + ":" + day), 10) || 0);
    if (used >= PER_DAY) return h.json({ error: "That's " + PER_DAY + " rounds saved today. Come back tomorrow!" }, 429, cors);
    for (const id of ids) await env.QUEUE.put("golf:saves:" + id + ":" + day, String(used + 1), { expirationTtl: 2 * 86400 });
  }

  const entry = {
    id: crypto.randomUUID().slice(0, 8), name: owner ? name || "Nick" : name, score, holes, ghost,
    date: new Date().toISOString(), by: vid, owner: owner || undefined, v: String(body.version || "").slice(0, 8),
  };
  const all = (await board(env)).concat(entry).sort(order).slice(0, KEEP);
  await env.QUEUE.put(KEY, JSON.stringify(all));
  const rank = all.indexOf(entry) + 1; // 0 if it didn't make the kept list
  return h.json({
    entry: publicEntry(entry, vid), rank: rank || null,
    entries: all.slice(0, SHOW).map((e) => publicEntry(e, vid)),
  }, 201, cors);
}

async function remove(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const id = decodeURIComponent(url.pathname.split("/")[3] || "");
  const all = await board(env);
  const kept = all.filter((e) => e.id !== id);
  if (kept.length !== all.length) await env.QUEUE.put(KEY, JSON.stringify(kept));
  return h.json({ removed: all.length - kept.length }, 200, cors);
}
