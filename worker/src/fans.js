// "Get notified" (Nick, 2026-10-22: "people can sign up for notifications on their phones when I post something"):
// visitors sign up on the home page for any of four kinds of post, and their phone or browser gets a notification
// when Nick posts one. No accounts: each sign-up is a browser's push subscription and the kinds it picked.
//
//   GET  /fans/key                 { key }: the public key a browser subscribes with (VAPID_PUBLIC)
//   POST /fans                     { sub, topics, visitorId? } -> { topics }: signs up (or changes what it gets); topics []
//                                  signs off. "cats" needs the visitorId of a browser that owns a cat in the Cattery
//   POST /fans/me                  { endpoint } -> { topics }: what that browser gets (null when it isn't signed up)
//   POST /fans/off                 { endpoint }: signs off
//   POST /fans/send                (admin) { topic, title, body?, url? }: a post by hand ("site": a new version)
//
// Topics: movies (Recently Watched adds), games (Recently Played adds and Xbox imports), photos (new photos),
// site (a new version, sent by hand from the changelog in owner mode), golf (Nick finishing a round on a real course
// with the Scorecard, not the sim: scorecard.js putRound; Nick, 2026-10-27), cats (Nick, 2026-10-25: a visitor's own cats in
// the Cattery, when one gets down to 25% fed or 25% happy; cats.js catAlerts() sends them, only to that cat's owners;
// the home page offers it only to a browser that owns a cat).
//
// At most one notification per topic every CAP_HOURS: a post inside that time is held, and the 4-hourly cron sends
// the held ones as one ("2 more movies: A, B"). A send reaches at most SEND_MAX browsers at once (the free plan's
// limit on requests per invocation); the rest wait in KV fans:backlog for the next cron run.
//
// Storage: D1 GOLF table fans (migrations/0003_fans.sql); KV fans:last:<topic> { at, held: [titles] }, fans:backlog
// [{ msg, after }]. The message goes inside the push, encrypted for each browser (webpush.js); the site's service
// worker (/sw.js) shows it.

import { sendPush } from "./webpush.js";

import { ownsCat } from "./cats.js";

export const TOPICS = ["movies", "games", "photos", "site", "cats", "golf"];
const CAP_HOURS = 3;
const SEND_MAX = 40;
const HOUR = 3600e3;

export async function fansRoute(request, url, env, cors, h) {
  const path = url.pathname, m = request.method;
  if (path === "/fans/key" && m === "GET") return h.json({ key: env.VAPID_PUBLIC || "" }, 200, cors);
  if (!env.GOLF) return h.json({ error: "Not set up yet." }, 503, cors);
  let b = {};
  if (m === "POST") { try { b = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); } }
  if (path === "/fans" && m === "POST") {
    const sub = b.sub || {}, topics = (Array.isArray(b.topics) ? b.topics : []).filter((t) => TOPICS.includes(t));
    if (!/^https:\/\//.test(sub.endpoint || "") || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return h.json({ error: "That browser's sign-up didn't come through." }, 400, cors);
    if (!topics.length) {
      await env.GOLF.prepare("DELETE FROM fans WHERE endpoint = ?").bind(sub.endpoint).run();
      return h.json({ topics: [] }, 200, cors);
    }
    // "cats": only for a browser that owns a cat (its owner key is kept, to find its cats' owners when one needs them)
    let catOwner = null;
    if (topics.includes("cats")) {
      catOwner = await ownsCat(env, h, b.visitorId);
      if (!catOwner) topics.splice(topics.indexOf("cats"), 1);
      if (!topics.length) return h.json({ error: "You don't have a cat in the Cattery." }, 400, cors);
    }
    const now = new Date().toISOString();
    await env.GOLF.prepare("INSERT INTO fans (endpoint, sub, topics, cat_owner, created, updated) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(endpoint) DO UPDATE SET sub = excluded.sub, topics = excluded.topics, cat_owner = excluded.cat_owner, updated = excluded.updated")
      .bind(sub.endpoint, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), JSON.stringify(topics), catOwner, now, now).run();
    return h.json({ topics }, 200, cors);
  }
  if (path === "/fans/me" && m === "POST") {
    const row = await env.GOLF.prepare("SELECT topics FROM fans WHERE endpoint = ?").bind(String(b.endpoint || "")).first();
    return h.json({ topics: row ? JSON.parse(row.topics) : null }, 200, cors);
  }
  if (path === "/fans/off" && m === "POST") {
    await env.GOLF.prepare("DELETE FROM fans WHERE endpoint = ?").bind(String(b.endpoint || "")).run();
    return h.json({ topics: [] }, 200, cors);
  }
  if (path === "/fans/send" && m === "POST") {
    if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
    if (!TOPICS.includes(b.topic) || !String(b.title || "").trim()) return h.json({ error: "Pick a topic and write a title." }, 400, cors);
    const sent = await send(env, b.topic, { title: String(b.title).slice(0, 120), body: String(b.body || "").slice(0, 240), url: String(b.url || "/") });
    return h.json(sent, 200, cors);
  }
  return null;
}

