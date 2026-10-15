// Scorecard (extras/scorecard/): Nick's score tracker for real golf courses (SCORECARD-PLAN.md phases 1-2).
// OWNER ONLY until SCORECARD_PUBLIC is "1" in wrangler.toml: until then every route but /scorecard/status needs the
// admin token (/scorecard/feed answers visitors with no rounds). Flipping it (and redeploying) opens the page and its Extras card to everyone.
//
//   GET    /scorecard/status              { public, owner }: the page and the Extras card ask this to show themselves
//   GET    /scorecard/feed                Nick's finished rounds marked for his site (Golf page, home Lately strip); empty
//                                         for visitors while the Scorecard is owner only (Nick: everything his until launch)
//   GET    /scorecard/feed/:id            one of those rounds in full, for drawing its scorecard on the Golf page
//   GET    /scorecard/courses/search?q=   { courses: [{ apiId, name, place, par, holes }] }  (OpenGolfAPI search)
//   GET    /scorecard/courses/api/:id     one OpenGolfAPI course, cleaned into the app's course shape (see clean())
//   GET    /scorecard/courses             the approved course files: [{ id, name, place, version, ownerChecked }]
//   GET    /scorecard/courses/:id         a course's newest approved file, with checked: { version, owner, at }
//   POST   /scorecard/courses/:id/approve { visitorId, course } -> a new version of its course file. Nick's approvals
//                                         always count; a visitor's only while the course has no file yet
//   POST   /scorecard/art                 Nick only: { image: data URL } -> { path }: a course's card picture, kept in R2
//                                         (scorecard/art/<hash>.png in nickmade-photos); GET /scorecard/art/<name> serves it
//   GET    /scorecard/handicap            Nick's handicap index from his Golf-page rounds (see handicap())
//   DELETE /scorecard/courses/:id         Nick only: removes a saved card (every version); rounds keep their own copy
//   GET    /scorecard/rounds?visitorId=   this player's rounds (summaries, newest first)
//   GET    /scorecard/rounds/:id?visitorId=  one round in full (the course as played, every hole)
//   PUT    /scorecard/rounds/:id          { visitorId, round, course?, scores, present } -> saves a round: the header,
//                                         the holes changed since the last save, and which holes have scores at all
//                                         (the rest are deleted). Safe to repeat; per hole, the newest change wins
//   DELETE /scorecard/rounds/:id?visitorId=
//   POST   /scorecard/me/code             { visitorId } -> { code }: a recovery code for using these rounds on
//                                         another phone (visitors; Nick is the owner on every device)
//   POST   /scorecard/me/claim            { visitorId, code } -> this browser joins the code's player (its own
//                                         rounds move over)
//   GET    /scorecard/lookup?site=&name=  the course's own scorecard on its website (phase 3): reads the homepage and the
//                                         pages it links that look like course or scorecard pages, and lists the PDFs
//                                         and images that look like the card, best first: { candidates: [{ url, label,
//                                         dated, kind }] }. Checks robots.txt; never third-party sites. Cached 7 days.
//                                         &given=1: a link the player pasted: the page it names (its cards from any
//                                         site), or a card image/PDF itself. { blocked: true } when the site refuses
//   GET    /scorecard/file?u=             one of those files, passed through (course sites don't allow a browser to
//                                         read them directly); only URLs a lookup found
//   POST   /scorecard/read                { visitorId, image: "data:image/jpeg;base64,...", part: "all"|"front"|"back",
//                                         holes } -> { read }: the card reader (phase 3), a scorecard picture read into
//                                         numbers by a Workers AI vision model (READ_MODEL). The phone does the image
//                                         work (shrinking, cutting the card in halves) and the sums checks; this only
//                                         asks the model. Visitors get READS_PER_DAY, everyone together READS_DAY_ALL
//                                         (the free plan's 10,000 neurons a day; a read is roughly 100-300)
//
// Players: Nick's admin token is the player "owner" on any device. A visitor is their browser's visitor id (the
// site's nm-visitor, hashed with SALT); a recovery code adds another way in to the same player. Rounds, players and
// course files live in D1 (GOLF, migrations/0001_scorecard.sql).
//
// Course data is from OpenGolfAPI (https://opengolfapi.org, ODbL, keyless, ~500 calls a day per caller), cached in
// KV so each course costs one call a month: scorecard:search:<q> (7 days), scorecard:api:<id> (30 days).
// Nick's own courses (Pecan Hollow, Firewheel Old) are hand-made files in extras/scorecard/courses/, not from here.

const OGA = "https://api.opengolfapi.org";
const DAY = 86400;
const ID = /^[0-9a-f-]{36}$/;

