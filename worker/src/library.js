// Movies > Library: discs Nick adds on the site in owner mode, on top of the ones in movies/library/discs.js (the
// one-time import from his My Movies app export, 2026-10-03; tools/discs.py). New discs are only added here now.
//
//   GET    /library                  { items: [discs added on the site], hidden: [ids of discs.js discs removed on the site] }
//   GET    /library/search?q=        (admin) IMDb title search for the add dialog: films and TV series
//   GET    /library/editions?imdbId= (admin) that film's disc editions on TheDiscDb (community, free, no key), each with
//                                    its extras: { editions: [{ title, year, upc, format, features }] }
//   POST   /library                  (admin) { imdbId, format: "4k"|"bluray"|"dvd", edition?, steelbook?, threeD?,
//                                    criterion?, features? } -> adds a disc (same shape as discs.js) and returns it
//                                    (features: "On this disc", from an edition picked in the dialog or typed, one per line)
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
const FORMATS = ["4k", "bluray", "dvd"];
const SEARCH_TYPES = new Set(["movie", "tvMovie", "video", "tvSeries", "tvMiniSeries", "tvSpecial"]);
const UA = "nickmade.net library (https://nickmade.net)";
const BLURB_MAX = 600;

export async function libraryRoute(request, url, env, cors, h) {
  if (url.pathname === "/library" && request.method === "GET") {
    return h.json({ items: await list(env, ITEMS), hidden: await list(env, HIDDEN) }, 200, cors);
  }
  if (url.pathname === "/library/search" && request.method === "GET") return search(request, url, env, cors, h);
  if (url.pathname === "/library/editions" && request.method === "GET") return editions(request, url, env, cors, h);
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
  if (!FORMATS.includes(format)) return h.json({ error: "Pick 4K, Blu-ray, or DVD." }, 400, cors);
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
