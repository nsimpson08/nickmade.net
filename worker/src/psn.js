// PlayStation trophies for the Games page banner (psn-banner.js), next to the Xbox gamerscore one.
//
// Sony has no public trophy API, so this signs in the way the PlayStation App does (the unofficial endpoints the
// psn-api project documents), with Nick's own NPSSO token: copied once from playstation.com while signed in
// (https://ca.account.sony.com/api/v1/ssocookie), kept as the Worker secret PSN_NPSSO. It lasts about 2 months; then
// the banner hides and owner-mode Refresh says the sign-in expired (copy a new one into worker/.dev.vars, then
// `grep '^PSN_NPSSO=' .dev.vars | cut -d= -f2- | npx wrangler secret put PSN_NPSSO` from worker/).
//
// Like the gamerscore: the total is checked every 4 hours (the cron, and Refresh), and the gains ("+12 in the last
// 24h", 7 days, 30 days) come from one snapshot a night, so they change once a day. The first check rebuilds the
// last 31 nights from each trophy's earned time, so the 7- and 30-day gains work straight away.
//
//   GET /psn/trophies   { total, counts: { platinum, gold, silver, bronze }, level, progress, tier, gained, gained7, gained30, at }
//
// KV: psn:auth     { access, accessUntil, refresh, refreshUntil } (Sony's tokens: access an hour, refresh ~10 days;
//                  after that it signs in again with the NPSSO, which is what runs out after ~2 months)
//     psn:trophies { total, counts, level, progress, tier, at, backfilled, history: [{ date, total }] }

const AUTH = "https://ca.account.sony.com/api/authz/v3/oauth";
const API = "https://m.np.playstation.com/api/trophy/v1/users/me";
// the PlayStation App's own client (public in the app; what every PSN trophy tool uses)
const CLIENT = "09515159-7237-4370-9b40-3806e67c0891";
const BASIC = "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
const REDIRECT = "com.scee.psxandroid.scecompcall://redirect";
const SCOPE = "psn:mobile.v2.core psn:clientapp";
const AUTH_KEY = "psn:auth";
export const TROPHIES_KEY = "psn:trophies";
const NIGHTS = 60, BACKFILL = 31;

export class PsnError extends Error {}

// ---------- signing in ----------

async function token(env) {
  const saved = (await env.QUEUE.get(AUTH_KEY, "json")) || {};
  const now = Date.now();
  if (saved.access && saved.accessUntil > now + 60e3) return saved.access;
  let t = null;
  if (saved.refresh && saved.refreshUntil > now + 60e3) {
    t = await exchange({ refresh_token: saved.refresh, grant_type: "refresh_token", token_format: "jwt", scope: SCOPE }).catch(() => null);
  }
  if (!t) t = await signIn(env);
  const out = {
    access: t.access_token,
    accessUntil: now + (t.expires_in || 3600) * 1000,
    refresh: t.refresh_token || saved.refresh,
    refreshUntil: t.refresh_token ? now + (t.refresh_token_expires_in || 5183999) * 1000 : saved.refreshUntil,
  };
  await env.QUEUE.put(AUTH_KEY, JSON.stringify(out));
  return out.access;
}

// NPSSO -> a one-time code (Sony redirects to the app's address with it) -> tokens
async function signIn(env) {
  if (!env.PSN_NPSSO) throw new PsnError("PlayStation isn't connected (no PSN_NPSSO).");
  const q = new URLSearchParams({ access_type: "offline", client_id: CLIENT, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE });
  const r = await fetch(AUTH + "/authorize?" + q, { headers: { Cookie: "npsso=" + env.PSN_NPSSO }, redirect: "manual" });
  const code = new URL(r.headers.get("Location") || "about:blank").searchParams.get("code");
  if (!code) throw new PsnError("The PlayStation sign-in expired. Copy a new NPSSO token (see worker/src/psn.js).");
  return exchange({ code, redirect_uri: REDIRECT, grant_type: "authorization_code", token_format: "jwt" });
}

