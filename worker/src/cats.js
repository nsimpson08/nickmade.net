// The Cattery v1.0 (released with the site's Ver 1.6, play/cats/): visitors make a cat, and it lives in one shared room with everyone else's (up
// to ROOM_MAX). Only its owner can feed it, pet it, play with it, send it somewhere (a perch on a tower, a shelf up the
// wall, the couch) or have it go and meet another cat. The rest happens by itself: every 4 hours (the Worker's cron, see
// index.js) the room runs a few rounds of cat life: cats groom each other, play, nap together, hiss, swat, fall for each
// other, fall out, wander to another spot. Each of those changes how two cats feel about each other (friendship,
// -100 to 100; romance, 0 to 100) and goes in the room's history. The page works out best friends, crushes, couples,
// rivals and cliques from those numbers.
//
//   GET    /cats?visitorId=           { cats, rel, log, mine, mines (all of yours: up to CATS_EACH, plus kittens; any number for Nick), max, owner }: the room, how every pair of cats get on
//                                     ({ "<id>|<id>": { f, r } }), the newest history first, and the id of this
//                                     browser's cat (owner: Nick, with the admin token, can remove any cat)
//   POST   /cats                      { visitorId, name, ownerName, gender ("f" | "m"), personality, look } -> makes a cat: { cat, code } (code: the recovery code)
//                                      ownerName = the visitor's own name, shown on the cat's card to everyone
//   POST   /cats/claim                { visitorId, code } -> this browser can look after that cat too: { cat }
//   POST   /cats/:id                  { visitorId, action: "feed" | "pet" | "play" | "go" | "meet" | "treat" | "date" | "apart" | "collect" | "name" | "wear", spot?, with?, name?, g? }
//                                     or from ANY visitor to someone else's cat: { visitorId, action: "kind", what: "treat" | "pet", by }
//                                     (its owner only) -> { cat, event?, extra (milestones it led to), message? }
//   GET    /cats/:id/code?visitorId=  { code } (its owner only)
//   DELETE /cats/:id?visitorId=       its owner lets it go, or Nick removes it (admin)
//   POST   /cats/event                (admin) { k: "storm" | "sunbeam" | "stop" } a room event now (the cron starts one now and then)
//   GET    /cats/times                the last 7 days of history, for the page's weekly newspaper
//   GET    /cats/snapshots            (admin) the daily copies kept: { snapshots: [date, ...] }
//   POST   /cats/restore              (admin) { date } puts that copy back
//   POST   /cats/tick                 (admin, for testing) a burst of cat life now: one meeting per cat at once
// Cat life itself runs on each cat's own clock (live(): 5 min to 4 h apart, leaning long), played out on GET /cats and the cron.
//
// Two cats per browser (CATS_EACH; Nick, 2026-10-15: "every visitor should be allowed to add 2 cats instead of 1";
// kittens don't count), and at most PER_IP cats from one internet connection, so a household can still have two each. The recovery code lets the owner look after it from another device.
// Storage (the QUEUE namespace): cats:room  { v, cats, rel, log, tickAt }. Owners and IPs are kept hashed, never raw.
// Keeping the cats safe across releases (Nick, 2026-10-14: "a saved state of all the cats so when we release new versions
// of the cat room it won't delete cats history"): the room lives only in KV, never in the repo, so a push or a deploy
// doesn't touch it, and:
//   - an unreadable cats:room is never treated as an empty room (load() throws, so nothing saves over it)
//   - a release that changes what's stored bumps VERSION and adds a step to migrate(); old rooms are upgraded, never reset
//   - history past LOG_MAX moves to cats:log:YYYY-MM (kept forever, oldest first) instead of being dropped
//   - the cron keeps a daily copy, cats:snap:YYYY-MM-DD (30 days); Nick can list them (GET /cats/snapshots) and put one
//     back (POST /cats/restore { date }; the room as it was is snapped first, as cats:snap:before-restore-<time>)
//   - the private nightly backup copies all of KV too

const ROOM_MAX = 30;
const CATS_EACH = 2;
const PER_IP = 6;
const LOG_MAX = 600;
const NAME_MAX = 16;
const OWNER_MAX = 24; // like the queue's "Your name"
const RETIRE_DAYS = 30; // a cat whose owner hasn't been back in this long moves out (frees its spot for someone new); the Cat Maker's welcome screen says "30 days" (play/cats/index.html .maker-stay): change both together
const KEY = "cats:room";
const VERSION = 3; // the shape of cats:room (see migrate())
const SNAP_DAYS = 30;

// The same choices as play/cats/catdraw.js
const FURS = ["black", "charcoal", "blue", "silver", "white", "cream", "fawn", "ginger", "red", "cinnamon", "brown", "chocolate", "lilac"];
const EYES = ["green", "gold", "copper", "blue", "hazel", "odd"];
const PATTERNS = ["solid", "tabby", "tuxedo", "bicolor", "van", "calico", "tortie", "colorpoint", "spotted"];
// The room's spots (play/cats/room.js has where each one is): one cat each. zone: cats in the same part of the room
// run into each other more.
const SPOTS = {
  ta1: "tall", ta2: "tall", ta3: "tall", tb1: "short", tb2: "short", tb3: "short",
  sh1: "shelves", sh2: "shelves", sh3: "shelves", sh4: "shelves", sh5: "shelves", sh6: "shelves",
  cabinet: "window", window: "window", couch1: "couch", couch2: "couch", couch3: "couch", couchback: "couch",
  rug1: "rug", rug2: "rug", rug3: "rug", bed1: "floor", bed2: "shelves", bed3: "floor",
  box1: "floor", box2: "shelves", pouf: "rug", post: "rug",
  fl1: "tall", fl2: "rug", fl3: "floor", fl4: "floor", fl5: "window", fl6: "couch", fl7: "short", fl8: "shelves",
};

