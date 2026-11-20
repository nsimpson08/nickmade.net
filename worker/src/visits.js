// Visits (Nick, 2026-11-16): who visits nickmade.net and when, for his private Visitors page (nickmade-owner). Every
// page loads /assets/js/visit.js, which sends one beacon per page view. Nothing here is ever sent back to visitors:
// both routes answer 204 with no body, and only the owner app reads the database.
//
//   POST /visit       text/plain JSON { v: browser id (localStorage nm-visitor), n: name they typed on the site
//                     (localStorage nm-name), p: path, t: page title, r: referrer (other sites only), m: touch points }
//                     + i: the view's id, made by the page so it can send the time later -> 204
//   POST /visit/end   text/plain JSON { v, i, s: seconds the page was in view } -> 204
//
// Not counted: Nick (visit.js sends nothing from a browser that has ever been in owner mode), bots and link-preview
// fetchers (no JavaScript, and a User-Agent check below), and bots that run JavaScript but open three pages within a
// second (Nick, 2026-11-19: Microsoft's link checker, which opens a link sent by Outlook or Teams in a browser in a
// Microsoft data center and then the home page's links all at once). Those are marked bot = 1, labelled "Bot · <their
// network>", and hidden, along with any other browser seen on the same internet address and system in the last day
// (the checker's first look is one page, so it can't be told by itself); after that their views aren't kept.
//
// D1 (VISITS, database nickmade-visits). Kept forever (Nick: "don't delete after 90 days").
//   visitors: one row per browser: id, name (the last name they typed), label (Nick's, from the Visitors page), hidden,
//             first, last, views, visits (a visit = page views with no gap over 30 minutes), ua, device, city, region,
//             country, org (their internet provider), bot (1 = found to be a bot, above)
//   views:    one row per page view: id, vid, at, path, title, ref, secs, new (1 = the first view of a visit), ip,
//             city, region, country, org

const GAP = 30 * 60e3; // a new visit after 30 minutes away
const AT_ONCE = 1000, AT_ONCE_PAGES = 3; // three pages opened within a second: not a person
const BOTS = /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|embedly|discordbot|whatsapp|telegram|lighthouse|pingdom|uptime|monitor|curl|wget|python|node-fetch|axios|go-http/i;

let ready = false;
export async function visitsSetup(db) {
  if (ready) return;
  const cols = await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, name TEXT, label TEXT, hidden INTEGER NOT NULL DEFAULT 0, " +
      "first TEXT NOT NULL, last TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0, ua TEXT, device TEXT, " +
      "city TEXT, region TEXT, country TEXT, org TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS views (id TEXT PRIMARY KEY, vid TEXT NOT NULL, at TEXT NOT NULL, path TEXT, title TEXT, ref TEXT, " +
      "secs INTEGER, new INTEGER NOT NULL DEFAULT 0, ip TEXT, city TEXT, region TEXT, country TEXT, org TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS views_vid_at ON views (vid, at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS views_at ON views (at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS views_ip ON views (ip)"),
    db.prepare("SELECT name FROM pragma_table_info('visitors')"),
  ]).then((r) => r[r.length - 1].results);
  // bot: added 2026-11-19
  if (!cols.some((c) => c.name === "bot")) {
    try { await db.prepare("ALTER TABLE visitors ADD COLUMN bot INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
  }
  ready = true;
}

function str(x, max) { return typeof x === "string" ? x.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : ""; }
const ID = /^[A-Za-z0-9-]{8,64}$/;

// phone / tablet / computer, then the system and browser: "iPhone · Safari", "Windows · Chrome"
export function deviceOf(ua, touch) { // (an iPad asks for the desktop site as a Mac; touch points give it away)
  ua = ua || "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet") :
    /CrOS/.test(ua) ? "Chromebook" : /Macintosh/.test(ua) ? (touch > 1 ? "iPad" : "Mac") :
    /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const app = /Instagram/.test(ua) ? "Instagram" : /FBAN|FBAV/.test(ua) ? "Facebook" : /Discord/.test(ua) ? "Discord" : /Snapchat/.test(ua) ? "Snapchat" :
    /\bTikTok|musical_ly/.test(ua) ? "TikTok" : /Twitter/.test(ua) ? "X" : /LinkedInApp/.test(ua) ? "LinkedIn" : "";
  const br = app ? app + " app" : /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\/|Opera/.test(ua) ? "Opera" :
    /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ") || "Unknown device";
}