// A post Nick just made: sent now, or held when that topic sent one in the last CAP_HOURS (the cron sends those)
//   post(env, "movies", { title: "🎬 Nick watched Dune", body: "★★★★½", url: "/movies/#recently-watched", name: "Dune" })
export async function post(env, topic, msg) {
  if (!env.GOLF || !env.VAPID_PRIVATE || !TOPICS.includes(topic)) return { held: false, sent: 0 };
  const key = "fans:last:" + topic, last = JSON.parse((await env.QUEUE.get(key)) || "null");
  if (last && Date.now() - last.at < CAP_HOURS * HOUR) {
    last.held = (last.held || []).concat(msg.name || msg.title).slice(-20);
    await env.QUEUE.put(key, JSON.stringify(last));
    return { held: true, sent: 0 };
  }
  await env.QUEUE.put(key, JSON.stringify({ at: Date.now(), held: [] }));
  return { held: false, ...(await send(env, topic, msg)) };
}

// the cron (every 4 hours): held posts whose wait is over, as one notification each topic, then the backlog
const NOUNS = { movies: ["movie", "movies", "🎬", "/movies/#recently-watched"], games: ["game", "games", "🎮", "/games/#recently-played"],
  photos: ["photo", "photos", "📷", "/photography/"], site: ["update", "updates", "✨", "/changelog/"], golf: ["round", "rounds", "⛳", "/extras/golf/"] };
export async function fansTick(env) {
  if (!env.GOLF || !env.VAPID_PRIVATE) return "not set up";
  const done = [];
  for (const topic of TOPICS) {
    if (topic === "cats") continue; // (cats.js sends those straight to their owners, never held)
    const key = "fans:last:" + topic, last = JSON.parse((await env.QUEUE.get(key)) || "null");
    if (!last || !(last.held || []).length || Date.now() - last.at < CAP_HOURS * HOUR) continue;
    const n = last.held.length, w = NOUNS[topic];
    await env.QUEUE.put(key, JSON.stringify({ at: Date.now(), held: [] }));
    await send(env, topic, { title: w[2] + " " + n + " more " + (n === 1 ? w[0] : w[1]) + " from Nick", body: last.held.slice(0, 4).join(", ") + (n > 4 ? "…" : ""), url: w[3] });
    done.push(topic + " " + n);
  }
  const backlog = JSON.parse((await env.QUEUE.get("fans:backlog")) || "[]");
  if (backlog.length) {
    await env.QUEUE.delete("fans:backlog");
    for (const job of backlog) await send(env, job.topic, job.msg, job.after);
    done.push("backlog " + backlog.length);
  }
  return done.join(", ") || "nothing held";
}

// one message to every browser signed up for that topic, after the endpoint `after` (a backlog's place); the rest of a
// big list waits for the cron. A browser that's gone (404/410) is dropped
async function send(env, topic, msg, after) {
  const { results } = await env.GOLF.prepare("SELECT endpoint, sub FROM fans WHERE endpoint > ? AND topics LIKE ? ORDER BY endpoint")
    .bind(after || "", '%"' + topic + '"%').all();
  const now = results.slice(0, SEND_MAX), later = results[SEND_MAX];
  const payload = JSON.stringify({ title: msg.title, body: msg.body || "", url: msg.url || "/", tag: topic });
  let sent = 0, gone = 0;
  for (const r of now) {
    const res = await sendPush(env, JSON.parse(r.sub), payload).catch(() => null);
    if (res && (res.status === 404 || res.status === 410)) { await env.GOLF.prepare("DELETE FROM fans WHERE endpoint = ?").bind(r.endpoint).run(); gone++; }
    else if (res && res.ok) sent++;
  }
  if (later) {
    const backlog = JSON.parse((await env.QUEUE.get("fans:backlog")) || "[]");
    backlog.push({ topic, msg, after: now[now.length - 1].endpoint });
    await env.QUEUE.put("fans:backlog", JSON.stringify(backlog));
  }
  return { sent, gone, waiting: later ? results.length - now.length : 0 };
}

// a cat's owners' browsers signed up for "cats" (cats.js catAlerts): owners, the cat's owner keys. A browser that's
// gone (404/410) is dropped
export async function toCatOwners(env, owners, msg) {
  if (!env.GOLF || !env.VAPID_PRIVATE || !(owners || []).length) return 0;
  const { results } = await env.GOLF.prepare("SELECT endpoint, sub FROM fans WHERE topics LIKE '%\"cats\"%' AND cat_owner IN (" + owners.map(() => "?").join(",") + ")")
    .bind(...owners).all();
  const payload = JSON.stringify({ title: msg.title, body: msg.body || "", url: msg.url || "/play/cats/", tag: msg.tag || "cats" });
  let sent = 0;
  for (const r of results.slice(0, SEND_MAX)) {
    const res = await sendPush(env, JSON.parse(r.sub), payload).catch(() => null);
    if (res && (res.status === 404 || res.status === 410)) await env.GOLF.prepare("DELETE FROM fans WHERE endpoint = ?").bind(r.endpoint).run();
    else if (res && res.ok) sent++;
  }
  return sent;
}