export async function catsRoute(request, url, env, cors, h) {
  const path = url.pathname;
  if (path === "/cats" && request.method === "GET") return getRoom(request, url, env, cors, h);
  if (path === "/cats" && request.method === "POST") return makeCat(request, env, cors, h);
  if (path === "/cats/claim" && request.method === "POST") return claim(request, env, cors, h);
  if (path === "/cats/times" && request.method === "GET") { // The Cattery Times: the last 7 days of history (the page writes it)
    const room = await load(env), from = Date.now() - 7 * 24 * HOUR;
    return h.json({ from, to: Date.now(), lines: room.log.filter((e) => e.t >= from).sort((a, b) => a.t - b.t), cats: room.cats.map((c) => ({ id: c.id, name: c.name })) }, 200, cors);
  }
  if (path === "/cats/snapshots" && request.method === "GET") { // (admin) the daily copies kept
    if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
    const list = await env.QUEUE.list({ prefix: "cats:snap:" });
    return h.json({ snapshots: list.keys.map((k) => k.name.slice(10)).sort().reverse() }, 200, cors);
  }
  if (path === "/cats/event" && request.method === "POST") { // (admin) start a room event now: { k: "storm" | "sunbeam" | "stop" }
    if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const room = await load(env), now = Date.now();
    if (body.k === "stop") room.event = null;
    else if (EVENTS[body.k]) startEvent(room, body.k, now);
    else return h.json({ error: "Unknown event" }, 400, cors);
    await save(env, room);
    return h.json({ event: room.event }, 200, cors);
  }
  if (path === "/cats/restore" && request.method === "POST") { // (admin) put a daily copy back
    if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const raw = await env.QUEUE.get("cats:snap:" + String(body.date || ""));
    if (raw === null) return h.json({ error: "No copy called " + body.date + "." }, 404, cors);
    const now = await env.QUEUE.get(KEY);
    if (now !== null) await env.QUEUE.put("cats:snap:before-restore-" + new Date().toISOString().replace(/[:.]/g, "-"), now, { expirationTtl: SNAP_DAYS * 86400 });
    const room = migrate(JSON.parse(raw));
    await env.QUEUE.put(KEY, JSON.stringify(room));
    return h.json({ restored: body.date, cats: room.cats.length }, 200, cors);
  }
  if (path === "/cats/tick" && request.method === "POST") { // (admin) run a round of cat life now, as the cron would
    if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
    const room = tick(await load(env), Date.now());
    await save(env, room);
    return h.json({ cats: room.cats.length, log: room.log.slice(-20).reverse() }, 200, cors);
  }
  const m = /^\/cats\/([a-z0-9]{6,12})(\/code)?$/.exec(path);
  if (!m) return null;
  if (m[2] && request.method === "GET") return showCode(m[1], url, env, cors, h);
  if (!m[2] && request.method === "POST") return act(m[1], request, env, cors, h);
  if (!m[2] && request.method === "DELETE") return removeCat(m[1], request, url, env, cors, h);
  return null;
}

// ---------- storage ----------
async function load(env) {
  const raw = await env.QUEUE.get(KEY);
  if (raw === null) return fresh(); // no room yet
  return migrate(JSON.parse(raw)); // unreadable: this throws, and nothing gets the chance to save an empty room over it
}
function fresh() { return { v: VERSION, cats: [], rel: {}, log: [], tickAt: 0 }; }
// Old rooms brought up to date, one step per version. A release that changes what's stored adds a step here (and bumps
// VERSION) instead of starting over.
function migrate(room) {
  room.cats = room.cats || []; room.rel = room.rel || {}; room.log = room.log || [];
  if (!(room.v >= 1)) { // v1 (2026-10-14, the first live version): owner names, each cat's clock (live() also fills these)
    room.cats.forEach((c) => { if (c.ownerName == null) c.ownerName = ""; });
    room.v = 1;
  }
  if (!(room.v >= 2)) { // v2 (2026-10-15): each cat's gender, picked in the Cat Maker ("f" / "m"); cats made before it have none ("")
    room.cats.forEach((c) => { if (c.gender == null) c.gender = ""; });
    room.v = 2;
  }
  if (!(room.v >= 3)) { // v3 (2026-10-15): kittens (kitten, parents, named), adventures (away, postcards), gifts worn (wear),
    // kindness from other visitors (kind), days checked in (days, dayLast: tricks). All optional; nothing to fill in.
    room.v = 3;
  }
  return room;
}
async function save(env, room) {
  if (!room || !Array.isArray(room.cats) || !Array.isArray(room.log)) throw new Error("not saving a broken room");
  room.v = VERSION;
  if (room.log.length > LOG_MAX + 100) { // in batches of 100+, to keep KV writes down
    const old = room.log.slice(0, room.log.length - LOG_MAX);
    room.log = room.log.slice(-LOG_MAX);
    await archive(env, old);
  }
  await env.QUEUE.put(KEY, JSON.stringify(room));
}
// history lines past LOG_MAX, kept by month (cats:log:YYYY-MM, oldest first)
async function archive(env, lines) {
  const byMonth = {};
  lines.forEach((e) => { const m = new Date(e.t || Date.now()).toISOString().slice(0, 7); (byMonth[m] = byMonth[m] || []).push(e); });
  for (const m of Object.keys(byMonth)) {
    const k = "cats:log:" + m, raw = await env.QUEUE.get(k);
    const kept = raw === null ? [] : JSON.parse(raw); // unreadable: throws rather than overwrite it
    await env.QUEUE.put(k, JSON.stringify(kept.concat(byMonth[m])));
  }
}
// the cron's daily copy of the whole room
async function snapshot(env, room) {
  const k = "cats:snap:" + new Date().toISOString().slice(0, 10);
  if ((await env.QUEUE.get(k)) !== null) return;
  await env.QUEUE.put(k, JSON.stringify(room), { expirationTtl: SNAP_DAYS * 86400 });
}
const pair = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
function relOf(room, a, b) { return room.rel[pair(a, b)] || (room.rel[pair(a, b)] = { f: 0, r: 0 }); }
function logIt(room, e) { e.t = e.t || Date.now(); room.log.push(e); return e; }
function cat(room, id) { return room.cats.find((c) => c.id === id); }

const ownerHash = (h, env, visitorId) => h.sha256((env.SALT || "nickmade") + "cat:" + visitorId);
const validId = (v) => typeof v === "string" && /^[a-z0-9-]{8,64}$/i.test(v);
async function ownedBy(h, env, c, visitorId) {
  return !!c && validId(visitorId) && (c.owners || []).includes(await ownerHash(h, env, visitorId));
}
// what everyone sees of a cat (no owners, IPs or codes)
function view(c) {
  const { owners, ip, code, nick, kind, ...rest } = c;
  return rest;
}

// ---------- the room ----------
async function getRoom(request, url, env, cors, h) {
  const room = await load(env);
  let dirty = live(room, Date.now()); // whatever came due since anyone last looked
  const visitorId = url.searchParams.get("visitorId");
  let mine = null, mines = [];
  if (validId(visitorId)) {
    const me = await ownerHash(h, env, visitorId);
    mines = room.cats.filter((x) => (x.owners || []).includes(me)).map((x) => x.id); // up to CATS_EACH (plus kittens); any number for Nick
    mine = mines[0] || null;
    // a day checked in, for tricks (once a day per cat: a KV write at most once a day per owner)
    const today = plano(Date.now());
    room.cats.forEach((c) => { if (mines.includes(c.id) && c.dayLast !== today) { c.days = (c.days || 0) + 1; c.dayLast = today; dirty = true; } });
  }
  if (noteDailySun(room, Date.now())) dirty = true;
  if (dirty) await save(env, room);
  // only the pairs that have met (the rest are 0 and 0)
  return h.json({
    cats: room.cats.map(view), rel: room.rel, log: room.log.slice().sort((a, b) => a.t - b.t).slice(-200).reverse(), mine, mines, max: ROOM_MAX,
    // your own cats' lines, further back than the room's 200 (the "While you were away" recap)
    mineLog: mines.length ? room.log.filter((e) => mines.includes(e.a) || mines.includes(e.b)).sort((a, b) => a.t - b.t).slice(-300).reverse() : [],
    event: currentEvent(room, Date.now()),
    owner: h.isAdmin(request, env), tickAt: room.tickAt,
  }, 200, cors);
}

