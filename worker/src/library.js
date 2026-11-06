// Library > Movies: discs Nick adds on the site in owner mode, on top of the ones in library/movies/discs.js (the
// one-time import from his My Movies app export, 2026-10-03; tools/discs.py). New discs are only added here now.
//
//   GET    /library                  { items: [discs added on the site], hidden: [ids of discs.js discs removed on the site] }
//   GET    /library/search?q=        (admin) IMDb title search for the add dialog: films and TV series
//   GET    /library/editions?imdbId= (admin) that film's disc editions on TheDiscDb (community, free, no key), each with
//                                    its extras: { editions: [{ title, year, upc, format, features }] }
//   GET    /library/hdr?title=&year=&upc= (admin) a 4K release's HDR on blu-ray.com: { hdr: ["dv", "hdr10+", "hdr10"],
//                                    found } (by barcode when there is one, else by title and year; tools/hdr.py does
//                                    the same for the imported discs)
//   GET    /library/barcode?upc=     (admin) a scanned or typed barcode -> that exact release on blu-ray.com: { found,
//                                    imdbId, title, year, format, edition, steelbook, criterion, hdr, upc }; not there
//                                    (VHS tapes), a barcode database's product name: the same plus source: "upcitemdb",
//                                    product, pictures (sellers' photos of the actual tape or case, https addresses),
//                                    others (other films it could be: [{ id, title, year, image }], one-tap in the dialog)
//   GET    /library/covers?imdbId=   (admin) the film's posters on TMDB for the add dialog's Cover choices (VHS):
//                                    { posters: [{ src (500px), thumb (185px) }] }, the official one first
//   POST   /library                  (admin) { imdbId, format: "4k"|"bluray"|"dvd"|"vhs", edition?, steelbook?, threeD?, title?, caseName?,
//                                    criterion?, features?, hdr? } -> adds a disc (same shape as discs.js) and returns it
//                                    (features: "On this disc", from an edition picked in the dialog or typed, one per line;
//                                    hdr: the dialog's HDR ticks, 4K only; cover: the picture picked in the dialog: a TMDB
//                                    poster is kept as its address, anything else (a seller's photo) is copied into the
//                                    photos bucket under covers/ so it can't disappear)
//   POST   /library/read-features    (admin) { image: a JPEG data URL of the back of the case } -> { features: [...] }: its
//                                    special features read by a Workers AI vision model, for the "On this disc" box
//   DELETE /library/:id              (admin) a site-added disc is deleted (with its copied cover); a discs.js one is hidden
//   POST   /library/pick             (admin) { key: the film's title as library.js norm() makes it, on: true|false } ->
//                                    { picks }: Nick makes a film a Nick's Pick, or takes it off, from its open case
//                                    (Nick, 2026-10-30); on top of his Movies All Time Favorites and the page's own list
//
// A new disc's facts (title, year, runtime, rating, genres, director, cast, studio, poster) come from IMDb, like the
// rest of the site's lookups. Its blurb is the film's Wikipedia summary (free to reuse with credit; the page links
// it), found through Wikidata's IMDb id property, not IMDb's own plot text. Its spine logo comes from TMDB (tmdbLogo).
//
// Storage (the QUEUE namespace): library         JSON array of site-added discs, newest first
//                                library:hidden  JSON array of discs.js ids removed on the site
//                                library:picks   { on: [title keys], off: [title keys] } picks changed on the site
import { aiRun } from "./aimeter.js"; // (every AI call is metered: aimeter.js)

const ITEMS = "library";
const HIDDEN = "library:hidden";
const PICKS = "library:picks";
// edits Nick made on an open case to discs.js discs (their data is a site file): { <disc id>: { cover, edition,
// features, steelbook, threeD, criterion, hdr } }, laid over the file's disc by library.js
const EDITS = "library:edits";
const FORMATS = ["4k", "bluray", "dvd", "vhs"];
const HDR_KINDS = ["dv", "hdr10+", "hdr10"];
const SEARCH_TYPES = new Set(["movie", "tvMovie", "video", "tvSeries", "tvMiniSeries", "tvSpecial"]);
const UA = "nickmade.net library (https://nickmade.net)";
const BLURB_MAX = 600;

export async function libraryRoute(request, url, env, cors, h) {
  if (url.pathname === "/library" && request.method === "GET") {
    return h.json({ items: await list(env, ITEMS), hidden: await list(env, HIDDEN), picks: await pickList(env), edits: await editMap(env) }, 200, cors);
  }
  if (url.pathname === "/library/search" && request.method === "GET") return search(request, url, env, cors, h);
  if (url.pathname === "/library/editions" && request.method === "GET") return editions(request, url, env, cors, h);
  if (url.pathname === "/library/hdr" && request.method === "GET") return hdrRoute(request, url, env, cors, h);
  if (url.pathname === "/library/barcode" && request.method === "GET") return barcodeRoute(request, url, env, cors, h);
  if (url.pathname === "/library/stills" && request.method === "GET") return stillsRoute(request, url, env, cors, h);
  if (url.pathname === "/library/covers" && request.method === "GET") return coversRoute(request, url, env, cors, h);
  if (url.pathname === "/library/film" && request.method === "GET") return filmRoute(request, url, env, cors, h);
  if (url.pathname === "/library/read-features" && request.method === "POST") return readFeatures(request, env, cors, h);
  if (url.pathname === "/library/pick" && request.method === "POST") return setPick(request, env, cors, h);
  if (url.pathname === "/library" && request.method === "POST") return add(request, env, cors, h);
  if (url.pathname.startsWith("/library/") && request.method === "PATCH") return editDisc(request, url, env, cors, h);
  if (url.pathname.startsWith("/library/") && request.method === "DELETE") return remove(request, url, env, cors, h);
  return null;
}

async function list(env, key) {
  try { return JSON.parse((await env.QUEUE.get(key)) || "[]"); } catch (e) { return []; }
}

