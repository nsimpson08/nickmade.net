// Renders extras/golf/scores.js (window.GOLF) into the Golf page: a score grid per source, then What's In The Bag.
(function () {
  var root = document.getElementById("golf");
  var data = window.GOLF || {};
  // Trackman rounds come from extras/golf/trackman.js (tools/import_trackman.py), plus any typed into scores.js
  // Rounds marked hidden: true stay in the data (so the importer doesn't re-add them) but aren't shown
  data.trackman = (window.GOLF_TRACKMAN || []).concat(data.trackman || []).filter(function (r) { return !r.hidden; });

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

  // Net rounds get no to-par bubble: Trackman only gives a net figure for them, not the gross score to par
  function hasPar(r) {
    return !r.net && (r.toPar != null || r.par != null);
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
    return '<article class="round' + (r.example ? " example" : "") + (r.image ? " has-photo" : "") + '"' + (r._id ? ' id="' + r._id + '"' : "") + ">" +
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
    rounds.forEach(function (r, i) { r._id = "round-" + s.key + "-" + i; r._source = s.title; }); // the chart links to these
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

  sections.unshift('<section class="subsection" id="score-trend">' + head("Score Trend", "18-hole rounds") +
    '<div class="trend" id="trend-chart"></div></section>');

  var jump = '<nav class="jump" aria-label="Sections">' +
    '<a href="#score-trend">Score Trend</a>' +
    SOURCES.map(function (s) { return '<a href="#' + slug(s.title) + '">' + esc(s.title) + "</a>"; }).join("") +
    '<a href="#whats-in-the-bag">What\'s In The Bag</a></nav>';

  root.innerHTML = jump + sections.join("");

  // ---------- Score Trend chart: 18-hole Trackman and X-Golf scores over time ----------
  // One strokes axis fitted to the scores. Each round is a dot (with a surface ring); the line is each source's rolling
  // average of its last AVG rounds, drawn as a smooth curve with a soft fill under it (1.3: it replaced round-to-round
  // lines, which zig-zagged and spiked on two-round days, and the faint least-squares trends). The best round is called
  // out; each average ends with its current value. Hover/focus snaps a crosshair to the nearest round; click jumps to its card.
  // Colors validated for the dark surface (dataviz validate_palette: lightness, chroma, CVD, contrast).
  var SERIES = [
    { key: "trackman", name: "Trackman", color: "#c97f1c" },
    { key: "xgolf", name: "X-Golf", color: "#3b8fd9" }
  ];
  var DAY = 864e5;
  var NS = "http://www.w3.org/2000/svg";
  var chartBox = document.getElementById("trend-chart");
  var series = SERIES.map(function (s) {
    var pts = (data[s.key] || []).filter(function (r) { return (r.holes || 18) === 18 && r.score && r.date; })
      .map(function (r) { return { t: new Date(r.date + "T00:00:00").getTime(), r: r, s: s }; })
      .sort(function (a, b) { return a.t - b.t; });
    return { s: s, pts: pts };
  }).filter(function (x) { return x.pts.length; });
  var all = [].concat.apply([], series.map(function (x) { return x.pts; }));

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // The rolling average after each round (of up to the last AVG rounds); rounds on the same day give one point
  var AVG = 5;
  function rolling(pts) {
    var out = [];
    pts.forEach(function (p, i) {
      var win = pts.slice(Math.max(0, i - AVG + 1), i + 1);
      var v = win.reduce(function (a, q) { return a + q.r.score; }, 0) / win.length;
      if (out.length && out[out.length - 1].t === p.t) out[out.length - 1].v = v;
      else out.push({ t: p.t, v: v });
    });
    return out;
  }
  // A smooth path through points with increasing x that never overshoots them (monotone cubic, Fritsch-Carlson)
  function smoothPath(xy) {
    if (xy.length < 3) return xy.map(function (q, i) { return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("");
    var n = xy.length, dx = [], m = [], tan = [];
    for (var i = 0; i < n - 1; i++) { dx[i] = xy[i + 1][0] - xy[i][0]; m[i] = (xy[i + 1][1] - xy[i][1]) / dx[i]; }
    tan[0] = m[0]; tan[n - 1] = m[n - 2];
    for (i = 1; i < n - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (!m[i]) { tan[i] = tan[i + 1] = 0; continue; }
      var a = tan[i] / m[i], b = tan[i + 1] / m[i], h = a * a + b * b;
      if (h > 9) { var k = 3 / Math.sqrt(h); tan[i] = k * a * m[i]; tan[i + 1] = k * b * m[i]; }
    }
    var d = "M" + xy[0][0].toFixed(1) + " " + xy[0][1].toFixed(1);
    for (i = 0; i < n - 1; i++) {
      var c = dx[i] / 3;
      d += "C" + (xy[i][0] + c).toFixed(1) + " " + (xy[i][1] + tan[i] * c).toFixed(1) + " " +
        (xy[i + 1][0] - c).toFixed(1) + " " + (xy[i + 1][1] - tan[i + 1] * c).toFixed(1) + " " +
        xy[i + 1][0].toFixed(1) + " " + xy[i + 1][1].toFixed(1);
    }
    return d;
  }

  function drawChart() {
    if (!chartBox || !all.length) { if (chartBox) chartBox.closest("section").hidden = true; return; }
    chartBox.innerHTML = "";
    var W = chartBox.clientWidth, H = W < 560 ? 240 : 300;
    var M = { top: 28, right: W < 560 ? 16 : 96, bottom: 30, left: 40 };
    var iw = W - M.left - M.right, ih = H - M.top - M.bottom;

    var t0 = Math.min.apply(null, all.map(function (p) { return p.t; })) - 4 * DAY;
    var t1 = Math.max.apply(null, all.map(function (p) { return p.t; })) + 4 * DAY;
    // the axis fits the scores (a little room either side), in steps of 5 strokes
    var lo = Math.floor((Math.min.apply(null, all.map(function (p) { return p.r.score; })) - 2) / 5) * 5;
    var hi = Math.ceil((Math.max.apply(null, all.map(function (p) { return p.r.score; })) + 2) / 5) * 5;
    var step = hi - lo > 30 ? 10 : 5;
    function x(t) { return M.left + (t - t0) / (t1 - t0) * iw; }
    function y(v) { return M.top + (hi - v) / (hi - lo) * ih; }

    // legend (above the plot, text in text tokens, line keys in the series color)
    var legend = document.createElement("div");
    legend.className = "trend-legend";
    series.forEach(function (x) {
      var item = document.createElement("span");
      var key = document.createElement("i");
      key.style.background = x.s.color;
      item.appendChild(key);
      item.appendChild(document.createTextNode(x.s.name));
      legend.appendChild(item);
    });
    var tl = document.createElement("span");
    tl.className = "trend-key";
    tl.textContent = "Line: " + AVG + "-round average · dots: rounds";
    legend.appendChild(tl);
    chartBox.appendChild(legend);

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", tabindex: "0",
      "aria-label": "Line chart of 18-hole scores over time for " + series.map(function (x) { return x.s.name; }).join(" and ") +
        ". Use left and right arrows to move between rounds, Enter to open one. Every round is also listed below." });
    chartBox.appendChild(svg);

    // y grid + ticks every 10 strokes
    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      el("line", { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v), class: "trend-grid" }, svg);
      el("text", { x: M.left - 10, y: y(v) + 4, class: "trend-tick", "text-anchor": "end" }, svg).textContent = v;
    }
    // x ticks: first of each month
    var d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1);
    var months = [];
    for (; d.getTime() <= t1; d.setMonth(d.getMonth() + 1)) months.push(d.getTime());
    var every = Math.ceil(months.length / Math.max(2, Math.floor(iw / 70)));
    months.forEach(function (t, i) {
      if (i % every) return;
      el("text", { x: x(t), y: H - 8, class: "trend-tick", "text-anchor": "middle" }, svg)
        .textContent = new Date(t).toLocaleDateString("en-US", { month: "short" });
    });

    // each source's average: a soft fill down to the axis, then the smooth line; the rounds' dots on top
    var defs = el("defs", {}, svg);
    series.forEach(function (sr) {
      sr.avg = rolling(sr.pts);
      var xy = sr.avg.map(function (q) { return [x(q.t), y(q.v)]; });
      var line = smoothPath(xy);
      var gid = "trend-fill-" + sr.s.key;
      var g = el("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      el("stop", { offset: "0%", "stop-color": sr.s.color, "stop-opacity": 0.13 }, g);
      el("stop", { offset: "100%", "stop-color": sr.s.color, "stop-opacity": 0 }, g);
      if (xy.length > 1) {
        el("path", { d: line + "L" + xy[xy.length - 1][0].toFixed(1) + " " + (M.top + ih) + "L" + xy[0][0].toFixed(1) + " " + (M.top + ih) + "Z",
          fill: "url(#" + gid + ")", class: "trend-area" }, svg);
      }
      sr.linePath = line;
    });
    series.forEach(function (sr) { el("path", { d: sr.linePath, stroke: sr.s.color, class: "trend-line" }, svg); });
    var best = all.reduce(function (a, p) { return p.r.score < a.r.score ? p : a; });
    series.forEach(function (sr) {
      sr.pts.forEach(function (p) {
        el("circle", { cx: x(p.t), cy: y(p.r.score), r: p === best ? 6 : 3.5, fill: sr.s.color, class: "trend-dot" + (p === best ? " best" : "") }, svg);
      });
    });

    // the one direct callout: the best round
    var bx = x(best.t), by = y(best.r.score);
    var right = bx < M.left + iw * 0.7;
    var callout = el("text", { x: bx + (right ? 12 : -12), y: by + 20, class: "trend-callout", "text-anchor": right ? "start" : "end" }, svg);
    callout.textContent = "Best " + best.r.score + " · " + best.r.course;
    try { // too long for the side it's on (phones): the other side, or just the score
      var cw = callout.getComputedTextLength();
      if (right && bx + 12 + cw > W - 4) {
        if (bx - 12 - cw >= 4) { callout.setAttribute("x", bx - 12); callout.setAttribute("text-anchor", "end"); }
        else callout.textContent = "Best " + best.r.score;
      }
    } catch (e) {}

    // end labels when there's room on the right and they don't collide
    if (W >= 560) {
      // each average's current value, where its line ends; nudged apart if they'd overlap
      var ends = series.map(function (sr) { var q = sr.avg[sr.avg.length - 1]; return { sr: sr, q: q, y: y(q.v), ly: y(q.v) }; })
        .sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < ends.length; k++) if (ends[k].ly - ends[k - 1].ly < 30) ends[k].ly = ends[k - 1].ly + 30;
      ends.forEach(function (e) {
        var t = el("text", { x: W - M.right + 12, y: e.ly - 2, class: "trend-end" }, svg);
        t.textContent = e.sr.s.name;
        el("tspan", { x: W - M.right + 12, dy: 15, class: "trend-end-v", fill: e.sr.s.color }, t).textContent = "avg " + Math.round(e.q.v);
        el("line", { x1: x(e.q.t) + 4, x2: W - M.right + 8, y1: e.y, y2: e.ly + 2, class: "trend-leader" }, svg);
      });
    }

    // hover / focus layer
    var cross = el("line", { y1: M.top, y2: M.top + ih, class: "trend-cross", visibility: "hidden" }, svg);
    var ring = el("circle", { r: 9, class: "trend-ring", visibility: "hidden" }, svg);
    var tip = document.createElement("div");
    tip.className = "trend-tip";
    tip.hidden = true;
    chartBox.appendChild(tip);
    var order = all.slice().sort(function (a, b) { return a.t - b.t || a.r.score - b.r.score; });
    var current = null;

    function show(p) {
      current = p;
      var px = x(p.t), py = y(p.r.score);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      ring.setAttribute("cx", px); ring.setAttribute("cy", py); ring.setAttribute("stroke", p.s.color); ring.setAttribute("visibility", "visible");
      tip.textContent = "";
      var v = document.createElement("b");
      v.textContent = p.r.score + (p.r.net ? "" : p.r.toPar != null || p.r.par ? " (" + toPar(p.r) + ")" : "");
      var c = document.createElement("span");
      c.textContent = p.r.course;
      var m = document.createElement("span");
      m.className = "trend-tip-meta";
      var key = document.createElement("i");
      key.style.background = p.s.color;
      m.appendChild(key);
      m.appendChild(document.createTextNode(p.s.name + " · " + day(p.r.date)));
      tip.appendChild(v); tip.appendChild(c); tip.appendChild(m);
      tip.hidden = false;
      var tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(px - tw / 2, 4), W - tw - 4) + "px";
      tip.style.top = Math.max(py - tip.offsetHeight - 16, 0) + legend.offsetHeight + "px";
    }
    function hide() {
      current = null;
      cross.setAttribute("visibility", "hidden"); ring.setAttribute("visibility", "hidden"); tip.hidden = true;
    }
    function nearest(evt) {
      var box = svg.getBoundingClientRect();
      var mx = (evt.clientX - box.left) * (W / box.width), my = (evt.clientY - box.top) * (H / box.height);
      var bestP = null, bestD = Infinity;
      all.forEach(function (p) {
        var dx = x(p.t) - mx, dy = (y(p.r.score) - my) * 0.35; // snap mainly on x, like a crosshair
        var dd = dx * dx + dy * dy;
        if (dd < bestD) { bestD = dd; bestP = p; }
      });
      return bestP;
    }
    function open(p) {
      var card = document.getElementById(p.r._id);
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.remove("flash");
      void card.offsetWidth;
      card.classList.add("flash");
    }
    svg.addEventListener("pointermove", function (e) { var p = nearest(e); if (p) show(p); });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("click", function (e) { var p = nearest(e); if (p) open(p); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", function (e) {
      var i = current ? order.indexOf(current) : -1;
      if (e.key === "ArrowRight") show(order[Math.min(order.length - 1, i + 1)]);
      else if (e.key === "ArrowLeft") show(order[Math.max(0, i < 0 ? 0 : i - 1)]);
      else if ((e.key === "Enter" || e.key === " ") && current) open(current);
      else if (e.key === "Escape") hide();
      else return;
      e.preventDefault();
    });
  }

  drawChart();
  var lastW = chartBox ? chartBox.clientWidth : 0, timer;
  window.addEventListener("resize", function () {
    clearTimeout(timer);
    timer = setTimeout(function () { if (chartBox && chartBox.clientWidth !== lastW) { lastW = chartBox.clientWidth; drawChart(); } }, 150);
  });
})();