const VID = /^[a-z0-9-]{8,64}$/i;
const RID = /^[a-z0-9-]{8,64}$/i;
const ONE = "(?:api:[0-9a-f-]{36}|[a-z0-9-]{3,60})";
const CID = new RegExp("^(" + ONE + "|nines:" + ONE + "\\+" + ONE + ")$"); // nines:<front>+<back>: two nines played as one 18
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODES = 6;  // recovery codes a player can have
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function scorecardRoute(request, url, env, cors, h) {
  const open = env.SCORECARD_PUBLIC === "1";
  const owner = h.isAdmin(request, env);
  if (url.pathname === "/scorecard/status" && request.method === "GET") return h.json({ public: open, owner }, 200, cors);
  if (!url.pathname.startsWith("/scorecard/")) return null;
  if (url.pathname === "/scorecard/feed" && request.method === "GET" && !open && !owner) return h.json({ rounds: [] }, 200, cors);
  if (url.pathname === "/scorecard/handicap" && request.method === "GET" && !open && !owner) return h.json({ index: null, rounds: [] }, 200, cors);
  // a course's own card picture (Nick's rounds there are written onto it, card.js): anyone can load it
  if (url.pathname.startsWith("/scorecard/art/") && request.method === "GET") {
    const name = url.pathname.slice(15);
    if (!env.PHOTOS || !/^[0-9a-f]{24}\.(png|webp|jpg)$/.test(name)) return new Response("Not found", { status: 404, headers: cors });
    const obj = await env.PHOTOS.get("scorecard/art/" + name);
    if (!obj) return new Response("Not found", { status: 404, headers: cors });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png",
      "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
  }
  if (url.pathname === "/scorecard/art" && request.method === "POST") {
    if (!owner) return h.json({ error: "Only Nick can save a card's picture." }, 403, cors);
    if (!env.PHOTOS) return h.json({ error: "Picture storage isn't set up." }, 503, cors);
    const b = await body(request, 6000000);
    const m = b && /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(b.image || "");
    if (!m) return h.json({ error: "Send a PNG, WebP or JPEG." }, 400, cors);
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    if (bytes.length > 4000000) return h.json({ error: "That picture is too big." }, 413, cors);
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const name = (await h.sha256(m[2])).slice(0, 24) + "." + ext; // named by its contents: the same picture is stored once
    await env.PHOTOS.put("scorecard/art/" + name, bytes, { httpMetadata: { contentType: "image/" + m[1] } });
    return h.json({ path: "/scorecard/art/" + name }, 200, cors);
  }
  if (!open && !owner) return h.json({ error: "Not available." }, 401, cors);
  if (url.pathname === "/scorecard/feed" && request.method === "GET") return feed(env, cors, h);
  if (url.pathname === "/scorecard/handicap" && request.method === "GET") return h.json(await handicap(env), 200, cors);
  if (url.pathname.startsWith("/scorecard/feed/") && request.method === "GET") {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!env.GOLF || !RID.test(id)) return h.json({ error: "Not found." }, 404, cors);
    const ok = await env.GOLF.prepare("SELECT id FROM rounds WHERE id = ? AND player_id = 'owner' AND on_site = 1 AND finished_at IS NOT NULL").bind(id).first();
    if (!ok) return h.json({ error: "Not found." }, 404, cors);
    return fullRound(id, "owner", env, cors, h);
  }

  if (url.pathname === "/scorecard/courses/search" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (q.length < 3) return h.json({ courses: [] }, 200, cors);
    const key = "scorecard:search:" + q.toLowerCase();
    const hit = await env.QUEUE.get(key);
    if (hit) return h.json(JSON.parse(hit), 200, cors);
    const d = await oga("/v1/courses/search?q=" + encodeURIComponent(q));
    if (!d) return h.json({ error: "Course search isn't answering. Try again in a bit." }, 502, cors);
    const out = {
      courses: (d.courses || []).slice(0, 25).map((c) => ({
        apiId: c.id, name: c.course_name || c.name, place: [c.city, c.state].filter(Boolean).join(", "),
        par: c.par || null, holes: c.holes || null,
      })),
    };
    await env.QUEUE.put(key, JSON.stringify(out), { expirationTtl: 7 * DAY });
    return h.json(out, 200, cors);
  }

  // OpenGolfAPI's Cloudflare shield turns this Worker away (403 "Attention Required"), so when the GET above fails the
  // app fetches the course from OpenGolfAPI itself and sends it here to be put in the app's shape. Not cached: it
  // came from a browser, not from OpenGolfAPI directly.
  if (url.pathname.startsWith("/scorecard/courses/api/") && request.method === "POST") {
    const id = url.pathname.split("/")[4] || "";
    const d = await body(request);
    if (!ID.test(id) || !d || d.id !== id) return h.json({ error: "Couldn't load that course." }, 400, cors);
    return h.json(clean(d), 200, cors);
  }

  if (url.pathname.startsWith("/scorecard/courses/api/") && request.method === "GET") {
    const id = url.pathname.split("/")[4] || "";
    if (!ID.test(id)) return h.json({ error: "Unknown course." }, 404, cors);
    const key = "scorecard:api:" + id;
    const hit = await env.QUEUE.get(key);
    if (hit) return h.json(JSON.parse(hit), 200, cors);
    const d = await oga("/api/v1/courses/" + id);
    if (!d || !d.id) return h.json({ error: "Couldn't load that course. Try again in a bit." }, 502, cors);
    const course = clean(d);
    await env.QUEUE.put(key, JSON.stringify(course), { expirationTtl: 30 * DAY });
    return h.json(course, 200, cors);
  }

  if (!env.GOLF) return h.json({ error: "Saving isn't set up yet." }, 503, cors);
  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p)); // ["scorecard", "rounds", id]
  const m = request.method;
  if (parts[1] === "courses" && parts.length === 2 && m === "GET") return listCourses(env, cors, h);
  if (parts[1] === "courses" && parts.length === 3 && m === "GET") return getCourse(parts[2], env, cors, h);
  if (parts[1] === "courses" && parts.length === 4 && parts[3] === "approve" && m === "POST") return approve(request, parts[2], env, cors, h);
  if (parts[1] === "courses" && parts.length === 3 && m === "DELETE") { // Nick only: a saved card goes, every version of it
    if (!owner) return h.json({ error: "Only Nick can remove a saved card." }, 403, cors);
    if (!CID.test(parts[2])) return h.json({ error: "Unknown course." }, 404, cors);
    await env.GOLF.batch([
      env.GOLF.prepare("DELETE FROM course_records WHERE course_id = ?").bind(parts[2]),
      env.GOLF.prepare("DELETE FROM courses WHERE id = ?").bind(parts[2]),
    ]);
    return h.json({ removed: true }, 200, cors);
  }
  if (parts[1] === "rounds" && parts.length === 2 && m === "GET") return listRounds(request, url, env, cors, h);
  if (parts[1] === "rounds" && parts.length === 3) {
    if (m === "GET") return getRound(request, url, parts[2], env, cors, h);
    if (m === "PUT") return putRound(request, parts[2], env, cors, h);
    if (m === "DELETE") return deleteRound(request, url, parts[2], env, cors, h);
  }
  if (parts[1] === "me" && parts[2] === "code" && m === "POST") return newCode(request, env, cors, h);
  if (parts[1] === "read" && parts.length === 2 && m === "POST") return readCard(request, env, cors, h);
  if (parts[1] === "lookup" && parts.length === 2 && m === "GET") return lookup(url, env, cors, h);
  if (parts[1] === "file" && parts.length === 2 && m === "GET") return passFile(url, env, cors, h);
  if (parts[1] === "me" && parts[2] === "claim" && m === "POST") return claim(request, env, cors, h);
  return null;
}

// ---------- players ----------

// Who's asking: Nick (admin token) is "owner" everywhere; a visitor is their browser id, made into a player the first
// time they save something (create), else null
async function player(request, env, h, vid, create) {
  const now = new Date().toISOString();
  if (h.isAdmin(request, env)) {
    await env.GOLF.prepare("INSERT OR IGNORE INTO players (id, owner, created_at) VALUES ('owner', 1, ?)").bind(now).run();
    return { id: "owner", owner: true };
  }
  if (!VID.test(vid || "")) return null;
  const key = await h.sha256((env.SALT || "nickmade") + "scorecard:" + vid);
  const row = await env.GOLF.prepare("SELECT player_id FROM player_keys WHERE key_hash = ?").bind(key).first();
  if (row) return { id: row.player_id, owner: false, key };
  if (!create) return null;
  const id = crypto.randomUUID();
  await env.GOLF.batch([
    env.GOLF.prepare("INSERT INTO players (id, owner, created_at) VALUES (?, 0, ?)").bind(id, now),
    env.GOLF.prepare("INSERT INTO player_keys (key_hash, player_id, kind, created_at) VALUES (?, ?, 'browser', ?)").bind(key, id, now),
  ]);
  return { id, owner: false, key };
}

async function body(request, max) {
  if (Number(request.headers.get("Content-Length") || 0) > (max || 300000)) return null;
  try { return await request.json(); } catch (e) { return null; }
}

function normCode(c) { return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

async function newCode(request, env, cors, h) {
  const b = (await body(request)) || {};
  const me = await player(request, env, h, b.visitorId, true);
  if (!me) return h.json({ error: "Missing this browser's id." }, 400, cors);
  if (me.owner) return h.json({ error: "In owner mode your rounds are on every device already." }, 400, cors);
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
  const code = raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8);
  const hash = await h.sha256((env.SALT || "nickmade") + "scorecard-code:" + raw);
  const now = new Date().toISOString();
  // keep the newest CODES codes; older ones stop working
  await env.GOLF.batch([
    env.GOLF.prepare("INSERT INTO player_keys (key_hash, player_id, kind, created_at) VALUES (?, ?, 'code', ?)").bind(hash, me.id, now),
    env.GOLF.prepare("DELETE FROM player_keys WHERE player_id = ? AND kind = 'code' AND key_hash NOT IN " +
      "(SELECT key_hash FROM player_keys WHERE player_id = ? AND kind = 'code' ORDER BY created_at DESC LIMIT ?)").bind(me.id, me.id, CODES),
  ]);
  return h.json({ code }, 200, cors);
}