function slug(s) {
  return String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// title-year-format, as tools/discs.py disc_id(): only the title part is shortened, so the year and format stay
function discId(title, year, format) {
  return [slug(title).slice(0, 60).replace(/-+$/, ""), year ? String(year) : "", format].filter(Boolean).join("-");
}

// "The Matrix" shelves as "Matrix, The" (like the app's sort titles in discs.js)
function sortTitle(t) {
  const m = /^(the|a|an)\s+(.+)$/i.exec(t);
  return m ? m[2] + ", " + m[1] : t;
}

async function search(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  if (q.length < 2) return h.json({ results: [] }, 200, cors);
  const res = await fetch("https://v3.sg.media-imdb.com/suggestion/x/" + encodeURIComponent(q.toLowerCase()) + ".json", {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  const data = await res.json();
  const results = (data.d || [])
    .filter((r) => /^tt\d+$/.test(r.id) && SEARCH_TYPES.has(r.qid))
    .slice(0, 8)
    .map((r) => ({ id: r.id, title: r.l, year: r.y || null, stars: r.s || "", series: /^tv(Series|MiniSeries)$/.test(r.qid),
      image: r.i ? r.i.imageUrl : null }));
  return h.json({ results }, 200, cors);
}

// A film's disc releases on TheDiscDb (thediscdb.com, a community catalogue of what's on each disc), with their extras:
// every title on the discs that's mapped to something other than the main feature, by name only (no running times;
// Nick, 1.3). Format from the
// discs (UHD -> 4K). Cached by Cloudflare for a day.
const FEATURE_MAX = 60;
async function editions(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const imdbId = url.searchParams.get("imdbId") || "";
  if (!/^tt\d{5,12}$/.test(imdbId)) return h.json({ error: "Bad id." }, 400, cors);
  const query = '{ mediaItems(where: { externalids: { imdb: { eq: "' + imdbId + '" } } }) { nodes { releases { title year upc ' +
    "discs { format titles { item { title type } } } } } } }";
  let data;
  try {
    const res = await fetch("https://thediscdb.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ query }),
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    data = await res.json();
  } catch (e) { return h.json({ editions: [] }, 200, cors); }
  const out = [];
  for (const node of (data.data && data.data.mediaItems && data.data.mediaItems.nodes) || []) {
    for (const r of node.releases || []) {
      const formats = (r.discs || []).map((d) => String(d.format || "").toLowerCase());
      const seen = new Set(), features = [];
      for (const d of r.discs || []) {
        for (const t of d.titles || []) {
          if (!t.item || !t.item.title || /^mainmovie$/i.test(t.item.type || "")) continue;
          const name = String(t.item.title).replace(/\s+/g, " ").trim().slice(0, 140);
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          features.push(name);
        }
      }
      out.push({
        title: String(r.title || "").trim(),
        year: r.year || null,
        upc: r.upc || "",
        format: formats.includes("uhd") ? "4k" : formats.some((f) => f.includes("blu")) ? "bluray" : formats.includes("dvd") ? "dvd" : "",
        features: features.slice(0, FEATURE_MAX),
      });
    }
  }
  out.sort((a, b) => b.features.length - a.features.length);
  return h.json({ editions: out }, 200, cors);
}

// IMDb's facts for a title (its GraphQL API, which the IMDb site itself uses)
async function imdbTitle(imdbId) {
  const query = 'query { title(id: "' + imdbId + '") { titleText { text } releaseYear { year } titleType { id } runtime { seconds } ' +
    "certificate { rating } genres { genres { text } } primaryImage { url } " +
    "principalCredits { category { id } credits { name { nameText { text } } } } " +
    'companyCredits(first: 1, filter: { categories: ["production"] }) { edges { node { company { companyText { text } } } } } } }';
  const res = await fetch("https://caching.graphql.imdb.com/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-imdb-client-name": "imdb-web-next" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error("IMDb didn't answer (" + res.status + ")");
  const t = ((await res.json()).data || {}).title;
  if (!t || !t.titleText) throw new Error("IMDb has no title " + imdbId);
  // principal credits are the top-billed people, in billing order (plain credits aren't)
  const principal = {};
  for (const c of t.principalCredits || []) principal[c.category.id] = c.credits.map((x) => x.name.nameText.text);
  return {
    title: t.titleText.text,
    year: t.releaseYear ? t.releaseYear.year : null,
    series: t.titleType && /^tv(Series|MiniSeries)$/.test(t.titleType.id),
    minutes: t.runtime ? Math.round(t.runtime.seconds / 60) : null,
    rated: t.certificate ? t.certificate.rating : "",
    genres: t.genres ? t.genres.genres.map((g) => g.text) : [],
    director: (principal.director || []).slice(0, 2).join(", "),
    starring: (principal.cast || []).slice(0, 4),
    studio: t.companyCredits && t.companyCredits.edges[0] ? t.companyCredits.edges[0].node.company.companyText.text : "",
    image: t.primaryImage ? t.primaryImage.url : null,
  };
}

// The film's title logo for the spine view, from TMDB (needs the TMDB_API_KEY secret; without it there's no logo and
// the spine shows the title): the first English, else language-neutral, PNG. Returns its 300px image URL, or "".
async function tmdbLogo(imdbId, env) {
  if (!env.TMDB_API_KEY) return "";
  const api = (path) => fetch("https://api.themoviedb.org/3" + path + (path.includes("?") ? "&" : "?") + "api_key=" + env.TMDB_API_KEY)
    .then((r) => (r.ok ? r.json() : {}));
  const found = await api("/find/" + imdbId + "?external_source=imdb_id");
  for (const [kind, list] of [["movie", found.movie_results], ["tv", found.tv_results]]) {
    if (!list || !list.length) continue;
    const logos = ((await api("/" + kind + "/" + list[0].id + "/images?include_image_language=en,null")).logos || [])
      .filter((l) => /\.png$/.test(l.file_path));
    const pick = logos.find((l) => l.iso_639_1 === "en") || logos.find((l) => !l.iso_639_1);
    return pick ? "https://image.tmdb.org/t/p/w300" + pick.file_path : "";
  }
  return "";
}

// A few of the film's scene stills from TMDB (its backdrops without text), for the Magnavox's trailer-style montage in
// Nick's Office: GET /library/stills?imdb=tt0113568 -> { stills: [300px image URLs] }. Cached for a week.
async function stillsRoute(request, url, env, cors, h) {
  const imdb = (url.searchParams.get("imdb") || "").trim();
  if (!/^tt\d{5,10}$/.test(imdb)) return h.json({ error: "Expected an IMDb id (tt...)." }, 400, cors);
  const cache = caches.default, key = new Request("https://stills.nickmade.net/" + imdb);
  const hit = await cache.match(key);
  if (hit) return h.json(await hit.json(), 200, cors);
  let stills = [];
  if (env.TMDB_API_KEY) {
    const api = (path) => fetch("https://api.themoviedb.org/3" + path + (path.includes("?") ? "&" : "?") + "api_key=" + env.TMDB_API_KEY)
      .then((r) => (r.ok ? r.json() : {}));
    const found = await api("/find/" + imdb + "?external_source=imdb_id");
    const movie = found.movie_results && found.movie_results[0];
    if (movie) {
      const shots = ((await api("/movie/" + movie.id + "/images?include_image_language=null")).backdrops || [])
        .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 6);
      stills = shots.map((s) => "https://image.tmdb.org/t/p/w300" + s.file_path);
    }
  }
  const body = { stills };
  if (stills.length) await cache.put(key, new Response(JSON.stringify(body), { headers: { "Cache-Control": "max-age=604800" } }));
  return h.json(body, 200, cors);
}

// A film's details for the Movies page's poster dialogs (the same as a disc's case gets when it's added): GET
// /library/film?imdb=tt0113568, or ?title=Heat&year=1995 for the posters in list.js that have no IMDb id (IMDb's
// suggestion search, the closest title and year). -> { imdbId, title, year, minutes, rated, genres, director,
// starring, tagline and trailer (TMDB), about, aboutUrl }. Cached for a month.
async function filmRoute(request, url, env, cors, h) {
  const imdb = (url.searchParams.get("imdb") || "").trim();
  const title = (url.searchParams.get("title") || "").trim().slice(0, 120), year = parseInt(url.searchParams.get("year"), 10) || null;
  if (!/^tt\d{5,10}$/.test(imdb) && !title) return h.json({ error: "Expected an IMDb id or a title." }, 400, cors);
  const cache = caches.default, key = new Request("https://film.nickmade.net/v4/" + (imdb || encodeURIComponent(title.toLowerCase() + "|" + (year || ""))));
  const hit = await cache.match(key);
  if (hit) return h.json(await hit.json(), 200, cors);
  try {
    const film = await tmdbFilm(env, /^tt\d{5,10}$/.test(imdb) ? { imdb } : { title, year });
    if (!film) return h.json({ error: "Couldn't find it." }, 404, cors);
    const wiki = film.imdbId ? await wikipedia(film.imdbId).catch(() => null) : null;
    const body = { ...film, about: wiki ? wiki.text : "", aboutUrl: wiki ? wiki.url : "" };
    await cache.put(key, new Response(JSON.stringify(body), { headers: { "Cache-Control": "max-age=2592000" } }));
    return h.json(body, 200, cors);
  } catch (e) {
    return h.json({ error: String(e.message || e) }, 502, cors);
  }
}

// A film's details from TMDB (the poster cards on the Movies page, the trailers in the Library's cases): found by IMDb
// id, or by title and year (TMDB's search); one request brings its credits, US ratings, videos and IMDb id. (These came
// from IMDb's own API at first, but it refuses Cloudflare's servers: 429.) -> { imdbId, title, year, minutes, rated,
// genres, director, starring, tagline, trailer } or null
// strict: only a film or show with exactly that title; before: of several with that title, one out by then if any (a VHS)
async function tmdbFilm(env, { imdb, title, year, strict, before }) {
  if (!env.TMDB_API_KEY) throw new Error("No TMDB key");
  const api = (path) => fetch("https://api.themoviedb.org/3" + path + (path.includes("?") ? "&" : "?") + "api_key=" + env.TMDB_API_KEY)
    .then((r) => { if (!r.ok) throw new Error("TMDB didn't answer (" + r.status + ")"); return r.json(); });
  let kind = "movie", id = null;
  if (imdb) {
    const found = await api("/find/" + imdb + "?external_source=imdb_id");
    if (found.movie_results && found.movie_results[0]) id = found.movie_results[0].id;
    else if (found.tv_results && found.tv_results[0]) { kind = "tv"; id = found.tv_results[0].id; }
  } else {
    const bare = (t) => plain(t).replace(/^the /, ""); // "Return of the King" is "The Return of the King"
    const same = (r) => bare(r.title || r.name || "") === bare(title);
    const yr = (r) => parseInt(String(r.release_date || r.first_air_date || "").slice(0, 4), 10) || 0;
    const movies = (await api("/search/movie?query=" + encodeURIComponent(title) + (year ? "&year=" + year : ""))).results || [];
    let pick = movies.find((r) => same(r) && (!year || Math.abs(yr(r) - year) <= 1) && (!before || (yr(r) && yr(r) <= before)))
      || movies.find((r) => same(r) && (!year || Math.abs(yr(r) - year) <= 1)) || movies.find(same) || (strict ? null : movies[0]);
    if (!pick) {
      const shows = (await api("/search/tv?query=" + encodeURIComponent(title))).results || [];
      pick = shows.find(same) || (strict ? null : shows[0]);
      if (pick) kind = "tv";
    }
    if (pick) id = pick.id;
  }
  if (!id) return null;
  const d = await api("/" + kind + "/" + id + "?append_to_response=credits,videos,external_ids," + (kind === "movie" ? "release_dates" : "content_ratings"));
  const us = (list) => (list || []).find((r) => r.iso_3166_1 === "US");
  let rated = "";
  if (kind === "movie") {
    const dates = (us(d.release_dates && d.release_dates.results) || {}).release_dates || [];
    const cert = dates.filter((r) => r.certification).sort((a, b) => (a.type === 3 ? -1 : 0) - (b.type === 3 ? -1 : 0))[0]; // theatrical first
    rated = cert ? cert.certification : "";
  } else rated = (us(d.content_ratings && d.content_ratings.results) || {}).rating || "";
  const crew = (d.credits && d.credits.crew) || [];
  const directors = kind === "movie" ? crew.filter((c) => c.job === "Director").map((c) => c.name) : (d.created_by || []).map((c) => c.name);
  return {
    imdbId: (d.external_ids && d.external_ids.imdb_id) || imdb || "",
    title: d.title || d.name || title || "",
    year: parseInt(String(d.release_date || d.first_air_date || "").slice(0, 4), 10) || year || null,
    minutes: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null,
    rated,
    genres: (d.genres || []).map((g) => g.name),
    director: directors.slice(0, 2).join(", "),
    starring: ((d.credits && d.credits.cast) || []).sort((a, b) => a.order - b.order).slice(0, 4).map((c) => c.name),
    tagline: String(d.tagline || "").trim(),
    trailer: pickTrailer((d.videos && d.videos.results) || []),
    // for Add a disc
    series: kind === "tv",
    studio: d.production_companies && d.production_companies[0] ? d.production_companies[0].name : "",
    image: d.poster_path ? "https://image.tmdb.org/t/p/w500" + d.poster_path : "",
  };
}

// The official trailer's YouTube id: an official English "Trailer" first, else any trailer, else a teaser, or ""
function pickTrailer(videos) {
  const vids = videos.filter((v) => v.site === "YouTube" && /^[\w-]{11}$/.test(v.key) && (v.type === "Trailer" || v.type === "Teaser"));
  const rank = (v) => (v.type === "Trailer" ? 0 : 2) + (v.official ? 0 : 1) + (v.iso_639_1 === "en" ? 0 : 0.5);
  const best = vids.sort((a, b) => rank(a) - rank(b) || String(a.published_at).localeCompare(String(b.published_at)))[0];
  return best ? best.key : "";
}

// The film's Wikipedia summary: Wikidata item with this IMDb id (P345) -> its English article -> the summary
async function wikipedia(imdbId) {
  const opts = { headers: { "User-Agent": UA, Accept: "application/json" } };
  const found = await (await fetch("https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srsearch=" +
    encodeURIComponent("haswbstatement:P345=" + imdbId), opts)).json();
  const qid = found.query && found.query.search[0] && found.query.search[0].title;
  if (!qid) return null;
  const ent = await (await fetch("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=" + qid, opts)).json();
  const link = ent.entities && ent.entities[qid] && ent.entities[qid].sitelinks && ent.entities[qid].sitelinks.enwiki;
  if (!link) return null;
  const sum = await (await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(link.title.replace(/ /g, "_")), opts)).json();
  if (!sum.extract) return null;
  const text = castless(sum.extract);
  if (!text) return null;
  return { text: trimBlurb(text), url: sum.content_urls && sum.content_urls.desktop ? sum.content_urls.desktop.page : "" };
}

// No cast lists in a summary (Nick, 2026-11-04: "I don't want any summaries to just have lists of actors ... we mark them
// in the attributes at the bottom already"): a sentence that's only the cast goes; "...directed by X, and starring A,
// B and C." keeps its first half; "Directed by X, the film stars A, B." becomes "It was directed by X."; "Starring A, B,
// it is the third installment..." becomes "It is the third installment...". A lead tied to the plot ("It stars Jim
// Carrey as a lawyer who...") stays. The same rules were run over the shelves' summaries that day (session scratchpad cast/).
const CAST_ABBR = /(?:\b[A-Z]|\bJr|\bSr|\bDr|\bMr|\bMrs|\bMs|\bSt|\bvs|\bNo|\bVol|\bLtd|\bInc|\bU\.S)\.$/;
const CAST_NAME = /\b(?:[A-Z][\p{L}'’.-]*)(?:\s+(?:[A-Z][\p{L}'’.-]*|de|da|van|von|del|la|le|di|du|St\.|Jr\.?))*/gu;
const CAST_WORD = /\b(stars?|starred|starring|co-?stars?|co-?starred|co-?starring|cast|casts|ensemble|supporting roles?|featuring|features|alongside|also appears?|voice cast|vocal talents)\b/i;
const CAST_FILLER = new Set(("the a an it its film film's movie this also stars star starred starring co-stars co-star co-starring costarring cast " +
  "cast's ensemble including includes include included consisting of features featuring feature with and in as alongside supporting role roles " +
  "lead leading leads led by his her their title titular principal main voice voices vocal talents provide provides providing play plays playing " +
  "appear appears appeared appearing respectively while along other others another together reprising reprise reprises reprised character " +
  "characters himself herself themselves fictionalized version major key is was are were has had who whom which all-star star-studded " +
  "star-filled powerhouse exceptional standout phenomenal amazing big-screen favorites more best friends friend debut from that actors actor actress").split(" "));
function castSentences(t) {
  const out = []; let cur = "";
  for (const p of t.split(/(?<=[.!?]["”’)]?)\s+/)) { cur = cur ? cur + " " + p : p; if (!CAST_ABBR.test(cur.replace(/["”’)]$/, ""))) { out.push(cur); cur = ""; } }
  if (cur) out.push(cur);
  return out;
}
function castResidue(s) {
  return s.replace(/\([^)]*\)/g, " ").replace(CAST_NAME, " ").toLowerCase().replace(/[^\p{L}' -]+/gu, " ").split(/\s+/)
    .filter((w) => w && w !== "-" && !CAST_FILLER.has(w) && !CAST_FILLER.has(w.replace(/'s$/, "")));
}
const castPure = (s) => castResidue(s).length <= 3;
const lcFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1), ucFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const endStop = (t) => { t = t.replace(/[,;:\s–—-]+$/, ""); return t + (/[.!?”"]$/.test(t) ? "" : "."); };
function asSentence(lead) {
  if (/^(Produced|Directed|Written|Co-produced|Co-written|Co-directed|Created|Animated|Released|Distributed)\b/.test(lead)) return "It was " + lcFirst(lead);
  if (/^(Based|Loosely|Inspired|Adapted)\b/.test(lead)) return "It is " + lcFirst(lead).replace(/^based upon/, "based on");
  if (/^An?\s/.test(lead)) return "It is " + lcFirst(lead);
  return null;
}
function uncast(s) { // the sentence without its cast list, "" to drop it, or s as it is
  if (!CAST_WORD.test(s) || (s.match(CAST_NAME) || []).length < 2) return s;
  let m = /^(.{15,}?),\s+(?:the film|it|the movie)\s+(?:also\s+)?(?:stars|features|starred|starring)\b(.*)$/i.exec(s);
  if (m && castPure(m[2]) && !CAST_WORD.test(m[1])) { const c = asSentence(m[1]); if (c) return endStop(c); }
  m = /^(It|The film)\s+(?:also\s+)?stars\s+(.+?),?\s+and\s+(is|was|won|marks|became|earned|received)\s+(.*)$/i.exec(s);
  if (m && castPure(m[2])) return endStop(m[1] + " " + m[3] + " " + m[4]);
  m = /^(?:Also\s+)?(?:Starring|Co-?starring|Featuring)\s+(.*)$/i.exec(s);
  if (m) {
    const parts = m[1].split(/,\s+/);
    for (let i = 1; i < parts.length; i++) {
      const head = parts.slice(0, i).join(", "), rest = parts.slice(i).join(", ");
      if (/^(it|the|this|these|its)\b/i.test(rest) && castPure("starring " + head) && castResidue(rest).length > 3) return endStop(ucFirst(rest));
    }
  }
  m = /^(.{25,}?)(,?\s+(?:and\s+)?(?:it\s+)?(?:starring|stars|starred|co-?starring|featuring|features)\b.*)$/i.exec(s);
  if (m) {
    let keep = m[1].replace(/[,;:\s–—-]+$/, "");
    const bad = /\b(the film|the movie|the special|it|by|with|and|of|the|a|an|also|that|which|who)$/i.test(keep);
    if (!bad && castPure(m[2]) && !CAST_WORD.test(keep)) {
      if (/^(Produced|Directed|Written|Co-produced|Co-written|Co-directed|Created|Animated|Released|Distributed|Based|Loosely|Inspired|Adapted)\b/.test(keep) &&
        !/,\s+(it|the film|the movie)\s/.test(keep)) keep = asSentence(keep) || "";
      if (keep) return endStop(keep);
    }
  }
  if (/\b(is|was) an? .{0,80}\b(film|movie|comedy|drama|thriller|musical|western|documentary|series)\b/i.test(s)) return s;
  return castPure(s) ? "" : s;
}
function castless(text) {
  return String(text || "").split(/\n\s*\n/).map((p) => castSentences(p.trim()).map(uncast).filter(Boolean).join(" ")).filter(Boolean).join("\n\n");
}

// Wikipedia leads run long: whole sentences up to about BLURB_MAX characters
function trimBlurb(text) {
  if (text.length <= BLURB_MAX) return text;
  const cut = text.slice(0, BLURB_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 150 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "\u2026";
}

// ---------- reading the back of the case (Nick, 2026-10-25: "read a picture of the back of the case with all the
// features and have them digitally imported into the text box") ----------
// The same model as the Scorecard's card reader (scorecard.js READ_MODEL, best on small print in its tests), on the
// same free Workers AI allowance (10,000 neurons a day, shared), so at most FEATURE_READS a day
const FEATURE_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const FEATURE_READS = 40;
const FEATURE_ASK = `This is a photo of the back of a movie or TV DVD, Blu-ray, 4K or VHS case. Find its list of special features ` +
  `(also called bonus features, extras, or bonus material) and reply with JSON only: {"features": ["<each feature>"]}\n` +
  `Rules:
- One entry per feature, written as printed but without bullets, and in title case if printed in capitals.
- Keep a feature's short description only when it is part of its name (like "Audio Commentary with Director Ridley Scott").
- A feature with parts (a documentary in several chapters) is one entry.
- Features can be under any heading, including one about picture and sound: music videos, trailers, featurettes, games
  and commentaries all count, wherever they are listed. Give each named music video its own entry, like
  "Music Video: Song Title Performed By Artist".
- Picture and sound quality claims are not features (a new sound mix, "digitally restored", widescreen, THX), nor are
  catch-alls like "And Much More".
- Leave out everything that is not a bonus feature: the plot summary, quotes and reviews, the cast and crew credits,
  running time, rating, aspect ratio, audio and subtitle languages, region, disc count, legal text, and the barcode.
- If no special features are printed, reply {"features": []}.
Reply with the JSON only, no other words.`;
async function readFeatures(request, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  if (!env.AI) return h.json({ error: "The case reader isn't set up." }, 503, cors);
  let b = null;
  try { b = await request.json(); } catch (e) {}
  if (!b || !/^data:image\/(jpeg|png|webp);base64,/.test(b.image || "") || b.image.length > 3400000) return h.json({ error: "Send the photo as a JPEG under about 2.5 MB." }, 400, cors);
  const key = "library:reads:" + new Date().toISOString().slice(0, 10), used = +(await env.QUEUE.get(key)) || 0;
  if (used >= FEATURE_READS) return h.json({ error: "That's all the case reading for today. Type them in, or try again tomorrow." }, 429, cors);
  const ask = { messages: [{ role: "user", content: [{ type: "text", text: FEATURE_ASK }, { type: "image_url", image_url: { url: b.image } }] }], max_tokens: 1200, temperature: 0 };
  let out = null, err = null;
  for (let tries = 0; tries < 2 && !out; tries++) { // Workers AI now and then fails a request outright; once more usually works
    if (tries) await new Promise((r) => setTimeout(r, 1500));
    try { out = await aiRun(env, FEATURE_MODEL, ask, "case-reader"); } catch (e) { err = e; }
  }
  if (!out && /4006|daily free allocation/i.test(String(err && (err.message || err)))) return h.json({ error: "That's all the case reading for today (the free allowance). Try again tomorrow." }, 429, cors);
  if (!out && /switched off|allowance is used up/.test(String(err && err.message))) return h.json({ error: err.message }, 429, cors); // (the AI meter: aimeter.js)
  if (!out) return h.json({ error: "Couldn't read that photo just now. Try again in a moment.", detail: String(err && (err.message || err)) }, 502, cors);
  await env.QUEUE.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
  const reply = out.response ?? (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content);
  let read = typeof reply === "object" && reply ? reply : null;
  if (!read) { // the first {...} in the reply (some wrap it in ```json fences)
    const t = String(reply || "").replace(/```(?:json)?/g, ""), a = t.indexOf("{"), z = t.lastIndexOf("}");
    try { read = a >= 0 && z > a ? JSON.parse(t.slice(a, z + 1)) : null; } catch (e) { read = null; }
  }
  if (!read || !Array.isArray(read.features)) return h.json({ error: "Couldn't make sense of that photo. Try a straighter, closer one of the features list." }, 502, cors);
  const features = read.features.map((f) => String(f || "").replace(/^[\s•·\-*–—]+/, "").replace(/\s+/g, " ").trim().slice(0, 140))
    .filter((f, i, all) => f && all.findIndex((x) => x.toLowerCase() === f.toLowerCase()) === i).slice(0, 40);
  return h.json({ features }, 200, cors);
}

async function add(request, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const imdbId = String(body.imdbId || "");
  const format = String(body.format || "");
  if (!/^tt\d{5,12}$/.test(imdbId)) return h.json({ error: "Pick a movie first." }, 400, cors);
  if (!FORMATS.includes(format)) return h.json({ error: "Pick 4K, Blu-ray, DVD, or VHS." }, 400, cors);
  const items = await list(env, ITEMS);
  if (items.some((d) => d.imdbId === imdbId && d.format === format)) return h.json({ error: "That one's already on the shelves." }, 409, cors);

  // its facts from TMDB (IMDb's own API refuses Cloudflare's servers), IMDb's only if TMDB doesn't know it
  let t = null;
  try { t = await tmdbFilm(env, { imdb: imdbId }); } catch (e) { /* try IMDb */ }
  if (!t) { try { t = await imdbTitle(imdbId); } catch (e) { return h.json({ error: "Couldn't get that title's details. Try again in a bit." }, 502, cors); } }
  let wiki = null;
  try { wiki = await wikipedia(imdbId); } catch (e) { /* no blurb, the rest still works */ }
  let logo = "";
  try { logo = await tmdbLogo(imdbId, env); } catch (e) { /* the spine shows the title */ }

  const edition = String(body.edition || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const features = (Array.isArray(body.features) ? body.features : String(body.features || "").split("\n"))
    .map((f) => String(f).replace(/^[\s•\-–*]+/, "").replace(/\s+/g, " ").trim().slice(0, 160)).filter(Boolean).slice(0, FEATURE_MAX);
  // the title as the case writes it, when that's the official one with its number in digits ("101 Dalmatians", so it
  // shelves under #); anything else stays the official title
  // (caseName: the scanned case's names from the barcode databases, whichever film was picked in the end)
  const dt = digitTitle(t.title);
  const asCase = dt && ((body.title && plain(String(body.title)) === plain(dt)) || (body.caseName && caseShows(String(body.caseName).slice(0, 400), dt))) ? dt : t.title;
  const d = {
    id: discId(t.title, t.year, format),
    title: asCase,
    sort: sortTitle(asCase),
    year: t.year,
    format,
    edition,
    kind: t.series ? "tv" : "movie",
    minutes: t.minutes,
    rated: t.rated,
    genres: t.genres,
    director: t.director,
    starring: t.starring,
    tagline: t.tagline || "", // (the amber line in the case; discs added before 2026-10-25 get it when opened)
    about: wiki ? wiki.text : "",
    aboutUrl: wiki ? wiki.url : "",
    studio: t.studio,
    features,
    steelbook: !!body.steelbook,
    criterion: !!body.criterion || /criterion/i.test(edition),
    threeD: !!body.threeD,
    hdr: format === "4k" && Array.isArray(body.hdr) ? HDR_KINDS.filter((k) => body.hdr.includes(k)) : [],
    added: new Intl.DateTimeFormat("en-CA", { timeZone: env.TIMEZONE || "America/Chicago" }).format(new Date()),
    imdbId,
    // TMDB's poster at 500px wide; or an IMDb poster, which resizes on the fly (400px wide like the imported covers)
    cover: !t.image ? "" : /image\.tmdb\.org/.test(t.image) ? t.image : t.image.replace(/\._V1_.*\.jpg$/, "._V1_UX400_.jpg").replace(/(@)\.jpg$/, "$1._V1_UX400_.jpg"),
    logo, // the spine's colour is measured from the cover in the browser (library.js), since a Worker can't decode images
    site: true,
  };
  while (items.some((x) => x.id === d.id)) d.id += "-2";
  // the cover picked in the dialog (VHS: a photo of the actual tape, or another of the film's posters)
  if (body.cover && String(body.cover) !== d.cover) {
    let kept = "";
    try { kept = await keepCover(env, String(body.cover).slice(0, 600), d.id); } catch (e) { /* the poster stays */ }
    if (kept) d.cover = kept;
  }
  for (const k of Object.keys(d)) if (d[k] === "" || d[k] === null || d[k] === false || (Array.isArray(d[k]) && !d[k].length)) delete d[k];
  items.unshift(d);
  await env.QUEUE.put(ITEMS, JSON.stringify(items));
  return h.json({ item: d }, 200, cors);
}

async function remove(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const id = decodeURIComponent(url.pathname.slice("/library/".length));
  if (!/^[a-z0-9-]{1,100}$/.test(id)) return h.json({ error: "Bad id." }, 400, cors);
  const items = await list(env, ITEMS);
  const kept = items.filter((d) => d.id !== id);
  if (kept.length !== items.length) {
    await env.QUEUE.put(ITEMS, JSON.stringify(kept));
    // its cover, if it was a photo copied into the bucket
    const gone = items.find((d) => d.id === id), base = photoBase(env);
    if (gone && gone.cover && gone.cover.startsWith(base + "covers/") && env.PHOTOS) await env.PHOTOS.delete(gone.cover.slice(base.length)).catch(() => {});
    return h.json({ removed: id }, 200, cors);
  }
  const hidden = await list(env, HIDDEN); // a discs.js disc: hide it for everyone
  if (!hidden.includes(id)) hidden.push(id);
  await env.QUEUE.put(HIDDEN, JSON.stringify(hidden));
  return h.json({ hidden: id }, 200, cors);
}

async function editMap(env) {
  try { const m = JSON.parse((await env.QUEUE.get(EDITS)) || "{}"); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; } catch (e) { return {}; }
}
// Editing a disc from its open case (owner mode): its cover, picked from the film's posters (Nick, 2026-11-04: "allow
// me to pick the cover for any movie in the edit box like the other library pages"), and its edition, extras (steelbook,
// 3D, Criterion), HDR and what's on the disc ("let me edit the movies in the open disc"). Only the fields sent change.
// A disc added on the site is changed itself (a new cover's spine colour is measured again on the page); a discs.js
// disc's changes go in library:edits. A TMDB poster stays an address; any other picture is copied into the photos bucket.
async function editDisc(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const id = decodeURIComponent(url.pathname.slice("/library/".length));
  if (!/^[a-z0-9-]{1,100}$/.test(id)) return h.json({ error: "Bad id." }, 400, cors);
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  if (!body || typeof body !== "object") return h.json({ error: "Bad request." }, 400, cors);
  const ch = {};
  if (body.cover !== undefined) {
    let src = String(body.cover || "").trim();
    if (!/^https:\/\/\S{1,600}$/.test(src)) return h.json({ error: "Pick a cover." }, 400, cors);
    if (!/^https:\/\/image\.tmdb\.org\//.test(src) && !src.startsWith(photoBase(env))) {
      let kept = "";
      try { kept = await keepCover(env, src, id); } catch (e) { /* below */ }
      if (!kept) return h.json({ error: "That picture wouldn't load. Try another." }, 502, cors);
      src = kept;
    }
    ch.cover = src;
  }
  if (body.edition !== undefined) ch.edition = String(body.edition || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (body.features !== undefined) ch.features = (Array.isArray(body.features) ? body.features : String(body.features || "").split("\n"))
    .map((f) => String(f).replace(/^[\s•\-–*]+/, "").replace(/\s+/g, " ").trim().slice(0, 160)).filter(Boolean).slice(0, FEATURE_MAX);
  for (const k of ["steelbook", "threeD", "criterion"]) if (body[k] !== undefined) ch[k] = !!body[k];
  if (body.hdr !== undefined) ch.hdr = Array.isArray(body.hdr) ? HDR_KINDS.filter((k) => body.hdr.includes(k)) : [];
  if (!Object.keys(ch).length) return h.json({ error: "Nothing to change." }, 400, cors);
  const items = await list(env, ITEMS);
  const d = items.find((x) => x.id === id);
  if (d) {
    for (const [k, v] of Object.entries(ch)) {
      if (v === "" || v === false || (Array.isArray(v) && !v.length)) delete d[k]; else d[k] = v;
    }
    if (ch.cover) { delete d.spine; delete d.spineLight; }
    await env.QUEUE.put(ITEMS, JSON.stringify(items));
    return h.json({ item: d }, 200, cors);
  }
  const map = await editMap(env);
  map[id] = Object.assign(map[id] || {}, ch); // (an emptied field is kept as "", false or [], so it covers the file's)
  await env.QUEUE.put(EDITS, JSON.stringify(map));
  return h.json({ id, edits: map[id] }, 200, cors);
}

async function pickList(env) {
  try {
    const p = JSON.parse((await env.QUEUE.get(PICKS)) || "{}");
    return { on: Array.isArray(p.on) ? p.on : [], off: Array.isArray(p.off) ? p.off : [] };
  } catch (e) { return { on: [], off: [] }; }
}
// a film made a Nick's Pick (or not) from its open case; kept by title, like the page's picks, so every copy of the
// film follows (the sticker still goes on its best copy only)
async function setPick(request, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  let body;
  try { body = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const key = String((body && body.key) || "").trim();
  if (!key || key.length > 200 || !/^[a-z0-9 ]+$/.test(key)) return h.json({ error: "Bad film." }, 400, cors);
  const p = await pickList(env);
  p.on = p.on.filter((k) => k !== key);
  p.off = p.off.filter((k) => k !== key);
  (body.on ? p.on : p.off).push(key);
  await env.QUEUE.put(PICKS, JSON.stringify(p));
  return h.json({ picks: p }, 200, cors);
}

// ---------- covers (the add dialog's Cover choices, VHS) ----------
// The film's posters on TMDB: the official one first, then the others (older and other countries' posters often match
// the art on a VHS box), English or wordless ones, best rated first
async function coversRoute(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const imdbId = url.searchParams.get("imdbId") || "";
  if (!/^tt\d{5,12}$/.test(imdbId) || !env.TMDB_API_KEY) return h.json({ posters: [] }, 200, cors);
  const api = (path) => fetch("https://api.themoviedb.org/3" + path + (path.includes("?") ? "&" : "?") + "api_key=" + env.TMDB_API_KEY).then((r) => (r.ok ? r.json() : {}));
  try {
    const found = await api("/find/" + imdbId + "?external_source=imdb_id");
    const m = (found.movie_results || [])[0], tv = (found.tv_results || [])[0], hit = m || tv;
    if (!hit) return h.json({ posters: [] }, 200, cors);
    const imgs = await api("/" + (m ? "movie" : "tv") + "/" + hit.id + "/images?include_image_language=en,null");
    const paths = [hit.poster_path].concat((imgs.posters || []).sort((a, b) => b.vote_average - a.vote_average || b.vote_count - a.vote_count).map((p) => p.file_path));
    const uniq = [...new Set(paths.filter(Boolean))].slice(0, 10);
    return h.json({ posters: uniq.map((p) => ({ src: "https://image.tmdb.org/t/p/w500" + p, thumb: "https://image.tmdb.org/t/p/w185" + p })) }, 200, cors);
  } catch (e) {
    return h.json({ posters: [] }, 200, cors);
  }
}
const COVER_MAX = 5e6;
function photoBase(env) { return (env.PHOTO_URL || "https://photos.nickmade.net/").replace(/\/?$/, "/"); }
// The picked cover for a new disc: a TMDB poster stays an address; a seller's photo is fetched once and kept in the
// photos bucket (covers/<disc id>.<ext>), so the shelf doesn't depend on the seller keeping it. "" if it won't load.
async function keepCover(env, src, id) {
  if (/^https:\/\/image\.tmdb\.org\/t\/p\/w500\/[\w.-]+$/.test(src)) return src;
  if (!/^https:\/\/[^\s"'<>]+$/.test(src) || !env.PHOTOS) return "";
  const res = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0 (nickmade.net library)", Accept: "image/*" } });
  const type = (res.headers.get("Content-Type") || "").split(";")[0].trim();
  if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return "";
  const buf = await res.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > COVER_MAX) return "";
  const key = "covers/" + id + "." + (type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg");
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  return photoBase(env) + key;
}

// ---------- HDR (Ver 1.4) ----------
// blu-ray.com's release pages list a 4K disc's HDR ("HDR: Dolby Vision, HDR10"); TheDiscDb and IMDb don't. Its quick
// search finds a release by barcode (the exact edition) or by title; it answers "Error42" when asked too quickly, so
// this asks at most 3 times. Not an API: if blu-ray.com changes its pages, this finds nothing and Nick ticks the boxes.
const BR_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
async function bluray(url, form) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      method: form ? "POST" : "GET",
      headers: { "User-Agent": BR_UA, Accept: "text/html,*/*", "Accept-Language": "en-US,en", Referer: "https://www.blu-ray.com/",
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const text = await res.text();
    if (text.trim().toLowerCase() !== "error42") return text; // (it says "Error42" or "error42")
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error("blu-ray.com is busy");
}

// [{ name, url }] from blu-ray.com's quick search (the 4K section; its results include Blu-rays too)
async function blurayFind(keyword, section) {
  const body = await bluray("https://www.blu-ray.com/search/quicksearch.php",
    { section: section || "4kbluraymovies", userid: "-1", country: "US", keyword });
  const names = [...body.matchAll(/id="match\d+">[\s\S]*?&nbsp;([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  // Blu-rays and 4Ks live under /movies/, DVDs under /dvd/
  const urls = [...body.matchAll(/'(https:\/\/www\.blu-ray\.com\/(?:movies|dvd)\/[^']+)'/g)].map((m) => m[1]);
  return urls.map((url, i) => ({ name: names[i] || "", url }));
}

function hdrFromPage(page) {
  const i = page.indexOf("HDR:");
  if (i < 0) return [];
  const line = page.slice(i + 4, i + 400).replace(/<[^>]+>/g, " ").split(/Aspect ratio|Original aspect|Audio|\n/i)[0].toLowerCase();
  return HDR_KINDS.filter((k) => (k === "dv" ? /dolby vision/ : k === "hdr10+" ? /hdr10\+/ : /hdr10(?!\+)/).test(line));
}

function plain(t) {
  return String(t).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

// The 4K release's page: by barcode, else the first 4K release whose address has the title ("Dune-4K-Blu-ray"),
// trying the title with its year too (a short title alone, like "Dune", gets no results)
async function blurayRelease(title, year, upc) {
  if (upc) {
    const hits = await blurayFind(upc);
    if (hits.length) return hits[0].url;
  }
  if (!title) return null;
  for (const keyword of [title, year ? title + " " + year : null].filter(Boolean)) {
    for (const r of await blurayFind(keyword)) {
      const m = /\/movies\/(.+)-4K-Blu-ray\/\d+\//.exec(r.url);
      if (m && plain(m[1].replace(/-/g, " ")) === plain(title)) return r.url;
    }
  }
  return null;
}

async function hdrRoute(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const title = (url.searchParams.get("title") || "").trim().slice(0, 120);
  const year = parseInt(url.searchParams.get("year"), 10) || null;
  const upc = (url.searchParams.get("upc") || "").replace(/\D/g, "").slice(0, 14);
  try {
    const page = await blurayRelease(title, year, upc);
    if (!page) return h.json({ hdr: [], found: false }, 200, cors);
    return h.json({ hdr: hdrFromPage(await bluray(page)), found: true, url: page }, 200, cors);
  } catch (e) {
    return h.json({ hdr: [], found: false, error: e.message }, 200, cors);
  }
}

// ---------- Barcode (Ver 1.4): the add dialog's scanner ----------
// UPC-A / EAN-13 / EAN-8 with a correct check digit (a misread scan or a typo fails it; so does "000000000000")
function validBarcode(code) {
  if (!/^\d{8}$|^\d{12,13}$/.test(code) || /^(\d)\1+$/.test(code)) return false;
  const digits = code.split("").map(Number), check = digits.pop();
  const sum = digits.reverse().reduce((t, d, i) => t + d * (i % 2 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === check;
}
// Not on blu-ray.com (every VHS tape, and some DVDs): a barcode database gives a seller's product name ("The Big
// Lebowski VHS Jeff Bridges John Goodman 1998 Tested"). The name up to its first format word (or bracket) is the title,
// any year in it the year, and TMDB finds the film from those. Names are messy, so the dialog asks Nick to check it's
// the right film. Which database: upcdatabase.org first when the UPCDATABASE_KEY secret is set (a free account's key,
// about 100 lookups a day counted for that key alone), then UPCitemdb's keyless trial. UPCitemdb counts its 100 a day
// per IP address, and a Worker's requests leave from Cloudflare addresses shared with many other sites, so other people
// often use that allowance up first (and it only answers browsers on its own site, so the phone can't ask it directly).
const FORMAT_WORDS = /\b(vhs|dvd|blu-?ray|4k|uhd|ultra hd|widescreen|full ?screen|special edition|collector'?s|digital)\b|[([{]/i; // (not at dashes: the parts either side are tried below)
// the product for a barcode: { title, category, description }, null if neither database knows it, or { busy: true }
async function productOf(env, upc) {
  let busy = false;
  if (env.UPCDATABASE_KEY) {
    try {
      const res = await fetch("https://api.upcdatabase.org/product/" + upc + "?apikey=" + encodeURIComponent(env.UPCDATABASE_KEY), { headers: { Accept: "application/json" } });
      const d = await res.json();
      // what it said, for `wrangler tail` (never the key)
      // its name is usually the title; some products only have a description (or the title is blank)
      const named = d.success && String(d.title || d.description || "").trim();
      console.log("upcdatabase.org", upc, res.status, named ? "found: " + named : d.success ? "found, no name: " + JSON.stringify(d).slice(0, 400) : "no: " + JSON.stringify(d.error || d).slice(0, 200));
      if (named) {
        // its name; the photos too (upcdatabase.org's own, plus UPCitemdb's if it answers: they're the Cover choices)
        const more = await upcitemdb(upc).catch(() => null);
        // (alt: UPCitemdb's name for it, which can say more: "Walt Disney s Classic-101 Dalmatians")
        return { title: named, alt: more && more.title ? String(more.title) : "", category: d.category || "", description: d.description || "", images: [].concat(d.images || [], (more && more.images) || []) };
      }
      if (res.status === 429) busy = true;
    } catch (e) { /* try UPCitemdb */ }
  }
  try {
    const item = await upcitemdb(upc);
    if (item && item.busy) return item;
    if (item && item.title) return item;
  } catch (e) { /* not found */ }
  return busy ? { busy: true } : null;
}
async function upcitemdb(upc) {
  const res = await fetch("https://api.upcitemdb.com/prod/trial/lookup?upc=" + upc, { headers: { Accept: "application/json" } });
  console.log("upcitemdb", upc, res.status);
  if (res.status === 429) return { busy: true };
  return ((await res.json()).items || [])[0] || null;
}
// sellers' photos as https addresses (they're shown straight from the seller in the dialog), at most 6, no repeats
function pictures(list) {
  const seen = new Set();
  return (list || []).map((u) => String(u || "").trim().replace(/^http:\/\//, "https://"))
    .filter((u) => /^https:\/\/[^\s"'<>]+$/.test(u) && !seen.has(u) && seen.add(u)).slice(0, 6);
}
// A title that starts with a number spelled out ("One Hundred and One Dalmatians") as digits ("101 Dalmatians"), or null
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function digitTitle(title) {
  const words = String(title || "").split(/\s+/);
  let total = 0, cur = 0, used = 0;
  for (; used < words.length; used++) {
    const w = words[used].toLowerCase().replace(/[^a-z-]/g, "");
    if (w === "and" && used > 0 && used < words.length - 1) continue;
    const parts = w.split("-");
    if (parts.every((p) => p in NUM)) { cur += parts.reduce((a, p) => a + NUM[p], 0); continue; }
    if (w === "hundred" && used > 0) { cur = (cur || 1) * 100; continue; }
    if (w === "thousand" && used > 0) { total += (cur || 1) * 1000; cur = 0; continue; }
    break;
  }
  if (!used || used >= words.length || words[used - 1].toLowerCase() === "and") return null;
  return String(total + cur) + " " + words.slice(used).join(" ");
}

// Whether a case's name writes this title with digits: the number itself, and each other word, allowing a misspelling
// ("BUENA VISTA HOME VIDEO VHS 101 Dalmations" shows "101 Dalmatians")
function caseShows(caseName, digits) {
  const have = plain(caseName).split(" ");
  const want = plain(digits).split(" ");
  return want.every((w, i) => (i === 0 ? have.includes(w) : have.some((h) => close(h, w))));
}

// IMDb's title search (the add dialog's, see search()): films, TV films and series, { id, title, year, image }
async function imdbSuggest(q) {
  q = String(q || "").trim().slice(0, 60);
  if (q.length < 2) return [];
  const res = await fetch("https://v3.sg.media-imdb.com/suggestion/x/" + encodeURIComponent(q.toLowerCase()) + ".json", { cf: { cacheTtl: 3600, cacheEverything: true } });
  const data = await res.json();
  return (data.d || []).filter((r) => /^tt\d+$/.test(r.id) && SEARCH_TYPES.has(r.qid))
    .map((r) => ({ id: r.id, title: r.l, year: r.y || null, image: r.i ? r.i.imageUrl : null, series: /^tv(Series|MiniSeries)$/.test(r.qid) })).slice(0, 8);
}
// two titles the same but for a letter or two (one per 7 letters), ignoring case, punctuation and a leading "The"
function close(a, b) {
  const x = plain(a).replace(/^the /, ""), y = plain(b).replace(/^the /, "");
  if (x === y) return true;
  const most = Math.max(1, Math.floor(Math.max(x.length, y.length) / 7));
  if (Math.abs(x.length - y.length) > most) return false;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[y.length] <= most;
}
async function upcItem(env, upc) {
  const none = { found: false, upc };
  const item = await productOf(env, upc);
  if (item && item.busy) return { ...none, error: "The free barcode lookup is busy today (it's shared with other sites). Search by title below." };
  if (!item || !item.title) return none;
  const name = String(item.title).replace(/\s+/g, " ").trim();
  const words = name + " " + (item.category || "") + " " + (item.description || "").slice(0, 200);
  const format = /\bvhs\b/i.test(words) ? "vhs" : /\b(4k|uhd|ultra hd)\b/i.test(words) ? "4k" : /\bblu-?ray\b/i.test(words) ? "bluray" : /\bdvd\b/i.test(words) ? "dvd" : "";
  const cut = FORMAT_WORDS.exec(name);
  let title = (cut ? name.slice(0, cut.index) : name).replace(/[\s,:;-]+$/, "").trim();
  const y = /\b(19[2-9]\d|20[0-3]\d)\b/.exec(name);
  // Sellers' names often wrap the title ("A Walt Disney Masterpiece-The Lion King", "JRR Tolkien's Lord of the Rings
  // 1977 VHS Tapes - Return of the King/The Hobbit"): try the name up to its format word, then without a studio's label,
  // a year or an author's name in front, then each part of the whole name split at dashes, colons and slashes (the
  // films in a set often come after "VHS Tapes -"), longest first. Each has to be a film's exact title (so "A Walt
  // Disney Masterpiece" can't match some film), all with the name's year if it has one, then without it; failing all of
  // them, TMDB's best guess.
  const label = (t) => t.replace(/^(a |an |the )?(walt disney(?:'?s| s)?|disney(?:'?s| s)?|pixar'?s?|dreamworks'?|warner bros\.?|universal)( (pictures|presents|masterpiece( collection)?|classics?|signature collection|gold collection|platinum edition|diamond edition))?\s*[-:–—]?\s*/i, "").trim();
  // the company that put the tape out, in front or anywhere ("WARNER HOME VIDEO, INC. Lord Of the Rings")
  const company = (t) => t.replace(/\b(?:[\w&.'/-]+\s+){0,3}(?:home video|home entertainment|video,? inc|entertainment,? inc|pictures,? inc|studios,? inc|home video,? inc)\b\.?,?\s*/gi, " ")
    .replace(/\b(?:warner bros|buena vista|mgm\/ua|columbia tristar|20th century fox|paramount|touchstone|vestron|orion|new line|hbo)\b\s*(?:home\s*)?(?:video|entertainment|pictures)?\b\.?,?\s*/gi, " ")
    .replace(/\b(?:inc|llc|ltd|corp)\b\.?,?/gi, " ").replace(/\s+/g, " ").trim();
  const tidy = (t) => company(label(t)).replace(/\b(19[2-9]\d|20[0-3]\d)\b/g, " ").replace(/\b(vhs|dvd|blu-?ray|tapes?|set|box|video|movie|film|new|sealed|tested)\b/gi, " ").replace(/\s+/g, " ").replace(/^[\s,.;-]+|[\s,.;-]+$/g, "");
  const noAuthor = (t) => t.replace(/^(?:[A-Z][\w.]*\.?\s+){0,3}[A-Z][\w.]*['’]s\s+/, ""); // "JRR Tolkien's ", "Stephen King's "
  // nothing but a distributor before the format word ("BUENA VISTA HOME VIDEO VHS 101 Dalmations (Full Screen)"): the
  // title is what comes after it, up to any bracket
  if (!tidy(title) && cut) title = name.slice(cut.index + cut[0].length).split(/[([{]/)[0].replace(/^[\s,:;-]+|[\s,:;-]+$/g, "");
  if (!title) return none;
  const parts = name.replace(/[([{].*?[)\]}]/g, " ").split(/\s*[-–—:|/]\s*/).map(tidy).filter((t) => t.length > 1).sort((a, b) => b.length - a.length);
  // words that describe a tape rather than name a film: never a title on their own ("Animated" is a 2017 film)
  const DESCRIBES = /^(animated|animation|cartoon|comedy|drama|horror|action|musical|family|kids|classic|classics|special|edition|collection|widescreen|full ?screen|clamshell|case|rare|vintage|original|english|spanish|uncut|pg|pg-13|g|r)$/i;
  const tries = [...new Set([title, label(title), tidy(title), noAuthor(tidy(title)), ...parts, ...parts.map(noAuthor)]
    .filter((t) => t && t.length > 1 && !DESCRIBES.test(t.trim())))];
  const yearOf = y ? +y[1] : null;
  let film = null;
  outer: for (const yr of yearOf ? [yearOf, null] : [null]) { // every name with the year first (a set's "1977" is The Hobbit's)
    for (const t of tries) {
      try { film = await tmdbFilm(env, { title: t, year: yr, strict: true, before: format === "vhs" ? 2006 : null }); } catch (e) { /* next */ }
      if (film && film.imdbId) break outer;
    }
  }
  // still nothing: IMDb's title search, which forgives a seller's misspelling ("101 Dalmations"), for a title a letter
  // or two off one of the names
  let near = [];
  if (!film || !film.imdbId) {
    for (const t of tries.slice(0, 6)) {
      const list = await imdbSuggest(t).catch(() => []);
      if (!near.length) near = list;
      const hit = list.find((r) => close(r.title, t) && (format !== "vhs" || !r.year || r.year <= 2006)) || list.find((r) => close(r.title, t));
      if (!hit) continue;
      try { film = await tmdbFilm(env, { imdb: hit.id }); } catch (e) { /* next */ }
      if (film && film.imdbId) { near = list; break; }
    }
  }
  const guess = tidy(title) || title;
  if ((!film || !film.imdbId) && !DESCRIBES.test(guess)) try { film = await tmdbFilm(env, { title: guess, year: yearOf }); } catch (e) { /* not found */ }
  // the other films it could be, as one-tap choices in the dialog (a remake, the cartoon of a live-action film...)
  if (film && film.imdbId && !near.length) near = await imdbSuggest(film.title).catch(() => []);
  // a Disney Classics or Masterpiece tape is always the cartoon: if the match isn't animated ("101 Dalmatians" is the
  // 1996 live-action film), one of the other choices that is wins (One Hundred and One Dalmatians, 1961)
  const both = name + " " + (item.alt || "");
  if (film && film.imdbId && /disney.*(classic|masterpiece)/i.test(both) && !(film.genres || []).some((g) => /animation/i.test(g))) {
    for (const r of near.filter((x) => x.id !== film.imdbId && !x.series && (!x.year || x.year <= 2006)).slice(0, 4)) {
      let f = null;
      try { f = await tmdbFilm(env, { imdb: r.id }); } catch (e) { /* next */ }
      if (f && (f.genres || []).some((g) => /animation/i.test(g)) && close(plain(f.title).replace(/\bone hundred and one\b/, "101"), plain(film.title).replace(/\bone hundred and one\b/, "101"))) { film = f; break; }
    }
  }
  const old = (r) => (format === "vhs" && r.year && r.year <= 2006 ? 0 : 1); // a tape: the films it could be on first
  const others = near.filter((r) => (!film || r.id !== film.imdbId) && !r.series).map((r, i) => [r, i])
    .sort((a, b) => old(a[0]) - old(b[0]) || a[1] - b[1]).map((x) => ({ id: x[0].id, title: x[0].title, year: x[0].year, image: x[0].image })).slice(0, 4);
  // the edition, when the name has one: a studio's label in front ("A Walt Disney Masterpiece-...": "Walt Disney
  // Masterpiece"), else an edition in brackets ("(Two-Disc Collector's Edition)"); Nick can change it in the form
  const lab = /^(?:a |an |the )?((?:walt disney(?:'?s| s)?|disney(?:'?s| s)?|pixar'?s?|dreamworks'?|warner bros\.?|universal) (?:masterpiece(?: collection)?|classics?|signature collection|gold collection|platinum edition|diamond edition))\b/i.exec(title);
  const br = /[([]([^)\]]*\b(?:edition|collection|masterpiece)\b[^)\]]*)[)\]]/i.exec(name);
  let edition = (lab ? lab[1] : br ? br[1] : "").replace(/\s+/g, " ").replace(/\bCollector s\b/i, "Collector's").trim();
  if (!edition && item.alt) { // the other database's name for it, when this one's says nothing
    const a = String(item.alt), la = /^(?:a |an |the )?((?:walt disney(?:'?s| s)?|disney(?:'?s| s)?|pixar'?s?|dreamworks'?|warner bros\.?|universal) (?:masterpiece(?: collection)?|classics?|signature collection|gold collection|platinum edition|diamond edition))\b/i.exec(a);
    const ba = /[([]([^)\]]*\b(?:edition|collection|masterpiece)\b[^)\]]*)[)\]]/i.exec(a);
    edition = (la ? la[1] : ba ? ba[1] : "").replace(/\s+/g, " ").trim();
  }
  if (/disney.*classic/i.test(edition)) edition = "Walt Disney Classics"; // the line's own name ("Walt Disney s Classic")
  else if (/disney.*masterpiece/i.test(edition)) edition = "Walt Disney Masterpiece";
  if (!film || !film.imdbId) return { ...none, product: name, others, error: "Found the barcode (“" + name.slice(0, 90) + "”) but couldn't match it to a film. Search by title below." };
  return {
    found: true, upc, source: "upcitemdb", product: name, pictures: pictures(item.images), others,
    // the tape writes the number as digits ("101 Dalmatians") where the film's title spells it out: the shelf uses the tape's
    alt: item.alt || undefined, // the other database's name for it
    shelfTitle: (() => { const d = digitTitle(film.title); return d && caseShows(both, d) ? d : undefined; })(),
    imdbId: film.imdbId, title: film.title || title, year: film.year || (y ? +y[1] : null),
    format, edition, steelbook: /steel ?book/i.test(name), criterion: /criterion/i.test(name), hdr: [],
  };
}

// The barcode finds that exact release on blu-ray.com (4K and Blu-ray in one search, DVDs in another): its page has
// the IMDb id, the format (in its address), the edition ("Dune 4K Blu-ray (Best Buy Exclusive SteelBook)") and the HDR.
// VHS tapes aren't on blu-ray.com: those (and anything else it doesn't have) go to UPCitemdb (upcItem).
async function barcodeRoute(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const upc = (url.searchParams.get("upc") || "").replace(/\D/g, "");
  if (!validBarcode(upc)) return h.json({ error: "That doesn't look like a barcode. Check the numbers under it." }, 400, cors);
  try {
    let hits = await blurayFind(upc, "all");
    if (!hits.length) hits = await blurayFind(upc, "dvdmovies");
    if (!hits.length) return h.json(await upcItem(env, upc), 200, cors);
    const page = await bluray(hits[0].url);
    const imdb = /imdb\.com\/title\/(tt\d+)/.exec(page);
    const head = (/<title>([\s\S]*?)<\/title>/.exec(page) || [])[1] || "";
    const name = head.replace(/\s+/g, " ").trim().replace(/&amp;/g, "&").replace(/&#0?39;/g, "'");
    // "Title 4K Blu-ray (Edition)" / "Title Blu-ray (Edition)" / "Title DVD (Edition)"
    const m = /^(.*?)\s+(4K Blu-ray|Blu-ray|DVD)(?:\s+\((.*)\))?$/.exec(name) || [];
    const format = /-4K-Blu-ray\//.test(hits[0].url) ? "4k" : /\/dvd\//.test(hits[0].url) ? "dvd" : "bluray";
    // the edition, minus what the case and the page say anyway ("4K Ultra HD + Blu-ray", "Blu-ray + Digital Copy")
    const edition = String(m[3] || "").split(/\s*\+\s*/).filter((p) => !/^(4K Ultra HD|Blu-ray|Blu-ray 3D|DVD|Digital( Copy| Code| HD)?|UltraViolet)$/i.test(p)).join(" + ");
    const year = (/\((\d{4})\)/.exec(hits[0].name) || [])[1];
    // a page without an IMDb link (older DVDs, mostly): TMDB finds the film by its title and year
    let imdbId = imdb ? imdb[1] : "";
    if (!imdbId && (m[1] || hits[0].name)) {
      try {
        const t = await tmdbFilm(env, { title: (m[1] || hits[0].name).replace(/\s*\(\d{4}\)\s*$/, ""), year: year ? +year : null });
        if (t && t.imdbId) imdbId = t.imdbId;
      } catch (e) { /* no IMDb id: the dialog says so */ }
    }
    return h.json({
      found: true,
      upc,
      imdbId,
      title: m[1] || hits[0].name,
      year: year ? +year : null,
      format,
      edition,
      steelbook: /steel ?book/i.test(name),
      // the studio under the title ("studioid=70">Criterion</a>), else the name
      criterion: /criterion/i.test(name) || /studioid=\d+"[^>]*>Criterion</.test(page),
      hdr: format === "4k" ? hdrFromPage(page) : [],
      url: hits[0].url,
    }, 200, cors);
  } catch (e) {
    return h.json({ found: false, upc, error: e.message }, 200, cors);
  }
}
