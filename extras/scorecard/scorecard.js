// Scorecard (Extras > Scorecard, phase 1 of SCORECARD-PLAN.md): Nick's score tracker for real golf courses.
// One screen per hole: score (one tap for par), putts, fairway (left / hit / right), green in regulation (worked out
// from score and putts, tap to override) and penalties. Swipe for the next hole. Every tap is saved in this browser
// straight away (localStorage), so a reload, a dead signal or a phone restart loses nothing; sw.js keeps the page
// itself working offline. At the end: a summary, the round written onto the course's own scorecard (card.js), saved
// as an image or shared, and CSV / JSON / GHIN-ready exports.
//
// OWNER ONLY until the Worker's SCORECARD_PUBLIC is "1": GET /scorecard/status decides (offline, the last answer).
// Courses: Nick's hand-made files (courses/*.json, copied from each course's own card), or any course from
// OpenGolfAPI through the Worker (/scorecard/courses/...), checked against the real card before the round starts.
//
// localStorage: nm-scorecard-round   the round being played
//               nm-scorecard-rounds  finished rounds, newest first (the last 50)
//               nm-scorecard-prefs   { sun, wake, name, tees: { courseId: teeKey }, recent: [{ id, name, place }] }
//               nm-scorecard-course:<id>  an OpenGolfAPI course as Nick last checked it (reused next time)
//               nm-scorecard-ok      whether this browser may see the page (for opening it offline)
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var app = document.getElementById("app");
  var K = { round: "nm-scorecard-round", rounds: "nm-scorecard-rounds", prefs: "nm-scorecard-prefs", course: "nm-scorecard-course:", ok: "nm-scorecard-ok" };
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
  function api(path) {
    return fetch(API + path, { headers: auth() }).then(function (r) {
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Something went wrong."); return d; });
    });
  }

  var prefs = load(K.prefs, {});
  prefs.tees = prefs.tees || {};
  prefs.recent = prefs.recent || [];
  function savePrefs() { save(K.prefs, prefs); }
  document.body.classList.toggle("sun", !!prefs.sun);

  var round = load(K.round, null); // the round being played, if any
  var undo = [];                    // this session's changes, newest last: { n, before }
  var wake = null;                  // the screen wake lock while a hole is showing

  // ---------- the gate: owner only until the Worker says it's public ----------

  function gate() {
    return fetch(API + "/scorecard/status", { headers: auth() })
      .then(function (r) { return r.json(); })
      .then(function (d) { var ok = !!(d.public || d.owner); save(K.ok, ok); return ok; })
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

  function boot() {
    gate().then(function (ok) {
      if (!ok) return params.has("admin") ? login() : closed();
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
      if (!prefs.name && ADMIN) { prefs.name = "Nick"; savePrefs(); }
      if (round && !round.finishedAt) holeScreen(); else home();
    });
  }

  // ---------- courses ----------

  var mine = null; // Nick's hand-made course files: [{ id, name, place }]
  function myCourses() {
    if (mine) return Promise.resolve(mine);
    return fetch("courses/index.json").then(function (r) { return r.json(); })
      .then(function (d) { mine = d.courses || []; return mine; }).catch(function () { return []; });
  }
  function loadCourse(id) {
    if (id.indexOf("api:") === 0) {
      var kept = load(K.course + id, null); // checked by Nick before: reuse it as is
      if (kept) return Promise.resolve(kept);
      return api("/scorecard/courses/api/" + encodeURIComponent(id.slice(4)));
    }
    return fetch("courses/" + encodeURIComponent(id) + ".json").then(function (r) {
      if (!r.ok) throw new Error("Couldn't load that course.");
      return r.json();
    });
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
    releaseWake();
    var past = load(K.rounds, []);
    app.innerHTML = bar('<a class="sc-icon sc-back" href="/extras/" aria-label="Back to Extras">&larr;</a>', "Scorecard", sunBtn) +
      '<section class="sc-pad">' +
        '<h2 class="sc-h">New round</h2>' +
        '<div class="sc-search"><input id="sc-q" type="search" autocomplete="off" placeholder="Search for a course" aria-label="Search for a course"></div>' +
        '<ul class="sc-list sc-results" hidden></ul>' +
        '<h3 class="sc-sub">Your courses</h3><ul class="sc-list sc-mine"><li class="sc-muted">Loading…</li></ul>' +
        (past.length ? '<h3 class="sc-sub">Past rounds</h3><ul class="sc-list sc-past">' + past.map(pastRow).join("") + "</ul>" : "") +
      "</section>";
    myCourses().then(function (list) {
      var rec = prefs.recent.filter(function (r) { return !list.some(function (m) { return m.id === r.id; }); });
      var all = list.map(function (c) { return courseRow(c, true); }).concat(rec.map(function (c) { return courseRow(c, false); }));
      app.querySelector(".sc-mine").innerHTML = all.join("") || '<li class="sc-muted">Search for a course to start.</li>';
    });
    var q = app.querySelector("#sc-q"), out = app.querySelector(".sc-results"), timer = null, seq = 0;
    q.addEventListener("input", function () {
      clearTimeout(timer);
      var term = q.value.trim();
      if (term.length < 3) { out.hidden = true; out.innerHTML = ""; return; }
      timer = setTimeout(function () { search(term, ++seq); }, 350);
    });
    function search(term, my) {
      out.hidden = false;
      out.innerHTML = '<li class="sc-muted">Searching…</li>';
      var lower = term.toLowerCase();
      Promise.all([myCourses(), api("/scorecard/courses/search?q=" + encodeURIComponent(term)).catch(function (e) { return { error: e.message, courses: [] }; })])
        .then(function (res) {
          if (my !== seq) return;
          var own = res[0], found = res[1];
          var rows = own.filter(function (c) { return (c.name + " " + c.place).toLowerCase().indexOf(lower) >= 0; }).map(function (c) { return courseRow(c, true); });
          (found.courses || []).forEach(function (c) {
            var file = own.filter(function (m) { return m.apiId === c.apiId; })[0];
            if (file) return; // Nick's own file for it is already listed
            var near = own.filter(function (m) { return m.nearApiId === c.apiId; })[0];
            rows.push(courseRow({ id: "api:" + c.apiId, name: c.name, place: c.place + (c.par ? " · par " + c.par : ""),
              note: near ? "A different course from " + near.name : "" }, false));
          });
          out.innerHTML = rows.join("") || '<li class="sc-muted">' + esc(found.error || "No courses found.") + "</li>";
        });
    }
  }

  function courseRow(c, checked) {
    return '<li><button class="sc-row-btn" type="button" data-course="' + esc(c.id) + '"><span class="sc-row-main"><b>' + esc(c.name) + "</b>" +
      '<span class="sc-row-sub">' + esc(c.place || "") + (c.note ? " · " + esc(c.note) : "") + "</span></span>" +
      (checked ? '<span class="sc-badge" title="Copied from the course\'s own card">✓ Card</span>' : "") + "</button></li>";
  }

  function pastRow(r) {
    var s = stats(r);
    return '<li><button class="sc-row-btn" type="button" data-past="' + esc(r.id) + '"><span class="sc-row-main"><b>' + esc(r.course.name) + "</b>" +
      '<span class="sc-row-sub">' + esc(fmtDate(r.date)) + " · " + esc(teeOf(r.course, r.tee).name) + (r.holes.length === 9 ? " · 9 holes" : "") + "</span></span>" +
      '<span class="sc-row-score"><b>' + (s.done ? s.strokes : "–") + "</b><span>" + (s.done ? toPar(s.toPar) : "") + "</span></span></button></li>";
  }

  // ---------- setup: tee, holes, and a look at the numbers before teeing off ----------

  var draft = null, setupTee = null, setupNine = "18";

  function setup(course) {
    draft = copy(course);
    setupTee = defaultTee(draft);
    setupNine = "18";
    var src = draft.source || {};
    var trust = src.kind === "website"
      ? '<p class="sc-trust ok">✓ Copied from ' + esc(src.name || "the course's card") + (src.dated ? " (" + esc(monthYear(src.dated)) + ")" : "") + ". Still check it against the card in the clubhouse.</p>"
      : src.kind === "checked"
      ? '<p class="sc-trust ok">✓ Checked by you on ' + esc(fmtDate(src.at)) + ".</p>"
      : '<p class="sc-trust warn">From OpenGolfAPI, which is often off. Check the numbers below against the real card before you start.</p>';
    app.innerHTML = bar('<button class="sc-icon sc-back" type="button" data-act="home" aria-label="Back">&larr;</button>', esc(draft.name), sunBtn) +
      '<section class="sc-pad">' +
        '<p class="sc-place">' + esc(draft.place || "") + "</p>" + trust +
        '<h3 class="sc-sub">Tee</h3><div class="sc-tees">' + draft.tees.map(teeBtn).join("") + "</div>" +
        (draft.holes > 9 ? '<h3 class="sc-sub">Holes</h3><div class="sc-seg" role="radiogroup">' +
          [["18", "18"], ["front", "Front 9"], ["back", "Back 9"]].map(function (o) {
            return '<button type="button" role="radio" data-nine="' + o[0] + '" aria-checked="' + (o[0] === setupNine) + '">' + o[1] + "</button>";
          }).join("") + "</div>" : "") +
        '<details class="sc-check"' + (src.kind === "api" ? " open" : "") + "><summary>Check the card</summary>" +
          '<p class="sc-muted small">Tap a par to change it. Yardage is for the tee you picked.</p><div class="sc-table"></div></details>' +
        '<button class="sc-go" type="button" data-act="start">Start round</button>' +
        (draft.credit ? '<p class="sc-credit">' + esc(draft.credit) + "</p>" : "") +
      "</section>";
    checkTable();
  }

  function teeBtn(t) {
    var rs = t.rating ? t.rating + "/" + t.slope : "";
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
  }

  function startRound() {
    var tee = teeOf(draft, setupTee), n = draft.holes;
    var holes = [];
    for (var i = 1; i <= n; i++) if (setupNine === "18" || (setupNine === "front" ? i <= 9 : i > 9)) holes.push(i);
    round = { id: uuid(), v: 1, course: draft, tee: tee.key, holes: holes, scores: {}, current: holes[0],
      player: prefs.name || "", date: new Date().toISOString(), startedAt: Date.now(), updatedAt: Date.now() };
    prefs.tees[draft.id] = tee.key;
    prefs.recent = [{ id: draft.id, name: draft.name, place: draft.place }].concat(prefs.recent.filter(function (r) { return r.id !== draft.id; })).slice(0, 8);
    savePrefs();
    // an OpenGolfAPI course, as Nick checked it, is kept and used as is next time
    if (draft.id.indexOf("api:") === 0) {
      var kept = copy(draft);
      kept.source = { kind: "checked", at: new Date().toISOString(), from: "OpenGolfAPI" };
      save(K.course + draft.id, kept);
    }
    undo = [];
    saveRound();
    holeScreen();
  }

  // ---------- the round ----------

  function saveRound() { round.updatedAt = Date.now(); save(K.round, round); }
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
      if (p !== 3 && s.fairway) { o.fwN++; if (s.fairway === "hit") o.fw++; else if (s.fairway === "left") o.fwL++; else o.fwR++; }
      var g = NMCard.girOf(c, r, n);
      if (g != null) { o.girN++; if (g) o.gir++; }
      o.pen += s.penalties || 0;
      var kind = d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : "double";
      o.kinds[kind] = (o.kinds[kind] || 0) + 1;
    });
    o.toPar = o.strokes - o.par;
    return o;
  }

  function holeScreen(dir) {
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
        '<div class="sc-title"><b>' + esc(c.name) + "</b><span>" + esc(tee.name) + " tees</span></div>" +
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
    saveRound();
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
  });

  // ---------- menu ----------

  function sheet(html, onclick) {
    var d = document.createElement("dialog");
    d.className = "sc-sheet";
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    d.addEventListener("click", function (e) {
      if (e.target === d) return d.close(); // the backdrop
      var b = e.target.closest("[data-m]");
      if (b) onclick(b.dataset.m, d, b);
    });
    d.showModal();
    return d;
  }

  function menu() {
    sheet('<div class="sc-sheet-body">' +
      '<button type="button" data-m="card">Scorecard so far</button>' +
      '<button type="button" data-m="finish">Finish round</button>' +
      '<button type="button" data-m="sun">Sun mode: ' + (prefs.sun ? "on" : "off") + "</button>" +
      '<button type="button" data-m="wake">Keep screen on: ' + (prefs.wake === false ? "off" : "on") + "</button>" +
      '<button type="button" data-m="name">Name on the card: ' + esc(prefs.name || "none") + "</button>" +
      '<a href="/extras/" data-m="leave">Back to Extras (the round stays saved)</a>' +
      '<button type="button" data-m="quit" class="danger">Quit without saving</button>' +
      '<button type="button" data-m="close" class="sc-ghost">Close</button></div>', function (m, d) {
      if (m === "leave") return;
      d.close();
      if (m === "card") showCard();
      if (m === "finish") finish();
      if (m === "sun") { prefs.sun = !prefs.sun; savePrefs(); document.body.classList.toggle("sun", prefs.sun); }
      if (m === "wake") { prefs.wake = prefs.wake === false; savePrefs(); if (prefs.wake === false) releaseWake(); else keepAwake(); }
      if (m === "name") {
        var v = prompt("Name on the scorecard", prefs.name || "");
        if (v != null) { prefs.name = v.trim().slice(0, 24); savePrefs(); round.player = prefs.name; saveRound(); }
      }
      if (m === "quit" && confirm("Quit this round? Its scores will be deleted.")) { drop(K.round); round = null; home(); }
    });
  }

  function showCard() { viewer(round); }

  // The card full screen with its own pinch zoom, so the page itself never zooms (Nick, 2026-10-10: zooming the
  // card in a sheet zoomed the whole page, and the hole screen then couldn't be zoomed back out). Pinch or
  // double-tap to zoom, drag to look around, Done or Escape to close.
  function viewer(r) {
    var d = document.createElement("dialog");
    d.className = "sc-viewer";
    d.innerHTML = '<div class="sc-viewer-bar"><span>Pinch or double-tap to zoom</span><button type="button" class="sc-viewer-done">Done</button></div>' +
      '<div class="sc-viewer-stage"><canvas class="sc-card" aria-label="The scorecard"></canvas></div>';
    document.body.appendChild(d);
    var stage = d.querySelector(".sc-viewer-stage"), cv = d.querySelector("canvas");
    var s = 1, tx = 0, ty = 0, w = 0, h = 0, ox = 0, oy = 0;
    var pts = {}, start = null, lastTap = 0;
    function fit() {
      var sw = stage.clientWidth, sh = stage.clientHeight, ar = cv.width / cv.height || 1.3;
      w = Math.min(sw, sh * ar); h = w / ar;
      ox = (sw - w) / 2; oy = (sh - h) / 2;
      cv.style.width = w + "px"; cv.style.height = h + "px";
      cv.style.left = ox + "px"; cv.style.top = oy + "px";
      apply();
    }
    function clampAxis(t, size, room, o) { // keep the card on screen: centered while it fits, edges to the edges after
      var big = size * s;
      if (big <= room) return (room - big) / 2 - o;
      return Math.min(-o, Math.max(room - big - o, t));
    }
    function apply() {
      s = Math.max(1, Math.min(5, s));
      tx = clampAxis(tx, w, stage.clientWidth, ox);
      ty = clampAxis(ty, h, stage.clientHeight, oy);
      cv.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
    }
    function zoomAt(px, py, ns) { // zoom to ns keeping the point under (px, py) still
      var qx = (px - ox - tx) / s, qy = (py - oy - ty) / s;
      s = Math.max(1, Math.min(5, ns));
      tx = px - ox - qx * s; ty = py - oy - qy * s;
      apply();
    }
    function local(e) { var b = stage.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
    function pair() {
      var a = Object.keys(pts).map(function (k) { return pts[k]; });
      return { mid: [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2], dist: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || 1 };
    }
    stage.addEventListener("pointerdown", function (e) {
      stage.setPointerCapture(e.pointerId);
      pts[e.pointerId] = local(e);
      var n = Object.keys(pts).length;
      if (n === 2) { var pr = pair(); start = { s: s, tx: tx, ty: ty, mid: pr.mid, dist: pr.dist }; }
      else if (n === 1) {
        var now = Date.now(), p = pts[e.pointerId];
        if (now - lastTap < 300) { zoomAt(p[0], p[1], s > 1.2 ? 1 : 2.5); lastTap = 0; }
        else lastTap = now;
        start = { s: s, tx: tx, ty: ty, at: p };
      }
    });
    stage.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId] || !start) return;
      pts[e.pointerId] = local(e);
      var n = Object.keys(pts).length;
      if (n >= 2 && start.dist) {
        var pr = pair();
        // the content point that was under the fingers' first midpoint stays under their midpoint now
        var qx = (start.mid[0] - ox - start.tx) / start.s, qy = (start.mid[1] - oy - start.ty) / start.s;
        s = Math.max(1, Math.min(5, start.s * pr.dist / start.dist));
        tx = pr.mid[0] - ox - qx * s; ty = pr.mid[1] - oy - qy * s;
        apply();
      } else if (n === 1 && start.at) {
        var p = pts[e.pointerId];
        tx = start.tx + p[0] - start.at[0]; ty = start.ty + p[1] - start.at[1];
        apply();
      }
    });
    function lift(e) {
      delete pts[e.pointerId];
      var left = Object.keys(pts);
      // one finger still down after a pinch: carry on as a drag from where it is
      start = left.length === 1 ? { s: s, tx: tx, ty: ty, at: pts[left[0]] } : null;
    }
    stage.addEventListener("pointerup", lift);
    stage.addEventListener("pointercancel", lift);
    stage.addEventListener("wheel", function (e) { // trackpads and mice
      e.preventDefault();
      var p = local(e);
      zoomAt(p[0], p[1], s * Math.exp(-e.deltaY / 300));
    }, { passive: false });
    d.querySelector(".sc-viewer-done").addEventListener("click", function () { d.close(); });
    d.addEventListener("close", function () { window.removeEventListener("resize", fit); d.remove(); });
    window.addEventListener("resize", fit);
    d.showModal();
    NMCard.draw(cv, r.course, r, { scale: 3 }).then(fit);
  }

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
    summary(done);
  }

  function summary(r) {
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
        '<div class="sc-stats">' +
          tile("Putts", s.puttsHoles ? s.putts : "–", s.puttsHoles ? (s.putts / s.puttsHoles).toFixed(1) + " a hole" : "") +
          tile("Fairways", s.fwN ? s.fw + "/" + s.fwN : "–", s.fwN ? "missed " + s.fwL + " left, " + s.fwR + " right" : "") +
          tile("Greens", s.girN ? s.gir + "/" + s.girN : "–", s.girN ? Math.round(s.gir / s.girN * 100) + "% in regulation" : "") +
          tile("Penalties", s.pen, "") +
        "</div>" +
        '<button type="button" class="sc-cardwrap" data-act="viewcard" aria-label="Open the scorecard full screen"><canvas class="sc-card"></canvas><span>Tap to zoom</span></button>' +
        '<div class="sc-actions"><button class="sc-go" type="button" data-act="image">Save image</button>' +
          (navigator.share ? '<button class="sc-go alt" type="button" data-act="share">Share</button>' : "") + "</div>" +
        '<div class="sc-actions small"><button type="button" data-act="csv">CSV</button><button type="button" data-act="json">JSON</button><button type="button" data-act="ghin">For GHIN</button></div>' +
        '<div class="sc-ghin" hidden></div>' +
        '<div class="sc-actions small"><button type="button" data-act="edit">Edit scores</button><button type="button" data-act="delete" class="danger">Delete round</button></div>' +
        '<p class="sc-credit">' + esc(sourceLine(c)) + "</p>" +
      "</section>";
    app.dataset.round = r.id;
    NMCard.draw(app.querySelector(".sc-card"), c, r, { scale: 2 });
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
  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
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
      var s = r.scores[n] || {}, g = NMCard.girOf(r.course, r, n);
      lines.push([String(r.date).slice(0, 10), r.course.name, tee.name, n, r.course.par[n - 1], tee.yards[n - 1], hc[n - 1],
        s.strokes, s.putts, r.course.par[n - 1] === 3 ? "" : s.fairway || "", g == null ? "" : g ? "yes" : "no", s.penalties || 0].map(q).join(","));
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
    if (d.course) {
      b.classList.add("busy");
      loadCourse(d.course).then(setup).catch(function (err) { b.classList.remove("busy"); alert(err.message || "Couldn't load that course."); });
      return;
    }
    if (d.past) { var r = pastById(d.past); if (r) summary(r); return; }
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
      if (u.before) round.scores[u.n] = u.before; else delete round.scores[u.n];
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
    if (act === "image") { cardBlob(past).then(function (blob) { download(blob, fileName(past, "png")); }); return; }
    if (act === "share") {
      cardBlob(past).then(function (blob) {
        var file = new File([blob], fileName(past, "png"), { type: "image/png" });
        var data = { title: past.course.name + " · " + stats(past).strokes, files: [file] };
        if (navigator.canShare && navigator.canShare(data)) return navigator.share(data);
        download(blob, file.name);
      }).catch(function () {});
      return;
    }
    if (act === "csv") return download(new Blob([csv(past)], { type: "text/csv" }), fileName(past, "csv"));
    if (act === "json") return download(new Blob([JSON.stringify({ format: "nickmade-scorecard", version: 1, round: past }, null, 1)], { type: "application/json" }), fileName(past, "json"));
    if (act === "ghin") { var g = app.querySelector(".sc-ghin"); g.hidden = !g.hidden; if (!g.hidden) g.innerHTML = ghin(past); return; }
    if (act === "ghincopy") {
      var txt = past.holes.map(function (n) { return n + ": " + ((past.scores[n] || {}).strokes || "-"); }).join("\n") + "\nTotal: " + stats(past).strokes;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { b.textContent = "Copied"; });
      return;
    }
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
    if (act === "delete" && confirm("Delete this round for good?")) {
      save(K.rounds, load(K.rounds, []).filter(function (x) { return x.id !== past.id; }));
      home();
    }
  });

  // the check table's number boxes
  app.addEventListener("change", function (e) {
    var el = e.target, d = el.dataset;
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

  boot();
})();
