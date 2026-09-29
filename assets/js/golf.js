// Renders extras/golf/scores.js (window.GOLF) into the Golf page: a score grid per source, then What's In The Bag.
(function () {
  var root = document.getElementById("golf");
  var data = window.GOLF || {};
  // Trackman rounds come from extras/golf/trackman.js (tools/import_trackman.py), plus any typed into scores.js
  data.trackman = (window.GOLF_TRACKMAN || []).concat(data.trackman || []);

  var SOURCES = [
    { key: "trackman", title: "Trackman", sub: "Simulator" },
    { key: "xgolf", title: "X-Golf", sub: "Simulator" },
    { key: "birdies", title: "18Birdies", sub: "On the course" }
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function day(date) {
    var d = new Date(date + "T00:00:00");
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // Strokes over par: Trackman's own figure when given (net for net rounds), else score - par
  function overPar(r) {
    return r.toPar != null ? r.toPar : r.score - r.par;
  }

  // +4, E, -2 (with a real minus sign), "net" added for net rounds
  function toPar(r) {
    var n = overPar(r);
    return (n === 0 ? "E" : n > 0 ? "+" + n : "−" + -n) + (r.net ? " net" : "");
  }

  function head(title, sub) {
    return '<h2 class="subhead"><span>' + esc(title) + "</span>" +
      (sub ? '<small class="sub">' + esc(sub) + "</small>" : "") +
      "</h2>";
  }

  function hasPar(r) {
    return r.toPar != null || r.par != null;
  }

  function figure(value, label) {
    return "<div><b>" + esc(value) + "</b><span>" + esc(label) + "</span></div>";
  }

  // Rounds, best and average 18-hole scores (9-hole rounds would skew them). When the app has its own
  // stats (app = { headline, stats }), its headline figures come first (standing in for best if it has one),
  // and its stats follow in a panel.
  function summary(rounds, app) {
    var full = rounds.filter(function (r) { return (r.holes || 18) === 18; });
    var avg = full.length ? full.reduce(function (s, r) { return s + r.score; }, 0) / full.length : null;
    var figs = [figure(rounds.length, "Rounds")];
    var appBest = app && app.headline && app.headline.some(function (h) { return /^best/i.test(h[0]); });
    if (app && app.headline) app.headline.forEach(function (h) { figs.push(figure(h[1], h[0])); });
    if (!appBest && full.length) {
      var best = full.reduce(function (a, r) { return r.score < a.score ? r : a; });
      figs.push(figure(best.score, "Best 18" + (hasPar(best) ? " · " + toPar(best) : "")));
    }
    if (avg != null) figs.push(figure(avg.toFixed(1), "Avg 18"));
    return '<div class="golf-summary">' + figs.join("") + "</div>" +
      (app && app.stats && app.stats.length
        ? '<dl class="app-stats">' + app.stats.map(function (st) {
            return "<div><dt>" + esc(st[0]) + "</dt><dd>" + esc(st[1]) + "</dd></div>";
          }).join("") + "</dl>"
        : "");
  }

  function card(r) {
    var n = overPar(r);
    return '<article class="round' + (r.example ? " example" : "") + (r.image ? " has-photo" : "") + '">' +
      (r.image ? '<div class="round-photo"><img src="' + esc(r.image) + '" alt="" loading="lazy"></div>' : "") +
      '<div class="round-top"><span>' + esc(day(r.date)) + "</span>" +
        ((r.holes || 18) !== 18 ? '<span class="holes">' + esc(r.holes) + " holes</span>" : "") + "</div>" +
      '<h3 class="course">' + esc(r.course) + "</h3>" +
      '<div class="round-score"><b>' + esc(r.score) + "</b>" +
        (hasPar(r) ? '<span class="par ' + (n < 0 ? "under" : n === 0 ? "even" : "over") + '">' + esc(toPar(r)) + "</span>" : "") +
        (r.par ? '<span class="of">Par ' + esc(r.par) + "</span>" : "") + "</div>" +
      (r.stats && r.stats.length
        ? '<dl class="round-stats">' + r.stats.map(function (s) {
            return "<div><dt>" + esc(s[0]) + "</dt><dd>" + esc(s[1]) + "</dd></div>";
          }).join("") + "</dl>"
        : "") +
      (r.note ? '<p class="round-note">' + esc(r.note) + "</p>" : "") +
      (r.example ? '<span class="example-tag">Example</span>' : "") +
    "</article>";
  }

  var sections = SOURCES.map(function (s) {
    var rounds = (data[s.key] || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return '<section class="subsection" id="' + slug(s.title) + '">' + head(s.title, s.sub) +
      (rounds.length
        ? summary(rounds, data[s.key + "Stats"]) + '<div class="rounds">' + rounds.map(card).join("") + "</div>"
        : '<p class="empty">Coming soon.</p>') +
    "</section>";
  });

  var bag = data.bag || [];
  sections.push('<section class="subsection" id="whats-in-the-bag">' + head("What's In The Bag", "") +
    (bag.length
      ? '<ul class="bag">' + bag.map(function (c) {
          // photo and model name link to the product page when there is one
          var open = c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' : "";
          var close = c.url ? "</a>" : "";
          return "<li>" +
            '<span class="club-img">' + (c.image ? open + '<img src="' + esc(c.image) + '" alt="' + esc(c.model) + '" loading="lazy">' + close : "") + "</span>" +
            '<span class="club-type">' + esc(c.club) + "</span>" +
            '<span class="club-name">' + (c.url ? '<a class="club-link" href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.model) + "</a>" : esc(c.model)) +
              (c.details ? '<span class="club-details">' + esc(c.details) + "</span>" : "") + "</span>" +
            '<span class="club-spec">' + esc(c.loft || "") + "</span></li>";
        }).join("") + "</ul>"
      : '<p class="empty">Coming soon.</p>') +
  "</section>");

  var jump = '<nav class="jump" aria-label="Sections">' +
    SOURCES.map(function (s) { return '<a href="#' + slug(s.title) + '">' + esc(s.title) + "</a>"; }).join("") +
    '<a href="#whats-in-the-bag">What\'s In The Bag</a></nav>';

  root.innerHTML = jump + sections.join("");
})();