function cleanName(n) { return String(n || "").replace(/\s+/g, " ").trim(); }
function checkName(name, room, h) {
  if (!name) return "Give your cat a name.";
  if (name.length > NAME_MAX) return "That name's a bit long (" + NAME_MAX + " letters at most).";
  if (!/^[\p{L}\p{N} '’.-]+$/u.test(name)) return "Just letters and numbers in the name, please.";
  if (h.BLOCKED.some((w) => h.normalize(name).replace(/ /g, "").includes(w))) return "Please pick a different name.";
  if (room.cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) return "There's already a cat called " + name + " in the room.";
  return null;
}
function checkOwner(name, h) {
  if (!name) return "Add your name, so everyone knows whose cat it is.";
  if (name.length > OWNER_MAX) return "Your name's a bit long (" + OWNER_MAX + " characters at most).";
  if (/https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ru|xyz|ly|gg|me|info|biz|link|site|online|app)\b/i.test(name)) return "Names can't include links.";
  if (h.BLOCKED.some((w) => h.normalize(name).replace(/ /g, "").includes(w))) return "Please use a different name.";
  return null;
}
function cleanLook(l) {
  l = l || {};
  if (!PATTERNS.includes(l.pattern) || !FURS.includes(l.base) || !EYES.includes(l.eyes)) return null;
  return {
    pattern: l.pattern, base: l.base, second: FURS.includes(l.second) ? l.second : null, eyes: l.eyes,
    fluffy: !!l.fluffy, seed: Math.max(1, Math.min(9999, parseInt(l.seed, 10) || 1)),
  };
}
function newId() { return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10); }
function newCode(name, room) {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const word = (name.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 6)) || "CAT";
  for (;;) {
    const tail = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => A[b % A.length]).join("");
    const code = word + "-" + tail;
    if (!room.cats.some((c) => c.code === code)) return code;
  }
}
function freeSpots(room, except) {
  const taken = new Set(room.cats.filter((c) => c.id !== except).map((c) => c.spot));
  return Object.keys(SPOTS).filter((s) => !taken.has(s));
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// The owner picks a personality in the Cat Maker (Nick, 2026-10-15: "selectable when creating the cat", not generated).
// Each sets the four traits the room runs on within a range, so two easygoing cats still differ a little. Kittens keep
// generated traits (no personality: the page describes them from their traits).
//   friendly: more nice meetings, more likely to share; playful: chases and play; bossy: more spats; romantic: crushes
const PERSONALITIES = {
  easygoing:   { friendly: [0.45, 0.65], playful: [0.4, 0.6], bossy: [0.3, 0.45], romantic: [0.4, 0.6] },
  friendly:    { friendly: [0.8, 0.95], playful: [0.45, 0.65], bossy: [0.15, 0.3], romantic: [0.5, 0.7] },
  playful:     { friendly: [0.55, 0.7], playful: [0.8, 0.95], bossy: [0.3, 0.45], romantic: [0.35, 0.55] },
  lazy:        { friendly: [0.45, 0.6], playful: [0.05, 0.2], bossy: [0.25, 0.4], romantic: [0.35, 0.55] },
  standoffish: { friendly: [0.08, 0.22], playful: [0.3, 0.45], bossy: [0.4, 0.55], romantic: [0.2, 0.35] },
  bossy:       { friendly: [0.3, 0.45], playful: [0.4, 0.6], bossy: [0.78, 0.92], romantic: [0.3, 0.5] },
  gentle:      { friendly: [0.6, 0.75], playful: [0.35, 0.5], bossy: [0.05, 0.15], romantic: [0.5, 0.65] },
  romantic:    { friendly: [0.6, 0.75], playful: [0.4, 0.6], bossy: [0.2, 0.35], romantic: [0.8, 0.95] },
};
const traitsFor = (p) => Object.fromEntries(Object.entries(PERSONALITIES[p]).map(([k, [lo, hi]]) => [k, r2(lo + Math.random() * (hi - lo))]));
const r2 = (x) => Math.round(x * 100) / 100;

async function makeCat(request, env, cors, h) {
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request" }, 400, cors); }
  if (!validId(body.visitorId)) return h.json({ error: "Your browser didn't send its id. Try reloading." }, 400, cors);
  const room = await load(env);
  retire(room, Date.now());
  const me = await ownerHash(h, env, body.visitorId);
  // Nick (owner mode) can make as many cats as he likes (Nick, 2026-10-14), past the room's 30, as long as there's a
  // spot free; visitors get one each
  const nick = h.isAdmin(request, env);
  const already = room.cats.filter((c) => !c.kitten && (c.owners || []).includes(me));
  if (already.length >= CATS_EACH && !nick) return h.json({ error: "You already have " + CATS_EACH + " cats in the room: " + already.map((c) => c.name).join(" and ") + "." }, 409, cors);
  if (nick && !freeSpots(room).length) return h.json({ error: "Every spot in the room is taken (" + Object.keys(SPOTS).length + ")." }, 409, cors);
  if (room.cats.length >= ROOM_MAX && !nick) return h.json({ error: "The room's full right now (" + ROOM_MAX + " cats). Check back soon." }, 409, cors);
  const ipRaw = request.headers.get("CF-Connecting-IP") || "";
  const ip = ipRaw ? await h.sha256((env.SALT || "nickmade") + "catip:" + ipRaw) : "";
  if (ip && !h.isAdmin(request, env) && room.cats.filter((c) => c.ip === ip).length >= PER_IP) {
    return h.json({ error: "There are already " + PER_IP + " cats from your internet connection." }, 429, cors);
  }
  const name = cleanName(body.name);
  const problem = checkName(name, room, h);
  if (problem) return h.json({ error: problem }, 400, cors);
  const ownerName = cleanName(body.ownerName) || (h.isAdmin(request, env) ? "Nick" : "");
  const ownerProblem = checkOwner(ownerName, h);
  if (ownerProblem) return h.json({ error: ownerProblem }, 400, cors);
  const gender = body.gender === "f" || body.gender === "m" ? body.gender : null; // Nick, 2026-10-15
  if (!gender) return h.json({ error: "Pick girl or boy." }, 400, cors);
  const personality = PERSONALITIES[body.personality] ? body.personality : null; // the page requires one; a page from before it existed sends none, and gets random traits
  const look = cleanLook(body.look);
  if (!look) return h.json({ error: "Pick a pattern, a colour and eyes." }, 400, cors);
  const spots = freeSpots(room);
  const floorish = spots.filter((s) => /^(fl|rug|bed|pouf|box)/.test(s));
  const now = Date.now();
  const c = {
    id: newId(), name, ownerName, gender, look, born: now, spot: pick(floorish.length ? floorish : spots),
    personality: personality || undefined,
    traits: personality ? traitsFor(personality) : { friendly: r2(Math.random()), playful: r2(Math.random()), bossy: r2(Math.random()), romantic: r2(Math.random()) },
    fed: now, petted: 0, played: 0, seen: now, pinUntil: now + 6 * 3600e3, nextAt: now + gap(),
    owners: [me], ip, code: newCode(name, room), nick: nick || undefined, // Nick's cats never move out
  };
  room.cats.push(c);
  logIt(room, { k: "joined", a: c.id, an: c.name, s: c.spot, t: now });
  await save(env, room);
  if (!nick && h.tellOwner) await h.tellOwner(env, { type: "cat", name: c.name, owner: ownerName, pattern: look.pattern, base: look.base }); // Nick's phone
  return h.json({ cat: view(c), code: c.code }, 200, cors);
}

async function claim(request, env, cors, h) {
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request" }, 400, cors); }
  if (!validId(body.visitorId)) return h.json({ error: "Your browser didn't send its id. Try reloading." }, 400, cors);
  const code = String(body.code || "").toUpperCase().replace(/\s+/g, "").replace(/^([A-Z]+)([A-Z0-9]{4})$/, "$1-$2");
  const room = await load(env);
  const c = room.cats.find((x) => x.code === code);
  if (!c) return h.json({ error: "No cat has that code. Check the letters and try again." }, 404, cors);
  const me = await ownerHash(h, env, body.visitorId);
  const others = room.cats.filter((x) => x !== c && !x.kitten && (x.owners || []).includes(me));
  if (!c.kitten && others.length >= CATS_EACH) return h.json({ error: "This browser already looks after " + others.map((x) => x.name).join(" and ") + "." }, 409, cors);
  if (!c.owners.includes(me)) c.owners = c.owners.concat(me).slice(-6);
  c.seen = Date.now();
  await save(env, room);
  return h.json({ cat: view(c) }, 200, cors);
}

async function showCode(id, url, env, cors, h) {
  const room = await load(env);
  const c = cat(room, id);
  if (!(await ownedBy(h, env, c, url.searchParams.get("visitorId")))) return h.json({ error: "That's not your cat." }, 403, cors);
  return h.json({ code: c.code }, 200, cors);
}

async function removeCat(id, request, url, env, cors, h) {
  const room = await load(env);
  const c = cat(room, id);
  if (!c) return h.json({ error: "No such cat." }, 404, cors);
  const admin = h.isAdmin(request, env);
  if (!admin && !(await ownedBy(h, env, c, url.searchParams.get("visitorId")))) return h.json({ error: "That's not your cat." }, 403, cors);
  room.cats = room.cats.filter((x) => x !== c);
  logIt(room, { k: admin ? "removed" : "left", a: c.id, an: c.name });
  await save(env, room);
  return h.json({ removed: c.id }, 200, cors);
}

// ---------- kindness: any visitor can give someone else's cat a treat or a pet, each once a day ----------
async function kind(c, room, body, env, cors, h) {
  if (!validId(body.visitorId)) return h.json({ error: "Your browser didn't send its id. Try reloading." }, 400, cors);
  const what = body.what === "treat" ? "treat" : body.what === "pet" ? "pet" : null;
  if (!what) return h.json({ error: "Bad request" }, 400, cors);
  const me = await ownerHash(h, env, body.visitorId);
  if ((c.owners || []).includes(me)) return h.json({ error: "That's your own cat. Use the buttons above." }, 400, cors);
  const now = Date.now(), day = plano(now), key = me.slice(0, 16) + ":" + what;
  c.kind = Object.fromEntries(Object.entries(c.kind || {}).filter(([, d]) => d === day)); // only today's
  if (c.kind[key]) return h.json({ error: "You've already given " + c.name + " a " + what + " today." }, 429, cors);
  c.kind[key] = day;
  // who it was: the owner name on their own cat if they have one here (Nick: "Nick petted Mochi", not "A visitor"),
  // else the name they gave the site, else "A visitor"
  const theirs = room.cats.find((x) => (x.owners || []).includes(me) && x.ownerName);
  let by = theirs ? theirs.ownerName : cleanName(body.by).slice(0, 24);
  if (!by || checkOwner(by, h)) by = "A visitor";
  if (what === "treat") c.fed = Math.max(c.fed || 0, now - 12 * HOUR); // a snack, not a dinner
  else c.petted = now;
  const event = logIt(room, { k: "kind", a: c.id, an: c.name, by, what });
  await save(env, room);
  return h.json({ cat: view(c), event }, 200, cors);
}
// ---------- looking after a cat ----------
const MIN = 60e3, HOUR = 3600e3;
async function act(id, request, env, cors, h) {
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request" }, 400, cors); }
  const room = await load(env);
  const c = cat(room, id);
  if (!c) return h.json({ error: "No such cat." }, 404, cors);
  if (body.action === "kind") return kind(c, room, body, env, cors, h); // any visitor, to someone else's cat
  if (!(await ownedBy(h, env, c, body.visitorId))) return h.json({ error: "Only " + c.name + "'s owner can do that." }, 403, cors);
  const now = Date.now();
  c.seen = now;
  let event = null, extra = [], message = null, write = true;
  switch (body.action) {
    case "feed":
      if (now - c.fed < 2 * HOUR) { message = c.name + " isn't hungry yet."; write = false; break; }
      c.fed = now;
      event = logIt(room, { k: "fed", a: c.id, an: c.name });
      break;
    case "pet":
    case "play": {
      const field = body.action === "pet" ? "petted" : "played";
      if (now - c[field] < 20 * MIN) { write = false; break; } // the page still shows it; nothing new to save
      c[field] = now;
      event = logIt(room, { k: body.action, a: c.id, an: c.name });
      break;
    }
    case "go": {
      const spot = String(body.spot || "");
      if (!SPOTS[spot]) return h.json({ error: "There's no spot there." }, 400, cors);
      if (spot === c.spot) { write = false; break; }
      const there = room.cats.find((x) => x.spot === spot);
      if (there) return h.json({ error: there.name + " is already there." }, 409, cors);
      c.spot = spot;
      c.pinUntil = now + 12 * HOUR; // it stays put a while before wandering off by itself
      event = logIt(room, { k: "moved", a: c.id, an: c.name, s: spot });
      break;
    }
    case "meet": {
      const o = cat(room, String(body.with || ""));
      if (!o || o === c) return h.json({ error: "Pick another cat to meet." }, 400, cors);
      if (now - (c.metAt || 0) < 10 * MIN) return h.json({ error: c.name + " needs a little break first. Try again in a few minutes." }, 429, cors);
      c.metAt = now;
      const before = room.log.length;
      event = interact(room, c, o, now, 0.18); // you set it up: a bit more likely to go well
      extra = room.log.slice(before + 1); // what it led to: in love, close friends, rivals...
      break;
    }
    case "name": { // a kitten's name, chosen once by its owners
      if (!c.kitten || c.named) return h.json({ error: c.name + " already has a name." }, 409, cors);
      const name = cleanName(body.name), problem = checkName(name, { cats: room.cats.filter((x) => x !== c) }, h);
      if (problem) return h.json({ error: problem }, 400, cors);
      event = logIt(room, { k: "named", a: c.id, an: name, old: c.name });
      c.name = name; c.named = true;
      room.log.forEach((e) => { if (e.k === "kitten" && e.c === c.id) e.cn = name; });
      break;
    }
    case "wear": { // one of the gifts it has found, or nothing
      const g = String(body.g || "");
      if (g && (!WEARABLE.includes(g) || !((c.gifts || {})[g] > 0))) return h.json({ error: c.name + " hasn't found one of those." }, 400, cors);
      if ((c.wear || "") === g) { write = false; break; }
      if (g) c.wear = g; else delete c.wear;
      break;
    }
    case "collect": { // the gifts waiting by its spot
      const got = c.newGifts || [];
      if (!got.length) { write = false; break; }
      c.newGifts = [];
      message = got.map((g) => g.k);
      break;
    }
    case "treat":
    case "date":
    case "apart": {
      const o = cat(room, String(body.with || ""));
      if (!o || o === c) return h.json({ error: "Pick another cat." }, 400, cors);
      const rel = relOf(room, c.id, o.id), before = { f: rel.f, r: rel.r };
      // Keep apart and Set up a date: once a day each, whichever cat they're used on (Nick, 2026-10-14); a treat every 6 h
      const field = body.action + "At", wait = body.action === "treat" ? 6 * HOUR : 24 * HOUR;
      if (now - (c[field] || 0) < wait) {
        const left = Math.ceil((wait - (now - (c[field] || 0))) / HOUR);
        const what = { treat: "has had enough treats for now", date: "has had a date today", apart: "has already kept away from a cat today" }[body.action];
        return h.json({ error: c.name + " " + what + ". Try again in " + left + " h." }, 429, cors);
      }
      if (body.action === "apart") {
        c[field] = now;
        c.apart = Object.fromEntries(Object.entries(c.apart || {}).filter(([, u]) => u > now)); // drop the old ones
        c.apart[o.id] = now + 24 * HOUR;
        event = logIt(room, { k: "apart", a: c.id, an: c.name, b: o.id, bn: o.name });
        break;
      }
      if (body.action === "treat") {
        if (rel.f >= 40) return h.json({ error: c.name + " and " + o.name + " already get on." }, 409, cors);
        c[field] = now;
        const chance = 0.45 + ((o.traits || {}).friendly || 0.5) * 0.3 + (hungry(o, now) ? 0.15 : 0);
        if (Math.random() < chance) { rel.f = Math.min(100, Math.round(rel.f + roll([15, 25]))); event = logIt(room, { k: "treat", a: c.id, an: c.name, b: o.id, bn: o.name }); }
        else { rel.f = Math.max(-100, Math.round(rel.f - roll([2, 5]))); event = logIt(room, { k: "treatno", a: c.id, an: c.name, b: o.id, bn: o.name }); }
      } else {
        if (rel.f < 20) return h.json({ error: c.name + " and " + o.name + " need to be friends first." }, 409, cors);
        const la = inLoveWith(room, c), lb = inLoveWith(room, o);
        if (la && la !== o) return h.json({ error: c.name + " is already in love with " + la.name + "." }, 409, cors);
        if (lb && lb !== c) return h.json({ error: o.name + " is already in love with " + lb.name + "." }, 409, cors);
        c[field] = now;
        const chance = 0.4 + (((c.traits || {}).romantic || 0.5) + ((o.traits || {}).romantic || 0.5)) * 0.2;
        if (Math.random() < chance) { rel.r = Math.min(100, Math.round(rel.r + roll([14, 24]))); event = logIt(room, { k: "date", a: c.id, an: c.name, b: o.id, bn: o.name }); }
        else { rel.r = Math.max(0, Math.round(rel.r - 3)); event = logIt(room, { k: "datefail", a: c.id, an: c.name, b: o.id, bn: o.name }); }
      }
      const at = room.log.length;
      milestones(room, c, o, before, rel, now);
      extra = room.log.slice(at);
      break;
    }
    default:
      return h.json({ error: "Unknown action" }, 400, cors);
  }
  if (write) await save(env, room);
  return h.json({ cat: view(c), event, extra, message, rel: event && event.b ? room.rel[pair(event.a, event.b)] : undefined }, 200, cors);
}

// ---------- cat life ----------
// The things two cats can do together; f / r: what it does to their friendship / romance
const NICE = [
  { k: "groom", f: [8, 14] }, { k: "play", f: [7, 12] }, { k: "nap", f: [6, 11] }, { k: "headbutt", f: [5, 9] },
  { k: "sunbeam", f: [5, 9] }, { k: "chase", f: [5, 10] }, { k: "share", f: [7, 12] },
];
const MEAN = [
  { k: "hiss", f: [-14, -7] }, { k: "swat", f: [-16, -8] }, { k: "stare", f: [-7, -3] }, { k: "steal", f: [-12, -6] },
];
const SWEET = [{ k: "blink", r: [10, 16] }, { k: "gift", r: [12, 18] }, { k: "serenade", r: [11, 17] }, { k: "cuddle", r: [12, 18], f: [3, 6] }];
const roll = (r) => r[0] + Math.random() * (r[1] - r[0]);
const hungry = (c, now) => now - c.fed > 24 * HOUR;
function inLoveWith(room, c) { // the cat c is in love with, if any (romance 70+, the highest)
  let best = null, top = 69;
  for (const o of room.cats) { if (o === c) continue; const r = (room.rel[pair(c.id, o.id)] || {}).r || 0; if (r > top) { top = r; best = o; } }
  return best;
}

// One meeting between a and b. bias > 0 tips it toward going well.
function interact(room, a, b, now, bias) {
  const rel = relOf(room, a.id, b.id);
  const ta = a.traits || {}, tb = b.traits || {};
  let score = 0.12 + ((ta.friendly || 0.5) + (tb.friendly || 0.5)) * 0.25 + rel.f / 220 - (ta.bossy || 0.5) * 0.35
    - (hungry(a, now) ? 0.22 : 0) + (Math.random() - 0.5) * 0.75 + (bias || 0);
  const before = { f: rel.f, r: rel.r };
  let e;
  if (score > 0.22) {
    const loverA = inLoveWith(room, a), loverB = inLoveWith(room, b);
    const free = (!loverA || loverA === b) && (!loverB || loverB === a);
    if (rel.f >= 40 && free && ((ta.romantic || 0.5) + (tb.romantic || 0.5)) / 2 > 0.3 && Math.random() < 0.38) {
      const s = pick(SWEET);
      rel.r = Math.min(100, Math.round(rel.r + roll(s.r)));
      if (s.f) rel.f = Math.min(100, Math.round(rel.f + roll(s.f)));
      e = { k: s.k, a: a.id, an: a.name, b: b.id, bn: b.name, t: now };
    } else {
      const n = pick(NICE.filter((x) => x.k !== "chase" || (ta.playful || 0.5) > 0.35));
      rel.f = Math.min(100, Math.round(rel.f + roll(n.f)));
      e = { k: n.k, a: a.id, an: a.name, b: b.id, bn: b.name, t: now };
    }
  } else if (score < 0.04) {
    const n = pick(MEAN);
    rel.f = Math.max(-100, Math.round(rel.f + roll(n.f)));
    if (rel.r > 0) rel.r = Math.max(0, Math.round(rel.r - (before.r >= 70 ? 22 : 6)));
    e = { k: n.k, a: a.id, an: a.name, b: b.id, bn: b.name, t: now };
  } else {
    rel.f = Math.min(100, rel.f + 1);
    e = { k: "sniff", a: a.id, an: a.name, b: b.id, bn: b.name, t: now };
  }
  logIt(room, e);
  milestones(room, a, b, before, rel, now);
  return e;
}
// the moments worth their own line in the history
function milestones(room, a, b, before, rel, now) {
  const both = { a: a.id, an: a.name, b: b.id, bn: b.name, t: now + 1 };
  if (before.r < 70 && rel.r >= 70) logIt(room, { k: "love", ...both });
  else if (before.r >= 70 && rel.r < 70) logIt(room, { k: "breakup", ...both });
  if (before.f < 60 && rel.f >= 60 && !rel.bf) { rel.bf = 1; logIt(room, { k: "friends", ...both }); }
  if (before.f > -40 && rel.f <= -40) logIt(room, { k: "rivals", ...both });
  if (before.f <= -40 && rel.f > -10) logIt(room, { k: "makeup", ...both });
}

// ---------- the "coming home" update (Nick, 2026-10-14: build 1-5 and 8) ----------
// Gifts: while its owner is away (3 h+), a cat's turn sometimes turns up something, waiting by its spot until the
// owner comes back and collects it (POST /cats/:id { action: "collect" }); every find is counted in c.gifts.
const GIFTS = [
  { k: "mouse", w: 20 }, { k: "cap", w: 18 }, { k: "hairtie", w: 16 }, { k: "crinkle", w: 14 }, { k: "leaf", w: 14 },
  { k: "feather", w: 8 }, { k: "ribbon", w: 6 }, { k: "sock", w: 6 }, // uncommon
  { k: "bell", w: 2 }, { k: "clover", w: 2 }, { k: "crown", w: 1 }, // rare
];
function maybeGift(room, c, t) {
  if (t - (c.seen || c.born) < 3 * HOUR || (c.newGifts || []).length >= 3 || Math.random() > 0.12) return;
  const g = weighted(GIFTS, (x) => x.w).k;
  c.newGifts = (c.newGifts || []).concat({ k: g, t });
  c.gifts = c.gifts || {};
  c.gifts[g] = (c.gifts[g] || 0) + 1;
  logIt(room, { k: "found", a: c.id, an: c.name, g, t: t + 2 });
}
// Keep apart (an owner's action): those two don't meet for a day, either way round
function apart(a, b, t) { return ((a.apart || {})[b.id] || 0) > t || ((b.apart || {})[a.id] || 0) > t; }
// Room events: a thunderstorm, a sunbeam (a toy event was tried and removed, Nick, 2026-10-15). The cron sometimes starts one; Nick can start one (POST /cats/event).
const EVENTS = { storm: 120 * MIN, sunbeam: 120 * MIN }; // both 2 hours (storms were 90 min; Nick, 2026-10-15)
// ---------- the second update (Nick, 2026-10-15: kittens, kindness, wearing gifts, tricks, adventures, the Times) ----------
// Kittens: two cats in love (a girl and a boy, romance 85+, both grown up) sometimes have one when they cuddle; it mixes
// their looks, belongs to both owners, is small until KITTEN_DAYS old, and its owners name it (action "name").
const KITTEN_DAYS = 14;
const grownUp = (c, t) => !c.kitten || t - c.born > KITTEN_DAYS * 24 * HOUR;
function maybeKitten(room, a, b, t) {
  const rel = relOf(room, a.id, b.id);
  const mom = a.gender === "f" ? a : b.gender === "f" ? b : null, dad = mom === a ? b : a;
  if (!mom || dad.gender !== "m" || rel.r < 85 || !grownUp(a, t) || !grownUp(b, t)) return;
  // rare: about 1 in 100 cuddles (a couple cuddles ~4 times a day: about a month), and 30 days apart at least
  if (t - (rel.kittenAt || 0) < 30 * 24 * HOUR || room.cats.length >= ROOM_MAX || Math.random() > 0.01) return;
  const free = freeSpots(room);
  if (!free.length) return;
  const near = free.filter((s) => SPOTS[s] === SPOTS[mom.spot]);
  const look = mixLook(mom.look, dad.look);
  let base = (mom.name.slice(0, 12) + " Jr").trim(), name = base, n = 2;
  while (room.cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) name = base.slice(0, 13) + " " + n++;
  const owners = [...new Set([...(mom.owners || []), ...(dad.owners || [])])].slice(0, 6);
  const names = [...new Set([mom.ownerName, dad.ownerName].filter(Boolean))];
  const kid = {
    id: newId(), name, ownerName: names.join(" & "), gender: Math.random() < 0.5 ? "f" : "m", look, born: t,
    spot: pick(near.length ? near : free), traits: { friendly: r2(Math.random()), playful: r2(0.5 + Math.random() / 2), bossy: r2(Math.random() / 2), romantic: r2(Math.random()) },
    fed: t, petted: 0, played: 0, seen: Math.max(mom.seen || 0, dad.seen || 0), pinUntil: 0, nextAt: t + gap(),
    owners, ip: "", code: newCode(name, room), nick: mom.nick || dad.nick || undefined, kitten: true, named: false, parents: [mom.id, dad.id],
  };
  room.cats.push(kid);
  rel.kittenAt = t;
  relOf(room, kid.id, mom.id).f = 70; relOf(room, kid.id, dad.id).f = 60; // family
  logIt(room, { k: "kitten", a: mom.id, an: mom.name, b: dad.id, bn: dad.name, c: kid.id, cn: kid.name, t: t + 3 });
}
function mixLook(m, d) {
  const one = () => (Math.random() < 0.5 ? m : d);
  const look = { pattern: one().pattern, base: one().base, second: one().second, eyes: one().eyes, fluffy: one().fluffy, seed: 1 + Math.floor(Math.random() * 9999) };
  if (look.pattern === "colorpoint") look.eyes = "blue";
  if (look.base === look.second) look.second = look.base === "black" ? "white" : "black";
  return look;
}
// Adventures: now and then a cat whose owner is away slips out of the window for 12-30 h, then comes home with a
// postcard (and a third of the time a gift, rarer than the room's)
const POSTCARDS = [
  "Went to the park. Saw a duck. Did not catch the duck.", "Sat on a stranger's porch for six hours. Worth it.",
  "Found a sunny wall. Lay on it. Highly recommend.", "Followed a butterfly very far. Lost the butterfly. Found a snack.",
  "Visited the bakery. They did not want me inside. I went inside.", "Watched the rain from under a car. Very cozy.",
  "Made a friend at the garden centre. Then knocked over a fern.", "Climbed a tree. Thought about it. Came down eventually.",
  "Saw the river. Too wet. Came home.", "Napped in a flower box. The flowers did not mind. Probably.",
];
const AWAY_GIFTS = [{ k: "feather", w: 6 }, { k: "ribbon", w: 5 }, { k: "leaf", w: 5 }, { k: "bell", w: 3 }, { k: "clover", w: 3 }, { k: "crown", w: 1 }];
function maybeAdventure(room, c, t) {
  // about 1 turn in 200 (a cat has ~10 turns a day: one adventure every 2-3 weeks)
  if (c.away || c.kitten && !grownUp(c, t) || (c.pinUntil || 0) > t || t - (c.seen || c.born) < 6 * HOUR || Math.random() > 0.005) return false;
  c.away = { start: t, until: t + (12 + Math.random() * 18) * HOUR };
  logIt(room, { k: "adventure", a: c.id, an: c.name, t });
  return true;
}
function comeHome(room, c) {
  const t = c.away.until, card = { t, text: pick(POSTCARDS) };
  if (Math.random() < 0.33) {
    card.g = weighted(AWAY_GIFTS, (x) => x.w).k;
    c.gifts = c.gifts || {}; c.gifts[card.g] = (c.gifts[card.g] || 0) + 1;
    c.newGifts = (c.newGifts || []).concat({ k: card.g, t }).slice(-3);
  }
  c.postcards = (c.postcards || []).concat(card).slice(-6);
  delete c.away;
  c.nextAt = t + gap();
  logIt(room, { k: "back", a: c.id, an: c.name, text: card.text, g: card.g, t });
}
const isAway = (c, t) => !!(c.away && c.away.until > t);
// Wearing a gift it has found (action "wear")
const WEARABLE = ["ribbon", "bell", "crown", "feather", "clover", "leaf", "sock"];
// The day (in Plano) for check-ins: tricks come from how many different days an owner has looked in
function plano(t) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(t)); }
// The daily sunbeam (Nick, 2026-10-15: "mandatory once a day at 2pm for 2 hours but a storm should overwrite this"):
// 2-4 PM Plano time every day, worked out from the clock (no cron needed); a storm on at the time wins. The first
// look at it each day writes its history line.
function planoHours(t) { // hours since midnight in Plano, with minutes as a fraction
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return +p.hour + +p.minute / 60;
}
function currentEvent(room, now) {
  if (room.event && room.event.until > now) return room.event; // a storm (or one Nick started) comes first
  const h = planoHours(now);
  if (h >= 14 && h < 16) return { k: "sunbeam", start: Math.round(now - (h - 14) * HOUR), until: Math.round(now + (16 - h) * HOUR), daily: true };
  return null;
}
function noteDailySun(room, now) { // its history line, once a day; true if the room changed
  const ev = currentEvent(room, now), day = plano(now);
  if (!ev || !ev.daily || room.sunDay === day) return false;
  room.sunDay = day;
  logIt(room, { k: "event", e: "sunbeam", t: ev.start });
  return true;
}
function startEvent(room, k, now) {
  room.event = { k, start: now, until: now + EVENTS[k] };
  logIt(room, { k: "event", e: k, t: now });
}