async function exchange(form) {
  const r = await fetch(AUTH + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: BASIC },
    body: new URLSearchParams(form),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new PsnError("PlayStation refused the sign-in (" + r.status + ").");
  return d;
}

async function psn(env, path) {
  const r = await fetch(API + path, { headers: { Authorization: "Bearer " + (await token(env)), Accept: "application/json" } });
  if (r.status === 401) { await env.QUEUE.delete(AUTH_KEY); throw new PsnError("PlayStation signed us out; it'll sign in again next time."); }
  if (!r.ok) throw new PsnError("PlayStation answered " + r.status + ".");
  return r.json();
}

// ---------- the trophies ----------

// h = { dateIn, shiftDate, nights, mergeNights } from index.js (the same night bookkeeping as the gamerscore)
export async function recordTrophies(env, h) {
  const s = await psn(env, "/trophySummary");
  const e = s.earnedTrophies || {};
  const counts = { platinum: e.platinum || 0, gold: e.gold || 0, silver: e.silver || 0, bronze: e.bronze || 0 };
  const total = counts.platinum + counts.gold + counts.silver + counts.bronze;
  const saved = (await env.QUEUE.get(TROPHIES_KEY, "json")) || { history: [] };
  const date = h.dateIn(env.TIMEZONE, new Date().toISOString());
  let history = h.nights(env, saved.history || []);
  let backfilled = !!saved.backfilled;
  if (!backfilled) {
    try {
      history = h.mergeNights(await backfill(env, h, total, date), history);
      backfilled = true;
    } catch (err) { console.log("trophy backfill failed, will retry:", err.message); }
  }
  if (!history.some((x) => x.date === date)) history = history.concat({ date, total });
  const out = { total, counts, level: s.trophyLevel || null, progress: s.progress || 0, tier: s.tier || null, at: new Date().toISOString(), backfilled, history: history.slice(-NIGHTS) };
  await env.QUEUE.put(TROPHIES_KEY, JSON.stringify(out));
  return out;
}

// the last BACKFILL nights from earned times: a night's total = today's minus everything earned on or after it.
// 1 request for the game list + 1 per game with a trophy in that time.
async function backfill(env, h, total, today) {
  const first = h.shiftDate(today, BACKFILL);
  const list = await psn(env, "/trophyTitles?limit=800");
  const recent = (list.trophyTitles || []).filter((t) => t.lastUpdatedDateTime && h.dateIn(env.TIMEZONE, t.lastUpdatedDateTime) >= first).slice(0, 30);
  const byDay = {};
  const sets = await Promise.all(recent.map((t) =>
    psn(env, "/npCommunicationIds/" + encodeURIComponent(t.npCommunicationId) + "/trophyGroups/all/trophies?npServiceName=" + encodeURIComponent(t.npServiceName || "trophy2"))));
  for (const set of sets) {
    for (const x of set.trophies || []) {
      if (!x.earned || !x.earnedDateTime) continue;
      const day = h.dateIn(env.TIMEZONE, x.earnedDateTime);
      if (day >= first) byDay[day] = (byDay[day] || 0) + 1;
    }
  }
  const out = [];
  let after = 0;
  for (let d = today; d >= first; d = h.shiftDate(d, 1)) {
    after += byDay[d] || 0;
    out.unshift({ date: d, total: total - after });
  }
  return out;
}

// what the banner shows; gains from the nightly snapshots like the gamerscore's (null hides one)
export function trophiesView(env, saved, h) {
  const hist = h.nights(env, saved.history || []);
  const last = hist[hist.length - 1];
  const since = (n) => {
    const then = last && hist.find((x) => x.date === h.shiftDate(last.date, n));
    return then ? last.total - then.total : null;
  };
  return { total: saved.total, counts: saved.counts, level: saved.level, progress: saved.progress, tier: saved.tier, gained: since(1), gained7: since(7), gained30: since(30), at: saved.at };
}
