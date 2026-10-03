// Voting on "In the Queue" (Movies and Games): visitors upvote what Nick should watch or play next; the page puts
// the most-voted first. Every title starts at 1 vote: whoever added it (Nick for his picks, the visitor for a
// suggestion) counts as its first vote, so nobody can vote on their own addition, and Nick (admin) doesn't vote. Both kinds of queue item can be voted on (Nick's list.js picks and visitors' suggestions),
// so votes are keyed by normalized title, which also keeps them when tools/pull_live.py moves a suggestion into list.js.
//
//   GET  /votes?page=&visitorId=   { votes: { <normalized title>: count incl. the adder's 1 }, mine: [titles this browser
//                                  voted], own: [titles this browser suggested] } (only titles still in the queue)
//   POST /votes   { page, title, visitorId, vote: true|false }  -> { key, count, voted }   vote or take it back
//
// One vote per browser per title (the browser id the queues already use), and at most VOTES_PER_IP per title from one
// IP, so clearing the browser doesn't let one person stack votes but a household can still vote separately.
// Storage (the QUEUE namespace): votes:<page>  { <normalized title>: [{ i: browser hash, p: IP hash }] }
//                                votes:rate:<IP hash>:<YYYY-MM-DD>  vote changes from that IP today (expires after 2 days)

const VOTES_PER_IP = 3;
const CHANGES_PER_DAY = 200;

export async function votesRoute(request, url, env, cors, h) {
  if (url.pathname !== "/votes") return null;
  if (request.method === "GET") return list(url, env, cors, h);
  if (request.method === "POST") return vote(request, env, cors, h);
  return null;
}

const key = (page) => "votes:" + page;

async function load(env, page) {
  try { return JSON.parse((await env.QUEUE.get(key(page))) || "{}"); } catch (e) { return {}; }
}

// Normalized titles currently in that page's queue: list.js picks (minus played games, like the cap) + suggestions
// (titles is null if list.js couldn't be read, so nothing gets pruned by mistake), and the suggestions themselves.
async function queueNow(env, page, h) {
  const state = await h.queueState(env, page);
  const titles = state.ownerKnown ? new Set(state.owner.concat(state.items.map((it) => it.title)).map(h.normalize)) : null;
  return { titles, items: state.items };
}

// Titles this browser suggested (their suggestion is already their vote)
async function ownTitles(items, visitorId, env, h) {
  const by = await h.suggesterId(visitorId, env);
  return by ? items.filter((it) => it.by === by).map((it) => h.normalize(it.title)) : [];
}

async function voterIds(request, visitorId, env, h) {
  const salt = env.SALT || "nickmade";
  const i = visitorId && /^[a-z0-9-]{8,64}$/i.test(visitorId) ? await h.sha256(salt + "vote:" + visitorId) : null;
  const ip = request.headers.get("CF-Connecting-IP");
  const p = ip ? await h.sha256(salt + "vote-ip:" + ip) : null;
  return { i, p };
}

async function list(url, env, cors, h) {
  const page = h.pageOf(url.searchParams.get("page"));
  const all = await load(env, page);
  const { titles, items } = await queueNow(env, page, h);
  const visitorId = url.searchParams.get("visitorId");
  const me = visitorId && /^[a-z0-9-]{8,64}$/i.test(visitorId) ? await h.sha256((env.SALT || "nickmade") + "vote:" + visitorId) : null;
  const votes = {};
  const mine = [];
  for (const t of titles || []) votes[t] = 1; // the adder's vote
  for (const [k, voters] of Object.entries(all)) {
    if (titles && !titles.has(k)) continue;
    votes[k] = 1 + voters.length;
    if (me && voters.some((v) => v.i === me)) mine.push(k);
  }
  return h.json({ votes, mine, own: await ownTitles(items, visitorId, env, h) }, 200, cors);
}

async function vote(request, env, cors, h) {
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const page = h.pageOf(body.page);
  const k = h.normalize(String(body.title || "").slice(0, 200));
  const { i, p } = await voterIds(request, body.visitorId, env, h);
  if (!k) return h.json({ error: "Bad request." }, 400, cors);
  if (!i) return h.json({ error: "Voting needs cookies or local storage turned on." }, 400, cors);
  if (h.isAdmin(request, env)) return h.json({ error: "Your picks already count as your vote." }, 403, cors);

  const { titles, items } = await queueNow(env, page, h);
  if (titles && !titles.has(k)) return h.json({ error: "That one isn't in the queue anymore." }, 404, cors);
  if ((await ownTitles(items, body.visitorId, env, h)).includes(k)) {
    return h.json({ error: "That's your suggestion, so it already has your vote." }, 403, cors);
  }

  if (p) { // a cap on vote changes per IP per day, against scripted flipping
    const rate = "votes:rate:" + p + ":" + new Date().toISOString().slice(0, 10);
    const n = parseInt(await env.QUEUE.get(rate), 10) || 0;
    if (n >= CHANGES_PER_DAY) return h.json({ error: "That's a lot of voting for one day. Try again tomorrow!" }, 429, cors);
    await env.QUEUE.put(rate, String(n + 1), { expirationTtl: 2 * 86400 });
  }

  const all = await load(env, page);
  if (titles) for (const t of Object.keys(all)) if (!titles.has(t)) delete all[t]; // watched, played, or removed since
  const voters = all[k] || [];
  const had = voters.some((v) => v.i === i);
  if (body.vote !== false && !had) {
    if (p && voters.filter((v) => v.p === p).length >= VOTES_PER_IP) {
      return h.json({ error: "This one already has " + VOTES_PER_IP + " votes from your network." }, 429, cors);
    }
    voters.push({ i, p });
  }
  const kept = body.vote === false ? voters.filter((v) => v.i !== i) : voters;
  if (kept.length) all[k] = kept; else delete all[k];
  await env.QUEUE.put(key(page), JSON.stringify(all));
  return h.json({ key: k, count: 1 + kept.length, voted: kept.some((v) => v.i === i) }, 200, cors);
}