async function claim(request, env, cors, h) {
  const b = (await body(request)) || {};
  if (h.isAdmin(request, env)) return h.json({ error: "In owner mode your rounds are on every device already." }, 400, cors);
  if (!VID.test(b.visitorId || "")) return h.json({ error: "Missing this browser's id." }, 400, cors);
  const raw = normCode(b.code);
  if (raw.length !== 12) return h.json({ error: "That code isn't right. It looks like ABCD-EFGH-JKMN." }, 400, cors);
  const hash = await h.sha256((env.SALT || "nickmade") + "scorecard-code:" + raw);
  const target = await env.GOLF.prepare("SELECT player_id FROM player_keys WHERE key_hash = ? AND kind = 'code'").bind(hash).first();
  if (!target) return h.json({ error: "That code isn't right. Check it and try again." }, 404, cors);
  const key = await h.sha256((env.SALT || "nickmade") + "scorecard:" + b.visitorId);
  const mine = await env.GOLF.prepare("SELECT player_id FROM player_keys WHERE key_hash = ?").bind(key).first();
  const now = new Date().toISOString();
  const stmts = [];
  if (mine && mine.player_id !== target.player_id) {
    // this browser's own rounds come along
    stmts.push(env.GOLF.prepare("UPDATE rounds SET player_id = ? WHERE player_id = ?").bind(target.player_id, mine.player_id));
    stmts.push(env.GOLF.prepare("UPDATE player_keys SET player_id = ? WHERE key_hash = ?").bind(target.player_id, key));
  } else if (!mine) {
    stmts.push(env.GOLF.prepare("INSERT INTO player_keys (key_hash, player_id, kind, created_at) VALUES (?, ?, 'browser', ?)").bind(key, target.player_id, now));
  }
  if (stmts.length) await env.GOLF.batch(stmts);
  return h.json({ ok: true }, 200, cors);
}

// ---------- the card reader ----------

// Picked by testing on Pecan Hollow's and Firewheel's real cards (2026-10-10): Mistral Small 3.1 read every yardage,
// par and handicap on both. Llama 4 Scout matched it on one card only; GLM-5.3 and Kimi need the paid plan.
const READ_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const READ_MODELS = ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-4-scout-17b-16e-instruct"]; // owner can try the other
const READS_PER_DAY = 8;
const READS_DAY_ALL = 60;

// No real-looking numbers in the example: on tiny print a model will copy them (it once read "70.5/130" off Firewheel)
const SHAPE = (n, from, extra) => `{"tees": [{"name": "<tee name>", "color": "<color>", "rating": <number or null>, "slope": <number or null>, "yards": [<${n} numbers, holes ${from} to ${from + n - 1}>]${extra.tee}, "alt": {}}], ` +
  `"par": [<${n} numbers>]${extra.par}, "hcp": [<${n} numbers>], "hcpWomen": [<${n} numbers>] or null}`;
const RULES = `Rules:
- Tees are the rows of yardages, named by color (Gold, Blue, White, Red...) or by name (Championship, Forward...). List every one, top to bottom as printed, including any printed below the Par row.
- rating and slope are the two small numbers often printed by the tee name (rating has a decimal point, slope is a whole number), written rating/slope. Use null if they aren't printed or you can't read them clearly.
- A cell with two numbers stacked (like 444 over 406): put the top one in yards and the bottom one in alt, keyed by hole number, like {"6": 406}.
- hcp is the handicap (stroke index) row, numbers 1 to 18. If there are two handicap rows (men's and women's), the second is hcpWomen.
- Every list has exactly one value per hole, in hole order. If a cell is blank or you can't read it, put null in its place so the holes stay lined up; never skip a cell.
- A par cell showing two pars like 4/5, and par totals like 36/37: use the first number. (Yardage cells with two numbers follow the alt rule above.)
- color is the row's background color in one plain word.
- If you can't read a number, use null. Never guess a number.
Reply with the JSON only, no other words.`;
const ASK = {
  all: (n) => `This is a golf course scorecard. Read every number exactly as printed and reply with JSON in this shape:\n` +
    SHAPE(n, 1, { tee: ', "out": <number>, "in": <number>, "total": <number>', par: ', "parOut": <number>, "parIn": <number>, "parTotal": <number>' }) + "\n" + RULES,
  front: () => `This is the left half of a golf course scorecard: the row names and holes 1 to 9, with the OUT column. ` +
    `Read every number exactly as printed and reply with JSON in this shape:\n` +
    SHAPE(9, 1, { tee: ', "out": <number>', par: ', "parOut": <number>' }) + "\n" + RULES,
  back: () => `This is the right half of a golf course scorecard: holes 10 to 18 with the IN and TOT (total) columns. The row names ` +
    `are on the other half, so for each tee row give its background color and leave name as null. Read every number exactly as printed ` +
    `and reply with JSON in this shape:\n` + SHAPE(9, 10, { tee: ', "in": <number>, "total": <number>', par: ', "parIn": <number>, "parTotal": <number>' }) + "\n" + RULES,
};

// A 27-hole club's card (Breckenridge: Beaver, Bear, Elk side by side, each numbered 1-9 with its own par and handicap
// rows, and a rating table per pair of nines): every nine, for the app to take the one or two being played
// One nine of a 27-hole card, cut out by the app (cardgrid.js finds the grid) with the card's row names put back on its
// left: a short read (about 15 s), so the nines are read side by side instead of in one read that can pass a minute
ASK.nine = () => `This is one nine of a golf course scorecard: the row names on the left, then holes 1 to 9 and the nine's total column. ` +
  `Read every number exactly as printed and reply with JSON in this shape:\n` +
  SHAPE(9, 1, { tee: ', "out": <number>', par: ', "parOut": <number>' }).replace(/}$/, ', "nine": "<the nine\'s name: a big faded word printed across it, or null>"}') + "\n" + RULES;

// Beside the nine-by-nine reads of a 27-hole card: just the nines' names (left to right) and the rating / slope tables.
// A short reply, so it comes back in seconds (the whole card's every number in one read can pass the minute Workers
// AI allows, and did on Breckenridge's JPG, 2026-10-12)
// One nine of a card that was filled in by hand (a played round, scanned): every row top to bottom, which are
// handwritten, and what's in each box, so the app can import the round and wipe the handwriting off the card picture
ASK.played = () => `This is one nine of a golf scorecard that was filled in by hand: the row names on the left, then holes 1 to 9 and the nine's total column. ` +
  `List EVERY row of the grid from top to bottom, including empty rows, and reply with JSON only:\n` +
  `{"rows": [{"label": "<the row's name, printed or handwritten, or empty>", "hand": <true if the row's boxes or name are handwritten>, ` +
  `"cells": [<9 entries for holes 1 to 9: the number in the box, "check" for a check mark, or null if empty>], "total": <the number in the total column or null>}]}\n` +
  `Rules:
- Never skip a row, even an empty one: the number of rows must match the grid.
- Read handwritten numbers carefully; if one can't be read, use null.
Reply with the JSON only, no other words.`;

ASK.meta = () => `This golf scorecard shows one or more nines side by side. Reply with JSON only:\n` +
  `{"nines": ["<each nine's own name, left to right, one word: the big faded word printed across it; if there is none, the FIRST name of the rating heading printed under that nine (under NORTH / SOUTH, give NORTH)>"], ` +
  `"ratings": [{"nines": "<the heading as printed, like NORTH / SOUTH>", "tees": [{"color": "<the row's color>", "rating": <number>, "slope": <number>, "women": <true if marked W>}]}]}\n` +
  `ratings: every rating / slope table on the card, one entry per heading. A table has one row per tee color (gold, blue, green, silver or gray, red...), then rows whose numbers end in W (women). List every row top to bottom, including the silver or gray one. Use [] if there is no table. Never guess a number.`;

