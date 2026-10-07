// Movies > Library: every disc Nick owns (movies/library/discs.js, from tools/discs.py), shelved like a video store.
// Aisles along the top (All A–Z, New Arrivals, genres, Criterion, Box Sets & TV) plus format chips and a search; each
// aisle has a hanging sign, and the cases stand face out on shelves. A case's top band shows its format (Blu-ray blue,
// 4K black, DVD grey). Click one for the back of the case: blurb, cast, edition, and a link to Nick's review if the
// movie's on the Movies page. Movies in Nick's All Time Favorites wear a "Nick's Pick" sticker.
// "Pick for tonight" opens a random case from the aisle you're in.
// Discs added on the site (owner mode: ?admin, same password as Movies/Games) come from the Worker (GET /library,
// worker/src/library.js) and join the shelves; Remove on the back of a case deletes a site-added disc or hides an
// imported one. New discs are only added this way now (the My Movies import was one time).
(function () {
  var script = document.currentScript;
  var root = document.getElementById("library");
  if (!root) return;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var base = (window.DISCS || []).slice(); // discs.js
  var site = [], hidden = [];             // from the Worker
  var discs = base.slice();
  var countEl = document.getElementById("lib-count");

  // the shelves: discs.js minus hidden ones, plus site-added, in sort-title order (as tools/discs.py sorts)
  function sortKey(d) { return String(d.sort || d.title).toLowerCase().replace(/[^a-z0-9 ]/g, ""); }
  // A film on both Blu-ray and 4K is shelved once, as the 4K (Nick, 1.3): the Blu-ray is left off the shelves (it's
  // still in discs.js / the Worker). Matched by IMDb id, or title + year. Applies to site-added discs too.
  function filmKey(d) { return d.imdbId || norm(d.title) + "|" + (d.year || ""); }
  function rebuild() {
    var gone = {}, has4k = {};
    hidden.forEach(function (id) { gone[id] = true; });
    var all = base.filter(function (d) { return !gone[d.id]; }).concat(site);
    all.forEach(function (d) { if (d.format === "4k") has4k[filmKey(d)] = true; });
    discs = all.filter(function (d) { return !(d.format === "bluray" && has4k[filmKey(d)]); }).sort(function (a, b) {
      var x = sortKey(a), y = sortKey(b);
      return x < y ? -1 : x > y ? 1 : (a.year || 0) - (b.year || 0);
    });
  }
  rebuild(); // straight away, before the Worker's discs arrive

  // Discs added on the site have no spine colour yet (the import measures covers with ffmpeg; the Worker can't decode
  // images): measure it here, the same way, from the cover's left edge and the logo's brightness, through a canvas.
  // The cover comes through the Worker's /img proxy and TMDB's images allow it, so the canvas isn't tainted.
  function lumOf(r, g, b) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }
  function pixels(src, w, h, crop) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          var x = c.getContext("2d");
          var sw = crop ? img.naturalWidth * crop : img.naturalWidth;
          x.drawImage(img, 0, 0, sw, img.naturalHeight, 0, 0, w, h);
          resolve(x.getImageData(0, 0, w, h).data);
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }
  function hsl(r, g, b) { // 0-1 each
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function rgbOf(h, s, l) {
    function f(n) { var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }
    return [f(0), f(8), f(4)];
  }
  function spineFor(d) {
    var cover = /^https?:/.test(d.cover) ? API + "/img?u=" + encodeURIComponent(d.cover) : d.cover;
    return Promise.all([pixels(cover, 1, 1, 0.12), d.logo ? pixels(d.logo, 120, 40) : null]).then(function (px) {
      if (!px[0]) return;
      var y = null, sum = 0, n = 0;
      if (px[1]) for (var i = 0; i < px[1].length; i += 4) if (px[1][i + 3] >= 160) { sum += lumOf(px[1][i], px[1][i + 1], px[1][i + 2]); n++; }
      if (n) y = sum / n;
      var c = hsl(px[0][0], px[0][1], px[0][2]), s = Math.min(c[1], 0.75);
      var dark = rgbOf(c[0], s, Math.min(Math.max(c[2], 0.12), 0.30));
      var contrast = function (a, b) { return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      var light = y !== null && contrast(y, lumOf(dark[0], dark[1], dark[2])) < 1.8; // same rule as tools/discs.py
      var rgb = light ? rgbOf(c[0], s, Math.min(Math.max(c[2], 0.74), 0.86)) : dark;
      d.spine = "#" + rgb.map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
      d.spineLight = light;
    });
  }
  function colourSiteDiscs() {
    var todo = site.filter(function (d) { return d.cover && !d.spine; });
    if (todo.length) Promise.all(todo.map(spineFor)).then(function () { if (state.view === "spines") render(); });
  }

  // ---------- owner mode ----------
  var params = new URLSearchParams(location.search);
  var ADMIN = null;
  try {
    if (params.has("logout")) localStorage.removeItem("nm-admin-token");
    ADMIN = localStorage.getItem("nm-admin-token");
  } catch (e) {}
  if (params.has("logout")) history.replaceState(null, "", location.pathname + location.hash);
  function authHeaders(h) {
    h = h || {};
    if (ADMIN) h.Authorization = "Bearer " + ADMIN;
    return h;
  }

  var FORMAT = { "4k": "4K Ultra HD", bluray: "Blu-ray", dvd: "DVD", vhs: "VHS" };
  var FORMATS = ["4k", "bluray", "dvd", "vhs"]; // best first: the order of the chips, counts and add options
  // DVDs were on the shelves with nothing saying "DVD" in 1.3 (no format chip, count, band, label, or add option);
  // since 1.4 they're shown like the rest, and VHS tapes joined them (Nick). false hides DVDs again.
  var SHOW_DVD = true;
  function fmtName(f) { return f === "dvd" && !SHOW_DVD ? "" : FORMAT[f]; }
  // combo-pack editions name the DVD too ("Blu-ray + Blu-ray 3D + DVD + Digital Copy")
  function edition(d) { return SHOW_DVD ? d.edition || "" : String(d.edition || "").replace(/\s*\+\s*DVD\b|\bDVD\s*\+\s*/g, "").trim(); }
  var BAND = { "4k": "<b>4K</b> Ultra HD", bluray: "Blu-ray", dvd: "DVD", vhs: "<b>VHS</b>" };
  // HDR on a 4K disc (d.hdr, from blu-ray.com: tools/hdr.py, or the Worker for discs added on the site), best first
  var HDR = { dv: "Dolby Vision", "hdr10+": "HDR10+", hdr10: "HDR10" };
  function hdrOf(d) { return Object.keys(HDR).filter(function (k) { return (d.hdr || []).indexOf(k) >= 0; }); }
  // genre aisles, in this order, if at least MIN_AISLE discs are in them. Just the classic video store six (Nick, 1.3:
  // 15 was too many for one row); every disc is still in All A–Z and search.
  var GENRES = ["Action", "Comedy", "Drama", "Horror", "Sci-Fi", "Thriller"];
  var MIN_AISLE = 6, NEW_COUNT = 24;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(t) {
    return String(t).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function letter(d) {
    var c = norm(d.sort || d.title).charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }
  function month(date) {
    var m = /^(\d{4})-(\d\d)/.exec(date || "");
    return m ? MONTHS[+m[2] - 1] + " " + m[1] : "";
  }
  function runtime(min) {
    return min ? (min >= 60 ? Math.floor(min / 60) + "h " : "") + (min % 60 ? (min % 60) + "m" : "") : "";
  }

  // Nick's Movies page: All Time Favorites get the sticker; any section with the movie gets a "My review" link
  var picks = {}, onMovies = {};
  // Nick's Picks beyond his Movies All Time Favorites (Nick, 1.3), by exact disc title
  ["Apocalypto", "Alien", "Donnie Darko", "The Fountain", "Kill Bill: The Whole Bloody Affair", "Lawless", "Layer Cake",
    "Office Space", "Seven Psychopaths", "Southland Tales", "The Wolf of Wall Street"].forEach(function (t) { picks[norm(t)] = true; });
  function loadMovies() {
    return fetch("/movies/list.js")
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (code) {
        var w = {};
        try { new Function("window", code)(w); } catch (e) {}
        (w.SECTIONS || []).forEach(function (sec) {
          (sec.items || []).forEach(function (it) {
            var k = norm(it.title);
            if (/all time favorites/i.test(sec.title || "")) picks[k] = true;
            if (!onMovies[k] && sec.title && sec.live !== "queue") onMovies[k] = sec.title;
          });
        });
      })
      .catch(function () {});
  }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  // ---------- aisles and filters ----------
  var aisles = [{ key: "all", name: "All A–Z" }, { key: "new", name: "New Arrivals" }];
  GENRES.forEach(function (g) {
    var n = discs.filter(function (d) { return (d.genres || []).indexOf(g) >= 0; }).length;
    if (n >= MIN_AISLE) aisles.push({ key: "g:" + g, name: g });
  });
  if (discs.some(function (d) { return d.criterion; })) aisles.push({ key: "criterion", name: "Criterion" });
  if (discs.some(function (d) { return d.kind === "box" || d.kind === "tv"; })) aisles.push({ key: "box", name: "Box Sets & TV" });
  aisles.push({ key: "picks", name: "Nick's Picks" });

  var state = { aisle: "all", format: "", q: "", view: "covers" };
  try { if (localStorage.getItem("nm-lib-view") === "spines") state.view = "spines"; } catch (e) {} // remembered per visitor
  var saved = /[#&]aisle=([^&]+)/.exec(location.hash);
  if (saved && aisles.some(function (a) { return a.key === decodeURIComponent(saved[1]); })) state.aisle = decodeURIComponent(saved[1]);

  root.innerHTML =
    '<div class="lib-bar">' +
      '<div class="lib-aisles" role="toolbar" aria-label="Aisles">' +
        aisles.map(function (a) { return '<button type="button" data-aisle="' + esc(a.key) + '">' + esc(a.name) + "</button>"; }).join("") +
      "</div>" +
      '<div class="lib-tools">' +
        '<div class="lib-formats" role="group" aria-label="Format">' +
          '<button type="button" data-format="">All formats</button>' +
          '<button type="button" data-format="4k" class="f-4k">4K</button>' +
          // Dolby Vision (Nick, 1.4): 4K discs with it, between 4K and Blu-ray
          '<button type="button" data-format="dv" class="f-dv">Dolby Vision</button>' +
          '<button type="button" data-format="bluray" class="f-bluray">Blu-ray</button>' +
          (SHOW_DVD ? '<button type="button" data-format="dvd" class="f-dvd">DVD</button>' : "") +
          '<button type="button" data-format="vhs" class="f-vhs">VHS</button>' +
        "</div>" +
        // Covers (cases facing out) or Spines (cases on their side, many more to a shelf)
        '<div class="lib-view" role="group" aria-label="View">' +
          '<button type="button" data-view="covers"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="2" width="6" height="12" rx="1"/><rect x="9" y="2" width="6" height="12" rx="1"/></svg>Covers</button>' +
          '<button type="button" data-view="spines"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="2" width="2.5" height="12" rx=".6"/><rect x="4.5" y="2" width="2.5" height="12" rx=".6"/><rect x="8" y="2" width="2.5" height="12" rx=".6"/><rect x="11.5" y="2" width="3.5" height="12" rx=".6"/></svg>Spines</button>' +
        "</div>" +
        '<label class="lib-search"><span class="sr-only">Search the library</span>' +
          '<input type="search" placeholder="Search titles, directors, actors" autocomplete="off"></label>' +
        '<button type="button" class="open lib-pick">Pick for tonight</button>' +
        '<button type="button" class="open lib-add-btn" hidden><span aria-hidden="true">+</span> Add a disc</button>' +
      "</div>" +
      '<nav class="lib-letters" aria-label="Jump to a letter" hidden></nav>' + // A–Z view only, pinned with the rest
    "</div>" +
    '<div class="lib-shelves" aria-live="polite"></div>';

  var shelves = root.querySelector(".lib-shelves");
  var search = root.querySelector(".lib-search input");

  root.querySelector(".lib-aisles").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    // the same for the aisles: clicking the open one goes back to All A–Z
    state.aisle = b.dataset.aisle === state.aisle && b.dataset.aisle !== "all" ? "all" : b.dataset.aisle;
    try { history.replaceState(null, "", state.aisle === "all" ? location.pathname : "#aisle=" + encodeURIComponent(state.aisle)); } catch (err) {}
    render();
  });
  root.querySelector(".lib-formats").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    // clicking the one that's on turns it off again (back to All formats)
    state.format = b.dataset.format === state.format ? "" : b.dataset.format;
    render();
  });
  root.querySelector(".lib-view").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || b.dataset.view === state.view) return;
    state.view = b.dataset.view;
    try { localStorage.setItem("nm-lib-view", state.view); } catch (err) {}
    render();
  });
  var typing = null;
  search.addEventListener("input", function () {
    clearTimeout(typing);
    typing = setTimeout(function () { state.q = norm(search.value); render(); }, 120);
  });
  root.querySelector(".lib-pick").addEventListener("click", function () {
    var list = visible();
    if (list.length) openCase(list[Math.floor(Math.random() * list.length)], true);
  });

  function matches(d) {
    if (state.format === "dv") { if ((d.hdr || []).indexOf("dv") < 0) return false; }
    else if (state.format && d.format !== state.format) return false;
    if (state.q) {
      var hay = norm([d.title, d.director, (d.starring || []).join(" "), d.edition, (d.films || []).join(" ")].join(" "));
      if (hay.indexOf(state.q) < 0) return false;
    }
    var a = state.aisle;
    if (a === "new" || a === "all") return true;
    if (a === "criterion") return !!d.criterion;
    if (a === "box") return d.kind === "box" || d.kind === "tv";
    if (a === "picks") return !!picks[norm(d.title)];
    if (a.indexOf("g:") === 0) return (d.genres || []).indexOf(a.slice(2)) >= 0;
    return true;
  }
  function visible() {
    var list = discs.filter(matches);
    if (state.aisle === "new" && !state.q) {
      list = list.slice().sort(function (a, b) { return String(b.added || "").localeCompare(String(a.added || "")); }).slice(0, NEW_COUNT);
    }
    return list;
  }

  // ---------- shelves ----------
  function caseHtml(d, big) {
    var stickers = "";
    if (picks[norm(d.title)]) stickers += '<span class="sticker pick">Nick’s Pick</span>';
    // bottom right: a box set's sticker (the HDR isn't on the front: Nick, 1.4; it's on the back of the case and the
    // Dolby Vision chip)
    if (d.kind === "box") stickers += '<span class="case-tags"><span class="sticker box">Box set' + (d.discs > 1 ? " · " + d.discs + " discs" : "") + "</span></span>";
    // box set covers are store photos of the real front, format banner included (tools/discs.py)
    var retail = d.kind === "box" && d.cover;
    var noBand = !fmtName(d.format); // a DVD while they're hidden: the cover fills the case, like a box set's
    return '<span class="case f-' + d.format + (picks[norm(d.title)] ? " picked" : "") + (d.steelbook ? " steel" : "") + (d.criterion ? " criterion" : "") + (retail || noBand && d.cover ? " retail" : "") +
      (noBand ? " no-band" : "") + (big ? " big" : "") + '">' +
      '<span class="case-band">' + BAND[d.format] + (d.threeD ? ' <i>3D</i>' : "") + "</span>" +
      // the blurred fill behind a box set's cover: an absolute URL, since url() in a CSS variable resolves against the
      // stylesheet (assets/css/), not this page
      '<span class="case-art"' + (retail || noBand && d.cover ? ' style="--art:url(\'' + esc(/^(https?:)?\/\//.test(d.cover) || d.cover.charAt(0) === "/" ? d.cover : "/movies/library/" + d.cover) + '\')"' : "") + ">" +
        (d.cover ? '<img src="' + esc(d.cover) + '" alt="" loading="lazy" decoding="async">'
          : d.parts ? '<span class="case-parts n' + d.parts.length + '">' + d.parts.map(function (src) { // a set with no cover: its films' posters
              return '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">';
            }).join("") + "</span>"
          : '<span class="case-card"><b>' + esc(d.title) + "</b>" + (d.year ? "<small>" + d.year + "</small>" : "") + "</span>") +
      "</span>" +
      stickers +
    "</span>";
  }
  function slot(d) {
    var label = [d.title + (d.year ? " (" + d.year + ")" : ""), fmtName(d.format), edition(d)].filter(Boolean).join(", ");
    return '<li class="slot">' +
      '<button type="button" class="slot-btn" data-id="' + esc(d.id) + '" aria-label="' + esc(label) + '">' + caseHtml(d) + "</button>" +
      '<span class="ledge" aria-hidden="true"></span>' +
      '<span class="slot-title" aria-hidden="true">' + esc(d.title) + "</span>" +
      '<span class="slot-meta" aria-hidden="true">' + [d.year, fmtName(d.format)].filter(Boolean).join(" · ") + "</span>" +
    "</li>";
  }
  // Since 1.3 each case shows the film's real title logo (TMDB) on its cover's edge colour where the import found one
  // (d.logo, d.spine, d.spineLight = a light case for a dark logo); the rest keep the text title.
  // Spine view: the cases stand side by side like a bookshelf (Nick, 1.3: tried upright text spines, then flat stacks of
  // 6, then back to upright once the spines had real logos). Each spine: the format's cap at the top (the white 4K
  // block, the Blu-ray blue), the logo turned to run down the spine (or the title, top to bottom), the year at the
  // bottom. Box sets are thicker by their disc count. Same borders as the covers (pick, Criterion, steelbook) and the
  // same .slot-btn, so clicking opens the case.
  function tone(t) {
    var h = 0;
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 997;
    return h % 5;
  }
  function spineSlot(d, startsLetter) {
    var label = [d.title + (d.year ? " (" + d.year + ")" : ""), fmtName(d.format), edition(d)].filter(Boolean).join(", ");
    var wide = d.kind === "box" ? Math.min(10, d.discs || 3) : 0;
    var cap = d.format === "4k" ? "4K" : d.format === "bluray" ? "BD" : d.format === "vhs" ? "VHS" : SHOW_DVD ? "DVD" : "";
    // A–Z in Spines (1.4): one continuous shelf; the first spine of each letter carries the letter above it (and the
    // jump links' target)
    return '<li class="spine-slot' + (startsLetter ? " letter-start" : "") + '">' +
      (startsLetter ? '<span class="spine-letter" id="aisle-' + (startsLetter === "#" ? "0" : startsLetter) + '">' + esc(startsLetter) + "</span>" : "") +
      '<button type="button" class="slot-btn spine f-' + d.format + (picks[norm(d.title)] ? " picked" : "") + (d.criterion ? " criterion" : "") +
        (d.steelbook ? " steel" : "") + (d.spineLight ? " light" : "") + (d.logo ? " has-logo" : "") +
        '" data-id="' + esc(d.id) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' +
        ' style="--tone:' + tone(d.title) + ";--wide:" + wide +
        (d.spine ? ";--spine:" + esc(d.spine) : "") + '">' + // the colour of its cover's edge (tools/discs.py)
        (cap ? '<span class="spine-cap" aria-hidden="true">' + cap + "</span>" : "") +
        // the film's real title logo (TMDB, via tools/discs.py), else its title
        (d.logo ? '<span class="spine-title spine-logo" aria-hidden="true"><img src="' + esc(d.logo) + '" alt="" loading="lazy" decoding="async"></span>'
          : '<span class="spine-title" aria-hidden="true">' + esc(d.title) + "</span>") +
        (d.year ? '<span class="spine-year" aria-hidden="true">' + d.year + "</span>" : "") +
      "</button>" +
      '<span class="ledge" aria-hidden="true"></span>' +
    "</li>";
  }
  function aisleHtml(sign, list, id) {
    var spines = state.view === "spines";
    return '<section class="aisle"' + (id ? ' id="' + id + '"' : "") + ">" +
      '<h2 class="aisle-sign"><span>' + esc(sign) + "</span></h2>" +
      '<ul class="shelf' + (spines ? " spines" : "") + '">' + list.map(spines ? spineSlot : slot).join("") + "</ul></section>";
  }

  function render() {
    [].forEach.call(root.querySelectorAll("[data-aisle]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.aisle === state.aisle)); });
    [].forEach.call(root.querySelectorAll("[data-format]"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.format === state.format));
      // a format with nothing on the shelves yet (VHS until the first tape) has no chip
      var f = b.dataset.format;
      b.hidden = !!f && f !== state.format && !discs.some(function (d) { return f === "dv" ? (d.hdr || []).indexOf("dv") >= 0 : d.format === f; });
    });
    [].forEach.call(root.querySelectorAll("[data-view]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.view === state.view)); });
    var list = visible();
    var aisle = aisles.filter(function (a) { return a.key === state.aisle; })[0];
    var html = "", letters = "";
    if (!list.length) {
      html = '<p class="lib-empty">Nothing on this shelf' + (state.q ? " matches “" + esc(search.value) + "”" : "") + ".</p>";
    } else if (state.aisle === "all" && !state.q) {
      // A–Z: a sign per letter, with quick links to each
      var groups = [], at = {};
      list.forEach(function (d) {
        var L = letter(d);
        if (!(L in at)) { at[L] = groups.length; groups.push({ L: L, items: [] }); }
        groups[at[L]].items.push(d);
      });
      letters = groups.map(function (g) {
        return '<a href="#aisle-' + (g.L === "#" ? "0" : g.L) + '">' + g.L + "</a>";
      }).join("");
      html = state.view === "spines"
        ? '<section class="aisle aisle-flow"><ul class="shelf spines">' + groups.map(function (g) {
            return g.items.map(function (d, i) { return spineSlot(d, i === 0 ? g.L : null); }).join("");
          }).join("") + "</ul></section>"
        : groups.map(function (g) { return aisleHtml(g.L, g.items, "aisle-" + (g.L === "#" ? "0" : g.L)); }).join("");
    } else if (state.aisle === "new" && !state.q) {
      var byMonth = [], idx = {};
      list.forEach(function (d) {
        var m = month(d.added) || "Earlier";
        if (!(m in idx)) { idx[m] = byMonth.length; byMonth.push({ m: m, items: [] }); }
        byMonth[idx[m]].items.push(d);
      });
      html = byMonth.map(function (g) { return aisleHtml("New · " + g.m, g.items); }).join("");
    } else {
      html = aisleHtml(state.q ? "Search: " + search.value.trim() : aisle.name, list);
    }
    shelves.innerHTML = html;
    var nav = root.querySelector(".lib-letters");
    nav.innerHTML = letters;
    nav.hidden = !letters;
    var counts = { "4k": 0, bluray: 0, dvd: 0, vhs: 0 };
    discs.forEach(function (d) { counts[d.format]++; });
    countEl.innerHTML = "<b>" + discs.length + "</b> on the shelves: " +
      FORMATS.filter(function (f) { return counts[f] && fmtName(f); }).map(function (f) { return counts[f] + " " + FORMAT[f]; }).join(" · ") +
      (list.length !== discs.length && list.length ? '<span class="lib-showing"> · showing ' + list.length + "</span>" : "");
  }

  shelves.addEventListener("click", function (e) {
    var b = e.target.closest(".slot-btn");
    if (!b) return;
    var d = discs.filter(function (x) { return x.id === b.dataset.id; })[0];
    if (d) openCase(d, false, b);
  });

  // ---------- the back of the case ----------
  var dialog = document.createElement("dialog");
  dialog.className = "lib-dialog";
  document.body.appendChild(dialog);
  var opener = null;
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog || e.target.closest(".close")) dialog.close();
    if (window.NMTrailer && NMTrailer.click(e, dialog)) return;
    var more = e.target.closest(".lib-more");
    if (more) {
      var box = more.closest(".lib-about-box");
      // "expanded", not "open": .open is the site's pill-button class (one line, no wrapping)
      var open = !box.classList.contains("expanded");
      box.classList.toggle("expanded", open);
      more.textContent = open ? "Show less" : "Show more";
      more.setAttribute("aria-expanded", String(open));
      return;
    }
    var film = e.target.closest(".lib-film");
    if (film) {
      var own = discs.filter(function (x) { return x.id === film.dataset.id; })[0];
      if (own) openCase(own, false, opener);
      return;
    }
    var rm = e.target.closest(".remove");
    if (rm) removeDisc(rm);
    if (e.target.closest(".again")) {
      var list = visible();
      if (list.length) openCase(list[Math.floor(Math.random() * list.length)], true);
    }
  });
  dialog.addEventListener("close", function () {
    if (window.NMTrailer) NMTrailer.stop(dialog); // no trailer playing on behind a closed case
    if (opener) opener.focus({ preventScroll: true });
  });
  // the film's official trailer (trailer.js): looked up once the case is open, its button added when there is one
  var films = {};
  function addTrailer(d) {
    if (!d.imdbId || !API || !window.NMTrailer) return;
    var q = d.imdbId;
    if (!films[q]) films[q] = fetch(API + "/library/film?imdb=" + encodeURIComponent(q)).then(function (r) { return r.json(); }).catch(function () { return {}; });
    films[q].then(function (f) { if (dialog.open && dialog.dataset.disc === d.id && f.trailer) NMTrailer.addTo(dialog, f.trailer, d.title); });
  }
  // Once the case has turned over, drop the 3D animation: Chrome can keep drawing the layer from its blurry mid-turn
  // raster (the Nick's Pick ribbon's small rotated text showed it); without the class it repaints sharp
  dialog.addEventListener("animationend", function (e) { if (e.target.classList.contains("lib-back")) dialog.classList.remove("flip"); });

  // A box set's films (tools/discs.py BOX_SETS). One that's also on the shelves by itself opens that disc.
  function setList(d) {
    if (!d.films || !d.films.length) return "";
    return '<div class="lib-set"><h3>In this set <span>' + d.films.length + " films</span></h3><ol>" + d.films.map(function (f) {
      var own = discs.filter(function (x) { return x !== d && norm(x.title) === norm(f); })[0];
      return "<li>" + (own ? '<button type="button" class="lib-film" data-id="' + esc(own.id) + '" title="Also on the shelves by itself">' + esc(f) + "</button>" : esc(f)) + "</li>";
    }).join("") + "</ol></div>";
  }

  function openCase(d, tonight, from) {
    opener = from || root.querySelector(".lib-pick");
    var k = norm(d.title);
    var facts = [d.year, runtime(d.minutes), d.rated].filter(Boolean);
    var disc = [fmtName(d.format)].concat(hdrOf(d).map(function (k) { return HDR[k]; })).concat([d.threeD ? "3D" : "", d.steelbook ? "Steelbook" : "", edition(d), d.discs > 1 ? d.discs + " discs" : "",
      d.boxSet ? "From the " + d.boxSet.replace(/^The /, "") : ""]).filter(Boolean); // boxSet: tools/discs.py BOX_SETS
    var paras = String(d.about || "").split(/\n\n/).filter(Boolean);
    var links = [];
    if (onMovies[k]) links.push('<a class="open" href="/movies/#' + slug(onMovies[k]) + '">On my Movies page · ' + esc(onMovies[k]) + "</a>");
    if (d.imdbId) links.push('<a class="open" href="https://www.imdb.com/title/' + esc(d.imdbId) + '/" target="_blank" rel="noopener">IMDb</a>');
    dialog.innerHTML =
      '<div class="lib-back">' +
        '<button type="button" class="close" aria-label="Close">&times;</button>' +
        '<div class="lib-front">' + caseHtml(d, true) + "</div>" +
        '<div class="lib-info">' +
          (tonight ? '<p class="lib-tonight">Tonight’s pick</p>' : "") +
          "<h2>" + esc(d.title) + "</h2>" +
          (facts.length ? '<p class="lib-facts">' + facts.map(function (f, i) {
            return i === 2 && d.rated ? '<span class="rated">' + esc(f) + "</span>" : esc(f);
          }).join(" · ") + "</p>" : "") +
          (disc.length ? '<p class="lib-disc f-' + d.format + '">' + esc(disc.join(" · ")) + "</p>" : "") +
          (d.tagline ? '<p class="lib-tagline">' + esc(d.tagline) + "</p>" : "") +
          // the synopsis, a few lines tall and fading out, with Show more (Nick, 1.3: it used to run on before the details)
          (paras.length ? '<div class="lib-about-box"><div class="lib-about-text">' +
            paras.map(function (p) { return '<p class="lib-about">' + esc(p) + "</p>"; }).join("") + "</div>" +
            '<button type="button" class="lib-more" aria-expanded="false" hidden>Show more</button></div>' : "") +
          (d.aboutUrl ? '<p class="lib-source"><a href="' + esc(d.aboutUrl) + '" target="_blank" rel="noopener">From Wikipedia</a></p>' : "") +
          // what's actually on this edition of the disc (the My Movies export's Extra Features, tools/discs.py)
          (d.features && d.features.length ? '<div class="lib-features"><h3>On this disc</h3><ul>' +
            d.features.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul></div>" : "") +
          setList(d) +
          '<dl class="lib-credits">' +
            (d.director ? "<dt>Director</dt><dd>" + esc(d.director) + "</dd>" : "") +
            (d.starring && d.starring.length ? "<dt>Starring</dt><dd>" + esc(d.starring.join(", ")) + "</dd>" : "") +
            (d.genres && d.genres.length ? "<dt>Genres</dt><dd>" + esc(d.genres.join(", ")) + "</dd>" : "") +
            (d.studio ? "<dt>Studio</dt><dd>" + esc(d.studio) + "</dd>" : "") +
          "</dl>" +
          (links.length || tonight ? '<p class="lib-links">' + links.join("") +
            (tonight ? '<button type="button" class="open again">Pick another</button>' : "") + "</p>" : "") +
          (ADMIN ? '<p class="lib-owner"><button type="button" class="remove" data-id="' + esc(d.id) + '">Remove from the shelves</button></p>' : "") +
        "</div>" +
      "</div>";
    if (!dialog.open) dialog.showModal();
    dialog.dataset.disc = d.id;
    addTrailer(d);
    // Show more only when the synopsis is actually cut short
    var aboutText = dialog.querySelector(".lib-about-text");
    if (aboutText && aboutText.scrollHeight > aboutText.clientHeight + 4) dialog.querySelector(".lib-more").hidden = false;
    else if (aboutText) aboutText.parentNode.classList.add("short");
    dialog.querySelector(".lib-back").scrollTop = 0;
    dialog.classList.remove("flip");
    void dialog.offsetWidth;
    dialog.classList.add("flip"); // the case turns over (site.css)
  }

  // ---------- adding and removing (owner mode) ----------
  function ownerBar() {
    var bar = document.createElement("div");
    bar.className = "owner-bar";
    bar.innerHTML = '<span>Owner mode</span> <a href="?logout">Log out</a>';
    var head = document.querySelector(".page-head");
    head.parentNode.insertBefore(bar, head.nextSibling);
    root.querySelector(".lib-add-btn").hidden = false;
  }
  function login() {
    var d = document.createElement("dialog");
    d.className = "queue-dialog";
    d.innerHTML =
      '<form novalidate><h2>Owner login</h2>' +
      '<p class="hint">Enter your admin password. This browser will remember it.</p>' +
      '<label for="lib-admin">Password</label><input id="lib-admin" type="password" autocomplete="current-password">' +
      '<p class="error" role="alert"></p><button class="open submit" type="submit">Log in</button></form>';
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
        d.close();
        ownerBar();
      }).catch(function () { err.textContent = "Couldn't reach the server."; });
    });
    d.showModal();
    input.focus();
  }

  function removeDisc(btn) {
    var d = discs.filter(function (x) { return x.id === btn.dataset.id; })[0];
    if (!d || !confirm("Take " + d.title + (fmtName(d.format) ? " (" + fmtName(d.format) + ")" : "") + " off the shelves?")) return;
    btn.disabled = true;
    btn.textContent = "Removing…";
    fetch(API + "/library/" + encodeURIComponent(d.id), { method: "DELETE", headers: authHeaders() })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (res) {
        if (res.hidden) hidden.push(res.hidden);
        site = site.filter(function (x) { return x.id !== d.id; });
        rebuild();
        render();
        opener = null;
        dialog.close();
      })
      .catch(function () { btn.disabled = false; btn.textContent = "Couldn't remove it. Try again"; });
  }

  // The add dialog: search IMDb (films and series), pick one, pick the format and any extras, add.
  var addDlg = null, picked = null, searchTimer = null, searchSeq = 0;
  function openAdd() {
    if (!addDlg) {
      addDlg = document.createElement("dialog");
      addDlg.className = "queue-dialog lib-add";
      addDlg.innerHTML =
        '<form novalidate>' +
          '<button class="close" type="button" aria-label="Close">&times;</button>' +
          "<h2>Add a disc</h2>" +
          '<p class="hint">It goes on the shelves (and New Arrivals) right away.</p>' +
          // Scan the barcode (1.4): the exact release, so the title, format, edition and HDR fill in themselves
          '<div class="lib-scan">' +
            '<button type="button" class="open lib-scan-btn" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M16 8v8"/></svg>Scan the barcode</button>' +
            '<div class="lib-scan-cam" hidden><video muted playsinline></video><span class="lib-scan-line"></span>' +
              '<button type="button" class="lib-scan-stop">Stop</button></div>' +
            '<div class="lib-upc"><input id="lib-upc" type="text" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="or type the barcode numbers" aria-label="Barcode">' +
              '<button type="button" class="open lib-upc-go">Look up</button></div>' +
            '<p class="lib-scan-msg" role="status"></p>' +
          "</div>" +
          '<div class="pick-preview" hidden><div class="pp-art"><img alt=""></div><div class="pp-what"></div></div>' +
          '<label for="lib-q">Movie or series</label>' +
          '<div class="combo"><input id="lib-q" type="text" autocomplete="off" placeholder="Start typing a title" role="combobox" aria-expanded="false" aria-controls="lib-results" aria-autocomplete="list">' +
          '<ul id="lib-results" role="listbox" hidden></ul></div>' +
          '<fieldset class="who lib-format"><legend>Format</legend>' +
            '<label><input type="radio" name="lib-format" value="4k">4K</label>' +
            '<label><input type="radio" name="lib-format" value="bluray">Blu-ray</label>' +
            (SHOW_DVD ? '<label><input type="radio" name="lib-format" value="dvd">DVD</label>' : "") +
            '<label><input type="radio" name="lib-format" value="vhs">VHS</label>' +
          "</fieldset>" +
          // 4K only: ticked from blu-ray.com when a title (or an edition) is picked; untick or tick to correct it
          '<fieldset class="who lib-hdr" hidden><legend>HDR <span class="optional lib-hdr-note"></span></legend>' +
            '<label><input type="checkbox" name="hdr" value="dv">Dolby Vision</label>' +
            '<label><input type="checkbox" name="hdr" value="hdr10+">HDR10+</label>' +
            '<label><input type="checkbox" name="hdr" value="hdr10">HDR10</label>' +
          "</fieldset>" +
          '<fieldset class="who lib-extras"><legend>Extras</legend>' +
            '<label><input type="checkbox" name="steelbook">Steelbook</label>' +
            '<label><input type="checkbox" name="threeD">3D</label>' +
            '<label><input type="checkbox" name="criterion">Criterion</label>' +
          "</fieldset>" +
          // the film's editions on TheDiscDb: picking one fills in its extras (and the format and edition name, if blank)
          '<div class="lib-editions" hidden><p class="lib-ed-head">Which edition? <span class="optional">(from TheDiscDb)</span></p><div class="lib-ed-list"></div></div>' +
          '<label for="lib-edition">Edition <span class="optional">(optional)</span></label>' +
          '<input id="lib-edition" type="text" maxlength="80" placeholder="e.g. Collector\u2019s Edition">' +
          '<label for="lib-features">On this disc <span class="optional">(optional, one per line)</span></label>' +
          '<textarea id="lib-features" rows="4" placeholder="Behind-the-scenes documentary\nDeleted scenes\nTrailer"></textarea>' +
          '<p class="error" role="alert"></p>' +
          '<button class="open submit" type="submit" disabled>Add to the shelves</button>' +
        "</form>";
      document.body.appendChild(addDlg);
      var q = addDlg.querySelector("#lib-q");
      addDlg.querySelector(".close").addEventListener("click", function () { addDlg.close(); });
      addDlg.addEventListener("click", function (e) { if (e.target === addDlg) addDlg.close(); });
      q.addEventListener("input", function () {
        picked = null;
        scanned = null;
        addDlg.querySelector(".pick-preview").hidden = true;
        addDlg.querySelector(".lib-editions").hidden = true;
        check();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { findTitles(q.value.trim()); }, 220);
      });
      addDlg.querySelector("#lib-results").addEventListener("click", function (e) {
        var li = e.target.closest("[role=option]");
        if (li) pick(results[+li.dataset.i]);
      });
      addDlg.querySelector("form").addEventListener("change", function (e) {
        if (e.target.name === "hdr") hdrTouched = true; // Nick's ticks win over a lookup still on its way
        check();
        if (e.target.name === "lib-format") findHdr();
      });
      addDlg.querySelector(".lib-ed-list").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-ed]");
        if (!b) return;
        var ed = editionsFound[+b.dataset.ed];
        [].forEach.call(addDlg.querySelectorAll(".lib-ed-list button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        addDlg.querySelector("#lib-features").value = ed.features.join("\n");
        var name = addDlg.querySelector("#lib-edition");
        if (!name.value.trim() && ed.title && !/^\d{4}\s/.test(ed.title)) name.value = ed.title.replace(/\s*\b(4K|UHD|Blu-?ray)\b\s*$/i, "");
        var f = ed.format && addDlg.querySelector('input[name="lib-format"][value="' + ed.format + '"]');
        if (f && !addDlg.querySelector('input[name="lib-format"]:checked')) f.checked = true;
        if (ed.upc) hdrUpc = ed.upc; // that exact edition's HDR
        check();
        findHdr();
      });
      addDlg.querySelector("form").addEventListener("submit", submitAdd);
      addDlg.addEventListener("close", stopScan);
      if ("BarcodeDetector" in window && navigator.mediaDevices) addDlg.querySelector(".lib-scan-btn").hidden = false;
      addDlg.querySelector(".lib-scan-btn").addEventListener("click", startScan);
      addDlg.querySelector(".lib-scan-stop").addEventListener("click", stopScan);
      var upc = addDlg.querySelector("#lib-upc");
      addDlg.querySelector(".lib-upc-go").addEventListener("click", function () { lookUpBarcode(upc.value); });
      upc.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); lookUpBarcode(upc.value); } });
    }
    addDlg.querySelector("form").reset();
    picked = null;
    hdrUpc = "";
    hdrFor = "";
    addDlg.querySelector(".pick-preview").hidden = true;
    addDlg.querySelector("#lib-results").hidden = true;
    addDlg.querySelector(".lib-editions").hidden = true;
    addDlg.querySelector(".error").textContent = "";
    addDlg.querySelector(".lib-scan-msg").textContent = "";
    scanned = null;
    check();
    addDlg.showModal();
    addDlg.querySelector("#lib-q").focus();
  }

  var results = [];
  function findTitles(text) {
    var listEl = addDlg.querySelector("#lib-results");
    if (text.length < 2) { listEl.hidden = true; return; }
    var seq = ++searchSeq;
    fetch(API + "/library/search?q=" + encodeURIComponent(text), { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (seq !== searchSeq) return; // a newer search is on its way
        results = data.results || [];
        listEl.innerHTML = results.length ? results.map(function (r, i) {
          return '<li role="option" data-i="' + i + '">' +
            (r.image ? '<img src="' + esc(r.image.replace(/\._V1_.*\.jpg$/, "._V1_UX96_.jpg")) + '" alt="" loading="lazy">' : '<span class="noimg"></span>') +
            '<span class="t">' + esc(r.title) + (r.year ? ' <span class="y">(' + r.year + ")</span>" : "") + (r.series ? ' <span class="y">· series</span>' : "") +
            '<span class="s">' + esc(r.stars) + "</span></span></li>";
        }).join("") : '<li class="none">No matches on IMDb</li>';
        listEl.hidden = false;
        addDlg.querySelector("#lib-q").setAttribute("aria-expanded", "true");
      })
      .catch(function () {});
  }

  function pick(r) {
    picked = r;
    var q = addDlg.querySelector("#lib-q");
    q.value = r.title + (r.year ? " (" + r.year + ")" : "");
    q.setAttribute("aria-expanded", "false");
    addDlg.querySelector("#lib-results").hidden = true;
    var pv = addDlg.querySelector(".pick-preview");
    pv.querySelector("img").src = r.image ? r.image.replace(/\._V1_.*\.jpg$/, "._V1_UX200_.jpg") : "";
    pv.querySelector(".pp-what").innerHTML = "<b>" + esc(r.title) + "</b>" + (r.year ? "<span>" + r.year + "</span>" : "");
    pv.hidden = false;
    hdrUpc = "";
    check();
    findEditions(r);
    findHdr();
  }

  // A 4K disc's HDR from blu-ray.com (Worker GET /library/hdr): by the picked edition's barcode, else the title.
  // Ticks the boxes; Nick can change them. Asked once per title + barcode.
  var hdrUpc = "", hdrFor = "", hdrTouched = false, hdrSeq = 0;
  function findHdr() {
    var f = addDlg.querySelector('input[name="lib-format"]:checked');
    var note = addDlg.querySelector(".lib-hdr-note");
    if (!picked || !f || f.value !== "4k") return;
    var key = picked.id + "|" + hdrUpc;
    if (key === hdrFor) return;
    hdrFor = key;
    hdrTouched = false;
    var seq = ++hdrSeq, r = picked;
    note.textContent = "(checking blu-ray.com…)";
    fetch(API + "/library/hdr?title=" + encodeURIComponent(r.title) + "&year=" + (r.year || "") + "&upc=" + encodeURIComponent(hdrUpc), { headers: authHeaders() })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (seq !== hdrSeq || picked !== r) return;
        note.textContent = data.found ? "(from blu-ray.com)" : "(not found on blu-ray.com: tick what the case says)";
        if (!data.found || hdrTouched) return;
        [].forEach.call(addDlg.querySelectorAll('input[name="hdr"]'), function (c) { c.checked = (data.hdr || []).indexOf(c.value) >= 0; });
      })
      .catch(function () { if (seq === hdrSeq) note.textContent = "(couldn’t check: tick what the case says)"; });
  }

  // ---------- the barcode (1.4) ----------
  // The camera (BarcodeDetector: Chrome on Android and Macs; not iPhones yet, where typing the numbers works) reads
  // the barcode; the Worker finds that release on blu-ray.com (GET /library/barcode), and the dialog fills in.
  var scanStream = null, scanTimer = null, scanned = null;
  function startScan() {
    var cam = addDlg.querySelector(".lib-scan-cam"), video = cam.querySelector("video"), msg = addDlg.querySelector(".lib-scan-msg");
    var detector;
    try { detector = new BarcodeDetector({ formats: ["upc_a", "ean_13", "ean_8", "upc_e"] }); } catch (e) { msg.textContent = "This browser can't read barcodes. Type the numbers instead."; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } }).then(function (stream) {
      scanStream = stream;
      video.srcObject = stream;
      video.play();
      cam.hidden = false;
      addDlg.querySelector(".lib-scan-btn").hidden = true;
      msg.textContent = "Point it at the barcode on the back of the case.";
      (function look() {
        detector.detect(video).then(function (codes) {
          if (!scanStream) return;
          var code = codes.length && codes[0].rawValue;
          if (code) {
            if (navigator.vibrate) navigator.vibrate(60);
            stopScan();
            addDlg.querySelector("#lib-upc").value = code;
            lookUpBarcode(code);
          } else scanTimer = setTimeout(look, 180);
        }).catch(function () { if (scanStream) scanTimer = setTimeout(look, 300); });
      })();
    }).catch(function () { msg.textContent = "Couldn't use the camera. Allow it in the browser, or type the numbers."; });
  }
  function stopScan() {
    clearTimeout(scanTimer);
    if (scanStream) scanStream.getTracks().forEach(function (t) { t.stop(); });
    scanStream = null;
    if (!addDlg) return;
    addDlg.querySelector(".lib-scan-cam").hidden = true;
    addDlg.querySelector(".lib-scan-btn").hidden = !("BarcodeDetector" in window && navigator.mediaDevices);
  }
  function lookUpBarcode(raw) {
    var code = String(raw || "").replace(/\D/g, ""), msg = addDlg.querySelector(".lib-scan-msg");
    if (!code) return;
    msg.textContent = "Looking up " + code + "…";
    fetch(API + "/library/barcode?upc=" + code, { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error && !d.found) { msg.textContent = d.error; return; }
        if (!d.found || !d.imdbId) { msg.textContent = "Not found on blu-ray.com (VHS tapes never are). Search by title below."; return; }
        // the title for the preview: IMDb's own search result for it (its poster), else just the name
        return fetch(API + "/library/search?q=" + encodeURIComponent(d.title), { headers: authHeaders() })
          .then(function (r) { return r.json(); })
          .catch(function () { return {}; })
          .then(function (res) {
            var r = (res.results || []).filter(function (x) { return x.id === d.imdbId; })[0] ||
              { id: d.imdbId, title: d.title, year: d.year, image: null };
            scanned = d;
            pick(r);
            var form = addDlg.querySelector("form");
            var f = form.querySelector('input[name="lib-format"][value="' + d.format + '"]');
            if (f) f.checked = true;
            form.querySelector("#lib-edition").value = d.edition || "";
            form.steelbook.checked = !!d.steelbook;
            form.criterion.checked = !!d.criterion;
            // its HDR came with it: no second lookup
            hdrUpc = d.upc;
            hdrFor = r.id + "|" + d.upc;
            hdrSeq++;
            [].forEach.call(form.querySelectorAll('input[name="hdr"]'), function (c) { c.checked = (d.hdr || []).indexOf(c.value) >= 0; });
            addDlg.querySelector(".lib-hdr-note").textContent = "(from blu-ray.com)";
            msg.textContent = "Found: " + d.title + (d.year ? " (" + d.year + ")" : "") + ", " + FORMAT[d.format] + (d.edition ? ", " + d.edition : "") + ".";
            check();
          });
      })
      .catch(function () { msg.textContent = "Couldn't reach the server. Try again in a bit."; });
  }

  // TheDiscDb's editions of the picked film (Worker GET /library/editions); none found keeps the section hidden
  var editionsFound = [], edSeq = 0;
  function findEditions(r) {
    var box = addDlg.querySelector(".lib-editions"), list = box.querySelector(".lib-ed-list");
    box.hidden = true;
    editionsFound = [];
    var seq = ++edSeq;
    fetch(API + "/library/editions?imdbId=" + encodeURIComponent(r.id), { headers: authHeaders() })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (seq !== edSeq || !picked || picked.id !== r.id) return;
        editionsFound = (data.editions || []).filter(function (e) { return e.features.length; });
        if (!editionsFound.length) return;
        list.innerHTML = editionsFound.map(function (e, i) {
          return '<button type="button" data-ed="' + i + '" aria-pressed="false"><b>' + esc(e.title || "Edition") + "</b>" +
            "<span>" + [e.year, e.format ? FORMAT[e.format] : "", e.features.length + " extras"].filter(Boolean).join(" · ") + "</span></button>";
        }).join("");
        box.hidden = false;
        // a scanned barcode that TheDiscDb knows: that edition, picked (its extras fill in)
        var same = scanned && editionsFound.map(function (e) { return e.upc; }).indexOf(scanned.upc);
        if (same >= 0) list.querySelector('button[data-ed="' + same + '"]').click();
      })
      .catch(function () {});
  }

  // ready once a title and a format are picked; says so if that title is already on the shelves in that format
  function check() {
    var f = addDlg.querySelector('input[name="lib-format"]:checked');
    var err = addDlg.querySelector(".error");
    var dupe = picked && f && discs.some(function (d) {
      return d.format === f.value && (d.imdbId === picked.id || norm(d.title) === norm(picked.title) && (!d.year || d.year === picked.year));
    });
    err.textContent = dupe ? "Already on the shelves in " + FORMAT[f.value] + "." : "";
    addDlg.querySelector(".lib-hdr").hidden = !(f && f.value === "4k"); // HDR is a 4K thing
    addDlg.querySelector(".submit").disabled = !(picked && f) || dupe;
  }

  function submitAdd(e) {
    e.preventDefault();
    var form = addDlg.querySelector("form");
    var f = form.querySelector('input[name="lib-format"]:checked');
    if (!picked || !f) return;
    var btn = form.querySelector(".submit"), err = form.querySelector(".error");
    btn.disabled = true;
    btn.textContent = "Getting the details…";
    err.textContent = "";
    fetch(API + "/library", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        imdbId: picked.id,
        format: f.value,
        edition: form.querySelector("#lib-edition").value,
        steelbook: form.steelbook.checked,
        threeD: form.threeD.checked,
        criterion: form.criterion.checked,
        features: form.querySelector("#lib-features").value,
        hdr: f.value === "4k" ? [].map.call(form.querySelectorAll('input[name="hdr"]:checked'), function (c) { return c.value; }) : [],
      }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btn.textContent = "Add to the shelves";
        if (!res.ok) { err.textContent = res.d.error || "Couldn't add it."; btn.disabled = false; return; }
        site.unshift(res.d.item);
        rebuild();
        render();
        colourSiteDiscs();
        addDlg.close();
        showNew(res.d.item);
      })
      .catch(function () { btn.textContent = "Add to the shelves"; btn.disabled = false; err.textContent = "Couldn't reach the server. Try again in a bit."; });
  }

  // after adding: bring the new case into view and glow it
  function showNew(d) {
    var b = shelves.querySelector('.slot-btn[data-id="' + d.id + '"]');
    if (!b) return;
    b.scrollIntoView({ behavior: "smooth", block: "center" });
    b.classList.add("just-added");
    setTimeout(function () { b.classList.remove("just-added"); }, 2600);
  }

  // For the poster wall (wall.js, Library mode): every disc's cover, and a way to open its case
  window.NMLibrary = {
    wallItems: function () {
      return discs.filter(function (d) { return d.cover || (d.parts && d.parts.length); }).map(function (d) {
        var src = d.cover || d.parts[0];
        return {
          src: /^(https?:)?\/\//.test(src) || src.charAt(0) === "/" ? src : "/movies/library/" + src,
          title: d.title, year: d.year || "", section: d.kind === "box" ? "Box set" : fmtName(d.format), id: d.id,
        };
      });
    },
    open: function (id) {
      var d = discs.filter(function (x) { return x.id === id; })[0];
      if (d) openCase(d, false, shelves.querySelector('.slot-btn[data-id="' + id + '"]'));
    },
  };

  root.querySelector(".lib-add-btn").addEventListener("click", openAdd);
  if (ADMIN) ownerBar();
  else if (params.has("admin")) login();

  render();
  // A link to one disc (1.4, e.g. from Nick's Office): /movies/library/#disc=<its id> opens its case
  var openedFromLink = false;
  function openFromHash() {
    var m = /[#&]disc=([^&]+)/.exec(location.hash);
    if (!m || openedFromLink && !openFromHash.again) return false;
    var id = decodeURIComponent(m[1]), d = discs.filter(function (x) { return x.id === id; })[0];
    if (!d) return false;
    openedFromLink = true;
    // the page goes down to it on its shelf (glowing, like a new arrival) behind the open case
    var b = shelves.querySelector('.slot-btn[data-id="' + id + '"]');
    if (b) {
      b.scrollIntoView({ block: "center" });
      b.classList.add("just-added");
      setTimeout(function () { b.classList.remove("just-added"); }, 4000);
    }
    openCase(d, false, b);
    return true;
  }
  openFromHash();
  window.addEventListener("hashchange", function () { openFromHash.again = true; openFromHash(); });
  loadMovies().then(function () { render(); if (dialog.open) return; openFromHash(); }); // stickers and review links once the Movies list is in
  fetch(API + "/library")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      site = data.items || [];
      hidden = data.hidden || [];
      rebuild();
      render();
      colourSiteDiscs();
      if (!openedFromLink) openFromHash(); // a disc added on the site
    })
    .catch(function () { /* the Worker is down: just discs.js */ });
})();
