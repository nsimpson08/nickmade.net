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
//                                    imdbId, title, year, format, edition, steelbook, criterion, hdr, upc }
//   POST   /library                  (admin) { imdbId, format: "4k"|"bluray"|"dvd"|"vhs", edition?, steelbook?, threeD?,
//                                    criterion?, features?, hdr? } -> adds a disc (same shape as discs.js) and returns it
//                                    (features: "On this disc", from an edition picked in the dialog or typed, one per line;
//                                    hdr: the dialog's HDR ticks, 4K only)
//   DELETE /library/:id              (admin) a site-added disc is deleted; a discs.js one is hidden
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
  let imdb = (url.searchParams.get("imdb") || "").trim();
  const title = (url.searchParams.get("title") || "").trim().slice(0, 120), year = parseInt(url.searchParams.get("year"), 10) || null;
  if (!/^tt\d{5,10}$/.test(imdb) && !title) return h.json({ error: "Expected an IMDb id or a title." }, 400, cors);
  const cache = caches.default, key = new Request("https://film.nickmade.net/v3/" + (imdb || encodeURIComponent(title.toLowerCase() + "|" + (year || ""))));
  const hit = await cache.match(key);
  if (hit) return h.json(await hit.json(), 200, cors);
  try {
    if (!/^tt\d{5,10}$/.test(imdb)) {
      const res = await fetch("https://v3.sg.media-imdb.com/suggestion/x/" + encodeURIComponent(title.toLowerCase().slice(0, 60)) + ".json");
      const found = ((await res.json()).d || []).filter((r) => /^tt\d+$/.test(r.id) && /^(movie|tvMovie|video|tvSeries|tvMiniSeries)$/.test(r.qid));
      const same = (r) => plain(r.l) === plain(title);
      const pick = found.find((r) => same(r) && (!year || Math.abs((r.y || 0) - year) <= 1)) || found.find(same) || found[0];
      if (!pick) return h.json({ error: "Couldn't find it on IMDb." }, 404, cors);
      imdb = pick.id;
    }
    const [facts, wiki, extra] = await Promise.all([imdbTitle(imdb), wikipedia(imdb).catch(() => null), tmdbExtras(imdb, env).catch(() => ({}))]);
    const body = {
      imdbId: imdb, title: facts.title, year: facts.year, minutes: facts.minutes, rated: facts.rated, genres: facts.genres,
      tagline: extra.tagline || "", trailer: extra.trailer || "",
      director: facts.director, starring: facts.starring, about: wiki ? wiki.text : "", aboutUrl: wiki ? wiki.url : "",
    };
    await cache.put(key, new Response(JSON.stringify(body), { headers: { "Cache-Control": "max-age=2592000" } }));
    return h.json(body, 200, cors);
  } catch (e) {
    return h.json({ error: String(e.message || e) }, 502, cors);
  }
}

// From TMDB: the film's tagline ("The Dead Are Alive.") and its official trailer's YouTube id (the cases' Trailer
// button plays it in YouTube's embedded player): an official English "Trailer" first, else any trailer, else a teaser
async function tmdbExtras(imdbId, env) {
  if (!env.TMDB_API_KEY) return {};
  const api = (path) => fetch("https://api.themoviedb.org/3" + path + (path.includes("?") ? "&" : "?") + "api_key=" + env.TMDB_API_KEY)
    .then((r) => (r.ok ? r.json() : {}));
  const found = await api("/find/" + imdbId + "?external_source=imdb_id");
  const movie = found.movie_results && found.movie_results[0], show = found.tv_results && found.tv_results[0];
  if (!movie && !show) return {};
  const d = await api((movie ? "/movie/" + movie.id : "/tv/" + show.id) + "?append_to_response=videos");
  const vids = ((d.videos && d.videos.results) || []).filter((v) => v.site === "YouTube" && /^[\w-]{11}$/.test(v.key));
  const rank = (v) => (v.type === "Trailer" ? 0 : v.type === "Teaser" ? 2 : 4) + (v.official ? 0 : 1) + (v.iso_639_1 === "en" ? 0 : 0.5);
  const best = vids.filter((v) => v.type === "Trailer" || v.type === "Teaser").sort((a, b) => rank(a) - rank(b) || String(a.published_at).localeCompare(String(b.published_at)))[0];
  return { tagline: String(d.tagline || "").trim(), trailer: best ? best.key : "" };
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

  let t;
  try { t = await imdbTitle(imdbId); } catch (e) { return h.json({ error: "Couldn't get that title from IMDb. Try again in a bit." }, 502, cors); }
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
    // IMDb posters resize on the fly; 400px wide like the imported covers
    cover: t.image ? t.image.replace(/\._V1_.*\.jpg$/, "._V1_UX400_.jpg").replace(/(@)\.jpg$/, "$1._V1_UX400_.jpg") : "",
    logo, // the spine's colour is measured from the cover in the browser (library.js), since a Worker can't decode images
    site: true,
  };
  while (items.some((x) => x.id === d.id)) d.id += "-2";
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
    return h.json({ removed: id }, 200, cors);
  }
  const hidden = await list(env, HIDDEN); // a discs.js disc: hide it for everyone
  if (!hidden.includes(id)) hidden.push(id);
  await env.QUEUE.put(HIDDEN, JSON.stringify(hidden));
  return h.json({ hidden: id }, 200, cors);
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
    if (text.trim() !== "Error42") return text;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error("blu-ray.com is busy");
}

// [{ name, url }] from blu-ray.com's quick search (the 4K section; its results include Blu-rays too)
async function blurayFind(keyword, section) {
  const body = await bluray("https://www.blu-ray.com/search/quicksearch.php",
    { section: section || "4kbluraymovies", userid: "-1", country: "US", keyword });
  const names = [...body.matchAll(/id="match\d+">[\s\S]*?&nbsp;([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  const urls = [...body.matchAll(/'(https:\/\/www\.blu-ray\.com\/movies\/[^']+)'/g)].map((m) => m[1]);
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
// The barcode finds that exact release on blu-ray.com (4K and Blu-ray in one search, DVDs in another): its page has
// the IMDb id, the format (in its address), the edition ("Dune 4K Blu-ray (Best Buy Exclusive SteelBook)") and the HDR.
// VHS tapes aren't on blu-ray.com: those are searched by title.
async function barcodeRoute(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const upc = (url.searchParams.get("upc") || "").replace(/\D/g, "");
  if (!validBarcode(upc)) return h.json({ error: "That doesn't look like a barcode. Check the numbers under it." }, 400, cors);
  try {
    let hits = await blurayFind(upc, "all");
    if (!hits.length) hits = await blurayFind(upc, "dvdmovies");
    if (!hits.length) return h.json({ found: false, upc }, 200, cors);
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
    return h.json({
      found: true,
      upc,
      imdbId: imdb ? imdb[1] : "",
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