ASK.nines = () => `This golf scorecard shows one or more nines side by side. Each nine has holes numbered 1 to 9, a TOT 9 column, and its own Par and Handicap rows. ` +
  `A nine usually has a name: a big faded word printed across it, or the names in a rating table (like "NORTH / SOUTH"). ` +
  `The tee names are often written only on the leftmost nine; on the other nines use the name of the leftmost row with the same color. ` +
  `Read every number exactly as printed and reply with JSON in this shape:\n` +
  `{"nines": [{"name": "<the nine's name or null>", "tees": [{"name": "<tee name>", "color": "<color>", "yards": [<9 numbers>], "total": <the TOT 9 number>}], ` +
  `"par": [<9 numbers>], "parTotal": <number>, "hcp": [<9 numbers>], "hcpWomen": [<9 numbers>] or null}], ` +
  `"ratings": [{"nines": "<the heading as printed, like NORTH / SOUTH>", "tees": [{"color": "<the row's color>", "rating": <number>, "slope": <number>, "women": <true if marked W>}]}]}\n` +
  `Rules:
- List the nines left to right as printed. Every nine has the same tee rows: give each nine every one of them, top to bottom, including the row printed below the Par row (often a forward tee in red), even where its name is only written on the leftmost nine.
- hcp is the Handicap row just under the upper tee rows. A second Handicap row, under the lower tee row, is hcpWomen; give it for every nine that has one.
- ratings: every rating / slope table on the card, one entry per heading. A table has one row per tee color, in the same colors as the tee rows (gold, blue, green, silver or gray, red...), then rows whose numbers end in W (women). List every row top to bottom, including the silver or gray one; women is true only for the rows marked W. Use [] if there is no table.
- Every list has exactly one value per hole, in hole order. If a cell is blank or you can't read it, put null in its place; never skip a cell.
- color is the row's background color in one plain word.
- Never guess a number.
Reply with the JSON only, no other words.`;

