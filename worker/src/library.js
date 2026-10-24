// Movies > Library: discs Nick adds on the site in owner mode, on top of the ones in movies/library/discs.js (the
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
//   POST   /library                  (admin) { imdbId, format: "4k"|"bluray"|"dvd"|"vhs", edition?, steelbook?, threeD?,
//                                    criterion?, features?, hdr? } -> adds a disc (same shape as discs.js) and returns it
//                                    (features: "On this disc", from an edition picked in the dialog or typed, one per line;
//                                    hdr: the dialog's HDR ticks, 4K only; cover: the picture picked in the dialog: a TMDB
//                                    poster is kept as its address, anything else (a seller's photo) is copied into the
//                                    photos bucket under covers/ so it can't disappear)
//   DELETE /library/:id              (admin) a site-added disc is deleted (with its copied cover); a discs.js one is hidden
//
// A new disc's facts (title, year, runtime, rating, genres, director, cast, studio, poster) come from IMDb, like the
// rest of the site's lookups. Its blurb is the film's Wikipedia summary (free to reuse with credit; the page links
// it), found through Wikidata's IMDb id property, not IMDb's own plot text. Its spine logo comes from TMDB (tmdbLogo).
//
// Storage (the QUEUE namespace): library         JSON array of site-added discs, newest first
//                                library:hidden  JSON array of discs.js ids removed on the site

const ITEMS = "library";
const HIDDEN = "library:hidden";
const FORMATS = ["4k", "bluray", "dvd", "vhs"];
const HDR_KINDS = ["dv", "hdr10+", "hdr10"];
const SEARCH_TYPES = new Set(["movie", "tvMovie", "video", "tvSeries", "tvMiniSeries", "tvSpecial"]);
const UA = "nickmade.net library (https://nickmade.net)";
const BLURB_MAX = 600;

export async function libraryRoute(request, url, env, cors, h) {
  if (url.pathname === "/library" && request.method === "GET") {
    return h.json({ items: await list(env, ITEMS), hidden: await list(env, HIDDEN) }, 200, cors);
  }
  if (url.pathname === "/library/search" && request.method === "GET") return search(request, url, env, cors, h);
  if (url.pathname === "/library/editions" && request.method === "GET") return editions(request, url, env, cors, h);
  if (url.pathname === "/library/hdr" && request.method === "GET") return hdrRoute(request, url, env, cors, h);
  if (url.pathname === "/library/barcode" && request.method === "GET") return barcodeRoute(request, url, env, cors, h);
  if (url.pathname === "/library/stills" && request.method === "GET") return stillsRoute(request, url, env, cors, h);
  if (url.pathname === "/library/covers" && request.method === "GET") return coversRoute(request, url, env, cors, h);
  if (url.pathname === "/library/film" && request.method === "GET") return filmRoute(request, url, env, cors, h);
  if (url.pathname === "/library" && request.method === "POST") return add(request, env, cors, h);
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
  return { text: trimBlurb(sum.extract), url: sum.content_urls && sum.content_urls.desktop ? sum.content_urls.desktop.page : "" };
}

// Wikipedia leads run long: whole sentences up to about BLURB_MAX characters
function trimBlurb(text) {
  if (text.length <= BLURB_MAX) return text;
  const cut = text.slice(0, BLURB_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 150 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "\u2026";
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
  const d = {
    id: discId(t.title, t.year, format),
    title: t.title,
    sort: sortTitle(t.title),
    year: t.year,
    format,
    edition,
    kind: t.series ? "tv" : "movie",
    minutes: t.minutes,
    rated: t.rated,
    genres: t.genres,
    director: t.director,
    starring: t.starring,
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
