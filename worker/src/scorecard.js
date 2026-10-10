// Scorecard (extras/scorecard/): Nick's score tracker for real golf courses (SCORECARD-PLAN.md phases 1-2).
// OWNER ONLY until SCORECARD_PUBLIC is "1" in wrangler.toml: until then every route but /scorecard/status needs the
// admin token (/scorecard/feed answers visitors with no rounds). Flipping it (and redeploying) opens the page and its Extras card to everyone.
//
//   GET    /scorecard/status              { public, owner }: the page and the Extras card ask this to show themselves
//   GET    /scorecard/feed                Nick's finished rounds marked for his site (Golf page, home Lately strip); empty
//                                         for visitors while the Scorecard is owner only (Nick: everything his until launch)
//   GET    /scorecard/courses/search?q=   { courses: [{ apiId, name, place, par, holes }] }  (OpenGolfAPI search)
//   GET    /scorecard/courses/api/:id     one OpenGolfAPI course, cleaned into the app's course shape (see clean())
//   GET    /scorecard/courses             the approved course files: [{ id, name, place, version, ownerChecked }]
//   GET    /scorecard/courses/:id         a course's newest approved file, with checked: { version, owner, at }
//   POST   /scorecard/courses/:id/approve { visitorId, course } -> a new version of its course file. Nick's approvals
//                                         always count; a visitor's only while the course has no file yet
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
const CID = /^(api:[0-9a-f-]{36}|[a-z0-9-]{3,60})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODES = 6;  // recovery codes a player can have
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function scorecardRoute(request, url, env, cors, h) {
  const open = env.SCORECARD_PUBLIC === "1";
  const owner = h.isAdmin(request, env);
  if (url.pathname === "/scorecard/status" && request.method === "GET") return h.json({ public: open, owner }, 200, cors);
  if (!url.pathname.startsWith("/scorecard/")) return null;
  if (url.pathname === "/scorecard/feed" && request.method === "GET" && !open && !owner) return h.json({ rounds: [] }, 200, cors);
  if (!open && !owner) return h.json({ error: "Not available." }, 401, cors);
  if (url.pathname === "/scorecard/feed" && request.method === "GET") return feed(env, cors, h);

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
  if (parts[1] === "rounds" && parts.length === 2 && m === "GET") return listRounds(request, url, env, cors, h);
  if (parts[1] === "rounds" && parts.length === 3) {
    if (m === "GET") return getRound(request, url, parts[2], env, cors, h);
    if (m === "PUT") return putRound(request, parts[2], env, cors, h);
    if (m === "DELETE") return deleteRound(request, url, parts[2], env, cors, h);
  }
  if (parts[1] === "me" && parts[2] === "code" && m === "POST") return newCode(request, env, cors, h);
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

async function body(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 300000) return null;
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
  if (owner && c.card && typeof c.card === "object") out.card = c.card; // the card's look: Nick's files only
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
  const r = await env.GOLF.prepare("SELECT * FROM rounds WHERE id = ? AND player_id = ?").bind(id, me.id).first();
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
  const have = await env.GOLF.prepare("SELECT player_id FROM rounds WHERE id = ?").bind(id).first();
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
      s.strokes, int(s.putts, 0, 10), ["hit", "left", "right"].indexOf(s.fairway) >= 0 ? s.fairway : null,
      typeof s.girShown === "boolean" ? (s.girShown ? 1 : 0) : null, typeof s.gir === "boolean" ? (s.gir ? 1 : 0) : null,
      int(s.penalties, 0, 10), s.at));
  });
  const present = (Array.isArray(b.present) ? b.present : []).filter((x) => holes.indexOf(x) >= 0);
  // holes no longer scored (undone on the phone) go, but only if this save is the round's newest
  stmts.push(env.GOLF.prepare("DELETE FROM round_holes WHERE round_id = ? AND hole NOT IN (SELECT value FROM json_each(?)) " +
    "AND (SELECT updated_at FROM rounds WHERE id = ?) <= ?").bind(id, JSON.stringify(present), id, r.updatedAt));
  await env.GOLF.batch(stmts);
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
  const { results } = await env.GOLF.prepare("SELECT course_name, tee_name, played_on, strokes, par, putts, fir_hit, fir_total, gir, " +
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
      return { date: r.played_on, course: r.course_name, holes: r.holes_done, par: r.par, score: r.strokes, stats };
    }),
  }, 200, cors);
}

async function oga(path) {
  try {
    const r = await fetch(OGA + path, { headers: { "User-Agent": "nickmade.net scorecard (https://nickmade.net)", Accept: "application/json" } });
    return r.ok ? await r.json() : null;
  } catch (e) {
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
