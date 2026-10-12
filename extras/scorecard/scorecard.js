// Scorecard (Extras > Scorecard, phases 1-2 of SCORECARD-PLAN.md): Nick's score tracker for real golf courses.
// One screen per hole: score (one tap for par), putts, fairway (left / hit / right), green in regulation (worked out
// from score and putts, tap to override) and penalties. Swipe for the next hole. Every tap is saved in this browser
// straight away (localStorage), so a reload, a dead signal or a phone restart loses nothing; sw.js keeps the page
// itself working offline. At the end: a summary, the round written onto the course's own scorecard (card.js), saved
// as an image or shared, and CSV / JSON / GHIN-ready exports.
//
// OWNER ONLY until the Worker's SCORECARD_PUBLIC is "1": GET /scorecard/status decides (offline, the last answer).
// Courses: a course's approved file from the Worker (GET /scorecard/courses/:id: checked once, then reused with no
// lookups), else Nick's hand-made files (courses/*.json, copied from each course's own card), else OpenGolfAPI through
// the Worker, checked against the real card before the round starts and then approved as the course's file.
// Sync (phase 2): rounds are saved to the Worker's database whenever there's signal (PUT /scorecard/rounds/:id, only
// what changed since the last save), so they follow Nick to any device in owner mode; a visitor moves phones with a
// recovery code. His finished rounds marked "Show on my Golf page" feed the Golf page and the home Lately strip.
//
// localStorage: nm-scorecard-round   the round being played
//               nm-scorecard-rounds  finished rounds, newest first (the last 50); each has ackAt, the last change
//                                    the server has (updatedAt > ackAt = still to send)
//               nm-scorecard-prefs   { sun, wake, name, tees: { courseId: teeKey }, recent: [{ id, name, place }] }
//               nm-scorecard-course:<id>  a course as last loaded or checked here (for offline)
//               nm-scorecard-deleted   round ids deleted here, still to delete on the server
//               nm-scorecard-approvals course files approved here, still to send
//               nm-scorecard-ok      whether this browser may see the page (for opening it offline)
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var app = document.getElementById("app");
  var K = { round: "nm-scorecard-round", rounds: "nm-scorecard-rounds", prefs: "nm-scorecard-prefs", course: "nm-scorecard-course:", ok: "nm-scorecard-ok",
    del: "nm-scorecard-deleted", approve: "nm-scorecard-approvals" };
  var KEEP = 50;
  var NAMES = { "-3": "Albatross", "-2": "Eagle", "-1": "Birdie", "0": "Par", "1": "Bogey", "2": "Double", "3": "Triple" };

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} }
  function toPar(v) { return v === 0 ? "E" : (v > 0 ? "+" : "") + v; }
  function rel(d) { return NAMES[String(d)] || (d > 0 ? "+" + d : String(d)); }
  function fmtDate(d) { var x = new Date(d); return isNaN(x) ? "" : x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function fmtYds(n) { return n == null ? "" : Number(n).toLocaleString("en-US"); }
  function monthYear(s) { // "2024-06" -> "Jun 2024"
    var m = /^(\d{4})-(\d{2})/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "";
  }

  // ---------- owner mode (the site's admin token) ----------

  var params = new URLSearchParams(location.search);
  var ADMIN = null;
  try {
    if (params.has("logout")) localStorage.removeItem("nm-admin-token");
    ADMIN = localStorage.getItem("nm-admin-token");
  } catch (e) {}
  function auth(h) { h = h || {}; if (ADMIN) h.Authorization = "Bearer " + ADMIN; return h; }
  // a call to the Worker; errors carry the HTTP status (0: no signal)
  var OGA = "https://api.opengolfapi.org";
  function api(path, opts) {
    opts = opts || {};
    return fetch(API + path, { method: opts.method || "GET", headers: auth(opts.body ? { "Content-Type": "application/json" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined })
      .catch(function () { var e = new Error("No signal."); e.status = 0; throw e; })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.error || "Something went wrong."); e.status = r.status; throw e; }
          return d;
        });
      });
  }

  // The site's browser id (the same one live.js makes for the queues): a visitor's rounds are theirs by it
  function visitorId() {
    var id = null;
    try { id = localStorage.getItem("nm-visitor"); } catch (e) {}
    if (!id) {
      var m = document.cookie.match(/(?:^|; )nm_visitor=([^;]+)/);
      id = m ? m[1] : uuid();
      try { localStorage.setItem("nm-visitor", id); } catch (e) {}
    }
    document.cookie = "nm_visitor=" + id + "; max-age=31536000; path=/; SameSite=Lax";
    return id;
  }
  var VID = visitorId();
  var OWNER = !!ADMIN; // the Worker's answer replaces this guess (offline, having the token is enough)

  var prefs = load(K.prefs, {});
  prefs.tees = prefs.tees || {};
  prefs.recent = prefs.recent || [];
  function savePrefs() { save(K.prefs, prefs); }
  document.body.classList.toggle("sun", !!prefs.sun);

  var round = load(K.round, null); // the round being played, if any
  var undo = [];                    // this session's changes, newest last: { n, before }
  var wake = null;                  // the screen wake lock while a hole is showing
  var ready = false;                // the gate has let us in (sync waits for it)
  // a "YYYY-MM-DD" played-on day as the round's date: now for today, noon that day for an old round
  function dayToIso(d) {
    if (!d || d === today()) return new Date().toISOString();
    var p = d.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2], 12).toISOString();
  }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }

  // ---------- the gate: owner only until the Worker says it's public ----------

  function gate() {
    return fetch(API + "/scorecard/status", { headers: auth() })
      .then(function (r) { return r.json(); })
      .then(function (d) { var ok = !!(d.public || d.owner); OWNER = !!d.owner; save(K.ok, ok); return ok; })
      .catch(function () { return !!load(K.ok, false); }); // no signal: whatever it said last time
  }

  function closed() {
    app.innerHTML = '<section class="sc-closed"><h1>Not available</h1><p>This page isn\'t open yet.</p><a class="sc-link" href="/extras/">&larr; Extras</a></section>';
  }

  function login() {
    app.innerHTML = '<section class="sc-closed"><h1>Owner login</h1><form class="sc-login"><label for="sc-pw">Password</label>' +
      '<input id="sc-pw" type="password" autocomplete="current-password"><p class="sc-error" role="alert"></p>' +
      '<button class="sc-go" type="submit">Log in</button></form></section>';
    var form = app.querySelector("form"), input = form.querySelector("input"), err = form.querySelector(".sc-error");
    input.focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var token = input.value.trim();
      fetch(API + "/admin/check", { headers: { Authorization: "Bearer " + token } }).then(function (r) {
        if (!r.ok) { err.textContent = "Wrong password."; return; }
        ADMIN = token;
        try { localStorage.setItem("nm-admin-token", token); } catch (e2) {}
        history.replaceState(null, "", location.pathname);
        boot();
      }).catch(function () { err.textContent = "Couldn't reach the server."; });
    });
  }

  // ---------- the phone's Back button: one step back through the app's own screens ----------
  // The start screen is level 0; a course's setup, a round being played, a finished round and "Add a course" are
  // level 1; the compare screen and the mid-round card check are level 2. Each level is one history entry, so Back goes
  // up a level (from a finished round to the start screen, not out to Extras: Nick, 2026-10-10), and the app's own ←
  // buttons do the same through history. Starting a round replaces the setup, and finishing replaces the round.
  // A screen calls at(level, redraw) first: false means history is stepping back and will draw it (via popstate).
  var level = 0, screens = [home], popping = false;
  function at(lv, redraw) {
    screens.length = Math.max(screens.length, lv + 1);
    screens[lv] = redraw;
    if (popping || lv === level) { level = lv; return true; }
    if (lv < level) { history.go(lv - level); return false; }
    for (var l = level + 1; l <= lv; l++) history.pushState({ sc: l }, "");
    level = lv;
    return true;
  }
  window.addEventListener("popstate", function (e) {
    if (document.querySelector("dialog[open]")) return; // an open menu or the card viewer closes itself
    var lv = e.state && typeof e.state.sc === "number" ? e.state.sc : 0;
    if (lv === level) return; // back from a closed menu or the card viewer: the same screen
    level = lv;
    popping = true;
    try { (screens[lv] || home)(); } finally { popping = false; }
  });

  function boot() {
    gate().then(function (ok) {
      if (!ok) return params.has("admin") ? login() : closed();
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
      if (!prefs.name && ADMIN) { prefs.name = "Nick"; savePrefs(); }
      if (OWNER) loadHandicap();
      // a round played before its course had a look: the saved course file's look
      // the newest card for a course: the server's saved one or the copy kept on this phone (a card made again here
      // before it's saved), by when each was made
      var looks = {};
      NMCard.lookup = function (id) {
        if (!looks[id]) looks[id] = api("/scorecard/courses/" + encodeURIComponent(id)).then(function (c) { return c.card || null; }, function () { return null; });
        return looks[id].then(function (server) {
          var kept = (load(K.course + id, null) || {}).card;
          return kept && kept.kind === "photo" && (kept.made || 0) > ((server && server.made) || 0) ? kept : server;
        });
      };
      ready = true;
      try { history.replaceState({ sc: 0 }, ""); } catch (e) {}
      if (round && !round.finishedAt) holeScreen(); else home();
      queueSync(400);
      window.addEventListener("online", function () {
        queueSync(0);
        if (app.querySelector(".sc-cc") && load(K_SNAP + cc.id, null)) readSnap();
      });
      setInterval(function () { if (navigator.onLine !== false) queueSync(0); }, 60000);
    });
  }

  // ---------- courses ----------

  var mine = null; // Nick's hand-made course files: [{ id, name, place }]
  function myCourses() {
    if (mine) return Promise.resolve(mine);
    return fetch("courses/index.json").then(function (r) { return r.json(); })
      .then(function (d) { mine = d.courses || []; return mine; }).catch(function () { return []; });
  }
  var filed = null; // the approved course files on the server: [{ id, name, place, version, ownerChecked }]
  function fileList() {
    if (filed) return Promise.resolve(filed);
    return api("/scorecard/courses").then(function (d) { filed = d.courses || []; return filed; }).catch(function () { return []; });
  }
  // An OpenGolfAPI course through the Worker (cached there); when OpenGolfAPI turns the Worker away, fetched from here
  // and sent to the Worker only to be put in the app's shape
  function apiCourse(apiId) {
    var path = "/scorecard/courses/api/" + encodeURIComponent(apiId);
    return api(path).catch(function (err) {
      if (err.status === 0) throw err;
      return fetch(OGA + "/api/v1/courses/" + encodeURIComponent(apiId)).then(function (r) {
        if (!r.ok) throw err;
        return r.json();
      }, function () { throw err; }).then(function (raw) { return api(path, { method: "POST", body: raw }); });
    });
  }

  // OpenGolfAPI's search through the Worker (cached there); OpenGolfAPI turns the Worker away at times, but it answers
  // a browser, so then it's asked straight from here
  function ogaSearch(term) {
    var q = encodeURIComponent(term);
    return api("/scorecard/courses/search?q=" + q).catch(function (err) {
      if (err.status === 0) throw err;
      return fetch(OGA + "/v1/courses/search?q=" + q).then(function (r) {
        if (!r.ok) throw err;
        return r.json();
      }).then(function (d) {
        return { courses: (d.courses || []).slice(0, 25).map(function (c) {
          return { apiId: c.id, name: c.course_name || c.name, place: [c.city, c.state].filter(Boolean).join(", "), par: c.par || null, holes: c.holes || null };
        }) };
      }, function () { throw err; });
    });
  }

  // ---------- two nines played as one 18 (a 27-hole club like Breckenridge: Bear, Elk, Beaver) ----------
  // The pair is its own course, "nines:<front id>+<back id>": its own approved file, kept copy and rounds.
  var NINES = /^nines:([^+]+)\+(.+)$/;
  function clubOf(c) { var m = /\bat\s+(.+)$/i.exec(c.fullName || c.name); return m ? m[1] : c.fullName || c.name; }
  function nineName(c) { return (c.name || "").replace(/\s+at\s+.+$/i, "").replace(/\s+(course|nine|9)$/i, "").trim() || c.name; }
  function joinNines(a, b) {
    // each nine ranks its own holes; played as an 18 the first nine takes the odd handicaps and the second the even
    var rank = function (h, odd) {
      if (!h || h.some(function (v) { return v == null; })) return Array(9).fill(null);
      var order = h.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return x[0] - y[0]; }), out = Array(9);
      order.forEach(function (o, r) { out[o[1]] = 2 * r + (odd ? 1 : 2); });
      return out;
    };
    var tees = a.tees.map(function (t, i) {
      var name = t.name.toLowerCase();
      var u = b.tees.filter(function (x) { return x.key === t.key || x.name.toLowerCase() === name; })[0];
      if (!u) return null;
      var both = function (x, y) { return x != null && y != null ? x + y : null; };
      var tee = { key: t.key, name: t.name, color: t.color, rating: t.rating && u.rating ? Math.round((t.rating + u.rating) * 10) / 10 : null,
        slope: t.slope && u.slope ? Math.round((t.slope + u.slope) / 2) : null, total: both(t.total || null, u.total || null),
        yards: t.yards.concat(u.yards) };
      if (t.ink) tee.ink = t.ink;
      if (t.women) tee.women = true;
      return tee;
    }).filter(Boolean);
    var c = {
      id: "nines:" + a.id + "+" + b.id, name: nineName(a) + " + " + nineName(b), fullName: nineName(a) + " + " + nineName(b) + " at " + clubOf(a),
      place: a.place, holes: 18, par: a.par.concat(b.par), hcp: rank(a.hcp, true).concat(rank(b.hcp, false)), tees: tees,
      nines: [a.id, b.id], source: a.source, credit: a.credit,
    };
    if (a.hcpWomen && b.hcpWomen) c.hcpWomen = rank(a.hcpWomen, true).concat(rank(b.hcpWomen, false));
    if (a.website) c.website = a.website;
    return c;
  }
  // the club's other nines, to play after this one: OpenGolfAPI's 9-hole listings under the same club name
  function otherNines(c) {
    var club = clubOf(c).toLowerCase();
    return ogaSearch(clubOf(c)).then(function (d) {
      return (d.courses || []).filter(function (x) {
        return "api:" + x.apiId !== c.id && x.holes !== 18 && x.name.toLowerCase().indexOf(club) >= 0;
      }).map(function (x) { return { id: "api:" + x.apiId, name: x.name }; });
    });
  }

  // A course's numbers: its approved file on the server (checked once, then reused with no lookups); with no signal,
  // the copy kept on this phone; with no file yet, the copy checked here, else Nick's hand-made file or OpenGolfAPI
  function loadCourse(id) {
    return api("/scorecard/courses/" + encodeURIComponent(id)).then(function (c) {
      save(K.course + id, c);
      return c;
    }, function (err) {
      var kept = load(K.course + id, null) || playedCourse(id);
      if (kept) return kept;
      if (id.indexOf("api:") === 0) return apiCourse(id.slice(4));
      var pair = NINES.exec(id);
      if (pair) return Promise.all([loadCourse(pair[1]), loadCourse(pair[2])]).then(function (ab) { return joinNines(ab[0], ab[1]); });
      return fetch("courses/" + encodeURIComponent(id) + ".json").then(function (r) {
        if (!r.ok) throw new Error(err.status === 0 ? "No signal, and this course isn't saved on this phone yet." : "Couldn't load that course.");
        return r.json();
      });
    });
  }
  // the course as a past round on this phone played it (a course added from its card and never saved still has that)
  function playedCourse(id) {
    var r = load(K.rounds, []).filter(function (x) { return x.course && x.course.id === id; })[0];
    return r ? copy(r.course) : null;
  }
  // a course this phone can open: saved here, played here, rebuilt from OpenGolfAPI or its two nines (else a server or
  // hand-made file, which the lists check themselves)
  function openable(id) {
    return /^(api|nines):/.test(id) || !!load(K.course + id, null) || !!playedCourse(id);
  }
  function yardsOf(t) { return t.total || t.yards.reduce(function (a, v) { return a + (v || 0); }, 0); }
  // Nick's rule (2026-10-10): "the whites", the tee one back from the front tees = the second-shortest
  function defaultTee(course) {
    var kept = prefs.tees[course.id];
    if (kept && course.tees.some(function (t) { return t.key === kept; })) return kept;
    var byLength = course.tees.slice().sort(function (a, b) { return yardsOf(a) - yardsOf(b); });
    return (byLength[1] || byLength[0] || {}).key;
  }
  function teeOf(c, key) { return c.tees.filter(function (t) { return t.key === key; })[0] || c.tees[0]; }
  function hcpSet(c, tee) { return tee && tee.women && c.hcpWomen ? c.hcpWomen : c.hcp; }

  // ---------- home: start a round, your courses, past rounds ----------

  function bar(left, title, right) {
    return '<header class="sc-bar">' + left + '<h1>' + title + "</h1>" + (right || '<span class="sc-icon-gap"></span>') + "</header>";
  }
  var sunBtn = '<button class="sc-icon" type="button" data-act="sun" aria-label="Sun mode" title="Sun mode (easier to read outside)">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg></button>';

  function home() {
    if (!at(0, home)) return;
    releaseWake();
    app.innerHTML = bar('<a class="sc-icon sc-back" href="/extras/" aria-label="Back to Extras">&larr;</a>', "Scorecard", sunBtn) +
      '<section class="sc-pad">' +
        (round && !round.finishedAt ? (function () {
          var st = stats(round);
          return '<button type="button" class="sc-resume" data-act="resume"><span>Round in progress</span><b>' + esc(round.course.name) + "</b>" +
            "<small>Hole " + round.current + (st.done ? " · " + st.strokes + " (" + toPar(st.toPar) + ") thru " + st.done : "") + "</small><i>Resume &rarr;</i></button>";
        })() : "") +
        '<h2 class="sc-h">New round</h2>' +
        '<div class="sc-search"><input id="sc-q" type="search" autocomplete="off" placeholder="Search for a course" aria-label="Search for a course"></div>' +
        '<ul class="sc-list sc-results" hidden></ul>' +
        '<h3 class="sc-sub">Your courses</h3><ul class="sc-list sc-mine"><li class="sc-muted">Loading…</li></ul>' +
        '<div class="sc-past-wrap"></div>' +
        (OWNER ? "" : '<details class="sc-check sc-move"><summary>Moving to another phone?</summary>' +
          '<p class="sc-muted small">Get a code here and type it into the Scorecard on your other phone. Your rounds will be on both.</p>' +
          '<div class="sc-move-row"><button type="button" class="sc-ghost" data-act="code">Get my code</button><b class="sc-code"></b></div>' +
          '<div class="sc-move-row"><input id="sc-claim" class="sc-in" placeholder="ABCD-EFGH-JKMN" autocapitalize="characters" autocomplete="off" aria-label="Code from your other phone">' +
          '<button type="button" class="sc-ghost" data-act="claim">Use code</button></div><p class="sc-error" role="alert"></p></details>') +
      "</section>";
    Promise.all([myCourses(), fileList()]).then(function (res) {
      var list = res[0], files = res[1];
      var known = function (id) { return list.some(function (m) { return m.id === id; }); };
      var rows = list.map(function (c) { return courseRow(c, ownBadge(c, files)); });
      files.forEach(function (f) { if (!known(f.id)) rows.push(courseRow(f, f.ownerChecked ? "✓ Card" : "✓ Checked")); });
      // recent courses this phone can still open (a course added from its card but never saved can't be, 2026-10-12)
      prefs.recent.forEach(function (r) { if (!known(r.id) && !files.some(function (f) { return f.id === r.id; }) && openable(r.id)) rows.push(courseRow(r, "")); });
      app.querySelector(".sc-mine").innerHTML = rows.join("") || '<li class="sc-muted">Search for a course to start.</li>';
    });
    pastRounds();
    var q = app.querySelector("#sc-q"), out = app.querySelector(".sc-results"), timer = null, seq = 0;
    q.addEventListener("input", function () {
      clearTimeout(timer);
      var term = q.value.trim();
      if (term.length < 3) { out.hidden = true; out.innerHTML = ""; return; }
      timer = setTimeout(function () { search(term, ++seq); }, 350);
    });
    // Search covers Nick's hand-made course files, every approved course file on the server (courses added from
    // their card, like Firewheel's Lakes Course) and OpenGolfAPI. Every word has to match, in any order. OpenGolfAPI
    // matches whole names, so a search it finds nothing for is tried again with fewer words: "firewheel lakes" finds
    // its single "Firewheel Golf Park" listing.
    function apiSearch(words) {
      return ogaSearch(words.join(" ")).then(function (d) {
        return (d.courses || []).length || words.length < 2 ? d : apiSearch(words.slice(0, -1));
      });
    }
    function search(term, my) {
      out.hidden = false;
      out.innerHTML = '<li class="sc-muted">Searching…</li>';
      var words = term.toLowerCase().split(/\s+/).filter(Boolean);
      var hit = function (c) { var hay = (c.name + " " + (c.place || "")).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) >= 0; }); };
      filed = null; // fetch the server's list fresh, so a course just added from its card is found
      Promise.all([myCourses(), fileList(), apiSearch(words).catch(function (e) { return { error: e.message, courses: [] }; })])
        .then(function (res) {
          if (my !== seq) return;
          var own = res[0], files = res[1], found = res[2], shown = {};
          var rows = own.filter(hit).map(function (c) { shown[c.id] = 1; return courseRow(c, ownBadge(c, files)); });
          files.filter(hit).forEach(function (f) {
            if (shown[f.id]) return;
            shown[f.id] = 1;
            rows.push(courseRow(f, f.ownerChecked ? "✓ Card" : "✓ Checked"));
          });
          (found.courses || []).forEach(function (c) {
            var file = own.filter(function (m) { return m.apiId === c.apiId; })[0];
            if (file || shown["api:" + c.apiId]) return; // its course file is already listed
            var near = own.filter(function (m) { return m.nearApiId === c.apiId; })[0];
            rows.push(courseRow({ id: "api:" + c.apiId, name: c.name, place: c.place + (c.par ? " · par " + c.par : ""),
              note: near ? "A different course from " + near.name : "" }, ""));
          });
          out.innerHTML = (rows.join("") || '<li class="sc-muted">' + esc(found.error || "No courses found.") + "</li>") +
            '<li><button class="sc-row-btn sc-add" type="button" data-act="newcourse"><span class="sc-row-main"><b>Not listed, or not the right course?</b>' +
            '<span class="sc-row-sub">Add it from its card</span></span></button></li>';
        });
    }

  }

  // Nick's hand-made course files (courses/*.json): "✓ Copied" (copied by hand from the course's card), unless a card
  // has been saved on the server for it too, which is what's used then (and what Remove saved card removes)
  function ownBadge(c, files) {
    return (files || []).some(function (f) { return f.id === c.id && f.ownerChecked; }) ? "✓ Card" : "✓ Copied";
  }
  function courseRow(c, badge) {
    return '<li><button class="sc-row-btn" type="button" data-course="' + esc(c.id) + '"><span class="sc-row-main"><b>' + esc(c.name) + "</b>" +
      '<span class="sc-row-sub">' + esc(c.place || "") + (c.note ? " · " + esc(c.note) : "") + "</span></span>" +
      (badge ? '<span class="sc-badge" title="' + (badge === "✓ Copied" ? "Copied by hand from the course\'s card" : "This course\'s card has been checked") + '">' + esc(badge) + "</span>" : "") + "</button></li>";
  }

  // one row for a round kept here (r.course) or only on the server (a summary from GET /scorecard/rounds)
  function pastRow(r) {
    var local = !!r.course, s = local ? stats(r) : { done: r.done, strokes: r.strokes, toPar: r.strokes - r.par };
    var name = local ? r.course.name : r.courseName, tee = local ? teeOf(r.course, r.tee).name : r.teeName;
    var open = !r.finishedAt;
    return '<li><button class="sc-row-btn" type="button" ' + (local ? "data-past" : "data-remote") + '="' + esc(r.id) + '"><span class="sc-row-main"><b>' + esc(name) + "</b>" +
      '<span class="sc-row-sub">' + esc(fmtDate(r.date || r.day)) + " · " + esc(tee || "") + (r.holes.length === 9 ? " · 9 holes" : "") +
        (open ? " · in progress" : "") + (local ? "" : " · on another phone") + "</span></span>" +
      '<span class="sc-row-score"><b>' + (s.done ? s.strokes : "–") + "</b><span>" + (s.done ? toPar(s.toPar) : "") + "</span></span></button></li>";
  }

  // Past rounds: the ones on this phone straight away, then the server's list folded in: rounds from another device
  // appear (tap to bring them here), and rounds deleted on another device go from here too
  function pastRounds() {
    var wrap = app.querySelector(".sc-past-wrap");
    if (!wrap) return;
    function draw(list) {
      list.sort(function (a, b) { return String(b.date || b.day).localeCompare(String(a.date || a.day)); });
      wrap.innerHTML = list.length ? '<h3 class="sc-sub">Past rounds <i class="sc-sync" aria-hidden="true"></i></h3><ul class="sc-list sc-past">' + list.map(pastRow).join("") + "</ul>" : "";
      dot();
    }
    var mineHere = load(K.rounds, []);
    draw(mineHere.slice());
    api("/scorecard/rounds?visitorId=" + encodeURIComponent(VID)).then(function (d) {
      var server = d.rounds || [], ids = {}, gone = load(K.del, []);
      server.forEach(function (r) { ids[r.id] = true; });
      var here = load(K.rounds, []);
      // saved before, now missing from the server: deleted on another phone
      var kept = server.length < 200 ? here.filter(function (r) { return ids[r.id] || !r.ackAt; }) : here;
      if (kept.length !== here.length) save(K.rounds, kept);
      var have = {};
      kept.forEach(function (r) { have[r.id] = true; });
      if (round) have[round.id] = true;
      var remote = server.filter(function (r) { return !have[r.id] && gone.indexOf(r.id) < 0; });
      if (app.querySelector(".sc-past-wrap") === wrap) draw(kept.concat(remote));
    }).catch(function () {});
  }

  // ---------- setup: tee, holes, and a look at the numbers before teeing off ----------

  var draft = null, setupTee = null, setupNine = "18", original = "", setupDay = null; // setupDay: the date played, for entering old rounds
  function numbers(c) { return JSON.stringify([c.par, c.hcp, c.hcpWomen || null, c.tees.map(function (t) { return t.yards; })]); }

  // keep: re-drawing the same course after the card check (its sources and the "original" numbers stay)
  function setup(course, keep) {
    if (!at(1, function () { setup(draft && draft.id === course.id ? draft : course, true); })) return; // with any numbers changed since
    draft = copy(course);
    // a pair of nines saved before the server kept "nines" (2026-10-12: its card got Beaver + Bear's columns): from its id
    var pairId = NINES.exec(draft.id || "");
    if (pairId && !draft.nines) draft.nines = [pairId[1], pairId[2]];
    if (!keep) {
      setupDay = null;
      original = numbers(draft);
      cc = { id: draft.id, sources: [], status: "", now: copy(course) };
      setupNine = "18";
    }
    setupTee = draft.tees.some(function (t) { return t.key === setupTee; }) && keep ? setupTee : defaultTee(draft);
    var src = draft.source || {}, chk = draft.checked, blank = !draft.tees.length;
    var trust = chk
      ? '<p class="sc-trust ok">✓ Card checked ' + (chk.owner ? (OWNER ? "by you" : "by Nick") : "by a player") + " on " + esc(fmtDate(chk.at)) +
        (chk.version > 1 ? " (version " + chk.version + ")" : "") + ". It's ready as is." +
        (OWNER ? ' <button type="button" class="sc-link" data-act="uncard">Remove saved card</button>' : "") + "</p>"
      : src.read
      ? '<p class="sc-trust ok">✓ Read from ' + esc(src.name) + ". Look over the numbers below.</p>"
      : src.kind === "website"
      ? '<p class="sc-trust ok">✓ Copied from ' + esc(src.name || "the course's card") + (src.dated ? " (" + esc(monthYear(src.dated)) + ")" : "") + ". Still check it against the card in the clubhouse.</p>"
      : src.kind === "checked"
      ? '<p class="sc-trust ok">✓ Checked by you on ' + esc(fmtDate(src.at)) + ".</p>"
      : src.kind === "compared"
      ? '<p class="sc-trust ok">✓ Checked against ' + esc(src.from.join(" and ")) + ". Save it below so it's ready next time.</p>"
      : blank
      ? '<p class="sc-trust warn">This course has no numbers yet. Upload its card, or paste a link to it on the course\'s website.</p>'
      : '<p class="sc-trust warn">From OpenGolfAPI, which is often off. Check it against the real card before you start.</p>';
    app.innerHTML = bar('<button class="sc-icon sc-back" type="button" data-act="home" aria-label="Back">&larr;</button>', esc(draft.name), sunBtn) +
      '<section class="sc-pad">' +
        '<p class="sc-place">' + esc(draft.place || "") + "</p>" + trust + cardPanel() +
        (blank ? "" : '<h3 class="sc-sub">Tee</h3><div class="sc-tees">' + draft.tees.map(teeBtn).join("") + "</div>") +
        (draft.holes === 9 && !blank ? '<h3 class="sc-sub">Holes</h3><div class="sc-nines"><p class="sc-muted small">Playing 18 here with another nine?</p>' +
          '<button type="button" class="sc-cc-btn" data-act="nines">Add a second nine</button></div>' : "") +
        (draft.holes > 9 && !blank ? '<h3 class="sc-sub">Holes</h3><div class="sc-seg" role="radiogroup">' +
          [["18", "18"], ["front", "Front 9"], ["back", "Back 9"]].map(function (o) {
            return '<button type="button" role="radio" data-nine="' + o[0] + '" aria-checked="' + (o[0] === setupNine) + '">' + o[1] + "</button>";
          }).join("") + "</div>" : "") +
        (blank ? "" :
        '<h3 class="sc-sub">Date played</h3><input type="date" id="sc-date" class="sc-in sc-date" max="' + today() + '" value="' + esc(setupDay || today()) + '" aria-label="Date played">' +
        '<p class="sc-muted small sc-date-note"' + (setupDay && setupDay !== today() ? "" : " hidden") + '>An old round: enter each hole\'s score; putts and fairways can be left blank.</p>' +
        '<details class="sc-check"' + ((src.kind === "api" && !chk) || src.kind === "photo" || src.kind === "website" && !draft.card ? " open" : "") + "><summary>" +
          (chk ? "Look over the numbers" : "Check the numbers") + "</summary>" +
          '<p class="sc-muted small">Tap a par to change it. Yardage is for the tee you picked.</p><div class="sc-table"></div></details>' +
        '<label class="sc-approve" hidden><input type="checkbox" id="sc-approve" checked><span></span></label>' +
        '<button class="sc-go" type="button" data-act="start">Start round</button>') +
        (draft.credit ? '<p class="sc-credit">' + esc(draft.credit) + "</p>" : "") +
      "</section>";
    if (!blank) checkTable();
    cardPreview();
    // a course with no checked file: look for its own card on its website straight away (once per course here)
    if (!keep && !chk && draft.website && navigator.onLine !== false) lookupCard();
  }

  // ---------- the card check (phase 3): the course's website card and a photo of the clubhouse card, compared ----------

  var cc = { id: null, sources: [], status: "", now: null }; // this course's card sources: [{ id, label, course, checks }]
  var K_SNAP = "nm-scorecard-snap:", K_READ = "nm-scorecard-read:";

  function cardPanel() {
    var waiting = load(K_SNAP + cc.id, null);
    var diffs = cc.sources.length ? countDiffs() : 0;
    return '<section class="sc-cc">' +
      '<p class="sc-cc-status" aria-live="polite">' + esc(cc.status || (waiting ? "A card is waiting for signal to be read." : "")) + "</p>" +
      (cc.choices ? '<div class="sc-cc-choices">' + cc.choices.map(function (c, i) {
        return '<button type="button" class="sc-cc-btn" data-cand="' + i + '">' + esc(cardName(c)) + "</button>";
      }).join("") + "</div>" : "") +
      (cc.pictured ? '<p class="sc-cc-status">✓ Rounds here will be written on this card' + (draft.checked ? "." : ". Save the numbers as the course's card to keep it.") + "</p>" +
        (OWNER && cc.image && !draft.nines && draft.holes === 18 ? '<button type="button" class="sc-cc-btn sc-cc-wipe" data-act="wipecard">Card has writing on it? Wipe it off</button>' : "") : "") +
      // every course: what a finished round will look like on the card it uses (its card picture, Nick's hand-made
      // Pecan Hollow / Firewheel card, or the plain one)
      (draft && draft.tees && draft.tees.length ? '<button type="button" class="sc-cc-prev" data-act="cardprev" aria-label="See the card full screen">' +
        '<canvas class="sc-card"></canvas><span>An example round on this course\'s card. Tap to see it big.</span></button>' : "") +
      (cc.checks && cc.checks.length ? '<ul class="sc-cc-checks">' + cc.checks.map(function (x) { return "<li>" + esc(x.msg) + "</li>"; }).join("") + "</ul>" : "") +
      '<div class="sc-cc-actions">' +
        // no "Snap the card" for now (Nick, 2026-10-11): a phone photo's grid isn't found, so its rounds can't be
        // written onto it. Upload takes a saved card (a PDF or picture from the course's website)
        // a card saved from a website (or a photo already taken): no camera
        '<label class="sc-cc-btn"><input type="file" id="sc-upload" accept="image/*,application/pdf" hidden>' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5"/></svg> Upload</label>' +
        // a card that's been played on (scores written in): its round, imported
        (draft.tees.length ? '<label class="sc-cc-btn"><input type="file" id="sc-played" accept="image/*,application/pdf" hidden>Add a played round from a card</label>' : "") +
        (waiting ? '<button type="button" class="sc-cc-btn" data-act="readsnap">Read the card</button>' : "") +
        (draft.website && !cc.looked ? '<button type="button" class="sc-cc-btn" data-act="lookup">Find the website\'s card</button>' : "") +
        (cc.sources.length && draft.tees.length ? '<button type="button" class="sc-cc-btn go" data-act="compare">Compare' + (diffs ? " (" + diffs + ")" : "") + "</button>" : "") +
      "</div>" +
      '<form class="sc-cc-link" novalidate><input type="url" id="sc-cc-url" inputmode="url" autocomplete="off" placeholder="Or paste a link to the card" value="' + esc(cc.link || "") + '">' +
        '<button type="submit" class="sc-cc-btn">Read it</button></form>' +
      "</section>";
  }
  function ccPaint(status) {
    if (status != null) cc.status = status;
    var el = app.querySelector(".sc-cc");
    if (el) el.outerHTML = cardPanel();
    cardPreview();
  }
  // what a finished round will look like on the course's own card picture: an example round (par-ish scores)
  function exampleRound() {
    var holes = draft.par.map(function (p, i) { return i + 1; }), scores = {}, ups = [0, 1, 0, -1, 1, 0, 0, 1, 0];
    holes.forEach(function (n) {
      var par = draft.par[n - 1];
      scores[n] = { strokes: par + ups[(n - 1) % 9], putts: n % 4 === 2 ? 1 : 2, fairway: par === 3 ? null : ["hit", "left", "hit", "right"][n % 4] };
    });
    // always an eagle and a double bogey, so the preview shows both shaded marks (Nick, 2026-10-12): the eagle on the
    // first par 5 (else a par 4), with one putt; the double bogey on the last hole that isn't it
    var eagle = holes.filter(function (n) { return draft.par[n - 1] === 5; })[0] || holes.filter(function (n) { return draft.par[n - 1] === 4; })[0];
    if (eagle) { scores[eagle].strokes = draft.par[eagle - 1] - 2; scores[eagle].putts = 1; }
    var dbl = holes.filter(function (n) { return n !== eagle; }).pop();
    if (dbl) scores[dbl].strokes = draft.par[dbl - 1] + 2;
    return { id: "example", course: draft, tee: setupTee || defaultTee(draft), holes: holes, scores: scores, player: prefs.name || "Me", date: dayToIso(setupDay) };
  }
  function cardPreview() {
    var cv = app.querySelector(".sc-cc-prev canvas");
    if (cv && draft) NMCard.draw(cv, draft, exampleRound(), { scale: 0.8 }).catch(function () {});
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }

  // A card picture read into numbers: the whole card, then (only if its par or handicap rows don't hold up) a close-up
  // of that nine for just those rows (cardread.js closeUps)
  function readImage(img, holes, source) {
    // each AI reading kept on this phone by the picture's contents and the part asked: the same card uploaded again
    // costs no reads (only the matching runs again, 2026-10-12)
    var ask = function (image, part) {
      var key = "nm-scorecard-ask:" + part + ":" + fnv(image), kept = load(key, null);
      if (kept) return Promise.resolve(kept);
      return askAI(image, part).then(function (r) { save(key, { read: r.read }); return r; });
    };
    var askAI = function (image, part) {
      return api("/scorecard/read", { method: "POST", body: { visitorId: VID, image: image, part: part, holes: holes, source: source,
        text: part === "all" || part === "nines" ? NMCardRead.textOf(image) : undefined } });
    };
    // a single nine, or two played as one 18: the card may hold the club's other nines too, so every nine is read and
    // the ones being played are taken out (by name, as printed on the card)
    var names = draft && (draft.nines ? draft.name.split(" + ") : [nineName(draft)]);
    if (draft && (draft.nines || draft.holes === 9)) {
      // A three-nine card in one read can pass a minute, past what the reader allows. So the card is cut into its nines
      // (cardgrid.js), which are read side by side (about 15 s each). The whole card is read alongside only for its
      // rating table (per pair of nines) and its nines' names, and isn't waited on for long.
      // The nines are read side by side, one piece each (about 15 s), with a short read of the whole card for the
      // nines' names and its rating tables. Only if a piece fails is the whole card read in one go (which can pass a
      // minute and fail).
      var whole = function () {
        return ask(img, "nines").then(function (r) { return { read: r.read }; });
      };
      return NMCardRead.ninePieces(img).then(function (pieces) {
        if (!pieces) return whole();
        ccPaint("Reading the card's " + pieces.length + " nines…");
        var meta = ask(img, "meta").then(function (r) { return r.read || {}; }, function () { return {}; });
        return Promise.all([Promise.all(pieces.map(function (p) { return ask(p, "nine").then(function (r) { return r.read; }, function () { return null; }); })), meta])
          .then(function (got) {
            var reads = got[0], m = got[1];
            if (reads.some(function (r) { return !r; })) return whole(); // a piece failed
            var nines = reads.map(NMCardRead.asNine), named = Array.isArray(m.nines) ? m.nines : [];
            // each nine's name: the short whole-card read's first (it sees the rating table headings too), the piece's own
            // reading kept as a second try (Breckenridge's pieces once read BEVER, BEAR, RIDGE)
            if (named.length === nines.length) nines.forEach(function (n, i) {
              var m2 = typeof named[i] === "string" ? named[i] : named[i] && named[i].name;
              if (m2) { n.alt = n.name; n.name = m2; }
            });
            return { read: { nines: nines, ratings: Array.isArray(m.ratings) ? m.ratings : [] } };
          });
      }).then(function (res) {
        var read = NMCardRead.fromNines(res.read, names, draft.clubNines);
        if (read) read.order = ((res.read && res.read.nines) || []).map(function (x) { return String((x && x.name) || "").toLowerCase(); }); // the card's nines, left to right
        if (!read) {
          var found = ((res.read && res.read.nines) || []).map(function (x) { return x && x.name; }).filter(Boolean);
          throw new Error("Couldn't find " + names.join(" and ") + " on that card" + (found.length ? " (it shows " + found.join(", ") + ")" : "") + ".");
        }
        return read;
      });
    }
    // a long, thin card (Stone River's four panels in a row; Holiday Hills' table): shrunk whole, its numbers are too
    // small to read, so its two nines are cut out (with the row names) and read side by side
    var wide = new Promise(function (res) { var im = new Image(); im.onload = function () { res(im.naturalWidth / im.naturalHeight > 2.6); }; im.onerror = function () { res(false); }; im.src = img; });
    return wide.then(function (isWide) {
      if (!isWide || holes !== 18) return null;
      return NMCardRead.ninePieces(img).then(function (pieces) {
        if (!pieces || pieces.length !== 2) return null;
        ccPaint("Reading the card's two nines…");
        return Promise.all(pieces.map(function (p) { return ask(p, "nine").then(function (r) { return r.read; }); }))
          .then(function (reads) { return NMCardRead.fromHalves(reads[0], reads[1]); }, function () { return null; });
      });
    }).then(function (halves) {
      return halves || readWhole();
    });
    function readWhole() { return ask(img, "all").then(function (res) {
      var sides = NMCardRead.closeUps(res.read, holes);
      if (sides.length) ccPaint("Taking a closer look at the par and handicap rows…");
      // both nines at once when both need it
      return Promise.all(sides.map(function (side) {
        return NMCardRead.half(img, side).then(function (h) { return ask(h, side); }).then(function (close) { return close.read; }, function () { return null; });
      })).then(function (closes) {
        return closes.reduce(function (read, close, i) { return close ? NMCardRead.mergeCloseUp(read, sides[i], close) : read; }, res.read);
      });
    }); }
  }

  // a quick fingerprint of a picture's data (FNV-1a), to know a card uploaded before
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i += 7) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36) + "-" + str.length.toString(36);
  }

  // the course's own card from its website: found by the Worker, read once (and kept here by its address)
  // link: a page or card file the player pasted (else the course's website from its listing)
  function lookupCard(link) {
    var site = link || draft.website, where = hostOf(site);
    if (!link) cc.looked = true;
    ccPaint(link ? "Looking for the card at " + where + "…" : "Looking for the course's card on " + where + "…");
    var id = cc.id;
    api("/scorecard/lookup?site=" + encodeURIComponent(site) + "&name=" + encodeURIComponent(draft.fullName || draft.name) + (link ? "&given=1" : "")).then(function (d) {
      var all = d.candidates || [], c = all[0];
      if (cc.id !== id) return;
      if (!c) {
        ccPaint(d.note || (d.blocked
          ? where + " turns away apps like this one, so its card can't be read from here. Save the card from the site and upload it."
          : link ? "No card found on that page. Paste the card picture's own link (press and hold it, then Copy), or save it and upload it."
          : "Couldn't find a card on " + where + ". If it's there, paste its link below, or save it and upload it."));
        return;
      }
      // several cards that fit equally well (a park with three courses, under one name): ask which is this one
      var close = all.filter(function (x) { return x.score >= c.score - 1; });
      if (close.length > 1) {
        cc.choices = close;
        ccPaint((link ? "That page has " : "The course's website has ") + close.length + " cards. Which one is this course?");
        return;
      }
      readWebCard(c, id);
    }).catch(function (err) {
      if (cc.id !== id) return;
      cc.looked = false; // the "Find the website's card" button comes back, to try again
      ccPaint(err.status === 0 ? "No signal to look for the card." : err.message);
    });
  }
  function readWebCard(c, id) {
    cc.choices = null;
    var when = c.dated ? " (" + monthYear(c.dated) + ")" : "";
    (function () {
      ccPaint("Found the course's card" + when + ". Reading it…");
      var readKey = K_READ + c.url + (draft.nines || draft.holes === 9 ? "|" + draft.name : ""); // a 27-hole card: one read per nine or pair
      var kept = load(readKey, null);
      var reading = kept ? Promise.resolve(kept) : fetch(API + "/scorecard/file?u=" + encodeURIComponent(c.url), { headers: auth() })
        .then(function (r) { if (!r.ok) throw new Error("That website wouldn't send its card here. Save the card from the site and upload it instead."); return r.blob(); })
        .then(function (blob) { return NMCardRead.fromFile(new File([blob], c.url.split("/").pop(), { type: blob.type })); })
        .then(function (img) { cc.image = img; return readImage(img, draft.holes, c.url); })
        .then(function (read) { save(readKey, read); return read; });
      return reading.then(function (read) {
        if (cc.id !== id) return;
        addSource("web", "the website card" + when, read, { kind: "website", url: c.url, dated: c.dated, label: "the course's website card" + when });
        cardPicture(kept ? null : cc.image, read, c.url);
      });
    })().catch(function (err) {
      if (cc.id !== id) return;
      cc.looked = false;
      ccPaint(err.status === 0 ? "No signal to read the card." : err.message);
    });
  }
  function cardName(c) {
    var f = decodeURIComponent(c.url.split("/").pop().replace(/\.[a-z]+$/i, "")).replace(/[-_]+/g, " ").replace(/\d{3,}px/i, "").trim();
    return c.label && c.label.length < 60 ? c.label : f;
  }

  // The card itself as the course's scorecard (Nick only, 2026-10-11: "take the whole image of the course card and
  // input the round numbers directly into the boxes that exist on the card"): cardgrid.js finds its hole columns and
  // blank rows, the picture is kept on the server, and card.js writes each round onto it. Nothing to adjust: a card
  // whose grid isn't found (a skewed photo) keeps the plain card.
  //   img: the card read (else it's fetched again from url); read: its numbers (read.order: a 27-hole card's nines)
  function cardPicture(img, read, url, knownGrid) {
    if (!OWNER || !window.NMCardGrid) return;
    var id = draft.id;
    var source = img ? Promise.resolve(img) : !url ? Promise.reject() : fetch(API + "/scorecard/file?u=" + encodeURIComponent(url), { headers: auth() })
      .then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
      .then(function (blob) { return NMCardRead.fromFile(new File([blob], url.split("/").pop(), { type: blob.type })); });
    source.then(function (small) {
      return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = NMCardRead.bigOf(small); });
    }).then(function (im) {
      var grid = knownGrid || NMCardGrid.find(im);
      if (!grid) return; // a card with no blank rows (just a table, like Holiday Hills' website card) gets rows added underneath (card.js)
      var play;
      if (draft.nines || draft.holes === 9) {
        var names = draft.nines ? draft.name.split(" + ") : [nineName(draft)], order = (read && read.order) || [];
        // the columns the reader matched to these nines (fuzzy names, ruling out the club's others), when it saw as
        // many nines as the grid did
        if (read && read.picked && read.count === grid.nines.length) play = read.picked.slice();
        else play = names.map(function (nm, i) {
          var k = order.length === grid.nines.length ? order.findIndex(function (x) { return x.indexOf(nm.toLowerCase()) >= 0; }) : -1;
          return k >= 0 ? k : grid.nines.length === names.length ? i : -1;
        });
      } else play = grid.nines.length >= 2 ? [0, 1] : null;
      if (!play || play.some(function (k) { return k < 0 || !grid.nines[k]; })) return;
      // kept at up to 2400 px wide
      var kx = Math.min(1, 2400 / im.naturalWidth), c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * kx); c.height = Math.round(im.naturalHeight * kx);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      return api("/scorecard/art", { method: "POST", body: { image: c.toDataURL("image/jpeg", 0.86) } }).then(function (r) {
        if (!draft || draft.id !== id) return;
        draft.card = { kind: "photo", src: API + r.path, w: c.width, h: c.height, grid: grid, play: play, made: Date.now() };
        save(K.course + id, copy(draft));
        if (draft.checked) queueApproval(draft); // a saved card: a new version with its picture; otherwise it goes with the card's approval
        cc.pictured = true;
        ccPaint();
      });
    }).catch(function (e) { console.log("card picture not made:", e && e.message); });
  }

  // a photo of the card (or a PDF/picture of it): read now, or kept until there's signal
  function snap(file, uploaded) {
    var id = cc.id;
    ccPaint("Getting the photo ready…");
    NMCardRead.fromFile(file).then(function (img) {
      if (!save(K_SNAP + id, { img: img, at: Date.now(), up: !!uploaded })) throw new Error("The phone is out of room for the photo.");
      return readSnap();
    }).catch(function (err) { ccPaint(err.message); });
  }
  function readSnap() {
    var id = cc.id, waiting = load(K_SNAP + id, null);
    if (!waiting) return;
    if (navigator.onLine === false) { ccPaint("Saved. The photo will be read when there's signal."); return; }
    ccPaint("Reading the card…");
    cc.image = waiting.img;
    return readImage(waiting.img, draft.holes).then(function (read) {
      drop(K_SNAP + id);
      if (cc.id !== id) return;
      var what = waiting.up ? "the card you uploaded" : "your photo";
      addSource("photo", what, read, { kind: "photo", dated: today(), label: what + (waiting.up ? "" : " of the card") + " (" + fmtDate(new Date()) + ")" });
      cardPicture(waiting.img, read);
    }).catch(function (err) {
      ccPaint(err.status === 0 ? "Saved. The photo will be read when there's signal." : err.message);
    });
  }

  function addSource(sid, label, read, meta) {
    var made = NMCardRead.toCourse(read, { id: draft.id, name: draft.name, fullName: draft.fullName, place: draft.place, apiId: draft.apiId,
      nearApiId: draft.nearApiId, website: draft.website, credit: draft.credit, holes: draft.holes, kind: meta.kind, url: meta.url,
      dated: meta.dated, label: meta.label });
    if (!made.course.tees.length) { ccPaint("The card reader couldn't find any tees on " + label + ". Try a straighter, closer photo."); return; }
    cc.sources = cc.sources.filter(function (x) { return x.id !== sid; }).concat([{ id: sid, label: label, course: made.course, checks: made.checks, unread: made.unread }]);
    if (!draft.tees.length) { // a course with no numbers yet: the card is the course
      cc.status = "Read " + label + "." + (made.checks.length ? " Look these over below:" : "");
      cc.checks = made.checks;
      var c = made.course;
      c.checked = draft.checked;
      setup(c, true);
      return;
    }
    var n = countDiffs();
    // OpenGolfAPI's numbers and no saved card yet: the course's own card wins straight away (its tees, yardages, pars),
    // since OpenGolfAPI is often off (Holiday Hills: White and Red only, at other yardages). Compare still shows
    // OpenGolfAPI's numbers beside it, to take any of them instead.
    if (n && !draft.checked && (draft.source || {}).kind === "api" && !cc.inRound) {
      var card = copy(made.course);
      ["id", "name", "fullName", "place", "apiId", "nearApiId", "website", "credit", "card"].forEach(function (k) { if (draft[k] != null) card[k] = draft[k]; else delete card[k]; });
      cc.adopted = true;
      cc.status = "Using " + label + "'s numbers. OpenGolfAPI's differ in " + n + (n === 1 ? " place" : " places") + ": Compare to see them." +
        (made.checks.length ? " Some of the card's own totals don't add up." : "");
      setup(card, true);
      return;
    }
    ccPaint(n ? "The numbers differ from " + label + " in " + n + (n === 1 ? " place." : " places.") + (made.checks.length ? " Some of its numbers don't add up." : "")
      : "✓ " + label.charAt(0).toUpperCase() + label.slice(1) + " matches these numbers." + (made.checks.length ? " (Some of its own totals don't add up.)" : ""));
  }

  // ---------- comparing: every source side by side, only where they differ ----------

  function nowLabel() {
    var c = cc.now || draft, src = c.source || {};
    return c.checked ? "the course file" + (c.checked.version > 1 ? " (v" + c.checked.version + ")" : "")
      : src.kind === "api" ? "OpenGolfAPI" : src.kind === "website" ? "the saved card" + (src.dated ? " (" + monthYear(src.dated) + ")" : "")
      : src.kind === "checked" ? "your last check" : "what's here now";
  }
  function columns() {
    return [{ id: "now", label: nowLabel(), course: cc.adopted && cc.now ? cc.now : draft, checks: [] }].concat(cc.sources);
  }
  function teeKey(t) { return NMCardRead.slug(String(t.name).replace(/\s+tees?$/i, "")); }
  // the same tee on another source's card: by name, else by color, else by about the same length
  function matchTee(t, c) {
    var k = teeKey(t), byName = c.tees.filter(function (x) { return teeKey(x) === k; })[0];
    if (byName) return byName;
    var byColor = c.tees.filter(function (x) { return x.color && x.color === t.color && x.color !== "#8a8a86"; });
    if (byColor.length === 1) return byColor[0];
    var tot = yardsOf(t);
    return c.tees.filter(function (x) { return tot && Math.abs(yardsOf(x) - tot) / tot < 0.015; })[0] || null;
  }
  // every place the sources disagree, from the base's point of view: [{ key, group, label, opts: [{ v, from }] }]
  function diffList(baseId) {
    var cols = columns(), base = cols.filter(function (c) { return c.id === baseId; })[0] || cols[0], b = base.course, out = [];
    var n = b.holes;
    function item(key, group, label, get) {
      var opts = [], seen = {};
      cols.forEach(function (c) {
        var v = get(c.course);
        if (v == null || v === "") return;
        if (!seen[v]) { seen[v] = { v: v, from: [] }; opts.push(seen[v]); }
        seen[v].from.push(c.label);
      });
      var bv = get(b);
      if (opts.length > 1 || (opts.length === 1 && bv == null)) out.push({ key: key, group: group, label: label, opts: opts, base: bv, now: get(cols[0].course) });
    }
    for (var i = 0; i < n; i++) (function (i) {
      item("par:" + i, "Par", "Hole " + (i + 1), function (c) { return c.par && c.par.length === n ? c.par[i] : null; });
      item("hcp:" + i, "Handicap", "Hole " + (i + 1), function (c) { return c.hcp && c.hcp.length === n ? c.hcp[i] : null; });
      if (b.hcpWomen) item("hcpWomen:" + i, "Women's handicap", "Hole " + (i + 1), function (c) { return c.hcpWomen && c.hcpWomen.length === n ? c.hcpWomen[i] : null; });
    })(i);
    b.tees.forEach(function (t) {
      var g = t.name + " tees";
      var other = function (c) { return c === b ? t : matchTee(t, c); };
      item("tee:" + t.key + ":rating", g, "Rating", function (c) { var x = other(c); return x ? x.rating : null; });
      item("tee:" + t.key + ":slope", g, "Slope", function (c) { var x = other(c); return x ? x.slope : null; });
      for (var j = 0; j < n; j++) (function (j) {
        item("tee:" + t.key + ":yards:" + j, g, "Hole " + (j + 1) + " yards", function (c) { var x = other(c); return x && x.yards.length === n ? x.yards[j] : null; });
      })(j);
    });
    return { base: base, items: out };
  }
  function countDiffs() { return diffList(newestId()).items.length; }
  function newestId() {
    var ids = cc.sources.map(function (x) { return x.id; });
    return ids.indexOf("photo") >= 0 ? "photo" : ids.indexOf("web") >= 0 ? "web" : "now";
  }

  var cmp = null; // the compare screen's state: { baseId, picks: { key: value }, done }
  function compareScreen(done) {
    if (!at(2, drawCompare)) { cmp = { baseId: newestId(), picks: {}, done: done }; return; }
    cmp = { baseId: cmp && cmp.done === done ? cmp.baseId : newestId(), picks: {}, done: done };
    drawCompare();
  }
  function drawCompare() {
    if (!at(2, drawCompare)) return;
    var cols = columns(), d = diffList(cmp.baseId), groups = {}, order = [];
    // A read card's row that fails its own totals check (cardread.js) isn't trusted by default: there the checked
    // course file's number is picked (Firewheel's tiny Gold slope read 143 off the same row whose Out misread)
    var suspect = {};
    (d.base.checks || []).forEach(function (x) { suspect[x.where] = true; });
    d.items.forEach(function (it) {
      if (!groups[it.group]) { groups[it.group] = []; order.push(it.group); }
      groups[it.group].push(it);
      var p = it.key.split(":"), where = p[0] === "tee" ? "tee:" + p[1] : p[0];
      var trustNow = d.base.id !== "now" && suspect[where] && it.now != null && (draft.checked || (draft.source && !draft.source.read && draft.source.kind === "website"));
      if (!(it.key in cmp.picks)) cmp.picks[it.key] = trustNow ? it.now : it.base != null ? it.base : it.opts[0].v;
    });
    var playTee = teeOf(d.base.course, setupTee || defaultTee(d.base.course));
    var warn = [];
    cols.forEach(function (c) { (c.checks || []).forEach(function (x) { warn.push(c.label + ": " + x.msg); }); });
    app.innerHTML = bar('<button class="sc-icon sc-back" type="button" data-act="cmpback" aria-label="Back">&larr;</button>', "Compare the cards", sunBtn) +
      '<section class="sc-pad">' +
        '<p class="sc-muted small sc-cmp-intro">Where every source agrees, it\'s folded away. Tap the right number in each row, or ✎ to type what\'s on the card in your hand.</p>' +
        '<h3 class="sc-sub">Start from</h3><div class="sc-seg sc-seg-wrap" role="radiogroup">' + cols.map(function (c) {
          return '<button type="button" role="radio" data-base="' + c.id + '" aria-checked="' + (c.id === cmp.baseId) + '">' + esc(cap(c.label)) + "</button>";
        }).join("") + "</div>" +
        (warn.length ? '<div class="sc-cmp-warn">' + warn.map(function (w) { return "<p>" + esc(w) + "</p>"; }).join("") + "</div>" : "") +
        (d.items.length ? order.map(function (g) {
          var items = groups[g], open = d.items.length <= 12 || g === "Par" || g === "Handicap" || g === playTee.name + " tees";
          return '<details class="sc-check sc-cmp-group"' + (open ? " open" : "") + "><summary>" + esc(g) + ' <span class="sc-muted">' + items.length +
            (items.length === 1 ? " difference" : " differences") + "</span></summary>" + items.map(function (it) {
              return '<div class="sc-diff"><span class="sc-diff-label">' + esc(it.label) + '</span><div class="sc-diff-opts">' + it.opts.map(function (o) {
                return '<button type="button" class="sc-opt' + (String(cmp.picks[it.key]) === String(o.v) ? " on" : "") + '" data-pick="' + esc(it.key) + '" data-v="' + esc(o.v) + '"><b>' +
                  esc(o.v) + "</b><small>" + esc(o.from.join(" · ")) + "</small></button>";
              }).join("") + (it.opts.some(function (o) { return String(o.v) === String(cmp.picks[it.key]); }) ? "" :
                '<button type="button" class="sc-opt on"><b>' + esc(cmp.picks[it.key]) + "</b><small>typed</small></button>") +
                '<button type="button" class="sc-opt sc-type" data-type="' + esc(it.key) + '" aria-label="Type it">✎</button></div></div>';
            }).join("") + "</details>";
        }).join("") : '<p class="sc-trust ok">✓ Every source agrees.</p>') +
        '<button class="sc-go" type="button" data-act="cmpuse">Use these numbers</button>' +
      "</section>";
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  // the base source with the picked numbers, keeping the course's own identity (id, name, links, card look)
  function compared() {
    var cols = columns(), base = cols.filter(function (c) { return c.id === cmp.baseId; })[0] || cols[0];
    var c = copy(base.course);
    ["id", "name", "fullName", "place", "apiId", "nearApiId", "website", "credit", "checked", "card"].forEach(function (k) { if (draft[k] != null) c[k] = draft[k]; else delete c[k]; });
    Object.keys(cmp.picks).forEach(function (key) {
      var v = +cmp.picks[key], p = key.split(":");
      if (!Number.isFinite(v)) return;
      if (p[0] === "par" || p[0] === "hcp" || p[0] === "hcpWomen") { if (c[p[0]]) c[p[0]][+p[1]] = v; return; }
      var t = c.tees.filter(function (x) { return x.key === p[1]; })[0];
      if (!t) return;
      if (p[2] === "yards") { t.yards[+p[3]] = v; t.total = t.yards.every(function (y) { return y != null; }) ? t.yards.reduce(function (a, y) { return a + y; }, 0) : t.total; }
      else t[p[2]] = v;
    });
    // the course's hand-tuned card look stays only if every tee it draws is still there
    if (draft.card && (draft.card.rows || []).every(function (r) { return r.kind !== "tee" || c.tees.some(function (t) { return t.key === r.tee; }); })) c.card = draft.card;
    else delete c.card;
    c.source = { kind: "compared", from: cols.map(function (x) { return x.label; }), at: new Date().toISOString() };
    return c;
  }

  // "Add it from its card": a course that isn't listed (or is listed as something else, like Firewheel's Old Course)
  function newCourse(name) {
    if (!at(1, function () { newCourse(name); })) return;
    app.innerHTML = bar('<button class="sc-icon sc-back" type="button" data-act="home" aria-label="Back">&larr;</button>', "Add a course", sunBtn) +
      '<section class="sc-pad"><p class="sc-muted">Name it, then upload its card (or paste a link to it on its website) and the numbers fill in.</p>' +
      '<form class="sc-new"><label for="sc-new-name">Course name</label><input id="sc-new-name" class="sc-in" required maxlength="80" value="' + esc(name || "") + '" placeholder="Firewheel · Lakes Course">' +
      '<label for="sc-new-place">Town</label><input id="sc-new-place" class="sc-in" maxlength="80" placeholder="Garland, TX">' +
      '<label for="sc-new-site">Website <span class="sc-muted">(optional, to find its card)</span></label><input id="sc-new-site" class="sc-in" type="url" maxlength="300" placeholder="https://…">' +
      '<button class="sc-go" type="submit">Next</button></form></section>';
    app.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = app.querySelector("#sc-new-name").value.trim();
      if (!nm) return;
      var site = app.querySelector("#sc-new-site").value.trim();
      var slug = NMCardRead.slug(nm).slice(0, 48) + "-" + Math.random().toString(36).slice(2, 6);
      setup({ id: slug, name: nm, place: app.querySelector("#sc-new-place").value.trim(), website: /^https?:\/\//.test(site) ? site : undefined,
        holes: 18, par: Array(18).fill(4), hcp: Array(18).fill(null), tees: [], source: { kind: "card-only" } });
    });
  }

  // Nick's handicap index (GET /scorecard/handicap, worked out on the server from his Golf-page rounds): his course
  // handicap on each tee at setup, and a finished round's differential
  var hcp = null;
  function loadHandicap() {
    return api("/scorecard/handicap").then(function (d) { hcp = d; return d; }, function () { return hcp; });
  }
  function courseHcp(c, t) {
    if (!hcp || hcp.index == null || !t.rating || !t.slope) return null;
    var par = c.par.reduce(function (a, v) { return a + v; }, 0), nine = c.holes === 9 && t.rating < 50;
    return Math.round((nine ? hcp.index / 2 : hcp.index) * t.slope / 113 + (t.rating - par));
  }
  function teeBtn(t) {
    var ch = OWNER && draft ? courseHcp(draft, t) : null;
    var rs = (t.rating ? t.rating + "/" + t.slope : "") + (ch != null ? (t.rating ? " · " : "") + "course hcp " + ch : "");
    return '<button class="sc-tee" type="button" data-tee="' + esc(t.key) + '" aria-pressed="' + (t.key === setupTee) + '">' +
      '<span class="sc-swatch" style="background:' + esc(t.color) + '"></span><span class="sc-tee-name">' + esc(t.name) + "</span>" +
      '<span class="sc-tee-yds">' + fmtYds(yardsOf(t)) + " yds</span>" + (rs ? '<span class="sc-tee-rs">' + esc(rs) + "</span>" : "") + "</button>";
  }

  function checkTable() {
    var tee = teeOf(draft, setupTee), hc = hcpSet(draft, tee), n = draft.holes;
    var rows = "";
    for (var i = 0; i < n; i++) {
      rows += '<div class="sc-tr"><span class="sc-td-no">' + (i + 1) + "</span>" +
        '<button type="button" class="sc-par" data-par="' + i + '">' + draft.par[i] + "</button>" +
        '<input type="number" inputmode="numeric" class="sc-in" data-yds="' + i + '" value="' + (tee.yards[i] == null ? "" : tee.yards[i]) + '" placeholder="yds" aria-label="Hole ' + (i + 1) + ' yards">' +
        '<input type="number" inputmode="numeric" class="sc-in" data-hcp="' + i + '" value="' + (hc[i] == null ? "" : hc[i]) + '" placeholder="hcp" aria-label="Hole ' + (i + 1) + ' handicap"></div>';
    }
    var par = draft.par.reduce(function (a, b) { return a + b; }, 0);
    var sum = tee.yards.reduce(function (a, v) { return a + (v || 0); }, 0);
    var warn = tee.total && sum && sum !== tee.total ? '<p class="sc-warn">These holes add up to ' + fmtYds(sum) + " yds, but the tee says " + fmtYds(tee.total) + ". Check them.</p>" : "";
    var seen = {}, dup = hc.some(function (h) { if (h == null) return false; if (seen[h]) return true; seen[h] = 1; return false; });
    if (dup) warn += '<p class="sc-warn">A handicap is used twice: each one should appear once.</p>';
    app.querySelector(".sc-table").innerHTML = '<div class="sc-tr sc-th"><span>Hole</span><span>Par</span><span>Yds</span><span>Hcp</span></div>' + rows +
      '<div class="sc-tr sc-tt"><span>Total</span><span>' + par + "</span><span>" + fmtYds(sum || tee.total) + "</span><span></span></div>" + warn;
    approveBox();
  }

  // "Save as this course's card": offered when the course has no checked file yet, or (Nick) when he's changed
  // numbers in a checked one. A visitor can't replace a checked file; their changes stay with their own round.
  function approveBox() {
    var box = app.querySelector(".sc-approve");
    if (!box) return;
    var chk = draft.checked, edited = numbers(draft) !== original;
    var show = !chk || (OWNER && edited);
    box.hidden = !show;
    box.querySelector("span").textContent = !chk
      ? "Save these numbers as this course's card, so next time it's ready with no checking"
      : "Save my changes as the course's card (version " + (chk.version + 1) + ")";
  }

  // the club's other nines as buttons: tap one and the round is this nine, then that one
  var clubNines = [];
  function pickNine(btn) {
    var box = app.querySelector(".sc-nines"), id = draft.id;
    btn.classList.add("busy");
    otherNines(draft).then(function (list) {
      if (draft.id !== id || !box.isConnected) return;
      box.innerHTML = list.length
        ? (clubNines = [nineName(draft)].concat(list.map(function (x) { return nineName(x); })), "") +
          '<p class="sc-muted small">After ' + esc(nineName(draft)) + ", which nine?</p>" + list.map(function (x) {
            return '<button type="button" class="sc-cc-btn" data-then-nine="' + esc(x.id) + '">Then ' + esc(nineName(x)) + "</button>";
          }).join("")
        : '<p class="sc-muted small">No other nines found for ' + esc(clubOf(draft)) + ".</p>";
    }).catch(function (err) {
      btn.classList.remove("busy");
      alert(err.status === 0 ? "No signal to look for the other nines." : err.message);
    });
  }

  // Nick only: the course's saved card goes from the server (rounds already played keep their own copy), and the course
  // opens again from what's left: Nick's repo file, OpenGolfAPI, or its two nines
  function removeCard(btn) {
    var id = draft.id;
    if (!confirm("Remove the saved card for " + draft.name + "? Rounds already played keep their numbers.")) return;
    btn.disabled = true;
    api("/scorecard/courses/" + encodeURIComponent(id), { method: "DELETE" }).then(function () {
      drop(K.course + id);
      save(K.approve, load(K.approve, []).filter(function (x) { return x.id !== id; }));
      filed = null;
      return loadCourse(id).then(function (c) { delete c.checked; setup(c); }, function () { home(); });
    }).catch(function (err) {
      btn.disabled = false;
      alert(err.status === 0 ? "No signal to remove it." : err.message);
    });
  }

  function startRound() {
    var tee = teeOf(draft, setupTee), n = draft.holes;
    var holes = [];
    for (var i = 1; i <= n; i++) if (setupNine === "18" || (setupNine === "front" ? i <= 9 : i > 9)) holes.push(i);
    var ab = app.querySelector(".sc-approve");
    if (ab && !ab.hidden && ab.querySelector("input").checked) queueApproval(draft);
    round = { id: uuid(), v: 1, course: draft, tee: tee.key, holes: holes, scores: {}, current: holes[0],
      player: prefs.name || "", date: dayToIso(setupDay), day: setupDay || today(), startedAt: Date.now(), updatedAt: Date.now(),
      onSite: OWNER }; // Nick's rounds go on his Golf page unless he turns it off at the end
    prefs.tees[draft.id] = tee.key;
    prefs.recent = [{ id: draft.id, name: draft.name, place: draft.place }].concat(prefs.recent.filter(function (r) { return r.id !== draft.id; })).slice(0, 8);
    savePrefs();
    // the course as checked here is kept on this phone too (offline, and until its approval reaches the server)
    save(K.course + draft.id, copy(draft));
    undo = [];
    saveRound();
    holeScreen();
  }

  // ---------- the round ----------

  // every change: stamped (newest wins on the server) and sent when there's signal; just moving between holes isn't a change
  function saveRound(moveOnly) {
    if (!moveOnly) round.updatedAt = Date.now();
    save(K.round, round);
    if (!moveOnly) queueSync();
  }

  // ---------- sync: this phone's rounds to the server, whenever there's signal ----------

  var syncing = false, again = false, syncTimer = null;
  function dayOf(r) {
    if (r.day) return r.day;
    var d = new Date(r.date || Date.now());
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function waiting() {
    var list = load(K.rounds, []).filter(function (r) { return (r.updatedAt || 0) > (r.ackAt || 0); });
    if (round && (round.updatedAt || 0) > (round.ackAt || 0)) list.unshift(round);
    return list;
  }
  function pendingCount() { return waiting().length + load(K.del, []).length + load(K.approve, []).length; }
  // the little dot by the round's name (and Past rounds): green = all saved to the server, amber = waiting for signal
  function dot() {
    var n = pendingCount();
    app.querySelectorAll(".sc-sync").forEach(function (el) {
      el.className = "sc-sync " + (n ? "wait" : "ok");
      el.title = n ? "Saved on this phone; goes to the server when there's signal" : "Saved";
    });
  }
  function queueSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncAll, ms == null ? 2500 : ms);
    dot();
  }
  // What a round sends: its header and totals, the course as played (the first time only), the holes changed since
  // the server's last copy, and which holes have a score at all (so an undone hole is deleted there too)
  function payload(r) {
    var tee = teeOf(r.course, r.tee), hc = hcpSet(r.course, tee), st = stats(r), scores = {}, present = [];
    r.holes.forEach(function (n) {
      var x = r.scores[n];
      if (!x || x.strokes == null) return;
      present.push(n);
      if ((x.at || 0) <= (r.ackAt || 0)) return;
      scores[n] = { strokes: x.strokes, putts: x.putts, fairway: x.fairway, gir: x.gir, girShown: NMCard.greenOf(r.course, r, n),
        penalties: x.penalties || 0, par: r.course.par[n - 1], yards: tee.yards[n - 1], hcp: hc[n - 1], at: x.at || r.updatedAt };
    });
    return {
      visitorId: VID,
      round: { courseId: r.course.id, courseName: r.course.name, courseVersion: r.course.checked ? r.course.checked.version : null,
        tee: r.tee, teeName: tee.name, holes: r.holes, player: r.player, day: dayOf(r), date: r.date,
        finishedAt: r.finishedAt || null, updatedAt: r.updatedAt, onSite: !!r.onSite,
        totals: { strokes: st.strokes, par: st.par, putts: st.puttsHoles ? st.putts : null, firHit: st.fw, firLeft: st.fwL, firRight: st.fwR,
          firTotal: st.fwN, gir: st.gir, girTotal: st.girN, penalties: st.pen, done: st.done } },
      course: r.courseAcked ? undefined : r.course, scores: scores, present: present,
    };
  }
  function acked(id, sentAt) {
    var mark = function (x) { x.ackAt = Math.max(x.ackAt || 0, sentAt); x.courseAcked = true; };
    if (round && round.id === id) { mark(round); save(K.round, round); }
    var past = load(K.rounds, []);
    past.forEach(function (x) { if (x.id === id) mark(x); });
    save(K.rounds, past);
  }
  function syncAll() {
    if (!ready) return;
    if (syncing) { again = true; return; }
    var dels = load(K.del, []), approvals = load(K.approve, []), todo = waiting();
    if (!dels.length && !approvals.length && !todo.length) { dot(); return; }
    syncing = true;
    var chain = Promise.resolve(), offline = false;
    dels.forEach(function (id) {
      chain = chain.then(function () {
        if (offline) return;
        return api("/scorecard/rounds/" + encodeURIComponent(id) + "?visitorId=" + encodeURIComponent(VID), { method: "DELETE" })
          .then(function () { save(K.del, load(K.del, []).filter(function (x) { return x !== id; })); })
          .catch(function (e) { if (!e.status) offline = true; });
      });
    });
    approvals.forEach(function (a) {
      chain = chain.then(function () {
        if (offline) return;
        return api("/scorecard/courses/" + encodeURIComponent(a.id) + "/approve", { method: "POST", body: { visitorId: VID, course: a.course } })
          .then(function (res) {
            save(K.approve, load(K.approve, []).filter(function (x) { return x.id !== a.id; }));
            filed = null;
            if (res.saved) { // the copy on this phone, and a round being played on it, now carry the version
              var kept = load(K.course + a.id, null);
              if (kept) { kept.checked = res.checked; save(K.course + a.id, kept); }
              if (round && round.course.id === a.id && !round.course.checked) { round.course.checked = res.checked; save(K.round, round); }
            }
          })
          .catch(function (e) {
            if (!e.status) offline = true;
            else if (e.status < 500) save(K.approve, load(K.approve, []).filter(function (x) { return x.id !== a.id; })); // refused: don't retry forever
          });
      });
    });
    todo.forEach(function (r) {
      chain = chain.then(function () {
        if (offline) return;
        var sentAt = r.updatedAt;
        return api("/scorecard/rounds/" + encodeURIComponent(r.id), { method: "PUT", body: payload(r) })
          .then(function () { acked(r.id, sentAt); })
          .catch(function (e) {
            if (!e.status) offline = true;
            else if (e.status === 403 || e.status === 400) acked(r.id, sentAt); // refused for good: stop retrying (the phone keeps it)
          });
      });
    });
    chain.then(function () {
      syncing = false;
      dot();
      if (again) { again = false; queueSync(500); }
    });
  }
  function queueApproval(c) {
    var course = copy(c);
    delete course.checked;
    save(K.approve, load(K.approve, []).filter(function (x) { return x.id !== c.id; }).concat([{ id: c.id, course: course }]));
    queueSync(0);
  }
  function S(n) { return round.scores[n] || {}; }
  function parOf(n) { return round.course.par[n - 1]; }
  function stats(r) {
    var c = r.course, o = { strokes: 0, par: 0, putts: 0, puttsHoles: 0, done: 0, fw: 0, fwL: 0, fwR: 0, fwN: 0, gir: 0, girN: 0, pen: 0, kinds: {} };
    r.holes.forEach(function (n) {
      var s = r.scores[n] || {};
      if (s.strokes == null) return;
      var p = c.par[n - 1], d = s.strokes - p;
      o.done++; o.strokes += s.strokes; o.par += p;
      if (s.putts != null) { o.putts += s.putts; o.puttsHoles++; }
      var fw = NMCard.fairwayOf(c, r, n); // an unmarked par 4 or 5 is a miss once any fairway was marked
      if (fw) { o.fwN++; if (fw === "hit") o.fw++; else if (fw === "left") o.fwL++; else if (fw === "right") o.fwR++; }
      var g = NMCard.greenOf(c, r, n); // out of every hole played once any green is known
      if (g != null) { o.girN++; if (g) o.gir++; }
      o.pen += s.penalties || 0;
      var kind = d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : "double";
      o.kinds[kind] = (o.kinds[kind] || 0) + 1;
    });
    o.toPar = o.strokes - o.par;
    return o;
  }

  function holeScreen(dir) {
    if (!round) return home();
    if (!at(1, function () { holeScreen(); })) return;
    var n = round.current, c = round.course, tee = teeOf(c, round.tee), s = S(n), par = parOf(n);
    var set = s.strokes != null, strokes = set ? s.strokes : par;
    var idx = round.holes.indexOf(n), last = idx === round.holes.length - 1;
    var t = stats(round);
    var gir = NMCard.girOf(c, round, n);
    var quick = [par - 1, par, par + 1, par + 2];
    var strip = round.holes.map(function (k) {
      var sk = S(k), d = sk.strokes != null ? sk.strokes - parOf(k) : null;
      var cls = (k === n ? " cur" : "") + (d == null ? "" : d < 0 ? " under" : d === 0 ? " even" : d === 1 ? " over" : " over2");
      return '<button type="button" class="sc-dot' + cls + '" data-go="' + k + '" aria-label="Hole ' + k + (d == null ? "" : ", " + sk.strokes) + '">' + k + "</button>";
    }).join("");
    app.innerHTML =
      '<div class="sc-play">' +
      '<header class="sc-bar">' +
        '<button class="sc-icon" type="button" data-act="menu" aria-label="Menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
        '<div class="sc-title"><b>' + esc(c.name) + "</b><span>" + esc(tee.name) + " tees" + (round.day && round.day !== today() ? " · " + esc(fmtDate(round.date)) : "") +
          ' <i class="sc-sync" aria-hidden="true"></i></span></div>' +
        '<button class="sc-icon" type="button" data-act="undo" aria-label="Undo"' + (undo.length ? "" : " disabled") + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>' +
      "</header>" +
      '<nav class="sc-strip" aria-label="Holes">' + strip + "</nav>" +
      '<section class="sc-hole" aria-live="polite">' +
        '<div class="sc-hole-head"><div class="sc-hole-no"><span>Hole</span><b>' + n + "</b></div>" +
          '<div class="sc-hole-info"><span>Par <b>' + par + "</b></span>" +
          (tee.yards[n - 1] ? "<span><b>" + tee.yards[n - 1] + "</b> yds</span>" : "") +
          (hcpSet(c, tee)[n - 1] ? "<span>Hcp <b>" + hcpSet(c, tee)[n - 1] + "</b></span>" : "") + "</div></div>" +
        '<div class="sc-score">' +
          '<button class="sc-step" type="button" data-act="minus" aria-label="One less">&minus;</button>' +
          '<button type="button" class="sc-strokes' + (set ? " set" : "") + '" data-act="setpar" aria-label="' + (set ? strokes + ", " + rel(strokes - par) : "Score a par") + '"><b>' + strokes + "</b><span>" + (set ? rel(strokes - par) : "Tap for par") + "</span></button>" +
          '<button class="sc-step" type="button" data-act="plus" aria-label="One more">+</button>' +
        "</div>" +
        '<div class="sc-quick">' + quick.map(function (v) {
          return '<button type="button" class="sc-chip' + (set && strokes === v ? " on" : "") + '" data-strokes="' + v + '"><b>' + v + "</b><span>" + rel(v - par) + "</span></button>";
        }).join("") + "</div>" +
        '<div class="sc-line"><span class="sc-label">Putts</span><div class="sc-chips">' + [0, 1, 2, 3, 4].map(function (v) {
          var on = v === 4 ? s.putts >= 4 : s.putts === v;
          return '<button type="button" class="sc-chip' + (on ? " on" : "") + '" data-putts="' + v + '">' + (v === 4 ? (s.putts > 4 ? s.putts : "4+") : v) + "</button>";
        }).join("") + "</div></div>" +
        (par !== 3 ? '<div class="sc-line"><span class="sc-label">Fairway</span><div class="sc-chips sc-fw">' +
          [["left", "&larr; Left"], ["hit", "✓ Hit"], ["right", "Right &rarr;"]].map(function (f) {
            return '<button type="button" class="sc-chip' + (s.fairway === f[0] ? " on" : "") + '" data-fw="' + f[0] + '">' + f[1] + "</button>";
          }).join("") + "</div></div>" : '<div class="sc-line sc-par3"><span class="sc-label">Fairway</span><span class="sc-muted">Par 3, no fairway</span></div>') +
        '<div class="sc-line sc-extras">' +
          '<button type="button" class="sc-pill' + (gir === true ? " on" : "") + '" data-act="gir">Green ' + (gir == null ? "–" : gir ? "✓" : "✗") +
            '<small>' + (s.gir === true || s.gir === false ? "you set it" : gir == null ? "after putts" : "auto") + "</small></button>" +
          '<button type="button" class="sc-pill' + (s.penalties ? " on warn" : "") + '" data-act="pen">+1 penalty' + (s.penalties ? " <b>" + s.penalties + "</b>" : "") + "</button>" +
          (s.penalties ? '<button type="button" class="sc-x" data-act="penclear" aria-label="Clear penalties">&times;</button>' : "") +
        "</div>" +
      "</section>" +
      '<footer class="sc-foot">' +
        '<button class="sc-nav" type="button" data-act="prev"' + (idx ? "" : " disabled") + ">&lsaquo; " + (idx ? round.holes[idx - 1] : "") + "</button>" +
        '<div class="sc-total"><b>' + (t.done ? t.strokes : "–") + "</b><span>" + (t.done ? toPar(t.toPar) + " · thru " + t.done : "No holes yet") + "</span></div>" +
        (last ? '<button class="sc-nav sc-finish" type="button" data-act="finish">Finish</button>'
              : '<button class="sc-nav" type="button" data-act="next">' + round.holes[idx + 1] + " &rsaquo;</button>") +
      "</footer></div>";
    var hole = app.querySelector(".sc-hole");
    if (dir) { // slide the new hole in from the side we're going to
      hole.style.transition = "none";
      hole.style.transform = "translateX(" + (dir > 0 ? 40 : -40) + "%)";
      hole.style.opacity = "0";
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        hole.style.transition = "";
        hole.style.transform = "";
        hole.style.opacity = "";
      }); });
    }
    var cur = app.querySelector(".sc-dot.cur");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "center" });
    swipe(hole);
    keepAwake();
    dot();
  }

  // a change to hole n: undo remembers what it was; any entry on a hole also sets its score (par if not tapped yet)
  function change(fn) {
    var n = round.current;
    undo.push({ n: n, before: round.scores[n] ? copy(round.scores[n]) : null });
    if (undo.length > 20) undo.shift();
    var s = round.scores[n] = round.scores[n] || {};
    fn(s);
    if (s.strokes == null) s.strokes = parOf(n);
    s.at = Date.now();
    saveRound();
    buzz();
    holeScreen();
  }

  function go(n, dir) {
    if (round.holes.indexOf(n) < 0 || n === round.current) return;
    dir = dir || (round.holes.indexOf(n) > round.holes.indexOf(round.current) ? 1 : -1);
    round.current = n;
    saveRound(true);
    holeScreen(dir);
  }
  function step(d) {
    var i = round.holes.indexOf(round.current) + d;
    if (i < 0 || i >= round.holes.length) return false;
    go(round.holes[i], d);
    return true;
  }

  // sideways swipes change holes; the hole follows the finger, then springs back or slides away
  function swipe(el) {
    var x0 = null, y0 = 0, dx = 0, sideways = null;
    el.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; sideways = null;
      el.style.transition = "none";
    }, { passive: true });
    el.addEventListener("touchmove", function (e) {
      if (x0 == null) return;
      if (e.touches.length > 1) { x0 = null; el.style.transition = ""; el.style.transform = ""; return; }
      dx = e.touches[0].clientX - x0;
      var dy = e.touches[0].clientY - y0;
      if (sideways == null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) sideways = Math.abs(dx) > Math.abs(dy) * 1.2;
      if (!sideways) return;
      var i = round.holes.indexOf(round.current);
      var edge = (dx > 0 && i === 0) || (dx < 0 && i === round.holes.length - 1);
      el.style.transform = "translateX(" + (edge ? dx * 0.25 : dx) + "px)";
    }, { passive: true });
    el.addEventListener("touchend", function () {
      if (x0 == null) return;
      x0 = null;
      el.style.transition = "";
      if (sideways && Math.abs(dx) > 70 && step(dx < 0 ? 1 : -1)) return;
      el.style.transform = "";
    });
  }

  function keepAwake() {
    if (prefs.wake === false || wake || !navigator.wakeLock) return;
    navigator.wakeLock.request("screen").then(function (l) {
      wake = l;
      l.addEventListener("release", function () { wake = null; });
    }).catch(function () {});
  }
  function releaseWake() { if (wake) { wake.release().catch(function () {}); wake = null; } }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && round && !round.finishedAt && app.querySelector(".sc-play")) keepAwake();
    if (document.visibilityState === "visible") queueSync(0);
  });

  // ---------- menu ----------

  function sheet(html, onclick) {
    var d = document.createElement("dialog");
    d.className = "sc-sheet";
    d.innerHTML = html;
    document.body.appendChild(d);
    // Back closes it: it takes a history step of its own, given back when it's closed another way. A choice runs only
    // once that step is back (else the step coming back would undo what the choice opens, like the card viewer's own)
    var stepped = false, after = null;
    function done() {
      window.removeEventListener("popstate", onPop);
      var f = after;
      after = null;
      if (f) f();
    }
    function onPop() {
      stepped = false;
      if (d.open) d.close();
      done();
    }
    try { history.pushState({ scSheet: true }, ""); stepped = true; window.addEventListener("popstate", onPop); } catch (e) {}
    d.addEventListener("close", function () {
      d.remove();
      if (stepped) { stepped = false; history.back(); } // onPop runs the choice when the step is back
      else done();
    });
    d.addEventListener("click", function (e) {
      if (e.target === d) return d.close(); // the backdrop
      var b = e.target.closest("[data-m]");
      if (!b || b.tagName === "A") return; // a link just goes
      after = function () { onclick(b.dataset.m, b); };
      d.close();
    });
    d.showModal();
    return d;
  }

  function menu() {
    sheet('<div class="sc-sheet-body">' +
      '<button type="button" data-m="card">Scorecard so far</button>' +
      '<button type="button" data-m="check">Check the card</button>' +
      '<button type="button" data-m="finish">Finish round</button>' +
      '<button type="button" data-m="sun">Sun mode: ' + (prefs.sun ? "on" : "off") + "</button>" +
      '<button type="button" data-m="wake">Keep screen on: ' + (prefs.wake === false ? "off" : "on") + "</button>" +
      '<button type="button" data-m="name">Name on the card: ' + esc(prefs.name || "none") + "</button>" +
      '<a href="/extras/" data-m="leave">Back to Extras (the round stays saved)</a>' +
      '<button type="button" data-m="quit" class="danger">Quit without saving</button>' +
      '<button type="button" data-m="close" class="sc-ghost">Close</button></div>', function (m) {
      if (m === "card") showCard();
      if (m === "check") roundCheck();
      if (m === "finish") finish();
      if (m === "sun") { prefs.sun = !prefs.sun; savePrefs(); document.body.classList.toggle("sun", prefs.sun); }
      if (m === "wake") { prefs.wake = prefs.wake === false; savePrefs(); if (prefs.wake === false) releaseWake(); else keepAwake(); }
      if (m === "name") {
        var v = prompt("Name on the scorecard", prefs.name || "");
        if (v != null) { prefs.name = v.trim().slice(0, 24); savePrefs(); round.player = prefs.name; saveRound(); }
      }
      if (m === "quit" && confirm("Quit this round? Its scores will be deleted, here and on the server.")) {
        save(K.del, load(K.del, []).filter(function (x) { return x !== round.id; }).concat([round.id]));
        drop(K.round);
        round = null;
        queueSync(0);
        home();
      }
    });
  }

  function showCard() { viewer(round); }

  // During a round: upload the card (or find the website's), compare, and fix this round's numbers (and the course file)
  function roundCheck() {
    if (!at(2, function () { roundCheck(); })) return;
    draft = copy(round.course);
    original = numbers(draft);
    setupTee = round.tee;
    cc = { id: draft.id, sources: [], status: "", now: copy(round.course), inRound: true };
    app.innerHTML = bar('<button class="sc-icon sc-back" type="button" data-act="cmpback" aria-label="Back">&larr;</button>', "Check the card", sunBtn) +
      '<section class="sc-pad"><p class="sc-muted">Upload the course\'s card (or find its own), then compare it with the numbers this round is using.</p>' +
      cardPanel() + "</section>";
    if (load(K_SNAP + cc.id, null) && navigator.onLine !== false) readSnap();
  }

  function viewer(r) { NMCardViewer.open(r); }
  // ---------- finish ----------

  function finish() {
    var missing = round.holes.filter(function (k) { return S(k).strokes == null; });
    if (missing.length === round.holes.length) { alert("Score at least one hole first."); return; }
    if (missing.length && !confirm((missing.length === 1 ? "Hole " + missing[0] + " has" : "Holes " + missing.join(", ") + " have") + " no score. Finish anyway?")) return;
    round.finishedAt = Date.now();
    var past = load(K.rounds, []).filter(function (r) { return r.id !== round.id; });
    past.unshift(round);
    save(K.rounds, past.slice(0, KEEP));
    drop(K.round);
    var done = round;
    round = null;
    releaseWake();
    queueSync(0);
    summary(done);
  }

  function summary(r) {
    if (!at(1, function () { summary(r); })) return;
    var s = stats(r), c = r.course, tee = teeOf(c, r.tee);
    var tile = function (label, big, small) { return '<div class="sc-stat"><span>' + label + "</span><b>" + big + "</b>" + (small ? "<small>" + small + "</small>" : "") + "</div>"; };
    var kinds = ["eagle", "birdie", "par", "bogey", "double"].filter(function (k) { return s.kinds[k]; }).map(function (k) {
      return s.kinds[k] + " " + (k === "double" ? "double+" : k) + (s.kinds[k] > 1 && k !== "double" ? "s" : "");
    }).join(" · ");
    app.innerHTML = bar('<button class="sc-icon sc-back" type="button" data-act="home" aria-label="Back">&larr;</button>', "Round", sunBtn) +
      '<section class="sc-pad">' +
        '<div class="sc-sum-head"><b>' + s.strokes + "</b><span>" + toPar(s.toPar) + "</span></div>" +
        '<p class="sc-sum-sub">' + esc(c.name) + " · " + esc(tee.name) + " tees · " + esc(fmtDate(r.date)) +
          (s.done < r.holes.length ? " · " + s.done + " of " + r.holes.length + " holes" : r.holes.length === 9 ? " · 9 holes" : "") + "</p>" +
        (kinds ? '<p class="sc-kinds">' + esc(kinds) + "</p>" : "") +
        (OWNER ? '<p class="sc-hcp" aria-live="polite"></p>' : "") +
        '<div class="sc-stats">' +
          tile("Putts", s.puttsHoles ? s.putts : "–", s.puttsHoles ? (s.putts / s.puttsHoles).toFixed(1) + " a hole" : "") +
          tile("Fairways", s.fwN ? s.fw + "/" + s.fwN : "–", s.fwN ? (s.fwL + s.fwR ? "missed " + s.fwL + " left, " + s.fwR + " right" + (s.fwN - s.fw - s.fwL - s.fwR ? ", " + (s.fwN - s.fw - s.fwL - s.fwR) + " unmarked" : "") : "missed " + (s.fwN - s.fw)) : "") +
          tile("Greens", s.girN ? s.gir + "/" + s.girN : "–", s.girN ? Math.round(s.gir / s.girN * 100) + "% in regulation" : "") +
          tile("Penalties", s.pen, "") +
        "</div>" +
        '<button type="button" class="sc-cardwrap" data-act="viewcard" aria-label="Open the scorecard full screen"><canvas class="sc-card"></canvas><span>Tap to zoom</span></button>' +
        '<div class="sc-actions"><button class="sc-go" type="button" data-act="image">Save image</button>' +
          (navigator.share ? '<button class="sc-go alt" type="button" data-act="share">Share</button>' : "") + "</div>" +
        '<div class="sc-actions small"><button type="button" data-act="csv">CSV</button><button type="button" data-act="json">JSON</button><button type="button" data-act="ghin">For GHIN</button></div>' +
        '<div class="sc-ghin" hidden></div>' +
        (OWNER ? '<label class="sc-approve sc-site"><input type="checkbox" id="sc-site"' + (r.onSite ? " checked" : "") + '><span>Show on my Golf page' +
          '<small>On the Golf page and the home page\'s Lately strip (only you see it until the Scorecard is public)</small></span></label>' : "") +
        '<div class="sc-actions small"><button type="button" data-act="edit">Edit scores</button><button type="button" data-act="redate">Change date</button>' +
          '<button type="button" data-act="delete" class="danger">Delete round</button></div>' +
        '<div class="sc-redate" hidden><label for="sc-redate">Date played</label><input type="date" id="sc-redate" class="sc-in sc-date" max="' + today() + '" value="' + esc(dayOf(r)) + '"></div>' +
        '<p class="sc-credit">' + esc(sourceLine(c)) + "</p>" +
      "</section>";
    app.dataset.round = r.id;
    NMCard.draw(app.querySelector(".sc-card"), c, r, { scale: 2 });
    if (OWNER) roundHcp(r, 0);
  }
  // this round's differential and the index after it, once the round has reached the server (asked again a few times
  // while it syncs)
  function roundHcp(r, tries) {
    var el = app.querySelector(".sc-hcp");
    if (!el || app.dataset.round !== r.id) return;
    if (!r.onSite) { el.textContent = "Not on your Golf page, so it doesn't count toward your handicap."; return; }
    loadHandicap().then(function (d) {
      if (!el.isConnected || app.dataset.round !== r.id) return;
      var x = d && (d.rounds || []).filter(function (y) { return y.id === r.id; })[0];
      if (!x) { if (tries < 4) setTimeout(function () { roundHcp(r, tries + 1); }, 2500); return; }
      el.textContent = x.differential != null
        ? "Differential " + x.differential + (x.used ? " (counting)" : "") + (d.index != null ? " · handicap index " + d.index : "")
        : x.note || "";
    });
  }

  function sourceLine(c) {
    var src = c.source || {};
    var from = src.kind === "website" ? "Course data from " + (src.name || "the course's card") + (src.dated ? ", " + monthYear(src.dated) : "") + "."
      : src.kind === "checked" ? "Course data from OpenGolfAPI, checked by you." : "Course data from OpenGolfAPI.";
    return from + (c.credit ? " " + c.credit : "");
  }

  function pastById(id) { return load(K.rounds, []).filter(function (r) { return r.id === id; })[0]; }
  function fileName(r, ext) {
    return "scorecard-" + String(r.course.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + String(r.date).slice(0, 10) + "." + ext;
  }
  // Chrome on Android saves a download without a word (Nick, 2026-10-10: tapping again only asked "download again?"),
  // so the page says so itself, and the button shows it for a moment
  function download(blob, name, button) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Saved to your Downloads: " + name);
    if (button) {
      var was = button.innerHTML;
      button.innerHTML = "Saved ✓";
      button.disabled = true;
      setTimeout(function () { button.innerHTML = was; button.disabled = false; }, 2500);
    }
  }
  function toast(msg) {
    var t = document.querySelector(".sc-toast");
    if (!t) { t = document.createElement("div"); t.className = "sc-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("in");
    clearTimeout(t.timer);
    t.timer = setTimeout(function () { t.classList.remove("in"); }, 3500);
  }
  function cardBlob(r) {
    var cv = document.createElement("canvas");
    return NMCard.draw(cv, r.course, r, { scale: 2.5 }).then(function () {
      return new Promise(function (res) { cv.toBlob(res, "image/png"); });
    });
  }

  function csv(r) {
    var tee = teeOf(r.course, r.tee), hc = hcpSet(r.course, tee);
    var q = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = ["date,course,tee,hole,par,yards,handicap,strokes,putts,fairway,green_in_regulation,penalties"];
    r.holes.forEach(function (n) {
      var s = r.scores[n] || {}, g = NMCard.greenOf(r.course, r, n);
      lines.push([String(r.date).slice(0, 10), r.course.name, tee.name, n, r.course.par[n - 1], tee.yards[n - 1], hc[n - 1],
        s.strokes, s.putts, NMCard.fairwayOf(r.course, r, n) || "", g == null ? "" : g ? "yes" : "no", s.penalties || 0].map(q).join(","));
    });
    return lines.join("\n") + "\n";
  }

  function ghin(r) {
    var s = stats(r);
    var cells = r.holes.map(function (n) {
      var v = (r.scores[n] || {}).strokes;
      return '<span><small>' + n + "</small><b>" + (v == null ? "–" : v) + "</b></span>";
    }).join("");
    return '<p class="sc-muted small">GHIN takes rounds typed in by hand. Pick "Hole-by-Hole" there and copy these in. GHIN applies its own per-hole maximum (net double bogey).</p>' +
      '<div class="sc-ghin-grid">' + cells + "</div><p class=\"sc-muted small\">Total " + s.strokes + " · " + esc(r.course.name) + " · " + esc(teeOf(r.course, r.tee).name) + " tees · " + esc(fmtDate(r.date)) + "</p>" +
      '<button type="button" class="sc-ghost" data-act="ghincopy">Copy as text</button>';
  }

  // ---------- one click handler for every screen ----------

  app.addEventListener("click", function (e) {
    var b = e.target.closest("button, [data-course], [data-past]");
    if (!b) return;
    var d = b.dataset;
    if (d.thenNine) {
      b.classList.add("busy");
      var front = copy(draft);
      loadCourse(d.thenNine).then(function (back) {
        if (back.holes !== 9) throw new Error("That one isn't a nine.");
        var joined = joinNines(front, back);
        if (clubNines.length > 2) joined.clubNines = clubNines.slice(0, 6); // to tell the nines apart on the club's card
        setup(joined);
      }).catch(function (err) { b.classList.remove("busy"); alert(err.message || "Couldn't load that nine."); });
      return;
    }
    if (d.course) {
      b.classList.add("busy");
      var cid = d.course;
      loadCourse(cid).then(setup).catch(function (err) {
        b.classList.remove("busy");
        if (err.status !== 0 && !/^No signal/.test(err.message || "")) { // gone for good: off the recent list
          prefs.recent = prefs.recent.filter(function (r) { return r.id !== cid; });
          savePrefs();
          var li = b.closest("li");
          if (li && b.closest(".sc-mine")) li.remove();
        }
        alert(err.message || "Couldn't load that course.");
      });
      return;
    }
    if (d.past) { var r = pastById(d.past); if (r) summary(r); return; }
    if (d.remote) { // a round from another device: bring it here
      b.classList.add("busy");
      api("/scorecard/rounds/" + encodeURIComponent(d.remote) + "?visitorId=" + encodeURIComponent(VID)).then(function (full) {
        if (!full.course) throw new Error("That round can't be opened here.");
        if (full.finishedAt) {
          save(K.rounds, [full].concat(load(K.rounds, []).filter(function (x) { return x.id !== full.id; })).slice(0, KEEP));
          summary(full);
        } else if (round && !round.finishedAt) {
          throw new Error("Finish or quit the round you're playing here first.");
        } else { // still being played: carry on here
          round = full;
          undo = [];
          save(K.round, round);
          holeScreen();
        }
      }).catch(function (err) { b.classList.remove("busy"); alert(err.status === 0 ? "No signal right now." : err.message); });
      return;
    }
    if (d.cand != null && cc.choices) { var pick = cc.choices[+d.cand]; readWebCard(pick, cc.id); return; }
    if (d.base) { cmp.baseId = d.base; cmp.picks = {}; drawCompare(); return; }
    if (d.pick) { cmp.picks[d.pick] = d.v; drawCompare(); return; }
    if (d.type) {
      var typed = prompt("What does the card in your hand say?", cmp.picks[d.type] != null ? cmp.picks[d.type] : "");
      if (typed != null && /^\d+(\.\d)?$/.test(typed.trim())) { cmp.picks[d.type] = typed.trim(); drawCompare(); }
      return;
    }
    if (d.tee) { setupTee = d.tee; app.querySelectorAll(".sc-tee").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.tee === setupTee)); }); checkTable(); return; }
    if (d.nine) { setupNine = d.nine; app.querySelectorAll("[data-nine]").forEach(function (x) { x.setAttribute("aria-checked", String(x.dataset.nine === setupNine)); }); return; }
    if (d.par != null && draft) { var i = +d.par; draft.par[i] = draft.par[i] >= 6 ? 3 : draft.par[i] + 1; checkTable(); return; }
    if (d.go) { go(+d.go); return; }
    if (d.strokes) { var v = +d.strokes; change(function (s) { s.strokes = v; }); return; }
    if (d.putts != null) {
      var p = +d.putts;
      change(function (s) { s.putts = p === 4 && s.putts >= 4 ? Math.min(s.putts + 1, 9) : s.putts === p ? null : p; });
      return;
    }
    if (d.fw) { var f = d.fw; change(function (s) { s.fairway = s.fairway === f ? null : f; }); return; }
    var act = d.act;
    if (!act) return;
    if (act === "home") return home();
    if (act === "resume") return holeScreen();
    if (act === "newcourse") { var qv = app.querySelector("#sc-q"); return newCourse(qv ? qv.value.trim() : ""); }
    if (act === "lookup") return lookupCard();
    if (act === "cardprev") return NMCardViewer.open(exampleRound());
    if (act === "wipecard") return wipeCard();
    if (act === "uncard") return removeCard(b);
    if (act === "nines") return pickNine(b);
    if (act === "readsnap") return readSnap();
    if (act === "compare") return compareScreen(cc.inRound ? "round" : "setup");
    if (act === "cmpback") {
      if (cc.inRound && round) return holeScreen();
      return setup(draft, true);
    }
    if (act === "cmpuse") {
      var result = compared();
      if (cmp.done === "round" && round) { // this round's numbers change now; the course file too, where allowed
        var keepTee = result.tees.some(function (t) { return t.key === round.tee; }) ? round.tee
          : (matchTee(teeOf(round.course, round.tee), result) || result.tees[0]).key;
        round.course = result;
        round.tee = keepTee;
        round.courseAcked = false;
        saveRound();
        if (OWNER || !result.checked) queueApproval(result);
        save(K.course + result.id, copy(result));
        return holeScreen();
      }
      return setup(result, true);
    }
    if (act === "code") {
      api("/scorecard/me/code", { method: "POST", body: { visitorId: VID } }).then(function (d2) {
        app.querySelector(".sc-code").textContent = d2.code;
      }).catch(function (err) { app.querySelector(".sc-move .sc-error").textContent = err.status === 0 ? "No signal right now." : err.message; });
      return;
    }
    if (act === "claim") {
      var codeIn = app.querySelector("#sc-claim"), errEl = app.querySelector(".sc-move .sc-error");
      api("/scorecard/me/claim", { method: "POST", body: { visitorId: VID, code: codeIn.value } }).then(function () {
        errEl.textContent = "";
        home();
      }).catch(function (err) { errEl.textContent = err.status === 0 ? "No signal right now." : err.message; });
      return;
    }
    if (act === "sun") { prefs.sun = !prefs.sun; savePrefs(); document.body.classList.toggle("sun", prefs.sun); return; }
    if (act === "start") return startRound();
    if (act === "menu") return menu();
    if (act === "minus" || act === "plus") {
      var delta = act === "plus" ? 1 : -1;
      change(function (s) { var base = s.strokes == null ? parOf(round.current) : s.strokes; s.strokes = Math.max(1, Math.min(15, base + delta)); });
      return;
    }
    if (act === "gir") {
      change(function (s) {
        if (s.gir === true || s.gir === false) { s.gir = null; return; } // back to working it out
        var auto = s.strokes != null && s.putts != null ? s.strokes - s.putts <= parOf(round.current) - 2 : false;
        s.gir = !auto;
      });
      return;
    }
    if (act === "setpar") { if (!S(round.current).strokes) change(function (s) { s.strokes = parOf(round.current); }); return; }
    if (act === "pen") { change(function (s) { s.penalties = (s.penalties || 0) + 1; }); return; }
    if (act === "penclear") { change(function (s) { s.penalties = 0; }); return; }
    if (act === "undo") {
      var u = undo.pop();
      if (!u) return;
      if (u.before) { u.before.at = Date.now(); round.scores[u.n] = u.before; } else delete round.scores[u.n];
      round.current = u.n;
      saveRound();
      buzz();
      holeScreen();
      return;
    }
    if (act === "prev") return step(-1);
    if (act === "next") return step(1);
    if (act === "finish") return finish();
    // the finish screen
    var past = pastById(app.dataset.round);
    if (!past) return;
    if (act === "viewcard") { viewer(past); return; }
    if (act === "image") { cardBlob(past).then(function (blob) { download(blob, fileName(past, "png"), b); }); return; }
    if (act === "share") {
      cardBlob(past).then(function (blob) {
        var file = new File([blob], fileName(past, "png"), { type: "image/png" });
        var data = { title: past.course.name + " · " + stats(past).strokes, files: [file] };
        if (navigator.canShare && navigator.canShare(data)) return navigator.share(data);
        download(blob, file.name, b);
      }).catch(function () {});
      return;
    }
    if (act === "csv") return download(new Blob([csv(past)], { type: "text/csv" }), fileName(past, "csv"), b);
    if (act === "json") return download(new Blob([JSON.stringify({ format: "nickmade-scorecard", version: 1, round: past }, null, 1)], { type: "application/json" }), fileName(past, "json"), b);
    if (act === "ghin") { var g = app.querySelector(".sc-ghin"); g.hidden = !g.hidden; if (!g.hidden) g.innerHTML = ghin(past); return; }
    if (act === "ghincopy") {
      var txt = past.holes.map(function (n) { return n + ": " + ((past.scores[n] || {}).strokes || "-"); }).join("\n") + "\nTotal: " + stats(past).strokes;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { b.textContent = "Copied"; });
      return;
    }
    if (act === "redate") { var rd = app.querySelector(".sc-redate"); rd.hidden = !rd.hidden; if (!rd.hidden) rd.querySelector("input").focus(); return; }
    if (act === "edit") {
      if (round && !round.finishedAt) { alert("Finish or quit the round you're playing first."); return; }
      round = copy(past);
      round.finishedAt = null;
      save(K.rounds, load(K.rounds, []).filter(function (x) { return x.id !== past.id; }));
      undo = [];
      saveRound();
      holeScreen();
      return;
    }
    if (act === "delete" && confirm("Delete this round for good? It goes from every device.")) {
      save(K.rounds, load(K.rounds, []).filter(function (x) { return x.id !== past.id; }));
      save(K.del, load(K.del, []).filter(function (x) { return x !== past.id; }).concat([past.id]));
      queueSync(0);
      home();
    }
  });

  // a pasted link to a course's card (or the page it's on)
  app.addEventListener("submit", function (e) {
    if (!e.target.classList.contains("sc-cc-link")) return;
    e.preventDefault();
    var v = e.target.querySelector("#sc-cc-url").value.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    cc.link = v;
    lookupCard(v);
  });

  // the check table's number boxes
  app.addEventListener("change", function (e) {
    var el = e.target, d = el.dataset;
    if (el.id === "sc-upload") { if (el.files && el.files[0]) snap(el.files[0], true); return; }
    if (el.id === "sc-played") { if (el.files && el.files[0]) playedCard(el.files[0]); return; }
    if (el.id === "sc-date") {
      setupDay = /^\d{4}-\d{2}-\d{2}$/.test(el.value) && el.value <= today() ? el.value : today();
      el.value = setupDay;
      var note = app.querySelector(".sc-date-note");
      if (note) note.hidden = setupDay === today();
      return;
    }
    if (el.id === "sc-redate") { // a saved round's date: here, on the server, and on the Golf page
      if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value) || el.value > today()) return;
      var all = load(K.rounds, []), rr = all.filter(function (x) { return x.id === app.dataset.round; })[0];
      if (!rr) return;
      rr.day = el.value;
      rr.date = dayToIso(el.value);
      rr.updatedAt = Date.now();
      save(K.rounds, all.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }));
      queueSync(0);
      toast("Date changed to " + fmtDate(rr.date));
      summary(rr);
      return;
    }
    if (el.id === "sc-site") { // Show on my Golf page
      var past = load(K.rounds, []), r = past.filter(function (x) { return x.id === app.dataset.round; })[0];
      if (!r) return;
      r.onSite = el.checked;
      r.updatedAt = Date.now();
      save(K.rounds, past);
      queueSync(0);
      var line = app.querySelector(".sc-hcp");
      if (line) { line.textContent = ""; setTimeout(function () { roundHcp(r, 0); }, 1500); }
      return;
    }
    if (!draft || (d.yds == null && d.hcp == null)) return;
    var v = el.value === "" ? null : Math.max(0, Math.round(+el.value));
    var tee = teeOf(draft, setupTee);
    if (d.yds != null) tee.yards[+d.yds] = v;
    else {
      var set = tee.women && draft.hcpWomen ? draft.hcpWomen : draft.hcp;
      set[+d.hcp] = v;
    }
    checkTable();
  });

  document.addEventListener("keydown", function (e) {
    if (!app.querySelector(".sc-play") || e.target.closest("input, textarea, dialog")) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });

  // long-press "+1 penalty" clears it too
  var press = null;
  app.addEventListener("pointerdown", function (e) {
    if (!e.target.closest('[data-act="pen"]')) return;
    press = setTimeout(function () { press = "fired"; change(function (s) { s.penalties = 0; }); }, 600);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
    app.addEventListener(ev, function () { if (press && press !== "fired") clearTimeout(press); });
  });
  app.addEventListener("click", function (e) {
    if (press === "fired" && e.target.closest('[data-act="pen"]')) { e.stopImmediatePropagation(); }
    press = null;
  }, true);

  // ---------- a played round from a filled-in card (Nick's scanned Holiday Hills card, 2026-10-12) ----------
  // The card is cut into its two nines (cardgrid.js) and each read once (part "played": every row, which are
  // handwritten, each box). A review screen picks whose row is the round, the date and tee, and lets any score be fixed;
  // saving makes a finished round. The card picture is made from the same scan with the handwritten rows wiped (only
  // when the reader's rows line up with the grid's, so a printed row is never wiped by mistake).
  var pc = null; // { id, rows: [front rows, back rows], grid, img (big), players: [{ name, scores[18] }], fir[18], gir[18] }
  function playedCard(file) {
    var id = draft.id;
    if (draft.nines || draft.holes !== 18) { ccPaint("Adding a played round from a card works on an 18-hole course for now."); return; }
    ccPaint("Getting the card ready…");
    NMCardRead.fromFile(file).then(readPlayed).then(function (got) {
      if (cc.id !== id) return;
      pc = playedFrom(got);
      if (!pc.players.length) throw new Error("No handwritten scores found on that card.");
      ccPaint("");
      playedScreen();
    }).catch(function (err) { ccPaint(err.status === 0 ? "No signal to read the card." : err.message); });
  }
  // Wipe the handwriting off the card just read (Upload): the same reading as a played round (2 reads, kept on the
  // phone, so adding the round afterwards costs nothing), then the card picture made again from the wiped scan
  function wipeCard() {
    var id = draft.id;
    if (!cc.image) return;
    ccPaint("Finding the handwriting…");
    readPlayed(cc.image).then(function (got) {
      if (cc.id !== id) return;
      var p2 = playedFrom(got);
      if (!p2.wipe.length) { ccPaint(got.rows[0].some(function (r) { return r && r.hand; }) ? "The card's rows didn't line up with what was read, so it was left as is." : "No handwriting found on the card."); return; }
      var g2 = copy(got.grid), blank = (g2.blank[0] || []).concat(p2.wipe).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
      g2.blank = g2.nines.map(function () { return blank; });
      cc.pictured = false;
      ccPaint("Wiped " + p2.wipe.length + " handwritten row" + (p2.wipe.length === 1 ? "" : "s") + ". Making the card picture again…");
      cardPicture(wipeRows(got.im, got.grid, p2.wipe), null, null, g2);
    }).catch(function (err) { ccPaint(err.status === 0 ? "No signal to read the card." : err.message); });
  }
  // a filled-in card read row by row: { im (big), grid, rows: [front rows, back rows] }
  function readPlayed(small) {
    return Promise.resolve(small).then(function (small) {
      var big = NMCardRead.bigOf(small);
      return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = big; }).then(function (im) {
        var grid = NMCardGrid.find(im);
        if (!grid || grid.nines.length !== 2) throw new Error("Couldn't find the card's two nines. Try a straighter, flatter scan.");
        return NMCardRead.ninePieces(small).then(function (pieces) {
          if (!pieces || pieces.length !== 2) throw new Error("Couldn't find the card's two nines. Try a straighter, flatter scan.");
          ccPaint("Reading the scores on the card…");
          var ask = function (image) {
            var key = "nm-scorecard-ask:played:" + fnv(image), kept = load(key, null);
            if (kept) return Promise.resolve(kept);
            return api("/scorecard/read", { method: "POST", body: { visitorId: VID, image: image, part: "played", holes: 9 } })
              .then(function (r) { save(key, { read: r.read }); return { read: r.read }; });
          };
          return Promise.all(pieces.map(ask)).then(function (rs) {
            return { im: im, grid: grid, rows: rs.map(function (r) { return (r.read && r.read.rows) || []; }) };
          });
        });
      });
    });
  }
  // The handwritten rows' places in the grid. The reader can skip or add a row (an empty one, most often), so its rows
  // are lined up with the grid's like a diff: an empty row against a blank grid row, a filled one against a row with
  // ink. A handwritten row is wiped only where it lands on a grid row with ink, and nothing is wiped unless most rows
  // line up. -> [grid row indexes]
  function alignWipe(rows, g) {
    var A = rows.map(function (r) { return !!r && (!!String(r.label || "").trim() || (r.cells || []).some(function (v) { return v != null; })); });
    var blank = g.blank[0] || [], G = g.rows.map(function (r, i) { return blank.indexOf(i) < 0; }); // true: has ink
    var n = A.length, m = G.length, S = [], B = [];
    for (var i = 0; i <= n; i++) { S.push([]); B.push([]); for (var j = 0; j <= m; j++) { S[i][j] = 0; B[i][j] = 0; } }
    for (var i2 = 1; i2 <= n; i2++) { S[i2][0] = -i2; B[i2][0] = 1; }
    for (var j2 = 1; j2 <= m; j2++) { S[0][j2] = -j2; B[0][j2] = 2; }
    for (var a = 1; a <= n; a++) for (var b = 1; b <= m; b++) {
      var diag = S[a - 1][b - 1] + (A[a - 1] === G[b - 1] ? 2 : -1), up = S[a - 1][b] - 1, left = S[a][b - 1] - 1;
      if (diag >= up && diag >= left) { S[a][b] = diag; B[a][b] = 0; } else if (up >= left) { S[a][b] = up; B[a][b] = 1; } else { S[a][b] = left; B[a][b] = 2; }
    }
    var pairs = [], ia = n, jb = m, agree = 0;
    while (ia > 0 && jb > 0) {
      if (B[ia][jb] === 0) { pairs.push([ia - 1, jb - 1]); if (A[ia - 1] === G[jb - 1]) agree++; ia--; jb--; }
      else if (B[ia][jb] === 1) ia--; else jb--;
    }
    if (agree < Math.min(n, m) * 0.8) return [];
    return pairs.filter(function (p) { return rows[p[0]] && rows[p[0]].hand && G[p[1]]; }).map(function (p) { return p[1]; }).sort(function (x, y) { return x - y; });
  }
  function playedFrom(got) {
    var front = got.rows[0], back = got.rows[1], low = function (v) { return String(v || "").toLowerCase().trim(); };
    var num = function (v) { var n = typeof v === "number" ? v : parseInt(v, 10); return n >= 1 && n <= 15 ? n : null; };
    var nine = function (cells) { var a = []; for (var i = 0; i < 9; i++) a.push(cells && cells[i] != null ? cells[i] : null); return a; };
    var scoreRows = function (rows) { return rows.filter(function (r) { return r && r.hand && nine(r.cells).filter(num).length >= 5; }); };
    var fr = scoreRows(front), br = scoreRows(back);
    var players = fr.map(function (r, i) {
      var other = br.filter(function (b) { return low(b.label) && low(b.label) === low(r.label); })[0] || br[i] || {};
      return { name: r.label || "Player " + (i + 1), scores: nine(r.cells).map(num).concat(nine(other.cells).map(num)) };
    });
    var checks = function (re) {
      var f = front.filter(function (r) { return r && re.test(r.label || ""); })[0], b = back.filter(function (r) { return r && re.test(r.label || ""); })[0];
      if (!f && !b) return null;
      return nine(f && f.cells).concat(nine(b && b.cells)).map(function (v) { return v === "check" || v === "✓" || v === true; });
    };
    var wipe = alignWipe(front, got.grid);
    return { id: draft.id, im: got.im, grid: got.grid, players: players, fir: checks(/f\s*i\s*r|fairway/i), gir: checks(/g\s*i\s*r|green/i), wipe: wipe,
      pick: Math.max(0, players.findIndex(function (p) { return low(p.name).indexOf(low(prefs.name || "nick").slice(0, 3)) === 0; })),
      day: today(), tee: setupTee || defaultTee(draft) };
  }
  function playedScreen() {
    if (!at(2, playedScreen)) return;
    var P = pc.players[pc.pick], n = draft.holes;
    var total = P.scores.reduce(function (a, v) { return a + (v || 0); }, 0);
    var cell = function (h) {
      var par = draft.par[h - 1], i = h - 1;
      return '<div class="sc-pl-hole"><b>' + h + "</b><small>par " + par + "</small>" +
        '<input class="sc-in" type="number" inputmode="numeric" min="1" max="15" data-pl-score="' + i + '" value="' + (P.scores[i] || "") + '">' +
        (pc.fir && par !== 3 ? '<label><input type="checkbox" data-pl-fir="' + i + '"' + (pc.fir[i] ? " checked" : "") + "> FIR</label>" : "") +
        (pc.gir ? '<label><input type="checkbox" data-pl-gir="' + i + '"' + (pc.gir[i] ? " checked" : "") + "> GIR</label>" : "") + "</div>";
    };
    var holes = []; for (var h = 1; h <= n; h++) holes.push(cell(h));
    app.innerHTML = bar('<button class="sc-icon sc-back" type="button" data-act="cmpback" aria-label="Back">&larr;</button>', "Played card", sunBtn) +
      '<section class="sc-pad sc-played">' +
        '<p class="sc-muted small">Check the scores against the card, then save the round.</p>' +
        (OWNER ? '<label class="sc-approve"><input type="checkbox" id="sc-pl-wipe"' + (pc.wipe.length && pc.doWipe !== false ? " checked" : "") + (pc.wipe.length ? "" : " disabled") + "><span>" +
          (pc.wipe.length ? "Wipe the handwriting off the card picture (" + pc.wipe.length + " row" + (pc.wipe.length === 1 ? "" : "s") + "), so this course's rounds are written on a clean card"
            : "Can't wipe the handwriting: the rows read didn't line up with the card's") + "</span></label>" : "") +
        '<h3 class="sc-sub">Whose round</h3><div class="sc-seg sc-seg-wrap" role="radiogroup">' + pc.players.map(function (p, i) {
          var t = p.scores.reduce(function (a, v) { return a + (v || 0); }, 0);
          return '<button type="button" role="radio" data-pl-who="' + i + '" aria-checked="' + (i === pc.pick) + '">' + esc(p.name) + (t ? " · " + t : "") + "</button>";
        }).join("") + "</div>" +
        '<h3 class="sc-sub">Date played</h3><input type="date" id="sc-pl-day" class="sc-in sc-date" max="' + today() + '" value="' + esc(pc.day) + '">' +
        '<h3 class="sc-sub">Tee</h3><select id="sc-pl-tee" class="sc-in">' + draft.tees.map(function (t) {
          return '<option value="' + esc(t.key) + '"' + (t.key === pc.tee ? " selected" : "") + ">" + esc(t.name) + "</option>";
        }).join("") + "</select>" +
        '<h3 class="sc-sub">Scores <span class="sc-muted">' + total + "</span></h3>" +
        '<div class="sc-pl-grid">' + holes.join("") + "</div>" +
        '<button class="sc-go" type="button" data-act="plsave">Save round</button>' +
      "</section>";
  }
  function savePlayed(btn) {
    var P = pc.players[pc.pick], now = Date.now(), n = draft.holes, scores = {};
    var missing = [];
    for (var h = 1; h <= n; h++) {
      var v = P.scores[h - 1];
      if (!v) { missing.push(h); continue; }
      var par = draft.par[h - 1], s = { strokes: v, at: now };
      if (pc.fir && par !== 3) s.fairway = pc.fir[h - 1] ? "hit" : "miss";
      if (pc.gir) s.gir = !!pc.gir[h - 1];
      scores[h] = s;
    }
    if (missing.length && !confirm((missing.length === 1 ? "Hole " + missing[0] + " has" : "Holes " + missing.join(", ") + " have") + " no score. Save anyway?")) return;
    btn.disabled = true;
    var holes = []; for (var k = 1; k <= n; k++) holes.push(k);
    var r = { id: uuid(), v: 1, course: copy(draft), tee: pc.tee, holes: holes, scores: scores, current: 1, player: OWNER ? prefs.name || P.name : P.name,
      date: dayToIso(pc.day), day: pc.day, startedAt: now, updatedAt: now, finishedAt: now, onSite: OWNER };
    var past = load(K.rounds, []);
    past.unshift(r);
    save(K.rounds, past.slice(0, KEEP));
    prefs.recent = [{ id: draft.id, name: draft.name, place: draft.place }].concat(prefs.recent.filter(function (x) { return x.id !== draft.id; })).slice(0, 8);
    savePrefs();
    queueSync(0);
    // the card picture: the scan with its handwritten rows wiped
    if (OWNER && pc.wipe.length && pc.doWipe !== false) {
      // the wiped rows are blank now, whatever specks the wipe missed: the grid found on the scan, with them as blank
      var g2 = copy(pc.grid), blank = (g2.blank[0] || []).concat(pc.wipe).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
      g2.blank = g2.nines.map(function () { return blank; });
      cardPicture(wipeRows(pc.im, pc.grid, pc.wipe), null, null, g2);
    }
    pc = null;
    summary(r);
  }
  // the scan with the given rows' boxes painted over in each box's own paper color (the lines stay)
  function wipeRows(im, g, rows) {
    var W = im.naturalWidth, H = im.naturalHeight, c = document.createElement("canvas");
    c.width = W; c.height = H;
    var x = c.getContext("2d");
    x.drawImage(im, 0, 0);
    var cols = [];
    g.nines.forEach(function (n) { [n.label].concat(n.holes, [n.total, n.after]).forEach(function (cc) { if (cc) cols.push(cc); }); });
    rows.forEach(function (ri) {
      var row = g.rows[ri];
      if (!row) return;
      cols.forEach(function (cc) {
        var x0 = Math.round(cc[0] * W) + 2, x1 = Math.round(cc[1] * W) - 2, y0 = Math.round(row[0] * H) + 2, y1 = Math.round(row[1] * H) - 2;
        if (x1 <= x0 || y1 <= y0) return;
        var d = x.getImageData(x0, y0, x1 - x0, y1 - y0).data, light = [[], [], []];
        for (var i = 0; i < d.length; i += 16) { if (d[i] + d[i + 1] + d[i + 2] > 600) { light[0].push(d[i]); light[1].push(d[i + 1]); light[2].push(d[i + 2]); } }
        var med = function (a) { a.sort(function (p, q) { return p - q; }); return a.length ? a[a.length >> 1] : 250; };
        x.fillStyle = "rgb(" + med(light[0]) + "," + med(light[1]) + "," + med(light[2]) + ")";
        x.fillRect(x0, y0, x1 - x0, y1 - y0);
      });
    });
    return c.toDataURL("image/jpeg", 0.92);
  }
  // the review screen's controls
  app.addEventListener("click", function (e) {
    if (!pc || !app.querySelector(".sc-played")) return;
    var b = e.target.closest("[data-pl-who], [data-act]");
    if (!b) return;
    if (b.dataset.plWho != null) { pc.pick = +b.dataset.plWho; playedScreen(); }
    else if (b.dataset.act === "plsave") savePlayed(b);
    else return;
    e.stopImmediatePropagation();
  }, true);
  app.addEventListener("change", function (e) {
    if (!pc) return;
    var el = e.target, d = el.dataset;
    if (d.plScore != null) { var v = parseInt(el.value, 10); pc.players[pc.pick].scores[+d.plScore] = v >= 1 && v <= 15 ? v : null; }
    else if (d.plFir != null) pc.fir[+d.plFir] = el.checked;
    else if (d.plGir != null) pc.gir[+d.plGir] = el.checked;
    else if (el.id === "sc-pl-day") pc.day = /^\d{4}-\d{2}-\d{2}$/.test(el.value) && el.value <= today() ? el.value : today();
    else if (el.id === "sc-pl-tee") pc.tee = el.value;
    else if (el.id === "sc-pl-wipe") pc.doWipe = el.checked;
  });

  boot();
})();
