// Scorecard's card reader, the phone's half (phase 3 of SCORECARD-PLAN.md). The Worker asks the vision model
// (POST /scorecard/read); this side does the image work and the checking:
//   - a photo from the camera, a PDF (rendered with pdf.js, loaded only when needed) or an image from the course's
//     website becomes one JPEG, at most 1600 px on its long side
//   - the model's JSON becomes a course in the app's shape (tees with keys and colors, par, handicaps), plus
//     self-checks: each tee's holes must add up to the card's own Out / In / Total, par likewise, and the handicaps
//     1-18 must each appear once. Anything that doesn't hold up is listed, never quietly fixed.
//
//   - the model's weak spot is the par and handicap rows of a nine slipping by a cell (Firewheel Lakes' back nine,
//     next to its "Players Initials" column). closeUps() spots it (a handicap missing or repeated, pars that don't add
//     up to the card's own Out / In); the app then reads just that half close up, which gets those rows right, and
//     mergeCloseUp() takes only those rows from it (close up, the model is worse at yardages)
//
//   NMCardRead.fromFile(file)  -> Promise<dataURL>        (camera photo, or a file the Worker passed through; for a PDF,
//                                                         the page with the most numbers on it, not just page 1)
//   NMCardRead.bigOf(dataURL)  -> the same card up to 3200 px (this session only; else the dataURL itself)
//   NMCardRead.textOf(dataURL) -> the PDF page's own printed text ("" for a photo), sent along to the reader
//   NMCardRead.ninePieces(dataURL) -> Promise<[dataURL per nine] | null>   a 27-hole card cut into its nines
//   NMCardRead.fromHalves(frontRead, backRead) -> read   an 18-hole card read nine by nine (part "nine")
//   NMCardRead.fromNines(read, names, others?) -> read | null   (others: all the club's nines' names, to rule out)   a 27-hole card's nines (part "nines") -> the one or two played
//   NMCardRead.half(dataURL, "front"|"back") -> Promise<dataURL>   that nine, close up
//   NMCardRead.closeUps(read, holes) -> ["front"?, "back"?]   the nines whose par/handicap rows don't hold up
//   NMCardRead.mergeCloseUp(read, side, closeRead) -> read
//   NMCardRead.toCourse(read, meta) -> { course, checks: [{ where, msg }], unread }
(function () {
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.4.299/";
  var MAX = 1600;
  var COLORS = { gold: "#c9a227", blue: "#2f6fb7", white: "#ffffff", red: "#c8323a", black: "#25272a", green: "#2f7d46",
    silver: "#b8bcc2", gray: "#9a9a96", grey: "#9a9a96", yellow: "#e8c547", orange: "#e07b2a", purple: "#6b3fa0",
    copper: "#b87333", tan: "#c4a46a", brown: "#7a5230", teal: "#2a8c8c", maroon: "#7a1f2b", navy: "#24346b", pink: "#e58bb0" };

  function jpeg(canvas) { return canvas.toDataURL("image/jpeg", 0.88); }
  function shrink(src, w, h, max) {
    var k = Math.min(1, (max || MAX) / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    var x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); // a PNG with see-through parts reads as white card
    // shrunk by halves (a big scan shrunk in one step drops its thin lines: a 6944 px card lost 3 row lines at 3200)
    var step = src, sw = w, sh = h;
    while (sw * 0.5 > c.width) {
      var t = document.createElement("canvas");
      t.width = Math.round(sw * 0.5); t.height = Math.round(sh * 0.5);
      var tx = t.getContext("2d");
      tx.fillStyle = "#fff"; tx.fillRect(0, 0, t.width, t.height);
      tx.imageSmoothingQuality = "high";
      tx.drawImage(step, 0, 0, t.width, t.height);
      step = t; sw = t.width; sh = t.height;
    }
    x.imageSmoothingQuality = "high";
    x.drawImage(step, 0, 0, c.width, c.height);
    return c;
  }
  function fromImage(blob) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(blob);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var small = jpeg(shrink(img, img.naturalWidth, img.naturalHeight));
        // lossless: JPEG smears a scan's thin lines (Holiday Hills' scan lost 3 row lines); a long, thin card (a
        // front-and-back scan, 6944 x 1313) kept up to 7200 px wide, as shrinking it to 3200 lost row lines too
        var bigMax = img.naturalWidth > img.naturalHeight * 2 ? 7200 : BIG;
        bigs.set(small, function () { return shrink(img, img.naturalWidth, img.naturalHeight, bigMax).toDataURL("image/png"); });
        resolve(small);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be opened.")); };
      img.src = url;
    });
  }
  function fromPdf(blob) {
    return Promise.all([import(PDFJS + "pdf.min.mjs"), blob.arrayBuffer()]).then(function (r) {
      var lib = r[0];
      lib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
      return lib.getDocument({ data: r[1] }).promise;
    }).then(function (doc) {
      // a card PDF can start with its cover (Breckenridge's page 1 is a photo): take the page with the most numbers
      var pages = [];
      for (var i = 1; i <= Math.min(doc.numPages, 6); i++) pages.push(i);
      return Promise.all(pages.map(function (i) {
        return doc.getPage(i).then(function (page) {
          return page.getTextContent().then(function (tc) {
            var text = tc.items.map(function (x) { return x.str; }).join(" ").replace(/\s+/g, " ").trim();
            return { page: page, text: text, nums: (text.match(/\d+/g) || []).length };
          }, function () { return { page: page, text: "", nums: 0 }; });
        });
      })).then(function (all) {
        return all.reduce(function (a, b) { return b.nums > a.nums ? b : a; }, all[0]);
      });
    }).then(function (best) {
      var page = best.page;
      var v1 = page.getViewport({ scale: 1 });
      var view = page.getViewport({ scale: BIG / Math.max(v1.width, v1.height) });
      var c = document.createElement("canvas");
      c.width = Math.round(view.width); c.height = Math.round(view.height);
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: ctx, viewport: view }).promise.then(function () {
        var url = jpeg(shrink(c, c.width, c.height));
        if (best.nums >= 20) texts.set(url, best.text);
        bigs.set(url, function () { return c.toDataURL("image/png"); });
        return url;
      });
    });
  }
  var texts = new Map();
  function textOf(dataUrl) { return texts.get(dataUrl) || ""; }
  // the same card at up to 3200 px, made only when asked (the Card look screen cuts its pictures from it)
  var BIG = 3200, bigs = new Map();
  function bigOf(dataUrl) { var f = bigs.get(dataUrl); return f ? f() : dataUrl; }
  // one nine of the card, close up: the left or right half (with a little overlap), 1400 px wide
  function half(dataUrl, side) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, x0 = side === "front" ? 0 : Math.round(w * 0.47), cw = Math.round(w * 0.53);
        var k = 1400 / cw, c = document.createElement("canvas");
        c.width = 1400; c.height = Math.round(h * k);
        var ctx = c.getContext("2d");
        ctx.drawImage(img, x0, 0, cw, h, 0, 0, c.width, c.height);
        resolve(jpeg(c));
      };
      img.onerror = function () { reject(new Error("That picture couldn't be opened.")); };
      img.src = dataUrl;
    });
  }

  function fromFile(file) {
    var pdf = /pdf/i.test(file.type || "") || /\.pdf$/i.test(file.name || "");
    return pdf ? fromPdf(file) : fromImage(file);
  }

  // ---------- the model's JSON -> a course ----------

  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function int(v, lo, hi) { v = typeof v === "string" ? +v.replace(/[^\d.-]/g, "") : v; return Number.isFinite(v) && Math.round(v) === v && v >= lo && v <= hi ? v : null; }
  function num(v, lo, hi) { v = typeof v === "string" ? +v.replace(/[^\d.-]/g, "") : v; return Number.isFinite(v) && v >= lo && v <= hi ? v : null; }
  function first(v) { return typeof v === "string" ? v.split("/")[0] : v; } // "4/5" or "36/37": the first
  function list(a, n, lo, hi) { var out = []; for (var i = 0; i < n; i++) out.push(int(first(a && a[i]), lo, hi)); return out; }
  function sum(a, from, to) {
    var s = 0;
    for (var i = from; i < to; i++) { if (a[i] == null) return null; s += a[i]; }
    return s;
  }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function nameOf(t, i) {
    var n = String(t.name || "").replace(/\s+tees?$/i, "").replace(/\s+/g, " ").trim();
    return n ? n.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : "Tee " + (i + 1);
  }

  function closeUps(read, n) {
    if (n !== 18 || !read) return [];
    var hc = list(read.hcp, 18, 1, 18), par = list(read.par, 18, 3, 6), sides = [];
    var full = hc.every(function (v) { return v != null; }) && hc.filter(function (v, i) { return hc.indexOf(v) === i; }).length === 18;
    [["front", 0, read.parOut], ["back", 9, read.parIn]].forEach(function (x) {
      var h = hc.slice(x[1], x[1] + 9), p = par.slice(x[1], x[1] + 9), printed = int(first(x[2]), 27, 45);
      var gap = h.some(function (v, i) { return v == null || h.indexOf(v) !== i; }) || p.some(function (v) { return v == null; });
      var sum = p.every(function (v) { return v != null; }) ? p.reduce(function (a, v) { return a + v; }, 0) : null;
      if (gap || (printed && sum != null && sum !== printed)) sides.push(x[0]);
    });
    if (!full && !sides.length) sides = ["front", "back"];
    return sides;
  }
  function mergeCloseUp(read, side, close) {
    var off = side === "front" ? 0 : 9;
    ["par", "hcp", "hcpWomen"].forEach(function (k) {
      var v = close && close[k];
      if (!Array.isArray(v) || v.filter(function (x) { return x != null; }).length !== 9) return;
      var row = Array.isArray(read[k]) ? read[k].slice() : Array(18).fill(null);
      for (var i = 0; i < 9; i++) row[off + i] = v[i];
      read[k] = row;
    });
    if (close && close.parOut != null && side === "front") read.parOut = close.parOut;
    if (close && close.parIn != null && side === "back") read.parIn = close.parIn;
    return read;
  }

  function toCourse(read, meta) {
    read = read || {};
    meta = meta || {};
    var n = (read.par && read.par.length === 9) || meta.holes === 9 ? 9 : 18;
    var checks = [], unread = 0, keys = {};
    var par = list(read.par, n, 3, 6), hcp = list(read.hcp, n, 1, 18);
    var hcpW = read.hcpWomen && read.hcpWomen.length ? list(read.hcpWomen, n, 1, 18) : null;
    var tees = (read.tees || []).map(function (t, i) {
      var name = nameOf(t, i), k = slug(name) || "tee-" + (i + 1);
      while (keys[k]) k += "-2";
      keys[k] = 1;
      var word = name.toLowerCase().split(" ")[0];
      var yards = list(t.yards, n, 30, 800);
      var tee = { key: k, name: name, color: COLORS[word] || COLORS[String(t.color || "").toLowerCase().split(/\s+/).pop()] || "#8a8a86",
        rating: num(t.rating, 50, 90), slope: int(t.slope, 55, 155), yards: yards };
      if (/^(red|forward|ladies|lady|women)/i.test(name) || /women|ladies/i.test(name)) tee.women = true;
      if (t.alt && typeof t.alt === "object") {
        tee.alt = {};
        Object.keys(t.alt).forEach(function (h) { var v = int(t.alt[h], 30, 800); if (int(+h, 1, n) && v) tee.alt[h] = v; });
        if (!Object.keys(tee.alt).length) delete tee.alt;
      }
      var all = sum(yards, 0, n);
      tee.total = all || int(t.total, 500, 9000);
      // the self-checks: the holes against the card's own totals
      var where = "tee:" + k;
      if (n === 18) {
        var o = sum(yards, 0, 9), ii = sum(yards, 9, 18);
        if (o != null && int(t.out, 100, 5000) != null && o !== t.out) checks.push({ where: where, msg: name + ": holes 1–9 add up to " + fmt(o) + ", but the card's Out says " + fmt(t.out) + "." });
        if (ii != null && int(t["in"], 100, 5000) != null && ii !== t["in"]) checks.push({ where: where, msg: name + ": holes 10–18 add up to " + fmt(ii) + ", but the card's In says " + fmt(t["in"]) + "." });
      }
      if (all != null && int(t.total, 500, 9000) != null && all !== t.total) checks.push({ where: where, msg: name + ": the holes add up to " + fmt(all) + ", but the card's total says " + fmt(t.total) + "." });
      unread += yards.filter(function (v) { return v == null; }).length;
      return tee;
    }).filter(function (t) { return t.yards.some(function (v) { return v != null; }); });
    var ps = sum(par, 0, n), pt = int(first(read.parTotal), 27, 80);
    if (ps != null && pt != null && ps !== pt) checks.push({ where: "par", msg: "The pars add up to " + ps + ", but the card says " + pt + "." });
    [["hcp", hcp, "handicap"], ["hcpWomen", hcpW, "women's handicap"]].forEach(function (x) {
      if (!x[1]) return;
      var seen = {}, bad = x[1].some(function (v) { if (v == null) return false; if (seen[v]) return true; seen[v] = 1; return false; });
      if (bad) checks.push({ where: x[0], msg: "A " + x[2] + " number appears twice. Each should appear once." });
      var holes = []; x[1].forEach(function (v, i) { if (v == null) holes.push(i + 1); });
      if (holes.length) checks.push({ where: x[0], msg: "The " + x[2] + " for hole" + (holes.length > 1 ? "s " : " ") + holes.join(", ") + " couldn't be read." });
    });
    unread += par.filter(function (v) { return v == null; }).length + hcp.filter(function (v) { return v == null; }).length;
    var course = {
      id: meta.id, name: meta.name, fullName: meta.fullName, place: meta.place, holes: n,
      par: par.map(function (v) { return v || 4; }), hcp: hcp, tees: tees,
      source: { kind: meta.kind || "photo", name: meta.label || "the card", dated: meta.dated || null, url: meta.url || undefined, read: true },
    };
    if (hcpW) course.hcpWomen = hcpW;
    ["apiId", "nearApiId", "website", "credit"].forEach(function (k2) { if (meta[k2]) course[k2] = meta[k2]; });
    if (par.some(function (v) { return v == null; })) checks.push({ where: "par", msg: "Some pars couldn't be read; they're set to 4 until you check them." });
    return { course: course, checks: checks, unread: unread };
  }

  // ---------- a 27-hole club's card cut into its nines (cardgrid.js), each a 9-hole card of its own ----------
  // Each piece: the card's row names (the first nine's label column) with that nine's holes and total beside them.
  // null when the grid isn't found or holds fewer than two nines.
  function ninePieces(dataUrl) {
    if (!window.NMCardGrid) return Promise.resolve(null);
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        var g = NMCardGrid.find(img);
        if (!g || g.nines.length < 2) return res(null);
        var W = img.naturalWidth, H = img.naturalHeight, lab = g.nines[0].label;
        var y0 = Math.max(0, Math.round(g.rows[0][0] * H) - 4), y1 = Math.min(H, Math.round(g.rows[g.rows.length - 1][1] * H) + 4);
        res(g.nines.map(function (n) {
          var parts = [lab, [n.holes[0][0], n.total[1]]].filter(Boolean).map(function (p) {
            return [Math.max(0, Math.round(p[0] * W) - 3), Math.min(W, Math.round(p[1] * W) + 3)];
          });
          var pw = parts.reduce(function (a, p) { return a + p[1] - p[0]; }, 0), k = Math.min(1, MAX / pw);
          var c = document.createElement("canvas");
          c.width = Math.round(pw * k); c.height = Math.round((y1 - y0) * k);
          var x = c.getContext("2d"), at = 0;
          x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
          parts.forEach(function (p) { x.drawImage(img, p[0], y0, p[1] - p[0], y1 - y0, at, 0, (p[1] - p[0]) * k, c.height); at += (p[1] - p[0]) * k; });
          return jpeg(c);
        }));
      };
      img.onerror = function () { res(null); };
      img.src = bigOf(dataUrl);
    });
  }
  // a piece's read (part "nine") in the shape fromNines() takes
  function asNine(r) {
    r = r || {};
    return { name: r.nine || null, par: r.par, parTotal: r.parOut, hcp: r.hcp, hcpWomen: r.hcpWomen,
      tees: (r.tees || []).map(function (t) { return { name: t.name, color: t.color, yards: t.yards, total: t.out }; }) };
  }

  // an 18-hole card read as its two nines (a long, thin card, Stone River's: shrunk whole, its numbers are too small to
  // read) -> one ordinary read: the front nine's tees with the back nine's beside them (by name, else row color);
  // handicaps as printed (they're already 1-18)
  function fromHalves(a, b) {
    if (!a || !b) return null;
    var low = function (v) { return String(v || "").toLowerCase().trim(); };
    var colorOf = function (t) { return low(t && t.color).split(/\s+/).pop(); };
    var tees = (a.tees || []).map(function (t) {
      var u = (b.tees || []).filter(function (x) { return low(x.name) && low(x.name) === low(t.name); })[0] ||
        (b.tees || []).filter(function (x) { return colorOf(x) && colorOf(x) === colorOf(t); })[0];
      if (!u) return null;
      var out = int(first(t.out), 100, 5000), inn = int(first(u.out), 100, 5000);
      return { name: t.name, color: t.color, rating: t.rating, slope: t.slope, yards: list(t.yards, 9, 30, 800).concat(list(u.yards, 9, 30, 800)),
        out: out, "in": inn, total: out != null && inn != null ? out + inn : null };
    }).filter(Boolean);
    var both = function (x, y) { return x && y && x.length && y.length ? list(x, 9, 0, 99).concat(list(y, 9, 0, 99)) : null; };
    var parOut = int(first(a.parOut), 27, 45), parIn = int(first(b.parOut), 27, 45);
    return { tees: tees, par: both(a.par, b.par), hcp: both(a.hcp, b.hcp), hcpWomen: both(a.hcpWomen, b.hcpWomen),
      parOut: parOut, parIn: parIn, parTotal: parOut != null && parIn != null ? parOut + parIn : null };
  }

  // ---------- a 27-hole club's card: the nines being played, as one ordinary read ----------
  // names: the nines played, in order ("Bear", "Elk"). Each nine ranks its handicaps on its own (1-9, or odd 1-17);
  // two played as an 18: the first takes the odd numbers and the second the even. The rating and slope come from the
  // card's table for that pair (either order), matched to each tee by its row color.
  // known (optional): what the course already has for each wanted nine, [{ par: [9], yards: [[9] per tee] }]. When it
  // has numbers, each nine on the card is matched by them (yardages and pars that agree): only one nine on the card
  // has Bear's yardages, whatever its faded name was read as (Breckenridge's names were misread three ways, 2026-10-12)
  function fromNines(read, names, others, known) {
    var nines = (read && read.nines) || [];
    var low = function (v) { return String(v || "").toLowerCase(); };
    // a nine's name as read (and x.alt, a second reading) against a wanted name: contained in it, or a word of it off
    // by a letter or two ("BEVER" is Beaver; Breckenridge's faded ELK was once read as "RIDGE", so a second reading helps)
    var near = function (a, b) {
      if (Math.abs(a.length - b.length) > 2) return false;
      var d = []; for (var i = 0; i <= a.length; i++) { d[i] = [i]; for (var j = 1; j <= b.length; j++) d[i][j] = i ? Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) : j; }
      return d[a.length][b.length] <= (b.length >= 5 ? 2 : 1);
    };
    // how well a nine's name (or its second reading, x.alt) fits a wanted name: an exact word best, then a word off by
    // a letter or two, then the name merely containing it; less for a name of several words (Breckenridge's first nine
    // was once named from the rating heading below it, "BEAVER / BEAR", and took Bear's place)
    var fit = function (x, nm) {
      var want = low(nm), best = 0;
      [x && x.name, x && x.alt].forEach(function (v) {
        var got = low(v), words = got.split(/[^a-z0-9]+/).filter(Boolean);
        if (!got) return;
        // a rating heading names the nine it sits under first ("BEAR / ELK" is under Bear): a later word counts less
        var at = words.indexOf(want), nearAt = -1;
        words.some(function (w, k) { if (near(w, want)) { nearAt = k; return true; } return false; });
        var sc = at === 0 ? 3 : at > 0 ? 2.2 : nearAt === 0 ? 2 : nearAt > 0 ? 1.4 : got.indexOf(want) >= 0 ? 1 : 0;
        if (sc) best = Math.max(best, sc - 0.5 * (words.length - 1));
      });
      return best;
    };
    var is = function (x, nm) { return fit(x, nm) > 0; };
    // by numbers: how many of a nine's yardages and pars agree with what the course has for a wanted nine
    var byNumbers = function (x, k) {
      var kn = known && known[k];
      if (!x || !kn) return 0;
      var agree = 0, cells = 0, got = {};
      (x.tees || []).forEach(function (t) { list(t.yards, 9, 30, 800).forEach(function (v, i) { if (v != null) got[i + ":" + v] = 1; }); });
      (kn.yards || []).forEach(function (ys) { (ys || []).forEach(function (v, i) { if (v != null) { cells++; if (got[i + ":" + v]) agree++; } }); });
      var par = list(x.par, 9, 3, 6);
      (kn.par || []).forEach(function (v, i) { if (v != null) { cells++; if (par[i] === v) agree++; } });
      return cells ? agree / cells : 0;
    };
    // every (wanted name, nine) pair by how well it fits, the best taken first, each nine used once: by numbers when
    // the course has them (a clear match: over half its numbers agree), else by name
    var pairs = [];
    names.forEach(function (nm, ni) { nines.forEach(function (x, xi) {
      var num = byNumbers(x, ni), f = num > 0.5 ? 10 + num : x ? fit(x, nm) : 0;
      if (f > 0) pairs.push([f, ni, xi]);
    }); });
    pairs.sort(function (a, b) { return b[0] - a[0] || a[2] - b[2]; });
    var used = [], pick = names.map(function () { return null; });
    pairs.forEach(function (pr) {
      if (pick[pr[1]] || used.indexOf(nines[pr[2]]) >= 0) return;
      pick[pr[1]] = nines[pr[2]];
      used.push(nines[pr[2]]);
    });
    // unnamed or unreadable: by position when the count fits, else the one nine left when only one is missing
    if (pick.some(function (x) { return !x; })) {
      if (nines.length === names.length) pick = pick.map(function (x, i) { return x || (used.indexOf(nines[i]) < 0 ? nines[i] : null); });
      // ruling out the club's other nines ("BEVER" is Beaver, not played), when the course knows them
      var left = nines.filter(function (x) {
        return x && used.indexOf(x) < 0 && !(others || []).some(function (o) { return names.indexOf(o) < 0 && is(x, o); });
      });
      var missing = pick.filter(function (x) { return !x; }).length;
      if (missing === 1 && left.length === 1) pick = pick.map(function (x) { return x || left[0]; });
    }
    if (pick.some(function (x) { return !x; })) return null;
    var picked = pick.map(function (x) { return nines.indexOf(x); }); // which of the card's nines, left to right
    var rank = function (h, odd) {
      h = list(h, 9, 1, 18);
      if (h.some(function (v) { return v == null; })) return h;
      if (pick.length === 1) return h;
      var order = h.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return x[0] - y[0]; }), out = Array(9);
      order.forEach(function (o, r) { out[o[1]] = 2 * r + (odd ? 1 : 2); });
      return out;
    };
    var a = pick[0], b = pick[1];
    var tabs = (read.ratings || []).filter(function (r) {
      return names.length === 2 && names.every(function (nm) { return low(r && r.nines).indexOf(low(nm)) >= 0; });
    })[0];
    var colorOf = function (t) { return low(t && t.color).split(/\s+/).pop(); };
    var tees = (a.tees || []).map(function (t) {
      var out = { name: t.name, color: t.color, yards: list(t.yards, 9, 30, 800), out: int(t.total, 100, 5000), rating: null, slope: null };
      if (b) {
        var u = (b.tees || []).filter(function (x) { return low(x.name) === low(t.name); })[0] ||
          (b.tees || []).filter(function (x) { return colorOf(x) === colorOf(t); })[0];
        if (!u) return null;
        out.yards = out.yards.concat(list(u.yards, 9, 30, 800));
        out["in"] = int(u.total, 100, 5000);
        out.total = out.out != null && out["in"] != null ? out.out + out["in"] : null;
      } else out.total = out.out;
      if (tabs) {
        var women = /^(red|forward|ladies|lady|women)/i.test(t.name || "");
        var rows = (tabs.tees || []).filter(function (r) { return colorOf(r) === colorOf(t); });
        var row = rows.filter(function (r) { return !!r.women === women; })[0] || rows[0];
        if (row) { out.rating = num(row.rating, 50, 90); out.slope = int(row.slope, 55, 155); }
      }
      return out;
    }).filter(Boolean);
    var res = { tees: tees, par: list(a.par, 9, 3, 6), hcp: rank(a.hcp, true), parOut: int(first(a.parTotal), 27, 45) };
    var wa = a.hcpWomen && a.hcpWomen.length ? rank(a.hcpWomen, true) : null;
    if (b) {
      res.par = res.par.concat(list(b.par, 9, 3, 6));
      res.hcp = res.hcp.concat(rank(b.hcp, false));
      res.parIn = int(first(b.parTotal), 27, 45);
      res.parTotal = res.parOut != null && res.parIn != null ? res.parOut + res.parIn : null;
      var wb = b.hcpWomen && b.hcpWomen.length ? rank(b.hcpWomen, false) : null;
      res.hcpWomen = wa && wb ? wa.concat(wb) : null;
    } else {
      res.parTotal = res.parOut;
      res.hcpWomen = wa;
    }
    res.picked = picked;
    res.count = nines.length;
    return res;
  }

  window.NMCardRead = { fromHalves: fromHalves, ninePieces: ninePieces, asNine: asNine, bigOf: bigOf, textOf: textOf, fromNines: fromNines, fromFile: fromFile, half: half, closeUps: closeUps, mergeCloseUp: mergeCloseUp, toCourse: toCourse, slug: slug };
})();
