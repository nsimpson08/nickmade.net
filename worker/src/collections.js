// Library (Ver 1.7): Nick's other collections beside the movie discs (those stay in library.js): vinyl
// records, books and board games. Each starts empty; Nick adds to it on the site in owner mode, by scanning a barcode
// (records, books) or searching. The facts and covers come from free catalogues, looked up once when he adds it:
//   vinyl  MusicBrainz (free, no key; asks for a User-Agent and at most about one request a second), covers from the
//          Cover Art Archive, the "About" from Wikipedia (through the album's Wikidata link; no key)
//   books  Open Library (free, no key), covers from covers.openlibrary.org
//   games  BoardGameGeek's XML API (free, but since 2025 it needs a registered app's token: the BGG_TOKEN secret)
//
//   GET    /collection/:kind                 { items: [newest first] }   kind: vinyl | books | games
//   GET    /collection/:kind/search?q=       (admin) { results: [{ id, title, creator, year, cover, note }] }
//   GET    /collection/:kind/barcode?code=   (admin) the same, for a scanned barcode or ISBN (vinyl, books)
//   GET    /collection/books/covers?id=      (admin) { covers: [{ src, thumb, label }] } every cover Open Library has
//                                            for the book (the scanned edition's, the book's, its other editions'), to pick from
//   GET    /collection/vinyl/backs?id=       (admin) { backs: [{ src, thumb, label, from }] } a record's back cover to pick
//                                            from: its pressing's (Cover Art Archive), other pressings' (labelled
//                                            backs there), and Discogs' photos of its pressing (unlabelled)
//   GET    /collection/vinyl/spotify?id=     { spotify } a record's album on Spotify (its id, or "none"), for the player on
//                                            its card; looked up once for a record added before there was one, then kept
//   GET    /collection/games/howto?id=       { howto: { yt, title } | "none" } a game's How to Play video (BGG's hot
//                                            instructional one), looked up once for a game added before there was one
//   GET    /collection/vinyl/about?id=       { about } a record without an About gets Wikipedia's article on the album
//                                            looked for once (wikiAlbum), then kept
//   POST   /collection/:kind                 (admin) { id, edition?, note?, cover?, back?, unopened? (games) } -> the item, its facts looked up now
//   GET    /collection/vinyl/fronts?id=      (admin) { fronts: [...] } the same, for its front cover (its pressings')
//   PATCH  /collection/vinyl/:itemId         (admin) { back?, spotify?, front? } a record's back cover, chosen on its card ("" = none),
//                                            or its Spotify album (a pasted link; "" = no player)
//   PATCH  /collection/vinyl/:itemId         (admin) { labelPic?, labelPicB?, labelZoom?, labelZoomB?, labelX?, labelY?, labelXB?, labelYB? } its label photos, each one's zoom and position
//   PATCH  /collection/:kind/:itemId         (admin) { edition?, note? } its pressing/edition and note, from its card
//   PATCH  /collection/games/:itemId         (admin) { pick?, unopened? } Nick's Pick on a game (a ribbon + its filter);
//                                            Unopened (owner only: GET leaves it out unless signed in as the owner)
//   PUT    /collection/vinyl/:itemId/scan?side=front|back|label|labelB  (admin) body: Nick's own scan (JPEG/PNG/WebP) -> { item }
//   PUT    /collection/<kind>/:itemId/thumb?of=<its cover's address>  (admin) body: a small JPEG copy of the cover -> { item }
//                     (thumb, thumbOf: see putThumb)
//   POST   /collection/vinyl/:itemId/look    (admin) the record's colour read from its photos (Workers AI) -> { item }
//   DELETE /collection/:kind/:itemId         (admin)
//
// Storage (the QUEUE namespace): collection:<kind>  JSON array of items, newest first. Each item's cover is copied
// into the photos bucket when it's added (covers/<kind>-<id>.jpg, served at photos.nickmade.net), so the shelves
// don't depend on the catalogues' image servers (archive.org, behind the Cover Art Archive, fails now and then).
import { aiRun } from "./aimeter.js"; // (every AI call is metered: aimeter.js)

const KINDS = ["vinyl", "books", "games"];
const MB = "https://musicbrainz.org/ws/2";
const MB_UA = "nickmade.net/1.7 ( https://nickmade.net )";
const OL = "https://openlibrary.org";
const BGG = "https://boardgamegeek.com/xmlapi2";
const MAX = 2000;

export async function collectionsRoute(request, url, env, cors, h) {
  // (a book's own photo of its cover too: Nick, 2026-11-04)
  const sc = /^\/collection\/(vinyl|books)\/([\w.-]{1,120})\/scan$/.exec(url.pathname);
  if (sc && request.method === "PUT") {
    if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
    const sd = url.searchParams.get("side");
    return putScan(request, env, h, sc[2], sc[1] === "vinyl" && ["back", "label", "labelB"].includes(sd) ? sd : "front", cors, sc[1]);
  }
  const th = /^\/collection\/(vinyl|books|games)\/([\w.-]{1,120})\/thumb$/.exec(url.pathname);
  if (th && request.method === "PUT") {
    if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
    return putThumb(request, env, h, th[1], th[2], url.searchParams.get("of") || "", cors);
  }
  const lk = /^\/collection\/vinyl\/([\w.-]{1,120})\/look$/.exec(url.pathname);
  if (lk && request.method === "POST") {
    if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
    return lookFill(env, h, lk[1], cors);
  }
  const m = /^\/collection\/(vinyl|books|games)(?:\/(search|barcode|howto|[\w.-]{1,120}))?$/.exec(url.pathname);
  if (!m) return null;
  const kind = m[1], sub = m[2] || "";
  // (a game's "unopened" mark is Nick's alone: only the owner's copy of the list carries it)
  if (!sub && request.method === "GET") {
    const items = await list(env, kind);
    return h.json({ items: h.isAdmin(request, env) ? items : items.map(({ unopened, ...rest }) => rest) }, 200, cors);
  }
  if (sub === "howto" && kind === "games" && request.method === "GET") {
    try { return await howToFill(env, h, url.searchParams.get("id") || "", cors); }
    catch (e) { return h.json({ error: "BoardGameGeek's videos aren't answering right now." }, 502, cors); }
  }
  if (sub === "about" && kind === "vinyl" && request.method === "GET") {
    try { return await aboutFill(env, h, url.searchParams.get("id") || "", cors); }
    catch (e) { return h.json({ about: "" }, 200, cors); }
  }
  if (sub === "spotify" && kind === "vinyl" && request.method === "GET") {
    try { return await spotifyFill(env, h, url.searchParams.get("id") || "", cors); }
    catch (e) { return h.json({ error: "Spotify isn't answering right now." }, 502, cors); }
  }
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  try {
    if (sub === "backs" && kind === "vinyl" && request.method === "GET") return h.json({ backs: await recordBacks(env, url.searchParams.get("id") || "") }, 200, cors);
    if (sub === "fronts" && kind === "vinyl" && request.method === "GET") return h.json({ fronts: await recordBacks(env, url.searchParams.get("id") || "", "front") }, 200, cors);
    if (sub === "covers" && kind === "books" && request.method === "GET") return h.json({ covers: await bookCovers(url.searchParams.get("id") || "", env, url.searchParams.get("t") || "", url.searchParams.get("a") || "") }, 200, cors);
    if (sub === "search" && request.method === "GET") return h.json({ results: await search(env, kind, (url.searchParams.get("q") || "").trim().slice(0, 100)) }, 200, cors);
    if (sub === "barcode" && request.method === "GET") return h.json({ results: await barcode(env, kind, (url.searchParams.get("code") || "").replace(/[^\dXx]/g, "")) }, 200, cors);
    if (!sub && request.method === "POST") return add(request, env, kind, cors, h);
    if (sub && request.method === "DELETE") return remove(env, kind, sub, cors, h);
    if (sub && request.method === "PATCH") return patch(request, env, kind, sub, cors, h);
  } catch (e) {
    return h.json({ error: e.message || "Something went wrong. Try again in a bit." }, 502, cors);
  }
  return null;
}

async function list(env, kind) {
  try { return JSON.parse((await env.QUEUE.get("collection:" + kind)) || "[]"); } catch (e) { return []; }
}
async function save(env, kind, items) { await env.QUEUE.put("collection:" + kind, JSON.stringify(items.slice(0, MAX))); }
// One item's change, saved on the list as it is NOW (Nick, 2026-10-31: fronts and backs he picked were switched back):
// the list is read again right before writing and only this item is changed (fn edits it; false = nothing to save).
// Anything slow (fetching a cover, an AI read) happens before, so a change saved meanwhile (the page's small cover copy,
// its colour, its description, another pick) isn't written over with an older copy of the list.
async function update(env, kind, itemId, fn) {
  const items = await list(env, kind), item = items.find((x) => x.id === itemId);
  if (!item) return null;
  if (fn(item) === false) return item;
  await save(env, kind, items);
  return item;
}
const COVER_FIELDS = ["cover", "coverFrom", "frontScan", "back", "backFrom", "backScan"];
// copy a record's cover fields from a worked-on copy (set or cleared)
function coversFrom(src) { return (it) => { for (const f of COVER_FIELDS) { if (src[f] === undefined) delete it[f]; else it[f] = src[f]; } }; }
const today = (env) => new Intl.DateTimeFormat("en-CA", { timeZone: env.TIMEZONE || "America/Chicago" }).format(new Date());
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n || 200);

// ---------- looking things up ----------
async function search(env, kind, q) {
  if (q.length < 2) return [];
  // MusicBrainz's versions, then Discogs' that MusicBrainz doesn't have (its only Watching Movies with the Sound Off on
  // vinyl is the 10th anniversary box set)
  if (kind === "vinyl") {
    const link = /discogs\.com\/(?:[^/]+\/)?release\/(\d{1,10})/i.exec(q);
    if (link) return dgRelease(env, link[1]);
    const mb = await mbSearch(vinylQuery(q), q);
    // the album asked for first, from either (MusicBrainz's near misses, "The Movies" for Watching Movies..., after),
    // and of it, the plain version before the special editions
    return rankVinyl(mb.concat(await dgSearch(env, "q=" + encodeURIComponent(q), mb).catch(() => [])), q).slice(0, 12);
  }
  if (kind === "books") return olSearch("q=" + encodeURIComponent(q));
  return bggSearch(env, q);
}
async function barcode(env, kind, code) {
  if (code.length < 8) return [];
  // MusicBrainz, else Discogs (Nick, 2026-10-29: Watching Movies with the Sound Off's 2-LP, 881034122773, is only on Discogs)
  if (kind === "vinyl") { const mb = await mbSearch("barcode:" + code); return mb.length ? mb : rankVinyl(await dgSearch(env, "barcode=" + encodeURIComponent(code), []), ""); }
  if (kind === "books") return olIsbn(code);
  return []; // BoardGameGeek doesn't look up barcodes: games are found by name
}

