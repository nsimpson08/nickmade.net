// Steam achievements for the Games page's third banner (steam-banner.js), beside Xbox and PlayStation.
//
// Steam's official Web API with Nick's key (Worker secret STEAM_API_KEY; it doesn't expire) and his public profile
// (STEAM_ID below). Steam has no account-wide score like a gamerscore, so the total is his unlocked achievements
// added up game by game: one GetPlayerAchievements request per game.
//   Counting  the first time, every played game that has achievements (~386 of 1,065 owned): STEAM_BATCH a run (the
//             free plan allows 50 outside requests a run, shared with the Xbox and PlayStation steps), so it takes a
//             dozen runs; the banner stays hidden (GET answers 503) until every game is counted
//   After     each check re-counts only the games played in the last two weeks (GetRecentlyPlayedGames), plus
//             his Steam level: 2 requests and one per recent game
// Like the gamerscore: the total is checked every 4 hours (the cron, and owner-mode Refresh), the gains ("+3 in the
// last 24h", 7 days, 30 days) come from one snapshot a night; the first full count rebuilds the last 31 nights from
// unlock times.
//
//   GET /steam/achievements  { total, possible, perfect, games, level, gained, gained7, gained30, at }
//
// KV: steam:games        { games: { appid: { got, of } }, pending: [appid] | null, recent: { "YYYY-MM-DD": unlocks } }
//     steam:achievements { total, possible, perfect, games, level, at, history: [{ date, total }] }

const API = "https://api.steampowered.com";
const STEAM_ID = "76561198024854701"; // steamcommunity.com/id/helloJimHalpert
const STEAM_BATCH = 35;
const GAMES_KEY = "steam:games";
export const STEAM_KEY = "steam:achievements";
const NIGHTS = 60, BACKFILL = 31;

export class SteamError extends Error {}

async function steam(env, path, params) {
  const q = new URLSearchParams(Object.assign({ key: env.STEAM_API_KEY, steamid: STEAM_ID, format: "json" }, params || {}));
  const r = await fetch(API + path + "?" + q);
  // a game with no achievements (or none public) answers 400; that's an answer, not a failure
  if (r.status === 400 && path.includes("GetPlayerAchievements")) return { playerstats: { achievements: [] } };
  if (!r.ok) throw new SteamError("Steam answered " + r.status + ".");
  return r.json();
}

// h = { dateIn, shiftDate, nights, mergeNights } from index.js
export async function recordSteam(env, h) {
  if (!env.STEAM_API_KEY) throw new SteamError("Steam isn't connected (no STEAM_API_KEY).");
  const data = (await env.QUEUE.get(GAMES_KEY, "json")) || { games: {} };
  const today = h.dateIn(env.TIMEZONE, new Date().toISOString());
  const first = h.shiftDate(today, BACKFILL);
  if (!data.games) data.games = {};
  if (!data.recent) data.recent = {};

  // the first time: every played game that has achievements still to count
  // (include_appinfo: Steam only says which games have achievements, has_community_visible_stats, with the app info)
  if (data.pending === undefined) {
    const owned = ((await steam(env, "/IPlayerService/GetOwnedGames/v1/", { include_played_free_games: 1, include_appinfo: 1 })).response || {}).games || [];
    data.pending = owned.filter((g) => g.playtime_forever > 0 && g.has_community_visible_stats).map((g) => String(g.appid));
  }
  // games played in the last two weeks are counted again every time
  const recent = (((await steam(env, "/IPlayerService/GetRecentlyPlayedGames/v1/")).response || {}).games || []).map((g) => String(g.appid));
  const todo = [...new Set(recent.concat((data.pending || []).slice(0, STEAM_BATCH)))];
  const counting = !!(data.pending && data.pending.length);
  for (const appid of todo) {
    let a;
    try { a = ((await steam(env, "/ISteamUserStats/GetPlayerAchievements/v1/", { appid })).playerstats || {}).achievements || []; }
    catch (e) { console.log("steam: skipped app " + appid + ":", e.message); continue; } // one game Steam won't answer for doesn't stop the rest
    const got = a.filter((x) => x.achieved);
    data.games[appid] = { got: got.length, of: a.length };
    // unlocks in the last 31 days, for rebuilding the nights once the first count is done
    if (counting) for (const x of got) {
      if (!x.unlocktime) continue;
      const day = h.dateIn(env.TIMEZONE, new Date(x.unlocktime * 1000).toISOString());
      if (day >= first) data.recent[day] = (data.recent[day] || 0) + 1;
    }
  }
  if (data.pending) data.pending = data.pending.filter((id) => !todo.includes(id));
  const done = !data.pending || !data.pending.length;
  const level = ((await steam(env, "/IPlayerService/GetSteamLevel/v1/")).response || {}).player_level || null;

  const list = Object.values(data.games);
  const total = list.reduce((n, g) => n + g.got, 0);
  const saved = (await env.QUEUE.get(STEAM_KEY, "json")) || { history: [] };
  let history = h.nights(env, saved.history || []);
  if (done && counting) {
    // the first count just finished: a night's total = today's minus everything unlocked on or after it
    const rebuilt = [];
    let after = 0;
    for (let d = today; d >= first; d = h.shiftDate(d, 1)) {
      after += data.recent[d] || 0;
      rebuilt.unshift({ date: d, total: total - after });
    }
    history = h.mergeNights(rebuilt, history);
  }
  if (done) {
    data.pending = null;
    data.recent = {};
    if (!history.some((x) => x.date === today)) history = history.concat({ date: today, total });
  }
  await env.QUEUE.put(GAMES_KEY, JSON.stringify(data));
  const out = {
    total, possible: list.reduce((n, g) => n + g.of, 0), perfect: list.filter((g) => g.of && g.got === g.of).length,
    games: list.filter((g) => g.got).length, level, at: new Date().toISOString(), counting: !done,
    left: done ? 0 : data.pending.length, history: history.slice(-NIGHTS),
  };
  await env.QUEUE.put(STEAM_KEY, JSON.stringify(out));
  return out;
}

export function steamView(env, saved, h) {
  const hist = h.nights(env, saved.history || []);
  const last = hist[hist.length - 1];
  const since = (n) => {
    const then = last && hist.find((x) => x.date === h.shiftDate(last.date, n));
    return then ? last.total - then.total : null;
  };
  return { total: saved.total, possible: saved.possible, perfect: saved.perfect, games: saved.games, level: saved.level, gained: since(1), gained7: since(7), gained30: since(30), at: saved.at };
}
