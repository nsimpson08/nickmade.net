// Music page "Suggest a song": visitors search Spotify and pick a song, which is added straight away to a private
// playlist on Nick's Spotify account ("NickMade Community Recs!", or MUSIC_PLAYLIST_NAME), newest on top.
//
//   GET    /music/search?q=          Spotify song search: { results: [{ id, title, artist, album, image, url, explicit }] }
//   GET    /music/recs?visitorId=    the suggestions, newest first, plus this visitor's allowance:
//                                    { items, ready, yourRemaining, perVisitor }; ready is false until Spotify is
//                                    connected with the playlist permissions (tools/spotify_connect.py)
//   POST   /music/recs               { trackId, name?, visitorId } -> adds the song to the playlist; with the admin token
//                                    it's Nick's own (no name, no limit)
//   DELETE /music/recs/:trackId      Nick (admin), or the visitor who suggested it (?visitorId=), which gives it back
//
// Storage (the QUEUE namespace): music:recs  JSON array of suggestions, newest first
//                                music:playlist  the playlist's Spotify id (found by name, or created, on first use)
//                                visitor:music:<hash>  songs suggested by that visitor (browser id or hashed IP)
//                                spotify:scope  the permissions Nick granted at the last connect

const RECS = "music:recs";
const PLAYLIST = "music:playlist";
const PER_VISITOR = 10;
const SHOW = 100;
export const MUSIC_SCOPES = "playlist-modify-private playlist-read-private";
const LINKS = /https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ru|xyz|ly|gg|me|info|biz|link|site|online|app)\b/i;

export async function musicRoute(request, url, env, cors, h) {
  if (url.pathname === "/music/search" && request.method === "GET") return search(url, env, cors, h);
  if (url.pathname === "/music/recs" && request.method === "GET") return list(request, url, env, cors, h);
  if (url.pathname === "/music/recs" && request.method === "POST") return add(request, env, cors, h);
  if (url.pathname.startsWith("/music/recs/") && request.method === "DELETE") return remove(request, url, env, cors, h);
  return null;
}

class SpotifyError extends Error {}

