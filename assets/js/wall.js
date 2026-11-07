// Movies and Games: "Poster wall". The header's Poster wall pill (see below) opens every poster on the page edge to
// edge in a slowly drifting mosaic: columns scroll endlessly, alternating up and down, at slightly different speeds,
// tilted a little. No text until you hover a poster (title, year, section, rating); hovering a column pauses it.
// Clicking a poster closes the wall and scrolls to it on the page. Esc or × closes. The order is shuffled each time.
// Posters are read from the page when the wall opens, so it includes the live sections (Recently Watched, queue, ...).
// With reduced motion it's a still, scrollable grid.
//
// Music page: the same wall with square album covers: every album in the playlists on the page (Worker GET
// /music/covers, which reads them from Spotify) plus Recently Listened and Community Recs, one tile per album.
// Hovering shows album, artist and where it's from; clicking plays that song in a small Spotify player at the bottom
// of the wall (a 30-second preview for visitors not signed in to Spotify) instead of jumping to it on the page.
//
// Extras page: 16:9 tiles: the newest Trackman rounds (up to 40) from the Golf page (extras/golf/trackman.js, loaded
// when the wall opens) as course photos with the score on them. (Until 2026-10-25 a Montage Maker clip led it.) Clicking one jumps to that project's card.
//
// Play page (1.3): 16:9 tiles of the two games: their gameplay clips (play/wall/) plus 5 stills from each clip, so the
// wall (and the background) isn't just two pictures. Clicking one jumps to that game's card.
//
// Photography page: 3:2 tiles of every photo in the sections (their 800px copies); clicking one jumps to it.
//
// Library > Movies: every disc's cover (from library.js, window.NMLibrary), 2:3; clicking one opens its case.
// Library > Vinyl, Books, Board games (1.7): the same way, from collection.js's window.NMLibrary (its name, noun and
// tile shape: records and games square, books 2:3); clicking one opens its card.
// Library (the hub, 1.7): a mix of all four, each in its own shape like Home's; clicking one goes to its shelf.
//
// Home page: an even mix of six of the pages (not the Library, 1.7) (the same number from each: movie and game posters from their
// list.js, album covers from the Worker, photos from photos.js, Extras' Trackman rounds), each tile in its own
// shape (2:3, square, 3:2, 16:9); clicking one goes to its page. Home has no top bar, so the header control floats
// at the top right.
//
// Header control (every page, right end of the top bar; floating top right on Home): a "Poster wall" pill that opens
// the interactive wall, with a switch at its end that changes the page background between black and the same wall, running behind everything, dimmed to BG_DIM, with no hover, captions, clips or clicks (at most BG_MAX
// tiles). It's on by default; switching it off is remembered in this browser (localStorage nm-wall-bg "0"), as is
// switching it back on, on every page with a wall. Browsers set to save data start with it off. Walls load the
// small copies from tools/thumbs.py (see thumb()).
(function () {
  var script = document.currentScript;
  var MUSIC = document.body.classList.contains("page-music");
  var EXTRAS = document.body.classList.contains("page-extras");
  var PLAY = document.body.classList.contains("page-play");
  var CLIPS_PAGE = EXTRAS || PLAY; // 16:9 tiles, clips that play while visible
  var PHOTOS = document.body.classList.contains("page-photography");
  var LIBRARY = document.body.classList.contains("page-library");
  var HUB = document.body.classList.contains("page-library-hub");
  var LIB = window.NMLibrary || {}; // (the Library pages' scripts come before this one)
  var HOME = !!document.querySelector("main.home");
  var root = HOME ? document.querySelector("main.home") : CLIPS_PAGE ? document.querySelector("main.content > section")
    : HUB ? document.querySelector(".hub-aisles") : LIBRARY ? document.getElementById("library") || document.getElementById("collection")
    : document.getElementById(MUSIC ? "playlists" : PHOTOS ? "photos" : "entries");
  if (!root) return;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var NAME = HOME ? "NickMade" : MUSIC ? "Music" : EXTRAS ? "Extras" : PLAY ? "Play" : PHOTOS ? "Photography" : HUB ? "Library" : LIBRARY ? LIB.name || "Library" : document.body.classList.contains("page-games") ? "Games" : "Movies";
  var NOUN = HOME ? "from across the site" : MUSIC ? "album covers" : EXTRAS ? "golf rounds" : PLAY ? "clips" : PHOTOS ? "photos" : HUB ? "from every shelf" : LIBRARY ? LIB.noun || "discs" : "posters";
  var RATIO = HOME || HUB ? 1 : LIBRARY && LIB.ratio ? LIB.ratio : MUSIC ? 1 : CLIPS_PAGE ? 9 / 16 : PHOTOS ? 2 / 3 : 1.5; // tile height / width (Home: each tile has its own)
  var COL_W = CLIPS_PAGE ? 280 : PHOTOS ? 240 : 190; // about how wide a column is
  var BG_DIM = 0.25, BG_MAX = PHOTOS ? 40 : 80; // background: brightness (0-1) and the most tiles it uses (photos are 800px files)
  var ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="4" height="6" rx="1"/><rect x="6" y="1" width="4" height="9" rx="1"/>' +
    '<rect x="11" y="1" width="4" height="5" rx="1"/><rect x="1" y="8" width="4" height="7" rx="1"/><rect x="6" y="11" width="4" height="4" rx="1"/><rect x="11" y="7" width="4" height="8" rx="1"/></svg>';
  var SPEED = [16, 22]; // px per second, a random speed in this range for each column
  // The BACKGROUND comes from one picture per page made ahead of time (Nick, 2026-11-07: the live background took 1-2 s,
  // dozens of separate covers from the Worker, TMDB and R2 on every visit): tools/make_walls.py takes the same pictures
  // the background would pick, packs them into assets/walls/<page>.webp (a grid of cells, `cols` across, each `w` wide
  // and `h` tall, the picture at the cell's top left) and writes this line: per page its version, cell size, count and
  // each tile's shape (one ratio for the page, or a letter per tile: a 2:3, b square, c 3:2, d 16:9). Each tile shows
  // its cell of that one picture; the interactive wall (Poster wall) still reads everything live.
  var SPRITES = {"games":{"cols":8,"h":270,"n":48,"r":1.5,"v":"202611070020","w":180},"home":{"cols":8,"h":270,"n":48,"r":"cabdaaddddbcdadbbcaaaddbaccaaabddbbdcdddbdcdacda","v":"202611070020","w":180},"library":{"cols":8,"h":270,"n":48,"r":"bbbbabaaaabaaabbbabbbaabbbaaababaaaababbbabbaaaa","v":"202611070020","w":180},"library-board-games":{"cols":8,"h":270,"n":48,"r":1.0,"v":"202611070020","w":180},"library-books":{"cols":8,"h":270,"n":48,"r":1.5,"v":"202611070020","w":180},"library-movies":{"cols":8,"h":270,"n":48,"r":1.5,"v":"202611070020","w":180},"library-vinyl":{"cols":8,"h":270,"n":48,"r":1.0,"v":"202611070020","w":180},"movies":{"cols":8,"h":270,"n":41,"r":1.5,"v":"202611070020","w":180},"music":{"cols":8,"h":270,"n":48,"r":1.0,"v":"202611070020","w":180},"photography":{"cols":8,"h":270,"n":40,"r":0.6667,"v":"202611070020","w":180}}; // WALLS (tools/make_walls.py rewrites this line)
  var KEY = location.pathname.replace(/index\.html$/, "").replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "home"; // "library-vinyl"
  var SHAPE = { a: 1.5, b: 1, c: 2 / 3, d: 9 / 16 };
  function spriteItems() {
    var sp = SPRITES[KEY];
    if (!sp || !sp.n) return null;
    var url = "/assets/walls/" + KEY + ".webp?v=" + sp.v, rows = Math.ceil(sp.n / sp.cols), H = rows * sp.h, out = [];
    for (var i = 0; i < sp.n; i++) {
      var r = typeof sp.r === "number" ? sp.r : SHAPE[sp.r.charAt(i)] || 1.5;
      var col = i % sp.cols, row = Math.floor(i / sp.cols), th = sp.w * r;
      out.push({ sprite: url, ratio: r, bgSize: sp.cols * 100 + "% auto",
        bgPos: (sp.cols > 1 ? col / (sp.cols - 1) * 100 : 0) + "% " + (H > th ? row * sp.h / (H - th) * 100 : 0) + "%" });
    }
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function text(el) { return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }

  // ---------- the header control: the grid icon opens the interactive wall ("Poster wall" slides out beside it on
  // hover or focus), the switch beside it turns the
  // background on and off. At the right end of the top bar (Home has none: it floats at the top right). ----------
  var ctl = document.createElement("div");
  ctl.className = "wall-ctl";
  ctl.setAttribute("role", "group");
  ctl.setAttribute("aria-label", "Poster wall");
  ctl.innerHTML =
    '<button type="button" class="wall-open" aria-label="Open the poster wall">' + ICON + '<span class="wall-label" aria-hidden="true">Poster wall</span></button>' +
    '<button type="button" class="bg-toggle" role="switch"><span class="knob" aria-hidden="true"></span></button>';
  var open = ctl.querySelector(".wall-open");
  var toggle = ctl.querySelector(".bg-toggle");
  var bar = document.querySelector(".topbar");
  if (bar) bar.appendChild(ctl);
  else { ctl.classList.add("floating"); document.body.appendChild(ctl); } // Home: no top bar
  open.addEventListener("click", show);

  // ---------- what's on the page ----------
  function collect() {
    var seen = {}, out = [];
    [].forEach.call(root.querySelectorAll("section.subsection"), function (sec) {
      var section = text(sec.querySelector(".subhead span"));
      [].forEach.call(sec.querySelectorAll(".poster"), function (fig) {
        var img = fig.querySelector(".art img");
        if (!img || fig.closest("[hidden]")) return; // no art, or hidden (a played queue game, a removed favorite)
        var host = fig.closest(".entry") || fig; // review layout: the poster sits in an .entry with the title in h3
        var title = text(fig.querySelector(".title")) || text(host.querySelector("h3")) || host.dataset.title || "";
        var k = title.toLowerCase();
        if (!title || seen[k]) return; // the same title in two sections shows once
        seen[k] = true;
        var stars = fig.querySelector(".rating");
        var score = host.querySelector(".score");
        out.push({
          src: img.currentSrc || img.src,
          title: title,
          year: text(fig.querySelector(".year")) || (text(host.querySelector(".meta")).match(/^\d{4}/) || [""])[0],
          section: section,
          rating: stars ? stars.outerHTML : score ? '<span class="score">' + esc(text(score)) + "</span>" : "",
          el: host,
        });
      });
    });
    return out;
  }
  // Music: album covers from the playlists (the Worker, fetched once and kept) and the song lists on the page
  var coversReq = null;
  function playlistCovers() {
    if (!coversReq) {
      coversReq = fetch(API + "/music/covers")
        .then(function (r) { return r.ok ? r.json() : { albums: [] }; })
        .then(function (d) { return d.albums || []; })
        .catch(function () { coversReq = null; return []; });
    }
    return coversReq;
  }
  function collectMusic() {
    return playlistCovers().then(function (albums) {
      var seen = {}, out = [];
      function add(p) { if (p.src && !seen[p.src]) { seen[p.src] = true; out.push(p); } } // one tile per cover (album)
      [[".recent .recent-list li", "Recently Listened"], [".rec-list li", "Community Recs"]].forEach(function (src) {
        [].forEach.call(root.querySelectorAll(src[0]), function (li) {
          var img = li.querySelector(".recent-art img");
          var id = li.dataset.id || (li.dataset.key || "").split("@")[0];
          if (img && id) add({ src: img.src, title: text(li.querySelector(".recent-title")), artist: text(li.querySelector(".recent-artist")), section: src[1], trackId: id });
        });
      });
      albums.forEach(function (a) { add({ src: a.image, title: a.album, artist: a.artist, section: a.playlist, trackId: a.trackId }); });
      return out;
    });
  }
  if (MUSIC && API) setTimeout(playlistCovers, 1500); // warm it up so the wall opens straight away

  // Extras: the Trackman rounds (the Video Game Montage Maker's clip went with the app, 2026-10-25)
  // Play: each game's clip and 5 stills taken from it (play/wall/<game>-1.jpg ... -5.jpg)
  var GAMES = [
    { slug: "cats", title: "The Cattery" }, // 1.6, first on the page
    { slug: "office", title: "Nick\u2019s Office" }, // 1.4
    { slug: "nicks-nine", title: "Nick's Nine" },
    { slug: "rapture", title: "Rapture: ADAM & Dice" },
  ];
  function collectPlay() {
    var out = [];
    GAMES.forEach(function (g) {
      out.push({ video: "/play/wall/" + g.slug + ".mp4", src: "/play/wall/" + g.slug + ".jpg", title: g.title, section: "Gameplay", el: card(g.title) });
      for (var n = 1; n <= 5; n++) out.push({ src: "/play/wall/" + g.slug + "-" + n + ".jpg", title: g.title, section: "Screenshot", el: card(g.title) });
    });
    return out;
  }
  var roundsReq = null;
  function golfRounds() {
    if (!roundsReq) roundsReq = loadData("/extras/golf/trackman.js", "GOLF_TRACKMAN").then(function (r) { if (!r) roundsReq = null; return r || []; });
    return roundsReq;
  }
  // Run one of the site's data files (window.X = ...) against a stand-in window and return X, so several can load at
  // once without overwriting each other (movies and games list.js both set SECTIONS) or this page's own globals
  function loadData(src, name) {
    return fetch(src)
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (code) { var w = {}; try { new Function("window", code)(w); } catch (e) {} return w[name]; })
      .catch(function () { return undefined; });
  }
  function card(title) {
    return [].find.call(root.querySelectorAll("article.project"), function (a) { return text(a.querySelector("h2")) === title; }) || root;
  }
  var ROUNDS = 40; // the newest rounds
  function collectExtras(maxRounds) {
    return golfRounds().then(function (rounds) {
      var out = [];
      rounds.filter(function (r) { return !r.hidden && r.image && r.score; })
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })
        .slice(0, maxRounds || ROUNDS).forEach(function (r) {
        var d = new Date(r.date + "T00:00:00");
        var toPar = r.toPar == null ? "" : r.toPar === 0 ? "E" : (r.toPar > 0 ? "+" : "") + r.toPar;
        out.push({
          src: "/extras/golf/" + r.image, title: r.course, el: card("Golf"),
          section: (isNaN(d) ? r.date : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })) + " · Trackman",
          score: '<span class="wall-score"><b>' + esc(r.score) + "</b>" + (toPar ? "<span>" + esc(toPar) + (r.net ? " net" : "") + "</span>" : "") + "</span>",
        });
      });
      return out;
    });
  }

  // Photography: the photos in the sections
  function collectPhotos() {
    var out = [];
    [].forEach.call(root.querySelectorAll(".photo-section"), function (sec) {
      var title = text(sec.querySelector(".subhead span"));
      [].forEach.call(sec.querySelectorAll("a.photo"), function (a) {
        var img = a.querySelector("img");
        if (img) out.push({ src: img.src, title: title, section: "", el: a });
      });
    });
    return out;
  }
  // Home: the same number from each of the five pages, read from their data files
  var HOME_EACH = 16;
  function absolute(src, base) { return /^(https?:)?\/\//.test(src) || src.charAt(0) === "/" ? src : base + src; }
  // the posters in a page's list.js
  function listPosters(page, name) {
    return loadData("/" + page + "/list.js", "SECTIONS").then(function (sections) {
      var seen = {}, out = [];
      (sections || []).forEach(function (sec) {
        (sec.items || []).forEach(function (it) {
          if (!it.image || seen[it.title]) return;
          seen[it.title] = true;
          out.push({ src: absolute(it.image, "/" + page + "/"), title: it.title, year: it.year || "", section: name, href: "/" + page + "/", ratio: 1.5 });
        });
      });
      return out;
    });
  }
  var homeReq = null;
  function collectHome() {
    if (homeReq) return homeReq;
    // all five at once
    homeReq = Promise.all([
      listPosters("movies", "Movies"),
      listPosters("games", "Games"),
      playlistCovers().then(function (albums) {
        return albums.map(function (a) { return { src: a.image, title: a.album, artist: a.artist, section: "Music", href: "/music/", ratio: 1 }; });
      }),
      // photos.js plus the ones added on the site, minus the ones removed there (Worker GET /photos, 1.4)
      Promise.all([
        loadData("/photography/photos.js", "PHOTOS"),
        API ? fetch(API + "/photos").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }) : {},
      ]).then(function (got) {
        var gone = {};
        (got[1].hidden || []).forEach(function (n) { gone[n] = true; });
        var photos = (got[1].items || []).concat((got[0] || []).filter(function (ph) {
          return !gone[String(ph.src).split("/").pop().replace(/\.[a-z]+$/i, "")];
        }));
        return photos.map(function (ph) {
          var small = ph.sizes && ph.sizes.length ? ph.sizes[0].src : ph.src;
          return { src: absolute(small, "/photography/"), title: "Photography", section: "", href: "/photography/", ratio: 2 / 3 };
        });
      }),
      collectExtras(HOME_EACH).then(function (extras) {
        return extras.map(function (x) { return Object.assign({}, x, { el: null, href: "/extras/", ratio: 9 / 16, section: x.video ? "Extras · " + x.section : x.section }); });
      }),
      Promise.resolve(collectPlay().map(function (x) { return Object.assign({}, x, { el: null, href: "/play/", ratio: 9 / 16, section: "Play · " + x.section }); })),
    ]).then(function (picks) {
      // the same number from each page (Extras: every clip, then rounds to fill its share)
      var out = [];
      picks.forEach(function (list) {
        var clips = list.filter(function (x) { return x.video; });
        out = out.concat(clips, shuffle(list.filter(function (x) { return !x.video; })).slice(0, HOME_EACH - clips.length));
      });
      return out;
    });
    return homeReq;
  }

  // Library hub: every shelf's covers, up to 40 from each, each tile its own shape; a click goes to that shelf
  var hubReq = null;
  var HUB_KEY = "nm-wall-hub";
  // a shelf cover's small copy (collection.js small())
  function smallCover(d) {
    if (d.thumb && d.thumbOf === d.cover) return d.thumb;
    if (/^https:\/\/is\d-ssl\.mzstatic\.com\//.test(d.cover || "")) return d.cover.replace(/\/\d+x\d+[a-z]*\.(jpg|png|webp)$/, "/400x400bb.jpg");
    return d.cover;
  }
  function collectHub() {
    if (hubReq) return hubReq;
    var get = function (path) { return API ? fetch(API + path).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }) : Promise.resolve({}); };
    var SHELF = { vinyl: ["Vinyl", "/library/vinyl/", 1], books: ["Books", "/library/books/", 1.5], games: ["Board games", "/library/board-games/", 1] };
    // the Library page's own downloads when it made them (library/index.html window.NMHubData), else fetched here
    var D = window.NMHubData;
    var fresh = Promise.all(D ? [D.discs, D.library, D.vinyl, D.books, D.games]
      : [loadData("/library/movies/discs.js", "DISCS"), get("/library"), get("/collection/vinyl"), get("/collection/books"), get("/collection/games")]).then(function (x) {
      var gone = {};
      (x[1].hidden || []).forEach(function (id) { gone[id] = true; });
      var discs = (x[0] || []).filter(function (d) { return !gone[d.id] && d.cover; }).concat((x[1].items || []).filter(function (d) { return d.cover; }));
      var out = shuffle(discs).slice(0, 40).map(function (d) {
        // (TMDB's posters at 342 px)
        return { src: absolute(d.cover, "/library/movies/").replace("image.tmdb.org/t/p/w500/", "image.tmdb.org/t/p/w342/"), title: d.title, year: d.year || "", section: "Movies", href: "/library/movies/", ratio: 1.5 };
      });
      ["vinyl", "books", "games"].forEach(function (k, n) {
        shuffle((x[2 + n].items || []).filter(function (d) { return d.cover; })).slice(0, 40).forEach(function (d) {
          out.push({ src: smallCover(d), title: d.title, year: d.year || "", section: SHELF[k][0], href: SHELF[k][1], ratio: SHELF[k][2] });
        });
      });
      try { localStorage.setItem(HUB_KEY, JSON.stringify(out)); } catch (e) {}
      return out;
    });
    // drawn at once from the pictures this browser had last time (Nick, 2026-10-30: the wall waited on the Worker
    // every visit), shuffled again; this visit's list is saved for the next. The first visit waits for it.
    var last = null;
    try { last = JSON.parse(localStorage.getItem(HUB_KEY) || "null"); } catch (e) {}
    hubReq = last && last.length ? Promise.resolve(shuffle(last)) : fresh;
    return hubReq;
  }

  // Everything the wall shows on this page (a promise: Music, Extras and Home fetch theirs)
  function collectAll() {
    if (HUB) return collectHub();
    // Photography draws its photos once the ones added on the site are in (photos.js NMPhotosReady)
    if (PHOTOS) return (window.NMPhotosReady || Promise.resolve()).then(collectPhotos);
    return HOME ? collectHome() : MUSIC ? collectMusic() : EXTRAS ? collectExtras() : PLAY ? Promise.resolve(collectPlay())
      : Promise.resolve(LIBRARY ? (window.NMLibrary ? window.NMLibrary.wallItems() : []) : collect());
  }

  // The wall's copy of an image: the 400px WebP from tools/thumbs.py for the site's own posters, photos and courses;
  // for live posters (through the Worker's /img proxy), Amazon's or the Xbox store's 400px size. Anything else as is.
  function thumb(src) {
    var m = /^(.*\/(?:movies|games)\/posters\/|.*\/extras\/golf\/courses\/)([^/?#]+)\.(?:jpe?g|png|webp)$/i.exec(src);
    if (m) return m[1] + "thumbs/" + m[2] + ".webp";
    m = /^(.*\/photography\/)sizes\/([^/?#]+)-\d+\.jpg$/i.exec(src);
    if (m) return m[1] + "thumbs/" + m[2] + ".webp";
    m = /^https:\/\/photos\.nickmade\.net\/sizes\/([^/?#]+)-\d+\.jpg$/i.exec(src); // the sizes on R2; their thumbs stay here
    if (m) return "/photography/thumbs/" + m[1] + ".webp";
    m = /^(.*\/site\/[a-z]+-\d{8}-[0-9a-f]{6})-\d+\.jpg$/.exec(src); // a photo added on the site (1.4): its own thumb
    if (m) return m[1] + "-thumb.webp";
    m = /^(.*\/img\?u=)(.+)$/.exec(src);
    if (m) {
      var u = decodeURIComponent(m[2]);
      if (/m\.media-amazon\.com/.test(u)) u = u.replace(/\._V1_[^.]*\./, "._V1_UX400_.");
      else if (/store-images\.s-microsoft\.com/.test(u)) u = u.replace(/\?.*$/, "") + "?w=400";
      return m[1] + encodeURIComponent(u);
    }
    return src;
  }

  // for tools/make_walls.py: what this page's background would pick, and each picture's small copy
  window.NMWall = { items: collectAll, thumb: thumb, max: BG_MAX, home: HOME, key: KEY, ratio: RATIO };
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ---------- the wall ----------
  var wall = null, items = [];

  function tile(p, i, copy, bg) {
    // the thumbnail, falling back to the full image if there isn't one yet (a poster added since tools/thumbs.py ran)
    if (p.sprite) return '<div class="wall-tile" style="aspect-ratio:1 / ' + p.ratio + ";background:#111 url(" + p.sprite + ") " + p.bgPos + " / " + p.bgSize + ' no-repeat"></div>';
    var small = thumb(p.src);
    var img = '<img src="' + esc(small) + '"' + (small !== p.src ? ' data-full="' + esc(p.src) + '"' : "") + ' alt="" decoding="async"' +
      ' onload="this.classList.add(\'in\')" onerror="if (this.dataset.full) { this.src = this.dataset.full; this.removeAttribute(\'data-full\'); } else this.classList.add(\'in\')">';
    var shape = p.ratio ? ' style="aspect-ratio:1 / ' + p.ratio + '"' : ""; // Home mixes shapes
    if (bg) return '<div class="wall-tile"' + shape + ">" + img + "</div>"; // background: just the picture (a clip shows its still)
    // a clip: its still frame shows until the video is on screen and playing (see playVisible)
    if (p.video) img += '<video src="' + esc(p.video) + '" muted loop playsinline preload="none" aria-hidden="true"></video>';
    if (p.score) img += p.score;
    var meta = MUSIC ? [p.artist, p.section] : [p.year, p.section];
    return '<button type="button" class="wall-tile" data-i="' + i + '"' + shape + (copy ? ' tabindex="-1" aria-hidden="true"' : "") +
      ' aria-label="' + esc((MUSIC ? "Play " : "") + p.title + (p.year ? " (" + p.year + ")" : "") + (p.artist ? " by " + p.artist : "") + (p.section ? ", " + p.section : "")) + '">' +
      img +
      '<span class="wall-cap"><b>' + esc(p.title) + "</b>" +
        '<span class="wall-meta">' + esc(meta.filter(Boolean).join(" · ")) + "</span>" +
        (p.rating ? '<span class="wall-rating">' + p.rating + "</span>" : "") +
      "</span></button>";
  }

  // Fill a wall element's .wall-cols with columns of these posters (bg: plain tiles for the background)
  function build(el, items, bg) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var cols = Math.max(CLIPS_PAGE ? 2 : 3, Math.min(10, Math.round(vw / COL_W)));
    if (!still) cols += 1; // the tilt needs an extra column to cover the corners
    var colW = (vw * (still ? 1 : 1.2)) / cols;
    var tileH = colW * RATIO; // posters 2:3, album covers square, Extras 16:9
    var html = "";
    for (var c = 0; c < cols; c++) {
      // this column's posters: every cols-th one, starting at c, so each poster is in one column only
      // (with fewer posters than columns, columns start over from the top of the list)
      var list = [];
      for (var n = c; n < items.length; n += cols) list.push(n);
      // too few to go round (a column would just alternate two or three): each column gets all of them, in its own order
      if (items.length < cols * 4) list = shuffle(items.map(function (x, k) { return k; }));
      if (still) {
        html += '<div class="wall-col">' + list.map(function (i) { return tile(items[i], i, false, bg); }).join("") + "</div>";
        continue;
      }
      // repeat until the column is taller than the screen (with the tilt), then twice over for a seamless loop
      var loop = list.slice();
      while (loop.length * tileH < vh * 1.4) loop = loop.concat(list);
      var speed = SPEED[0] + Math.random() * (SPEED[1] - SPEED[0]);
      var secs = Math.round((loop.length * tileH) / speed);
      html += '<div class="wall-col"><div class="wall-track' + (c % 2 ? " up" : "") + '" style="animation-duration:' + secs + "s;animation-delay:-" +
        Math.round(Math.random() * secs) + 's">' +
        loop.map(function (i, k) { return tile(items[i], i, k >= list.length, bg); }).join("") +
        loop.map(function (i) { return tile(items[i], i, true, bg); }).join("") +
        "</div></div>";
    }
    el.querySelector(".wall-cols").innerHTML = html;
    el.querySelector(".wall-cols").style.setProperty("--cols", cols);
  }

  function show() {
    if (wall || open.disabled) return;
    open.disabled = true; // Music's covers or Extras' rounds may still be on their way
    collectAll().then(function (list) { open.disabled = false; showWith(list); });
  }
  function showWith(list) {
    items = shuffle(list);
    if (!items.length) return;
    wall = document.createElement("div");
    wall.className = "wall" + (still ? " still" : "") + (MUSIC ? " albums" : "") + (CLIPS_PAGE ? " extras" : "") + (PHOTOS ? " photos" : "");
    wall.setAttribute("role", "dialog");
    wall.setAttribute("aria-modal", "true");
    wall.setAttribute("aria-label", NAME + " poster wall");
    wall.innerHTML = '<div class="wall-cols"></div>' +
      '<div class="wall-bar"><span class="wall-name">' + ICON + NAME + " <small>" + items.length + " " + NOUN + "</small></span>" +
      '<button type="button" class="wall-close" aria-label="Close the poster wall">×</button></div>' +
      (MUSIC ? '<div class="wall-player" hidden><div></div></div>' : "");
    document.body.appendChild(wall);
    build(wall, items);
    if (CLIPS_PAGE || HOME) playVisible(wall);
    document.documentElement.classList.add("wall-on"); // stops the page scrolling underneath
    requestAnimationFrame(function () { wall.classList.add("in"); });
    wall.querySelector(".wall-close").focus();
    wall.addEventListener("click", function (e) {
      if (e.target.closest(".wall-close")) return hide();
      var t = e.target.closest(".wall-tile");
      if (t && MUSIC) playSong(+t.dataset.i);
      else if (t && items[+t.dataset.i].href) location.href = items[+t.dataset.i].href; // Home: to its page
      else if (t && LIBRARY) { var id = items[+t.dataset.i].id; hide(function () { window.NMLibrary.open(id); }); } // its case
      else if (t) goTo(items[+t.dataset.i]);
    });
    document.addEventListener("keydown", onKey);
  }

  function hide(then) {
    if (!wall) return;
    var w = wall;
    wall = null;
    if (clipWatch) { clipWatch.disconnect(); clipWatch = null; }
    [].forEach.call(w.querySelectorAll("video"), function (v) { v.pause(); });
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("wall-on");
    if (controller) { try { controller.destroy(); } catch (e) {} controller = null; } // stop the song with the wall
    playing = -1;
    w.classList.remove("in");
    setTimeout(function () { w.remove(); }, 300);
    if (typeof then === "function") then();
    else open.focus({ preventScroll: true }); // back to the button (Safari doesn't focus buttons on click)
  }

  // Close the wall and bring that poster into view on the page, with a brief glow
  function goTo(p) {
    hide(function () {
      // Photography in slideshow mode: show that photo in the slideshow (the grids are hidden)
      if (PHOTOS && window.NMPhotos && window.NMPhotos.slides() && p.el.dataset.index != null) return window.NMPhotos.slideTo(+p.el.dataset.index);
      // past the 8 a capped section shows (reviews.js): expand it first, or there's nothing to scroll to
      var capSec = p.el.classList.contains("capped") && p.el.closest("section[data-cap]");
      if (capSec) capSec.querySelector(".cap-toggle").click();
      p.el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
      p.el.classList.remove("wall-found");
      void p.el.offsetWidth;
      p.el.classList.add("wall-found");
      setTimeout(function () { p.el.classList.remove("wall-found"); }, 2400);
    });
  }

  // ---------- Extras: clips play only while on screen (the wall repeats each one several times) ----------
  var clipWatch = null;
  function playVisible(w) {
    if (clipWatch) clipWatch.disconnect();
    if (!window.IntersectionObserver) return;
    clipWatch = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { v.preload = "auto"; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else v.pause();
      });
    });
    [].forEach.call(w.querySelectorAll("video"), function (v) {
      v.addEventListener("playing", function () { v.classList.add("in"); }, { once: true });
      clipWatch.observe(v);
    });
  }

  // ---------- Music: play the clicked album's song in a player at the bottom of the wall ----------
  var controller = null, playing = -1;
  function playSong(i) {
    var p = items[i];
    if (!wall || !p || !p.trackId) return;
    if (i === playing && controller) { controller.togglePlay(); return; }
    playing = i;
    [].forEach.call(wall.querySelectorAll(".wall-tile"), function (t) { t.classList.toggle("playing", +t.dataset.i === i); });
    var box = wall.querySelector(".wall-player");
    box.hidden = false;
    var uri = "spotify:track:" + p.trackId;
    if (controller) { controller.loadUri(uri); controller.play(); return; }
    var w = wall;
    spotifyApi(function (IFrameAPI) {
      if (wall !== w) return; // closed while the player script loaded
      IFrameAPI.createController(box.firstChild, { uri: uri, width: "100%", height: 80 }, function (c) {
        controller = c;
        c.addListener("ready", function () { c.play(); });
        var paused = true;
        c.addListener("playback_update", function (e) {
          var was = paused;
          paused = !!(e.data && e.data.isPaused);
          if (was && !paused) document.dispatchEvent(new CustomEvent("nm-spotify-play", { detail: "wall" })); // pause the page's players
        });
      });
    });
  }
  // Spotify's iFrame API, loaded once and shared with recent.js and recs.js (it calls onSpotifyIframeApiReady once)
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

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); hide(); return; }
    if (e.key !== "Tab" || !wall) return;
    // keep Tab inside the wall
    var f = wall.querySelectorAll('button:not([tabindex="-1"])');
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  var resizeTimer = null, bgSize = null;
  window.addEventListener("resize", onResize); // rebuilds the open wall and the background for the new size
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (wall) { build(wall, items); if (CLIPS_PAGE || HOME) playVisible(wall); }
      if (bgWall && bgResized()) buildBg();
    }, 200);
  }
  // Phones resize the window whenever the address bar slides in or out while scrolling. The background is sized to the
  // tallest viewport (100lvh in site.css), so those don't matter; rebuilding then made the columns jump. Only a new width
  // (rotating, a desktop window) or a much taller window rebuilds it.
  function bgResized() {
    return !bgSize || window.innerWidth !== bgSize.w || window.innerHeight > bgSize.h * 1.25;
  }
  function buildBg() {
    bgSize = { w: window.innerWidth, h: window.innerHeight };
    build(bgWall, bgItems, true);
  }

  // ---------- background toggle (top bar, right end) ----------
  // On by default; a visitor who switches it off keeps it off ("0"). Browsers asking to save data start with it off.
  var bgWall = null, bgItems = [], bgOn = true, stored = null;
  try { stored = localStorage.getItem("nm-wall-bg"); } catch (e) {}
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  bgOn = stored === "1" || (stored !== "0" && !saveData);
  function paintToggle() {
    toggle.setAttribute("aria-checked", String(bgOn));
    toggle.setAttribute("aria-label", "Poster wall background");
    toggle.title = bgOn ? "Background: poster wall (switch to black)" : "Background: black (switch to the poster wall)";
  }
  paintToggle();
  toggle.addEventListener("click", function () {
    bgOn = !bgOn;
    try { localStorage.setItem("nm-wall-bg", bgOn ? "1" : "0"); } catch (e) {}
    paintToggle();
    if (bgOn) startBg(); else stopBg();
  });

  // On load: right after the page's first paint (live sections that arrive later just aren't in this shuffle). Was a
  // 150 ms wait; now the next frame (Nick, 2026-10-25: make it come in faster)
  if (bgOn) requestAnimationFrame(function () { setTimeout(startBg, 0); });

  // Hovering or focusing the toggle or the Poster wall button gets the list and the first thumbnails coming, so a
  // click finds them ready. Only then: visitors who never go near them download nothing extra.
  var warmed = false;
  function warm() {
    if (warmed) return;
    warmed = true;
    collectAll().then(function (list) {
      list.slice(0, 100).forEach(function (p) { var im = new Image(); im.decoding = "async"; im.src = thumb(p.src); });
    });
  }
  [toggle, open].forEach(function (b) {
    b.addEventListener("pointerenter", warm);
    b.addEventListener("focus", warm);
    b.addEventListener("touchstart", warm, { passive: true });
  });

  var bgLoading = false;
  function startBg() {
    if (bgWall || bgLoading || !bgOn) return;
    bgLoading = true;
    var sp = spriteItems();
    if (sp) { // the page's one picture: drawn at once, faded in when it's loaded (from the cache after the first visit)
      bgLoading = false;
      bgItems = shuffle(sp);
      makeBg();
      var pic = new Image();
      pic.onload = pic.onerror = function () { if (bgWall) bgWall.classList.add("in"); };
      pic.src = sp[0].sprite;
      return;
    }
    collectAll().then(function (list) {
      bgLoading = false;
      if (!bgOn || bgWall || !list.length) return;
      bgItems = shuffle(list).slice(0, BG_MAX);
      if (HOME) bgItems = shuffle(list.filter(function (x, k) { return k % 2 === 0 || x.video; })).slice(0, BG_MAX); // half of each page's share
      makeBg();
      requestAnimationFrame(function () { requestAnimationFrame(function () { if (bgWall) bgWall.classList.add("in"); }); });
    });
  }
  function makeBg() {
      bgWall = document.createElement("div");
      bgWall.className = "wall wall-bg" + (still ? " still" : "") + (MUSIC ? " albums" : "") + (CLIPS_PAGE ? " extras" : "") + (PHOTOS ? " photos" : "") + (HOME || HUB ? " wall-home" : "") + (LIBRARY ? " wall-library" : "");
      bgWall.setAttribute("aria-hidden", "true");
      bgWall.style.setProperty("--wall-shade", String(1 - BG_DIM));
      bgWall.innerHTML = '<div class="wall-cols"></div>';
      document.body.insertBefore(bgWall, document.body.firstChild);
      document.documentElement.classList.add("wall-bg-on"); // readability tweaks for the page on top (site.css)
      buildBg();
  }
  function stopBg() {
    if (!bgWall) return;
    var w = bgWall;
    bgWall = null;
    document.documentElement.classList.remove("wall-bg-on");
    w.classList.remove("in");
    setTimeout(function () { w.remove(); }, 700); // (after its .6s fade out)
  }
})();
