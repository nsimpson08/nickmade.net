// Scorecard: finds the boxes on a picture of a course's real scorecard, so a round can be written straight onto it
// (card.js draws the card's own picture with the scores in its blank rows). No AI: the card's ruled lines.
//   - row lines: thin rules (dark on light or light on dark) and the edges where two colored rows meet, kept when one
//     runs unbroken across a quarter of the card (allowing a slight tilt); drawings and digits only make short pieces
//   - column lines: thin rules that fill nearly the whole height of most rows (a digit fills about half of one)
//   - the hole columns: runs of nine (or more) columns of the same width; a nine's total is the column after it
//   - the rows a player writes in: rows whose hole cells are blank and light
//
//   NMCardGrid.find(img) -> null | { w, h, nines: [{ holes: [[x0, x1] x 9], total: [x0, x1], after: [x0, x1] | null,
//                                     label: [x0, x1] | null }], rows: [[y0, y1]], blank: [[row indexes] per nine] }
//   all as fractions of the picture's width and height
(function () {
  // worked on at the picture's own size up to 4800 px wide, shrunk by halves (shrinking fades a card's 1-pixel rules:
  // Holiday Hills' 6944 px scan lost 4 of its 16 row lines at 2400 in one step)
  function gray(img) {
    var W = Math.min(4800, img.naturalWidth), k = W / img.naturalWidth, h = Math.round(img.naturalHeight * k);
    var step = img, sw = img.naturalWidth, sh = img.naturalHeight;
    while (sw * 0.5 > W) {
      var t = document.createElement("canvas");
      t.width = Math.round(sw * 0.5); t.height = Math.round(sh * 0.5);
      var tx = t.getContext("2d");
      tx.imageSmoothingQuality = "high";
      tx.drawImage(step, 0, 0, t.width, t.height);
      step = t; sw = t.width; sh = t.height;
    }
    var c = document.createElement("canvas");
    c.width = W; c.height = h;
    var x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(step, 0, 0, W, h);
    var d = x.getImageData(0, 0, W, h).data, g = new Float32Array(W * h), rgb = d;
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return { g: g, rgb: rgb, w: W, h: h };
  }

  // a line at (x, y) across direction (dx, dy): a thin rule (sharply unlike both sides, which are alike), or the edge
  // where two rows of different colors meet (gold over blue has no rule between them)
  function lineMap(im, dx, dy, edges) {
    var w = im.w, h = im.h, g = im.g, out = new Uint8Array(w * h), D = 3, step = dy * w + dx;
    for (var y = D; y < h - D; y++) for (var x = D; x < w - D; x++) {
      var i = y * w + x, a = g[i - step * D], b = g[i + step * D], v = g[i];
      if (Math.abs(a - b) < 28 ? Math.abs(v - (a + b) / 2) > 32 : edges && Math.abs(g[i - step] - g[i + step]) > 45 && Math.abs(a - b) > 45) out[i] = 1;
    }
    return out;
  }

  // each line's longest unbroken stretch: along rows (horizontal) or columns (vertical), a pixel counting when the map
  // has a line pixel within 2 of it across the line (a slightly tilted photo), gaps of up to 6 pixels bridged. Drawings
  // and digits make many short pieces; a grid's rules run on
  function longest(map, w, h, horizontal, from, to) {
    var n = horizontal ? h : w, len = horizontal ? w : h, out = new Float32Array(n);
    var lo = from || 0, hi = to == null ? len - 1 : to;
    for (var a = 2; a < n - 2; a++) {
      var best = 0, run = 0, gap = 0;
      for (var b = lo; b <= hi; b++) {
        var on = 0;
        for (var k = -2; k <= 2 && !on; k++) on = horizontal ? map[(a + k) * w + b] : map[b * w + a + k];
        if (on) { run += gap + 1; gap = 0; if (run > best) best = run; }
        else if (run && ++gap > 6) { run = 0; gap = 0; }
      }
      out[a] = best;
    }
    return out;
  }

  // peaks in a profile: runs above the cut, each reported at its middle
  function peaks(p, cut, minGap) {
    var out = [], s = -1;
    for (var i = 0; i <= p.length; i++) {
      var on = i < p.length && p[i] >= cut;
      if (on && s < 0) s = i;
      if (!on && s >= 0) { out.push((s + i - 1) / 2); s = -1; }
    }
    return out.reduce(function (a, v) { if (a.length && v - a[a.length - 1] < minGap) a[a.length - 1] = (a[a.length - 1] + v) / 2; else a.push(v); return a; }, []);
  }
  function find(img) {
    var im = gray(img), w = im.w, h = im.h;
    // horizontal lines: a rule or a row's colored edge running a quarter of the width or more
    var hm = lineMap(im, 0, 1, true);
    var hp = longest(hm, w, h, true);
    var ys = peaks(hp, w * 0.15, 6);
    if (ys.length < 6) return null;
    // the grid's height: from the first to the last of those lines
    var gy0 = Math.round(ys[0]), gy1 = Math.round(ys[ys.length - 1]);
    // vertical lines: checked row by row. A rule fills nearly the whole height of each row it crosses; a digit about
    // half of one. A rule that fades in some rows (white on a pale tan row) or stops at a black Par row still fills
    // most of the others
    var vm = lineMap(im, 1, 0, true), bands = [];
    for (var bi = 0; bi < ys.length - 1; bi++) if (ys[bi + 1] - ys[bi] > h * 0.012) bands.push([Math.round(ys[bi]) + 2, Math.round(ys[bi + 1]) - 2]);
    var colP = new Float32Array(w);
    for (var x2 = 2; x2 < w - 2; x2++) {
      var full = 0;
      bands.forEach(function (bd) {
        var on = 0;
        for (var y2 = bd[0]; y2 <= bd[1]; y2++) {
          var o = y2 * w + x2;
          if (vm[o] || vm[o - 1] || vm[o + 1] || vm[o - 2] || vm[o + 2]) on++;
        }
        if (on >= (bd[1] - bd[0] + 1) * 0.8) full++;
      });
      colP[x2] = full / Math.max(1, bands.length);
    }
    var xs = peaks(colP, 0.3, 6);
    if (xs.length < 10) return null;

    // columns, less any the row lines don't cross (a "Players Initials" / "INITIAL" column down the middle): those
    // break a run of hole columns
    var cols = [], drift = Math.max(3, Math.round(w / 700));
    for (var i = 0; i < xs.length - 1; i++) {
      var c0 = Math.round(xs[i] + (xs[i + 1] - xs[i]) * 0.3), c1 = Math.round(xs[i + 1] - (xs[i + 1] - xs[i]) * 0.3), crossed = 0;
      ys.forEach(function (ly) {
        var yy = Math.round(ly), on = 0;
        // within a few rows of the line's middle (3 at 2400 px wide, more on a bigger working copy): a scan a little
        // crooked drifts that much across the card
        for (var cx = c0; cx <= c1; cx++) {
          var hit = 0;
          for (var dy = -drift; dy <= drift && !hit; dy++) hit = hm[(yy + dy) * w + cx] || 0;
          on += hit;
        }
        if (on > (c1 - c0 + 1) * 0.6) crossed++;
      });
      cols.push([xs[i], xs[i + 1], crossed / ys.length]);
    }
    var crossMed = cols.map(function (c) { return c[2]; }).sort(function (a, b) { return a - b; })[cols.length >> 1];
    var wid = function (c) { return c[1] - c[0]; };
    var nines = [], i2 = 0;
    while (i2 < cols.length) {
      var run = [cols[i2]], med = wid(cols[i2]);
      if (cols[i2][2] < crossMed * 0.5) { i2++; continue; }
      for (var j = i2 + 1; j < cols.length && Math.abs(wid(cols[j]) - med) <= med * 0.16 && cols[j][2] >= crossMed * 0.5; j++) {
        run.push(cols[j]);
        med = run.map(wid).sort(function (a, b) { return a - b; })[run.length >> 1];
      }
      // a "PLAYER" or "INITIAL" column the same width as a hole, just before hole 1 or 10: fewer of the row lines cross
      // it than cross the holes
      // ... but never the column right after the card's label column (its first wide column): that's hole 1 (Branson
      // Hills' hole 1 is crossed a little less, beside its rating column, and was dropped, shifting every score)
      var runCross = run.map(function (c) { return c[2]; }).sort(function (a, b) { return a - b; })[run.length >> 1];
      var afterLabels = i2 > 0 && wid(cols[i2 - 1]) > med * 1.6 && cols.slice(0, i2 - 1).every(function (c) { return wid(c) <= med * 1.6; });
      while (!afterLabels && run.length > 9 && run[0][2] < runCross * 0.85) { run.shift(); i2++; }
      if (run.length >= 9 && med > 14) {
        // nine holes, then that nine's total (Out / In / TOT 9), and again for a second nine in the same run
        var k = 0;
        while (k + 9 <= run.length) {
          var at = i2 + k, holes = cols.slice(at, at + 9);
          var total = cols[at + 9] || null, after = cols[at + 10] || null;
          var label = at > 0 && wid(cols[at - 1]) > med * 1.6 ? cols[at - 1] : null;
          if (!total) break;
          // a card with no rule down its outer edges (a table on a website): the label column runs from the edge to
          // the first hole, and the round's total column (Total) from the last line to the edge, when there's room
          if (!label && at === 0 && holes[0][0] > med * 1.6) label = [2, holes[0][0]];
          if (!after && w - total[1] > med * 0.8) after = [total[1], Math.min(w - 2, total[1] + Math.max(wid(total), med))];
          nines.push({ holes: holes, total: total, after: after, label: label, next: cols[at + 11] || null });
          k += 10;
          if (run[k] && cols[i2 + k] && Math.abs(wid(cols[i2 + k]) - med) > med * 0.16) break;
          // a divider column ("Players Initials") between the nines is a different width: the run carries on after it
        }
        i2 += Math.max(run.length, 1);
      } else i2++;
    }
    // a front and back nine split by a divider column of another width: the second run's nine is already found above
    if (!nines.length) return null;
    // a back nine's "In, Out, Tot" (Stone River): the column after In repeats the front's Out, so the round's total
    // goes in the one after that. A repeat: the two columns' pixels, down the grid, nearly the same
    var same = function (a, b) {
      var n = 0, diff = 0, aw = wid(a), bw = wid(b);
      for (var yy = gy0; yy <= gy1; yy += 2) for (var f = 0.15; f <= 0.85; f += 0.07) {
        diff += Math.abs(im.g[yy * w + Math.round(a[0] + aw * f)] - im.g[yy * w + Math.round(b[0] + bw * f)]); n++;
      }
      return n && diff / n < 10;
    };
    for (var q = 1; q < nines.length; q++) {
      var bk = nines[q], fr = nines[q - 1];
      if (bk.after && bk.next && fr.total && Math.abs(wid(bk.after) - wid(fr.total)) < wid(fr.total) * 0.2 && same(bk.after, fr.total)) bk.after = bk.next;
    }

    // rows, and which of them are blank and light across a nine's hole cells (the rows a player writes in)
    var rows = [];
    for (var r = 0; r < ys.length - 1; r++) if (ys[r + 1] - ys[r] > h * 0.02) rows.push([ys[r], ys[r + 1]]);
    var rowMed = rows.map(function (r3) { return r3[1] - r3[0]; }).sort(function (a, b) { return a - b; })[rows.length >> 1];
    // a row two or three times the usual height is rows whose line wasn't seen (Breckenridge: the faint line under its
    // tan Handicap row hid the first blank row, so the round spilled below Par): split it into equal rows
    rows = rows.reduce(function (out, r4) {
      var k = Math.round((r4[1] - r4[0]) / rowMed);
      if (k < 2 || k > 3 || (r4[1] - r4[0]) / rowMed < 1.75) { out.push(r4); return out; }
      for (var q = 0; q < k; q++) out.push([r4[0] + (r4[1] - r4[0]) * q / k, r4[0] + (r4[1] - r4[0]) * (q + 1) / k]);
      return out;
    }, []);
    var blank = nines.map(function (nine) {
      return rows.map(function (row, ri) {
        var ink = 0, all = 0, light = 0;
        nine.holes.forEach(function (c) {
          var x0 = Math.round(c[0] + wid(c) * 0.2), x1 = Math.round(c[1] - wid(c) * 0.2);
          var y0 = Math.round(row[0] + (row[1] - row[0]) * 0.22), y1 = Math.round(row[1] - (row[1] - row[0]) * 0.22);
          var vals = [];
          for (var yy = y0; yy <= y1; yy += 2) for (var xx = x0; xx <= x1; xx += 2) vals.push(im.g[yy * w + xx]);
          vals.sort(function (a, b) { return a - b; });
          var mid = vals[vals.length >> 1];
          vals.forEach(function (v) { all++; if (Math.abs(v - mid) > 70) ink++; });
          if (mid > 150) light++;
        });
        return all && ink / all < 0.02 && light >= 7 && row[1] - row[0] > rowMed * 0.7 ? ri : -1;
      }).filter(function (ri) { return ri >= 0; });
    });
    // a row to write in is blank on every nine (half of a two-number row can look blank on one)
    var everywhere = blank[0].filter(function (ri) { return blank.every(function (b) { return b.indexOf(ri) >= 0; }); });
    // less any whose label box has something printed in it (Pecan Hollow's "+/-" row): it's for something else
    var lab = nines.map(function (n) { return n.label; }).filter(Boolean)[0];
    if (lab) everywhere = everywhere.filter(function (ri) {
      var row = rows[ri], x0 = Math.round(lab[0] + wid(lab) * 0.06), x1 = Math.round(lab[1] - wid(lab) * 0.06);
      var y0 = Math.round(row[0] + (row[1] - row[0]) * 0.22), y1 = Math.round(row[1] - (row[1] - row[0]) * 0.22), vals = [];
      for (var yy = y0; yy <= y1; yy += 2) for (var xx = x0; xx <= x1; xx += 2) vals.push(im.g[yy * w + xx]);
      vals.sort(function (a, b) { return a - b; });
      var mid = vals[vals.length >> 1], ink = vals.filter(function (v) { return Math.abs(v - mid) > 70; }).length;
      return ink / vals.length < 0.01;
    });
    blank = blank.map(function () { return everywhere; });
    var fx = function (c) { return c ? [c[0] / w, c[1] / w] : null; };
    return {
      w: img.naturalWidth, h: img.naturalHeight,
      nines: nines.map(function (n) { return { holes: n.holes.map(fx), total: fx(n.total), after: fx(n.after), label: fx(n.label) }; }),
      rows: rows.map(function (r2) { return [r2[0] / h, r2[1] / h]; }),
      blank: blank,
    };
  }

  window.NMCardGrid = { find: find };
})();