export async function visitsRoute(request, url, env) {
  const none = new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  if (request.method !== "POST" || !env.VISITS) return url.pathname === "/visit" || url.pathname === "/visit/end" ? none : null;
  const ua = request.headers.get("User-Agent") || "";
  if (BOTS.test(ua)) return none;
  let b = {};
  try { b = JSON.parse((await request.text()).slice(0, 4000)); } catch (e) { return none; }
  const vid = str(b.v, 64), vi = str(b.i, 64);
  if (!ID.test(vid) || !ID.test(vi)) return none;
  const db = env.VISITS;
  await visitsSetup(db);

  if (url.pathname === "/visit/end") {
    const s = Math.max(0, Math.min(6 * 3600, Math.round(+b.s || 0)));
    await db.prepare("UPDATE views SET secs = ? WHERE id = ? AND vid = ?").bind(s, vi, vid).run();
    return none;
  }
  if (url.pathname !== "/visit") return null;

  const cf = request.cf || {}, now = new Date(), at = now.toISOString();
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const city = str(cf.city, 80), region = str(cf.region, 80), country = str(cf.country, 8), org = str(cf.asOrganization, 120);
  const name = str(b.n, 40), path = str(b.p, 300) || "/", title = str(b.t, 200), ref = str(b.r, 300), touch = +b.m || 0;
  const was = await db.prepare("SELECT last, bot FROM visitors WHERE id = ?").bind(vid).first();
  if (was && was.bot) return none; // a bot already: nothing more kept
  const fresh = !was || now - Date.parse(was.last) > GAP ? 1 : 0;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO views (id, vid, at, path, title, ref, new, ip, city, region, country, org) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(vi, vid, at, path, title, ref, fresh, ip, city, region, country, org),
    db.prepare("INSERT INTO visitors (id, name, first, last, views, visits, ua, device, city, region, country, org) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), visitors.name), last = excluded.last, views = visitors.views + 1, " +
      "visits = visitors.visits + ?, ua = excluded.ua, device = excluded.device, city = excluded.city, region = excluded.region, country = excluded.country, org = excluded.org")
      .bind(vid, name || null, at, at, ua.slice(0, 400), deviceOf(ua, touch), city, region, country, org, fresh),
  ]);
  // three pages from this browser within a second: a bot (two can be a page that sends you straight on to another).
  // Asked after every view: a bot's pages can all arrive before any of them is saved, so only the last one sees the rest
  const near = await db.prepare("SELECT COUNT(*) AS n FROM views WHERE vid = ? AND at >= ?").bind(vid, new Date(now - AT_ONCE).toISOString()).first();
  if (near && near.n >= AT_ONCE_PAGES) await markBot(db, vid, ip, ua, org);
  return none;
}

// this browser, and any other on the same internet address with the same User-Agent in the last day: labelled (unless
// Nick named it already), hidden, and bot = 1
export async function markBot(db, vid, ip, ua, org) {
  const label = ("Bot · " + (org || "unknown network")).slice(0, 60);
  const since = new Date(Date.now() - 864e5).toISOString();
  const ids = ip ? (await db.prepare("SELECT DISTINCT w.vid FROM views w JOIN visitors v ON v.id = w.vid WHERE w.ip = ? AND w.at >= ? AND v.ua = ?").bind(ip, since, ua.slice(0, 400)).all()).results.map((r) => r.vid) : [];
  if (!ids.includes(vid)) ids.push(vid);
  await db.batch(ids.map((id) => db.prepare("UPDATE visitors SET bot = 1, hidden = 1, label = COALESCE(label, ?) WHERE id = ?").bind(label, id)));
  return ids.length;
}