// the first {...} block in the model's reply (some wrap it in ```json fences or add a sentence)
function firstJson(text) {
  const t = String(text || "").replace(/```(?:json)?/g, "");
  const a = t.indexOf("{"), z = t.lastIndexOf("}");
  if (a < 0 || z <= a) return null;
  try { return JSON.parse(t.slice(a, z + 1)); } catch (e) { return null; }
}

async function readCard(request, env, cors, h) {
  if (!env.AI) return h.json({ error: "The card reader isn't set up." }, 503, cors);
  const b = await body(request, 3500000);
  if (!b || !/^data:image\/(jpeg|png|webp);base64,/.test(b.image || "") || b.image.length > 3400000) {
    return h.json({ error: "Send the card as a JPEG or PNG under about 2.5 MB." }, 400, cors);
  }
  const me = await player(request, env, h, b.visitorId, true);
  if (!me) return h.json({ error: "Missing this browser's id." }, 400, cors);
  // a card from a course website (a file a lookup found) is read once, for everyone
  const fileKey = /^https?:\/\//.test(b.source || "") && (await env.QUEUE.get("scorecard:file:" + (await h.sha256(b.source))))
    ? "scorecard:read:" + (await h.sha256(b.source + "|" + (b.part || "all"))) : null; // the whole card and each close-up kept apart
  if (fileKey && !b.model) {
    const hit = await env.QUEUE.get(fileKey);
    if (hit) return h.json(JSON.parse(hit), 200, cors);
  }
  const part = ASK[b.part] ? b.part : "all";
  const n = b.holes === 9 ? 9 : 18;
  const model = me.owner && READ_MODELS.indexOf(b.model) >= 0 ? b.model : READ_MODEL;
  // the day's allowance: per visitor, and for everyone together (Nick's own reads count only toward the total)
  const day = new Date().toISOString().slice(0, 10);
  const allKey = "scorecard:reads:" + day, myKey = "scorecard:reads:" + me.id + ":" + day;
  const [all, mine] = await Promise.all([env.QUEUE.get(allKey), me.owner ? null : env.QUEUE.get(myKey)]);
  if (+all >= READS_DAY_ALL || (!me.owner && +mine >= READS_PER_DAY)) {
    return h.json({ error: "The card reader has done all it can for today. Type the numbers in, or try again tomorrow." }, 429, cors);
  }
  let out, err;
  // a PDF's own printed text (the app pulls it from the file): exact numbers for the model to place
  const text = typeof b.text === "string" && b.text.trim() ? b.text.replace(/\s+/g, " ").trim().slice(0, 4000) : "";
  const prompt = ASK[part](n) + (text ? "\n\nThe card's own printed text, taken exactly from the file in reading order. Use these numbers; the picture shows where each belongs:\n" + text : "");
  const ask = { messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: b.image } }] }],
    max_tokens: part === "nines" ? 5000 : 2500, temperature: 0 };
  for (let tries = 0; tries < 2 && !out; tries++) { // Workers AI sometimes fails a request outright; once more usually works
    if (tries) await new Promise((r) => setTimeout(r, 1500));
    try { out = await env.AI.run(model, ask); } catch (e) { err = e; }
  }
  // Workers AI's free daily allowance (10,000 neurons, reset at midnight UTC) used up: say so, not "in a moment"
  if (!out && /4006|daily free allocation/i.test(String(err && (err.message || err)))) {
    return h.json({ error: "The card reader has done all it can for today. Type the numbers in, or try again tomorrow." }, 429, cors);
  }
  if (!out) return h.json({ error: "The card reader couldn't read that one just now. Try again in a moment.", detail: me.owner ? String(err && (err.message || err)) : undefined }, 502, cors);
  const ops = [env.QUEUE.put(allKey, String(+all + 1), { expirationTtl: 2 * DAY })];
  if (!me.owner) ops.push(env.QUEUE.put(myKey, String(+mine + 1), { expirationTtl: 2 * DAY }));
  await Promise.all(ops);
  const reply = out && (out.response ?? (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content));
  const read = typeof reply === "object" && reply ? reply : firstJson(reply);
  if (!read) return h.json({ error: "The card reader couldn't make sense of that photo. Try a straighter, closer one.", raw: me.owner ? reply : undefined }, 502, cors);
  if (fileKey && !b.model) await env.QUEUE.put(fileKey, JSON.stringify({ read, part, model }), { expirationTtl: 30 * DAY });
  return h.json({ read, part, model, raw: me.owner && b.raw ? reply : undefined }, 200, cors);
}

// ---------- finding the course's own card on its website ----------

const UA = "Mozilla/5.0 (compatible; nickmade-scorecard/1.0; +https://nickmade.net/extras/scorecard/)";
const CARDISH = /score\s*-?_?card|scorecard|yardage|course[-_ ]?(guide|layout|map)/i;
const PAGEISH = /score\s*-?_?card|course|layout|the-course|golf|rates|yardage|tour/i;
const FILE = /\.(pdf|jpe?g|png|webp)(?:[?#]|$)/i;

const host = (x) => x.hostname.replace(/^www\./, ""); // http/https and www. or not: the same site

function publicHost(u) {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && x.hostname.includes(".") && !/^(\d+\.){3}\d+$/.test(x.hostname) && !/localhost|\.local$|\.internal$/i.test(x.hostname) ? x : null;
  } catch (e) { return null; }
}

// robots.txt's rules for everyone (User-agent: *): a path is allowed unless a Disallow prefix matches it
async function robots(origin) {
  const rules = [];
  try {
    const r = await fetch(origin + "/robots.txt", { headers: { "User-Agent": UA } });
    if (r.ok) {
      let mine = false;
      (await r.text()).split(/\r?\n/).forEach((line) => {
        const m = /^\s*(user-agent|disallow)\s*:\s*(.*?)\s*$/i.exec(line.replace(/#.*/, ""));
        if (!m) return;
        if (m[1].toLowerCase() === "user-agent") mine = m[2] === "*";
        else if (mine && m[2]) rules.push(m[2].replace(/\*.*$/, ""));
      });
    }
  } catch (e) {}
  return (path) => !rules.some((d) => d && path.startsWith(d));
}

// every link and image on a page: [{ url, text }]; throws when the site refuses (403 etc.) or can't be reached
async function linksOf(pageUrl) {
  const r = await fetch(pageUrl, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
  if (r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500) throw new Error("refused " + r.status);
  if (!r.ok || !/html/i.test(r.headers.get("Content-Type") || "")) return [];
  const out = [];
  let cur = null;
  const abs = (v) => { try { return new URL(v, r.url).href; } catch (e) { return null; } };
  await new HTMLRewriter()
    .on("a[href]", { element(el) { cur = { url: abs(el.getAttribute("href")), text: "" }; out.push(cur); }, text(t) { if (cur) cur.text += t.text; } })
    .on("img[src]", { element(el) { out.push({ url: abs(el.getAttribute("src")), text: el.getAttribute("alt") || "" }); } })
    .on("iframe[src], embed[src], object[data]", { element(el) { out.push({ url: abs(el.getAttribute("src") || el.getAttribute("data")), text: "" }); } })
    .transform(r).arrayBuffer();
  return out.filter((l) => l.url).map((l) => ({ url: l.url.split("#")[0], text: l.text.replace(/\s+/g, " ").trim().slice(0, 120) }));
}

async function lookup(url, env, cors, h) {
  const site = publicHost(url.searchParams.get("site") || "");
  const given = url.searchParams.get("given") === "1";
  if (!site) return h.json({ error: given ? "That doesn't look like a web address." : "No website for this course." }, 400, cors);
  const name = (url.searchParams.get("name") || "").toLowerCase();
  const key = "scorecard:lookup:" + (await h.sha256(host(site) + site.pathname + site.search + "|" + name + (given ? "|given" : "")));
  const hit = await env.QUEUE.get(key);
  if (hit) return h.json(JSON.parse(hit), 200, cors);

  const allowed = await robots(site.origin);
  if (!allowed(site.pathname)) return h.json({ candidates: [], note: "This course's website asks not to be read." }, 200, cors);
  // a pasted link straight to the card's picture or PDF
  if (given && FILE.test(site.pathname)) {
    const f = { url: site.href, label: "", dated: null, kind: /\.pdf/i.test(site.pathname) ? "pdf" : "image", page: site.href, score: 10 };
    await env.QUEUE.put("scorecard:file:" + (await h.sha256(f.url)), "1", { expirationTtl: 30 * DAY });
    return h.json({ candidates: [f], site: site.origin }, 200, cors);
  }
  const words = name.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/golf|course|club|country|park|the/.test(w));
  const files = new Map();
  const add = (l, page) => {
    const u = publicHost(l.url);
    if (!u || !FILE.test(u.pathname)) return;
    const hay = u.pathname + " " + l.text;
    // a page the player pasted: its PDFs count too (a card is often just "Elk.pdf")
    if (!CARDISH.test(hay) && !/\bcard\b/i.test(hay) && !(given && /\.pdf/i.test(u.pathname))) return;
    if (!given && host(u) !== host(site) && !/\.(wp\.com|wordpress\.com|amazonaws\.com|cloudfront\.net|squarespace-cdn\.com|wixstatic\.com)$/.test(u.hostname)) return;
    const date = /\/(20\d\d)\/(\d\d)\//.exec(u.pathname);
    const f = files.get(u.href) || { url: u.href, label: "", dated: date ? date[1] + "-" + date[2] : null, kind: /\.pdf/i.test(u.pathname) ? "pdf" : "image", page, score: 0 };
    f.label = f.label || l.text;
    f.score = Math.max(f.score, (CARDISH.test(hay) ? 10 : 3) + (words.some((w) => hay.toLowerCase().includes(w)) ? 6 : 0) + (date ? +date[1] - 2000 : 0) / 10);
    files.set(u.href, f);
  };
  let home = [], refused = false;
  try { home = await linksOf(site.href); } catch (e) { refused = true; }
  if (refused) {
    const out = { candidates: [], blocked: true, site: site.origin };
    await env.QUEUE.put(key, JSON.stringify(out), { expirationTtl: DAY });
    return h.json(out, 200, cors);
  }
  home.forEach((l) => add(l, site.href));
  // the course's own pages that might hold the card (a named course's page first, e.g. /old-course/)
  const pages = [...new Set(home.map((l) => l.url).filter((u) => {
    const x = publicHost(u);
    return x && host(x) === host(site) && !FILE.test(x.pathname) && x.href !== site.href && allowed(x.pathname) && PAGEISH.test(x.pathname + " ");
  }))].map((u) => ({ u, s: (CARDISH.test(u) ? 10 : 0) + (words.some((w) => u.toLowerCase().includes(w)) ? 6 : 0) }))
    .sort((a, b) => b.s - a.s).slice(0, 6);
  for (const p of pages) {
    try { (await linksOf(p.u)).forEach((l) => add(l, p.u)); } catch (e) {}
  }
  const candidates = [...files.values()].sort((a, b) => b.score - a.score).slice(0, 5)
    .map((f) => ({ url: f.url, label: f.label, dated: f.dated, kind: f.kind, page: f.page, score: Math.round(f.score * 10) / 10 }));
  // only files a lookup found can be passed through (/scorecard/file), so the Worker is no open proxy
  await Promise.all(candidates.map(async (c) => env.QUEUE.put("scorecard:file:" + (await h.sha256(c.url)), "1", { expirationTtl: 30 * DAY })));
  const out = { candidates, site: site.origin };
  await env.QUEUE.put(key, JSON.stringify(out), { expirationTtl: (candidates.length ? 7 : 1) * DAY }); // found nothing: try again tomorrow
  return h.json(out, 200, cors);
}

async function passFile(url, env, cors, h) {
  const u = publicHost(url.searchParams.get("u") || "");
  if (!u || !(await env.QUEUE.get("scorecard:file:" + (await h.sha256(u.href))))) return h.json({ error: "Unknown file." }, 404, cors);
  const r = await fetch(u.href, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) return h.json({ error: "The course's website didn't send it." }, 502, cors);
  if (Number(r.headers.get("Content-Length") || 0) > 15000000) return h.json({ error: "That file is too big." }, 413, cors);
  if (!/^(image\/|application\/pdf|application\/octet-stream)/i.test(r.headers.get("Content-Type") || "")) return h.json({ error: "That link isn't a picture or a PDF." }, 415, cors);
  return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "private, max-age=3600", ...cors } });
}

// ---------- course files ----------

async function listCourses(env, cors, h) {
  const { results } = await env.GOLF.prepare("SELECT id, name, place, version, owner_checked, updated_at FROM courses ORDER BY name").all();
  return h.json({ courses: results.map((c) => ({ id: c.id, name: c.name, place: c.place, version: c.version, ownerChecked: !!c.owner_checked, at: c.updated_at })) }, 200, cors);
}

async function getCourse(id, env, cors, h) {
  if (!CID.test(id)) return h.json({ error: "Unknown course." }, 404, cors);
  const row = await env.GOLF.prepare("SELECT r.data, r.version, r.owner, r.approved_at FROM courses c " +
    "JOIN course_records r ON r.course_id = c.id AND r.version = c.version WHERE c.id = ?").bind(id).first();
  if (!row) return h.json({ error: "No course file yet." }, 404, cors);
  const course = JSON.parse(row.data);
  course.checked = { version: row.version, owner: !!row.owner, at: row.approved_at };
  return h.json(course, 200, cors);
}

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// A course file as sent from the phone, checked and trimmed to the fields the app uses; null if it doesn't hold up
function cleanCourse(c, id, owner) {
  if (!c || c.id !== id) return null;
  const n = c.holes === 9 ? 9 : c.holes === 18 ? 18 : 0;
  if (!n || !Array.isArray(c.par) || c.par.length !== n || c.par.some((p) => !int(p, 3, 6))) return null;
  const hcps = (a) => (Array.isArray(a) && a.length === n ? a.map((v) => int(v, 1, 18)) : null);
  if (!Array.isArray(c.tees) || !c.tees.length || c.tees.length > 12) return null;
  const tees = [];
  for (const t of c.tees) {
    if (!t || !/^[a-z0-9-]{1,40}$/i.test(t.key || "") || !Array.isArray(t.yards) || t.yards.length !== n) return null;
    const tee = {
      key: t.key, name: str(t.name, 40) || t.key, color: /^#[0-9a-f]{6}$/i.test(t.color || "") ? t.color : "#8a8a86",
      rating: typeof t.rating === "number" && t.rating > 40 && t.rating < 90 ? t.rating : null, slope: int(t.slope, 55, 155),
      total: int(t.total, 500, 9000), yards: t.yards.map((y) => int(y, 30, 800)),
    };
    if (/^#[0-9a-f]{6}$/i.test(t.ink || "")) tee.ink = t.ink;
    if (t.label) tee.label = str(t.label, 40);
    if (t.range) tee.range = str(t.range, 12);
    if (t.women) tee.women = true;
    if (t.alt && typeof t.alt === "object") {
      tee.alt = {};
      Object.keys(t.alt).forEach((k) => { if (int(+k, 1, n) && int(t.alt[k], 30, 800)) tee.alt[k] = t.alt[k]; });
      if (int(t.altTotal, 500, 9000)) tee.altTotal = t.altTotal;
    }
    tees.push(tee);
  }
  const out = {
    id, name: str(c.name, 80) || id, fullName: str(c.fullName, 120) || undefined, place: str(c.place, 80), holes: n,
    par: c.par, hcp: hcps(c.hcp) || Array(n).fill(null), tees,
  };
  if (hcps(c.hcpWomen)) out.hcpWomen = hcps(c.hcpWomen);
  if (/^[0-9a-f-]{36}$/.test(c.apiId || "")) out.apiId = c.apiId;
  if (/^[0-9a-f-]{36}$/.test(c.nearApiId || "")) out.nearApiId = c.nearApiId;
  if (/^https?:\/\//.test(c.website || "")) out.website = str(c.website, 300);
  if (c.source && typeof c.source === "object") out.source = JSON.parse(JSON.stringify(c.source).slice(0, 2000));
  if (c.credit) out.credit = str(c.credit, 200);
  // two nines played as one 18: which nines (the app also tells it from the id, nines:<front>+<back>)
  if (Array.isArray(c.nines) && c.nines.length === 2 && c.nines.every((x) => typeof x === "string" && x.length <= 80)) out.nines = c.nines;
  if (Array.isArray(c.clubNines)) out.clubNines = c.clubNines.filter((x) => typeof x === "string").slice(0, 6).map((x) => x.slice(0, 30)); // a 27-hole club's nines
  if (owner && c.card && typeof c.card === "object") out.card = c.card; // the card's look or picture: Nick's files only
  return JSON.stringify(out).length <= 80000 ? out : null;
}

async function approve(request, id, env, cors, h) {
  if (!CID.test(id)) return h.json({ error: "Unknown course." }, 404, cors);
  const b = (await body(request)) || {};
  const me = await player(request, env, h, b.visitorId, true);
  if (!me) return h.json({ error: "Missing this browser's id." }, 400, cors);
  const course = cleanCourse(b.course, id, me.owner);
  if (!course) return h.json({ error: "Those course numbers don't hold together. Check the card and try again." }, 400, cors);
  const row = await env.GOLF.prepare("SELECT version, owner_checked FROM courses WHERE id = ?").bind(id).first();
  // a visitor's check only counts while there's no file yet; anything Nick approved stays until he changes it
  if (row && !me.owner) return h.json({ saved: false, version: row.version }, 200, cors);
  const version = (row ? row.version : 0) + 1;
  const now = new Date().toISOString();
  await env.GOLF.batch([
    env.GOLF.prepare("INSERT INTO course_records (course_id, version, data, player_id, owner, approved_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, version, JSON.stringify(course), me.id, me.owner ? 1 : 0, now),
    env.GOLF.prepare("INSERT INTO courses (id, name, place, version, owner_checked, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, place = excluded.place, version = excluded.version, " +
      "owner_checked = MAX(courses.owner_checked, excluded.owner_checked), updated_at = excluded.updated_at")
      .bind(id, course.name, course.place || "", version, me.owner ? 1 : 0, now),
  ]);
  if (!me.owner && h.tellOwner) await h.tellOwner(env, { type: "course", name: course.name, place: course.place || "", version });
  return h.json({ saved: true, version, checked: { version, owner: me.owner, at: now } }, 200, cors);
}

// ---------- rounds ----------

async function listRounds(request, url, env, cors, h) {
  const me = await player(request, env, h, url.searchParams.get("visitorId"), false);
  if (!me) return h.json({ rounds: [] }, 200, cors);
  const { results } = await env.GOLF.prepare("SELECT id, course_id, course_name, tee_name, holes, played_on, played_at, strokes, par, " +
    "holes_done, finished_at, updated_at, on_site FROM rounds WHERE player_id = ? ORDER BY played_on DESC, updated_at DESC LIMIT 200").bind(me.id).all();
  return h.json({
    rounds: results.map((r) => ({
      id: r.id, courseId: r.course_id, courseName: r.course_name, teeName: r.tee_name, holes: JSON.parse(r.holes),
      day: r.played_on, date: r.played_at, strokes: r.strokes, par: r.par, done: r.holes_done, finishedAt: r.finished_at,
      updatedAt: r.updated_at, onSite: !!r.on_site,
    })),
  }, 200, cors);
}

async function getRound(request, url, id, env, cors, h) {
  const me = await player(request, env, h, url.searchParams.get("visitorId"), false);
  if (!me || !RID.test(id)) return h.json({ error: "Not found." }, 404, cors);
  return fullRound(id, me.id, env, cors, h);
}

// a round in full: the course as played, every hole (the shape the app keeps rounds in)
async function fullRound(id, playerId, env, cors, h) {
  const r = await env.GOLF.prepare("SELECT * FROM rounds WHERE id = ? AND player_id = ?").bind(id, playerId).first();
  if (!r) return h.json({ error: "Not found." }, 404, cors);
  const { results } = await env.GOLF.prepare("SELECT * FROM round_holes WHERE round_id = ?").bind(id).all();
  const scores = {};
  results.forEach((x) => {
    const s = { strokes: x.strokes, at: x.updated_at };
    if (x.putts != null) s.putts = x.putts;
    if (x.fairway) s.fairway = x.fairway;
    if (x.gir_set != null) s.gir = !!x.gir_set;
    if (x.penalties) s.penalties = x.penalties;
    scores[x.hole] = s;
  });
  const holes = JSON.parse(r.holes);
  return h.json({
    id: r.id, v: 1, course: r.course ? JSON.parse(r.course) : null, courseVersion: r.course_version, tee: r.tee, holes, scores,
    current: holes[0], player: r.player_name || "", date: r.played_at || r.played_on, day: r.played_on, startedAt: null,
    finishedAt: r.finished_at, updatedAt: r.updated_at, onSite: !!r.on_site, ackAt: r.updated_at, courseAcked: true,
  }, 200, cors);
}

async function putRound(request, id, env, cors, h) {
  if (!RID.test(id)) return h.json({ error: "Bad round id." }, 400, cors);
  const b = await body(request);
  if (!b || !b.round) return h.json({ error: "Bad request." }, 400, cors);
  const me = await player(request, env, h, b.visitorId, true);
  if (!me) return h.json({ error: "Missing this browser's id." }, 400, cors);
  const have = await env.GOLF.prepare("SELECT player_id, finished_at FROM rounds WHERE id = ?").bind(id).first();
  if (have && have.player_id !== me.id) return h.json({ error: "That round belongs to someone else." }, 403, cors);

  const r = b.round;
  const holes = Array.isArray(r.holes) ? r.holes.filter((n) => int(n, 1, 18)) : [];
  if (!holes.length || holes.length > 18 || new Set(holes).size !== holes.length) return h.json({ error: "Bad holes." }, 400, cors);
  if (!CID.test(r.courseId || "") || !DATE.test(r.day || "") || !Number.isFinite(r.updatedAt)) return h.json({ error: "Bad round." }, 400, cors);
  let course = null;
  if (b.course) {
    course = JSON.stringify(b.course);
    if (course.length > 100000) return h.json({ error: "That course is too big." }, 400, cors);
  }
  const t = r.totals || {};
  const n = (v, hi) => int(v, 0, hi);
  const stmts = [env.GOLF.prepare(
    "INSERT INTO rounds (id, player_id, course_id, course_name, course_version, tee, tee_name, holes, player_name, played_on, played_at, " +
    "finished_at, updated_at, strokes, par, putts, fir_hit, fir_left, fir_right, fir_total, gir, gir_total, penalties, holes_done, on_site, course) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET course_name = excluded.course_name, course_version = excluded.course_version, tee = excluded.tee, " +
    "tee_name = excluded.tee_name, holes = excluded.holes, player_name = excluded.player_name, played_on = excluded.played_on, " +
    "played_at = excluded.played_at, finished_at = excluded.finished_at, updated_at = excluded.updated_at, strokes = excluded.strokes, " +
    "par = excluded.par, putts = excluded.putts, fir_hit = excluded.fir_hit, fir_left = excluded.fir_left, fir_right = excluded.fir_right, " +
    "fir_total = excluded.fir_total, gir = excluded.gir, gir_total = excluded.gir_total, penalties = excluded.penalties, " +
    "holes_done = excluded.holes_done, on_site = excluded.on_site, course = COALESCE(excluded.course, rounds.course) " +
    "WHERE excluded.updated_at >= rounds.updated_at"
  ).bind(id, me.id, r.courseId, str(r.courseName, 80), int(r.courseVersion, 1, 100000), str(r.tee, 40), str(r.teeName, 40),
    JSON.stringify(holes), str(r.player, 24), r.day, str(r.date, 40), Number.isFinite(r.finishedAt) ? r.finishedAt : null, r.updatedAt,
    n(t.strokes, 400), n(t.par, 120), n(t.putts, 200), n(t.firHit, 18), n(t.firLeft, 18), n(t.firRight, 18), n(t.firTotal, 18),
    n(t.gir, 18), n(t.girTotal, 18), n(t.penalties, 100), n(t.done, 18), me.owner && r.onSite ? 1 : 0, course)];

  const pars = (b.course && Array.isArray(b.course.par)) ? b.course.par : null;
  Object.keys(b.scores || {}).forEach((k) => {
    const hole = +k, s = b.scores[k] || {};
    if (holes.indexOf(hole) < 0 || !int(s.strokes, 1, 20) || !Number.isFinite(s.at)) return;
    stmts.push(env.GOLF.prepare(
      "INSERT INTO round_holes (round_id, hole, par, yards, hcp, strokes, putts, fairway, gir, gir_set, penalties, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(round_id, hole) DO UPDATE SET par = excluded.par, yards = excluded.yards, " +
      "hcp = excluded.hcp, strokes = excluded.strokes, putts = excluded.putts, fairway = excluded.fairway, gir = excluded.gir, " +
      "gir_set = excluded.gir_set, penalties = excluded.penalties, updated_at = excluded.updated_at " +
      "WHERE excluded.updated_at >= round_holes.updated_at"
    ).bind(id, hole, int(s.par, 3, 6) || (pars ? int(pars[hole - 1], 3, 6) : null), int(s.yards, 30, 800), int(s.hcp, 1, 18),
      s.strokes, int(s.putts, 0, 10), ["hit", "left", "right", "miss"].indexOf(s.fairway) >= 0 ? s.fairway : null, // miss: a played card's FIR row only says hit or not
      typeof s.girShown === "boolean" ? (s.girShown ? 1 : 0) : null, typeof s.gir === "boolean" ? (s.gir ? 1 : 0) : null,
      int(s.penalties, 0, 10), s.at));
  });
  const present = (Array.isArray(b.present) ? b.present : []).filter((x) => holes.indexOf(x) >= 0);
  // holes no longer scored (undone on the phone) go, but only if this save is the round's newest
  stmts.push(env.GOLF.prepare("DELETE FROM round_holes WHERE round_id = ? AND hole NOT IN (SELECT value FROM json_each(?)) " +
    "AND (SELECT updated_at FROM rounds WHERE id = ?) <= ?").bind(id, JSON.stringify(present), id, r.updatedAt));
  await env.GOLF.batch(stmts);
  // another golfer just finished a round (its first save marked done): a notification on Nick's phone
  if (!me.owner && Number.isFinite(r.finishedAt) && !(have && have.finished_at) && h.tellOwner) {
    await h.tellOwner(env, { type: "round", player: str(r.player, 24), course: str(r.courseName, 80), strokes: n(t.strokes, 400), par: n(t.par, 120), holes: n(t.done, 18) });
  }
  return h.json({ ok: true }, 200, cors);
}

async function deleteRound(request, url, id, env, cors, h) {
  const me = await player(request, env, h, url.searchParams.get("visitorId"), false);
  if (!me || !RID.test(id)) return h.json({ ok: true }, 200, cors);
  const r = await env.GOLF.prepare("SELECT id FROM rounds WHERE id = ? AND player_id = ?").bind(id, me.id).first();
  if (r) {
    await env.GOLF.batch([
      env.GOLF.prepare("DELETE FROM round_holes WHERE round_id = ?").bind(id),
      env.GOLF.prepare("DELETE FROM rounds WHERE id = ?").bind(id),
    ]);
  }
  return h.json({ ok: true }, 200, cors);
}

// Nick's finished rounds he's marked for the site, in the Golf page's round shape (extras/golf/scores.js)
async function feed(env, cors, h) {
  if (!env.GOLF) return h.json({ rounds: [] }, 200, cors);
  const { results } = await env.GOLF.prepare("SELECT id, course_name, tee_name, played_on, strokes, par, putts, fir_hit, fir_total, gir, " +
    "gir_total, penalties, holes_done FROM rounds WHERE player_id = 'owner' AND on_site = 1 AND finished_at IS NOT NULL " +
    "AND holes_done >= 9 ORDER BY played_on DESC, updated_at DESC LIMIT 60").all();
  return h.json({
    rounds: results.map((r) => {
      const stats = [];
      if (r.putts) stats.push(["Putts", r.putts]);
      if (r.fir_total) stats.push(["Fairways", r.fir_hit + "/" + r.fir_total]);
      if (r.gir_total) stats.push(["Greens", r.gir + "/" + r.gir_total]);
      if (r.penalties) stats.push(["Penalties", r.penalties]);
      if (r.tee_name) stats.push(["Tees", r.tee_name]);
      return { id: r.id, date: r.played_on, course: r.course_name, holes: r.holes_done, par: r.par, score: r.strokes, stats };
    }),
  }, 200, cors);
}

// ---------- Nick's handicap index (World Handicap System), from the rounds on his Golf page ----------
// Each finished round, oldest first: its adjusted score (each hole capped at net double bogey: par + 2 + the strokes
// the hole gets from his course handicap at the time; par + 5 before he has an index), its score differential
// (113 / slope x (adjusted score - course rating)), and his index after it: the average of the best of his last 20
// differentials (8 of 20; fewer rounds use the WHS table, with its adjustments), to one decimal.
// 9 holes: the nine's rating (the card's own 9-hole rating, else half the 18's) and the same slope; the differential
// is made an 18-hole one by adding the expected score on the other nine (WHS 2024: 0.52 x index + 1.2). A 9-hole round
// before there's an index waits (it can't be expected-scored yet). A round with no rating or slope for its tee, or with
// holes not scored, doesn't count. Soft and hard caps (which need a year of history) aren't applied.
//   -> { index, counted, of, rounds: [{ id, date, course, tee, holes, score, adjusted, rating, slope, differential,
//         used, index, note }] (newest first), history: [{ date, index }] }
const WHS = { 3: [1, -2], 4: [1, -1], 5: [1, 0], 6: [2, -1], 7: [2, 0], 8: [2, 0], 9: [3, 0], 10: [3, 0], 11: [3, 0], 12: [4, 0],
  13: [4, 0], 14: [4, 0], 15: [5, 0], 16: [5, 0], 17: [6, 0], 18: [6, 0], 19: [7, 0], 20: [8, 0] };
function indexOf(diffs) { // diffs: the newest 20 or fewer, as numbers -> { index, best: [positions used] } | null
  const rule = WHS[Math.min(20, diffs.length)];
  if (!rule) return null;
  const order = diffs.map((d, i) => [d, i]).sort((a, b) => a[0] - b[0]).slice(0, rule[0]);
  const avg = order.reduce((s, x) => s + x[0], 0) / rule[0] + rule[1];
  return { index: Math.min(54, Math.round(avg * 10) / 10), best: order.map((x) => x[1]) };
}
function strokesOn(holes, ch) { // course handicap -> strokes received per hole (by the holes' handicap order)
  const order = holes.map((x, i) => [x.hcp == null ? 99 : x.hcp, i]).sort((a, b) => a[0] - b[0]);
  const n = holes.length, out = holes.map(() => 0), give = Math.max(0, ch);
  order.forEach((o, rank) => { out[o[1]] = Math.floor(give / n) + (rank < give % n ? 1 : 0); });
  return out;
}
async function handicap(env) {
  if (!env.GOLF) return { index: null, rounds: [], history: [] };
  const { results } = await env.GOLF.prepare("SELECT id, course_name, course, tee, tee_name, holes, played_on, updated_at FROM rounds " +
    "WHERE player_id = 'owner' AND on_site = 1 AND finished_at IS NOT NULL ORDER BY played_on, updated_at").all();
  const { results: hs } = await env.GOLF.prepare("SELECT h.round_id, h.hole, h.par, h.hcp, h.strokes FROM round_holes h JOIN rounds r ON r.id = h.round_id " +
    "WHERE r.player_id = 'owner' AND r.on_site = 1 AND r.finished_at IS NOT NULL").all();
  const byRound = {};
  hs.forEach((x) => { (byRound[x.round_id] = byRound[x.round_id] || {})[x.hole] = x; });
  const diffs = [], rounds = [], history = [];
  let index = null;
  for (const r of results) {
    let course = {}, played = [];
    try { course = JSON.parse(r.course || "{}"); played = JSON.parse(r.holes || "[]"); } catch (e) {}
    const tee = (course.tees || []).find((t) => t.key === r.tee) || {};
    const holes = played.map((n) => {
      const x = (byRound[r.id] || {})[n] || {};
      return { n, par: x.par || (course.par || [])[n - 1], hcp: x.hcp ?? (course.hcp || [])[n - 1], strokes: x.strokes };
    });
    const nine = played.length === 9, out = { id: r.id, date: r.played_on, course: r.course_name, tee: r.tee_name, holes: played.length };
    rounds.push(out);
    const score = holes.reduce((s, x) => s + (x.strokes || 0), 0);
    out.score = score;
    if ((played.length !== 9 && played.length !== 18) || holes.some((x) => !x.strokes || !x.par)) { out.note = "Not every hole has a score."; continue; }
    if (!(tee.rating > 20) || !(tee.slope >= 55 && tee.slope <= 155)) { out.note = "No rating and slope for the " + (r.tee_name || "") + " tees."; continue; }
    // the rating for what was played: a 9-hole course's rating is a nine's when it's under 50; an 18's is halved
    const rating = nine ? (tee.rating < 50 ? tee.rating : tee.rating / 2) : tee.rating >= 50 ? tee.rating : null;
    if (!rating) { out.note = "Its rating is for nine holes."; continue; }
    if (nine && index == null) { out.note = "Nine holes count once there's an index."; continue; }
    const par = holes.reduce((s, x) => s + x.par, 0);
    const ch = index == null ? null : Math.round((nine ? index / 2 : index) * tee.slope / 113 + (rating - par));
    const get = ch == null ? null : strokesOn(holes, ch);
    const adjusted = holes.reduce((s, x, i) => s + Math.min(x.strokes, ch == null ? x.par + 5 : x.par + 2 + get[i]), 0);
    let diff = (113 / tee.slope) * (adjusted - rating);
    if (nine) diff += 0.52 * index + 1.2; // the expected score on the other nine
    diff = Math.round(diff * 10) / 10;
    Object.assign(out, { adjusted, rating: Math.round(rating * 10) / 10, slope: tee.slope, differential: diff });
    diffs.push({ d: diff, out });
    const last = diffs.slice(-20), got = indexOf(last.map((x) => x.d));
    if (got) {
      index = got.index;
      history.push({ date: r.played_on, index });
    }
    out.index = index;
  }
  // which differentials the current index uses
  const last = diffs.slice(-20), got = indexOf(last.map((x) => x.d));
  if (got) got.best.forEach((i) => { last[i].out.used = true; });
  return { index: got ? got.index : null, counted: got ? got.best.length : 0, of: last.length, rounds: rounds.reverse(), history };
}

async function oga(path) {
  try {
    const r = await fetch(OGA + path, { headers: { "User-Agent": "nickmade.net scorecard (https://nickmade.net)", Accept: "application/json" } });
    if (r.ok) return await r.json();
    console.log("OpenGolfAPI " + r.status + " " + path);
    return null;
  } catch (e) {
    console.log("OpenGolfAPI failed " + path + " " + e.message);
    return null;
  }
}

const COLORS = { gold: "#c9a227", blue: "#2f6fb7", white: "#ffffff", red: "#c8323a", black: "#25272a", green: "#2f7d46",
  silver: "#b8bcc2", yellow: "#e8c547", orange: "#e07b2a", purple: "#6b3fa0", copper: "#b87333", gray: "#9a9a96", grey: "#9a9a96" };

// OpenGolfAPI's course -> the app's course shape (the same shape as the hand-made files, minus the card template).
// Its data has known gaps (SCORECARD-PLAN.md section 2): holes_data can run past the real hole count (Pecan Hollow
// has 24 rows for 18 holes), and per-hole yardage is often there for one tee only. So: holes cut to the course's
// count, missing yardages left null for Nick to fill in before the round, and a tee's color guessed from its name.
function clean(d) {
  const n = d.holes === 9 ? 9 : 18;
  const rows = (d.holes_data || []).filter((x) => x.number >= 1 && x.number <= n).sort((a, b) => a.number - b.number);
  const hole = (i) => rows.find((x) => x.number === i + 1) || {};
  const idx = Array.from({ length: n }, (_, i) => i);
  const tees = (d.tees || []).map((t) => {
    const word = String(t.tee_name || t.tee_key || "").toLowerCase();
    const yards = idx.map((i) => {
      const y = hole(i).yardages || {};
      const v = y[word] ?? y[String(t.tee_key || "").split("-")[0]];
      return Number.isFinite(v) ? v : null;
    });
    const color = COLORS[String(t.tee_color || "").toLowerCase()] || COLORS[word.split(/\s+/)[0]] || "#8a8a86";
    return {
      key: String(t.tee_key || word).replace(/[^a-z0-9-]/gi, ""), name: t.tee_name || "Tee", color,
      rating: t.course_rating || null, slope: t.slope || null, total: t.yardage || null,
      women: /female|women|ladies/i.test(String(t.gender || "") + " " + word), yards,
    };
  }).filter((t) => t.total || t.yards.some((v) => v));
  return {
    id: "api:" + d.id, apiId: d.id, name: d.course_name || d.club_name, fullName: d.club_name || d.course_name,
    place: [d.city, d.state].filter(Boolean).join(", "), website: d.website || null, holes: n,
    par: idx.map((i) => hole(i).par || 4),
    hcp: idx.map((i) => hole(i).handicap_index || null),
    tees,
    source: { kind: "api", name: "OpenGolfAPI", dated: null },
    credit: "Course data © OpenStreetMap contributors (ODbL 1.0) via OpenGolfAPI",
  };
}