// What Nick types ("thriller michael jackson", "abbey road") as a MusicBrainz query on vinyl releases: the whole phrase
// as the album or the artist counts most, then every way of splitting the words into album + artist ("thriller" +
// "michael jackson"), then any of the words
const VINYL = '(format:"12\\" Vinyl" OR format:Vinyl OR format:"10\\" Vinyl" OR format:"7\\" Vinyl")';
function vinylQuery(q) {
  const words = q.replace(/[^\p{L}\p{N}' ]+/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const phrase = words.join(" ");
  const parts = ['release:"' + phrase + '"^6', 'artist:"' + phrase + '"^3'];
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    parts.push('(release:"' + a + '" AND artist:"' + b + '")^8', '(release:"' + b + '" AND artist:"' + a + '")^8');
  }
  parts.push("release:(" + phrase + ")", "artist:(" + phrase + ")");
  return "(" + parts.join(" OR ") + ") AND " + VINYL;
}

// MusicBrainz asks for about one request a second, and answers 503 to more; the Worker's requests leave from
// addresses other sites share, so a 503 gets two more tries, a second or so apart
async function mbFetch(url) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { "User-Agent": MB_UA, Accept: "application/json" } });
    if (res.status !== 503) return res;
    await new Promise((r) => setTimeout(r, 1100 + i * 700));
  }
  throw new Error("MusicBrainz is busy. Try again in a moment.");
}
// MusicBrainz releases: one result per release (a pressing); an exact album title (or album + artist) first, then vinyl
async function mbSearch(query, typed) {
  const res = await mbFetch(MB + "/release?fmt=json&limit=25&query=" + encodeURIComponent(query));
  const d = await res.json();
  const vinyl = (r) => (r.media || []).some((m) => /vinyl/i.test(m.format || ""));
  const n = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const said = n(typed);
  const exact = (r) => { const t = n(r.title), a = n((r["artist-credit"] || []).map((x) => x.name).join(" ")); return said && (t === said || said === t + " " + a || said === a + " " + t); };
  // albums before singles; and of the same exact title, the oldest first (Pink Floyd's, not a 2009 cover of it)
  const album = (r) => /album/i.test(((r["release-group"] || {})["primary-type"]) || "");
  const rank = (r) => (exact(r) ? 0 : 4) + (album(r) ? 0 : 2) + (vinyl(r) ? 0 : 1);
  const yr = (r) => parseInt(String(r.date || "9999").slice(0, 4), 10) || 9999;
  const sorted = (d.releases || []).map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || (exact(a[0]) && exact(b[0]) ? yr(a[0]) - yr(b[0]) : 0) || a[1] - b[1]).map((x) => x[0]);
  // One choice per version of the album (Nick, 2026-10-29: a barcode gave 6 pressings of good kid, m.A.A.d city that
  // were all the same; "collapse all options into just a US version choice if they match in tracklist and everything
  // else"): pressings of the same album on the same discs with the same number of tracks and no edition of their own
  // (a colour, deluxe, anniversary...: not "made in the EU" or "Re-1 in runout") are one choice, the US pressing (the
  // newest, else the newest of any country). Versions that differ stay separate, each saying what's different.
  const groups = new Map();
  for (const r of sorted) {
    // the label by its main name ("Epic/Sony Inc." is Epic), so a country's arm of it isn't another version
    const label = n(((r["label-info"] || [])[0] || {}).label ? r["label-info"][0].label.name : "").split(" ")[0]; // (Mobile Fidelity's Thriller isn't Epic's)
    const key = [(r["release-group"] || {}).id || n(r.title), formats(r.media), tracksOf(r), editionOf(r), label].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const picks = [...groups.values()].map((g) => ({ r: pickPressing(g), count: g.length }));
  // what sets a version apart, when more than one of the album is listed: its track count, its edition, its discs
  const ofAlbum = (r) => (r["release-group"] || {}).id || n(r.title);
  const siblings = (p) => picks.filter((q) => ofAlbum(q.r) === ofAlbum(p.r));
  return picks.slice(0, 10).map((p) => {
    const r = p.r, sib = siblings(p), diff = sib.length > 1;
    const many = (k) => new Set(sib.map((q) => k(q.r))).size > 1;
    return {
      id: r.id,
      title: r.title,
      creator: (r["artist-credit"] || []).map((a) => a.name + (a.joinphrase || "")).join("").trim(),
      year: parseInt(String(r.date || "").slice(0, 4), 10) || null,
      cover: "https://coverartarchive.org/release/" + r.id + "/front-250",
      note: [editionOf(r) ? cap(editionOf(r)) : "", formats(r.media), diff && many(tracksOf) ? tracksOf(r) + " tracks" : "", r.country,
        ((r["label-info"] || [])[0] || {}).label ? r["label-info"][0].label.name : ""].filter(Boolean).join(" · "),
      same: [n(r.title), n((r["artist-credit"] || []).map((a) => a.name).join(" ")), discsOf(r.media), editionOf(r) ? "ed" : ""].join("|"), // (for dgSearch)
      edition: !!editionOf(r), // (for rankVinyl)
    };
  });
}
const discsOf = (media) => (media || []).filter((m) => /vinyl/i.test(m.format || "")).length;
// a track's number as A1, B2, 3 or 1-4: a side's own name in front of it goes ("40 Side North – A1" on Illmatic is A1;
// Nick, 2026-11-01: "way too long and creating ugly design")
const shortNum = (n) => { const s = String(n || "").trim(), m = /\s/.test(s) && /((?:\d+-)?[A-Z]{0,2}\d{1,3}[a-z]?)\s*$/.exec(s); return m ? m[1] : s; };
const tracksOf = (r) => (r.media || []).reduce((t, m) => t + (m["track-count"] || 0), 0);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// a release's own edition, from MusicBrainz's note on it: kept when it names something you'd see or hear ("red vinyl",
// "deluxe edition", "10th anniversary"), not when it only tells pressings apart ("made in the EU", "“Re-1” in runout")
const EDITION = /deluxe|anniversary|edition|expanded|remaster|colou?red|vinyl|splatter|marble|swirl|picture|clear|translucent|transparent|limited|exclusive|signed|box\b|\b(red|blue|green|yellow|orange|purple|pink|white|gold|silver|black|grey|gray)\b/i;
const PRESSING = /made in|printed in|runout|matrix|\bre-?\d|press(ed|ing)?\b|sticker|barcode|hype|obi|insert|club/i;
function editionOf(r) {
  const t = String(r.disambiguation || "").replace(/[“”"]/g, "").trim();
  return t && EDITION.test(t) && !PRESSING.test(t) ? t.toLowerCase() : "";
}
// of one version's pressings: the newest US one, else the newest of any (undated ones last)
function pickPressing(g) {
  const yr = (r) => parseInt(String(r.date || "").slice(0, 4), 10) || 0;
  const us = g.filter((r) => r.country === "US");
  return (us.length ? us : g).slice().sort((a, b) => yr(b) - yr(a))[0];
}
// a release's discs: "2×12\" Vinyl", "12\" Vinyl + 7\" Vinyl"
function formats(media) {
  const n = {};
  (media || []).forEach((m) => { if (m.format) n[m.format] = (n[m.format] || 0) + 1; });
  return Object.keys(n).map((f) => (n[f] > 1 ? n[f] + "×" : "") + f).join(" + ");
}
// Open Library's search is slow (usually 2-4 s, now and then 15): the same search again comes from Cloudflare's cache
// for a day, and one that takes over 20 s stops with a message rather than leaving "Searching…" up
async function olSearch(qs) {
  let res;
  try {
    res = await fetch(OL + "/search.json?" + qs + "&limit=10&fields=key,title,author_name,first_publish_year,cover_i,edition_count,number_of_pages_median", {
      headers: { "User-Agent": MB_UA, Accept: "application/json" }, cf: { cacheTtl: 86400, cacheEverything: true }, signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error("Open Library is taking too long to answer. Try again in a moment.");
  }
  if (!res.ok) throw new Error("Open Library's search is having trouble (" + res.status + "). Try again in a moment.");
  const d = await res.json();
  return (d.docs || []).map((b) => ({
    id: String(b.key || "").replace("/works/", ""),
    title: b.title,
    creator: (b.author_name || []).slice(0, 3).join(", "),
    year: b.first_publish_year || null,
    cover: b.cover_i ? "https://covers.openlibrary.org/b/id/" + b.cover_i + "-M.jpg" : "",
    note: [b.number_of_pages_median ? b.number_of_pages_median + " pages" : "", b.edition_count ? b.edition_count + " editions" : ""].filter(Boolean).join(" · "),
  })).filter((b) => /^OL\d+W$/.test(b.id));
}
// an ISBN: that exact edition (its work, plus the edition so its pages and publisher are this copy's)
async function olIsbn(isbn) {
  const res = await fetch(OL + "/isbn/" + isbn + ".json", { redirect: "follow" });
  if (!res.ok) return [];
  const ed = await res.json();
  const work = ((ed.works || [])[0] || {}).key;
  if (!work) return [];
  const w = await (await fetch(OL + work + ".json")).json();
  const authors = await olAuthors(w.authors);
  return [{
    id: work.replace("/works/", "") + "~" + String(ed.key || "").replace("/books/", ""),
    title: ed.title || w.title,
    creator: authors.join(", "),
    year: parseInt(String(ed.publish_date || "").match(/\d{4}/) || "", 10) || null,
    cover: (ed.covers || [])[0] > 0 ? "https://covers.openlibrary.org/b/id/" + ed.covers[0] + "-M.jpg" : (w.covers || [])[0] > 0 ? "https://covers.openlibrary.org/b/id/" + w.covers[0] + "-M.jpg" : "",
    note: [ed.number_of_pages ? ed.number_of_pages + " pages" : "", (ed.publishers || [])[0], ed.physical_format].filter(Boolean).join(" · "),
  }];
}
async function olAuthors(list) {
  const keys = (list || []).map((a) => (a.author || a).key).filter(Boolean).slice(0, 3);
  const names = await Promise.all(keys.map((k) => fetch(OL + k + ".json").then((r) => r.json()).then((a) => a.name).catch(() => "")));
  return names.filter(Boolean);
}

// BoardGameGeek: XML, read with a few patterns (a Worker has no XML parser)
function bggHeaders(env) {
  if (!env.BGG_TOKEN) throw new Error("Board game search needs a BoardGameGeek app token (the BGG_TOKEN secret).");
  return { Authorization: "Bearer " + env.BGG_TOKEN, Accept: "application/xml" };
}
const attr = (xml, tag, name) => { const m = new RegExp("<" + tag + "\\b[^>]*\\b" + name + '="([^"]*)"', "i").exec(xml); return m ? unxml(m[1]) : ""; };
const unxml = (s) => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const ENTS = { nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", eacute: "é", egrave: "è", uuml: "ü", ouml: "ö", auml: "ä", times: "×", deg: "°", trade: "™", reg: "®", copy: "©" };
const unhtml = (s) => unxml(String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&([a-z]+);/gi, (m, n) => ENTS[n.toLowerCase()] ?? m));
async function bggSearch(env, q) {
  const res = await fetch(BGG + "/search?type=boardgame&query=" + encodeURIComponent(q), { headers: bggHeaders(env) });
  if (res.status === 401) throw new Error("BoardGameGeek didn't accept the app token.");
  const xml = await res.text();
  // BGG returns matches in no useful order ("Ticket to Ride" itself is 137th of 207), so rank them by name first:
  // the exact title, then titles starting with it, then the rest; fan-made expansions last
  const want = q.trim().toLowerCase();
  const byName = (n) => { n = n.toLowerCase(); return (n === want ? 0 : n.startsWith(want) ? 1 : n.includes(want) ? 2 : 3) + (/fan expansion|fan-made/.test(n) ? 4 : 0); };
  const all = [...xml.matchAll(/<item\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/item>/g)].map((m, i) => ({ id: m[1], body: m[2], i, n: byName(attr(m[2], "name", "value")) }));
  if (!all.length) return [];
  const seen = new Set();
  const items = all.sort((a, b) => a.n - b.n || a.i - b.i).filter((i) => !seen.has(i.id) && seen.add(i.id)).slice(0, 20);
  // their box art, player counts and votes: one "thing" request for up to 20, then the most played first within each name group
  const things = await bggThings(env, items.map((i) => i.id));
  items.sort((a, b) => a.n - b.n || ((things[b.id] || {}).votes || 0) - ((things[a.id] || {}).votes || 0));
  return items.slice(0, 12).map((i) => {
    const t = things[i.id] || {};
    return {
      id: i.id,
      title: t.title || attr(i.body, "name", "value"),
      creator: (t.designers || []).slice(0, 2).join(", "),
      year: t.year || parseInt(attr(i.body, "yearpublished", "value"), 10) || null,
      cover: t.thumb || "",
      note: [t.players, t.time].filter(Boolean).join(" · "),
    };
  });
}
async function bggThings(env, ids) {
  if (!ids.length) return {};
  const res = await fetch(BGG + "/thing?stats=1&id=" + ids.join(","), { headers: bggHeaders(env) });
  const xml = await res.text();
  const out = {};
  for (const m of xml.matchAll(/<item\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/item>/g)) {
    const b = m[2];
    const min = attr(b, "minplayers", "value"), max = attr(b, "maxplayers", "value");
    const mins = attr(b, "playingtime", "value"), minAge = attr(b, "minage", "value");
    // play time as BGG shows it: "30–60 min" when the box gives a range
    const tLo = parseInt(attr(b, "minplaytime", "value"), 10) || parseInt(mins, 10) || 0, tHi = parseInt(attr(b, "maxplaytime", "value"), 10) || tLo;
    // the players' vote on the best count ("Best with 3–4 players"), and the game's overall Board Game Rank
    const bestWith = unxml((/<result\b[^>]*name="bestwith"[^>]*value="([^"]*)"/.exec(b) || [])[1] || "");
    const best = (/Best with ([\d\s–\-+,]+?)\s*players?/i.exec(bestWith) || [])[1] || "";
    const rank = parseInt((/<rank\b[^>]*name="boardgame"[^>]*value="(\d+)"/.exec(b) || [])[1], 10) || null;
    out[m[1]] = {
      title: (/<name\b[^>]*type="primary"[^>]*value="([^"]*)"/.exec(b) || [])[1] ? unxml(/<name\b[^>]*type="primary"[^>]*value="([^"]*)"/.exec(b)[1]) : "",
      year: parseInt(attr(b, "yearpublished", "value"), 10) || null,
      thumb: ((/<thumbnail>([^<]*)<\/thumbnail>/.exec(b) || [])[1] || "").trim(),
      image: ((/<image>([^<]*)<\/image>/.exec(b) || [])[1] || "").trim(),
      // (BGG escapes its descriptions twice: after unxml they still hold &nbsp; &mdash; &#10; ...)
      // (its paragraphs kept, without BGG's "—description from the publisher" credit lines: Nick, 2026-11-04)
      description: unhtml(unxml(((/<description>([\s\S]*?)<\/description>/.exec(b) || [])[1] || ""))).replace(/<[^>]+>/g, " ").split(/\n\s*\n|\n/)
        .map((p) => p.replace(/[ \t ]+/g, " ").trim().replace(/^description from (the )?(publisher|designer)\s*:?\s*/i, "").replace(/\s*[—–-]+\s*(description|text)?\s*from (the )?(publisher|designer|manufacturer|box)[^\n]*$/i, "").replace(/\s*\(see:?\s*https?:[^)]*\)/gi, "").trim())
        .filter(Boolean).join("\n\n"),
      designers: [...b.matchAll(/<link\b[^>]*type="boardgamedesigner"[^>]*value="([^"]*)"/g)].map((x) => unxml(x[1])),
      publisher: unxml(([...b.matchAll(/<link\b[^>]*type="boardgamepublisher"[^>]*value="([^"]*)"/g)][0] || [])[1] || ""), // ("Indie Boards &amp; Cards")
      categories: [...b.matchAll(/<link\b[^>]*type="boardgamecategory"[^>]*value="([^"]*)"/g)].map((x) => unxml(x[1])).slice(0, 5),
      players: min ? (min === max || !max ? min : min + "–" + max) + " players" : "",
      minPlayers: parseInt(min, 10) || null,
      maxPlayers: parseInt(max, 10) || parseInt(min, 10) || null,
      best: best.replace(/-/g, "–").trim(),
      time: tLo ? (tHi > tLo ? tLo + "–" + tHi : tLo) + " min" : "",
      minTime: tLo || null,
      maxTime: tHi || null,
      rank,
      votes: parseInt(attr(b, "usersrated", "value"), 10) || null,
      mechanics: [...b.matchAll(/<link\b[^>]*type="boardgamemechanic"[^>]*value="([^"]*)"/g)].map((x) => unxml(x[1])).slice(0, 6),
      minAge: minAge && minAge !== "0" ? minAge + "+" : "",
      rating: parseFloat(attr(b, "average", "value")) || null,
      weight: parseFloat(attr(b, "averageweight", "value")) || null,
    };
  }
  return out;
}

// ---------- adding ----------
async function add(request, env, kind, cors, h) {
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const id = String(body.id || "");
  let item;
  if (kind === "vinyl") item = /^dg-/.test(id) ? await dgItem(env, id.slice(3)) : await vinylItem(id);
  else if (kind === "books") item = await bookItem(id, env);
  else item = await gameItem(env, id);
  if (!item) return h.json({ error: "Couldn't get that one's details. Try again in a bit." }, 502, cors);
  const items = await list(env, kind);
  if (items.some((x) => x.id === item.id)) return h.json({ error: "That one's already in the library." }, 409, cors);
  // a book's cover picked in the add dialog (one of bookCovers' Open Library covers) instead of the one it came with
  // (or a shop's, Apple Books' or Google Books': the same choices as on its card)
  if (kind === "books" && (/^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-L\.jpg$/.test(String(body.cover || "")) || shopCover(String(body.cover || "")))) item.cover = body.cover;
  // (Discogs' stay at Discogs; a new name each time, so one removed and added again doesn't show its old cover from a cache)
  if (item.cover && !item.coverFrom) item.cover = await keepCover(env, kind, item.id + "-" + Date.now().toString(36), item.cover).catch(() => item.cover);
  if (kind === "vinyl" && typeof body.back === "string") await setBack(env, item, body.back);
  if (kind === "vinyl") item.spotify = await spotifyFor(env, h, item).catch(() => item.spotify); // (a failed search: looked for when its card opens)
  if (kind === "vinyl" && /^[A-Za-z0-9]{22}$/.test(item.spotify || "")) item.spotifyTracks = await spotifyTracks(env, h, item.spotify, item.tracks, item).catch(() => undefined);
  if (kind === "vinyl" && item.spotifyTracks && !(await spotifyPlays(env, h, item.spotifyTracks).catch(() => true))) item.spotifyOff = true;
  if (kind === "vinyl" && !item.runtime && (item.tracks || []).length && item.tracks.every((t) => t.ms)) item.runtime = item.tracks.reduce((a, t) => a + t.ms, 0); // (lengths filled from Spotify)
  // a soundtrack says so in its genres, whatever its source called it (Drive: electronic, synth-pop; Nick, 2026-11-01)
  if (kind === "vinyl" && /soundtrack|motion picture|original score|music from (the )?(motion picture|film|movie|series|show)|\bost\b/i.test(item.title || "") && !(item.genres || []).some((g) => /soundtrack|score/i.test(g)))
    item.genres = ["soundtrack"].concat(item.genres || []);
  item.edition = clean(body.edition, 80);
  item.note = clean(body.note, 280);
  if (kind === "games" && body.unopened === true) item.unopened = true; // (private: see the GET)
  item.added = today(env);
  for (const k of Object.keys(item)) if (item[k] === "" || item[k] == null || (Array.isArray(item[k]) && !item[k].length)) delete item[k];
  // (the list read again: fetching the covers and Spotify took seconds, and a change saved meanwhile must stay)
  const now = await list(env, kind);
  if (now.some((x) => x.id === item.id)) return h.json({ error: "That one's already in the library." }, 409, cors);
  now.unshift(item);
  await save(env, kind, now);
  return h.json({ item }, 201, cors);
}

// a record's back picked in the add dialog or on its card (recordBacks), or none (""): a Cover Art Archive back is
// copied to R2 (free to reuse); a Discogs photo is shown from Discogs, not copied (their images aren't free to reuse,
// and their API asks for a credit: the card names them)
async function setBack(env, item, back) {
  const b = String(back).trim(), old = item.back;
  if (!b) { delete item.back; delete item.backFrom; }
  else if (/^https:\/\/coverartarchive\.org\/release\/[0-9a-f-]{36}\/back(-\d+)?$/.test(b)) { item.back = b; delete item.backFrom; }
  else if (/^https:\/\/i\.discogs\.com\//.test(b)) { item.back = b; item.backFrom = "Discogs"; }
  else return;
  // (a new name each time, like a front: the same address for a different back showed the old one from the browser's cache)
  if (item.back && !item.backFrom) item.back = await keepCover(env, "vinyl", item.id + "-back-" + Date.now().toString(36), item.back).catch(() => item.back);
  // a copy of the one it had goes, if it's not the same file (keepCover reuses the name)
  if (old && old !== item.back && old.startsWith(photoBase(env) + "covers/") && env.PHOTOS && !(item.back || "").startsWith(old)) await env.PHOTOS.delete(old.slice(photoBase(env).length)).catch(() => {});
}
// a record's front cover, chosen on its card: one of its pressings' (copied into the photos bucket under a new name, so
// no cache shows the old one) or Discogs' photo of its pressing (left at Discogs, like a back)
async function setFront(env, item, front) {
  const f = String(front).trim(), old = item.cover;
  if (/^https:\/\/coverartarchive\.org\/release\/[0-9a-f-]{36}\/front(-\d+)?$/.test(f) || /^https:\/\/is\d-ssl\.mzstatic\.com\/image\/thumb\//.test(f)) {
    item.cover = await keepCover(env, "vinyl", item.id + "-f" + Date.now().toString(36), f).catch(() => f);
    delete item.coverFrom;
  } else if (/^https:\/\/i\.discogs\.com\//.test(f)) { item.cover = f; item.coverFrom = "Discogs"; }
  else return false;
  if (old && old !== item.cover && old.startsWith(photoBase(env) + "covers/") && env.PHOTOS) await env.PHOTOS.delete(old.slice(photoBase(env).length)).catch(() => {});
  return true;
}
// PATCH /collection/vinyl/:id { back }: change a record's back cover from its card (owner mode)
async function patch(request, env, kind, itemId, cors, h) {
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const items = await list(env, kind), item = items.find((x) => x.id === itemId);
  if (!item) return h.json({ error: "Not in the library." }, 404, cors);
  // its pressing/edition and note, edited on its card (Nick, 2026-10-29: "allow me to edit details on vinyl, the notes and
  // pressing fields"); any kind ("" clears one)
  const pickable = kind === "vinyl" || kind === "books"; // (a book too: Nick, 2026-11-04 "like the other pages")
  if (typeof body.edition === "string" || typeof body.note === "string" || (pickable && typeof body.pick === "boolean")) {
    const saved = await update(env, kind, itemId, (it) => {
      for (const [k, n] of [["edition", 80], ["note", 280]]) if (typeof body[k] === "string") { const v = clean(body[k], n); if (v) it[k] = v; else delete it[k]; }
      // a record (or book) as one of Nick's Picks, from the same form (Nick, 2026-11-02)
      if (pickable && typeof body.pick === "boolean") { if (body.pick) it.pick = true; else delete it.pick; }
    });
    return h.json({ item: saved }, 200, cors);
  }
  // a book's cover, chosen on its card (Nick, 2026-11-04: "open each book and choose a new cover image for it"): one of
  // bookCovers' (Open Library's shown from Open Library, as when it's added; Apple Books' and Google Books' copied into the
  // photos bucket under a new name, like a record's Apple Music front)
  if (kind === "books" && typeof body.cover === "string") {
    const f = body.cover.trim();
    let cover;
    if (/^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-L\.jpg$/.test(f)) cover = f;
    else if (shopCover(f)) {
      cover = await keepCover(env, "books", itemId + "-c" + Date.now().toString(36), f).catch(() => f);
      // (not kept: no picture there after all, like Amazon's 1-pixel "none")
      if (env.PHOTOS && cover === f) return h.json({ error: "That cover couldn't be fetched. Pick another." }, 502, cors);
    } else return h.json({ error: "That isn't one of its covers." }, 400, cors);
    let old = null;
    const saved = await update(env, kind, itemId, (it) => { old = it.cover; it.cover = cover; delete it.frontScan; });
    if (old && old !== cover && old.startsWith(photoBase(env) + "covers/") && env.PHOTOS) await env.PHOTOS.delete(old.slice(photoBase(env).length)).catch(() => {});
    return h.json({ item: saved }, 200, cors);
  }
  // a game: Nick's Pick on or off (Nick, 2026-10-29: "mark a game in owner mode as Nick's Pick like disc library")
  // and "Unopened" (Nick, 2026-10-29: private, so he knows which games are new; the public list never has it)
  if (kind === "games" && (typeof body.pick === "boolean" || typeof body.unopened === "boolean")) {
    const saved = await update(env, kind, itemId, (it) => { for (const k of ["pick", "unopened"]) if (typeof body[k] === "boolean") { if (body[k]) it[k] = true; else delete it[k]; } });
    return h.json({ item: saved }, 200, cors);
  }
  // a record's label photos (Nick, 2026-11-01: the record pulled out of its sleeve shows its real label, not the front
  // cover in a circle): labelPic (side A), labelPicB (side B, shown when the record is turned over), labelZoom (how far
  // to zoom into the photo's centre, 1-4, for a photo of the whole disc). One of its photos (Discogs, shown from Discogs
  // like a back; the Cover Art Archive; Nick's own uploads), or "" for none. Nothing is copied.
  const LABEL_KEYS = ["labelPic", "labelPicB", "labelZoom", "labelZoomB", "labelX", "labelY", "labelXB", "labelYB"];
  if (kind === "vinyl" && LABEL_KEYS.some((k) => k in body)) {
    const okPic = (v) => v === "" || (typeof v === "string" && v.length < 600 && (/^https:\/\/i\.discogs\.com\//.test(v) || /^https:\/\/(coverartarchive\.org|archive\.org)\//.test(v) || v.startsWith(photoBase(env) + "covers/")));
    for (const k of ["labelPic", "labelPicB"]) if (k in body && !okPic(body[k])) return h.json({ error: "That isn't one of its photos." }, 400, cors);
    const zoomOf = (v) => Math.round(Math.min(4, Math.max(0.9, Number(v) || 1)) * 100) / 100; // (each side its own: labelZoom A, labelZoomB B; a little under 1 too)
    const posOf = (v) => Math.round(Math.min(30, Math.max(-30, Number(v) || 0)) * 10) / 10; // (labelX/Y, XB/YB: % of the label, to centre it)
    const saved = await update(env, kind, itemId, (it) => {
      for (const k of ["labelPic", "labelPicB"]) if (k in body) { if (body[k]) it[k] = body[k]; else delete it[k]; }
      for (const k of ["labelZoom", "labelZoomB"]) if (k in body) { const z = zoomOf(body[k]); if (z !== 1) it[k] = z; else delete it[k]; }
      for (const k of ["labelX", "labelY", "labelXB", "labelYB"]) if (k in body) { const v = posOf(body[k]); if (v) it[k] = v; else delete it[k]; }
      if (!it.labelPic) { delete it.labelZoom; delete it.labelX; delete it.labelY; }
      if (!it.labelPicB) { delete it.labelZoomB; delete it.labelXB; delete it.labelYB; }
    });
    return h.json({ item: saved }, 200, cors);
  }
  if (kind !== "vinyl" || (typeof body.back !== "string" && typeof body.spotify !== "string" && typeof body.front !== "string")) return h.json({ error: "Nothing to change." }, 400, cors);
  // (the slow parts, fetching covers and Spotify's tracks, on a copy; then only these fields saved onto the list as it is now)
  const work = { ...item };
  if (typeof body.front === "string") { const ok = await setFront(env, work, body.front); if (!ok) return h.json({ error: "That isn't one of its covers." }, 400, cors); }
  let sp = null;
  if (typeof body.spotify === "string") {
    const s = spotifyId(body.spotify);
    if (!s) return h.json({ error: "That isn't a Spotify album link." }, 400, cors);
    // (failed: filled when its card opens; a playlist that couldn't be read keeps [] so it isn't asked for every time)
    sp = { spotify: s, tracks: s === "none" ? undefined : await spotifyTracks(env, h, s, item.tracks, item).catch(() => (/^playlist:/.test(s) ? [] : undefined)) };
    sp.off = !!sp.tracks && !(await spotifyPlays(env, h, sp.tracks).catch(() => true));
  }
  if (typeof body.back === "string") await setBack(env, work, body.back);
  const saved = await update(env, kind, itemId, (it) => {
    if (typeof body.front === "string" || typeof body.back === "string") coversFrom(work)(it);
    if (sp) { it.spotify = sp.spotify; if (sp.tracks === undefined) delete it.spotifyTracks; else { it.spotifyTracks = sp.tracks; it.tracks = item.tracks; } } // (with the lengths Spotify filled in)
    if (sp) { if (sp.off) it.spotifyOff = true; else delete it.spotifyOff; }
  });
  if (!saved) return h.json({ error: "Not in the library." }, 404, cors);
  return h.json({ item: saved }, 200, cors);
}

async function vinylItem(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const res = await mbFetch(MB + "/release/" + id + "?fmt=json&inc=artist-credits+labels+recordings+release-groups+genres+url-rels+release-group-level-rels");
  if (!res.ok) return null;
  const r = await res.json();
  const rg = r["release-group"] || {};
  // the cover: this pressing's, else another pressing's with the same barcode (the same sleeve: Nick, 2026-10-29, his
  // good kid, m.A.A.d city's 2020 pressing has no front of its own and the album's is a later edition's, the kids
  // photo, where his has the van), else the album's
  const has = async (u) => { const c = await fetch(u, { method: "HEAD", redirect: "manual" }).catch(() => null); return !!c && (c.status === 307 || c.status === 302 || c.status === 200); };
  const caaFront = (rid) => "https://coverartarchive.org/release/" + rid + "/front-500";
  let cover = (await has(caaFront(id))) ? caaFront(id) : "";
  if (!cover && r.barcode) {
    await new Promise((ok) => setTimeout(ok, 1000)); // (MusicBrainz: a second between requests)
    const twins = await mbFetch(MB + "/release?fmt=json&limit=10&query=" + encodeURIComponent("barcode:" + r.barcode)).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
    const us = (x) => (x.country === r.country ? 0 : 1);
    for (const t of (twins.releases || []).filter((x) => x.id !== id).sort((a, b) => us(a) - us(b)).slice(0, 6)) if (await has(caaFront(t.id))) { cover = caaFront(t.id); break; }
  }
  if (!cover && rg.id && (await has("https://coverartarchive.org/release-group/" + rg.id + "/front-500"))) cover = "https://coverartarchive.org/release-group/" + rg.id + "/front-500";
  // and this pressing's back cover, when the Cover Art Archive has one (2 in 3 do): the card turns the sleeve over
  // to it (Nick, 2026-10-25). Only the pressing's own: an album-wide back could be another pressing's track list
  let back = "";
  const b = await fetch("https://coverartarchive.org/release/" + id + "/back-500", { method: "HEAD", redirect: "manual" }).catch(() => null);
  if (b && (b.status === 307 || b.status === 302 || b.status === 200)) back = "https://coverartarchive.org/release/" + id + "/back-500";
  const tracks = [];
  // only the record's own discs: a CD that comes with it (Aim and Ignite's bonus CD repeats the LP) is left out (Nick,
  // 2026-11-01); a disc's number in front only when there are several and its sides aren't lettered (A1, C3 say it already)
  const isVinyl = (m) => /vinyl|"|lp\b/i.test(m.format || "");
  const discs = (r.media || []).some(isVinyl) ? (r.media || []).filter(isVinyl) : (r.media || []);
  const albumBy = (r["artist-credit"] || []).map((a) => a.name + (a.joinphrase || "")).join("").trim();
  discs.forEach((m, side) => (m.tracks || []).forEach((t) => {
    const n = shortNum(t.number || t.position);
    const by = (t["artist-credit"] || []).map((a) => a.name + (a.joinphrase || "")).join("").trim();
    tracks.push({ n: (discs.length > 1 && !/^[A-Z]/.test(n) ? (side + 1) + "-" : "") + n, title: t.title, ms: t.length || null, rec: (t.recording || {}).length || null, ...trackBy(by, albumBy) });
  }));
  // a pressing with track lengths missing borrows them from another pressing of the album with the same track list
  // (not from the songs' own entries: Purple Rain's vinyl links its title track to the 4-minute single edit)
  if (tracks.some((t) => !t.ms) && rg.id) {
    const same = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9]+/g, "") === String(b).toLowerCase().replace(/[^a-z0-9]+/g, "");
    await new Promise((ok) => setTimeout(ok, 1000)); // MusicBrainz asks for a second between requests
    const sib = await mbFetch(MB + "/release?fmt=json&inc=recordings&limit=50&release-group=" + rg.id).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
    for (const o of sib.releases || []) {
      const ot = (o.media || []).flatMap((m) => m.tracks || []);
      if (ot.length === tracks.length && ot.every((t, i) => t.length && same(t.title, tracks[i].title))) { tracks.forEach((t, i) => { t.ms = t.ms || ot[i].length; }); break; }
    }
  }
  // the whole record's running time, only when every track has a real length (a gap or a guess would be wrong)
  const runtime = tracks.length && tracks.every((t) => t.ms) ? tracks.reduce((a, t) => a + t.ms, 0) : null;
  // the track list still shows a song's own length where nothing better was found
  tracks.forEach((t) => { t.ms = t.ms || t.rec; delete t.rec; });
  return {
    id: "mb-" + id,
    source: id,
    title: r.title,
    creator: (r["artist-credit"] || []).map((a) => a.name + (a.joinphrase || "")).join("").trim(),
    year: parseInt(String(rg["first-release-date"] || r.date || "").slice(0, 4), 10) || null,
    pressed: parseInt(String(r.date || "").slice(0, 4), 10) || null,
    format: formats(r.media),
    variant: editionOf(r), // its edition as MusicBrainz notes it ("milky clear", "10th anniversary"): the card colours the record by it
    label: ((r["label-info"] || [])[0] || {}).label ? r["label-info"][0].label.name : "",
    country: r.country || "",
    barcode: r.barcode || "",
    genres: [...(r.genres || []), ...(rg.genres || [])].sort((a, b) => b.count - a.count).map((g) => g.name).filter((g, i, a) => a.indexOf(g) === i).slice(0, 4),
    tracks: tracks.slice(0, 40),
    back,
    runtime,
    about: (await albumAbout([...(rg.relations || []), ...(r.relations || [])])) || (await wikiAlbum(r.title, (r["artist-credit"] || []).map((a) => a.name).join(" & "))),
    cover,
    url: "https://musicbrainz.org/release/" + id,
    spotify: spotifyLink([...(r.relations || []), ...(rg.relations || [])]),
  };
}

function rankVinyl(list, q) {
  const n = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const said = n(q);
  const fit = (r) => { const t = n(r.title), a = n(r.creator); return !said ? 0 : t === said || said === t + " " + a || said === a + " " + t ? 0 : said.includes(t) && t.length > 3 ? 1 : t.includes(said) ? 2 : 3; };
  const plain = (r) => (r.edition ? 1 : 0) + (r.unofficial ? 2 : 0); // (a bootleg after the official ones)
  return list.map((r, i) => [r, i]).sort((a, b) => fit(a[0]) - fit(b[0]) || plain(a[0]) - plain(b[0]) || a[1] - b[1]).map((x) => { delete x[0].edition; delete x[0].unofficial; return x[0]; });
}

// ---------- Discogs ----------
// For records MusicBrainz doesn't have (Nick, 2026-10-29). Its pressings are collapsed the same way: one choice per
// album (master) + discs + edition (the vinyl's colour or a Deluxe/Picture Disc/Box Set), the newest US one; test
// pressings and promos left out. Bootlegs ("Unofficial Release") are in, after the official ones and marked
// "Unofficial" (Nick, 2026-11-03: his Talking Heads Chicago, August 28, 1978 is one; every pressing of it is). Its
// images aren't copied (see keepCover's callers).
const DG = "https://api.discogs.com";
async function dg(env, path) {
  const headers = { "User-Agent": MB_UA };
  if (env.DISCOGS_TOKEN) headers.Authorization = "Discogs token=" + env.DISCOGS_TOKEN;
  const r = await fetch(DG + path, { headers, signal: AbortSignal.timeout(15000) }).catch(() => null);
  return r && r.ok ? r.json() : null;
}
const dgName = (s) => String(s || "").replace(/\s+\(\d+\)$/, "").replace(/\*$/, "").trim(); // "Mac Miller (2)" -> "Mac Miller"
const DG_SKIP = /test pressing|white label|promo/i;
const DG_UNOFFICIAL = /unofficial|bootleg/i;
const DG_EDITION = /deluxe|picture disc|box set|anniversary|special edition|remaster|numbered|signed/i;
// a pressing's discs and edition from its formats: [discs, "2×12\" Vinyl", "Red/White Splatter · Deluxe Edition"]
function dgFormat(formats) {
  let discs = 0, ed = [];
  const sizes = {}; // "12\"" -> 2, "10\"" -> 1: "2×12\" Vinyl + 10\" Vinyl", like MusicBrainz's
  for (const f of formats || []) {
    const d = f.descriptions || [];
    if (/vinyl/i.test(f.name || "")) {
      const q = parseInt(f.qty, 10) || 1, size = d.find((x) => /^\d+"$/.test(x)) || (d.includes("LP") ? '12"' : "");
      discs += q; sizes[size] = (sizes[size] || 0) + q;
      if (f.text) ed.push(f.text);
    } else if (/box set/i.test(f.name || "")) ed.push("Box Set");
    d.filter((x) => DG_EDITION.test(x)).forEach((x) => ed.push(x));
  }
  ed = ed.filter((x, i) => ed.indexOf(x) === i);
  const fmt = Object.keys(sizes).map((z) => (sizes[z] > 1 ? sizes[z] + "×" : "") + (z ? z + " " : "") + "Vinyl").join(" + ");
  return [discs, fmt, ed.join(" · ")];
}
async function dgSearch(env, qs, mb) {
  const d = await dg(env, "/database/search?type=release&format=Vinyl&per_page=40&" + qs);
  const n = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const have = new Set((mb || []).map((x) => x.same));
  const groups = new Map();
  for (const r of (d && d.results) || []) {
    const fm = r.formats || [];
    if (fm.some((f) => (f.descriptions || []).some((x) => DG_SKIP.test(x)))) continue;
    const [discs, fmt, ed] = dgFormat(fm);
    if (!discs) continue;
    const unofficial = fm.some((f) => (f.descriptions || []).some((x) => DG_UNOFFICIAL.test(x)));
    const [artist, ...rest] = String(r.title || "").split(" - ");
    const title = rest.join(" - ") || artist;
    // MusicBrainz already lists this one (the same album on as many discs, plain): not twice
    if (!ed && have.has([n(title), n(dgName(artist)), discs, ""].join("|"))) continue;
    const key = [r.master_id || n(r.title), discs, n(ed), unofficial ? "u" : ""].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ r, artist: dgName(artist), title, fmt, ed, unofficial });
  }
  const yr = (x) => parseInt(x.r.year, 10) || 0;
  return [...groups.values()].map((g) => { const us = g.filter((x) => /^US/.test(x.r.country || "")); return (us.length ? us : g).sort((a, b) => yr(b) - yr(a))[0]; })
    .slice(0, 8).map((x) => ({
      id: "dg-" + x.r.id,
      title: x.title,
      creator: x.artist,
      year: parseInt(x.r.year, 10) || null,
      cover: x.r.cover_image || x.r.thumb || "",
      note: [x.unofficial ? "Unofficial" : "", x.ed, x.fmt, x.r.country, dgName((x.r.label || [])[0]), "Discogs"].filter(Boolean).join(" · "),
      edition: !!x.ed,
      unofficial: x.unofficial || undefined,
    }));
}
// a Discogs release's own link pasted in the search (discogs.com/release/<id>...): that very pressing, whatever it is
async function dgRelease(env, id) {
  const r = await dg(env, "/releases/" + id);
  if (!r || !r.title) return [];
  const [, fmt, ed] = dgFormat(r.formats);
  const unofficial = (r.formats || []).some((f) => (f.descriptions || []).some((x) => DG_UNOFFICIAL.test(x)));
  const creator = (r.artists || []).map((a, i, all) => dgName(a.anv || a.name) + (i < all.length - 1 ? " " + (a.join || "&") + " " : "")).join("").replace(/\s+,/g, ",").trim();
  return [{
    id: "dg-" + r.id, title: String(r.title).trim(), creator, year: parseInt(r.year, 10) || null,
    cover: ((r.images || [])[0] || {}).uri || r.thumb || "",
    note: [unofficial ? "Unofficial" : "", ed, fmt, r.country, dgName(((r.labels || [])[0] || {}).name), "Discogs"].filter(Boolean).join(" · "),
  }];
}
// a Discogs image is a scan (flat, square, sharp enough) rather than a phone photo of the sleeve: shown first
const isScan = (im) => im && im.width && im.height && Math.abs(im.width / im.height - 1) < 0.04 && Math.min(im.width, im.height) >= 550;
const dgMs = (t) => { const m = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(String(t || "").trim()); return m ? (((+m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 : null; };
// the album's official artwork, from Apple Music's free search (a stock image, not anyone's photo): exact album and artist
async function itunesArt(title, artist) {
  const n = (t) => String(t || "").toLowerCase().replace(/\s*[([].*?(deluxe|edition|remaster|anniversary|expanded|version).*?[)\]]/g, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const r = await fetch("https://itunes.apple.com/search?entity=album&limit=15&country=US&term=" + encodeURIComponent(artist + " " + title), { signal: AbortSignal.timeout(10000) }).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
  const hit = (r.results || []).find((a) => n(a.collectionName) === n(title) && n(a.artistName) === n(artist));
  return hit && hit.artworkUrl100 ? hit.artworkUrl100.replace(/\/\d+x\d+bb\./, "/1200x1200bb.") : "";
}
// a song's own artist, when it isn't the record's (a compilation's: Nick, 2026-11-03: "most of my compilations have
// songs from all different artist ... put the artist in the track title on the open record box"): { by } or nothing
function trackBy(by, album) {
  const n = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return by && n(by) !== n(album) ? { by } : {};
}
function dgArtists(list) {
  return (list || []).map((a, i, all) => dgName(a.anv || a.name) + (i < all.length - 1 ? " " + (a.join || "&") + " " : "")).join("").replace(/\s+,/g, ",").trim();
}
// (a soundtrack that credits its songs' singers instead: The Best Little Whorehouse In Texas's "Dolly Parton: Vocals")
function dgSingers(list) {
  const names = [...new Set((list || []).filter((a) => /^(lead )?vocals?\b|^narrator|^performer/i.test(a.role || "")).map((a) => dgName(a.anv || a.name)))];
  return names.length > 1 ? names.slice(0, -1).join(", ") + " & " + names[names.length - 1] : names[0] || "";
}
async function dgItem(env, id) {
  if (!/^\d{1,10}$/.test(id)) return null;
  const r = await dg(env, "/releases/" + id);
  if (!r || !r.title) return null;
  const creator = (r.artists || []).map((a, i, all) => dgName(a.anv || a.name) + (i < all.length - 1 ? " " + (a.join || "&") + " " : "")).join("").replace(/\s+,/g, ",").trim();
  const master = r.master_id ? await dg(env, "/masters/" + r.master_id) : null;
  const [, fmt, ed] = dgFormat(r.formats);
  // a classical record lists each work as an "index" with its movements as sub-tracks (Nick's Mozart Symphonies came out
  // with no track list at all, 2026-11-04): each movement is a track, "Symphony No. 34 in C major, K. 338: I. Allegro vivace"
  const ROM = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const flat = [];
  for (const t of r.tracklist || []) {
    const ty = t.type_ || "track";
    if (ty === "track") flat.push(t);
    else if (ty === "index") for (const x of t.sub_tracks || []) if ((x.type_ || "track") === "track")
      flat.push({ ...x, title: String(t.title || "").trim() + ": " + String(x.title || "").trim().replace(/^(\d{1,2})\.\s*/, (m, d) => (ROM[+d] || d) + ". "), artists: x.artists || t.artists, extraartists: x.extraartists || t.extraartists });
  }
  const tracks = flat.map((t) => ({ n: shortNum(t.position), title: String(t.title || "").trim(), ms: dgMs(t.duration), ...trackBy(dgArtists(t.artists) || dgSingers(t.extraartists), creator) }));
  const runtime = tracks.length && tracks.every((t) => t.ms) ? tracks.reduce((a, t) => a + t.ms, 0) : null;
  const imgs = r.images || [];
  // the front: a scan of this very pressing's on Discogs (its sleeve, which can differ from the album's: good kid,
  // m.A.A.d city's vinyl has the van, Apple Music's artwork the kids), else Apple Music's official artwork, else
  // Discogs' main picture whatever it is
  const primary = imgs.find((im) => im.type === "primary") || imgs[0] || {};
  const front = (isScan(primary) && primary.uri) || (await itunesArt(r.title, creator)) || primary.uri || "";
  // (no back to start with: Discogs doesn't say which photo is the back, and its first is as often the gatefold's inside;
  // Nick picks it from the scans on the card or in the add dialog)
  const back = "";
  // the album's MusicBrainz entry, when there is one: its Wikipedia summary and Spotify link
  let rels = [];
  const rg = await mbFetch(MB + "/release-group?fmt=json&limit=5&query=" + encodeURIComponent('releasegroup:"' + r.title + '" AND artist:"' + creator + '"')).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
  const g = (rg["release-groups"] || [])[0];
  if (g && g.score >= 90) {
    await new Promise((ok) => setTimeout(ok, 1000));
    const full = await mbFetch(MB + "/release-group/" + g.id + "?fmt=json&inc=url-rels").then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
    rels = full.relations || [];
  }
  return {
    id: "dg-" + id,
    source: "dg-" + id,
    title: r.title,
    creator,
    year: (master && master.year) || r.year || null,
    pressed: r.year || null,
    format: fmt + (ed ? " (" + ed + ")" : ""),
    label: dgName(((r.labels || [])[0] || {}).name),
    country: r.country || "",
    barcode: (((r.identifiers || []).find((x) => x.type === "Barcode") || {}).value || "").replace(/\D/g, ""),
    genres: [...(r.styles || []), ...(r.genres || [])].map((x) => x.toLowerCase()).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4),
    tracks: tracks.slice(0, 40),
    back,
    backFrom: back ? "Discogs" : undefined,
    runtime,
    about: (rels.length ? await albumAbout(rels) : "") || (await wikiAlbum(r.title, creator)),
    cover: front,
    coverFrom: /discogs\.com/.test(front) ? "Discogs" : undefined,
    url: "https://www.discogs.com/release/" + id,
    spotify: spotifyLink(rels),
  };
}

// PUT /collection/vinyl/:id/scan?side=front|back (admin), the body a JPEG (or PNG/WebP): Nick's own scan of the record's
// front or back (Nick, 2026-10-29: "I will scan these in myself via scanner"), resized in the browser first. Kept in the
// photos bucket under a new name each time (no cache shows the old), and the one it replaces goes.
async function putScan(request, env, h, itemId, side, cors, kind = "vinyl") {
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return h.json({ error: "Send the scan as a JPEG, PNG or WebP." }, 400, cors);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 8e6) return h.json({ error: "That scan is too big (8 MB at most)." }, 413, cors);
  if (!env.PHOTOS) return h.json({ error: "There's nowhere to keep it." }, 503, cors);
  const items = await list(env, kind), item = items.find((x) => x.id === itemId);
  if (!item) return h.json({ error: "Not in the library." }, 404, cors);
  const key = coverKey(kind, item.id + "-" + side + "-scan-" + Date.now().toString(36)).replace(/\.jpg$/, { "image/png": ".png", "image/webp": ".webp" }[type] || ".jpg");
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  // (a label of his own, side A or B: Nick, 2026-11-01, "let me also upload my own labels"; its zoom and position start over)
  const label = side === "label" || side === "labelB", b = side === "labelB" ? "B" : "";
  const field = label ? "labelPic" + b : side === "back" ? "back" : "cover";
  let old = null;
  const saved = await update(env, kind, itemId, (it) => {
    old = it[field];
    it[field] = photoBase(env) + key;
    if (label) { delete it["labelZoom" + b]; delete it["labelX" + b]; delete it["labelY" + b]; }
    else {
      if (side === "back") delete it.backFrom; else delete it.coverFrom;
      it[side + "Scan"] = true; // (Nick's own: the card credits no one for it)
    }
  });
  // the one it replaces goes (for a label, only an upload of his: a cover or back's file stays with the cover or back)
  if (old && old !== photoBase(env) + key && old.startsWith(photoBase(env) + "covers/") && (!label || /-label/.test(old))) await env.PHOTOS.delete(old.slice(photoBase(env).length)).catch(() => {});
  return h.json({ item: saved }, 200, cors);
}

// PUT /collection/<kind>/:id/thumb?of=<cover> (admin), the body a JPEG at most 400 px on its long side, made from the
// cover in the owner's browser (collection.js makeThumbs): the copy the Library page, the poster walls and the shelves
// show (Nick, 2026-10-30: the page downloaded 20 MB; BoardGameGeek's box art is up to 5,659 px and 2.8 MB, a 400 px copy
// about 60 KB). `thumbOf` is the cover it was made from, so a changed cover is never shown by its old copy: the pages use
// the thumb only while thumbOf is the cover, and the owner's browser makes a new one. The cover itself is kept as it was.
async function putThumb(request, env, h, kind, itemId, of, cors) {
  if ((request.headers.get("Content-Type") || "").split(";")[0].trim() !== "image/jpeg") return h.json({ error: "Send a JPEG." }, 400, cors);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 400e3) return h.json({ error: "That copy is too big." }, 413, cors);
  if (!env.PHOTOS) return h.json({ error: "There's nowhere to keep it." }, 503, cors);
  const items = await list(env, kind), item = items.find((x) => x.id === itemId);
  if (!item) return h.json({ error: "Not in the library." }, 404, cors);
  if (!item.cover || of !== item.cover) return h.json({ error: "Its cover has changed." }, 409, cors);
  const key = coverKey(kind, item.id + "-sm-" + Date.now().toString(36));
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" } });
  // saved only if its cover is still the one the copy was made from (a front changed meanwhile: this copy goes)
  let old = null, stale = false;
  const saved = await update(env, kind, itemId, (it) => {
    if (it.cover !== of) { stale = true; return false; }
    old = it.thumb; it.thumb = photoBase(env) + key; it.thumbOf = of;
  });
  if (!saved || stale) { await env.PHOTOS.delete(key).catch(() => {}); return h.json({ error: "Its cover has changed." }, 409, cors); }
  if (old && old !== saved.thumb && old.startsWith(photoBase(env) + "covers/")) await env.PHOTOS.delete(old.slice(photoBase(env).length)).catch(() => {});
  return h.json({ item: saved }, 200, cors);
}

// ---------- the record's colour, from its photos ----------
// Nick, 2026-10-29: "the back cover pictures usually have a picture of the vinyl as well you can use to pick the color
// or splatter". The pressing's Discogs photos (up to 6, in one ask) to Workers AI's vision model, which says whether one
// shows the disc itself and how it looks. Kept on the record as `vinyl` ({ a, b, pattern, see, name }), which the page
// draws the record with where it agrees with the words (collection.js discLook). At most LOOK_READS a day. Its own request
// (the page asks right after adding a coloured pressing, and the card's button): not inside the add, for the Worker's time.
const COLOURISH = /colou?r|clear|translucent|transparent|splatter|marble|swirl|galaxy|smoke|picture disc|\b(red|blue|green|yellow|orange|purple|pink|white|gold|silver|grey|gray|teal|brown|bone|cream|mint|aqua|turquoise|violet|lavender|maroon|burgundy|navy|tan|peach|lime|olive|magenta|cyan|coke bottle|ice)\b/i;
const LOOK_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const LOOK_READS = 20; // (Workers AI's free 10,000 a day is shared with the Scorecard's card reader)
const LOOK_ASK = `These are photos from a vinyl record listing: covers, labels, inserts, and often the vinyl disc itself.
Find a photo that shows the vinyl disc (the record, not the paper label in its middle and not the sleeve) and describe the
vinyl's own colour. Reply with JSON only:
{"disc": true|false, "a": "#rrggbb", "b": "#rrggbb" or null, "pattern": "solid"|"splatter"|"marble"|"split"|"picture",
 "see": true|false, "name": "<a short name like Teal or Clear with Red Splatter>"}
Rules:
- "a" is the main colour of the vinyl, "b" a second colour when there is one (splatter flecks, marble swirl, the other half).
- "splatter" for flecks or dots, "marble" for swirls, smoke or galaxy, "split" for two halves, "picture" for a picture disc.
- "see" is true when the vinyl is clear or translucent (you can see through it).
- Ordinary black vinyl is {"disc": true, "a": "#141414", "b": null, "pattern": "solid", "see": false, "name": "Black"}.
- If no photo shows the disc, reply {"disc": false}.`;
async function dgImages(env, item) {
  let rid = /^dg-(\d+)$/.exec(item.source || "");
  rid = rid && rid[1];
  if (!rid && /^[0-9a-f-]{36}$/.test(item.source || "")) {
    const r = await mbFetch(MB + "/release/" + item.source + "?fmt=json&inc=url-rels").then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
    const d = ((r.relations || []).find((x) => x.type === "discogs" && x.url) || {}).url;
    rid = d && (/\/release\/(\d+)/.exec(d.resource) || [])[1];
  }
  const rel = rid ? await dg(env, "/releases/" + rid) : null;
  // (4 full-size: the 150 px ones misread Voir Dire's light blue as grey; 4 keeps the Worker's time per request low)
  return ((rel && rel.images) || []).filter((im) => im.type === "secondary").map((im) => im.uri || im.uri150).slice(0, 4);
}
async function readLook(env, item) {
  if (!env.AI) return null;
  const key = "collection:looks:" + new Date().toISOString().slice(0, 10), used = +(await env.QUEUE.get(key)) || 0;
  if (used >= LOOK_READS) throw new Error("That's all the colour reading for today. Try again tomorrow.");
  const urls = await dgImages(env, item);
  if (!urls.length) return { none: "No photos of this pressing on Discogs to read." };
  const pics = [];
  for (const u of urls) {
    const r = await fetch(u, { headers: { "User-Agent": MB_UA } }).catch(() => null);
    if (!r || !r.ok) continue;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength > 1.5e6) continue;
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    pics.push({ type: "image_url", image_url: { url: "data:" + ((r.headers.get("Content-Type") || "image/jpeg").split(";")[0]) + ";base64," + btoa(bin) } });
  }
  if (!pics.length) return { none: "Couldn't get this pressing's photos from Discogs." };
  let out = null, err = null;
  for (let tries = 0; tries < 2 && !out; tries++) {
    if (tries) await new Promise((r) => setTimeout(r, 1500));
    try { out = await aiRun(env, LOOK_MODEL, { messages: [{ role: "user", content: [{ type: "text", text: LOOK_ASK }, ...pics] }], max_tokens: 200, temperature: 0 }, "colour"); } catch (e) { err = e; }
  }
  if (!out) throw new Error(/4006|daily free allocation/i.test(String(err && (err.message || err))) ? "That's all the colour reading for today (the free allowance)."
    : /switched off|allowance is used up/.test(String(err && err.message)) ? err.message : "Couldn't read its photos just now. Try again in a moment.");
  await env.QUEUE.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
  const reply = out.response ?? (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content);
  let read = typeof reply === "object" && reply ? reply : null;
  if (!read) { const t = String(reply || "").replace(/```(?:json)?/g, ""), a = t.indexOf("{"), z = t.lastIndexOf("}"); try { read = a >= 0 && z > a ? JSON.parse(t.slice(a, z + 1)) : null; } catch (e) { read = null; } }
  if (!read || !read.disc) return { none: "None of its photos show the record itself." };
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c).toLowerCase() : null);
  const a = hex(read.a);
  if (!a) return { none: "Couldn't tell the record's colour from its photos." };
  return { a, b: hex(read.b), pattern: ["solid", "splatter", "marble", "split", "picture"].includes(read.pattern) ? read.pattern : "solid", see: !!read.see, name: clean(read.name, 60), from: "photo" };
}
// POST /collection/vinyl/:id/look (admin): read it now (the card's "Read its colour from its photos"); kept on the record
async function lookFill(env, h, itemId, cors) {
  const items = await list(env, "vinyl"), item = items.find((x) => x.id === itemId);
  if (!item) return h.json({ error: "Not in the library." }, 404, cors);
  let look;
  try { look = await readLook(env, item); } catch (e) { return h.json({ error: e.message }, 429, cors); }
  if (!look || look.none) return h.json({ error: (look && look.none) || "The colour reader isn't set up." }, 404, cors);
  const it = await update(env, "vinyl", itemId, (x) => { x.vinyl = look; });
  return h.json({ item: it || item }, 200, cors);
}

// ---------- Spotify ----------
// the album on Spotify, for the player at the top of a record's card (Nick, 2026-10-25): stored on the record as
// `spotify` (the album's Spotify id, or "none" when there's none, so it's looked for once). MusicBrainz's own link to
// it first (the pressing's, then the album's), else a Spotify search for the album by its artist
function spotifyLink(rels) {
  for (const x of rels) {
    const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?album\/([A-Za-z0-9]{22})/.exec((x.url || {}).resource || "");
    if (m) return m[1];
  }
  return "";
}
// an app token (client credentials: search needs no one's account), kept in KV for its hour
async function spotifyApp(env, h) {
  const cached = await env.QUEUE.get("spotify:app");
  if (cached) return cached;
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
  const t = await h.spotifyToken(env, { grant_type: "client_credentials" });
  await env.QUEUE.put("spotify:app", t.access_token, { expirationTtl: Math.max(60, (t.expires_in || 3600) - 120) });
  return t.access_token;
}
const roman = (r) => { const v = { i: 1, v: 5, x: 10 }; let n = 0; r = r.toLowerCase(); for (let i = 0; i < r.length; i++) n += v[r[i]] < (v[r[i + 1]] || 0) ? -v[r[i]] : v[r[i]]; return n; };
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
// its name without what Spotify adds to a reissue: "Cope (Deluxe Edition)", "Purple Rain - 2015 Remaster"
const bare = (s) => norm(String(s || "").replace(/^\s*medley\s*:\s*/i, "").replace(/\s*[([].*?[)\]]\s*/g, " ").replace(/\s+-\s+.*$/, "").replace(/\bpart\b/gi, "pt").replace(/\bpt\./gi, "pt").replace(/\bpt\s*([ivx]{1,4})\b/gi, (m, r) => "pt " + roman(r))); // ("Part I" is "Part 1" too: Nick's Illinois, 2026-11-04; "Part 1" is Spotify's "Pt. 1"; "Medley: Aquarius / Let the Sunshine In" is Spotify's "Aquarius/Let The Sunshine In": Nick, 2026-11-03)
async function spotifySearch(env, h, item) {
  const token = await spotifyApp(env, h);
  if (!token || !item.title) return "";
  const artist = String(item.creator || "").split(/\s+(?:&|and|feat\.?|with|,)\s+/i)[0];
  const q = 'album:"' + item.title.replace(/"/g, "") + '"' + (artist ? ' artist:"' + artist.replace(/"/g, "") + '"' : "");
  const res = await fetch("https://api.spotify.com/v1/search?" + new URLSearchParams({ q, type: "album", limit: "10" }), { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("Spotify search didn't answer (" + res.status + ").");
  const albums = (((await res.json()).albums || {}).items || []).filter(Boolean);
  const byArtist = albums.filter((a) => !artist || (a.artists || []).some((x) => norm(x.name) === norm(artist) || norm(item.creator).includes(norm(x.name))));
  // its exact name first, then a reissue of it (a remaster or deluxe edition); an album before a single or compilation
  const pick = byArtist.find((a) => norm(a.name) === norm(item.title) && a.album_type === "album") || byArtist.find((a) => norm(a.name) === norm(item.title)) ||
    byArtist.find((a) => bare(a.name) === bare(item.title) && a.album_type === "album") || byArtist.find((a) => bare(a.name) === bare(item.title));
  return pick ? pick.id : "";
}
// a record's Spotify album: its MusicBrainz link, else the search; "none" when neither finds it (a failed search
// throws, so it's tried again next time)
async function spotifyFor(env, h, item) {
  return item.spotify || (await spotifySearch(env, h, item)) || "none";
}
// each of the record's tracks' song on the Spotify album, for the play buttons in its track list (Nick, 2026-10-25):
// `spotifyTracks`, the Spotify track ids in the order of `tracks` ("" for one the album doesn't have). Matched by name
// (without "- 2015 Remaster" and the like), in order; when no name matches but both have as many tracks, by position
async function spotifyTracks(env, h, albumId, tracks, album) {
  const playlist = /^playlist:([A-Za-z0-9]{22})$/.exec(albumId || "");
  if (!(tracks || []).length || (!playlist && !/^[A-Za-z0-9]{22}$/.test(albumId || ""))) return [];
  // a playlist's songs can only be read signed in (Spotify, 2026: "Valid user authentication required"): the site's
  // connected Spotify account (index.js spotifyAccess); an album's with the app's own token
  const token = playlist ? (h.spotifyUser ? await h.spotifyUser(env).catch(() => null) : null) : await spotifyApp(env, h);
  if (!token) { if (playlist) throw new Error("Reading a playlist needs the site's Spotify connection (tools/spotify_connect.py)."); return []; }
  // every track of the album, 50 a page, up to 200 (Clair Obscur's soundtrack album has 154: its LP's tracks were past the
  // first page); a playlist's the same way (its entries hold the song in .item or .track)
  let theirs = [], next = playlist ? "https://api.spotify.com/v1/playlists/" + playlist[1] + "/items?limit=50" : "https://api.spotify.com/v1/albums/" + albumId + "/tracks?limit=50";
  for (let page = 0; next && page < 4; page++) {
    const res = await fetch(next, { headers: { Authorization: "Bearer " + token } });
    // (someone else's playlist: Spotify lets the site read only the connected account's own, 403 otherwise; the player
    // still plays it, just no buttons on the track list)
    if (!res.ok) { if (page || (playlist && res.status === 403)) break; throw new Error("Spotify didn't answer (" + res.status + ")."); }
    const j = await res.json();
    theirs = theirs.concat((j.items || []).map((x) => (playlist ? x && (x.item || x.track) : x)).filter((t) => t && t.id && (!t.type || t.type === "track")));
    next = j.next;
  }
  const used = new Set();
  // (a title with a place in front, "Lumière - The Departure", also by what follows the dash)
  const tail = (s) => bare(String(s || "").replace(/^.*\s+-\s+/, ""));
  const ids = tracks.map((t) => {
    const hit = theirs.find((x) => !used.has(x.id) && bare(x.name) === bare(t.title)) || theirs.find((x) => !used.has(x.id) && norm(x.name).startsWith(bare(t.title)) && bare(t.title).length > 3)
      || theirs.find((x) => !used.has(x.id) && / - /.test(x.name) && tail(x.name) === bare(t.title))
      // (a name Spotify cut short with "...": Illinois' "The Black Hawk War, Or, How to Demolish ... Or...", Nick, 2026-11-04)
      || theirs.find((x) => !used.has(x.id) && /(\.\.\.|…)$/.test(x.name) && bare(x.name.replace(/(\.\.\.|…)$/, "")).length > 15 && bare(t.title).startsWith(bare(x.name.replace(/(\.\.\.|…)$/, ""))));
    if (hit) used.add(hit.id);
    if (hit && !t.ms && hit.duration_ms) t.ms = hit.duration_ms; // (a Discogs record often has no lengths: Spotify's)
    return hit ? hit.id : "";
  });
  // a title spelled a letter or two differently (Nick, 2026-11-03: his Neil Diamond's "Cracklin' Rose" and "Song Sung
  // Blues" are Spotify's "Cracklin' Rosie" and "Song Sung Blue"): the closest unmatched song within 2 edits and 15% of
  // its length, when their numbers agree (so "Pt. 1" is never "Pt. 2")
  const near = (a, b) => {
    if (a.replace(/\D/g, "") !== b.replace(/\D/g, "") || Math.min(a.length, b.length) < 5) return 99;
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const nx = [i];
      for (let j = 1; j <= b.length; j++) nx[j] = Math.min(row[j] + 1, nx[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = nx;
    }
    const dist = row[b.length];
    return dist <= 2 && dist <= Math.max(a.length, b.length) * 0.15 ? dist : 99;
  };
  tracks.forEach((t, i) => {
    if (ids[i]) return;
    let hit = null, best = 99;
    theirs.forEach((x) => { if (used.has(x.id)) return; const d = near(bare(x.name), bare(t.title)); if (d < best) { best = d; hit = x; } });
    if (hit) { ids[i] = hit.id; used.add(hit.id); if (!t.ms && hit.duration_ms) t.ms = hit.duration_ms; }
  });
  // classical movements named another way (Nick, 2026-11-03: his Beethoven Pastoral's "Symphony no. 6 in F (Pastoral):
  // I. Allegro Ma Non Troppo" is Spotify's "...Op. 68 "Pastoral": I. Erwachen heiterer Empfindungen ... Allegro ma non
  // troppo"): the same movement numeral after the work's name, and the same work number when both give one
  const mvt = (s) => { const m = /:\s*([IVX]{1,5})\.\s/.exec(String(s || "")); return m ? m[1] : ""; };
  const workNo = (s) => { const m = /\bno\.?\s*(\d+)/i.exec(String(s || "").split(":")[0]); return m ? m[1] : ""; };
  tracks.forEach((t, i) => {
    if (ids[i] || !mvt(t.title)) return;
    const hit = theirs.find((x) => !used.has(x.id) && mvt(x.name) === mvt(t.title) && (!workNo(t.title) || !workNo(x.name) || workNo(x.name) === workNo(t.title)));
    if (hit) { ids[i] = hit.id; used.add(hit.id); if (!t.ms && hit.duration_ms) t.ms = hit.duration_ms; }
  });
  if (ids.every((x) => !x) && theirs.length === tracks.length) { tracks.forEach((t, i) => { t.ms = t.ms || theirs[i].duration_ms || null; }); return theirs.map((x) => x.id); }
  // a title worded a little differently (Discogs' "Elegy For Gump Worsley" is Spotify's "Elegy from Gump Worsley"; Nick,
  // 2026-10-31): the same album's same place, when every title that did match is at its own place
  if (theirs.length === tracks.length && ids.some(Boolean) && ids.every((x, i) => !x || x === theirs[i].id)) {
    ids.forEach((x, i) => { if (!x && !used.has(theirs[i].id)) { ids[i] = theirs[i].id; used.add(theirs[i].id); if (!tracks[i].ms && theirs[i].duration_ms) tracks[i].ms = theirs[i].duration_ms; } });
  }
  // tracks still missing (a deluxe pressing's bonus tracks, a second disc: Nick's good kid, m.A.A.d city, Circles, Cope,
  // linked to the standard album): from the album's other editions on Spotify, "<title> (Deluxe)", "... Live at ...",
  // by title (a track plays the same from any edition)
  if (!playlist && album && album.title && ids.some(Boolean) && ids.some((x) => !x)) {
    try {
      const q = 'album:"' + album.title.replace(/"/g, "") + '"' + (album.creator ? ' artist:"' + String(album.creator).replace(/"/g, "") + '"' : "");
      const sr = await fetch("https://api.spotify.com/v1/search?" + new URLSearchParams({ q, type: "album", limit: "8" }), { headers: { Authorization: "Bearer " + token } });
      const others = sr.ok ? (((await sr.json()).albums || {}).items || []).filter((a) => a && a.id !== albumId && bare(a.name).startsWith(bare(album.title))) : [];
      others.sort((a, b) => (b.total_tracks || 0) - (a.total_tracks || 0)); // (the fullest edition first)
      for (const a of others.slice(0, 3)) {
        if (!ids.some((x) => !x)) break;
        const r = await fetch("https://api.spotify.com/v1/albums/" + a.id + "/tracks?limit=50", { headers: { Authorization: "Bearer " + token } });
        if (!r.ok) continue;
        const more = ((await r.json()).items || []).filter((t) => t && t.id && !used.has(t.id));
        tracks.forEach((t, i) => {
          if (ids[i]) return;
          const hit = more.find((x) => !used.has(x.id) && bare(x.name) === bare(t.title));
          if (hit) { ids[i] = hit.id; used.add(hit.id); if (!t.ms && hit.duration_ms) t.ms = hit.duration_ms; }
        });
      }
    } catch (e) { /* the album's own matches stand */ }
  }
  return ids.some(Boolean) ? ids : [];
}
// whether a record's songs play on Spotify in the US (Nick, 2026-11-03: George Carlin's On the Road, a playlist of
// songs Spotify won't play here, "region" restricted; the turntable spun up and stopped): up to 3 of its songs asked
// (the app's token, one song a request: Spotify refuses this app the many-at-once one), false only when every one
// asked says is_playable false; anything unknown counts as playing. Kept on the record as spotifyOff: true.
async function spotifyPlays(env, h, ids) {
  const some = (ids || []).filter((x) => /^[A-Za-z0-9]{22}$/.test(x || "")).slice(0, 3);
  if (!some.length) return true;
  const token = await spotifyApp(env, h);
  if (!token) return true;
  for (const id of some) {
    const r = await fetch("https://api.spotify.com/v1/tracks/" + id + "?market=US", { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return true;
    if ((await r.json()).is_playable !== false) return true;
  }
  return false;
}
// GET /collection/vinyl/spotify?id=<item id>: a record added before the player (or its track buttons) was, looked up
// the first time its card opens and kept on the record (anyone can open a card, so it only ever looks up a record
// that has no answer yet)
async function spotifyFill(env, h, itemId, cors) {
  const items = await list(env, "vinyl"), item = items.find((x) => x.id === itemId);
  if (!item) return h.json({ error: "Not in the library." }, 404, cors);
  if (item.spotify && (item.spotify === "none" || item.spotifyTracks)) return h.json({ spotify: item.spotify, spotifyTracks: item.spotifyTracks, spotifyOff: item.spotifyOff }, 200, cors);
  let spotify = item.spotify || "";
  if (!spotify && item.source) { // MusicBrainz's link, which records added before this weren't asked for
    const res = await mbFetch(MB + "/release/" + item.source + "?fmt=json&inc=url-rels+release-groups+release-group-level-rels").catch(() => null);
    if (res && res.ok) { const r = await res.json(); spotify = spotifyLink([...(r.relations || []), ...((r["release-group"] || {}).relations || [])]); }
  }
  spotify = spotify || (await spotifySearch(env, h, item)) || "none";
  const st = spotify === "none" ? null : await spotifyTracks(env, h, spotify, item.tracks, item);
  const off = !!st && !(await spotifyPlays(env, h, st).catch(() => true));
  const now = await list(env, "vinyl"), it = now.find((x) => x.id === itemId); // (read again: an add could have landed meanwhile)
  if (it && (!it.spotify || (it.spotify === spotify && !it.spotifyTracks))) {
    it.spotify = spotify;
    if (st) it.spotifyTracks = st;
    if (off) it.spotifyOff = true;
    await save(env, "vinyl", now);
  }
  return h.json({ spotify, spotifyTracks: st || undefined, spotifyOff: off || undefined }, 200, cors);
}
// a Spotify album link or id that Nick pasted on a card, or "" for none
function spotifyId(s) {
  s = String(s || "").trim();
  if (!s) return "none";
  // a public playlist too (Nick, 2026-11-01: "a public playlist that has most of the Superbad songs"): "playlist:<id>"
  const pl = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/|spotify:playlist:)([A-Za-z0-9]{22})(?:[?#].*)?$/.exec(s);
  if (pl) return "playlist:" + pl[1];
  const m = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?album\/|spotify:album:)?([A-Za-z0-9]{22})(?:[?#].*)?$/.exec(s);
  return m ? m[1] : null;
}

// an "About" for a record: Wikipedia's opening summary of the album, found through MusicBrainz's links (the album's
// Wikidata entry -> its English Wikipedia article, or a direct Wikipedia link); "" when the album has neither
async function albumAbout(rels) {
  const link = (type) => ((rels.find((x) => x.type === type && x.url) || {}).url || {}).resource || "";
  let title = "";
  const wp = /^https?:\/\/en\.wikipedia\.org\/wiki\/(.+)$/.exec(link("wikipedia"));
  if (wp) title = decodeURIComponent(wp[1]);
  const q = !title && (/\/(Q\d+)$/.exec(link("wikidata")) || [])[1];
  try {
    if (q) {
      const d = await (await fetch("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=" + q, { headers: { "User-Agent": MB_UA } })).json();
      title = (((d.entities || {})[q] || {}).sitelinks || {}).enwiki ? d.entities[q].sitelinks.enwiki.title : "";
    }
    if (!title) return "";
    const res = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")), { headers: { "User-Agent": MB_UA } });
    if (!res.ok) return "";
    const sum = await res.json();
    return sum.type === "standard" ? String(sum.extract || "").trim().slice(0, 900) : "";
  } catch (e) {
    return "";
  }
}

// Wikipedia's article on the album found by searching for it (Nick, 2026-10-29: Simple Math and The Valley of Vision had
// no About: Discogs records, and MusicBrainz entries without a Wikipedia link): the first of the top results that's
// about an album or EP and names the artist, so a song or another band's album of the same name isn't taken
async function wikiAlbum(title, artist) {
  const n = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const a = n(String(artist || "").split(/\s+(?:&|and|feat\.?|with)\s+/i)[0]), t = n(title);
  if (!a || !t) return "";
  try {
    const q = "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + encodeURIComponent('"' + title + '" ' + artist + " album");
    const hits = (((await (await fetch(q, { headers: { "User-Agent": MB_UA } })).json()).query || {}).search || []).map((x) => x.title);
    for (const h of hits) {
      if (!n(h).includes(t.split(" ").slice(0, 3).join(" "))) continue; // (its title leads with the album's)
      const res = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(h.replace(/ /g, "_")), { headers: { "User-Agent": MB_UA } });
      if (!res.ok) continue;
      const sum = await res.json(), text = String(sum.extract || "");
      if (sum.type !== "standard" || !n(text).includes(a)) continue;
      if (!/\b(album|ep|extended play|record|live album|compilation|mixtape|soundtrack)\b/i.test((sum.description || "") + " " + text.slice(0, 200))) continue;
      return text.trim().slice(0, 900);
    }
  } catch (e) {}
  return "";
}
// GET /collection/vinyl/about?id=<item id>: a record with no About gets one looked for once, when its card first opens
async function aboutFill(env, h, itemId, cors) {
  const items = await list(env, "vinyl"), item = items.find((x) => x.id === itemId);
  if (!item) return h.json({ error: "Not in the library." }, 404, cors);
  if (item.about || item.aboutTried) return h.json({ about: item.about || "" }, 200, cors);
  const about = await wikiAlbum(item.title, item.creator);
  await update(env, "vinyl", itemId, (it) => { if (it.about) return false; if (about) it.about = about; it.aboutTried = true; });
  return h.json({ about }, 200, cors);
}

// a record's back cover, to pick from when adding it (Nick, 2026-10-25: a third of pressings have none of their own):
// 1. its pressing's own (Cover Art Archive), 2. other pressings' of the same album there, labelled "Back" (the same
// art, though the small print can differ), vinyl and its country first, 3. Discogs' photos of its pressing (MusicBrainz
// links it; unlabelled, so the back is one of them, as are the labels and inner sleeve). Max 16. DISCOGS_TOKEN
// (a Discogs personal token) is optional: without it Discogs allows 25 requests a minute
// A record's back (side "back", the default) or front cover to pick from (Nick, 2026-10-29: the van, not the kids; and
// "a better way to pick images ... all the back cover options are blurry phone pics"), best first, at most 20:
//  1. front only: the album's official artwork from Apple Music (a stock image)
//  2. scans of this pressing on Discogs (square and at least 550 px: isScan), then the Cover Art Archive's of this pressing
//  3. pressings with the same barcode (the same sleeve), then scans of the album's other vinyl pressings on Discogs
//  4. the Cover Art Archive's other pressings, then Discogs' photos (phone pictures, mostly) last
// Each says where it's from and whether it's a scan. id: a MusicBrainz release, or "dg-<Discogs release>".
async function recordBacks(env, id, side) {
  side = side === "front" ? "front" : "back";
  const dgOnly = /^dg-\d+$/.test(id);
  if (!dgOnly && !/^[0-9a-f-]{36}$/.test(id)) return [];
  const tiers = [[], [], [], [], []], seen = new Set();
  const push = (t, src, thumb, label, from) => { if (src && !seen.has(src)) { seen.add(src); tiers[t].push({ src, thumb: thumb || src, label, from }); } };
  const has = async (u) => { const c = await fetch(u, { method: "HEAD", redirect: "manual" }).catch(() => null); return !!c && (c.status === 307 || c.status === 302 || c.status === 200); };
  const caa = (rid, size) => "https://coverartarchive.org/release/" + rid + "/" + side + "-" + size;
  const place = (x) => [String(x.date || x.released || x.year || "").slice(0, 4), { XE: "Europe", XW: "Worldwide", GB: "UK", XU: "" }[x.country] ?? x.country].filter(Boolean).join(" ");
  let r = {}, discogsId = dgOnly ? id.slice(3) : "", title = "", artist = "";
  if (!dgOnly) {
    r = await mbFetch(MB + "/release/" + id + "?fmt=json&inc=url-rels+release-groups+artist-credits").then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
    title = r.title || ""; artist = (r["artist-credit"] || []).map((a) => a.name + (a.joinphrase || "")).join("").trim();
    const discogs = ((r.relations || []).find((x) => x.type === "discogs" && x.url) || {}).url;
    discogsId = (discogs && (/\/release\/(\d+)/.exec(discogs.resource) || [])[1]) || "";
  }
  // Discogs: this pressing, then (scans only) up to 6 of the album's other vinyl pressings
  const dgPics = (rel, mine) => {
    const ims = (rel.images || []).filter((im) => (side === "front" ? im.type === "primary" : im.type === "secondary"));
    ims.forEach((im) => {
      const scan = isScan(im), where = mine ? "your pressing" : [rel.year, rel.country].filter(Boolean).join(" ") + " pressing";
      if (scan) push(mine ? 1 : 2, im.uri, im.uri150, "Scan" + (mine ? " " + (++mineN) : "") + " · " + where + " · Discogs", "discogs");
      else if (mine) push(4, im.uri, im.uri150, "Photo · " + where + " · Discogs", "discogs");
    });
  };
  let dgRel = null, mineN = 0;
  if (discogsId) {
    dgRel = await dg(env, "/releases/" + discogsId);
    if (dgRel) {
      if (dgOnly) { title = dgRel.title; artist = (dgRel.artists || []).map((a) => dgName(a.anv || a.name)).join(" & "); }
      dgPics(dgRel, true);
      if (dgRel.master_id) {
        const v = await dg(env, "/masters/" + dgRel.master_id + "/versions?format=Vinyl&per_page=30");
        const others = ((v && v.versions) || []).filter((x) => String(x.id) !== String(discogsId) && !DG_SKIP.test(String(x.format || "")))
          .sort((a, b) => ((b.country === dgRel.country) - (a.country === dgRel.country))).slice(0, 6);
        for (const o of others) { const rel = await dg(env, "/releases/" + o.id); if (rel) dgPics(rel, false); }
      }
    }
  }
  // the Cover Art Archive (MusicBrainz's): this pressing, the same barcode, the album's other pressings
  if (!dgOnly) {
    // (first of its tier: the one MusicBrainz marks as this pressing's own back or front)
    if (await has(caa(id, 500))) { seen.add(caa(id, 500)); tiers[1].unshift({ src: caa(id, 500), thumb: caa(id, 250), label: "Your pressing · Cover Art Archive", from: "caa" }); }
    const rg = (r["release-group"] || {}).id;
    if (rg) {
      await new Promise((ok) => setTimeout(ok, 1000)); // MusicBrainz asks for a second between requests
      const sib = await mbFetch(MB + "/release?fmt=json&inc=media&limit=100&release-group=" + rg).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
      const vinyl = (x) => (x.media || []).some((m) => /vinyl/i.test(m.format || ""));
      const twin = (x) => !!r.barcode && x.barcode === r.barcode;
      (sib.releases || []).filter((x) => x.id !== id && (x["cover-art-archive"] || {})[side])
        .sort((a, b) => (twin(b) - twin(a)) || (vinyl(b) - vinyl(a)) || ((b.country === r.country) - (a.country === r.country)))
        .slice(0, 10).forEach((x) => push(twin(x) ? 2 : 3, caa(x.id, 500), caa(x.id, 250),
          place(x) + " " + (vinyl(x) ? "vinyl" : ((x.media || [])[0] || {}).format || "") + " pressing" + (twin(x) ? " · your barcode" : "") + " · Cover Art Archive", "caa"));
    }
  }
  // Apple Music's official artwork, first of all for a front
  if (side === "front" && title) { const a = await itunesArt(title, artist); if (a) tiers[0].push({ src: a, thumb: a.replace("/1200x1200bb.", "/300x300bb."), label: "Official artwork · Apple Music", from: "itunes" }); }
  return tiers.flat().slice(0, 20);
}

// every cover Open Library has for a book, to pick from: the scanned edition's first, then the book's own covers, then
// its editions' (English first, newest first), each labelled with its year, format and publisher where known; max 18
// On a book's card (Nick, 2026-11-04: "pull as many images as you can for me to choose from"): up to 40 of Open
// Library's (all of each edition's covers, not just its first), then Apple Books' artwork and Google Books' cover for
// each edition of it they have (title and author from the card: t, a)
async function bookCovers(id, env, title = "", author = "") {
  const m = /^(OL\d+W)(?:~(OL\d+M))?$/.exec(id);
  if (!m) return [];
  const get = (u) => fetch(OL + u, { headers: { "User-Agent": MB_UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [work, eds, mine, more] = await Promise.all([get("/works/" + m[1] + ".json"), get("/works/" + m[1] + "/editions.json?limit=200"), m[2] ? get("/books/" + m[2] + ".json") : null, title ? otherCovers(env, title, author) : []]);
  const out = [], seen = new Set();
  const fmt = (f) => (f ? String(f).charAt(0).toUpperCase() + String(f).slice(1) : "");
  const label = (e) => [String(e.publish_date || "").match(/\d{4}/)?.[0], fmt(e.physical_format), (e.publishers || [])[0]].filter(Boolean).join(" · ");
  const push = (cid, lbl) => {
    if (!(cid > 0) || seen.has(cid) || out.length >= 40) return;
    seen.add(cid);
    out.push({ src: "https://covers.openlibrary.org/b/id/" + cid + "-L.jpg", thumb: "https://covers.openlibrary.org/b/id/" + cid + "-M.jpg", label: lbl });
  };
  if (mine) (mine.covers || []).forEach((c) => push(c, "Your edition" + (label(mine) ? " · " + label(mine) : "")));
  const english = (e) => !e.languages || !e.languages.length || e.languages.some((l) => l.key === "/languages/eng");
  const year = (e) => +(String(e.publish_date || "").match(/\d{4}/) || [0])[0];
  // (not audiobooks or recordings: their covers are a box or a disc)
  const editions = ((eds && eds.entries) || []).filter((e) => (e.covers || []).some((c) => c > 0) && !/audio|cassette|\bcd\b|mp3|dvd|vinyl/i.test(e.physical_format || ""))
    .sort((a, b) => (english(b) - english(a)) || (year(b) - year(a)));
  // the book's own covers, labelled by the edition they belong to when there is one
  const byCover = new Map();
  editions.forEach((e) => (e.covers || []).forEach((c) => { if (!byCover.has(c)) byCover.set(c, e); }));
  ((work && work.covers) || []).forEach((c) => push(c, byCover.has(c) ? label(byCover.get(c)) : ""));
  editions.forEach((e) => push(e.covers.find((c) => c > 0), label(e)));
  editions.forEach((e) => e.covers.forEach((c) => push(c, label(e)))); // (then each edition's other photos)
  // the shops' official pictures of each edition, by its ISBN (Nick, 2026-11-04: "pull from their shopping list. like
  // the official image of buying the book off a website, it doesn't need to be a real photograph"): Amazon's (by its
  // ISBN-10; a 1-pixel picture when there's none, which the card drops) and Bookshop.org's (by its ISBN-13; a square
  // placeholder when there's none, dropped too). Barnes & Noble's refuse to be fetched. Yours first, then the
  // newest English editions', up to 10 ISBNs
  const shops = (e, mineToo) => {
    const isbns = [...(e.isbn_13 || []), ...(e.isbn_10 || [])].map((x) => String(x).replace(/[^\dX]/gi, ""));
    const i13 = isbns.map(to13).find(Boolean), i10 = isbns.map(to10).find(Boolean);
    if (!i13 && !i10) return [];
    const k = i13 || i10;
    if (seenIsbn.has(k) || seenIsbn.size >= 10) return [];
    seenIsbn.add(k);
    const lbl = (mineToo ? " · Your edition" : "") + (label(e) ? " · " + label(e) : ""); // (the source first: a label cut short still says it)
    return [i10 && { src: "https://m.media-amazon.com/images/P/" + i10 + ".01._SCRM_SL1500_.jpg", thumb: "https://m.media-amazon.com/images/P/" + i10 + ".01._SCRM_SL400_.jpg", label: "Amazon" + lbl, from: "amazon" },
      i13 && { src: "https://images-us.bookshop.org/ingram/" + i13 + ".jpg?height=1500", thumb: "https://images-us.bookshop.org/ingram/" + i13 + ".jpg?height=400", label: "Bookshop.org" + lbl, from: "bookshop" }].filter(Boolean);
  };
  const seenIsbn = new Set();
  const mineShops = mine ? shops(mine, true) : [];
  const otherShops = editions.concat(((eds && eds.entries) || []).filter((e) => !editions.includes(e))).filter(english).flatMap((e) => shops(e, false));
  return [...mineShops, ...more, ...otherShops, ...out.map((o) => ({ ...o, label: o.label ? "Open Library · " + o.label : "Open Library" }))];
}
// a book cover from Apple Books, Google Books, Amazon or Bookshop.org, as bookCovers gives them
const shopCover = (f) => /^https:\/\/is\d-ssl\.mzstatic\.com\/image\/thumb\//.test(f) || /^https:\/\/books\.google\.com\/books\/content\?/.test(f)
  || /^https:\/\/m\.media-amazon\.com\/images\/P\/[\dX]{10}\.01\._SCRM_SL1500_\.jpg$/.test(f) || /^https:\/\/images-us\.bookshop\.org\/ingram\/\d{13}\.jpg\?height=1500$/.test(f);
// an ISBN as 13 digits (978… from a 10) and as 10 (from a 978… 13), or "" when it can't be
function to13(x) {
  if (/^97[89]\d{10}$/.test(x)) return x;
  if (!/^\d{9}[\dX]$/i.test(x)) return "";
  const b = "978" + x.slice(0, 9);
  const sum = [...b].reduce((t, d, i) => t + +d * (i % 2 ? 3 : 1), 0);
  return b + ((10 - (sum % 10)) % 10);
}
function to10(x) {
  if (/^\d{9}[\dX]$/i.test(x)) return x.toUpperCase();
  if (!/^978\d{10}$/.test(x)) return "";
  const b = x.slice(3, 12), sum = [...b].reduce((t, d, i) => t + +d * (10 - i), 0), c = (11 - (sum % 11)) % 11;
  return b + (c === 10 ? "X" : String(c));
}
// Apple Books' and Google Books' covers of a book, for its card's choices (the same book: its title and its author's
// surname, as for a summary; not a summary, study guide or songbook of it)
async function otherCovers(env, title, author) {
  const n = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const core = n(String(title).split(/[:(]/)[0]), last = n(String(author).split(",")[0]).split(" ").pop() || "";
  // (nor a box set it's in: Google's "The Witcher Saga, 8 Books Collection Set" for The Tower of Swallows)
  const set = /box(?:ed)? ?set|collection set|books? collection|omnibus|\d+ books? set|trilogy|series set/i;
  const fits = (t, a) => n(t).includes(core) && (!last || n(a).includes(last)) && !/songbook|summary of|study guide|sparknotes|cliffsnotes|workbook/i.test(t) && (set.test(title) || !set.test(t));
  const q = String(title).split(/[:(]/)[0];
  const [ap, g] = await Promise.all([
    fetch("https://itunes.apple.com/search?entity=ebook&country=US&limit=25&term=" + encodeURIComponent(q + " " + String(author).split(",")[0]), { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    env && env.GOOGLE_BOOKS_KEY ? fetch("https://www.googleapis.com/books/v1/volumes?maxResults=40&printType=books&key=" + env.GOOGLE_BOOKS_KEY + "&q=" + encodeURIComponent("intitle:" + q + (last ? " inauthor:" + last : "")), { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})) : {},
  ]);
  const out = [], seen = new Set();
  for (const r of ap.results || []) {
    const a = String(r.artworkUrl100 || "");
    if (!a || !fits(r.trackName, r.artistName) || seen.has(a)) continue;
    seen.add(a);
    const yr = String(r.releaseDate || "").slice(0, 4);
    out.push({ src: a.replace(/\/\d+x\d+bb\./, "/1400x1400bb."), thumb: a.replace(/\/\d+x\d+bb\./, "/400x400bb."), label: ["Apple Books", yr].filter(Boolean).join(" · "), from: "apple" });
  }
  for (const x of g.items || []) {
    const v = x.volumeInfo || {}, il = v.imageLinks || {};
    if (!il.thumbnail || !fits(v.title, (v.authors || []).join(" "))) continue;
    // (its biggest: the same cover at 1200 px wide; without the curled-page corner)
    const base = "https://books.google.com/books/content?id=" + encodeURIComponent(x.id) + "&printsec=frontcover&img=1&zoom=1&source=gbs_api";
    out.push({ src: base + "&fife=w1200", thumb: base + "&fife=w400", label: ["Google Books", String(v.publishedDate || "").slice(0, 4), v.publisher].filter(Boolean).join(" · "), from: "google" });
  }
  return out;
}

// Open Library's descriptions are written in Markdown: links become their words, and the "[Source][1]" credit with its
// "[1]: https://…" line goes (the same cleaning is in collection.js, for books added before it)
function cleanAbout(t) {
  return String(t || "").replace(/\r/g, "").split(/\n-{3,}/)[0]
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
    .replace(/\(?\[source\]\s*(\[[^\]]*\]|\([^)]*\))\)?/gi, "")
    .replace(/\[([^\]]+)\](\[[^\]]*\]|\([^)]*\))/g, "$1")
    .replace(/\n{3,}/g, "\n\n").trim();
}
// its subjects, tidied: Open Library's tags ("series:Harry_Potter", "nyt:…", "place:…") are not subjects (a series
// becomes its own line), plain "Fiction" says nothing, and words that are the same subject ("Fantasy", "Fantasy
// fiction") show once, the shorter way, capitalised
function subjectsOf(list) {
  let series = "";
  const out = [];
  for (let s of list || []) {
    s = String(s).trim();
    const ser = /^series:(.+)$/i.exec(s);
    if (ser) { series = series || ser[1].replace(/_/g, " ").trim(); continue; }
    if (/:/.test(s) || s.length >= 30 || /fiction in english|accessible book|protected daisy|large type|reading level|in library|overdrive|new york times|fictional works|\(/i.test(s)) continue;
    s = s.replace(/_/g, " ").replace(/^fiction, (.+)$/i, "$1 fiction").replace(/, fiction$/i, ""); // library headings: "Fiction, psychological", "Married people, fiction"
    const key = s.toLowerCase().replace(/sci-fi|science[ -]fiction/g, "scifi").replace(/\(.*?\)|\bjuvenile\b|\bfiction\b|\bgeneral\b|\bliterature\b/g, "").replace(/[^a-z]+/g, " ").trim();
    if (!key) continue;
    const nice = s.charAt(0).toUpperCase() + s.slice(1);
    const at = out.findIndex((o) => o.key === key);
    if (at < 0) out.push({ key, s: nice });
    else if (nice.length < out[at].s.length) out[at].s = nice;
  }
  return { subjects: out.map((o) => o.s), series };
}

// a book's genre: Open Library has none, only its long list of subjects (up to 100+, in many languages), so each genre
// counts the subjects that say it, and the book gets the up to 3 best supported (a genre needs 2 subjects; Classics
// counts 3 for each, as few subjects say it; Children's and Young Adult need 4, as reissues and adaptations add a
// few). Fiction genres only for a novel (3 or more subjects say fiction), the others only for nonfiction.
// Tried on 13 books: Harry Potter = Fantasy, Children's; Sapiens = History, Science; 1984 = Dystopian, Classics,
// Science Fiction; The Kite Runner = Literary Fiction
const BOOK_GENRES = [
  // [name, pattern, fiction / nonfiction only (or either), weight, at least]
  ["Fantasy", /fantas|wizard|magic|dragons|elves|hobbits/, "f"],
  ["Science Fiction", /science.?fiction|sci-?fi|ciencia.?ficci|space flight|space opera|time travel|cyberpunk/, "f"],
  ["Dystopian", /dystopi|distop|totalitarian/, "f"],
  ["Mystery & Thriller", /myster|thriller|suspense|detective|crime fiction|espionage|spy stories/, "f"],
  ["Romance", /romance|love stories/, "f"],
  ["Horror", /horror|ghost stories/, "f"],
  ["Historical Fiction", /historical fiction|fiction, historical|historical novel/, "f"],
  ["Literary Fiction", /literary fiction|psychological fiction|fiction, psychological|bildungsroman|coming of age|domestic fiction/, "f"],
  ["Classics", /\bclassics?\b|classic literature/, "", 3],
  ["Children's", /juvenile|children/, "", 1, 4],
  ["Young Adult", /young adult|teen & young/, "", 1, 4],
  ["Biography & Memoir", /biograph|memoir|autobiograph/, "n"],
  ["History", /\bhistory\b|civilization/, "n"],
  ["Science", /\bscience\b|life sciences|evolution|physics|biology|astronomy/, "n"],
  ["Self-Help", /self-help|self-actualization|personal growth/, "n"],
  ["Business & Economics", /business|economics|management|entrepreneur/, "n"],
  ["Philosophy", /philosoph/, "n"],
  ["Poetry", /poetry|poems/, ""],
  ["Humor", /humou?r/, ""],
  ["True Crime", /true crime/, "n"],
  ["Cooking", /cookery|cooking|recipes/, "n"],
  ["Travel", /travel/, "n"],
];
function genreOf(list) {
  // (comic adaptations and the like say nothing about the book itself)
  const tags = (list || []).map((s) => String(s).toLowerCase()).filter((t) => !/^\w+:|adaptation|comics|graphic novel|man-woman/.test(t));
  const fiction = tags.filter((t) => /\bfiction\b|novel|stories|romans?\b/.test(t) && !/non-?fiction/.test(t)).length >= 3;
  return BOOK_GENRES.filter((g) => !g[2] || (g[2] === "f") === fiction)
    .map((g) => [g[0], tags.filter((t) => g[1].test(t)).length * (g[3] || 1), g[4] || 2])
    .filter((x) => x[1] >= x[2]).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]);
}

// a book's summary when Open Library has none worth showing (Nick, 2026-11-04: "what other free source can we pull from
// to have summaries for every single book?"): Apple Books' blurb (free, no key: the iTunes search's ebooks), then
// Google Books' (free with a key: the GOOGLE_BOOKS_KEY secret, when it's set). Not Open Library's when it's only a page
// count ("463 pages : 24 cm"), a "See: <link>", or not in English (the Witcher books' are Polish)
// a summary cut to fit ends on a whole sentence, never mid-word (Nick, 2026-11-04: 69 books' summaries stopped
// mid-word at 900 characters, e.g. Watchmen's "this com"); a text with no sentence end early enough ends on a word + …
function toSentence(t, max = 1200) {
  t = String(t || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/[^.!?…]*$/, "").replace(/\s+$/, "");
  const end = /[.!?…]["”’')]?$/.test(t.slice(0, cut.length + 1)) ? t.slice(0, cut.length + 1).trim() : cut;
  return end.length >= max * 0.4 ? end : t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
function aboutOk(t) {
  const words = String(t || "").split(/\s+/).filter(Boolean);
  if (words.length < 12 || /^see:/i.test(t)) return false;
  return (String(t).match(/\b(the|and|of|to|is|in|his|her|with|that|a)\b/gi) || []).length / words.length >= 0.12;
}
const blurbText = (h) => unhtml(String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
  // (without the publisher's shouting at the top: "#1 NEW YORK TIMES BESTSELLER • NOW A MAJOR MOTION PICTURE")
  .replace(/^(?:[^\na-z]*(?:\n|$)|.*\b(?:BESTSELLER|bestseller|NOW A|Now a|WATCH THE|Watch the|award winner|AWARD)\b[^\n]{0,120}(?:\n|$)|\s*\n)+/, "")
  // (and without what's around the plot: "★ Over Fifteen Million Copies Sold", review quotes, and the author's other
  // books after it: "Witcher collections / The Last Wish / …", "OTHER TOR BOOKS BY JOHN SCALZI", "Translated from…")
  .split(/\n+(?=(?:witcher (?:story )?collections|other [\w ]*books by|also by|praise for|translated (?:from|by))\b)/i)[0]
  .split(/\n+/).map((p) => p.trim()).filter((p) => p && !/^(?:★|•)|^[“"][^”"]*[”"]\s*[—–-]|bestsell|^download a free|inspired the hit|blockbuster video games/i.test(p)).join("\n\n").trim();
// an encyclopedia's opening, not the story: "Pet Sematary is a 1983 horror novel by…", "…the fourth novel in the Witcher
// Saga… a sequel to Baptism of Fire and followed by The Lady of the Lake" (Nick, 2026-11-04: "just stating facts about
// how it's the 4th book… we absolutely have to find better synopsis of the plots")
const isLead = (t) => /^[^.\n]{0,140}?\b(?:is|was) (?:a|an|the)\b[^.\n]*\b(?:novel|book|series|saga|collection|comic|memoir|work|novella)\b/i.test(t)
  || /^[^\n]{0,200}\b(?:sequel to|preceded by|followed by|first published in)\b/i.test(t);
async function bookBlurb(env, title, author) {
  const n = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const core = n(String(title).split(/[:(]/)[0]), last = n(author).split(" ").pop() || "";
  // (the same book: not a different volume, sequel or songbook of it: "Ken Warren Teaches Texas Hold'em 2", "Sweet
  // Valley Twins: Teacher's Pet" for Choosing Sides, "Bob Dylan (Songbook)")
  const sub = (t) => n(String(t).split(/:| - /).slice(1).join(" ")), digits = (t) => String(t).replace(/\D/g, "");
  const fits = (t, a) => n(t).includes(core) && (!last || n(a).includes(last)) && digits(t) === digits(title) && !/songbook|summary of|study guide/i.test(t)
    && (!sub(t) || !sub(title) || sub(t).includes(sub(title)) || sub(title).includes(sub(t)));
  const ap = await fetch("https://itunes.apple.com/search?entity=ebook&country=US&limit=10&term=" + encodeURIComponent(String(title).split(/[:(]/)[0] + " " + author), { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  // (and a book's blurb, not a disc's: Google's "Bob Dylan" is "(CDROM Product). iSong is the only teaching tool…")
  const disc = (t) => /^\s*\(?\s*(?:cd-?rom|dvd)\b/i.test(t);
  const a = (ap.results || []).find((r) => r.description && !disc(r.description) && fits(r.trackName, r.artistName));
  if (a && aboutOk(blurbText(a.description))) return blurbText(a.description);
  if (!env || !env.GOOGLE_BOOKS_KEY) return "";
  const gq = "intitle:" + String(title).split(/[:(]/)[0] + (author ? " inauthor:" + author.split(" ").pop() : "");
  const g = await fetch("https://www.googleapis.com/books/v1/volumes?maxResults=10&printType=books&langRestrict=en&key=" + env.GOOGLE_BOOKS_KEY + "&q=" + encodeURIComponent(gq), { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const v = (g.items || []).map((x) => x.volumeInfo || {}).filter((x) => x.description && !disc(x.description) && fits(x.title, (x.authors || []).join(" "))).sort((x, y) => y.description.length - x.description.length)[0];
  return v && aboutOk(blurbText(v.description)) ? blurbText(v.description) : "";
}
async function bookItem(id, env) {
  const m = /^(OL\d+W)(?:~(OL\d+M))?$/.exec(id);
  if (!m) return null;
  const w = await (await fetch(OL + "/works/" + m[1] + ".json")).json();
  if (!w || !w.title) return null;
  const ed = m[2] ? await fetch(OL + "/books/" + m[2] + ".json").then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  const authors = await olAuthors(w.authors);
  let about = typeof w.description === "string" ? w.description : (w.description || {}).value || "";
  about = toSentence(cleanAbout(about));
  if (!aboutOk(about) || isLead(about)) {
    // (the publisher's plot instead of an encyclopedia's facts, when there is one; the facts if not)
    const b = await bookBlurb(env, w.title, authors[0] || "").catch(() => "");
    if (aboutOk(b) && !isLead(b)) about = toSentence(b);
    else if (!aboutOk(about)) about = toSentence(b);
  }
  const coverId = (ed && (ed.covers || [])[0] > 0 && ed.covers[0]) || ((w.covers || [])[0] > 0 && w.covers[0]);
  // a first publication year: the work's search entry knows it
  const first = await fetch(OL + "/search.json?q=key:/works/" + m[1] + "&fields=first_publish_year,number_of_pages_median").then((r) => r.json()).then((d) => (d.docs || [])[0] || {}).catch(() => ({}));
  return {
    id: "ol-" + m[1],
    source: m[1] + (m[2] ? "~" + m[2] : ""),
    title: ed && ed.title && /[A-Z]/.test(ed.title.slice(1)) ? ed.title : w.title, // (some editions' titles are all lower case)
    creator: authors.join(", "),
    year: first.first_publish_year || null,
    pages: (ed && ed.number_of_pages) || first.number_of_pages_median || null,
    publisher: ed ? (ed.publishers || [])[0] || "" : "",
    format: ed ? ed.physical_format || "" : "",
    about,
    genres: subjectsOf(w.subjects).subjects.slice(0, 5),
    series: subjectsOf(w.subjects).series,
    genre: genreOf(w.subjects),
    cover: coverId ? "https://covers.openlibrary.org/b/id/" + coverId + "-L.jpg" : "",
    // the edition Nick has when he picked one (a scanned ISBN, or a search pick with its edition): the work's own page
    // features whichever edition Open Library likes (The Handmaid's Tale: a Russian one)
    url: m[2] ? "https://openlibrary.org/books/" + m[2] : "https://openlibrary.org/works/" + m[1],
  };
}

async function gameItem(env, id) {
  if (!/^\d{1,9}$/.test(id)) return null;
  const t = (await bggThings(env, [id]))[id];
  if (!t || !t.title) return null;
  return {
    id: "bgg-" + id,
    source: id,
    title: t.title,
    creator: (t.designers || []).slice(0, 3).join(", "),
    year: t.year,
    players: t.players,
    minPlayers: t.minPlayers,
    maxPlayers: t.maxPlayers,
    best: t.best,
    time: t.time,
    minTime: t.minTime,
    maxTime: t.maxTime,
    age: t.minAge,
    publisher: t.publisher,
    rating: t.rating ? Math.round(t.rating * 10) / 10 : null,
    votes: t.votes,
    rank: t.rank,
    weight: t.weight ? Math.round(t.weight * 100) / 100 : null,
    mechanics: t.mechanics,
    about: toSentence(t.description),
    genres: t.categories,
    cover: t.image || t.thumb,
    url: "https://boardgamegeek.com/boardgame/" + id,
    howto: (await bggHowTo(env, id).catch(() => undefined)), // (failed: looked up when its card opens)
  };
}

// The game's How to Play video (Nick, 2026-10-29: "on the BGG page ... a Youtube video under the HOT HOW TO PLAY
// section"): BGG's own list for that section (the page reads it from api.geekdo.com: instructional, English, sorted
// hot), the first YouTube one; else the newest English instructional video in the XML API's (its latest 15).
// { yt, title } or "none". Kept on the item, so it's asked once.
const HOWTO_TITLE = /how\s*-?\s*to\s*play|how\s+to\b|\brules\b|learn(?:ing)?\s+(?:to\s+)?play|\bteach|tutorial|play\s*through|explain|\bin\s+\d+\s+min/i;
async function bggHowTo(env, id) {
  const q = "https://api.geekdo.com/api/videos?ajax=1&gallery=instructional&nosession=1&objecttype=thing&pageid=1&showcount=10&sort=hot&languageid=2184&objectid=" + id;
  const res = await fetch(q, { headers: { "User-Agent": MB_UA, Accept: "application/json" } }).catch(() => null);
  if (res && res.ok) {
    // the hottest that's a tutorial by its title (BGG's list also holds "A Brief History of Risk" and reviews), else the hottest
    const yt = ((await res.json().catch(() => ({}))).videos || []).filter((x) => x.videohost === "youtube" && /^[\w-]{11}$/.test(x.extvideoid || ""));
    const v = yt.find((x) => HOWTO_TITLE.test(x.title || "")) || yt[0];
    if (v) return { yt: v.extvideoid, title: unxml(v.title || "").trim() };
  }
  const x = await fetch(BGG + "/thing?videos=1&id=" + id, { headers: bggHeaders(env) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  const xv = [...x.matchAll(/<video\b[^>]*>/g)].map((m) => m[0]).filter((t) => /category="instructional"/.test(t) && /language="English"/.test(t))
    .map((t) => ({ yt: (/youtube\.com\/watch\?v=([\w-]{11})/.exec(t) || [])[1], title: attr(t, "video", "title").trim() })).filter((v) => v.yt);
  const xb = xv.find((v) => HOWTO_TITLE.test(v.title)) || xv[0];
  if (xb) return xb;
  if (!res || !res.ok) throw new Error("BGG's videos aren't answering."); // (not "none": ask again next time)
  return "none";
}
// GET /collection/games/howto?id= : a game added before there were videos gets its video looked up once, then kept
async function howToFill(env, h, itemId, cors) {
  const items = await list(env, "games"), item = items.find((x) => x.id === itemId);
  if (!item) return h.json({ error: "Not in the library." }, 404, cors);
  if (item.howto !== undefined) return h.json({ howto: item.howto }, 200, cors);
  const howto = await bggHowTo(env, item.source || itemId.replace(/^bgg-/, ""));
  const now = await list(env, "games"), it = now.find((x) => x.id === itemId); // (read again: an add could have landed meanwhile)
  if (it && it.howto === undefined) { it.howto = howto; await save(env, "games", now); }
  return h.json({ howto }, 200, cors);
}

const photoBase = (env) => (env.PHOTO_URL || "https://photos.nickmade.net/").replace(/\/?$/, "/");
const coverKey = (kind, id) => "covers/" + kind + "-" + String(id).toLowerCase().replace(/[^a-z0-9-]+/g, "-") + ".jpg";
// the cover, fetched once (redirects followed) and kept in the photos bucket; its own address if that fails
async function keepCover(env, kind, id, src) {
  if (!env.PHOTOS) return src;
  for (let i = 0; i < 2; i++) {
    const res = await fetch(src, { headers: { "User-Agent": MB_UA, Accept: "image/*" } });
    const type = (res.headers.get("Content-Type") || "").split(";")[0].trim();
    if (res.ok && /^image\/(jpeg|png|webp)$/.test(type)) {
      const buf = await res.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 6e6) return src;
      const key = coverKey(kind, id);
      await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
      return photoBase(env) + key;
    }
    if (res.status < 500) return src;
    await new Promise((r) => setTimeout(r, 800));
  }
  return src;
}

async function remove(env, kind, itemId, cors, h) {
  const items = await list(env, kind);
  const kept = items.filter((x) => x.id !== itemId);
  if (kept.length === items.length) return h.json({ error: "Not in the library." }, 404, cors);
  const gone = items.find((x) => x.id === itemId);
  for (const f of [gone && gone.cover, gone && gone.back, gone && gone.thumb]) { // its copies of the cover (a record's back, the small copy) go too
    if (f && f.startsWith(photoBase(env) + "covers/") && env.PHOTOS) await env.PHOTOS.delete(f.slice(photoBase(env).length)).catch(() => {});
  }
  await save(env, kind, kept);
  return h.json({ removed: itemId }, 200, cors);
}

export { KINDS };
