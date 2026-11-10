// Library (Ver 1.7): Nick's vinyl, books and board games, each on its own kind of shelf. One script for all
// three; the page says which (data-kind on this script tag):
//   vinyl  every album's full cover in one grid, the first of each letter with a record-store divider tab; pointed
//          at, the record slides partway out of its sleeve
//   books  their covers (Nick, 2026-10-25: the spines view is gone)
//   games  boxes on shelves
// Click anything for its details. Owner mode (?admin, the site's one password) adds an Add button: scan the barcode
// (records) or ISBN (books) with the camera, type it, or search; pick the right one and it's looked up and shelved.
// The Worker keeps the lists and does the lookups (worker/src/collections.js: MusicBrainz, Open Library, BoardGameGeek).
(function () {
  "use strict";
  var me = document.currentScript;
  var KIND = me.dataset.kind;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local && me.dataset.apiLocal) || me.dataset.api;
  var root = document.getElementById("collection");
  if (!root || !API) return;

  var CFG = {
    vinyl: {
      noun: "record", plural: "records", look: "sleeves", scan: true, add: "Add a record",
      scanHint: "Point it at the barcode on the back of the sleeve.", search: "Artist, album or a Discogs link",
      sorts: [["creator", "Artist"], ["title", "Album"], ["year", "Year"]], // (no "Newest": Nick, 2026-10-29)
      edition: "Pressing (optional)", editionHint: "e.g. Red vinyl, 2016 reissue", source: "MusicBrainz", // (a record from Discogs: "Discogs", sourceName)
      empty: "No records in the crates yet.",
    },
    books: {
      noun: "book", plural: "books", look: "covers", scan: true, add: "Add a book",
      scanHint: "Point it at the ISBN barcode on the back cover.", search: "Title or author",
      sorts: [["creator", "Author"], ["title", "Title"], ["year", "Year"], ["added", "Newest"]],
      edition: "Edition (optional)", editionHint: "e.g. Signed first edition", source: "Open Library",
      empty: "No books on the shelf yet.",
    },
    games: {
      noun: "game", plural: "games", counted: ["board game", "board games"], look: "stack", scan: false, add: "Add a game",
      search: "Game name", sorts: [["title", "Name"], ["players", "Players"], ["time", "Play time"], ["best", "Best with"], ["rating", "Rating"], ["rank", "BGG Rank"], ["year", "Year"], ["added", "Newest"]],
      edition: "Edition (optional)", editionHint: "e.g. 2nd edition, with Seafarers", source: "BoardGameGeek",
      empty: "No games on the shelf yet.",
    },
  }[KIND];
  if (!CFG) return;

  var ADMIN = null;
  var params = new URLSearchParams(location.search);
  try {
    if (params.has("logout")) localStorage.removeItem("nm-admin-token");
    ADMIN = localStorage.getItem("nm-admin-token");
  } catch (e) {}
  function countUp(el) {
    var to = +el.textContent, still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || to < 2 || el.dataset.done) return;
    el.dataset.done = "1";
    var t0 = 0, dur = Math.min(1100, 400 + to * 4);
    function step(t) { t0 = t0 || t; var k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); }
    el.textContent = "0"; requestAnimationFrame(step);
  }
  function authHeaders(h) { h = h || {}; if (ADMIN) h.Authorization = "Bearer " + ADMIN; return h; }
  // A Worker request that may need Discogs (search, barcode, fronts/backs, add, colour read). Discogs turns Cloudflare's
  // shared addresses away ("too many"), so the Worker answers { needDiscogs: path }: this page fetches that from Discogs
  // itself (Nick's own address; Discogs allows it from a browser), hands it to the Worker (POST /collection/discogs,
  // kept a week) and asks again, as many times as the request needs (a record's backs look at up to 8 pressings).
  function dgFetch(url, opts, n) {
    n = n || 0;
    return fetch(url, opts).then(function (r) {
      if (r.status !== 503 || n >= 14) return r;
      return r.clone().json().catch(function () { return {}; }).then(function (j) {
        if (!j || !/^\//.test(j.needDiscogs || "")) return r;
        return fetch("https://api.discogs.com" + j.needDiscogs).then(function (d) { if (!d.ok) throw new Error("Discogs " + d.status); return d.json(); })
          .then(function (data) {
            return fetch(API + "/collection/discogs", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ path: j.needDiscogs, data: data }) });
          })
          .then(function () { return dgFetch(url, opts, n + 1); }, function () { return r; });
      });
    });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function norm(t) { return String(t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim(); }
  function sortKey(t) { return norm(t).replace(/^(the|a|an) /, ""); }

  var items = [], sortBy = CFG.sorts[0][0], query = "", shelf = "";
  var F = { pFrom: 0, pTo: 0, bestWith: 0, rating: 0, pick: 0, unopened: 0 }; // the games' filters (0 = any)
  var RATINGS = [8, 7.5, 7, 6.5, 6]; // BGG's average rating out of 10: "8+" and down
  function countOpts(none) { return '<option value="0">' + none + "</option>" + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '">' + n + (n === 8 ? "+" : "") + "</option>"; }).join(""); }

  // ---------- the page ----------
  root.innerHTML =
    '<div class="coll-bar">' +
      '<input class="coll-search" type="search" placeholder="Search ' + esc(CFG.plural) + '" aria-label="Search ' + esc(CFG.plural) + '">' +
      '<label class="coll-sort">Sort <select>' + CFG.sorts.map(function (s) { return '<option value="' + s[0] + '">' + s[1] + "</option>"; }).join("") + "</select></label>" +
      // games: hide the name and numbers under every box, just the boxes on the shelves (Nick, 2026-10-29)
      // books: the same, for the title and author under each cover (Nick, 2026-11-04)
      (KIND === "games" || KIND === "books" ? '<button type="button" class="coll-sort coll-caps" aria-pressed="true" title="' + (KIND === "books" ? "Show or hide the title and author under each book" : "Show or hide the names and numbers under each game") + '">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="2" rx="1"/><rect x="2" y="7" width="12" height="2" rx="1"/><rect x="2" y="11" width="8" height="2" rx="1"/></svg>Details</button>' : "") +
      // books: Nick's Picks only (Nick, 2026-11-04), shown once a book is one
      (KIND === "books" ? '<button type="button" class="coll-sort coll-caps coll-pick-f coll-book-pick" aria-pressed="false" hidden><span class="star" aria-hidden="true">★</span>Nick’s Picks</button>' : "") +
      '<button type="button" class="pill-btn coll-add-btn" hidden><span aria-hidden="true">+</span> ' + esc(CFG.add) + "</button>" +
    "</div>" +
    // games: filters that all apply at once (Nick, 2026-10-29: "2-5 players, but best for 2, with low complexity, and the
    // highest BGG rank"): Players from–to (playable with every count in it), Best with (BGG voters' best count),
    // Rating (its average, "7.0+"), with how many match and a Clear. Complexity shows only on the opened card
    // (Nick, 2026-10-30)
    (KIND === "games" ? '<div class="coll-bar coll-filters">' +
      '<span class="coll-sort coll-players">Players <select data-f="pFrom" aria-label="Players from">' + countOpts("Any") + "</select>" +
        '<span class="to">to</span><select data-f="pTo" aria-label="Players to">' + countOpts("–") + "</select></span>" +
      '<label class="coll-sort coll-best">Best with <select data-f="bestWith">' + countOpts("Any") + "</select></label>" +
      '<label class="coll-sort coll-rating">Rating <select data-f="rating"><option value="0">Any</option>' + RATINGS.map(function (r) { return '<option value="' + r + '">' + r.toFixed(1) + "+</option>"; }).join("") + "</select></label>" +
      // Nick's Picks only (Nick, 2026-10-29), shown once a game is one
      '<button type="button" class="coll-sort coll-caps coll-pick-f" aria-pressed="false" hidden><span class="star" aria-hidden="true">★</span>Nick’s Picks</button>' +
      // Unopened: owner only (the public list doesn't carry the mark), shown once a game has it
      '<button type="button" class="coll-sort coll-caps coll-unopened-f" aria-pressed="false" hidden><span class="seal" aria-hidden="true">✦</span>Unopened</button>' +
      '<span class="coll-match" hidden><span class="n"></span> <button type="button" class="coll-clear">Clear</button></span>' +
    "</div>" : "") +
    (KIND === "vinyl" ? '<div class="lib-aisles coll-genres" role="group" aria-label="Genre" hidden></div>' : "") +
    '<div class="coll-shelves coll-' + CFG.look + '"></div>';
  var shelves = root.querySelector(".coll-shelves");
  var countEl = document.getElementById("coll-count");
  root.querySelector(".coll-search").addEventListener("input", function (e) { query = norm(e.target.value); render(); });
  root.querySelector(".coll-bar:not(.coll-filters) .coll-sort select").addEventListener("change", function (e) { sortBy = e.target.value; render(); });
  var genresEl = root.querySelector(".coll-genres");
  // (the shelf that's picked, tapped again, goes back to All: Nick, 2026-11-02)
  if (genresEl) genresEl.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { shelf = b.dataset.g === shelf ? "" : b.dataset.g; render(); } });
  var capsBtn = root.querySelector(".coll-caps:not(.coll-pick-f)");
  var bookPickF = root.querySelector(".coll-book-pick");
  if (bookPickF) bookPickF.addEventListener("click", function () { F.pick = F.pick ? 0 : 1; bookPickF.setAttribute("aria-pressed", String(!!F.pick)); render(); });
  if (capsBtn) {
    var caps = true, capsKey = KIND === "games" ? "nm-coll-caps" : "nm-coll-caps-" + KIND; // (each library its own)
    try { caps = localStorage.getItem(capsKey) !== "off"; } catch (e) {} // remembered per visitor
    var setCaps = function () { capsBtn.setAttribute("aria-pressed", String(caps)); shelves.classList.toggle("no-caps", !caps); };
    setCaps();
    capsBtn.addEventListener("click", function () { caps = !caps; setCaps(); try { localStorage.setItem(capsKey, caps ? "on" : "off"); } catch (e) {} });
  }
  var filtersEl = root.querySelector(".coll-filters");
  if (filtersEl) {
    filtersEl.addEventListener("change", function (e) {
      var f = e.target.dataset.f;
      if (!f) return;
      F[f] = +e.target.value;
      // a "to" below the "from" moves up with it
      if (F.pFrom && F.pTo && F.pTo < F.pFrom) { F.pTo = F.pFrom; filtersEl.querySelector('[data-f="pTo"]').value = String(F.pTo); }
      render();
    });
    var pickF = filtersEl.querySelector(".coll-pick-f");
    pickF.addEventListener("click", function () { F.pick = F.pick ? 0 : 1; pickF.setAttribute("aria-pressed", String(!!F.pick)); render(); });
    var unF = filtersEl.querySelector(".coll-unopened-f");
    unF.addEventListener("click", function () { F.unopened = F.unopened ? 0 : 1; unF.setAttribute("aria-pressed", String(!!F.unopened)); render(); });
    filtersEl.querySelector(".coll-clear").addEventListener("click", function () {
      Object.keys(F).forEach(function (k) { F[k] = 0; });
      pickF.setAttribute("aria-pressed", "false"); unF.setAttribute("aria-pressed", "false");
      filtersEl.querySelectorAll("select").forEach(function (s) { s.value = "0"; });
      render();
    });
  }
  function filtering() { return F.pFrom || F.pTo || F.bestWith || F.rating || F.pick || F.unopened; }

  function shown() {
    var list = items.filter(function (d) { return !query || norm([d.title, d.creator, genresOf(d).join(" "), (d.genre || []).join(" "), (d.mechanics || []).join(" "), d.label, d.publisher, d.edition].join(" ")).indexOf(query) >= 0; });
    if (shelf) list = list.filter(function (d) { return shelf === "picks" ? d.pick : shelvesOf(d).indexOf(shelf) >= 0; });
    // games playable with every count from..to (just "from": that many; 8 = 8 or more); a game with no counts stays
    // out once a number is picked. Best with: BGG voters' best count includes it.
    var lo = F.pFrom || F.pTo, hi = F.pTo || F.pFrom;
    if (lo) list = list.filter(function (d) { var r = playerRange(d); return r && r[0] <= lo && r[1] >= hi; });
    if (F.bestWith) list = list.filter(function (d) { var b = bestOf(d); return F.bestWith === 8 ? b.some(function (n) { return n >= 8; }) : b.indexOf(F.bestWith) >= 0; });
    if (F.pick) list = list.filter(function (d) { return d.pick; });
    if (F.unopened) list = list.filter(function (d) { return d.unopened; });
    if (F.rating) list = list.filter(function (d) { return d.rating && d.rating >= F.rating; });
    // numbers sort as fixed-width text; unknowns last; ratings highest first
    function num(n, down) { return n == null ? "~" : ("0000000" + Math.round((down ? 100000 - n * 100 : n * 100))).slice(-7); }
    var key = { creator: function (d) { return sortKey(d.creator) + " " + (d.year || 0) + " " + sortKey(d.title); },
      title: function (d) { return sortKey(d.title); }, year: function (d) { return String(d.year || 0) + sortKey(d.title); },
      players: function (d) { var r = playerRange(d); return (r ? num(r[0]) + num(r[1]) : "~") + sortKey(d.title); },
      time: function (d) { return num(d.minTime) + sortKey(d.title); },
      rating: function (d) { return num(d.rating, true) + sortKey(d.title); },
      best: function (d) { var b = bestOf(d); return (b.length ? num(b[0]) + num(b[b.length - 1]) : "~") + sortKey(d.title); },
      rank: function (d) { return num(d.rank) + sortKey(d.title); }, // BGG's Board Game Rank, #1 first; unranked last
      added: function (d) { return d.added || ""; } }[sortBy];
    list.sort(function (a, b) { var x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
    if (sortBy === "added") list.reverse();
    return list;
  }
  function render() {
    if (ADMIN && items.length) setTimeout(makeThumbs, 400); // (a cover just changed or added gets its small copy)
    var list = shown();
    // the count: a big number with its word under the page's title (Nick, 2026-10-30), counting up the first time
    if (countEl) {
      if (!items.length) countEl.innerHTML = "";
      else if (countEl.dataset.n !== String(items.length)) { countEl.dataset.n = items.length; countEl.innerHTML = '<b class="lib-num">' + items.length + '</b><span class="lib-noun">' + esc((CFG.counted || [CFG.noun, CFG.plural])[items.length === 1 ? 0 : 1]) + "</span>"; countUp(countEl.querySelector(".lib-num")); }
    }
    if (!items.length) { shelves.className = "coll-shelves coll-" + CFG.look; shelves.innerHTML = '<p class="coll-empty">' + esc(CFG.empty) + (ADMIN ? " Add your first with the button above." : "") + "</p>"; return; }
    if (genresEl) genreButtons();
    if (bookPickF) {
      var anyBookPick = items.some(function (d) { return d.pick; });
      bookPickF.hidden = !anyBookPick;
      if (!anyBookPick && F.pick) { F.pick = 0; bookPickF.setAttribute("aria-pressed", "false"); return render(); }
    }
    if (filtersEl) {
      var anyPick = items.some(function (d) { return d.pick; });
      filtersEl.querySelector(".coll-pick-f").hidden = !anyPick;
      if (!anyPick && F.pick) { F.pick = 0; filtersEl.querySelector(".coll-pick-f").setAttribute("aria-pressed", "false"); return render(); }
      var anyNew = ADMIN && items.some(function (d) { return d.unopened; });
      filtersEl.querySelector(".coll-unopened-f").hidden = !anyNew;
      if (!anyNew && F.unopened) { F.unopened = 0; filtersEl.querySelector(".coll-unopened-f").setAttribute("aria-pressed", "false"); return render(); }
      var m = filtersEl.querySelector(".coll-match");
      m.hidden = !filtering();
      m.querySelector(".n").textContent = list.length + (list.length === 1 ? " game matches" : " games match");
    }
    if (!list.length) { shelves.innerHTML = '<p class="coll-empty">Nothing matches that.</p>'; return; }
    var look = CFG.look;
    shelves.className = "coll-shelves coll-" + look + (capsBtn && capsBtn.getAttribute("aria-pressed") === "false" ? " no-caps" : "");
    if (look === "sleeves") shelves.innerHTML = sleeves(list);
    else { shelves.innerHTML = '<div class="coll-row">' + list.map(box).join("") + "</div>"; fitPicks(); }
  }
  // records: MusicBrainz's detailed genres ("cool jazz", "post-britpop", "alternative r&b") grouped into a few broad
  // shelves for the genre buttons; a record can be on several (Purple Rain: Rock, Pop, R&B & Soul). Grouped here, as
  // the page draws, so a change to the groups applies to every record already in the library
  var GENRES = [
    ["Rock", /rock|punk|grunge|metal|indie|alternative(?! r&b)|shoegaze|emo\b|hardcore|britpop|new wave|garage|post-|psychedelic|stoner/],
    ["Pop", /(^|[\s-])pop\b|^pop|k-pop|j-pop/],
    ["R&B & Soul", /r&b|rnb|rhythm and blues|soul|funk|motown|new jack|gospel|doo-wop/],
    ["Hip-Hop", /hip.?hop|\brap\b|trap\b|grime|boom bap|drill/],
    ["Jazz", /jazz|bop\b|swing|big band|bossa nova/],
    ["Blues", /blues(?!.*rhythm)/],
    ["Electronic & Dance", /electro|house|techno|synth|edm|dance|disco|ambient|trance|drum and bass|dubstep|idm|trip hop|downtempo|chillwave|breakbeat/],
    ["Folk & Country", /folk|country|americana|bluegrass|singer-songwriter|roots/],
    ["Reggae", /reggae|\bska\b|\bdub\b|dancehall|rocksteady/],
    ["Latin", /latin|salsa|reggaeton|cumbia|samba|tango|bossa nova|mpb/],
    ["Classical", /classical|baroque|opera|symphon|orchestral|chamber|choral|minimalis/],
    ["Soundtrack", /soundtrack|film score|\bscore\b|musical|show tunes|stage & screen/],
    ["Compilations", /^compilations?$/],
  ];
  // a soundtrack whatever its genres say (Nick, 2026-11-01: Drive's are only electronic and synth-pop): by its title
  var SOUNDTRACK_TITLE = /soundtrack|motion picture|original score|music from (the )?(motion picture|film|movie|series|show)|\bost\b/i;
  // a compilation: a record by "Various" (Discogs' and MusicBrainz's name for many artists), Nick, 2026-11-03: "recognize
  // all the recent "Various" albums ... and mark them as "compilations" which will have it's own filter"
  var VARIOUS = /^(various|various artists|v\.?\s?a\.?)$/i;
  // the record's genres as the card shows them (and the search reads them): a Various record's say "compilation" too
  // (Nick, 2026-11-03: "you aren't automatically adding "compilation" to the recent various albums")
  function genresOf(d) {
    var g = (d.genres || []).slice();
    if (KIND === "vinyl" && VARIOUS.test(String(d.creator || "").trim()) && !g.some(function (x) { return /^compilations?$/i.test(x); })) g.push("compilation");
    return g;
  }
  function shelvesOf(d) {
    var tags = (d.genres || []).map(function (g) { return String(g).toLowerCase(); });
    if (KIND === "vinyl" && SOUNDTRACK_TITLE.test(d.title || "") && tags.indexOf("soundtrack") < 0) tags.push("soundtrack");
    if (KIND === "vinyl" && VARIOUS.test(String(d.creator || "").trim()) && tags.indexOf("compilation") < 0) tags.push("compilation");
    // (not Classical for a pop/folk/rock style that borrows its words: "baroque pop", "chamber folk", "symphonic rock";
    // Nick, 2026-11-03: The Moody Blues and The Mountain Goats were on the Classical shelf)
    return GENRES.filter(function (G) { return tags.some(function (t) { return G[1].test(t) && !(G[0] === "Pop" && /britpop/.test(t)) && !(G[0] === "Classical" && /\b(pop|folk|rock|metal)\b/.test(t)); }); }).map(function (G) { return G[0]; });
  }
  // only the shelves that hold a record, each with its count; hidden until there are at least two
  function genreButtons() {
    var counts = {};
    items.forEach(function (d) { shelvesOf(d).forEach(function (g) { counts[g] = (counts[g] || 0) + 1; }); });
    var names = GENRES.map(function (G) { return G[0]; }).filter(function (g) { return counts[g]; });
    var picks = items.filter(function (d) { return d.pick; }).length; // (Nick's Picks: a shelf of its own once there's one)
    if (shelf && shelf !== "picks" && !counts[shelf]) shelf = "";
    if (shelf === "picks" && !picks) shelf = "";
    genresEl.hidden = names.length < 2 && !picks;
    genresEl.innerHTML = ['<button type="button" data-g="" aria-pressed="' + !shelf + '">All</button>'].concat(
      picks ? ['<button type="button" data-g="picks" class="coll-picks-g" aria-pressed="' + (shelf === "picks") + '"><span class="star" aria-hidden="true">★</span>Nick’s Picks <span class="n">' + picks + "</span></button>"] : [],
      names.map(function (g) {
      return '<button type="button" data-g="' + esc(g) + '" aria-pressed="' + (shelf === g) + '">' + esc(g) + ' <span class="n">' + counts[g] + "</span></button>";
    })).join("");
  }
  function label(d) { return esc(d.title) + (d.creator ? " · " + esc(d.creator) : "") + (d.year ? " (" + d.year + ")" : ""); }
  // A cover's address for the page: through the Worker's /img proxy (Cloudflare keeps it at the edge and the browser
  // for 30 days), so a refresh takes it from the browser's cache.
  // (Open Library's own covers bounce through uncacheable redirects to archive.org: every refresh fetched them again.)
  // A local Worker's copy (http://localhost) as is.
  function pic(src) { return /^https:/.test(src || "") && !direct(src) ? API + "/img?u=" + encodeURIComponent(src) : src; }
  // Discogs' and Apple Music's pictures load straight from them (the /img proxy doesn't carry them; Discogs' images
  // aren't copied), without a referrer, and so without crossorigin (they don't send CORS headers)
  function direct(src) { return /^https:\/\/(i\.discogs\.com|is\d-ssl\.mzstatic\.com)\//.test(src || ""); }
  function imgAttrs(src) { return direct(src) ? ' referrerpolicy="no-referrer"' : ' crossorigin="anonymous"'; }
  // the cover's small copy for the shelves, the poster wall and the Library page (Nick, 2026-10-30: the page was 20 MB):
  // its 400 px thumb while that was made from this cover (worker putThumb), Apple Music's art at 400 px, else the cover
  function small(d) {
    if (d.thumb && d.thumbOf === d.cover) return d.thumb;
    if (/^https:\/\/is\d-ssl\.mzstatic\.com\//.test(d.cover || "")) return d.cover.replace(/\/\d+x\d+[a-z]*\.(jpg|png|webp)$/, "/400x400bb.jpg");
    return d.cover;
  }
  function img(d, cls) {
    // (a cover that won't load becomes a plain sleeve with the title, not a gap)
    var src = small(d);
    return d.cover ? '<img class="' + cls + '" src="' + esc(pic(src)) + '"' + imgAttrs(src) + ' alt="" loading="lazy" decoding="async" onerror="var b=document.createElement(\'span\');b.className=this.className+\' blank\';b.textContent=this.closest(\'[title]\').title.split(\' · \')[0];this.replaceWith(b)">' : "";
  }
  // A coloured record (Nick, 2026-10-29: "Run the Jewels 2 is Teal"): the vinyl's colour from what's known of the
  // pressing (Discogs' "2×12\" Vinyl (Teal)", MusicBrainz's "milky clear", what Nick typed as its pressing), as the
  // disc's colour on the shelf and on its card. Returns '" style="…' with the class (or "" for plain black).
  // Splatter/marble/swirl/"x and y"/"x & y" take a second colour; clear, translucent, smoke and ice are see-through.
  var VINYL_COLOURS = [
    ["black ice", "#3a3f46"], ["coke bottle", "#5f8f6a"], ["milky clear", "#e9ecef"], ["sea glass", "#9fd3c7"], ["glow", "#c8f26b"],
    ["teal", "#1f9e98"], ["turquoise", "#2fc2b8"], ["aqua", "#4fd1d9"], ["cyan", "#33c4e0"], ["mint", "#98e2c6"], ["seafoam", "#8fd6bd"],
    ["navy", "#1f2f6b"], ["cobalt", "#2148b8"], ["royal blue", "#2b4fd0"], ["sky blue", "#7fc4f0"], ["baby blue", "#a8d4f2"], ["light blue", "#8cc8f0"], ["blue", "#2f6fd6"],
    ["forest", "#2f5d3a"], ["olive", "#7b7f35"], ["lime", "#a6d63a"], ["emerald", "#1f8f5a"], ["green", "#2e9e52"],
    ["mustard", "#d1a12b"], ["canary", "#f2d43a"], ["yellow", "#f0cc2e"], ["gold", "#d4aa3c"], ["orange", "#ec7a2b"], ["tangerine", "#f2862e"], ["peach", "#f4b08c"],
    ["maroon", "#6e1a24"], ["burgundy", "#6b1830"], ["oxblood", "#5c1420"], ["crimson", "#b3132e"], ["blood red", "#8f0f17"], ["apple", "#c8232c"], ["red", "#c62a2f"],
    ["hot pink", "#ef4f9b"], ["magenta", "#c8288c"], ["pink", "#f08cb8"], ["rose", "#e88aa8"], ["lavender", "#b9a3e0"], ["violet", "#7d4fc9"], ["purple", "#7a3fb0"], ["grape", "#6b3a9e"],
    ["brown", "#6e4a2e"], ["tan", "#c9a77c"], ["bone", "#e6dcc6"], ["cream", "#efe3c4"], ["beige", "#dccbaa"], ["silver", "#b9bec4"], ["grey", "#8a8f96"], ["gray", "#8a8f96"], ["smoke", "#5e6268"],
    ["white", "#ecebe6"], ["clear", "#dfe7ea"], ["black", "#141414"], // ("galaxy" is a swirl with black, not a colour)
  ];
  // hue (0–360), saturation and lightness (0–1) of a #rrggbb
  function hsl(h) {
    var r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0, hu = 0;
    if (d) hu = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return [(hu + 360) % 360, s, l];
  }
  // the colour read from its photos (Worker POST /collection/vinyl/:id/look) agrees with the one its words name: the
  // same colour word, or close (hue within 40°, or both nearly greyless and of a like lightness)
  function agrees(v, hex, t) {
    if ((v.name || "").toLowerCase().split(/[^a-z]+/).some(function (w) { return w.length > 2 && new RegExp("\\b" + w + "\\b").test(t); })) return true;
    var p = hsl(v.a), q = hsl(hex), dh = Math.abs(p[0] - q[0]); dh = Math.min(dh, 360 - dh);
    return p[1] > 0.2 && q[1] > 0.2 ? dh < 40 : p[1] <= 0.2 && q[1] <= 0.2 && Math.abs(p[2] - q[2]) < 0.3;
  }
  function discLook(d) {
    var w = discWords(d), v = d.vinyl;
    if (!(v && /^#[0-9a-f]{6}$/i.test(v.a || ""))) return w ? w.out : "";
    var pat = { splatter: "splatter", marble: "marble", split: "split", picture: "marble" }[v.pattern] || "";
    // Nick's own colours for his copy (vinyl.mine: from his photo of it) win over the listing's words, which can be another
    // variant's (Clair Obscur's Discogs entry says Black Galaxy & Gold; his is cream with pink swirls; Nick, 2026-11-01)
    if (v.mine) return look(v.a, /^#[0-9a-f]{6}$/i.test(v.b || "") ? v.b : v.a, v.see, pat);
    if (!w) { // its words name no colour: the photos', unless that's ordinary black
      if (!pat && !v.see && hsl(v.a)[2] < 0.15) return "";
      return look(v.a, /^#[0-9a-f]{6}$/i.test(v.b || "") ? v.b : pat ? "#ecebe6" : v.a, v.see, pat);
    }
    if (!agrees(v, w.a, w.t)) return w.out; // (Bubblegum's photos are its black paper labels; its words say Clear)
    // only the photo's true shade, and only of a real colour (a photo makes white or clear look grey); the words alone say
    // whether it's see-through and its pattern (Nick, 2026-10-29: a White record came out see-through and swirled)
    // (and not when the words name two: "Cream & Light Blue" kept its cream, not the photo's blue in its place)
    if (hsl(w.a)[1] <= 0.2 || hsl(v.a)[1] <= 0.2 || w.b !== w.a) return w.out;
    return look(v.a, w.b !== w.a ? w.b : /^#[0-9a-f]{6}$/i.test(v.b || "") ? v.b : w.b, w.see, w.mix);
  }
  function look(a, b, see, mix) { return " colored" + (see ? " see" : "") + (mix ? " " + mix : "") + '" style="--vc:' + a + ";--vc2:" + b; }
  function discWords(d) {
    var t = (" " + [d.format, d.variant, d.edition].join(" ") + " ").toLowerCase().replace(/[(),/]/g, " ");
    var found = [];
    VINYL_COLOURS.forEach(function (c) {
      var m = new RegExp("\\s" + c[0] + "(?![a-z])").exec(t), at = m ? m.index : -1; // (a whole word: not "tan" in "tangerine")
      if (at >= 0 && !found.some(function (f) { return f.name.indexOf(c[0]) >= 0; })) found.push({ name: c[0], hex: c[1], at: at });
    });
    if (!found.length || (found.length === 1 && found[0].name === "black" && !/galaxy|splatter|marble|swirl/.test(t))) return null;
    found.sort(function (a, b) { return a.at - b.at; });
    var see = /clear|translucent|transparent|smoke|ice|glass|coke bottle/.test(t);
    var mix = /splatter|speckle|marble|swirl|galaxy|haze|smoke/.test(t) ? (/splatter|speckle/.test(t) ? "splatter" : "marble") : found.length > 1 && /\b(and|&|with|w)\b|half/.test(t) ? "split" : "";
    // (splatter: its flecks are the colour named last, "Green w/ Ultra Clear + White Splatter" -> white)
    var a = found[0].hex, b = (found.length > 1 ? found[mix === "splatter" ? found.length - 1 : 1].hex : "") || (/black|galaxy/.test(t) ? "#141414" : mix ? "#ecebe6" : a);
    return { a: a, b: b, see: see, mix: mix, t: t, out: look(a, b, see, mix) };
  }
  // records: every cover whole, in one grid; the first record of each letter (or decade) carries a divider tab above
  // it, like the bins in a record store; the record itself sits behind the sleeve and slides out when pointed at
  function dividerOf(d) {
    if (sortBy === "year") return d.year ? Math.floor(d.year / 10) * 10 + "s" : "?";
    if (sortBy === "added") return "";
    var c = (sortBy === "title" ? sortKey(d.title) : sortKey(d.creator || d.title)).charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }
  function sleeves(list) {
    var html = "", last = null;
    list.forEach(function (d) {
      var k = dividerOf(d);
      var tab = k && k !== last ? '<span class="bin-tab" aria-hidden="true">' + esc(k) + "</span>" : "";
      last = k;
      // (a Nick's Pick: the ribbon across the sleeve's corner, as on the board games)
      var rib = d.pick ? '<span class="pick-frame rec-pick" aria-hidden="true"><span class="sticker pick">Nick’s Pick</span></span>' : "";
      var rec = '<button type="button" class="coll-item record' + (tab ? " first" : "") + (d.pick ? " picked" : "") + '" data-id="' + esc(d.id) + '" title="' + label(d) + (d.pick ? " · Nick’s Pick" : "") + '" aria-label="' + label(d) + (d.pick ? " · Nick’s Pick" : "") + '">' + tab + rib +
        '<span class="disc' + discLook(d) + '" aria-hidden="true"></span>' +
        (d.cover ? img(d, "sleeve") : '<span class="sleeve blank">' + esc(d.title) + "</span>") +
        '<span class="record-cap"><b>' + esc(d.title) + "</b>" + esc(d.creator || "") + "</span></button>";
      // under it, its ▶: onto the turntable at the top (Nick, 2026-11-02); a slot holds both (a button can't hold a button)
      html += '<div class="rec-slot">' + rec +
        ((d.spotify === undefined || spotifyOf(d)) && !d.spotifyOff ? '<button type="button" class="shelf-play" data-id="' + esc(d.id) + '" aria-label="Play ' + esc(d.title) + ' on the turntable">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>Play</button>' : "") + "</div>";
    });
    return '<div class="coll-row">' + html + "</div>";
  }
  // book covers and board game boxes; a game's players and play time under its box
  function box(d) {
    var cls = KIND === "games" ? "game-box" : "book-cover";
    var pick = (KIND === "games" || KIND === "books") && d.pick;
    return '<button type="button" class="coll-item ' + cls + (pick ? " picked" : "") + '" data-id="' + esc(d.id) + '" title="' + label(d) + (pick ? " · Nick’s Pick" : "") + '" aria-label="' + label(d) + (pick ? " · Nick’s Pick" : "") + '">' +
      (d.cover ? img(d, "art") : '<span class="art blank">' + esc(d.title) + "</span>") +
      // Nick's Pick: the disc library's ribbon across the box's top left corner; the frame is fitted to the box art
      // as drawn (fitPicks: the art is contained in a square, so a tall or wide box leaves room around it)
      (pick ? '<span class="pick-frame" aria-hidden="true"><span class="sticker pick">Nick’s Pick</span></span>' : "") +
      // a game's name under its box (Nick, 2026-10-29), with its BGG rank (or best player count) in front when sorted by it
      (KIND === "games" ? '<span class="game-title">' + (sortBy === "rank" && d.rank ? '<b>#' + d.rank.toLocaleString("en-US") + "</b> " : sortBy === "best" && d.best ? "<b>Best " + esc(d.best) + "</b> " : "") + esc(d.title) + "</span>" + gameCap(d) : "") +
      // a book's title and author under its cover, as under the records (Nick, 2026-11-04)
      (KIND === "books" ? '<span class="book-cap"><b>' + esc(d.title) + "</b><span>" + esc(String(d.creator || "").split(",")[0]) + "</span></span>" : "") + "</button>";
  }
  // each Nick's Pick ribbon's frame over the box art as drawn: object-fit contain, at the bottom centre of its square
  function fitPick(fr) {
    var im = fr.parentNode.querySelector("img.art");
    if (!im) { fr.style.cssText = "left:0;top:0;width:100%" + (KIND === "books" ? ";aspect-ratio:2/3" : ";height:100%"); return; }
    // (a book's cover fills its 2:3 box: the frame is the box)
    if (KIND === "books") { fr.style.cssText = "left:" + im.offsetLeft + "px;top:" + im.offsetTop + "px;width:" + im.clientWidth + "px;height:" + im.clientHeight + "px"; return; }
    if (!im.complete || !im.naturalWidth) { im.addEventListener("load", function () { fitPick(fr); }, { once: true }); return; }
    var W = im.clientWidth, H = im.clientHeight, r = Math.min(W / im.naturalWidth, H / im.naturalHeight);
    var w = im.naturalWidth * r, h = im.naturalHeight * r;
    fr.style.cssText = "left:" + (im.offsetLeft + (W - w) / 2) + "px;top:" + (im.offsetTop + H - h) + "px;width:" + w + "px;height:" + h + "px";
  }
  function fitPicks() { shelves.querySelectorAll(".pick-frame:not(.rec-pick)").forEach(fitPick); }
  var pickResize = 0;
  window.addEventListener("resize", function () { clearTimeout(pickResize); pickResize = setTimeout(fitPicks, 120); });
  // BoardGameGeek's numbers: players "1–5", time "40–70 min"
  var ICON = {
    players: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c.6-3.6 3.2-5.6 6.5-5.6s5.9 2 6.5 5.6z"/><circle cx="17" cy="9" r="2.6"/><path d="M16.2 13.6c2.8 0 4.8 1.7 5.3 4.9h-4.3c-.3-1.9-1-3.5-2.2-4.7.4-.1.8-.2 1.2-.2z"/></svg>',
    time: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm0 2a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM11 7v5.6l4.3 2.6 1-1.7-3.3-2V7z"/></svg>',
  };
  // BGG's "Best with" as numbers: "4" -> [4], "4–6" -> [4, 5, 6], "6, 8" -> [6, 8], "8+" -> [8]
  function bestOf(d) {
    var out = [];
    String(d.best || "").split(/,\s*/).forEach(function (part) {
      var m = /(\d+)\s*[–-]\s*(\d+)/.exec(part), one = /(\d+)/.exec(part);
      if (m) for (var n = +m[1]; n <= +m[2] && n < 30; n++) out.push(n);
      else if (one) out.push(+one[1]);
    });
    return out;
  }
  function playerRange(d) {
    if (d.minPlayers) return [d.minPlayers, d.maxPlayers || d.minPlayers];
    var m = /(\d+)(?:\D+(\d+))?/.exec(d.players || ""); // items added before the numbers were kept
    return m ? [+m[1], +(m[2] || m[1])] : null;
  }
  // complexity (BGG's "weight", 1 to 5) with BGG's words: only on the opened card, never on the shelf (Nick, 2026-10-30)
  function weightWord(w) { return w < 1.5 ? "Light" : w < 2.5 ? "Medium Light" : w < 3.5 ? "Medium" : w < 4.5 ? "Medium Heavy" : "Heavy"; }
  function weightDots(w) {
    var html = "";
    for (var i = 1; i <= 5; i++) html += '<i style="--f:' + Math.max(0, Math.min(1, w - i + 1)).toFixed(2) + '"></i>';
    return '<span class="weight-dots" aria-hidden="true">' + html + "</span>";
  }
  function gameCap(d) {
    var r = playerRange(d), bits = [];
    if (r) bits.push('<span class="gs">' + ICON.players + (r[0] === r[1] ? r[0] : r[0] + "–" + r[1]) + "</span>");
    if (d.time) bits.push('<span class="gs">' + ICON.time + esc(String(d.time).replace(/ min$/, "")) + "<small>min</small></span>");
    return bits.length ? '<span class="game-cap">' + bits.join("") + "</span>" : "";
  }
  // the card's stats bar, set out like the top of a BoardGameGeek page
  function gameStats(d) {
    var r = playerRange(d), cells = [];
    if (r) cells.push(["Players", (r[0] === r[1] ? r[0] : r[0] + "–" + r[1]), d.best ? "Best with " + d.best : ""]);
    if (d.time) cells.push(["Play time", esc(String(d.time).replace(/ min$/, "")) + "<small> min</small>", ""]);
    if (d.age) cells.push(["Age", d.age, ""]);
    if (d.weight) cells.push(["Complexity", d.weight.toFixed(1) + '<small> / 5</small>', weightWord(d.weight), weightDots(d.weight)]);
    if (d.rating) cells.push(["Rating", d.rating.toFixed(1) + '<small> / 10</small>', d.votes ? d.votes.toLocaleString("en-US") + " ratings" : ""]);
    if (d.rank) cells.push(["Rank", "#" + d.rank.toLocaleString("en-US"), "overall on BGG"]);
    return cells.length ? '<div class="game-stats">' + cells.map(function (c) {
      return '<div><span class="k">' + c[0] + '</span><span class="v">' + (/</.test(c[1]) ? c[1] : esc(c[1])) + "</span>" + (c[3] || "") + (c[2] ? '<span class="s">' + esc(c[2]) + "</span>" : "") + "</div>";
    }).join("") + "</div>" : "";
  }

  // ---------- details ----------
  var dialog = document.createElement("dialog"), settleTimer = null;
  dialog.className = "lib-dialog coll-dialog coll-" + KIND;
  document.body.appendChild(dialog);
  function listen(type, fn) { dialog.addEventListener(type, fn); }
  listen("click", function (e) {
    if (e.target === dialog || e.target.closest(".close")) { dialog.close(); return; }
    // the record: out of the sleeve and onto it, or back; the sleeve: turned over (or, with the record out, it goes back)
    // (out of its sleeve, the record flips over when clicked and goes back in from the sleeve: Nick, 2026-11-01, "allow
    // flipping the record when it's out of the sleeve without needing to return it before flipping over")
    var disc = e.target.closest(".coll-disc"), flip = e.target.closest(".sleeve-flip");
    var bare = !flip && e.target.closest(".lib-front > .coll-cover"); // (a sleeve with no back to turn over to)
    var isOut = !!dialog.querySelector(".lib-front.rec-out");
    // the record out: a click in the space just around the sleeve and record (not on anything that does something) puts
    // it back too (Nick, 2026-11-01: on a phone there may not be room for a finger on the sleeve)
    if (isOut && !disc && !flip && !bare && dialog.classList.contains("settled") && nearRecord(e)) { moveRecord(); return; }
    if (disc && dialog.classList.contains("settled")) { if (isOut) flipRecord(); else moveRecord(); }
    else if ((flip || bare) && dialog.classList.contains("settled")) { if (isOut) moveRecord(); else if (flip) turnSleeve(flip); }
    var rm = e.target.closest(".coll-remove");
    if (rm) removeItem(rm.dataset.id, rm);
    var bk = e.target.closest(".coll-back-btn");
    if (bk) cardBacks(bk.dataset.id);
    var lb = e.target.closest(".coll-labels-btn");
    if (lb) cardLabels(lb.dataset.id);
    var fr = e.target.closest(".coll-front-btn");
    if (fr) cardFronts(fr.dataset.id);
    var ed = e.target.closest(".coll-edit-btn");
    if (ed) { var f = dialog.querySelector(".coll-edit"); f.hidden = !f.hidden; if (!f.hidden) { f.scrollIntoView({ block: "nearest", behavior: "smooth" }); f.elements.edition.focus(); } }
    if (e.target.closest(".coll-edit-cancel")) dialog.querySelector(".coll-edit").hidden = true;
    var scb = e.target.closest(".coll-scan-btn");
    if (scb) scb.parentNode.querySelector("input[type=file]").click();
    var lk = e.target.closest(".coll-look-btn");
    if (lk) readLook(lk.dataset.id, lk);
    var sp = e.target.closest(".coll-spotify-btn");
    if (sp) cardSpotify(sp.dataset.id);
    var pk = e.target.closest(".coll-pick-btn");
    if (pk) setPick(pk.dataset.id, pk);
    var pt = e.target.closest(".coll-tracks li.can-play"); // (the whole row, not just its button: Nick, 2026-10-25)
    if (pt) playFrom(dialog.dataset.item, pt.dataset.sp);
    // (the record on the turntable from its card: Nick, 2026-11-02)
    if (e.target.closest(".coll-deck-btn")) deckFromCard(dialog.dataset.item);
    var more = e.target.closest(".lib-more");
    if (more) { var bx = more.closest(".lib-about-box"), open = !bx.classList.contains("expanded"); bx.classList.toggle("expanded", open); more.textContent = open ? "Show less" : "Show more"; }
  });
  shelves.addEventListener("click", function (e) {
    var pl = e.target.closest(".shelf-play");
    if (pl) { wakeAudio(); flyToDeck(pl.dataset.id, pl.closest(".rec-slot")); return; }
    var b = e.target.closest(".coll-item");
    if (b) openItem(b.dataset.id);
  });
  listen("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("coll-disc")) { e.preventDefault(); e.target.click(); }
  });
  // with a card open, the Left and Right arrow keys open the one before or after it, in the order the shelf shows now
  // (its sort, search, genre or players), round from the last to the first (Nick, 2026-10-25); not while typing
  document.addEventListener("keydown", function (e) {
    if (!dialog.open || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    var list = shown(), at = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === dialog.dataset.item) at = i;
    if (at < 0 || list.length < 2) return;
    e.preventDefault();
    openItem(list[(at + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length].id);
  });
  // a record's whole running time: "42 min", "1 hr 14 min"
  function runtime(ms) { if (!ms) return ""; var m = Math.round(ms / 60000); return m < 60 ? m + " min" : Math.floor(m / 60) + " hr" + (m % 60 ? " " + m % 60 + " min" : ""); }
  function mins(ms) { if (!ms) return ""; var s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); }
  function openItem(id) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    // (no stored running time, but every song has its length, e.g. lengths Spotify filled in later: their sum; Nick, 2026-11-04)
    var tl = d.tracks || [], total = d.runtime || (tl.length && tl.every(function (t) { return t.ms; }) ? tl.reduce(function (a, t) { return a + t.ms; }, 0) : 0);
    var facts = [d.year, KIND === "vinyl" && d.pressed && d.pressed !== d.year ? "pressed " + d.pressed : "", d.format, runtime(total), d.pages ? d.pages + " pages" : ""].filter(Boolean);
    var credits = [];
    if (d.label) credits.push(["Label", d.label + (d.country ? " · " + d.country : "")]);
    if (d.publisher) credits.push(["Publisher", d.publisher]);
    if (KIND === "games" && d.creator) credits.push(["Designer", d.creator]);
    if (d.mechanics && d.mechanics.length) credits.push(["Mechanics", d.mechanics.join(", ")]);
    var subj = KIND === "books" ? subjectsOf(d.genres) : { subjects: genresOf(d), series: "" }, series = d.series || subj.series;
    if (d.genre && d.genre.length) credits.push(["Genre", d.genre.join(", ")]);
    if (series) credits.push(["Series", series]);
    if (subj.subjects.length) credits.push([KIND === "games" ? "Categories" : KIND === "books" ? "Subjects" : "Genres", subj.subjects.join(", ")]);
    if (d.barcode) credits.push(["Barcode", d.barcode]);
    if (d.back && d.backFrom) credits.push(["Back cover", "Photo from " + d.backFrom]); // (Discogs asks for the credit)
    if (d.added) credits.push(["Added", new Date(d.added + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })]);
    var tracks = trackList(d);
    dialog.innerHTML =
      '<div class="lib-back">' +
        '<button type="button" class="close" aria-label="Close">&times;</button>' +
        '<div class="lib-front">' + front(d) + "</div>" +
        '<div class="lib-info">' +
          "<h2>" + esc(d.title) + "</h2>" +
          (KIND === "games" || KIND === "vinyl" || KIND === "books" ? '<p class="coll-pick-tag"' + (d.pick ? "" : " hidden") + '><span aria-hidden="true">★</span> Nick’s Pick</p>' : "") +
          (d.creator && KIND !== "games" ? '<p class="coll-creator">' + esc(d.creator) + "</p>" : "") +
          (facts.length ? '<p class="lib-facts">' + facts.map(esc).join(" · ") + "</p>" : "") +
          (KIND === "games" ? gameStats(d) : "") +
          (d.edition ? '<p class="lib-disc">' + esc(d.edition) + "</p>" : "") +
          (d.note ? '<p class="coll-note">' + esc(d.note) + "</p>" : "") +
          // (each paragraph its own <p>, like the Movie Library's cases: Nick, 2026-11-04, the long book and game summaries)
          (d.about ? '<div class="lib-about-box"><div class="lib-about-text">' + String(KIND === "books" ? cleanAbout(d.about) : d.about).split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean)
            .map(function (p) { return '<p class="lib-about">' + esc(p) + "</p>"; }).join("") + "</div>" +
            '<button type="button" class="lib-more" hidden>Show more</button></div>' : "") +
          // the album on Spotify: under the About, over the track list (Nick, 2026-10-25)
          // (its songs play on the turntable at the top of the page: Nick, 2026-11-02, "One player")
          (KIND === "vinyl" ? '<p class="coll-deck-line"' + (spotifyOf(d) || d.spotify === undefined ? "" : " hidden") + ">" + deckLine(d) + "</p>" +
            // under it, the steps for a logged-in player (spotify-help.js; Nick, 2026-11-02)
            (window.NMSpotifyHelp ? '<p class="sp-help-line"' + (spotifyOf(d) && !d.spotifyOff ? "" : " hidden") + ">" + window.NMSpotifyHelp.link() + "</p>" : "") : "") +
          tracks +
          (credits.length ? '<dl class="lib-credits">' + credits.map(function (c) { return "<dt>" + c[0] + "</dt><dd>" + esc(c[1]) + "</dd>"; }).join("") + "</dl>" : "") +
          (d.url ? '<p class="lib-links"><a class="pill-btn" href="' + esc(sourceUrl(d)) + '" target="_blank" rel="noopener">' + esc(/discogs\.com/.test(d.url) ? "Discogs" : CFG.source) + "</a></p>" : "") +
          // a game's How to Play video, the top one in BGG's hot How to Play list (Nick, 2026-10-29), at the bottom
          (KIND === "games" ? '<section class="coll-howto"' + (d.howto && d.howto.yt ? "" : " hidden") + '><h3>How to Play</h3><div class="coll-howto-video">' + howToPlayer(d) + "</div></section>" : "") +
          (ADMIN ? '<p class="lib-owner">' +
            // a book's cover, chosen from every one there is or a photo of his own (Nick, 2026-11-04)
            (KIND === "books" ? '<button type="button" class="remove coll-front-btn" data-id="' + esc(d.id) + '">Change its cover</button> ' : "") +
            (KIND === "vinyl" ? '<button type="button" class="remove coll-front-btn" data-id="' + esc(d.id) + '">Change its front cover</button> ' +
            '<button type="button" class="remove coll-look-btn" data-id="' + esc(d.id) + '">' + (d.vinyl ? "Read its colour again" : "Read its colour from its photos") + "</button> " +
            '<button type="button" class="remove coll-back-btn" data-id="' + esc(d.id) + '">' + (d.back ? "Change its back cover" : "Choose its back cover") + "</button> " +
            '<button type="button" class="remove coll-labels-btn" data-id="' + esc(d.id) + '">' + (d.labelPic || d.labelPicB ? "Change its label" : "Choose its label") + "</button> " +
            '<button type="button" class="remove coll-spotify-btn" data-id="' + esc(d.id) + '">' + (spotifyOf(d) ? "Change its Spotify album" : "Add its Spotify album") + "</button> " : "") +
            (KIND === "games" ? '<button type="button" class="remove coll-pick-btn" data-id="' + esc(d.id) + '">' + (d.pick ? "Not a Nick’s Pick" : "Make it a Nick’s Pick") + "</button> " +
              // private: only Nick sees it (and its filter); for knowing which games are new
              '<label class="coll-unopened"><input type="checkbox" class="coll-unopened-box" data-id="' + esc(d.id) + '"' + (d.unopened ? " checked" : "") + "> Unopened <small>(only you see this)</small></label> " : "") +
            // a record's Nick's Pick: its own button beside Edit pressing (Nick, 2026-11-02: "its own line choice next to edit pressing")
            (KIND === "vinyl" || KIND === "books" ? '<button type="button" class="remove coll-pick-btn" data-id="' + esc(d.id) + '">' + (d.pick ? "Not a Nick’s Pick" : "Make it a Nick’s Pick") + "</button> " : "") +
            '<button type="button" class="remove coll-edit-btn" data-id="' + esc(d.id) + '">Edit ' + esc(CFG.edition.replace(/\s*\(optional\)/, "").toLowerCase()) + " and note</button> " +
            '<button type="button" class="remove coll-remove" data-id="' + esc(d.id) + '">Remove from the library</button></p>' +
            // (the two fields, shown by the button above: Nick, 2026-10-29)
            '<form class="coll-edit" data-id="' + esc(d.id) + '" hidden>' +
              '<label>' + esc(CFG.edition.replace(/\s*\(optional\)/, "")) + '<input name="edition" type="text" maxlength="80" value="' + esc(d.edition || "") + '" placeholder="' + esc(CFG.editionHint) + '"></label>' +
              '<label><span>Note <span class="optional">(shown on its card)</span></span><textarea name="note" rows="2" maxlength="280">' + esc(d.note || "") + "</textarea></label>" +
              '<p class="coll-edit-row"><button type="submit" class="pill-btn">Save</button> <button type="button" class="remove coll-edit-cancel">Cancel</button> <span class="coll-msg"></span></p>' +
            "</form>" +
            (KIND === "vinyl" || KIND === "books" ? '<div class="lib-covers coll-backs coll-card-fronts" hidden>' + '<p class="coll-scan"><button type="button" class="pill-btn coll-scan-btn" data-side="front" data-id="' + esc(d.id) + '">' + (KIND === "books" ? "Upload your own photo" : "Upload your own scan") + '</button><input type="file" accept="image/*" hidden></p>' + '<div class="lib-cover-list" role="group" aria-label="Front cover"></div><p class="coll-msg"></p></div>' : "") +
            // its label photos: Side A / Side B, the photos to pick from, and a zoom for a photo of the whole disc
            (KIND === "vinyl" ? '<div class="lib-covers coll-backs coll-card-labels" hidden>' +
              '<p class="coll-lab-sides" role="group" aria-label="Which side"><button type="button" data-side="labelPic" aria-pressed="true">Side A</button><button type="button" data-side="labelPicB" aria-pressed="false">Side B</button>' +
              '<label class="coll-lab-zoom">Zoom <input type="range" min="0.95" max="3.15" step="0.01" value="1"></label>' +
              // (a preview of the label beside the zoom: on a phone the record is scrolled away by here; drag it to centre the label)
              '<span class="coll-lab-preview" title="Drag to centre the label"><img alt="" referrerpolicy="no-referrer" draggable="false" hidden></span>' +
              '<button type="button" class="coll-lab-center">Center</button></p>' +
              '<p class="coll-scan"><button type="button" class="pill-btn coll-scan-btn" data-side="label" data-id="' + esc(d.id) + '">Upload your own label</button><input type="file" accept="image/*" hidden></p>' +
              '<div class="lib-cover-list" role="group" aria-label="Label photo"></div><p class="coll-msg"></p></div>' : "") +
            (KIND === "vinyl" ? '<div class="lib-covers coll-backs coll-card-backs" hidden>' + '<p class="coll-scan"><button type="button" class="pill-btn coll-scan-btn" data-side="back" data-id="' + esc(d.id) + '">Upload your own scan</button><input type="file" accept="image/*" hidden></p>' + '<div class="lib-cover-list" role="group" aria-label="Back cover"></div><p class="coll-msg"></p></div>' : "") : "") +
        "</div>" +
      "</div>";
    if (!dialog.open) dialog.showModal();
    dialog.dataset.item = d.id;
    if (KIND === "games") loadHowTo();
    // a record with no About: Wikipedia's article on the album looked for once (Worker GET /collection/vinyl/about),
    // and the card redrawn with it when there is one
    if (KIND === "vinyl" && !d.about && !d.aboutTried && !aboutAsked[d.id]) {
      aboutAsked[d.id] = true;
      fetch(API + "/collection/vinyl/about?id=" + encodeURIComponent(d.id)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        items = items.map(function (x) { if (x.id === d.id) { x.aboutTried = true; if (j && j.about) x.about = j.about; } return x; });
        if (j && j.about && dialog.open && dialog.dataset.item === d.id) openItem(d.id);
      }).catch(function () {});
    }
    var at = dialog.querySelector(".lib-about-text");
    if (at && at.scrollHeight > at.clientHeight + 4) dialog.querySelector(".lib-more").hidden = false;
    else if (at) at.parentNode.classList.add("short");
    dialog.querySelector(".lib-back").scrollTop = 0;
    // records come out of their sleeve (the cover art on the record's label), books open; games turn over like a movie case
    var lbl = dialog.querySelector(".coll-label");
    if (lbl && d.cover && !lbl.classList.contains("has-pic")) lbl.style.backgroundImage = 'url("' + String(d.cover).replace(/["\\]/g, "\\$&") + '")';
    if (KIND === "vinyl" && (d.spotify === undefined || (spotifyOf(d) && !d.spotifyTracks))) findSpotify(d);
    else if (KIND === "vinyl") markTracks();
    var anim = KIND === "vinyl" ? "pull" : KIND === "books" ? "open" : "flip";
    recHint();
    dialog.classList.remove(anim, "settled"); void dialog.offsetWidth; dialog.classList.add(anim);
    // the sleeve can be turned over once the record's out (the opening animation done; at once with reduced motion)
    clearTimeout(settleTimer);
    // once settled, the opening animation is let go of, so the record can move again (the turn over)
    settleTimer = setTimeout(function () { dialog.classList.add("settled"); dialog.classList.remove("pull"); },
      window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1150);
  }
  // a record's album on Spotify, in a player under its About (Nick, 2026-10-25): Spotify's own compact player (a
  // preview without a Spotify login, the whole album with one). The Worker finds the album when the record's added
  // (d.spotify: its Spotify id, or "none"; d.spotifyTracks: each track's song on it); a record added before that is
  // looked up the first time its card opens
  // (an album's id, or "playlist:<id>" for a public playlist: Nick, 2026-11-01)
  function spotifyOf(d) { return /^(playlist:)?[A-Za-z0-9]{22}$/.test(d.spotify || "") ? d.spotify : ""; }
  function spotifyUri(s) { return /^playlist:/.test(s) ? "spotify:" + s : "spotify:album:" + s; }
  function spotifyLinkOf(s) { return /^playlist:/.test(s) ? "https://open.spotify.com/playlist/" + s.slice(9) : "https://open.spotify.com/album/" + s; }
  var PLAY_ICONS = '<svg class="i-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>' +
    '<svg class="i-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>' +
    '<span class="i-eq" aria-hidden="true"><i></i><i></i><i></i></span>';
  // ---------- the turntable (Nick, 2026-11-02) ----------
  // "a vinyl record gramophone player at the top of the page": a turntable in the page head, under the record count and
  // over the search (Nick, 2026-11-02; first beside the title)
  // with the playing record's sleeve on a stand beside it and a NOW PLAYING sign under that; the record itself spins on
  // the platter in its own colour and labels (discLook, labelHtml), the tone arm on it and moving in across the album.
  // It's the page's one Spotify player (Nick: "One player"): a ▶ under each record on the shelf carries the record up
  // to it (flyToDeck: off the shelf, up the page, out of its sleeve and onto the platter, the arm over, then the music);
  // a card's songs play on it too, the record landing there at once. Spotify's own slim player shows under it (its Log
  // in, for whole songs; Spotify's terms). The record last played waits on it, at rest, the next visit (nm-deck-last).
  //
  // Spotify's iFrame API: a new record makes a new controller (a frame that's moved or told another album adds steps to
  // the page's history, which Back would then take); a song picked from a card is loaded into it (loadUri). sp: the
  // deck's player { id: the record, c, ctx: "album" | "track", track: a song picked, now: the song playing (its
  // playingURI), paused, last, pos, dur }.
  var sp = null, deck = null, flying = false, still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DECK_KEY = "nm-deck-last";
  function onDeck() { return sp && items.filter(function (x) { return x.id === sp.id; })[0]; }
  // a record whose songs Spotify won't play here (Nick, 2026-11-03: George Carlin's On the Road): the Worker asks
  // Spotify when its songs are looked up (spotifyOff), or the turntable finds out (a play that fails twice: unplayable)
  var OFF_NOTE = "These songs can’t be played on Spotify in the US.";
  function songsOf(d) { return (d.spotifyTracks || []).filter(function (t) { return /^[A-Za-z0-9]{22}$/.test(t || ""); }); }
  // a card's line where its player was: play it on the turntable, or pause/carry on when it's the one on it
  function deckLine(d) {
    if (spotifyOf(d) && d.spotifyOff) return '<span class="coll-deck-off">' + OFF_NOTE + "</span>";
    if (!spotifyOf(d)) return '<span class="coll-deck-wait"><span class="spin" aria-hidden="true"></span>Finding it on Spotify…</span>';
    var on = sp && sp.id === d.id, playing = on && !sp.paused, tap = on && deck && deck.el.classList.contains("needs-tap");
    return '<button type="button" class="pill-btn coll-deck-btn' + (playing ? " playing" : "") + '">' + PLAY_ICONS +
      "<span>" + (playing ? "Playing on the turntable" : tap ? "Tap to start it" : on && sp.started ? "Carry on with it on the turntable" : "Play it on the turntable") + "</span></button>";
  }
  function drawCardLine() {
    var line = dialog.querySelector(".coll-deck-line"), d = items.filter(function (x) { return x.id === dialog.dataset.item; })[0];
    if (line && d) line.innerHTML = deckLine(d);
  }

  // the deck itself, in the page head once the records are in
  function makeDeck() {
    var head = document.querySelector(".page-head");
    if (!head || deck) return;
    var el = document.createElement("section");
    el.className = "deck empty";
    el.setAttribute("aria-label", "Record player");
    el.innerHTML =
      '<div class="deck-row">' +
        '<div class="deck-stand">' +
          '<button type="button" class="deck-sleeve" aria-label="Open the record on the turntable"><img alt="" referrerpolicy="no-referrer"></button>' +
          '<p class="deck-sign"><span class="deck-lit">Now Playing</span><b class="deck-song"></b><small class="deck-who"></small></p>' +
        "</div>" +
        '<div class="deck-table">' +
          '<span class="deck-platter"><span class="deck-mat"></span><span class="coll-disc deck-disc"><span class="coll-label"></span></span><span class="deck-spindle"></span></span>' +
          // the tone arm, its base and rest (viewBox in the table's own units, 320 x 250; the pivot at 282, 42)
          '<svg class="deck-arm" viewBox="0 0 320 250" aria-hidden="true">' +
            '<circle class="arm-rest" cx="282" cy="200" r="5"/>' +
            '<circle class="arm-base" cx="282" cy="42" r="19"/>' +
            '<g class="arm-g"><rect class="arm-weight" x="272" y="10" width="20" height="18" rx="4"/>' +
              '<path class="arm-tube" d="M282 42 L282 186 L270 207"/>' +
              '<rect class="arm-head" x="259" y="202" width="16" height="22" rx="3" transform="rotate(28 267 213)"/></g>' +
            '<circle class="arm-cap" cx="282" cy="42" r="7"/>' +
          "</svg>" +
          '<span class="deck-speed" aria-hidden="true"><i class="on">33</i><i>45</i></span>' +
          '<button type="button" class="deck-start" aria-label="Play"><span class="deck-led"></span>' + PLAY_ICONS + "</button>" +
        "</div>" +
      "</div>" +
      '<p class="deck-off" hidden>' + OFF_NOTE + "</p>" +
      '<div class="deck-strip coll-spotify" hidden><p class="coll-spotify-wait"><span class="spin" aria-hidden="true"></span>Loading the Spotify player…</p><div class="deck-embed"></div></div>' +
      '<div class="deck-foot"><button type="button" class="deck-crackle" aria-pressed="true" title="The record\'s crackle under the music"><span class="sw" aria-hidden="true"></span>Crackle</button>' +
        (window.NMSpotifyHelp ? '<p class="sp-help-line">' + window.NMSpotifyHelp.link() + "</p>" : "") + "</div>";
    head.classList.add("has-deck");
    head.appendChild(el);
    deck = { el: el, disc: el.querySelector(".deck-disc"), sleeve: el.querySelector(".deck-sleeve img"), arm: el.querySelector(".arm-g"),
      strip: el.querySelector(".deck-strip"), rate: 0, anim: null };
    el.querySelector(".deck-start").addEventListener("click", startStop);
    el.querySelector(".deck-crackle").addEventListener("click", crackleSwitch);
    el.querySelector(".deck-platter").addEventListener("click", startStop);
    el.querySelector(".deck-sleeve").addEventListener("click", function () { if (sp) openItem(sp.id); });
    // the bar at the bottom shows while the deck is scrolled away
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { deck.seen = es[0].isIntersecting; drawBar(); }).observe(el.querySelector(".deck-table"));
    // waiting on it: the record last played here, else one of Nick's Picks
    var last = null;
    try { last = localStorage.getItem(DECK_KEY); } catch (e) {}
    var ok = items.filter(function (d) { return spotifyOf(d) && d.cover && !d.spotifyOff; });
    var d = ok.filter(function (x) { return x.id === last; })[0];
    if (!d) { var picks = ok.filter(function (x) { return x.pick; }); d = (picks.length ? picks : ok)[Math.floor(Math.random() * (picks.length || ok.length))]; }
    if (d) { setRecord(d); setTimeout(function () { if (sp && sp.id === d.id && !sp.c) loadPlayer(d); }, 1500); }
    drawDeck();
    drawCrackleSwitch();
  }
  // a record on the deck (its sleeve on the stand, its disc on the platter), not playing yet
  function setRecord(d) { useRecord(d); showRecord(d); }
  // the player's side: the record it's for (the last one's player gone)
  function useRecord(d) {
    if (sp && sp.id === d.id) return;
    crackleStop(true);
    if (sp && sp.c) { try { sp.c.destroy(); } catch (e) {} }
    deck.strip.querySelector(".deck-embed").innerHTML = "";
    sp = { id: d.id, c: null, ctx: "album", track: "", now: "", paused: true, last: 0, pos: 0, dur: 0, cue: false };
    try { localStorage.setItem(DECK_KEY, d.id); } catch (e) {}
  }
  // and its look on the deck
  function showRecord(d) {
    deck.sleeve.src = small(d) || d.cover || "";
    deck.sleeve.alt = d.title + " sleeve";
    var lk = discLook(d), m = /^ colored([^"]*)"(?: style="([^"]*))?/.exec(lk); // (discLook's class-and-style string)
    deck.disc.className = "coll-disc deck-disc" + (m ? " colored" + m[1] : lk);
    deck.disc.setAttribute("style", m && m[2] ? m[2] : "");
    deck.disc.innerHTML = labelHtml(d).replace(/^<span class="coll-label/, '<span class="coll-label');
    var lbl = deck.disc.querySelector(".coll-label");
    if (lbl && !lbl.classList.contains("has-pic") && d.cover) lbl.style.backgroundImage = 'url("' + String(small(d) || d.cover).replace(/["\\]/g, "\\$&") + '")';
    deck.el.classList.remove("empty");
    deck.el.querySelector(".deck-speed .on").classList.toggle("on", !/7"/.test(d.format || ""));
    deck.el.querySelectorAll(".deck-speed i")[1].classList.toggle("on", /7"/.test(d.format || ""));
    deck.el.querySelector(".deck-sleeve").setAttribute("aria-label", "Open " + d.title);
    drawDeck();
  }
  // its Spotify player: a new controller for each record, on the album (or playlist); then(c) once it's ready
  function loadPlayer(d, then, uri) {
    var me = sp;
    if (me.c && me.loaded === d.spotify) { if (then) then(me.c); return; }
    if (me.loading) { me.waiting = then; return; }
    me.loading = true; me.waiting = then;
    deck.strip.hidden = false;
    deck.strip.classList.remove("ready");
    var host = deck.strip.querySelector(".deck-embed"), el = document.createElement("div");
    if (me.c) { try { me.c.destroy(); } catch (e) {} me.c = null; }
    host.innerHTML = "";
    me.ctxLoaded = uri ? "track" : "album";
    host.appendChild(el);
    spotifyApi(function (api) {
      if (sp !== me) return; // another record went on meanwhile
      api.createController(el, { uri: uri || spotifyUri(d.spotify), width: "100%", height: 80 }, function (c) {
        if (sp !== me) { try { c.destroy(); } catch (e) {} return; }
        me.c = c; me.loaded = d.spotify;
        c.addListener("ready", function () {
          me.loading = false;
          drawDeck(); // (the start button live)
          setTimeout(function () { deck.strip.classList.add("ready"); }, 300);
          var t = me.waiting; me.waiting = null;
          if (t) t(c);
        });
        c.addListener("playback_update", function (e) { heard(me, e.data || {}); });
      });
    });
  }
  // what the player says: playing or not, the song (its playingURI), how far in; a song picked from a card that's
  // played to its end goes on to the album's next (as recs.js tells an end from a pause); the album's own end stops it
  function heard(me, x) {
    if (sp !== me) return;
    var was = me.paused;
    me.paused = !!x.isPaused;
    var prev = me.now, prevPos = me.pos;
    var u = /spotify:track:([A-Za-z0-9]{22})/.exec(x.playingURI || "");
    if (u) me.now = u[1];
    me.pos = x.position || 0; me.dur = x.duration || 0;
    // the crackle only while a song is really playing (Nick, 2026-11-02: "pause the crackle and not start it until the
    // next track is playing"): quiet the moment the song changes (Spotify's Next or Previous, a song picked) or it
    // pauses, and back (the loop, unless the album's start is already on) once the song's position is moving on
    var changed = !!(u && prev && prev !== me.now);
    if (changed && !(crk && (crk.on === "intro" || crk.pending))) crackleStop(true);
    if (!was && me.paused) crackleStop(true);
    // (an album's start: its 10s start then, with the song, never while it loads: Nick, 2026-11-02, "never let the
    // crackle play if a song isn't playing")
    if (!me.paused && !changed && me.pos > 0 && me.pos !== prevPos) { crackleStart(!!me.wantIntro); me.wantIntro = false; }
    if (was && !me.paused) {
      me.cue = false; me.started = true;
      deck.el.classList.remove("needs-tap");
      barClosed = false;
      document.dispatchEvent(new CustomEvent("nm-spotify-play", { detail: "library" }));
    }
    var end = me.paused && !x.isBuffering && x.duration > 0 && (x.position >= x.duration - 1500 || (x.position === 0 && me.last >= x.duration - 2500));
    me.last = x.position || 0;
    if (end && me.ctx === "track" && me.track) nextTrack();
    else if (end && me.ctx === "album") { var ids = songsOf(onDeck() || {}); if (!ids.length || me.now === ids[ids.length - 1]) me.now = ""; }
    markTracks(); drawDeck(); drawBar(); drawCardLine();
  }
  // a song picked: plays it (or pauses it, or carries on with it)
  function playTrack(id) {
    if (!sp || !id) return;
    if (!sp.c) { sp.ctx = "track"; sp.track = sp.now = id; sp.cue = true; loadPlayer(onDeck(), function (c) { armThen(function () { c.play(); askTap(onDeck()); }); }, "spotify:track:" + id); markTracks(); drawDeck(); return; } // (no player yet: one made on the song)
    if (id === (sp.ctx === "track" ? sp.track : sp.now)) { playPause(); return; }
    sp.ctx = "track"; sp.track = sp.now = id; sp.last = 0; sp.cue = true; sp.ctxLoaded = "track";
    crackleStop(true); // (quiet till the new song plays: heard)
    sp.c.loadUri("spotify:track:" + id);
    var c = sp.c;
    armThen(function () { c.play(); });
    markTracks(); drawDeck();
  }
  function nextTrack() {
    var ids = songsOf(onDeck() || {}), i = ids.indexOf(sp.track);
    if (i < 0 || i + 1 >= ids.length) { sp.track = sp.now = ""; markTracks(); drawDeck(); return; } // the last one: it stops, the arm back on its rest
    playTrack(ids[i + 1]);
  }
  // a card's song: its record onto the turntable at once if it isn't there, then the song
  function playFrom(id, track) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    if (!d || !deck || d.spotifyOff) return;
    wakeAudio();
    if (!sp || sp.id !== d.id) {
      setRecord(d);
      sp.ctx = "track"; sp.track = sp.now = track; sp.cue = true;
      loadPlayer(d, function (c) { armThen(function () { c.play(); askTap(d); }); }, "spotify:track:" + track);
      markTracks(); drawDeck(); drawCardLine();
      return;
    }
    playTrack(track);
  }
  // the card's own button: its record on the turntable from the top (or paused, or carried on)
  function deckFromCard(id) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    if (!d || !deck || d.spotifyOff) return;
    wakeAudio();
    if (sp && sp.id === d.id && sp.c && (sp.started || !sp.paused)) { playPause(); return; }
    if (sp && sp.id === d.id && sp.c && !sp.loading) { deck.el.classList.remove("needs-tap"); sp.c.play(); return; } // (a tap a browser wanted)
    if (!sp || sp.id !== d.id) setRecord(d);
    startRecord(d);
    drawCardLine();
  }
  // the record on the deck played from its start: the album (or its first song, when it was a song picked before)
  // (the arm swings over, the needle drops and the crackle of the lead-in groove starts, then the music: Nick,
  // 2026-11-02, "a vinyl crackle noise to play before dropping the needle on an album play"; his recording now)
  function startRecord(d) {
    sp.ctx = "album"; sp.track = ""; sp.cue = true; sp.last = 0; sp.tapped = false;
    drawDeck();
    var t0 = Date.now(), MUSIC = 1700; // (ms after the arm starts over: the needle down, then the music)
    sp.wantIntro = true; // (the crackle's 10s start, once the song's playing: heard)
    loadPlayer(d, function (c) {
      if (sp.ctxLoaded !== "album") { c.loadUri(spotifyUri(d.spotify)); sp.ctxLoaded = "album"; } // (a song picked before)
      var me = sp;
      setTimeout(function () { if (sp !== me) return; c.play(); askTap(d); }, Math.max(0, MUSIC - (Date.now() - t0)));
    });
  }
  // ---------- the record's crackle ----------
  // Nick's two royalty-free recordings (Nick, 2026-11-02, in /assets/sound/): its first 10s (the needle down and the
  // lead-in groove) under an album's start, then straight on into the rest (4m50s), looped under every song while it
  // plays, both at half volume; stopped a moment after the music pauses, back (the loop, where it was) when it plays;
  // off with the deck's Crackle switch (remembered: nm-deck-crackle). <audio> elements (streamed: the long one would be
  // ~100MB decoded) through Web Audio for their volume (iOS ignores an element's own); woken on a tap (wakeAudio:
  // browsers only let a page make sound after one, so it can start a moment later)
  var SOUND = "/assets/sound/", CRACKLE_VOL = 0.40, ac = null, crk = null, crackleOn = true;
  try { crackleOn = localStorage.getItem("nm-deck-crackle") !== "off"; } catch (e) {}
  function wakeAudio() {
    try {
      if (!ac) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ac = new AC(); }
      if (ac.state === "suspended") ac.resume();
      if (!crk) crk = { intro: soundTrack("vinyl-crackle-first-10s.mp3", false), loop: soundTrack("vinyl-crackle-without-beginning.mp3", true), on: "", pending: false, timer: 0, stopT: 0 };
      // each allowed to play later: started and stopped at once on the tap (silent: their volume is 0)
      if (!crk.woken) {
        crk.woken = true;
        [crk.intro, crk.loop].forEach(function (t) { var pr = t.el.play(); if (pr && pr.then) pr.then(function () { if (crk.on !== t.name) t.el.pause(); }, function () {}); });
      }
    } catch (e) {}
  }
  function soundTrack(file, loop) {
    var el = new Audio(SOUND + file), g = ac.createGain();
    el.loop = loop; el.preload = loop ? "metadata" : "auto";
    g.gain.value = 0;
    ac.createMediaElementSource(el).connect(g);
    g.connect(ac.destination);
    return { el: el, g: g, name: loop ? "loop" : "intro" };
  }
  function fadeTo(t, v, secs) { var now = ac.currentTime, g = t.g.gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(v, now + secs); }
  function playSound(t) { if (ac.state === "suspended") ac.resume(); var pr = t.el.play(); if (pr && pr.catch) pr.catch(function () {}); }
  // an album's start (intro): the first 10s from the top, into the loop as it ends (crossfaded over its last 0.3s);
  // otherwise just the loop, if it isn't going already
  function crackleStart(intro, delay) {
    if (!crk || !crackleOn) return;
    clearTimeout(crk.stopT);
    if (!intro) { if (!crk.on && !crk.pending) loopOn(0.4); return; }
    clearTimeout(crk.timer);
    crk.pending = true;
    crk.timer = setTimeout(function () {
      crk.pending = false;
      var t = crk.intro;
      fadeTo(crk.loop, 0, 0.2);
      t.el.currentTime = 0;
      fadeTo(t, CRACKLE_VOL, 0.03);
      playSound(t);
      crk.on = "intro";
      (function chain() {
        if (crk.on !== "intro") return;
        var left = (t.el.duration || 10) - t.el.currentTime;
        if (left > 0.35) { crk.timer = setTimeout(chain, Math.min(1000, (left - 0.3) * 1000)); return; }
        loopOn(0.3);
        setTimeout(function () { if (crk.on !== "intro") t.el.pause(); }, 600);
      })();
    }, (delay || 0) * 1000);
  }
  function loopOn(fade) { crk.on = "loop"; fadeTo(crk.loop, CRACKLE_VOL, fade); playSound(crk.loop); }
  // stopped: faded out; at once (now), or after a moment's pause (the gap between songs doesn't stop it)
  function crackleStop(now) {
    if (!crk) return;
    clearTimeout(crk.stopT);
    var go = function () {
      clearTimeout(crk.timer);
      crk.on = ""; crk.pending = false;
      [crk.intro, crk.loop].forEach(function (t) { fadeTo(t, 0, 0.12); setTimeout(function () { if (crk.on !== t.name) t.el.pause(); }, 160); }); // (right away: Nick, 2026-11-02, "not stopping right when the song is stopped")
    };
    if (now) go(); else crk.stopT = setTimeout(go, 700);
  }
  // the deck's switch
  function crackleSwitch() {
    crackleOn = !crackleOn;
    try { localStorage.setItem("nm-deck-crackle", crackleOn ? "on" : "off"); } catch (e) {}
    drawCrackleSwitch();
    if (!crackleOn) crackleStop(true);
    else if (sp && !sp.paused) { wakeAudio(); crackleStart(false); }
  }
  function drawCrackleSwitch() {
    var b = deck && deck.el.querySelector(".deck-crackle");
    if (b) b.setAttribute("aria-pressed", String(crackleOn));
  }
  // the music only once the needle's on the record (Nick, 2026-11-02: "when playing a song in the middle after a pause,
  // allow the arm to reach the record before playing"): an arm on its rest swings over first; one already on its way
  // over, the rest of its swing (deck.armAt: when it set off; its CSS swing is 1s, nearly there by ARM_MS)
  var ARM_MS = 900;
  function armThen(fn) {
    if (!deck || still) { fn(); return; }
    if (!deck.el.classList.contains("arm-on")) { sp.cue = true; drawDeck(); }
    var me = sp;
    setTimeout(function () { if (sp === me) fn(); }, Math.max(0, (deck.armAt || 0) + ARM_MS - Date.now()));
  }
  // pause (the arm back to its rest), or carry on (the arm over, then the music)
  function playPause() {
    if (!sp || !sp.c) return;
    wakeAudio();
    if (!sp.paused) { sp.c.pause(); crackleStop(true); return; } // (the crackle with it, not when the player says so)
    var c = sp.c;
    armThen(function () { c.resume(); });
  }
  // a browser that won't start it unasked (Safari, a while after the tap): the start button asks for a tap
  function askTap(d) {
    setTimeout(function () {
      if (!(sp && sp.id === d.id && sp.paused && !sp.started)) return;
      sp.cue = false; crackleStop(true);
      if (sp.tapped) { unplayable(d); return; } // (the tap didn't do it either: Spotify won't play it)
      deck.el.classList.add("needs-tap"); drawDeck(); drawCardLine();
    }, 2500);
  }
  function unplayable(d) {
    d.spotifyOff = true;
    var help = dialog.dataset.item === d.id && dialog.querySelector(".sp-help-line");
    if (help) help.hidden = true;
    deck.el.classList.remove("needs-tap");
    drawDeck(); drawCardLine(); markTracks();
    render(); // (its shelf Play gone)
  }
  // Spotify's player made and ready for the record on the deck
  function playerReady() { return !!(sp && sp.c && !sp.loading); }
  // the start button, or a tap on the platter
  function startStop() {
    var d = onDeck();
    if (!d || flying) return;
    // (not till Spotify's player is ready: Nick, 2026-11-02, "don't allow a play click on the record player if the
    // spotify player isn't ready yet"; a click before it only crackled)
    if (!playerReady() || d.spotifyOff) return;
    wakeAudio();
    if (deck.el.classList.contains("needs-tap")) { deck.el.classList.remove("needs-tap"); sp.cue = true; sp.tapped = true; sp.c.play(); askTap(d); drawDeck(); return; } // (a tap a browser wanted)
    if (sp.started || !sp.paused) { playPause(); return; }
    startRecord(d);
  }
  // the deck drawn as it is: playing (the arm on the record, moving in across it; the platter turning; the sign lit)
  function drawDeck() {
    if (!deck) return;
    var d = onDeck(), on = !!(sp && (!sp.paused || sp.cue));
    deck.el.classList.toggle("playing", !!(sp && !sp.paused));
    var off = !!(d && d.spotifyOff);
    deck.el.classList.toggle("not-ready", !!d && !playerReady() && !off);
    deck.el.classList.toggle("off", off);
    deck.el.querySelector(".deck-start").setAttribute("aria-disabled", String(!!d && (off || !playerReady())));
    if (on && !deck.el.classList.contains("arm-on")) deck.armAt = Date.now(); // (the arm setting off for the record)
    deck.el.classList.toggle("arm-on", on);
    spin(on);
    // the arm: 0° on its rest; on the record from 24° at its edge to 44° by the label, by how far into the album it is
    var ids = d ? songsOf(d) : [], i = sp ? ids.indexOf(sp.now) : -1, n = Math.max(1, ids.length || (d && d.tracks || []).length);
    var f = Math.min(1, ((i < 0 ? 0 : i) + (sp && sp.dur ? sp.pos / sp.dur : 0)) / n);
    deck.arm.style.transform = "rotate(" + (on ? 24 + 20 * f : 0) + "deg)";
    var song = d && sp.now ? songTitle(d, sp.now) : "";
    marquee(deck.el.querySelector(".deck-song"), d ? song || d.title : "Nothing on yet");
    var by = d && sp.now ? songBy(d, sp.now) : ""; // (a compilation's song: its own artist, then the record)
    marquee(deck.el.querySelector(".deck-who"), d ? (by ? by + " · " + d.title : (song ? d.title + " · " : "") + (d.creator || "")) : "Press Play under a record");
    var note = deck.el.querySelector(".deck-off");
    if (note) note.hidden = !off;
    var b = deck.el.querySelector(".deck-start");
    b.setAttribute("aria-label", sp && !sp.paused ? "Pause" : "Play");
  }
  // the song playing's name: from the record's own list; else (a record with no list of its songs on Spotify, or one
  // Spotify plays under another id than its album lists: Nick, 2026-11-02, "the track title didn't update") Spotify's
  // own, from its public oEmbed (once a song; the deck and bar redrawn when it comes)
  var songNames = {};
  function songBy(d, id) { var t = (d.tracks || [])[(d.spotifyTracks || []).indexOf(id)]; return (t && t.by) || ""; }
  function songTitle(d, id) {
    var t = (d.tracks || [])[(d.spotifyTracks || []).indexOf(id)];
    if (t) return t.title;
    if (songNames[id] === undefined) {
      songNames[id] = "";
      fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + id))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.title) { songNames[id] = j.title; drawDeck(); drawBar(); } })
        .catch(function () {});
    }
    return songNames[id];
  }
  // a line under the sleeve too long for it scrolls past within its width, round and round, pausing at its start (Nick,
  // 2026-11-02); one that fits stays still. Redone only when its words change (drawDeck runs every second while it
  // plays), or the window's width does
  function marquee(el, text) {
    if (el.dataset.t === text && el.dataset.w === String(el.clientWidth)) return;
    el.dataset.t = text;
    el.classList.remove("marquee");
    el.textContent = text;
    el.dataset.w = String(el.clientWidth);
    if (still || !text || el.scrollWidth <= el.clientWidth + 1) return;
    var gap = 36, run = el.scrollWidth + gap;
    el.innerHTML = '<span class="mq"><span>' + esc(text) + '</span><span aria-hidden="true">' + esc(text) + "</span></span>";
    el.style.setProperty("--mq", -run + "px");
    el.style.setProperty("--mqs", (run / 28 / 0.82).toFixed(1) + "s"); // (28px a second, after its pause)
    el.classList.add("marquee");
  }
  var mqTimer = 0;
  window.addEventListener("resize", function () { clearTimeout(mqTimer); mqTimer = setTimeout(drawDeck, 200); });
  // the platter: up to 33⅓ (one turn in 1.8s) and down again gently, from wherever it is
  function spin(on) {
    if (!deck.anim) {
      if (!deck.disc.animate) return;
      deck.anim = deck.disc.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 1800, iterations: Infinity });
      deck.anim.playbackRate = 0;
    }
    deck.goal = on ? (still ? 0.25 : 1) : 0;
    if (deck.ramp) return;
    deck.ramp = true;
    (function step() {
      var r = deck.rate, g = deck.goal;
      r = Math.abs(g - r) < 0.01 ? g : r + (g - r) * (g > r ? 0.035 : 0.05);
      deck.rate = r;
      deck.anim.playbackRate = r;
      if (r !== g) requestAnimationFrame(step); else deck.ramp = false;
    })();
  }

  // ---------- off the shelf and onto the turntable ----------
  // the ▶ under a record: the sleeve lifted off the shelf, carried up the page to the stand, the record out of it and
  // down onto the platter, the arm over and the music on (Nick: "to imitate someone playing a real record")
  function flyToDeck(id, slot) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    if (!d || !deck || flying) return;
    // (a record whose album hasn't been looked for yet: looked for first; none, and its ▶ goes)
    if (d.spotify === undefined) {
      fetch(API + "/collection/vinyl/spotify?id=" + encodeURIComponent(d.id)).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { d.spotify = (j && j.spotify) || ""; d.spotifyTracks = (j && j.spotifyTracks) || []; if (j && j.spotifyOff) d.spotifyOff = true; if (spotifyOf(d) && !d.spotifyOff) flyToDeck(id, slot); else render(); })
        .catch(function () {});
      return;
    }
    if (!spotifyOf(d) || d.spotifyOff) return;
    var img0 = slot && slot.querySelector(".sleeve");
    if (sp && sp.id === d.id && sp.c && (sp.started || !sp.paused)) { scrollUp(); if (sp.paused) playPause(); return; } // (it's on already)
    // the old record off, and the new one's player on its way now (a quick start once it lands)
    var had = !deck.el.classList.contains("empty");
    if (sp && sp.c && !sp.paused) sp.c.pause();
    if (still || !img0) { setRecord(d); startRecord(d); scrollUp(); return; }
    flying = true;
    var r0 = img0.getBoundingClientRect(), y0 = window.scrollY;
    // its clones: the sleeve, and the record behind it
    var lk = discLook(d), m = /^ colored([^"]*)"(?: style="([^"]*))?/.exec(lk);
    var fly = document.createElement("div");
    fly.className = "deck-fly";
    fly.innerHTML = '<span class="coll-disc deck-fly-disc' + (m ? " colored" + m[1] : lk) + '"' + (m && m[2] ? ' style="' + m[2] + '"' : "") + ">" + labelHtml(d) + "</span>" +
      '<img class="deck-fly-sleeve" alt="" referrerpolicy="no-referrer" src="' + esc(img0.currentSrc || img0.src) + '">';
    document.body.appendChild(fly);
    var fd = fly.querySelector(".deck-fly-disc"), fs = fly.querySelector(".deck-fly-sleeve"), lbl = fd.querySelector(".coll-label");
    if (lbl && !lbl.classList.contains("has-pic") && d.cover) lbl.style.backgroundImage = 'url("' + String(small(d) || d.cover).replace(/["\\]/g, "\\$&") + '")';
    slot.classList.add("lifted");
    // the record that was on: the arm back, the platter slowing, and it and its sleeve gone from the deck
    deck.el.classList.add("swapping");
    if (had) { sp.paused = true; sp.cue = false; drawDeck(); }
    useRecord(d); // (the old record's player gone, and the new one's loading while it flies: a quicker start)
    loadPlayer(d);
    drawDeck(); // (the sign says what's coming)
    var T = { lift: 260, travel: 950, out: 420, drop: 480 }, t0 = 0;
    var tOut = T.lift + T.travel, tDrop = tOut + T.out, tEnd = tDrop + T.drop;
    var ease = function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
    var place = function (el, x, y, w, rot, sc) { el.style.cssText = "left:" + x + "px;top:" + y + "px;width:" + w + "px;transform:rotate(" + (rot || 0) + "deg) scale(" + (sc || 1) + ")" + (el === fd ? ";" + (m && m[2] ? m[2] : "") : ""); };
    var landed = false;
    function frame(now) {
      t0 = t0 || now;
      var t = now - t0;
      var rS = deck.el.querySelector(".deck-sleeve").getBoundingClientRect(), rD = deck.el.querySelector(".deck-platter").getBoundingClientRect(), sY = window.scrollY;
      var dw = rD.width * 200 / 216; // (the disc inside the platter's rim)
      var sx, sy, sw, srot = 0, ssc = 1, dx, dy, dwid, drot = 0, dsc = 1;
      if (t < T.lift) { // lifted off the shelf
        var k = ease(t / T.lift);
        sx = r0.left; sy = r0.top - 14 * k; sw = r0.width; ssc = 1 + 0.08 * k; srot = -3 * k;
      } else if (t < tOut) { // carried up the page (the page scrolling to the top under it), on a rising curve
        var k2 = ease((t - T.lift) / T.travel);
        window.scrollTo(0, y0 * (1 - k2));
        var ax = r0.left, ay = r0.top - 14;
        // (to where the stand will be on the screen once the page is at the top, so it flies a straight curve up)
        sx = ax + (rS.left - ax) * k2 - 60 * Math.sin(Math.PI * k2);
        sy = ay + (rS.top + sY - ay) * k2 - 90 * Math.sin(Math.PI * k2);
        sw = r0.width + (rS.width - r0.width) * k2;
        ssc = 1.08 - 0.08 * k2; srot = -3 + 3 * k2 - 7 * Math.sin(Math.PI * k2);
      } else { sx = rS.left; sy = rS.top; sw = rS.width; }
      if (t < tOut) { dwid = sw * 0.92; dx = sx + sw * 0.04; dy = sy + sw * 0.04; drot = srot; dsc = ssc; }
      else if (t < tDrop) { // out of the sleeve, to the right (toward the platter)
        var k3 = ease((t - tOut) / T.out);
        dwid = sw * 0.92; dx = sx + sw * 0.04 + sw * 0.75 * k3; dy = sy + sw * 0.04; drot = 140 * k3;
      } else { // over the platter and down onto it
        var k4 = ease(Math.min(1, (t - tDrop) / T.drop));
        fly.classList.add("over");
        var ox = sx + sw * 0.04 + sw * 0.75, oy = sy + sw * 0.04, ow = sw * 0.92;
        dwid = ow + (dw - ow) * k4;
        dx = ox + (rD.left + (rD.width - dw) / 2 - ox) * k4; dy = oy + (rD.top + (rD.height - dw) / 2 - oy) * k4 - 26 * Math.sin(Math.PI * k4);
        drot = 140 + 100 * k4; dsc = 1 + 0.05 * Math.sin(Math.PI * k4);
        if (!landed) { landed = true; showRecord(d); } // (hidden under its clone till it's down: .swapping)
      }
      place(fs, sx, sy, sw, srot, ssc);
      place(fd, dx, dy, dwid, drot, dsc);
      if (t < tEnd) { requestAnimationFrame(frame); return; }
      // down: the deck's own record in its place, the clones gone, the arm over and the music on
      if (deck.anim) deck.anim.currentTime = (drot % 360) / 360 * 1800; // (the record as it landed, its label the same way round)
      fly.remove();
      slot.classList.remove("lifted");
      deck.el.classList.remove("swapping");
      flying = false;
      startRecord(d);
    }
    // the new record's player starts loading at the tap (it's on the deck once it lands)
    requestAnimationFrame(frame);
  }
  function scrollUp() { window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" }); }

  // the playing song's row lit in the open card, its button a pause button
  function markTracks() {
    var mine = sp && dialog.dataset.item === sp.id, id = mine ? (sp.ctx === "track" ? sp.track : sp.now) : "";
    [].forEach.call(dialog.querySelectorAll(".coll-tracks li.can-play"), function (li) {
      var on = !!id && li.dataset.sp === id, playing = on && !sp.paused;
      li.classList.toggle("selected", on);
      li.classList.toggle("playing", playing);
      var b = li.querySelector(".coll-play");
      b.setAttribute("aria-label", (playing ? "Pause " : "Play ") + li.children[1].textContent);
    });
  }
  // another player on the page started (the poster wall's, say): this one stops
  document.addEventListener("nm-spotify-play", function (e) { if (e.detail !== "library" && sp && sp.c && !sp.paused) { sp.c.pause(); crackleStop(true); } });

  // ---------- the bar at the bottom, while the turntable's scrolled away ----------
  // (Nick, 2026-11-02: the song plays on with the card closed; now the turntable's): the song, the record and its
  // sleeve (tap: back up to the turntable), play/pause, and x (paused, and the bar away until a song starts again)
  var bar = null, barClosed = false;
  function drawBar() {
    if (KIND !== "vinyl") return;
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "coll-np";
      bar.hidden = true;
      bar.innerHTML = '<button type="button" class="coll-np-open"><img alt="" referrerpolicy="no-referrer"><span><b></b><small></small></span></button>' +
        '<button type="button" class="coll-np-play">' + PLAY_ICONS + "</button>" +
        '<button type="button" class="coll-np-stop" aria-label="Stop">&times;</button>';
      bar.addEventListener("click", function (e) {
        if (!sp || !sp.c) return;
        if (e.target.closest(".coll-np-open")) scrollUp();
        else if (e.target.closest(".coll-np-play")) playPause();
        else if (e.target.closest(".coll-np-stop")) { sp.c.pause(); crackleStop(true); barClosed = true; drawBar(); }
      });
      document.body.appendChild(bar);
    }
    var d = onDeck(), show = !!(d && sp.started && deck && deck.seen === false && !barClosed);
    bar.hidden = !show;
    if (!show) return;
    var song = sp.now ? songTitle(d, sp.now) : "";
    var img = bar.querySelector("img"), src = small(d) || d.cover || "";
    if (img.getAttribute("src") !== src) img.src = src;
    img.hidden = !src;
    bar.querySelector("b").textContent = song || d.title;
    var by = sp.now ? songBy(d, sp.now) : "";
    bar.querySelector("small").textContent = by ? by + " · " + d.title : song ? d.title + (d.creator ? " · " + d.creator : "") : d.creator || "";
    bar.querySelector(".coll-np-open").setAttribute("aria-label", "Back up to the turntable: " + d.title);
    bar.classList.toggle("playing", !sp.paused);
    bar.querySelector(".coll-np-play").setAttribute("aria-label", sp.paused ? "Play" : "Pause");
  }
  // and a How to Play video stops (a closed dialog keeps its frame, which would play on unseen)
  listen("close", function () { var v = dialog.querySelector(".coll-howto-video"); if (v) v.innerHTML = ""; });
  // Spotify's iFrame API, loaded once and shared with the other players (it calls onSpotifyIframeApiReady once)
  function spotifyApi(cb) {
    if (window.NMSpotifyAPI) return cb(window.NMSpotifyAPI);
    var wait = window.NMSpotifyWait = window.NMSpotifyWait || [];
    wait.push(cb);
    if (wait.length > 1) return;
    window.onSpotifyIframeApiReady = function (api) {
      window.NMSpotifyAPI = api;
      wait.splice(0).forEach(function (f) { f(api); });
    };
    var sc = document.createElement("script");
    sc.src = "https://open.spotify.com/embed/iframe-api/v1";
    sc.async = true;
    document.body.appendChild(sc);
  }
  // the card's turntable line and track list redrawn (its album found, or changed), the rest of the card left as it is;
  // the record on the turntable with another album now: its player made again for it
  function showSpotify(id) {
    var d = items.filter(function (x) { return x.id === id; })[0], line = dialog.querySelector(".coll-deck-line"), ol = dialog.querySelector(".coll-tracks");
    if (d && sp && sp.id === id && sp.loaded && sp.loaded !== d.spotify) {
      try { sp.c.destroy(); } catch (e) {}
      sp.c = null; sp.loaded = ""; sp.started = false; sp.paused = true; sp.cue = false;
      if (deck) { deck.strip.hidden = true; showRecord(d); if (spotifyOf(d)) loadPlayer(d); }
    }
    if (!d || !line || dialog.dataset.item !== id) return;
    line.innerHTML = deckLine(d);
    line.hidden = !spotifyOf(d);
    var help = dialog.querySelector(".sp-help-line");
    if (help) help.hidden = !spotifyOf(d) || !!d.spotifyOff;
    if (ol) ol.outerHTML = trackList(d);
    var b = dialog.querySelector(".coll-spotify-btn");
    if (b) b.textContent = spotifyOf(d) ? "Change its Spotify album" : "Add its Spotify album";
    markTracks();
  }
  // a record's track list; a track the Spotify album has gets a play button on its number (d.spotifyTracks: its
  // Spotify id, in step with d.tracks)
  // a track's number as A1, B2 or 3: a side's own name in front goes ("40 Side North – A1" on Illmatic; Nick, 2026-11-01)
  // (and "1-A1", a disc number before a lettered side, is just A1: the letter says which disc)
  function trackNum(n) { var s = String(n || "").trim(), m = /\s/.test(s) && /((?:\d+-)?[A-Z]{0,2}\d{1,3}[a-z]?)\s*$/.exec(s); s = m ? m[1] : s; return s.replace(/^\d+-(?=[A-Z])/, ""); }
  function trackList(d) {
    return (d.tracks || []).length ? '<ol class="coll-tracks">' + d.tracks.map(function (t, i) {
      var sid = spotifyOf(d) && !d.spotifyOff && /^[A-Za-z0-9]{22}$/.test((d.spotifyTracks || [])[i] || "") ? d.spotifyTracks[i] : "";
      return "<li" + (sid ? ' class="can-play" data-sp="' + sid + '"' : "") + ">" +
        (sid ? '<button type="button" class="n coll-play" aria-label="Play ' + esc(t.title) + (t.by ? " by " + esc(t.by) : "") + '"><span class="num">' + esc(trackNum(t.n)) + "</span>" + PLAY_ICONS + "</button>" : '<span class="n">' + esc(trackNum(t.n)) + "</span>") +
        // (a song's own artist, when it isn't the record's: a compilation's, Nick 2026-11-03)
        "<span>" + esc(t.title) + (t.by ? '<span class="by"> · ' + esc(t.by) + "</span>" : "") + '</span><span class="t">' + mins(t.ms) + "</span></li>";
    }).join("") + "</ol>" : "";
  }
  function findSpotify(d) {
    fetch(API + "/collection/vinyl/spotify?id=" + encodeURIComponent(d.id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.spotify) { d.spotify = j.spotify; d.spotifyTracks = j.spotifyTracks || []; if (j.spotifyOff) d.spotifyOff = true; }
        else if (d.spotify === undefined) d.spotify = "";  // (not found this time: no box; looked for again next visit)
        showSpotify(d.id);
      })
      .catch(function () { if (d.spotify === undefined) d.spotify = ""; else d.spotifyTracks = d.spotifyTracks || []; showSpotify(d.id); });
  }
  // owner mode: a record's Spotify album, pasted as a link (when the one found is the wrong one), or none
  function cardSpotify(id) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    var link = prompt("Paste the album's Spotify link (Share > Copy Album Link), or a public playlist's. Leave it empty for no player.", spotifyOf(d) ? spotifyLinkOf(d.spotify) : "");
    if (link === null) return;
    fetch(API + "/collection/vinyl/" + encodeURIComponent(id), { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ spotify: link }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { alert(res.j.error || "Couldn't save it."); return; }
        items = items.map(function (x) { return x.id === id ? res.j.item : x; });
        showSpotify(id);
        // someone else's playlist plays in the player, but Spotify won't tell the site its songs (only the connected
        // account's own playlists): no buttons on the track list
        var it = res.j.item;
        if (/^playlist:/.test(it.spotify || "") && !(it.spotifyTracks || []).some(Boolean))
          alert("The player will play this playlist. Spotify only lets the site read the songs of playlists you own, so the track list can't get play buttons from this one. To get them: in Spotify, add its songs to a new playlist of your own (open the playlist, ••• > Add to other playlist > New playlist), then paste that playlist's link here.");
      })
      .catch(function () { alert("Couldn't save it. Try again in a bit."); });
  }
  // the card's picture: a record's sleeve with the record behind it; a book as a book (its pages, a few loose leaves,
  // and the cover on a hinge, so it can swing open); a game's box
  // the record's centre: its real label photos when picked (side A; side B shows when the record is turned over), zoomed
  // into the photo's centre by labelZoom; else the front cover in the circle (set in openItem). Nick, 2026-11-01. A Discogs
  // photo loads straight from Discogs without a referrer, like a back.
  function labelHtml(d) {
    if (!d.labelPic && !d.labelPicB) return '<span class="coll-label"></span>';
    // (each side its own zoom: labelZoom for A, labelZoomB for B; Nick, 2026-11-01)
    // (and its own position, labelX/labelY and labelXB/labelYB: % of the label, to centre it after zooming)
    var one = function (src, cls, b) { return src ? '<img class="' + cls + '" src="' + esc(/discogs\.com/.test(src) ? src : pic(src)) + '" alt="" referrerpolicy="no-referrer" style="--z:' + (d["labelZoom" + b] || 1) + ";--x:" + (d["labelX" + b] || 0) + "%;--y:" + (d["labelY" + b] || 0) + '%">' : ""; };
    return '<span class="coll-label has-pic' + (d.labelPicB ? " two-sides" : "") + '">' + one(d.labelPic || d.labelPicB, "lab-a", d.labelPic ? "" : "B") + one(d.labelPicB, "lab-b", "B") + "</span>";
  }
  function front(d) {
    var cover = d.cover ? '<img class="coll-cover" src="' + esc(pic(d.cover)) + '"' + imgAttrs(d.cover) + ' alt="' + esc(d.title) + ' cover">' : '<div class="coll-cover blank">' + esc(d.title) + "</div>";
    // a record with a back cover: the sleeve turns over to it when clicked, once the record has slid out (Nick, 2026-10-25)
    // (.rec-turn holds the record and its sleeve, so they turn over together)
    if (KIND === "vinyl" && d.back) return '<div class="rec-turn"><span class="coll-disc' + discLook(d) + '" role="button" tabindex="0" aria-label="Take the record out">' + labelHtml(d) + '</span>' +
      '<button type="button" class="sleeve-flip" aria-pressed="false" aria-label="Turn the sleeve over to see the back">' +
        '<span class="sleeve-inner"><span class="face face-front">' + cover + '</span>' +
        '<span class="face face-back"><img class="coll-cover" src="' + esc(d.backFrom === "Discogs" ? d.back : pic(d.back)) + '"' + (d.backFrom === "Discogs" ? ' referrerpolicy="no-referrer"' : ' crossorigin="anonymous"') + ' alt="' + esc(d.title) + ' back cover"></span></span></button></div>' + // (a Discogs photo straight from Discogs)
      '<p class="flip-hint"></p>';
    if (KIND === "vinyl") return '<span class="coll-disc' + discLook(d) + '" role="button" tabindex="0" aria-label="Take the record out">' + labelHtml(d) + '</span>' + cover + '<p class="flip-hint"></p>';
    if (KIND === "books") return '<div class="book-3d"><span class="book-block" aria-hidden="true"></span>' +
      '<span class="book-leaf l3" aria-hidden="true"></span><span class="book-leaf l2" aria-hidden="true"></span><span class="book-leaf l1" aria-hidden="true"></span>' +
      '<div class="book-lid">' + cover + "</div></div>";
    return cover;
  }
  // a book's description and subjects as Open Library gives them, tidied (the Worker does the same when a book is
  // added; this also mends books added before it did): Markdown links become their words and the "[Source][1]" credit
  // goes; "series:Harry_Potter"-style tags aren't subjects (the series gets its own line), nor is plain "Fiction", and
  // "Fantasy" / "Fantasy fiction" show once
  // a book's link: its own edition's page when it has one (books added before the Worker did this link to the work,
  // whose page features whichever edition Open Library likes: a Russian Handmaid's Tale)
  function sourceUrl(d) {
    var ed = KIND === "books" && /~(OL\d+M)$/.exec(String(d.source || ""));
    return ed ? "https://openlibrary.org/books/" + ed[1] : d.url;
  }
  function cleanAbout(t) {
    return String(t || "").replace(/\r/g, "").split(/\n-{3,}/)[0]
      .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
      .replace(/\(?\[source\]\s*(\[[^\]]*\]|\([^)]*\))\)?/gi, "")
      .replace(/\[([^\]]+)\](\[[^\]]*\]|\([^)]*\))/g, "$1")
      .replace(/\n{3,}/g, "\n\n").trim();
  }
  function subjectsOf(list) {
    var series = "", out = [];
    (list || []).forEach(function (s) {
      s = String(s).trim();
      var ser = /^series:(.+)$/i.exec(s);
      if (ser) { series = series || ser[1].replace(/_/g, " ").trim(); return; }
      if (/:/.test(s) || s.length >= 30 || /fiction in english|accessible book|protected daisy|large type|reading level|in library|overdrive|new york times|fictional works|\(/i.test(s)) return;
      s = s.replace(/_/g, " ").replace(/^fiction, (.+)$/i, "$1 fiction").replace(/, fiction$/i, ""); // library headings: "Fiction, psychological", "Married people, fiction"
      var key = s.toLowerCase().replace(/sci-fi|science[ -]fiction/g, "scifi").replace(/\(.*?\)|\bjuvenile\b|\bfiction\b|\bgeneral\b|\bliterature\b/g, "").replace(/[^a-z]+/g, " ").trim();
      if (!key) return;
      var nice = s.charAt(0).toUpperCase() + s.slice(1), at = -1;
      out.forEach(function (o, i) { if (o.key === key) at = i; });
      if (at < 0) out.push({ key: key, s: nice });
      else if (nice.length < out[at].s.length) out[at].s = nice;
    });
    return { subjects: out.map(function (o) { return o.s; }), series: series };
  }
  // the record taken all the way out of its sleeve and laid on top of it to look at, or put back (Nick, 2026-10-25):
  // .lib-front.rec-out (site.css: out past the sleeve's open side, then over it; the open side is the left when the
  // sleeve's turned over), .rec-back for the way back. Ignored while it's moving
  // the record, out of its sleeve, flipped over: edge-on and open again on its other face (.rec-flipped: its other
  // label, side B, or A when the sleeve is turned over), .5 s; at once with reduced motion. While its label is being
  // picked, the picker goes to that side too.
  // was a click just around the sleeve and the record (AROUND px past either), on nothing that does something itself?
  var AROUND = 40;
  function nearRecord(e) {
    if (e.target.closest("button, a, input, select, textarea, label, iframe, summary, .coll-tracks, .coll-deck-line, .lib-owner, .lib-covers, .coll-edit, [role='button']")) return false;
    var lf = dialog.querySelector(".lib-front"), disc = lf && lf.querySelector(".coll-disc");
    if (!lf) return false;
    var boxes = [lf.getBoundingClientRect()].concat(disc ? [disc.getBoundingClientRect()] : []);
    return boxes.some(function (r) { return e.clientX >= r.left - AROUND && e.clientX <= r.right + AROUND && e.clientY >= r.top - AROUND && e.clientY <= r.bottom + AROUND; });
  }
  function flipRecord() {
    var lf = dialog.querySelector(".lib-front");
    if (!lf || lf.dataset.moving) return;
    var picking = dialog.querySelector(".coll-card-labels:not([hidden])"), lbl = lf.querySelector(".coll-label");
    var swap = function () {
      if (picking && lbl && (lbl.classList.contains("show-a") || lbl.classList.contains("show-b"))) {
        var other = picking.querySelector('.coll-lab-sides [data-side="' + (lbl.classList.contains("show-b") ? "labelPic" : "labelPicB") + '"]');
        if (other) other.click();
      } else lf.classList.toggle("rec-flipped");
    };
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) { swap(); return; }
    lf.dataset.moving = "1";
    lf.classList.add("rec-flipping");
    setTimeout(swap, 250);
    setTimeout(function () { lf.classList.remove("rec-flipping"); delete lf.dataset.moving; }, 520);
  }
  function moveRecord() {
    var lf = dialog.querySelector(".lib-front");
    if (!lf || lf.dataset.moving) return;
    var out = !lf.classList.contains("rec-out"), still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    lf.classList.toggle("rec-out", out);
    if (!out) lf.classList.remove("rec-flipped"); // (it goes back in the way it came out)
    if (!out && !still) lf.classList.add("rec-back");
    var disc = lf.querySelector(".coll-disc");
    if (disc) disc.setAttribute("aria-label", out ? "Flip the record over" : "Take the record out");
    recHint();
    if (still) return;
    lf.dataset.moving = "1";
    setTimeout(function () { delete lf.dataset.moving; lf.classList.remove("rec-back"); }, 920);
  }
  // the line under it: what a click does now
  function recHint() {
    var lf = dialog.querySelector(".lib-front"), hint = lf && lf.querySelector(".flip-hint");
    if (!hint) return;
    var verb = window.matchMedia && matchMedia("(hover: none)").matches ? "Tap" : "Click", flip = lf.querySelector(".sleeve-flip");
    hint.textContent = lf.classList.contains("rec-out") ? verb + " the record to flip it over, or around it to put it back"
      : flip ? verb + " the sleeve to see the " + (flip.classList.contains("over") ? "front" : "back") + ", or the record to take it out"
      : verb + " the record to take it out";
  }
  // turn a record over: the record and its sleeve together (.rec-turn) swing edge-on (rotateY 90, about the middle of
  // the two), and there the sleeve shows its other face and the record goes round to the other side (.lib-front.turned:
  // right of the sleeve on the front, left on the back), then swing on round from the other edge; .35 s a half; at
  // once with reduced motion. (Turning the sleeve alone left the record in full view mid-turn: Nick, 2026-10-25)
  function turnSleeve(flip) {
    var inner = flip.closest(".rec-turn") || flip.querySelector(".sleeve-inner"), still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (flip.dataset.turning) return;
    var lf = flip.closest(".lib-front");
    function swap() {
      if (lf) lf.classList.toggle("turned", !flip.classList.contains("over"));
      var over = !flip.classList.contains("over");
      flip.classList.toggle("over", over);
      flip.setAttribute("aria-pressed", String(over));
      recHint();
    }
    if (still) return swap();
    flip.dataset.turning = "1";
    inner.style.transition = "transform .35s cubic-bezier(.5, 0, .9, .6)";
    inner.style.transform = "perspective(1400px) rotateY(90deg)";
    setTimeout(function () {
      swap();
      inner.style.transition = "none";
      inner.style.transform = "perspective(1400px) rotateY(-90deg)";
      void inner.offsetWidth;
      inner.style.transition = "transform .35s cubic-bezier(.1, .4, .5, 1)";
      inner.style.transform = "perspective(1400px) rotateY(0deg)";
      setTimeout(function () { delete flip.dataset.turning; inner.style.transition = inner.style.transform = ""; }, 380);
    }, 360);
  }
  // owner mode, a record's card: choose (or change) its back cover; saved at once (Worker PATCH), the card redrawn
  function cardBacks(id) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    var box = dialog.querySelector(".coll-card-backs"), list = box.querySelector(".lib-cover-list"), msg = box.querySelector(".coll-msg");
    box.hidden = false;
    list.innerHTML = '<p class="coll-cover-wait">Finding its back cover…</p>';
    loadBacks(d.source).then(function (opts) {
      if (dialog.dataset.item !== id) return;
      if (!opts.length) { list.innerHTML = ""; msg.textContent = "No back cover to be found for this pressing."; return; }
      backTiles(list, opts, d.back === undefined ? null : d.back, function (src) {
        msg.textContent = "Saving…";
        fetch(API + "/collection/vinyl/" + encodeURIComponent(id), { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ back: src }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) { msg.textContent = res.j.error || "Couldn't save it."; return; }
            items = items.map(function (x) { return x.id === id ? res.j.item : x; });
            openItem(id); // redrawn with its new back (the sleeve turns over to it)
          })
          .catch(function () { msg.textContent = "Couldn't reach the server. Try again in a bit."; });
      });
    });
  }
  // its label photos, picked from the same photos as its back (Nick, 2026-11-01: On Avery Island's Discogs scans include
  // both of its star labels): pick Side A or Side B, then a photo (or None), and zoom each side on its own. The record
  // comes out of its sleeve while the picker is open and stays out (Nick: "pull the record out so I can preview the zoom
  // needed. and don't put it back in the sleeve after I adjust zoom"): saves change the label in place, the card isn't
  // redrawn. The side being picked is the one the record shows. PATCH { labelPic | labelPicB | labelZoom | labelZoomB }.
  function cardLabels(id) {
    var box = dialog.querySelector(".coll-card-labels");
    if (!box) return;
    var list = box.querySelector(".lib-cover-list"), msg = box.querySelector(".coll-msg"), zoom = box.querySelector(".coll-lab-zoom input");
    var item = function () { return items.filter(function (x) { return x.id === id; })[0]; };
    var side = function () { return box.dataset.side || "labelPic"; };
    var sfx = function () { return side() === "labelPicB" ? "B" : ""; };
    var zoomKey = function () { return "labelZoom" + sfx(); };
    var pos = { x: 0, y: 0 }; // (the side being picked: its position, % of the label)
    box.hidden = false;
    // the record out (once the card has settled), showing the side being picked
    function preview() {
      var d = item(), im = box.querySelector(".coll-lab-preview img");
      if (!im || !d) return;
      var src = d[side()] || (side() === "labelPicB" ? d.labelPic : "") || "";
      im.hidden = !src;
      if (src && im.dataset.src !== src) { im.src = /discogs\.com/.test(src) ? src : pic(src); im.dataset.src = src; }
      im.style.setProperty("--z", zoom.value);
      im.style.setProperty("--x", pos.x + "%"); im.style.setProperty("--y", pos.y + "%");
    }
    // the record's label (the side being picked) as it's set
    function liveLabel() {
      var im = dialog.querySelector(".coll-label " + (side() === "labelPicB" && dialog.querySelector(".coll-label .lab-b") ? ".lab-b" : ".lab-a"));
      if (im) { im.style.setProperty("--z", zoom.value); im.style.setProperty("--x", pos.x + "%"); im.style.setProperty("--y", pos.y + "%"); }
      preview();
    }
    function showSide() {
      preview();
      var lbl = dialog.querySelector(".coll-label");
      if (lbl) { lbl.classList.toggle("show-b", side() === "labelPicB"); lbl.classList.toggle("show-a", side() !== "labelPicB"); }
    }
    (function out(tries) {
      var lf = dialog.querySelector(".lib-front");
      if (!lf || dialog.dataset.item !== id) return;
      if (!dialog.classList.contains("settled") || lf.dataset.moving) { if (tries < 40) setTimeout(function () { out(tries + 1); }, 100); return; }
      if (!lf.classList.contains("rec-out")) moveRecord();
    })(0);
    // the label redrawn where it is, the record left where it is
    function redrawLabel() {
      var lbl = dialog.querySelector(".coll-label"), d = item();
      if (!lbl || !d) return;
      var tmp = document.createElement("span");
      tmp.innerHTML = labelHtml(d);
      var fresh = tmp.firstChild;
      if (!fresh.classList.contains("has-pic") && d.cover) fresh.style.backgroundImage = 'url("' + String(d.cover).replace(/["\\]/g, "\\$&") + '")';
      lbl.replaceWith(fresh);
      showSide();
      var btn = dialog.querySelector(".coll-labels-btn"); if (btn) btn.textContent = d.labelPic || d.labelPicB ? "Change its label" : "Choose its label";
    }
    function save(body) {
      msg.textContent = "Saving…";
      return fetch(API + "/collection/vinyl/" + encodeURIComponent(id), { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) { msg.textContent = res.j.error || "Couldn't save it."; return; }
          items = items.map(function (x) { return x.id === id ? res.j.item : x; });
          msg.textContent = "Saved.";
          if (!Object.keys(body).some(function (k) { return /^label(Zoom|X|Y)/.test(k); })) redrawLabel(); // (a zoom or position is already showing)
        })
        .catch(function () { msg.textContent = "Couldn't reach the server. Try again in a bit."; });
    }
    function tiles() {
      var d = item();
      [].forEach.call(box.querySelectorAll(".coll-lab-sides button"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.side === side())); });
      zoom.value = d[zoomKey()] || 1;
      pos = { x: d["labelX" + sfx()] || 0, y: d["labelY" + sfx()] || 0 };
      var up = box.querySelector(".coll-scan-btn"); if (up) up.dataset.side = side() === "labelPicB" ? "labelB" : "label";
      showSide();
      list.innerHTML = '<p class="coll-cover-wait">Finding its photos…</p>';
      loadBacks(d.source).then(function (opts) {
        if (dialog.dataset.item !== id) return;
        if (!opts.length) { list.innerHTML = ""; msg.textContent = "No photos of this pressing to be found."; return; }
        // (his own uploads first, either side's, so one can be picked again)
        var own = ["labelPic", "labelPicB"].map(function (k) { return item()[k]; }).filter(function (u, i, a) { return u && /\/covers\/.*-label/.test(u) && a.indexOf(u) === i; })
          .map(function (u) { return { src: u, thumb: u, label: "Your upload" }; });
        backTiles(list, own.concat(opts), item()[side()] || "", function (src) { var b = {}; b[side()] = src; save(b); }, "No label photo");
      });
    }
    [].forEach.call(box.querySelectorAll(".coll-lab-sides button"), function (b) {
      b.onclick = function () { box.dataset.side = b.dataset.side; tiles(); };
    });
    // the zoom shows on the side being picked as it moves, and is saved when let go
    zoom.oninput = liveLabel;
    zoom.onchange = function () { var b = {}; b[zoomKey()] = +zoom.value; save(b); };
    // drag the preview to move the label in its circle (Nick, 2026-11-01: "reposition slightly after zooming so its
    // centered"), saved when let go; Center puts it back
    var pv = box.querySelector(".coll-lab-preview"), drag = null;
    function savePos() { var b = {}; b["labelX" + sfx()] = pos.x; b["labelY" + sfx()] = pos.y; save(b); }
    pv.onpointerdown = function (e) { e.preventDefault(); pv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; };
    pv.onpointermove = function (e) {
      if (!drag) return;
      var w = pv.clientWidth * (+zoom.value || 1), lim = 30;
      pos = { x: Math.max(-lim, Math.min(lim, Math.round((drag.px + (e.clientX - drag.x) / w * 100) * 10) / 10)), y: Math.max(-lim, Math.min(lim, Math.round((drag.py + (e.clientY - drag.y) / w * 100) * 10) / 10)) };
      liveLabel();
    };
    pv.onpointerup = pv.onpointercancel = function () { if (!drag) return; var moved = pos.x !== drag.px || pos.y !== drag.py; drag = null; if (moved) savePos(); };
    box.querySelector(".coll-lab-center").onclick = function () { pos = { x: 0, y: 0 }; liveLabel(); savePos(); };
    redrawLabel();
    tiles();
  }
  function lookAfterAdd(id) {
    dgFetch(API + "/collection/vinyl/" + encodeURIComponent(id) + "/look", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" })
      .then(function (r) { return r.ok ? r.json() : null; })
      // (only its colour is taken from the reply: the rest could be older than a cover picked while the AI read)
      .then(function (j) { if (j && j.item) { items.forEach(function (x) { if (x.id === id) { if (j.item.vinyl) x.vinyl = j.item.vinyl; else delete x.vinyl; } }); render(); } })
      .catch(function () {});
  }
  // its pressing/edition and note, saved from the card (Worker PATCH /collection/:kind/:id { edition, note })
  listen("submit", function (e) {
    var f = e.target.closest(".coll-edit");
    if (!f) return;
    e.preventDefault();
    var id = f.dataset.id, msg = f.querySelector(".coll-msg"), btn = f.querySelector("[type=submit]");
    btn.disabled = true; msg.textContent = "Saving…";
    fetch(API + "/collection/" + KIND + "/" + encodeURIComponent(id), { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ edition: f.elements.edition.value, note: f.elements.note.value }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.j.item) { msg.textContent = res.j.error || "Couldn't save it."; return; }
        items = items.map(function (x) { return x.id === id ? res.j.item : x; });
        render();
        openItem(id); // redrawn (a record's colour follows its pressing)
      })
      .catch(function () { btn.disabled = false; msg.textContent = "Couldn't reach the server. Try again in a bit."; });
  });
  // Nick's own scan of a record's front or back (Nick, 2026-10-29, from his scanner): made at most 1600 px on its long
  // side as a JPEG here (a scanner's file can be 30 MB), then sent as it is (Worker PUT /collection/vinyl/:id/scan)
  listen("change", function (e) {
    var inp = e.target.closest(".coll-scan input[type=file]");
    if (!inp || !inp.files || !inp.files[0]) return;
    var btn = inp.parentNode.querySelector(".coll-scan-btn"), id = btn.dataset.id, side = btn.dataset.side;
    var msg = inp.closest(".lib-covers").querySelector(".coll-msg"), file = inp.files[0];
    inp.value = "";
    btn.disabled = true; msg.textContent = "Getting your scan ready…";
    createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      var g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (ok) { c.toBlob(ok, "image/jpeg", 0.9); });
    }).then(function (blob) {
      if (!blob) throw new Error("Couldn't read that picture.");
      msg.textContent = "Uploading…";
      side = btn.dataset.side; // (a label's side, as picked when it was uploaded)
      return fetch(API + "/collection/" + KIND + "/" + encodeURIComponent(id) + "/scan?side=" + side, { method: "PUT", headers: authHeaders({ "Content-Type": "image/jpeg" }), body: blob });
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.j.item) { msg.textContent = res.j.error || "Couldn't save it."; return; }
        items = items.map(function (x) { return x.id === id ? res.j.item : x; });
        render();
        if (/^label/.test(side)) { cardLabels(id); msg.textContent = "Saved."; return; } // (a label: in place, the record left out)
        openItem(id); // redrawn with the scan
      })
      .catch(function (err) { btn.disabled = false; msg.textContent = (err && err.message) || "Couldn't upload it. Try again."; });
  });
  // the record's colour read from its pressing's photos on Discogs (a read of the Worker's daily allowance)
  function readLook(id, btn) {
    if (btn.disabled) return;
    var was = btn.textContent;
    btn.disabled = true; btn.textContent = "Looking at its photos…";
    dgFetch(API + "/collection/vinyl/" + encodeURIComponent(id) + "/look", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.item) { btn.disabled = false; btn.textContent = res.j.error || "Couldn't read it."; setTimeout(function () { btn.textContent = was; }, 4000); return; }
        items = items.map(function (x) { return x.id === id ? res.j.item : x; });
        render();
        openItem(id); // redrawn in its colour
      })
      .catch(function () { btn.disabled = false; btn.textContent = was; });
  }
  // a record's front cover, from the same places as its back (its pressings' covers, Discogs' photo of its pressing)
  var frontsOf = {};
  function cardFronts(id) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    var box = dialog.querySelector(".coll-card-fronts"), list = box.querySelector(".lib-cover-list"), msg = box.querySelector(".coll-msg");
    box.hidden = false; msg.textContent = "";
    list.innerHTML = '<p class="coll-cover-wait">' + (KIND === "books" ? "Finding its covers…" : "Finding its front covers…") + "</p>";
    // (a book's: Open Library's, Apple Books' and Google Books', Worker /collection/books/covers)
    var url = KIND === "books" ? API + "/collection/books/covers?id=" + encodeURIComponent(d.source) + "&t=" + encodeURIComponent(d.title || "") + "&a=" + encodeURIComponent(String(d.creator || "").split(",")[0])
      : API + "/collection/vinyl/fronts?id=" + encodeURIComponent(d.source);
    if (!frontsOf[d.source]) frontsOf[d.source] = dgFetch(url, { headers: authHeaders() })
      .then(function (res) { return res.json(); }).then(function (j) { return j.fronts || j.covers || []; })
      .catch(function () { delete frontsOf[d.source]; return []; });
    frontsOf[d.source].then(function (opts) {
      if (dialog.dataset.item !== id) return;
      if (!opts.length) { list.innerHTML = ""; msg.textContent = KIND === "books" ? "No other covers to be found for this book." : "No other front covers to be found for this album."; return; }
      backTiles(list, opts, d.cover, function (src) {
        msg.textContent = "Saving…";
        fetch(API + "/collection/" + KIND + "/" + encodeURIComponent(id), { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(KIND === "books" ? { cover: src } : { front: src }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) { msg.textContent = res.j.error || "Couldn't save it."; return; }
            items = items.map(function (x) { return x.id === id ? res.j.item : x; });
            render();
            openItem(id); // redrawn with its new front
          })
          .catch(function () { msg.textContent = "Couldn't reach the server. Try again in a bit."; });
      });
      var none = list.querySelector(".coll-no-back"); if (none) none.remove(); // (a record always has a front)
    });
  }
  // a game's private Unopened mark, from the checkbox on its card (owner mode)
  listen("change", function (e) {
    var box = e.target.closest(".coll-unopened-box");
    if (!box) return;
    var id = box.dataset.id, want = box.checked;
    box.disabled = true;
    fetch(API + "/collection/games/" + encodeURIComponent(id), { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ unopened: want }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.item) throw new Error(res.j.error || "Couldn't save that.");
        items = items.map(function (x) { return x.id === id ? res.j.item : x; });
        box.disabled = false; box.checked = !!res.j.item.unopened;
        render();
      })
      .catch(function () { box.disabled = false; box.checked = !want; });
  });
  // the video in a privacy-enhanced YouTube player, loaded only once the card is open; a game added before there were
  // videos gets its video looked up (Worker GET /collection/games/howto, then kept) and it appears when found
  function howToPlayer(d) {
    var v = d.howto;
    if (v === undefined) { setTimeout(function () { fillHowTo(d.id); }, 0); return ""; }
    if (!v || !v.yt) return "";
    return '<iframe data-src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.yt) + '?rel=0" title="' + esc(v.title || "How to play " + d.title) + '" ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>' +
      (v.title ? '<p class="coll-howto-title">' + esc(v.title) + "</p>" : "");
  }
  // The player is loaded with location.replace() once it's near the view, not with src + loading="lazy": in Safari a
  // late (lazy) load counts as a navigation and adds steps to the browser's history, so after a few game cards Back
  // took many presses to leave the page (Nick, 2026-11-04). A replace() never adds a step.
  var howToSeen = null;
  function loadHowTo() {
    var f = dialog.querySelector(".coll-howto iframe[data-src]");
    if (!f) return;
    function go() {
      if (!f.dataset.src || !f.isConnected) return;
      var url = f.dataset.src; delete f.dataset.src;
      try { f.contentWindow.location.replace(url); } catch (e) { f.src = url; }
    }
    if (howToSeen) howToSeen.disconnect();
    if (!("IntersectionObserver" in window)) { go(); return; }
    howToSeen = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { howToSeen.disconnect(); go(); }
    }, { root: dialog, rootMargin: "300px" });
    howToSeen.observe(f);
  }
  var howToAsked = {}, aboutAsked = {};
  function fillHowTo(id) {
    if (howToAsked[id]) return;
    howToAsked[id] = true;
    fetch(API + "/collection/games/howto?id=" + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.howto === undefined) { howToAsked[id] = false; return; } // (BGG not answering: asked again next time)
        items = items.map(function (x) { if (x.id === id) x.howto = j.howto; return x; });
        var d = items.filter(function (x) { return x.id === id; })[0];
        var sec = dialog.open && dialog.dataset.item === id && dialog.querySelector(".coll-howto");
        if (sec && d) { sec.querySelector(".coll-howto-video").innerHTML = howToPlayer(d); sec.hidden = !(d.howto && d.howto.yt); loadHowTo(); }
      })
      .catch(function () { howToAsked[id] = false; });
  }
  // a game's Nick's Pick on or off, from its card (owner mode)
  function setPick(id, btn) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    if (!d || btn.disabled) return;
    var want = !d.pick;
    btn.disabled = true; btn.textContent = want ? "Making it a Nick’s Pick…" : "Taking it off…";
    fetch(API + "/collection/" + KIND + "/" + encodeURIComponent(id), { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ pick: want }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.item) throw new Error(res.j.error || "Couldn't save that.");
        items = items.map(function (x) { return x.id === id ? res.j.item : x; });
        btn.disabled = false; btn.textContent = res.j.item.pick ? "Not a Nick’s Pick" : "Make it a Nick’s Pick";
        var tag = dialog.querySelector(".coll-pick-tag"); if (tag) tag.hidden = !res.j.item.pick;
        render();
      })
      .catch(function (err) { btn.disabled = false; btn.textContent = err.message || "Couldn't save that. Try again."; });
  }
  function removeItem(id, btn) {
    var d = items.filter(function (x) { return x.id === id; })[0];
    if (!d || !confirm("Take " + d.title + " out of the library?")) return;
    btn.disabled = true; btn.textContent = "Removing…";
    fetch(API + "/collection/" + KIND + "/" + encodeURIComponent(id), { method: "DELETE", headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { btn.disabled = false; btn.textContent = res.j.error || "Couldn't remove it"; return; }
        items = items.filter(function (x) { return x.id !== id; });
        dialog.close(); render();
      })
      .catch(function () { btn.disabled = false; btn.textContent = "Couldn't reach the server"; });
  }

  // ---------- owner mode: adding ----------
  function ownerBar() {
    document.dispatchEvent(new Event("nm-owner")); // "Owner mode · Log out" by the wordmark (footer.js)
    root.querySelector(".coll-add-btn").hidden = false;
    render();
  }
  function login() {
    var d = document.createElement("dialog");
    d.className = "queue-dialog";
    d.innerHTML = '<form novalidate><h2>Owner login</h2><p class="hint">Enter your admin password. This browser will remember it.</p>' +
      '<label for="coll-admin">Password</label><input id="coll-admin" type="password" autocomplete="current-password">' +
      '<p class="error" role="alert"></p><button class="pill-btn submit" type="submit">Log in</button></form>';
    document.body.appendChild(d);
    var input = d.querySelector("input"), err = d.querySelector(".error");
    d.addEventListener("close", function () { d.remove(); });
    d.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var token = input.value.trim();
      fetch(API + "/admin/check", { headers: { Authorization: "Bearer " + token } }).then(function (r) {
        if (!r.ok) { err.textContent = "Wrong password."; return; }
        ADMIN = token;
        try { localStorage.setItem("nm-admin-token", token); } catch (e2) {}
        history.replaceState(null, "", location.pathname + location.hash);
        d.close(); ownerBar();
      }).catch(function () { err.textContent = "Couldn't reach the server."; });
    });
    d.showModal(); input.focus();
  }

  var addDlg = null, picked = null, results = [], seq = 0, timer = 0, stream = null, scanTimer = 0;
  root.querySelector(".coll-add-btn").addEventListener("click", openAdd);
  function openAdd() {
    if (!addDlg) {
      addDlg = document.createElement("dialog");
      addDlg.className = "queue-dialog coll-add";
      addDlg.innerHTML =
        '<form novalidate>' +
          '<button type="button" class="close" aria-label="Close">&times;</button>' +
          "<h2>" + esc(CFG.add) + "</h2>" +
          (CFG.scan ? '<div class="lib-scan">' +
            '<button type="button" class="pill-btn lib-scan-btn" hidden>Scan the barcode</button>' +
            '<div class="lib-scan-cam" hidden><video muted playsinline></video><span class="lib-scan-line"></span><button type="button" class="lib-scan-stop">Stop</button></div>' +
            '<div class="lib-upc"><input class="coll-code" type="text" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="or type the ' + (KIND === "books" ? "ISBN" : "barcode") + ' numbers" aria-label="Barcode">' +
              '<button type="button" class="pill-btn coll-code-go">Look up</button></div>' +
          "</div>" : "") +
          '<label for="coll-q">' + (CFG.scan ? "Or search" : "Search") + "</label>" +
          '<input id="coll-q" type="search" autocomplete="off" placeholder="' + esc(CFG.search) + '">' +
          '<p class="coll-msg" role="status"></p>' +
          '<ul class="coll-results" role="listbox" hidden></ul>' +
          '<div class="coll-picked" hidden></div>' +
          // books: the cover to show, from every cover Open Library has for it (like a VHS tape's in the Movie Library)
          (KIND === "books" ? '<div class="lib-covers" hidden><p class="lib-ed-head">Cover <span class="optional">(the picture on the shelf)</span></p>' +
            '<div class="lib-cover-list" role="group" aria-label="Cover"></div></div>' : "") +
          // records: the back of the sleeve (the card turns over to it), from its pressing, other pressings or Discogs
          (KIND === "vinyl" ? '<div class="lib-covers coll-backs" hidden><p class="lib-ed-head">Back cover <span class="optional">(the card turns the sleeve over to it)</span></p>' +
            '<div class="lib-cover-list" role="group" aria-label="Back cover"></div></div>' : "") +
          '<label for="coll-edition">' + esc(CFG.edition) + '</label><input id="coll-edition" type="text" maxlength="80" placeholder="' + esc(CFG.editionHint) + '">' +
          '<label for="coll-note">Note <span class="optional">(optional, shown on its card)</span></label><textarea id="coll-note" rows="2" maxlength="280"></textarea>' +
          // a game: the private Unopened mark, set as it's added (Nick, 2026-10-29)
          (KIND === "games" ? '<label class="coll-unopened coll-add-unopened"><input type="checkbox" id="coll-unopened"> Unopened <small>(only you see this)</small></label>' : "") +
          '<p class="error" role="alert"></p>' +
          '<div class="lib-submits"><button class="pill-btn submit" type="submit" disabled>Add to the library</button>' +
            '<button class="pill-btn submit coll-more" type="submit" data-more="1" disabled>Add + another</button></div>' +
        "</form>";
      document.body.appendChild(addDlg);
      addDlg.querySelector(".close").addEventListener("click", function () { addDlg.close(); });
      addDlg.addEventListener("click", function (e) { if (e.target === addDlg) addDlg.close(); });
      addDlg.addEventListener("close", stopScan);
      addDlg.querySelector("#coll-q").addEventListener("input", function (e) {
        clearTimeout(timer);
        var q = e.target.value.trim();
        timer = setTimeout(function () { find("search?q=" + encodeURIComponent(q), q.length >= 2); }, 700); // (MusicBrainz asks for about one search a second)
      });
      var coverList = addDlg.querySelector(".lib-covers:not(.coll-backs) .lib-cover-list");
      if (coverList) coverList.addEventListener("click", function (e) { var b = e.target.closest("button[data-cover]"); if (b) chooseCover(b.dataset.cover); });

      addDlg.querySelector(".coll-results").addEventListener("click", function (e) {
        var li = e.target.closest("[data-i]");
        if (li) pick(results[+li.dataset.i]);
      });
      addDlg.querySelector("form").addEventListener("submit", submit);
      if (CFG.scan) {
        if ("BarcodeDetector" in window && navigator.mediaDevices) addDlg.querySelector(".lib-scan-btn").hidden = false;
        addDlg.querySelector(".lib-scan-btn").addEventListener("click", startScan);
        addDlg.querySelector(".lib-scan-stop").addEventListener("click", stopScan);
        var code = addDlg.querySelector(".coll-code");
        addDlg.querySelector(".coll-code-go").addEventListener("click", function () { lookUp(code.value); });
        code.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); lookUp(code.value); } });
      }
    }
    clearAdd();
    addDlg.showModal();
    addDlg.querySelector(CFG.scan ? ".coll-code" : "#coll-q").focus();
  }
  function clearAdd() {
    addDlg.querySelector("form").reset();
    picked = null; results = [];
    addDlg.querySelector(".coll-results").hidden = true;
    addDlg.querySelector(".coll-picked").hidden = true;
    coverPick = null; coverSeq++; backPick = null; backSeq++; backReq = null;
    var bb = addDlg.querySelector(".coll-backs");
    if (bb) bb.hidden = true;
    var cb = addDlg.querySelector(".lib-covers");
    if (cb) cb.hidden = true;
    addDlg.querySelector(".coll-msg").textContent = "";
    addDlg.querySelector(".error").textContent = "";
    ready();
  }
  function ready() { [].forEach.call(addDlg.querySelectorAll(".submit"), function (b) { b.disabled = !picked; }); }
  function lookUp(raw) {
    var code = String(raw || "").replace(/[^\dXx]/g, "");
    if (code.length < 8) { addDlg.querySelector(".coll-msg").textContent = "That doesn't look like a barcode. Check the numbers under it."; return; }
    find("barcode?code=" + code, true, true);
  }
  function find(path, ok, byCode) {
    var list = addDlg.querySelector(".coll-results"), msg = addDlg.querySelector(".coll-msg");
    if (!ok) { list.hidden = true; return; }
    var my = ++seq;
    msg.textContent = byCode ? "Looking it up…" : "Searching…";
    // the catalogues can be slow (Open Library now and then takes 10 s or more): say so rather than look stuck
    var slow = setTimeout(function () { if (my === seq) msg.textContent = "Still searching " + CFG.source + " (it can be slow)…"; }, 4000);
    dgFetch(API + "/collection/" + KIND + "/" + path, { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        clearTimeout(slow);
        if (my !== seq) return;
        if (d.error) { msg.textContent = d.error; list.hidden = true; return; }
        results = d.results || [];
        msg.textContent = !results.length ? (byCode ? "Couldn't find that barcode. Search instead." : "No matches.") : byCode && results.length === 1 ? "Found it." : byCode ? "Found " + results.length + ": pick yours." : "";
        list.innerHTML = results.map(function (r, i) {
          return '<li role="option" data-i="' + i + '">' + (r.cover ? '<img src="' + esc(r.cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'noimg\'}))">' : '<span class="noimg"></span>') +
            '<span class="t">' + esc(r.title) + (r.year ? ' <span class="y">(' + r.year + ")</span>" : "") +
            '<span class="s">' + esc([r.creator, r.note].filter(Boolean).join(" · ")) + "</span></span></li>";
        }).join("");
        list.hidden = !results.length;
        if (byCode && results.length === 1) pick(results[0]);
      })
      .catch(function () { clearTimeout(slow); if (my === seq) msg.textContent = "Couldn't reach the server. Try again in a bit."; });
  }
  function pick(r) {
    picked = r;
    addDlg.querySelector(".coll-results").hidden = true;
    var pv = addDlg.querySelector(".coll-picked");
    pv.innerHTML = (r.cover ? '<img src="' + esc(r.cover) + '" alt="" referrerpolicy="no-referrer">' : '<span class="noimg"></span>') +
      "<div><b>" + esc(r.title) + "</b><span>" + esc([r.creator, r.year].filter(Boolean).join(" · ")) + "</span>" + (r.note ? "<small>" + esc(r.note) + "</small>" : "") + "</div>";
    pv.hidden = false;
    if (KIND === "books") findCovers(r);
    if (KIND === "vinyl") findBacks(r);
    var dupe = items.some(function (d) { return d.source === r.id || d.source === String(r.id).split("~")[0]; });
    addDlg.querySelector(".error").textContent = dupe ? "Already in the library." : "";
    ready();
    if (dupe) [].forEach.call(addDlg.querySelectorAll(".submit"), function (b) { b.disabled = true; });
  }
  // a book's covers to pick from: the one it came with straight away, the rest once Open Library answers (slowly)
  var coverPick = null, coverSeq = 0;
  function findCovers(r) {
    var box = addDlg.querySelector(".lib-covers"), list = box.querySelector(".lib-cover-list"), seq = ++coverSeq;
    var first = r.cover ? r.cover.replace(/-[SM]\.jpg$/, "-L.jpg") : "";
    function show(opts, more) {
      if (seq !== coverSeq) return;
      if (first && !opts.some(function (o) { return o.src === first; })) opts = [{ src: first, thumb: r.cover, label: "Its usual cover" }].concat(opts);
      list.innerHTML = opts.map(function (o) {
        return '<button type="button" data-cover="' + esc(o.src) + '" aria-pressed="false" title="' + esc(o.label || "") + '">' +
          '<img src="' + esc(o.thumb) + '" alt="' + esc(o.label || "Cover") + '" loading="lazy"><span>' + esc(o.label || "Cover") + "</span></button>";
      }).join("") + (more ? '<p class="coll-cover-wait">Finding its other covers…</p>' : "");
      // Open Library answers a missing cover with a 1-pixel image, not an error: those go too
      [].forEach.call(list.querySelectorAll("img"), function (img) {
        function drop() { var b = img.closest("button"), was = b.getAttribute("aria-pressed") === "true"; b.remove(); if (was) { var f = list.querySelector("button"); chooseCover(f ? f.dataset.cover : null); } }
        img.addEventListener("error", drop);
        img.addEventListener("load", function () { if (img.naturalWidth < 10) drop(); });
      });
      box.hidden = !opts.length;
      chooseCover(opts.some(function (o) { return o.src === coverPick; }) ? coverPick : opts.length ? opts[0].src : null);
    }
    coverPick = null;
    show([], true);
    fetch(API + "/collection/books/covers?id=" + encodeURIComponent(r.id), { headers: authHeaders() })
      .then(function (res) { return res.json(); })
      .then(function (d) { show(d.covers || [], false); })
      .catch(function () { show([], false); });
  }
  function chooseCover(src) {
    coverPick = src;
    [].forEach.call(addDlg.querySelectorAll(".lib-covers:not(.coll-backs) .lib-cover-list button"), function (b) {
      var on = b.dataset.cover === src;
      b.setAttribute("aria-pressed", String(on));
      if (on) { var pv = addDlg.querySelector(".coll-picked img"); if (pv) pv.src = b.querySelector("img").src; } // the picked book shows it too
    });
  }
  // a record's back: its own pressing's first if it has one, else the most likely (another pressing's labelled back,
  // then Discogs' photos of this pressing, which may be the labels or the inner sleeve: Nick picks), or None.
  // backPick null = not looked up (the Worker keeps the pressing's own), "" = None
  var backPick = null, backSeq = 0, backReq = null, backsOf = {};
  // the choices for a record (Worker /collection/vinyl/backs), asked once per record per visit
  function loadBacks(id) {
    if (!backsOf[id]) backsOf[id] = dgFetch(API + "/collection/vinyl/backs?id=" + encodeURIComponent(id), { headers: authHeaders() })
      .then(function (res) { return res.json(); }).then(function (d) { return d.backs || []; })
      .catch(function () { delete backsOf[id]; return []; });
    return backsOf[id];
  }
  // a row of them (the add dialog's and a card's), with No back last; a picture that won't load just goes
  function backTiles(list, opts, current, onPick, noneText) {
    list.innerHTML = opts.map(function (o) {
      var thumb = pic(o.thumb); // (Discogs' and Apple Music's straight from them)
      return '<button type="button" data-back="' + esc(o.src) + '" aria-pressed="' + (o.src === current) + '" title="' + esc(o.label) + '">' +
        '<img src="' + esc(thumb) + '" alt="' + esc(o.label) + '" loading="lazy" referrerpolicy="no-referrer"><span>' + esc(o.label) + "</span></button>";
    }).join("") + '<button type="button" data-back="" aria-pressed="' + (current === "") + '" class="coll-no-back"><span class="none-box">None</span><span>' + (noneText || "No back") + "</span></button>";
    [].forEach.call(list.querySelectorAll("img"), function (img) {
      img.addEventListener("error", function () { img.closest("button").remove(); });
      // (a shop's "no picture": Amazon's 1-pixel one, Bookshop.org's square placeholder)
      img.addEventListener("load", function () { if (img.naturalWidth < 10 || (/bookshop\.org/.test(img.src) && img.naturalWidth === img.naturalHeight)) { var b = img.closest("button"); if (b) b.remove(); } });
    });
    list.onclick = function (e) {
      var b = e.target.closest("button[data-back]");
      if (!b) return;
      [].forEach.call(list.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      onPick(b.dataset.back);
    };
  }
  function findBacks(r) {
    var box = addDlg.querySelector(".coll-backs"), list = box.querySelector(".lib-cover-list"), seq = ++backSeq;
    backPick = null;
    box.hidden = false;
    list.innerHTML = '<p class="coll-cover-wait">Finding its back cover…</p>';
    // (Add waits for this: Nick 2026-10-25, Cope was added while it was still loading and lost its back)
    backReq = loadBacks(r.id).then(function (opts) {
      if (seq !== backSeq) return;
      if (!opts.length) { box.hidden = true; return; }
      // picked to start with only when it's surely the back: the Cover Art Archive's back of this very pressing (Discogs
      // doesn't say which photo is the back; its scans start unpicked, "No back" until Nick taps one)
      backPick = opts[0].from === "caa" && /^Your pressing/.test(opts[0].label) ? opts[0].src : "";
      backTiles(list, opts, backPick, function (src) { backPick = src; });
    });
  }
  function submit(e) {
    e.preventDefault();
    if (!picked) return;
    var more = !!(e.submitter && e.submitter.dataset.more);
    var btn = more ? addDlg.querySelector(".coll-more") : addDlg.querySelector(".submit"), label0 = btn.textContent, err = addDlg.querySelector(".error");
    [].forEach.call(addDlg.querySelectorAll(".submit"), function (b) { b.disabled = true; });
    btn.textContent = "Getting the details…";
    (KIND === "vinyl" && backReq ? backReq : Promise.resolve()).then(function () { return dgFetch(API + "/collection/" + KIND, {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: picked.id, edition: addDlg.querySelector("#coll-edition").value, note: addDlg.querySelector("#coll-note").value, unopened: KIND === "games" && addDlg.querySelector("#coll-unopened").checked || undefined, cover: coverPick || undefined, back: backPick === null ? undefined : backPick }),
    }); })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.textContent = label0;
        if (!res.ok) { err.textContent = res.j.error || "Couldn't add it."; ready(); return; }
        items.unshift(res.j.item);
        render();
        if (KIND === "vinyl" && discWords(res.j.item)) lookAfterAdd(res.j.item.id); // (its exact colour from its photos, in the background)
        // a record opens on its card straight away (Nick, 2026-11-01: "immediately open the case page for it"), lit on
        // the shelf behind it
        if (!more) { addDlg.close(); glow(res.j.item.id); if (KIND === "vinyl") openItem(res.j.item.id); return; }
        clearAdd();
        addDlg.querySelector(".coll-msg").textContent = "Added " + res.j.item.title + ". Now the next one.";
        if (CFG.scan && !addDlg.querySelector(".lib-scan-btn").hidden) startScan(); else addDlg.querySelector(CFG.scan ? ".coll-code" : "#coll-q").focus();
      })
      .catch(function () { btn.textContent = label0; ready(); err.textContent = "Couldn't reach the server. Try again in a bit."; });
  }
  function glow(id) {
    var b = shelves.querySelector('[data-id="' + id.replace(/"/g, "") + '"]');
    if (!b) return;
    b.scrollIntoView({ behavior: "smooth", block: "center" });
    b.classList.add("just-added");
    setTimeout(function () { b.classList.remove("just-added"); }, 2600);
  }
  // the camera (BarcodeDetector: Chrome on Android and Macs; on iPhones type the numbers)
  function startScan() {
    var cam = addDlg.querySelector(".lib-scan-cam"), video = cam.querySelector("video"), msg = addDlg.querySelector(".coll-msg"), detector;
    try { detector = new BarcodeDetector({ formats: ["ean_13", "upc_a", "ean_8", "upc_e"] }); } catch (e) { msg.textContent = "This browser can't read barcodes. Type the numbers instead."; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } }).then(function (s) {
      stream = s; video.srcObject = s; video.play();
      cam.hidden = false; addDlg.querySelector(".lib-scan-btn").hidden = true;
      msg.textContent = CFG.scanHint;
      (function look() {
        detector.detect(video).then(function (codes) {
          if (!stream) return;
          var code = codes.length && codes[0].rawValue;
          if (code) { if (navigator.vibrate) navigator.vibrate(60); stopScan(); addDlg.querySelector(".coll-code").value = code; lookUp(code); }
          else scanTimer = setTimeout(look, 180);
        }).catch(function () { if (stream) scanTimer = setTimeout(look, 300); });
      })();
    }).catch(function () { msg.textContent = "Couldn't use the camera. Allow it in the browser, or type the numbers."; });
  }
  function stopScan() {
    clearTimeout(scanTimer);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (!addDlg || !CFG.scan) return;
    addDlg.querySelector(".lib-scan-cam").hidden = true;
    addDlg.querySelector(".lib-scan-btn").hidden = !("BarcodeDetector" in window && navigator.mediaDevices);
  }

  // Owner mode: a small copy of every cover that has none (or whose cover changed since), one at a time in the
  // background: drawn at 400 px on its long side through the Worker's /img proxy (so the canvas may read it) and sent
  // to PUT /collection/<kind>/:id/thumb. Discogs' and Apple Music's pictures are left alone (Discogs' aren't copied;
  // Apple's are asked for at 400 px). Runs after the list loads and again after anything changes a cover.
  var thumbing = false;
  function makeThumbs() {
    if (thumbing || !ADMIN) return;
    var d = items.filter(function (x) { return x.cover && !direct(x.cover) && !(x.thumb && x.thumbOf === x.cover) && !x.thumbTried; })[0];
    if (!d) return;
    thumbing = true;
    d.thumbTried = true; // (this visit: one that fails isn't tried again until the next)
    var next = function () { thumbing = false; setTimeout(makeThumbs, 50); };
    var im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = function () {
      var r = Math.min(1, 400 / Math.max(im.naturalWidth, im.naturalHeight));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * r)); c.height = Math.max(1, Math.round(im.naturalHeight * r));
      var x = c.getContext("2d");
      x.imageSmoothingQuality = "high";
      x.drawImage(im, 0, 0, c.width, c.height);
      var of = d.cover;
      try {
        c.toBlob(function (blob) {
          if (!blob) return next();
          fetch(API + "/collection/" + KIND + "/" + encodeURIComponent(d.id) + "/thumb?of=" + encodeURIComponent(of), { method: "PUT", headers: authHeaders({ "Content-Type": "image/jpeg" }), body: blob })
            .then(function (res) { return res.ok ? res.json() : null; })
            // (only its copy is taken, and only while its cover is still the one it was made from: the whole item from this
            // reply could be older than a front Nick picked meanwhile; Nick, 2026-10-31)
            .then(function (j) { if (j && j.item) items.forEach(function (y) { if (y.id === j.item.id && y.cover === of) { y.thumb = j.item.thumb; y.thumbOf = j.item.thumbOf; } }); next(); }, next);
        }, "image/jpeg", 0.82);
      } catch (e) { next(); } // (a picture the canvas may not read)
    };
    im.onerror = next;
    im.src = /^https:/.test(d.cover) ? API + "/img?u=" + encodeURIComponent(d.cover) : d.cover;
  }

  // ---------- go ----------
  var listReady = fetch(API + "/collection/" + KIND, { headers: authHeaders() }) // (signed in: with the owner's own marks, like Unopened) // (not "ready": that's the add dialog's button switch)
    .then(function (r) { return r.json(); })
    .then(function (d) { items = d.items || []; render(); if (ADMIN) makeThumbs(); if (KIND === "vinyl") makeDeck(); return items; })
    .catch(function () { shelves.innerHTML = '<p class="coll-empty">Couldn’t load the ' + esc(CFG.plural) + " right now.</p>"; return []; });

  // For the poster wall (wall.js, Library mode, like the Movie Library's): every cover, once the list is in; a
  // click opens that item's card
  window.NMLibrary = {
    name: { vinyl: "Vinyl", books: "Books", games: "Board games" }[KIND],
    noun: CFG.plural,
    ratio: KIND === "books" ? 1.5 : 1, // records and boxes square, books 2:3
    wallItems: function () {
      return listReady.then(function (list) {
        return list.filter(function (d) { return d.cover; }).map(function (d) {
          return { src: small(d), title: d.title, year: d.year || "", section: d.creator || "", id: d.id, ratio: KIND === "books" ? 1.5 : 1 }; // (each tile's shape)
        });
      });
    },
    open: openItem,
  };
  render();
  if (ADMIN) ownerBar();
  else if (params.has("admin")) login();
})();
