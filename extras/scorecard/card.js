// Scorecard: draws a round onto its course's scorecard (extras/scorecard/), for the finish screen and "Save image".
// A course file can carry `card`, a template of its real card copied from the course's own (row order, colors, labels,
// divider column, logo, fonts: see courses/pecan-hollow.json), so the saved image looks like that course's card with
// the round written in by hand. Courses without one get a generic card built from their data (generic() below).
// Drawn on a canvas so the page's web fonts work in the saved PNG. SCORECARD-PLAN.md section 7.
//
//   NMCard.draw(canvas, course, round, { scale })   -> Promise (after the fonts load)
//   round: { tee, holes: [hole numbers played], scores: { "<n>": { strokes, putts, fairway, gir, penalties } },
//            player, date }
(function () {
  var HAND = { font: "Caveat", color: "#1e2a66" };

  // ---------- templates ----------

  function lum(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 1;
    var n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  function generic(course) {
    var tees = course.tees.slice().sort(function (a, b) { return (b.total || 0) - (a.total || 0); });
    var rows = [{ kind: "head", h: 40, fill: "#2d5a3d", color: "#ffffff", label: "HOLE" }];
    tees.filter(function (t) { return !t.women; }).forEach(function (t) { rows.push({ kind: "tee", tee: t.key, h: 46 }); });
    rows.push({ kind: "hcp", set: "men", h: 38, fill: "#ffffff", color: "#4a4a4a", label: "Handicap" });
    ["score", "putts"].forEach(function (r) { rows.push({ kind: "player", role: r, h: 48 }); });
    rows.push({ kind: "player", role: "plusminus", h: 38, label: "+/-" });
    rows.push({ kind: "par", h: 38, fill: "#3f4a43", color: "#ffffff", label: "Par" });
    ["fairways", "greens", "penalties"].forEach(function (r) { rows.push({ kind: "player", role: r, h: 44 }); });
    tees.filter(function (t) { return t.women; }).forEach(function (t) { rows.push({ kind: "tee", tee: t.key, h: 46 }); });
    if (tees.some(function (t) { return t.women; }) && course.hcpWomen) rows.push({ kind: "hcp", set: "women", h: 38, fill: "#ffffff", color: "#4a4a4a", label: "Handicap" });
    rows.push({ kind: "foot", h: 46, fill: "#ffffff", color: "#4a4a4a" });
    return {
      w: 1250, bg: "#f4efe2", frame: { color: "#2d5a3d", width: 3, radius: 16 },
      header: { h: 176, ink: "#2d5a3d", logo: null,
        title: { text: course.name, font: "Roboto Condensed", weight: 700, size: 46, color: "#2d5a3d" },
        sub: { text: course.place || "", font: "Roboto Condensed", weight: 400, size: 24, color: "#6b7a6e" } },
      grid: { pad: 28, labelW: 196, dividerW: 18, extras: ["HCP", "NET"], font: "Roboto Condensed", line: "#9aa39b" },
      divider: null, hand: HAND, rows: rows, teeLabel: "stack", generic: true,
    };
  }

  function template(course) { return course.card || generic(course); }

  function fonts(t) {
    var list = [
      "400 20px '" + t.grid.font + "'", "700 20px '" + t.grid.font + "'",
      "500 20px '" + (t.hand || HAND).font + "'", "700 20px '" + (t.hand || HAND).font + "'",
    ];
    [t.header.title, t.header.sub, t.watermark].forEach(function (f) { if (f) list.push((f.weight || 400) + " 20px '" + f.font + "'"); });
    if (t.header.logo === "pecan-hollow") list.push("700 20px 'Dancing Script'");
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(list.map(function (f) { return document.fonts.load(f).catch(function () {}); }));
  }

  // ---------- numbers off the round ----------

  function sc(round, n) { return (round.scores || {})[n] || {}; }
  function played(round, n) { return round.holes.indexOf(n) >= 0; }
  function girOf(course, round, n) {
    var s = sc(round, n);
    if (s.gir === true || s.gir === false) return s.gir;
    if (s.strokes == null || s.putts == null) return null;
    return s.strokes - s.putts <= course.par[n - 1] - 2;
  }
  function toPar(v) { return v === 0 ? "E" : (v > 0 ? "+" : "") + v; }

  // ---------- drawing ----------

  // The card's look always comes from the course's own file in the repo when it has one (Nick's hand-tuned cards),
  // so a round saved with an older copy of it (or a course file approved before the look changed) gets the new look
  var FILES = "/extras/scorecard/courses/", fresh = {};
  function freshTemplate(course) {
    if (!course.card || /^api:/.test(course.id || "") || !course.id) return Promise.resolve(template(course));
    if (!fresh[course.id]) {
      fresh[course.id] = fetch(FILES + encodeURIComponent(course.id) + ".json").then(function (r) { return r.ok ? r.json() : null; })
        .then(function (f) { return f && f.card ? f.card : null; }).catch(function () { return null; });
    }
    return fresh[course.id].then(function (card) {
      // only if it still fits this course's tees (a card drawn around tees the round doesn't have would be wrong)
      var fits = card && (card.rows || []).every(function (r) { return r.kind !== "tee" || course.tees.some(function (x) { return x.key === r.tee; }); });
      return fits ? card : template(course);
    });
  }
  // the course's own hole drawings for the header (tools/scorecard_art.py cuts them from the real card)
  var pics = {};
  function art(t) {
    return Promise.all(((t.header && t.header.art) || []).map(function (a) {
      if (!pics[a.src]) {
        pics[a.src] = new Promise(function (res) {
          var img = new Image();
          img.onload = function () { res(img); };
          img.onerror = function () { res(null); };
          img.src = a.src;
        });
      }
      return pics[a.src];
    }));
  }

  function draw(canvas, course, round, opts) {
    return freshTemplate(course).then(function (t) {
      return Promise.all([fonts(t), art(t)]).then(function (r) { paint(canvas, course, round, t, (opts && opts.scale) || 2, r[1]); return canvas; });
    });
  }

  function paint(canvas, course, round, t, scale, pictures) {
    var n = course.holes || 18;
    var g = t.grid, hand = t.hand || HAND;
    var W = t.w, pad = g.pad, gx = pad, gw = W - pad * 2, gy = t.header.h;
    var rowsH = t.rows.reduce(function (a, r) { return a + r.h; }, 0);
    var H = gy + rowsH + pad;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    var tee = course.tees.filter(function (x) { return x.key === round.tee; })[0] || course.tees[0];
    var teeBox = null; // the tee played's name box, outlined at the end

    // columns: label, holes 1-9, OUT, divider, holes 10-18, IN, TOT, extras (HCP, NET)
    var front = Math.min(9, n), back = n > 9 ? n - 9 : 0, extras = g.extras || [];
    var D = back ? g.dividerW : 0;
    var units = n + (back ? 2 : 0) * 1.25 + 1.25 + extras.length;
    var cw = (gw - g.labelW - D) / units;
    var cols = [], x = gx;
    function col(key, w) { cols.push({ key: key, x: x, w: w }); x += w; }
    col("label", g.labelW);
    for (var i = 1; i <= front; i++) col(i, cw);
    if (back) { col("out", cw * 1.25); col("div", D); for (i = 10; i <= n; i++) col(i, cw); col("in", cw * 1.25); }
    col("tot", cw * 1.25);
    extras.forEach(function (e, k) { col("x" + k, cw); });
    var colOf = {};
    cols.forEach(function (c) { colOf[c.key] = c; });

    // background
    if (Array.isArray(t.bg)) {
      var bg = ctx.createLinearGradient(0, 0, W * 0.3, H);
      bg.addColorStop(0, t.bg[0]); bg.addColorStop(1, t.bg[1]);
      ctx.fillStyle = bg;
    } else ctx.fillStyle = t.bg || "#ffffff";
    ctx.fillRect(0, 0, W, H);

    function font(f, size, weight) { return (weight || 400) + " " + size + "px '" + f + "', system-ui, sans-serif"; }
    function text(s, x, y, o) {
      ctx.font = font(o.font || g.font, o.size || 20, o.weight);
      ctx.fillStyle = o.color || "#222";
      ctx.textAlign = o.align || "center";
      ctx.textBaseline = o.base || "middle";
      ctx.fillText(String(s), x, y);
    }

    header(ctx, course, round, t, tee, W, text, pictures || []);

    // rows
    var y = gy, rowY = [];
    t.rows.forEach(function (r) { rowY.push(y); y += r.h; });
    t.rows.forEach(function (r, ri) {
      var ry = rowY[ri], fill = rowFill(r, course), ink = rowInk(r, course);
      ctx.fillStyle = fill;
      ctx.fillRect(gx, ry, gw, r.h);
      cells(r, ri, ry, ink);
      // the lines between cells: light on dark rows, dark on light ones
      ctx.strokeStyle = lum(fill) < 0.6 ? "rgba(255,255,255,0.5)" : g.line;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      cols.forEach(function (c, k) {
        if (k === 0 || r.kind === "foot") return; // the signature line is one open box
        if (c.key === "div" || (cols[k - 1] && cols[k - 1].key === "div")) return;
        ctx.moveTo(c.x + 0.5, ry); ctx.lineTo(c.x + 0.5, ry + r.h);
      });
      ctx.stroke();
    });
    // horizontal lines and the outer edge
    ctx.strokeStyle = g.line; ctx.lineWidth = 1.2;
    ctx.beginPath();
    rowY.forEach(function (ry, k) { if (k) { ctx.moveTo(gx, ry + 0.5); ctx.lineTo(gx + gw, ry + 0.5); } });
    ctx.stroke();

    // the divider column ("INITIAL", "Players Initials")
    if (back && t.divider) {
      var dv = t.divider, dc = colOf.div;
      var dy0 = rowY[dv.fromRow], dy1 = rowY[dv.toRow] + t.rows[dv.toRow].h;
      ctx.fillStyle = dv.fill;
      ctx.fillRect(dc.x, dy0, dc.w, dy1 - dy0);
      ctx.strokeStyle = g.line; ctx.strokeRect(dc.x + 0.5, dy0 + 0.5, dc.w - 1, dy1 - dy0 - 1);
      if (dv.style === "rotate") {
        ctx.save();
        ctx.translate(dc.x + dc.w / 2, dy0 + 24);
        ctx.rotate(-Math.PI / 2);
        text(dv.text, 0, 0, { size: 21, weight: 700, color: dv.color, align: "right" });
        ctx.restore();
      } else {
        var letters = dv.text.split(""), step = Math.min(34, (dy1 - dy0 - 40) / letters.length);
        letters.forEach(function (ch, k) { text(ch, dc.x + dc.w / 2, dy0 + 30 + k * step + step / 2, { size: 26, color: dv.color }); });
      }
    }
    if (t.watermark && t.rows[t.watermark.toRow]) {
      var wm = t.watermark, wy = (rowY[wm.fromRow] + rowY[wm.toRow] + t.rows[wm.toRow].h) / 2;
      [[colOf[1], colOf[front]], back ? [colOf[10], colOf[n]] : null].forEach(function (span) {
        if (!span) return;
        var cx = (span[0].x + span[1].x + span[1].w) / 2;
        text(wm.text, cx, wy, { font: wm.font, size: 64, weight: wm.weight, color: wm.color });
      });
    }
    ctx.strokeStyle = t.frame ? t.frame.color : "#3a3a3a";
    ctx.lineWidth = t.frame ? t.frame.width : 2;
    roundRect(ctx, gx, gy, gw, rowsH, t.frame ? t.frame.radius : 0);
    ctx.stroke();
    if (teeBox) {
      ctx.strokeStyle = teeBox.color;
      ctx.lineWidth = 4.5;
      ctx.strokeRect(teeBox.x + 2.25, teeBox.y + 2.25, teeBox.w - 4.5, teeBox.h - 4.5);
    }

    // ---- cell contents ----
    function rowFill(r, c) {
      if (r.kind === "tee") { var tt = teeBy(r.tee); return tt ? tt.color : "#ccc"; }
      if (r.kind === "player") return "#ffffff";
      return r.fill || "#ffffff";
    }
    function rowInk(r) {
      if (r.kind === "tee") { var tt = teeBy(r.tee); return tt && tt.ink ? tt.ink : lum(rowFill(r)) < 0.6 ? "#ffffff" : "#1b1b1b"; }
      return r.color || "#1b1b1b";
    }
    function teeBy(k) { return course.tees.filter(function (x) { return x.key === k; })[0]; }
    function mid(c, ry, h) { return [c.x + c.w / 2, ry + h / 2]; }
    function sum(a, b, f) { var s = 0, any = false; for (var k = a; k <= b; k++) { var v = f(k); if (v != null) { s += v; any = true; } } return any ? s : null; }
    function upper(s) { return t.rows[0].label === "HOLE" ? s.toUpperCase() : s; }

    function cells(r, ri, ry, ink) {
      var h = r.h, L = colOf.label, big = Math.min(23, h * 0.5);
      var put = function (key, v, o) {
        var c = colOf[key];
        if (!c || v == null || v === "") return;
        var p = mid(c, ry, h);
        text(v, p[0], p[1] + 1, Object.assign({ size: big, color: ink }, o || {}));
      };
      var bold = { weight: 700 };
      if (r.kind === "head") {
        text(r.label, L.x + 10, ry + h / 2 + 1, { align: "left", size: 21, weight: 700, color: ink });
        for (var k = 1; k <= n; k++) put(k, k, bold);
        put("out", upper("Out"), bold); put("in", upper("In"), bold); put("tot", upper("Tot"), bold);
        extras.forEach(function (e, j) { put("x" + j, e, bold); });
      } else if (r.kind === "tee") {
        var tt = teeBy(r.tee);
        if (!tt) return;
        var rs = tt.rating ? tt.rating + "/" + tt.slope : "";
        if (t.teeLabel === "inline") {
          var lab = tt.label || tt.name;
          text(lab, L.x + 10, ry + h / 2 + 1, { align: "left", size: 20, weight: 700, color: ink });
          ctx.font = font(g.font, 20, 700);
          if (rs) text(rs, L.x + 16 + ctx.measureText(lab).width, ry + h / 2 + 2, { align: "left", size: 13, weight: 700, color: ink });
        } else {
          text(tt.label || tt.name, L.x + 10, ry + h * 0.33, { align: "left", size: 19, weight: 700, color: ink });
          if (rs) text(rs, L.x + 10, ry + h * 0.72, { align: "left", size: 16, color: ink });
          if (tt.range) text(tt.range, L.x + L.w - 10, ry + h * 0.72, { align: "right", size: 16, color: ink });
        }
        // the tee played gets a bold outline round its name box (drawn last, over the grid lines; Nick: not a circle)
        if (tt.key === round.tee) teeBox = { x: L.x, y: ry, w: L.w, h: h, color: lum(rowFill(r)) < 0.45 ? "#ffffff" : hand.color };
        var alt = tt.alt || {};
        var y1 = function (k) { return tt.yards[k - 1]; };
        var y2 = function (k) { return alt[k] != null ? alt[k] : tt.yards[k - 1]; };
        var two = function (key, a, b) {
          var c = colOf[key];
          if (!c || a == null) return;
          if (b == null || b === a) { put(key, a); return; }
          text(a, c.x + c.w * 0.42, ry + h * 0.33, { size: 17, color: ink });
          text(b, c.x + c.w * 0.6, ry + h * 0.72, { size: 17, color: ink });
        };
        for (k = 1; k <= n; k++) two(k, y1(k), alt[k] != null ? alt[k] : null);
        var hasAlt = Object.keys(alt).length > 0;
        two("out", sum(1, front, y1), hasAlt ? sum(1, front, y2) : null);
        if (back) two("in", sum(10, n, y1), hasAlt ? sum(10, n, y2) : null);
        two("tot", sum(1, n, y1), hasAlt ? sum(1, n, y2) : null);
      } else if (r.kind === "hcp") {
        text(r.label, L.x + 10, ry + h / 2 + 1, { align: "left", size: 19, color: ink });
        var set = r.set === "women" && course.hcpWomen ? course.hcpWomen : course.hcp;
        for (k = 1; k <= n; k++) put(k, set[k - 1]);
      } else if (r.kind === "par") {
        text(r.label, L.x + 10, ry + h / 2 + 1, { align: "left", size: 20, weight: 700, color: ink });
        var p = function (k) { return course.par[k - 1]; };
        for (k = 1; k <= n; k++) put(k, p(k), bold);
        put("out", sum(1, front, p), bold);
        if (back) put("in", sum(10, n, p), bold);
        put("tot", sum(1, n, p), bold);
      } else if (r.kind === "player") {
        player(r, ry);
      } else if (r.kind === "foot") {
        var fy = ry + h / 2 + 1, fsz = 20;
        text("Scorer:", L.x + 10, fy, { align: "left", size: fsz, color: ink });
        ctx.font = font(g.font, fsz);
        handText(round.player || "", L.x + 18 + ctx.measureText("Scorer:").width, fy, { align: "left", size: 32 });
        var ax = back ? colOf[10].x + 8 : colOf[Math.min(6, n)].x;
        text("Attest:", ax, fy, { align: "left", size: fsz, color: ink });
        var dx = (back ? colOf["in"] : colOf.tot).x;
        text("Date:", dx, fy, { align: "left", size: fsz, color: ink });
        ctx.font = font(g.font, fsz);
        var dateX = dx + 8 + ctx.measureText("Date:").width, ds = 28, when = dateText(round.date);
        ctx.font = font(hand.font, ds, 700);
        while (ds > 16 && dateX + ctx.measureText(when).width > gx + gw - 10) { ds--; ctx.font = font(hand.font, ds, 700); } // shrink to fit the box
        handText(when, dateX, fy, { align: "left", size: ds });
      }
    }

    function handText(s, x, y, o) {
      text(s, x, y + 1, { font: hand.font, size: o.size || 34, weight: 700, color: hand.color, align: o.align || "center" });
    }

    function player(r, ry) {
      var h = r.h, L = colOf.label, hs = Math.min(38, h * 0.82);
      var names = { score: round.player || "Me", putts: "Putts", fairways: "Fairways", greens: "Greens", penalties: "Penalties" };
      if (r.label) text(r.label, L.x + 10, ry + h / 2 + 1, { align: "left", size: 19, color: "#4a4a4a" });
      else handText(names[r.role] || "", L.x + 12, ry + h / 2, { align: "left", size: Math.min(34, h * 0.74) });
      var at = function (key) { var c = colOf[key]; return c ? mid(c, ry, h) : null; };
      var write = function (key, v, size) { var p = at(key); if (p && v != null && v !== "") handText(v, p[0], p[1], { size: size || hs }); };
      var nines = [[1, front, "out"], back ? [10, n, "in"] : null].filter(Boolean);
      var k;
      if (r.role === "score") {
        var st = function (k2) { return played(round, k2) ? sc(round, k2).strokes : null; };
        for (k = 1; k <= n; k++) {
          var v = st(k);
          if (v == null) continue;
          write(k, v);
          mark(at(k), v - course.par[k - 1], Math.min(colOf[k].w, h));
        }
        nines.forEach(function (nn) { write(nn[2], sum(nn[0], nn[1], st), hs * 0.9); });
        write("tot", sum(1, n, st), hs * 0.9);
      } else if (r.role === "putts") {
        var pt = function (k2) { return played(round, k2) ? sc(round, k2).putts : null; };
        for (k = 1; k <= n; k++) write(k, pt(k));
        nines.forEach(function (nn) { write(nn[2], sum(nn[0], nn[1], pt), hs * 0.9); });
        write("tot", sum(1, n, pt), hs * 0.9);
      } else if (r.role === "plusminus") {
        var run = 0, any = false;
        var diff = function (k2) { var s2 = played(round, k2) ? sc(round, k2).strokes : null; return s2 == null ? null : s2 - course.par[k2 - 1]; };
        round.holes.forEach(function (k2) {
          var d = diff(k2);
          if (d == null) return;
          run += d; any = true;
          write(k2, toPar(run), hs * 0.78);
        });
        nines.forEach(function (nn) { var s2 = sum(nn[0], nn[1], diff); if (s2 != null) write(nn[2], toPar(s2), hs * 0.78); });
        if (any) write("tot", toPar(run), hs * 0.78);
      } else if (r.role === "fairways") {
        var hits = [0, 0, 0];
        for (k = 1; k <= n; k++) {
          if (!played(round, k) || course.par[k - 1] === 3) continue;
          var f = sc(round, k).fairway, p = at(k);
          if (!f) continue;
          glyph(f, p[0], p[1], Math.min(colOf[k].w, h) * 0.5);
          hits[k <= 9 ? 0 : 1] += f === "hit" ? 1 : 0;
        }
        var tries = function (a, b) { var c2 = 0, h2 = 0; for (var j = a; j <= b; j++) { if (played(round, j) && course.par[j - 1] !== 3 && sc(round, j).fairway) { c2++; if (sc(round, j).fairway === "hit") h2++; } } return c2 ? h2 + "/" + c2 : null; };
        nines.forEach(function (nn) { write(nn[2], tries(nn[0], nn[1]), hs * 0.66); });
        write("tot", tries(1, n), hs * 0.66);
      } else if (r.role === "greens") {
        var gcount = function (a, b) { var c2 = 0, h2 = 0; for (var j = a; j <= b; j++) { var gv = played(round, j) ? girOf(course, round, j) : null; if (gv != null) { c2++; if (gv) h2++; } } return c2 ? h2 + "/" + c2 : null; };
        for (k = 1; k <= n; k++) {
          var gv = played(round, k) ? girOf(course, round, k) : null;
          if (gv == null) continue;
          var q = at(k), rr = Math.min(colOf[k].w, h) * 0.17;
          ctx.beginPath(); ctx.arc(q[0], q[1], rr, 0, Math.PI * 2);
          ctx.lineWidth = 2; ctx.strokeStyle = hand.color; ctx.fillStyle = hand.color;
          if (gv) ctx.fill(); else ctx.stroke();
        }
        nines.forEach(function (nn) { write(nn[2], gcount(nn[0], nn[1]), hs * 0.66); });
        write("tot", gcount(1, n), hs * 0.66);
      } else if (r.role === "penalties") {
        var pe = function (k2) { var v2 = played(round, k2) ? sc(round, k2).penalties : null; return v2 ? v2 : null; };
        for (k = 1; k <= n; k++) write(k, pe(k));
        var tp = sum(1, n, pe);
        if (tp) write("tot", tp, hs * 0.9);
      }
    }

    // birdie circled, eagle double-circled, bogey boxed, double bogey or worse double-boxed
    function mark(p, d, size) {
      if (!d) return;
      var r = size * 0.36;
      ctx.strokeStyle = hand.color; ctx.lineWidth = 1.8;
      var ring = function (rad) { ctx.beginPath(); ctx.ellipse(p[0], p[1], rad * 1.02, rad * 0.98, -0.2, 0, Math.PI * 2); ctx.stroke(); };
      var box = function (rad) { ctx.beginPath(); ctx.rect(p[0] - rad, p[1] - rad, rad * 2, rad * 2); ctx.stroke(); };
      if (d <= -1) { ring(r); if (d <= -2) ring(r * 0.78); }
      else { box(r * 0.95); if (d >= 2) box(r * 0.75); }
    }

    // fairway: a hand-drawn check, or an arrow for a miss left/right
    function glyph(f, x0, y0, s) {
      ctx.strokeStyle = hand.color; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      if (f === "hit") {
        ctx.moveTo(x0 - s * 0.42, y0); ctx.lineTo(x0 - s * 0.1, y0 + s * 0.32); ctx.lineTo(x0 + s * 0.45, y0 - s * 0.38);
      } else {
        var dir = f === "left" ? -1 : 1;
        ctx.moveTo(x0 - dir * s * 0.45, y0); ctx.lineTo(x0 + dir * s * 0.45, y0);
        ctx.moveTo(x0 + dir * s * 0.12, y0 - s * 0.28); ctx.lineTo(x0 + dir * s * 0.45, y0); ctx.lineTo(x0 + dir * s * 0.12, y0 + s * 0.28);
      }
      ctx.stroke();
    }
  }

  function dateText(d) {
    if (!d) return "";
    var x = new Date(d);
    return isNaN(x) ? "" : x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (!r) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- the header: the course's logo and name, and the round in a few words ----------

  function header(ctx, course, round, t, tee, W, text, pictures) {
    var hd = t.header, g = t.grid, cx = W / 2;
    // the real card's hole drawings, where the course file has them (the round is then on the card itself: the tee
    // outlined, the totals in Out / In / Tot, the scorer and date on the bottom line, like a real card)
    (hd.art || []).forEach(function (a, i) { if (pictures[i]) ctx.drawImage(pictures[i], a.x, a.y, a.w, a.h); });
    if (hd.logo && LOGOS[hd.logo]) LOGOS[hd.logo](ctx, cx, hd.logoY || hd.h * 0.43, text);
    else {
      if (hd.title) text(hd.title.text, cx, hd.h * (hd.sub ? 0.36 : 0.5), { font: hd.title.font, size: hd.title.size, weight: hd.title.weight, color: hd.title.color });
      if (hd.sub && hd.sub.text) text(hd.sub.text, cx, hd.h * 0.66, { font: hd.sub.font, size: hd.sub.size, weight: hd.sub.weight, color: hd.sub.color });
    }
    if (hd.art && hd.art.length) return;
    // left: date and tee; right: the score
    var strokes = 0, putts = 0, par = 0, done = 0;
    round.holes.forEach(function (k) {
      var s = (round.scores || {})[k] || {};
      if (s.strokes == null) return;
      strokes += s.strokes; par += course.par[k - 1]; done++;
      if (s.putts != null) putts += s.putts;
    });
    var lx = g.pad + 6, ink = hd.ink;
    text(dateText(round.date), lx, hd.h * 0.34, { align: "left", size: 26, weight: 700, color: ink });
    var teeLine = (tee ? (tee.label || tee.name + " tees") : "") + (tee && tee.total ? " · " + tee.total.toLocaleString("en-US") + " yds" : "");
    text(teeLine, lx, hd.h * 0.52, { align: "left", size: 21, color: ink });
    var nine = round.holes.length === 9 ? (round.holes[0] === 1 ? "Front 9" : "Back 9") : "";
    if (nine) text(nine, lx, hd.h * 0.68, { align: "left", size: 21, color: ink });
    if (!done) return;
    var rx = W - g.pad - 6;
    text(strokes, rx, hd.h * 0.38, { align: "right", size: 64, weight: 700, color: ink });
    var line = toPar(strokes - par) + (putts ? " · " + putts + " putts" : "") + (done < round.holes.length ? " · thru " + done : "");
    text(line, rx, hd.h * 0.66, { align: "right", size: 22, color: ink });
  }

  // Course logos, redrawn as simple vectors so they stay sharp (the clubs' own files are small): SCORECARD-PLAN.md 7A.
  // The logo belongs to the club; it's only drawn on that course's card.
  var LOGOS = {
    // Pecan Hollow: a pecan tree in a cream oval, two crossed golf clubs behind it, "Pecan Hollow" in script below
    "pecan-hollow": function (ctx, cx, cy, text) {
      ctx.save();
      ctx.lineCap = "round";
      // the clubs: shafts crossing behind the oval, grips at the top, iron heads at the bottom
      [[-1], [1]].forEach(function (s) {
        var d = s[0];
        var x0 = cx - d * 92, y0 = cy - 84, x1 = cx + d * 70, y1 = cy + 86;
        ctx.strokeStyle = "#8d6a3f"; ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = "#4a3320"; ctx.lineWidth = 7.5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * 0.12, y0 + (y1 - y0) * 0.12); ctx.stroke();
        ctx.fillStyle = "#a5753f";
        ctx.beginPath();
        ctx.moveTo(x1 - d * 2, y1 - 6); ctx.lineTo(x1 + d * 26, y1 + 2); ctx.lineTo(x1 + d * 28, y1 + 12); ctx.lineTo(x1 - d * 4, y1 + 9);
        ctx.closePath(); ctx.fill();
      });
      // the oval
      ctx.beginPath(); ctx.ellipse(cx, cy, 54, 66, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#fbfaf1"; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = "#6b4423"; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx, cy, 48.5, 60.5, 0, 0, Math.PI * 2);
      ctx.lineWidth = 1.4; ctx.strokeStyle = "#b8a77c"; ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, 47.5, 59.5, 0, 0, Math.PI * 2); ctx.clip();
      // ground
      ctx.fillStyle = "#8cbd4f"; ctx.beginPath(); ctx.ellipse(cx, cy + 50, 52, 15, 0, 0, Math.PI * 2); ctx.fill();
      // trunk and branches
      ctx.strokeStyle = "#5e3b1f"; ctx.lineCap = "round";
      [[0, 46, 0, 8, 7], [0, 14, -18, -6, 3.5], [0, 12, 17, -8, 3.5], [0, 4, -6, -16, 3]].forEach(function (b) {
        ctx.lineWidth = b[4]; ctx.beginPath(); ctx.moveTo(cx + b[0], cy + b[1]); ctx.lineTo(cx + b[2], cy + b[3]); ctx.stroke();
      });
      // the crown: overlapping leaf clusters in three greens
      var leaves = [[-26, -14, 15, 0], [24, -12, 15, 1], [-12, -30, 16, 2], [12, -32, 16, 0], [0, -18, 17, 1],
        [-30, -2, 11, 2], [30, 0, 11, 2], [-18, -6, 12, 1], [18, -4, 12, 0], [0, -40, 12, 1], [-22, -26, 11, 1], [22, -26, 11, 2]];
      var greens = ["#2f6a22", "#4f8f2f", "#6aa83d"];
      leaves.forEach(function (l) {
        ctx.fillStyle = greens[l[3]];
        ctx.beginPath(); ctx.arc(cx + l[0], cy + l[1], l[2], 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
      ctx.restore();
      text("Pecan Hollow", cx, cy + 104, { font: "Dancing Script", size: 50, weight: 700, color: "#2b6a2b" });
    },
  };

  window.NMCard = { draw: draw, template: template, girOf: girOf };
})();