// Cats whose owners haven't been back in RETIRE_DAYS move out
function retire(room, now) {
  const gone = room.cats.filter((c) => !c.nick && now - (c.seen || c.born) > RETIRE_DAYS * 24 * HOUR);
  gone.forEach((c) => logIt(room, { k: "movedout", a: c.id, an: c.name, t: now }));
  if (gone.length) room.cats = room.cats.filter((c) => !gone.includes(c));
}

// (admin only now: POST /cats/tick, for testing; the cron and GET /cats use live() above) A burst of cat life: meetings between cats (more often between cats in the same part
// of the room, and between cats that already know each other), cats wandering off to another spot, hungry cats saying so
export function tick(room, now) {
  retire(room, now);
  const cats = room.cats;
  if (cats.length >= 2) {
    const rounds = Math.min(24, Math.max(3, cats.length)); // about one meeting per cat each time
    for (let i = 0; i < rounds; i++) {
      const a = weighted(cats, (c) => 0.6 + (c.traits || {}).friendly + (c.traits || {}).playful);
      const b = weighted(cats.filter((c) => c !== a), (c) => {
        const rel = room.rel[pair(a.id, c.id)] || { f: 0, r: 0 };
        return (SPOTS[c.spot] === SPOTS[a.spot] ? 3 : 1) + Math.abs(rel.f) / 15 + rel.r / 10; // neighbours, and cats they already know
      });
      interact(room, a, b, now + i * 1000, 0);
    }
  }
  // wandering: a cat not recently sent somewhere sometimes moves, often toward a friend
  for (const c of cats) {
    if ((c.pinUntil || 0) > now || Math.random() > 0.3) continue;
    const free = freeSpots(room, c.id).filter((s) => s !== c.spot);
    if (!free.length) break;
    const friend = cats.filter((o) => o !== c && ((room.rel[pair(c.id, o.id)] || {}).f || 0) >= 40).sort(() => Math.random() - 0.5)[0];
    const near = friend ? free.filter((s) => SPOTS[s] === SPOTS[friend.spot]) : [];
    c.spot = pick(near.length && Math.random() < 0.6 ? near : free);
    logIt(room, { k: "wander", a: c.id, an: c.name, s: c.spot, t: now + 30e3 });
  }
  for (const c of cats) {
    if (now - c.fed > 30 * HOUR && now - (c.hungryAt || 0) > 24 * HOUR) {
      c.hungryAt = now;
      logIt(room, { k: "hungry", a: c.id, an: c.name, t: now + 60e3 });
    }
  }
  room.tickAt = now;
  return room;
}
// Each cat's own clock (Nick, 2026-10-14: "sparingly, not so sequential and constant. random times between 5m and
// 4hours with weight towards 2h or greater"): a cat does something at c.nextAt, then waits gap() again. A meeting resets
// both cats' clocks, and only a cat that's been quiet for QUIET (2 h) can be the other one, so being picked never makes a short gap. live() plays out everything that came due, at the time it came due, in order; it runs on every
// GET /cats and on the 4-hourly cron (for when nobody's looking). Returns true if anything happened.
const GAP_MIN = 5, GAP_MAX = 240; // minutes
const QUIET = 2 * HOUR;
// 5 min to 4 h, leaning long: sqrt of a uniform number piles up toward the top (median ~2 h 50 m, about 1 in 4 under 2 h)
function gap() { return (GAP_MIN + (GAP_MAX - GAP_MIN) * Math.sqrt(Math.random())) * 60e3; }
const CATCH_UP = 120; // at most this many things per call (a room nobody has opened for days doesn't replay all of it)
export function live(room, now) {
  const before = room.cats.length;
  retire(room, now);
  let changed = room.cats.length !== before;
  const cats = room.cats;
  for (const c of cats) if (!c.nextAt) { c.nextAt = now + gap(); changed = true; } // cats from before the clocks
  for (const c of cats) if (c.away && c.away.until <= now) { comeHome(room, c); changed = true; } // back from an adventure
  for (const c of cats) if (c.away && c.nextAt < c.away.until) c.nextAt = c.away.until + gap(); // nothing happens while it's out
  for (let n = 0; n < CATCH_UP; n++) {
    const a = cats.reduce((m, c) => (!m || c.nextAt < m.nextAt ? c : m), null);
    if (!a || a.nextAt > now) break;
    const t = a.nextAt;
    changed = true;
    if (t - a.fed > 30 * HOUR && t - (a.hungryAt || 0) > 24 * HOUR) { a.hungryAt = t; logIt(room, { k: "hungry", a: a.id, an: a.name, t: t + 1 }); }
    // lovers (Nick: "if 2 are lovers they cuddle together more often"): 3 in 4 of a cat's turns go to its love, if
    // they're quiet too: a cuddle, and it settles next to them
    maybeGift(room, a, t);
    if (maybeAdventure(room, a, t)) { a.lastAt = t; a.nextAt = a.away.until + gap(); continue; }
    const lover = inLoveWith(room, a);
    if (lover && !isAway(lover, t) && !apart(a, lover, t) && t - (lover.lastAt || 0) >= QUIET && Math.random() < 0.75) {
      cuddle(room, a, lover, t);
      a.lastAt = lover.lastAt = t; lover.nextAt = t + gap();
      a.nextAt = t + gap();
      continue;
    }
    const roam = cats.length < 2 || ((a.pinUntil || 0) <= t && Math.random() < 0.2);
    const b = roam ? null : partner(room, a, t);
    if (roam) { wander(room, a, t); a.lastAt = t; }
    else if (b) {
      interact(room, a, b, t, 0);
      a.lastAt = b.lastAt = t; b.nextAt = t + gap(); // that was its turn too
    } // (no quiet cat to meet: this turn passes with nothing in the history, and it can still be picked by another cat)
    // after a turn that came up empty, try again before its 4 hours are up
    a.nextAt = t + (a.lastAt === t ? gap() : Math.min(gap(), Math.max(GAP_MIN * 60e3, (a.lastAt || t) + GAP_MAX * 60e3 - t)));
  }
  // still behind after CATCH_UP (a long quiet spell): start everyone's clock again from now
  for (const c of cats) if (c.nextAt <= now) c.nextAt = now + gap();
  if (changed) room.tickAt = now;
  return changed;
}
function partner(room, a, t) { // a cat that's been quiet for 2 hours or more; neighbours, and cats they already know
  const quiet = room.cats.filter((c) => c !== a && !isAway(c, t) && t - (c.lastAt || 0) >= QUIET && !apart(a, c, t));
  if (!quiet.length) return null;
  return weighted(quiet, (c) => {
    const rel = room.rel[pair(a.id, c.id)] || { f: 0, r: 0 };
    return (SPOTS[c.spot] === SPOTS[a.spot] ? 3 : 1) + Math.abs(rel.f) / 15 + rel.r / 10 + (rel.r >= 70 ? 12 : 0);
  });
}
function cuddle(room, a, b, t) { // two cats in love curl up together: closer still, and a moves next to b if there's room
  const rel = relOf(room, a.id, b.id);
  rel.r = Math.min(100, Math.round(rel.r + roll([3, 7])));
  rel.f = Math.min(100, Math.round(rel.f + roll([2, 5])));
  if ((a.pinUntil || 0) <= t) {
    const near = freeSpots(room, a.id).filter((s) => s !== a.spot && SPOTS[s] === SPOTS[b.spot]);
    if (near.length && SPOTS[a.spot] !== SPOTS[b.spot]) a.spot = pick(near);
  }
  logIt(room, { k: "cuddle", a: a.id, an: a.name, b: b.id, bn: b.name, t });
  maybeKitten(room, a, b, t);
}
function wander(room, c, t) { // off to another free spot, often toward a friend
  const free = freeSpots(room, c.id).filter((s) => s !== c.spot);
  if (!free.length) return;
  const lover = inLoveWith(room, c);
  const friend = lover || room.cats.filter((o) => o !== c && ((room.rel[pair(c.id, o.id)] || {}).f || 0) >= 40).sort(() => Math.random() - 0.5)[0];
  const near = friend ? free.filter((s) => SPOTS[s] === SPOTS[friend.spot]) : [];
  c.spot = pick(near.length && Math.random() < (lover ? 0.85 : 0.6) ? near : free); // a cat in love mostly heads for its love
  logIt(room, { k: "wander", a: c.id, an: c.name, s: c.spot, t });
}
function weighted(list, w) {
  const ws = list.map((x) => Math.max(0.01, w(x))), sum = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

// the cron's part (index.js scheduled(), every 4 hours)
export async function catsTick(env) {
  const room = await load(env);
  if (!room.cats.length) return;
  let changed = live(room, Date.now());
  if (!(room.event && room.event.until > Date.now()) && Math.random() < 0.25) { // now and then, something happens to everyone
    startEvent(room, "storm", Date.now()); // only storms at random now: the sunbeam comes every day at 2 PM (currentEvent)
    changed = true;
  }
  if (changed) await save(env, room);
  await snapshot(env, room);
}
