// Scorecard (extras/scorecard/): Nick's score tracker for real golf courses (phase 1 of SCORECARD-PLAN.md).
// OWNER ONLY until SCORECARD_PUBLIC is "1" in wrangler.toml: until then every route but /scorecard/status needs the
// admin token. Flipping it (and redeploying) opens the page and its Extras card to everyone, with no site push.
//
//   GET /scorecard/status                { public, owner }: the page and the Extras card ask this to show themselves
//   GET /scorecard/courses/search?q=     { courses: [{ apiId, name, place, par, holes }] }  (OpenGolfAPI search)
//   GET /scorecard/courses/api/:id       one OpenGolfAPI course, cleaned into the app's course shape (see clean())
//
// Course data is from OpenGolfAPI (https://opengolfapi.org, ODbL, keyless, ~500 calls a day per caller), cached in
// KV so each course costs one call a month: scorecard:search:<q> (7 days), scorecard:api:<id> (30 days).
// Nick's own courses (Pecan Hollow, Firewheel Old) are hand-made files in extras/scorecard/courses/, not from here.

const OGA = "https://api.opengolfapi.org";
const DAY = 86400;
const ID = /^[0-9a-f-]{36}$/;

export async function scorecardRoute(request, url, env, cors, h) {
  const open = env.SCORECARD_PUBLIC === "1";
  const owner = h.isAdmin(request, env);
  if (url.pathname === "/scorecard/status" && request.method === "GET") return h.json({ public: open, owner }, 200, cors);
  if (!url.pathname.startsWith("/scorecard/")) return null;
  if (!open && !owner) return h.json({ error: "Not available." }, 401, cors);

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
  return null;
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