// A Spotify Web API call as Nick. 401/403 mean the connection or its permissions are missing.
async function api(env, h, path, opts = {}) {
  const token = await h.spotifyAccess(env);
  if (!token) throw new SpotifyError("Spotify isn't connected.");
  const res = await fetch("https://api.spotify.com/v1" + path, {
    method: opts.method || "GET",
    headers: { Authorization: "Bearer " + token, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw new SpotifyError("Spotify needs reconnecting (" + res.status + ").");
  return res;
}

function song(t) {
  const images = (t.album && t.album.images) || [];
  const art = images.find((i) => i.width && i.width <= 320) || images[images.length - 1] || images[0];
  return {
    id: t.id,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    album: t.album ? t.album.name : null,
    image: art ? art.url : null,
    url: t.external_urls ? t.external_urls.spotify : "https://open.spotify.com/track/" + t.id,
    explicit: !!t.explicit,
  };
}

async function recs(env) {
  try { return JSON.parse((await env.QUEUE.get(RECS)) || "[]"); } catch (e) { return []; }
}

function publicRec(r, admin, mine) {
  const out = { id: r.id, title: r.title, artist: r.artist, album: r.album, image: r.image, url: r.url, explicit: r.explicit,
    suggestedBy: r.suggestedBy || null, owner: !!r.owner, createdAt: r.createdAt };
  if (admin || (mine && r.by === mine)) out.canRemove = true;
  if (mine && r.by === mine) out.mine = true;
  return out;
}

async function ready(env) {
  const scope = (await env.QUEUE.get("spotify:scope")) || "";
  return !!(await env.QUEUE.get("spotify:refresh")) && MUSIC_SCOPES.split(" ").every((s) => scope.split(" ").includes(s));
}

async function search(url, env, cors, h) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
  if (q.length < 2) return h.json({ results: [] }, 200, cors);
  try {
    const res = await api(env, h, "/search?" + new URLSearchParams({ q, type: "track", limit: "10" }));
    if (!res.ok) return h.json({ error: "Spotify search didn't answer." }, 502, cors);
    const data = await res.json();
    return h.json({ results: ((data.tracks && data.tracks.items) || []).filter((t) => t && t.id).map(song) }, 200, cors);
  } catch (e) {
    return h.json({ error: "Spotify search isn't available right now." }, 502, cors);
  }
}

async function list(request, url, env, cors, h) {
  const admin = h.isAdmin(request, env);
  const mine = await h.suggesterId(url.searchParams.get("visitorId"), env);
  const keys = await h.visitorKeys(request, url.searchParams.get("visitorId"), env, "music");
  const used = await h.usedBy(keys, env);
  return h.json({
    items: (await recs(env)).slice(0, SHOW).map((r) => publicRec(r, admin, mine)),
    ready: await ready(env),
    yourRemaining: admin ? PER_VISITOR : Math.max(0, PER_VISITOR - used),
    perVisitor: PER_VISITOR,
  }, 200, cors);
}

// The community playlist's id: saved in KV; else found among Nick's playlists by name; else created (private)
async function playlistId(env, h) {
  const saved = await env.QUEUE.get(PLAYLIST);
  if (saved) return saved;
  const name = env.MUSIC_PLAYLIST_NAME || "NickMade Community Recs!";
  let id = null;
  for (let offset = 0; offset < 500 && !id; offset += 50) {
    const res = await api(env, h, "/me/playlists?limit=50&offset=" + offset);
    if (!res.ok) break;
    const data = await res.json();
    const hit = (data.items || []).find((p) => p && p.name === name);
    if (hit) id = hit.id;
    if (!data.next) break;
  }
  if (!id) {
    const body = { name, public: false, description: "Songs suggested by visitors to nickmade.net." };
    let res = await api(env, h, "/me/playlists", { method: "POST", body });
    if (res.status === 404 || res.status === 405) { // older API: create under the user's id
      const me = await (await api(env, h, "/me")).json();
      res = await api(env, h, "/users/" + encodeURIComponent(me.id) + "/playlists", { method: "POST", body });
    }
    if (!res.ok) throw new SpotifyError("Couldn't create the playlist (" + res.status + ").");
    id = (await res.json()).id;
  }
  await env.QUEUE.put(PLAYLIST, id);
  return id;
}

// Add to / remove from the playlist. Spotify renamed /tracks to /items in 2026; try the new name first.
async function playlistItems(env, h, method, uri) {
  const id = await playlistId(env, h);
  const path = "/playlists/" + id;
  const body = method === "POST" ? { uris: [uri], position: 0 } : { items: [{ uri }] };
  let res = await api(env, h, path + "/items", { method, body });
  if (res.status === 404 || res.status === 405 || (method === "DELETE" && res.status === 400)) {
    res = await api(env, h, path + "/tracks", { method, body: method === "POST" ? body : { tracks: [{ uri }] } });
  }
  if (!res.ok) throw new SpotifyError("Spotify didn't take the change (" + res.status + ").");
}

const same = (h, a, b) => a.id === b.id || (h.normalize(a.title) === h.normalize(b.title) && h.normalize(a.artist) === h.normalize(b.artist));

async function add(request, env, cors, h) {
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const trackId = String(body.trackId || "");
  const name = String(body.name || "").replace(/\s+/g, " ").trim();
  const owner = h.isAdmin(request, env);
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) return h.json({ error: "Pick a song from the list." }, 400, cors);
  if (!(await ready(env))) return h.json({ error: "Song suggestions open soon." }, 503, cors);

  let keys = [];
  let used = 0;
  if (!owner) {
    if (name.length > 40) return h.json({ error: "Keep your name to 40 characters." }, 400, cors);
    if (name && h.BLOCKED.some((w) => h.normalize(name).replace(/ /g, "").includes(w))) return h.json({ error: "Please use a different name." }, 400, cors);
    if (name && LINKS.test(name)) return h.json({ error: "Names can't include links." }, 400, cors);
    keys = await h.visitorKeys(request, body.visitorId, env, "music");
    used = await h.usedBy(keys, env);
    if (used >= PER_VISITOR) return h.json({ error: "You've sent " + PER_VISITOR + " songs. Thanks!" }, 429, cors);
  }

  let rec;
  try {
    const res = await api(env, h, "/tracks/" + trackId);
    if (!res.ok) return h.json({ error: "Couldn't find that song." }, 404, cors);
    rec = song(await res.json());
  } catch (e) {
    return h.json({ error: "Spotify isn't available right now." }, 502, cors);
  }
  if ((await recs(env)).some((r) => same(h, r, rec))) return h.json({ error: "Someone already suggested that one." }, 409, cors);

  try {
    await playlistItems(env, h, "POST", "spotify:track:" + rec.id);
  } catch (e) {
    return h.json({ error: "Spotify didn't take it. Try again in a bit." }, 502, cors);
  }
  const by = owner ? null : await h.suggesterId(body.visitorId, env);
  const item = { ...rec, suggestedBy: owner ? null : name || null, owner: owner || undefined, by: by || undefined, createdAt: new Date().toISOString() };
  // Re-read right before writing, in case someone else just added one
  const latest = await recs(env);
  latest.unshift(item);
  await env.QUEUE.put(RECS, JSON.stringify(latest));
  for (const k of keys) await env.QUEUE.put(k, String(used + 1));
  return h.json({
    item: publicRec(item, owner, by),
    yourRemaining: owner ? PER_VISITOR : Math.max(0, PER_VISITOR - used - 1),
  }, 201, cors);
}

async function remove(request, url, env, cors, h) {
  const id = decodeURIComponent(url.pathname.split("/")[3] || "");
  const owner = h.isAdmin(request, env);
  const mine = owner ? null : await h.suggesterId(url.searchParams.get("visitorId"), env);
  const all = await recs(env);
  const rec = all.find((r) => r.id === id);
  if (!rec) return h.json({ error: "Not found." }, 404, cors);
  if (!owner && !(mine && rec.by === mine)) return h.json({ error: "Unauthorized" }, 401, cors);
  try {
    await playlistItems(env, h, "DELETE", "spotify:track:" + rec.id);
  } catch (e) {
    return h.json({ error: "Spotify didn't take the change. Try again in a bit." }, 502, cors);
  }
  await env.QUEUE.put(RECS, JSON.stringify(all.filter((r) => r !== rec)));
  if (!owner) { // give the visitor that song back
    const keys = await h.visitorKeys(request, url.searchParams.get("visitorId"), env, "music");
    const used = await h.usedBy(keys, env);
    for (const k of keys) await env.QUEUE.put(k, String(Math.max(0, used - 1)));
  }
  return h.json({ removed: 1 }, 200, cors);
}
