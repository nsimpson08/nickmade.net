// The Cattery v1.0 (released with the site's Ver 1.6): one shared pixel-art room where every visitor's cat lives (catdraw.js draws the cats; the
// Worker, worker/src/cats.js, keeps them, how they get on, and the history). Make a cat in the Cat Maker and it moves
// in; only you can feed it, pet it, play with it, send it up a tower or a shelf, or have it go and meet another cat.
// The rest happens by itself: every 4 hours the Worker runs a few rounds of cat life, and the page shows how it's all
// going: best friends, crushes, couples, rivals, cliques, and everything that happened in the History.
//
// How it's drawn: the room is boxes in room units, like Nick's Office (office.js, whose box drawing this reuses), but
// at the cats' finer scale and drawn only when it changes (turning the room, the sky in the window), into a buffer
// that also keeps each pixel's depth and height. Each frame the cats are drawn over a copy of it, back to front, each
// pixel of a cat hidden where something in the room stands in front of it (a tower's post, the side of a box it sits
// in, the rim of its bed).
(function () {
  "use strict";
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CD = window.CatDraw;
  var SEASON_PREVIEW = (location.search.match(/[?&]season=(\w+)/) || [])[1]; // ?season=halloween|winter|spring|none (see season())

  // ---------- who's looking ----------
  // the random id this browser keeps (the same one the Movies and Games queues use)
  function visitorId() {
    var id = null;
    try { id = localStorage.getItem("nm-visitor"); } catch (e) {}
    if (!id) { var m = document.cookie.match(/(?:^|; )nm_visitor=([^;]+)/); id = m ? m[1] : null; }
    if (!id) id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    try { localStorage.setItem("nm-visitor", id); } catch (e) {}
    document.cookie = "nm_visitor=" + id + "; max-age=31536000; path=/; SameSite=Lax";
    return id;
  }
  var VID = visitorId();
  var ADMIN = null;
  try { ADMIN = localStorage.getItem("nm-admin-token"); } catch (e) {}
  function headers(json) {
    var h = {};
    if (json) h["Content-Type"] = "application/json";
    if (ADMIN) h.Authorization = "Bearer " + ADMIN;
    return h;
  }

  // ---------- the canvas ----------
  var X = 600, Y = 440, WALL = 300, WT = 8, SLAB = 10, M = 14; // room size, wall height and thickness, slab, margin
  var CW = X + Y + 2 * WT + 2 * M, CH = M + WALL + WT + (X + Y) / 2 + SLAB + M + 4;
  var canvas = document.getElementById("room");
  var ctx = canvas.getContext("2d");
  var stage = document.querySelector(".cats-stage");
  canvas.width = CW;
  canvas.height = CH;
  var img = ctx.createImageData(CW, CH);
  var out = new Uint32Array(img.data.buffer);
  var bg = new Uint32Array(CW * CH); // the room without cats
  var depth = new Int16Array(CW * CH); // how near each pixel of the room is (view x + y)
  var zat = new Int16Array(CW * CH); // ...and how high
  var ids = new Int16Array(CW * CH);

  // ---------- colour ----------
  var cache = {};
  function H(hex) {
    var c = cache[hex];
    if (c === undefined) { var n = parseInt(hex.slice(1), 16); c = cache[hex] = (255 << 24 | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0; }
    return c;
  }
  function shade(c, k) {
    if (k === 1) return c;
    var r = Math.min(255, (c & 255) * k), g = Math.min(255, (c >> 8 & 255) * k), b = Math.min(255, (c >> 16 & 255) * k);
    return (255 << 24 | b << 16 | g << 8 | r) >>> 0;
  }
  function mix(c, d, a) {
    var r = (c & 255) * (1 - a) + (d & 255) * a, g = (c >> 8 & 255) * (1 - a) + (d >> 8 & 255) * a, b = (c >> 16 & 255) * (1 - a) + (d >> 16 & 255) * a;
    return (255 << 24 | b << 16 | g << 8 | r) >>> 0;
  }
  function hash(a, b) { var h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  // ---------- turning the room ----------
  var rot = 0;
  function dims() { return rot % 2 ? [Y, X] : [X, Y]; }
  function vcell(x, y) {
    switch (rot) {
      case 0: return [x, y];
      case 1: return [y, X - 1 - x];
      case 2: return [X - 1 - x, Y - 1 - y];
      default: return [Y - 1 - y, x];
    }
  }
  function vpos(x, y) { // the same for a point anywhere (a cat between cells)
    switch (rot) {
      case 0: return [x, y];
      case 1: return [y, X - x];
      case 2: return [X - x, Y - y];
      default: return [Y - y, x];
    }
  }
  var FACE_VX = ["px", "py", "nx", "ny"], FACE_VY = ["py", "nx", "ny", "px"];
  function faceOf(which) { return which === "vy" ? FACE_VY[rot] : FACE_VX[rot]; }
  var OX = 0, OY = M + WALL + WT;
  function origin() { OX = M + WT + dims()[1]; }
  function project(x, y, z) { var v = vpos(x, y); return { sx: OX + v[0] - v[1], sy: OY + (v[0] + v[1]) / 2 - z, d: v[0] + v[1] }; }

  // ---------- drawing boxes (as in office.js, plus each pixel's depth and height) ----------
  var cur = null;
  function put(sx, sy, c, d, z) {
    if (sx < 0 || sy < 0 || sx >= CW || sy >= CH) return;
    var i = sy * CW + sx;
    bg[i] = c; ids[i] = cur.n; depth[i] = d; zat[i] = z;
  }
  function facePen(b, vb, which, k) {
    var vy = which === "vy";
    var face = faceOf(which);
    var w = vy ? vb.vx1 - vb.vx0 : vb.vy1 - vb.vy0, h = b.z1 - b.z0;
    var alongX = face === "py" || face === "ny";
    function uOf(a) { var c = alongX ? vcell(a, b.y0) : vcell(b.x0, a); return vy ? c[0] - vb.vx0 : vb.vy1 - 1 - c[1]; }
    var pen = {
      w: w, h: h, face: face, box: b,
      set: function (u, v, col) {
        u = Math.round(u); v = Math.round(v);
        if (u < 0 || v < 0 || u >= w || v >= h || col == null) return;
        var c = typeof col === "number" ? col : H(col);
        c = shade(c, k);
        var z = b.z0 + v, sx, sy, d;
        if (vy) { var vx = vb.vx0 + u, r = vb.vy1 - 1; sx = OX + vx - r; sy = OY + Math.floor((vx + r) / 2) - z; d = vx + r; }
        else { var vyy = vb.vy1 - 1 - u, cc = vb.vx1 - 1; sx = OX + cc - vyy; sy = OY + Math.floor((cc + vyy) / 2) - z; d = cc + vyy; }
        put(sx, sy, c, d, z);
      },
      rect: function (u, v, rw, rh, col) { for (var j = 0; j < rh; j++) for (var i = 0; i < rw; i++) pen.set(u + i, v + j, col); },
      setW: function (a, z, col) { pen.set(uOf(a), z - b.z0, col); },
      // the screen pixel a wall point lands on (-1 if off the canvas), for things animated over the room later
      idxW: function (a, z) {
        var u = Math.round(uOf(a)), v = Math.round(z - b.z0), sx, sy;
        if (u < 0 || v < 0 || u >= w || v >= h) return -1;
        if (vy) { var vx = vb.vx0 + u, r = vb.vy1 - 1; sx = OX + vx - r; sy = OY + Math.floor((vx + r) / 2) - (b.z0 + v); }
        else { var vyy = vb.vy1 - 1 - u, cc = vb.vx1 - 1; sx = OX + cc - vyy; sy = OY + Math.floor((cc + vyy) / 2) - (b.z0 + v); }
        return sx < 0 || sy < 0 || sx >= CW || sy >= CH ? -1 : sy * CW + sx;
      },
      k: k,
      rectW: function (a0, a1, z0, z1, col) { for (var z = z0; z < z1; z++) for (var a = a0; a < a1; a++) pen.setW(a, z, col); },
      eachW: function (a0, a1, z0, z1, fn) { for (var z = z0; z < z1; z++) for (var a = a0; a < a1; a++) { var c = fn(a, z); if (c) pen.setW(a, z, c); } },
      each: function (fn) { for (var v = 0; v < h; v++) for (var u = 0; u < w; u++) { var c = fn(u, v); if (c) pen.set(u, v, c); } },
    };
    return pen;
  }
  function topPen(b) {
    var pen = {
      top: true, box: b,
      set: function (x, y, col) {
        x = Math.round(x); y = Math.round(y);
        if (x < b.x0 || y < b.y0 || x >= b.x1 || y >= b.y1 || col == null) return;
        var c = vcell(x, y);
        put(OX + c[0] - c[1], OY + Math.floor((c[0] + c[1]) / 2) - b.z1, typeof col === "number" ? col : H(col), c[0] + c[1], b.z1);
      },
      each: function (fn) { for (var y = b.y0; y < b.y1; y++) for (var x = b.x0; x < b.x1; x++) { var c = fn(x, y); if (c) pen.set(x, y, c); } },
    };
    return pen;
  }
  function viewBox(b) {
    var a = vcell(b.x0, b.y0), c = vcell(b.x1 - 1, b.y1 - 1);
    return { vx0: Math.min(a[0], c[0]), vx1: Math.max(a[0], c[0]) + 1, vy0: Math.min(a[1], c[1]), vy1: Math.max(a[1], c[1]) + 1, z0: b.z0, z1: b.z1 };
  }
  function drawBox(b) {
    var vb = b.vb;
    cur = b;
    var base = b.c == null ? null : H(b.c), k = b.k || [0.86, 0.7];
    ["vx", "vy"].forEach(function (which) {
      var pen = facePen(b, vb, which, which === "vy" ? k[0] : k[1]);
      if (base != null) for (var v = 0; v < pen.h; v++) for (var u = 0; u < pen.w; u++) pen.set(u, v, base);
      var p = b.paint && (b.paint[pen.face] || b.paint.side);
      if (p) p.call(b, pen);
    });
    var tp = topPen(b);
    if (base != null) { var tc = b.topc ? H(b.topc) : base; for (var y = b.y0; y < b.y1; y++) for (var x = b.x0; x < b.x1; x++) tp.set(x, y, tc); }
    if (b.paint && b.paint.top) b.paint.top.call(b, tp);
  }
  function sortBoxes(list) {
    list.forEach(function (b) {
      var vb = b.vb = viewBox(b);
      b.sx0 = vb.vx0 - vb.vy1; b.sx1 = vb.vx1 - vb.vy0;
      b.sy0 = Math.floor((vb.vx0 + vb.vy0) / 2) - vb.z1; b.sy1 = Math.floor((vb.vx1 + vb.vy1) / 2) - vb.z0;
    });
    var n = list.length, after = [], deg = new Array(n).fill(0), i, j;
    for (i = 0; i < n; i++) after.push([]);
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var a = list[i], b = list[j];
      if (a.sx1 <= b.sx0 || b.sx1 <= a.sx0 || a.sy1 <= b.sy0 || b.sy1 <= a.sy0) continue;
      var A = a.vb, B = b.vb, aFirst;
      if (A.vx1 <= B.vx0 || A.vy1 <= B.vy0 || A.z1 <= B.z0) aFirst = true;
      else if (B.vx1 <= A.vx0 || B.vy1 <= A.vy0 || B.z1 <= A.z0) aFirst = false;
      else aFirst = A.vx0 + A.vy0 + A.z0 <= B.vx0 + B.vy0 + B.z0;
      if (aFirst) { after[i].push(j); deg[j]++; } else { after[j].push(i); deg[i]++; }
    }
    var res = [], q = [];
    for (i = 0; i < n; i++) if (!deg[i]) q.push(i);
    while (q.length) { var k = q.shift(); res.push(list[k]); after[k].forEach(function (m) { if (!--deg[m]) q.push(m); }); }
    if (res.length < n) list.forEach(function (bx) { if (res.indexOf(bx) < 0) res.push(bx); });
    return res;
  }

  // ---------- the room, as boxes ----------
  var boxes = [];
  function box(x0, x1, y0, y1, z0, z1, c, o) {
    var b = { x0: x0, x1: x1, y0: y0, y1: y1, z0: z0, z1: z1, c: c };
    for (var key in o) b[key] = o[key];
    b.n = boxes.length;
    boxes.push(b);
    return b;
  }
  // the walls: cream wallpaper over wood panelling, with a rail between
  function wallPaint(pen) {
    var w = pen.w;
    for (var u = 0; u < w; u++) for (var v = 0; v < pen.h; v++) {
      var c;
      if (v < 6) c = v < 2 ? "#5a4130" : "#6b4c37"; // skirting
      else if (v < 92) c = (u % 22 === 0) ? "#7d5a40" : (u % 22 === 1 ? "#a77e5c" : (hash(u >> 1, v >> 3) < 0.08 ? "#8c6649" : "#956d4f")); // panelling
      else if (v < 98) c = v === 92 || v === 97 ? "#6b4c37" : "#c99c74"; // the rail
      else c = ((u + 9) % 24 < 2 && (v + 6) % 24 < 2) ? "#e1cfb2" : (hash(u, v) < 0.02 ? "#e6d6bc" : "#efe2cb"); // wallpaper
      pen.set(u, v, c);
    }
  }
  var WALLTOP = "#d9cbb4";
  function wallBox(name, x0, x1, y0, y1, paint) {
    return box(x0, x1, y0, y1, 0, WALL, "#efe2cb", { wall: name, structural: true, topc: WALLTOP, k: [0.97, 0.86], paint: paint });
  }
  // the window (on the window wall, y 150-280, z 130-262): the sky by the time of day
  var WIN = { y0: 150, y1: 280, z0: 130, z1: 262 };
  function skyAt(t, z, a) {
    var hr = t.getHours() + t.getMinutes() / 60, f = (z - WIN.z0) / (WIN.z1 - WIN.z0);
    var night = hr < 6 || hr >= 20.5, dusk = (hr >= 18 && hr < 20.5) || (hr >= 6 && hr < 7.5);
    if (night) {
      if (hash(a * 7 + 1, z * 13) < 0.012) return "#f4f0d8"; // stars
      var mz = WIN.z1 - 28, ma = WIN.y0 + 38;
      var dm = Math.hypot(a - ma, (z - mz) * 1.0);
      if (dm < 9) return dm < 9 && Math.hypot(a - ma - 4, z - mz - 2) > 8 ? "#f3ecc6" : null;
      return f > 0.5 ? "#141c38" : "#1d2a4c";
    }
    if (dusk) return f > 0.66 ? "#5a4b8a" : f > 0.33 ? "#d4728a" : "#f2a65a";
    // day: blue, paler toward the bottom, a couple of clouds drifting by
    var drift = (t.getTime() / 60000) % 400;
    var cl = Math.sin((a + drift) / 13) + Math.sin((a * 0.6 - drift) / 7) + Math.cos(z / 6);
    if (f > 0.55 && cl > 2.1) return "#ffffff";
    if (f > 0.55 && cl > 1.75) return "#e4f0fa";
    return f > 0.7 ? "#79b3e4" : f > 0.4 ? "#94c5ec" : "#b7daf4";
  }
  // the window's sky pixels as drawn: { i (screen pixel), a, z, k (the wall's shading) }, for the storm and sunbeam
  var WINPIX = [], WIN_N = -1;
  function windowPaint(pen) {
    wallPaint(pen);
    WINPIX = []; WIN_N = pen.box.n;
    var t = new Date();
    pen.eachW(WIN.y0 - 6, WIN.y1 + 6, WIN.z0 - 8, WIN.z1 + 6, function (a, z) {
      var inX = a >= WIN.y0 && a < WIN.y1, inZ = z >= WIN.z0 && z < WIN.z1;
      if (!inX || !inZ) return z < WIN.z0 - 2 ? "#e8e2d6" : "#f6f3ec"; // the frame (and the sill below)
      var mid = (WIN.y0 + WIN.y1) / 2;
      if (Math.abs(a - mid) < 2 || Math.abs(z - (WIN.z0 + WIN.z1) / 2) < 2) return "#f6f3ec"; // the muntins
      // a tree outside, lower left
      var tx = a - (WIN.y0 + 24), tz = z - WIN.z0;
      if (tx > -4 && tx < 4 && tz < 40) return "#4c3628";
      if (Math.hypot(tx * 0.9, (tz - 52) * 1.1) < 26 + Math.sin(a * 1.7) * 2.5 + Math.cos(z) * 2) return hash(a, z) < 0.3 ? "#3f7a3a" : "#4f8f45";
      var c = skyAt(t, z, a), at = pen.idxW(a, z);
      if (at >= 0) WINPIX.push({ i: at, a: a, z: z, k: pen.k });
      return c || "#1d2a4c";
    });
    // the curtains, tied back either side
    pen.eachW(WIN.y0 - 22, WIN.y0 - 4, WIN.z0 - 14, WIN.z1 + 14, function (a, z) { return (a + z) % 5 ? "#b8574c" : "#a24c43"; });
    pen.eachW(WIN.y1 + 4, WIN.y1 + 22, WIN.z0 - 14, WIN.z1 + 14, function (a, z) { return (a + z) % 5 ? "#b8574c" : "#a24c43"; });
    pen.rectW(WIN.y0 - 28, WIN.y1 + 28, WIN.z1 + 14, WIN.z1 + 18, "#3a3a40"); // the rod
    // a painting of a fish, left of the window
    pen.eachW(40, 120, 158, 222, function (a, z) {
      if (a < 44 || a > 115 || z < 162 || z > 217) return "#6b4a2e";
      var fx = (a - 80) / 22, fz = (z - 190) / 11;
      if (fx * fx + fz * fz < 1) return a === 92 && z === 192 ? "#111111" : fx > 0.2 && Math.abs(fz) < 0.3 ? "#ffcf6e" : "#f08a3a";
      if (a < 60 && a > 47 && Math.abs(z - 190) < (60 - a) * 0.7) return "#f08a3a";
      return z < 175 ? "#7fbcd9" : "#6aa9c9";
    });
  }
  // ---------- the season on the walls (Nick: "put more things on the wall for that season. xmas gets mistletoe,
  // halloween gets cobwebs"): painted into the walls themselves, so they turn with the room and hide behind furniture.
  // pen.setW(a, z): a = along the wall (0 .. its length), z = height (0 .. WALL). The window is a 128-302, z 116-282.
  function seasonWall(pen, name, len) {
    var sz = season();
    if (!sz) return;
    var win = name === "window";
    function free(a, z) { return !(win && a > 120 && a < 310 && z > 110 && z < 286) && !(win && a > 36 && a < 124 && z > 154 && z < 226); } // not over the window or the fish
    function dot(a, z, r, col) { for (var dz = -r; dz <= r; dz++) for (var da = -r; da <= r; da++) if (da * da + dz * dz <= r * r + 0.5 && free(a + da, z + dz)) pen.setW(Math.round(a + da), Math.round(z + dz), col); }
    // a string swagging along the top, pinned every `span`, with things hanging off it
    function swag(top, span, each) {
      for (var a = 4; a < len - 4; a++) {
        var t = (a % span) / span, z = top - Math.sin(t * Math.PI) * 14;
        each(a, Math.round(z), t);
      }
    }
    if (sz === "halloween") {
      var flags = ["#f08a24", "#6b3fa0", "#1c1820"], n = 0;
      swag(292, 90, function (a, z, t) {
        pen.setW(a, z, "#3a2f28");
        if (a % 18 === 0) { // a pennant: a little triangle below the string
          var col = flags[(n++) % 3];
          for (var j = 1; j < 12; j++) for (var w = -Math.round((12 - j) / 2); w <= Math.round((12 - j) / 2); w++) if (free(a + w, z - j)) pen.setW(a + w, z - j, col);
        }
      });
      // cobwebs in both top corners
      [[2, 1], [len - 2, -1]].forEach(function (c0) {
        var web = "#e8e4dc";
        for (var r = 0; r < 44; r++) for (var k = 0; k <= 4; k++) { var ang = k / 4 * Math.PI / 2; pen.setW(Math.round(c0[0] + c0[1] * Math.cos(ang) * r), Math.round(WALL - 1 - Math.sin(ang) * r), web); }
        [12, 24, 36].forEach(function (r) { for (var t = 0; t <= 1; t += 0.01) { var ang2 = t * Math.PI / 2, sag = Math.sin(t * Math.PI * 4) * 1.5; pen.setW(Math.round(c0[0] + c0[1] * Math.cos(ang2) * (r - sag)), Math.round(WALL - 1 - Math.sin(ang2) * (r - sag)), web); } });
      });
      // paper bats stuck on the wall in little flocks (Nick: "put bats on the wall for halloween as well")
      var BAT = [".##.......##.", "####.#.#.####", "#############", ".###########.", "..##.###.##..", "......#......"];
      [[0.12, 236], [0.2, 252], [0.27, 230], [0.58, 214], [0.66, 232], [0.74, 206], [0.86, 244]].forEach(function (b, i) {
        var ba = Math.round(len * b[0]), bz = b[1], mir = i % 2, big = i % 3 === 0 ? 2 : 1;
        for (var j = 0; j < BAT.length; j++) for (var k2 = 0; k2 < BAT[j].length; k2++) {
          if (BAT[j][mir ? BAT[j].length - 1 - k2 : k2] !== "#") continue;
          for (var y2 = 0; y2 < big; y2++) for (var x2 = 0; x2 < big; x2++) {
            var pa = ba + (k2 - 6) * big + x2, pz = bz - j * big - y2;
            if (free(pa, pz)) pen.setW(pa, pz, "#1c1820");
          }
        }
      });
      // a spider on its thread
      var sa = win ? 340 : Math.round(len * 0.32);
      for (var zz = WALL - 1; zz > 222; zz--) pen.setW(sa, zz, "#d8d4cc");
      dot(sa, 218, 4, "#1c1820"); for (var l = -1; l <= 1; l += 2) for (var leg = 0; leg < 3; leg++) { pen.setW(sa + l * 5, 216 + leg * 2, "#1c1820"); pen.setW(sa + l * 6, 215 + leg * 2, "#1c1820"); }
      pen.setW(sa - 1, 219, "#ff4d4d"); pen.setW(sa + 1, 219, "#ff4d4d");
    }
    if (sz === "winter") { // (redone, Nick: "this is ugly, make this better")
      // a little pixel picture on the wall: rows top to bottom, a key per colour; its top-left at (a0, ztop)
      function pic(map, a0, ztop, pal, P) { // P: wall units per picture pixel (the wall is slanted, so 2 reads well)
        P = P || 2;
        for (var j = 0; j < map.length; j++) for (var i = 0; i < map[j].length; i++) {
          var col = pal[map[j][i]];
          if (!col) continue;
          for (var y = 0; y < P; y++) for (var x = 0; x < P; x++) if (free(a0 + i * P + x, ztop - j * P - y)) pen.setW(a0 + i * P + x, ztop - j * P - y, col);
        }
      }
      function glow(a, z, col) { // a soft halo round a light: the wallpaper tinted toward the bulb
        for (var dz = -3; dz <= 3; dz++) for (var da = -3; da <= 3; da++) { var d = Math.hypot(da, dz); if (d > 1.5 && d <= 3.2 && free(a + da, z + dz)) pen.setW(a + da, z + dz, col); }
      }
      var BULB = { r: ["#ff5c6c", "#ffd0d6"], y: ["#ffd23f", "#fff4b8"], b: ["#6fb6ff", "#d6ecff"], g: ["#6fe0a8", "#d6f8e8"] }, BK = ["r", "y", "b", "g"], HALO = { r: "#f2d2c8", y: "#f4e6c0", b: "#dde4e6", g: "#dfeadb" };
      // the garland: a thick rope of needles swagging between pins, shaded (light on top, dark below, a shadow on
      // the wall), with a bulb and its glow every 12, and a red bow at each pin
      var top = 288, span = 112, k = 0;
      for (var a = 4; a < len - 4; a++) {
        var t = (a % span) / span, z = Math.round(top - Math.sin(t * Math.PI) * 18);
        if (!free(a, z)) continue;
        pen.setW(a, z - 8, "#d9c9ad"); pen.setW(a, z - 9, "#e0d1b6"); // its shadow on the wallpaper
        for (var dz = -7; dz <= 7; dz++) {
          var h = hash(a * 3, (z + dz) * 7), col = dz >= 4 ? (h < 0.5 ? "#5aa860" : "#4b9a54") : dz <= -4 ? (h < 0.5 ? "#1f5a2c" : "#2a6e38") : h < 0.25 ? "#2a6e38" : h > 0.8 ? "#4b9a54" : "#367f42";
          if (Math.abs(dz) >= 6 && h < 0.55) continue; // a ragged, needly edge
          pen.setW(a, z + dz, col);
        }
      }
      for (var a3 = 10, k = 0; a3 < len - 10; a3 += 14) { // the lights, after the needles so they sit on top
        var t3 = (a3 % span) / span, z3 = Math.round(top - Math.sin(t3 * Math.PI) * 18), key = BK[(k++) % 4];
        if (!free(a3, z3)) continue;
        glow(a3 + 1, z3 - 7, HALO[key]);
        pic(["0", "1", "1"], a3, z3 - 3, { "0": "#3a3a40", "1": BULB[key][0] }, 2);
        pen.setW(a3, z3 - 6, BULB[key][1]);
      }
      var BOW = ["11...11", "1d1.1d1", "1111111", ".1d.d1.", ".1...1.", "1.....1"];
      for (var pin = span; pin < len - 20; pin += span) pic(BOW, pin - 7, top + 6, { "1": "#d8343e", d: "#a3202a" });
      // mistletoe tied with a red ribbon, hanging from the garland's middle
      var ma = win ? 340 : Math.round(len / 2), mz = top - 24;
      for (var z2 = mz; z2 > mz - 12; z2--) { pen.setW(ma, z2, "#d8343e"); pen.setW(ma + 1, z2, "#a3202a"); }
      pic([".11..11.", "1d11d11.", ".111111.", "..1..1..", ".1....1."], ma - 7, mz - 12, { "1": "#d8343e", d: "#a3202a" });
      pic(["..gG..Gg..", ".gGGgGGGg.", "gGGgggGGgg", ".gGwgGwGg.", "..gGwGwg..", "...gGGg...", "....gg....", "....g....."], ma - 9, mz - 22, { g: "#4f8f45", G: "#6fae5c", w: "#f4f1e8" });
      if (!win) {
        // the wreath: a thick ring of needles, shaded, with berries, gold baubles, and a big red bow with tails
        var wa = Math.round(len * 0.24), wz = 214, WR = 1.45; // 1.45x the first wreath
        for (var dz2 = -30; dz2 <= 30; dz2++) for (var da2 = -30; da2 <= 30; da2++) {
          var r = Math.hypot(da2, dz2) / WR;
          if (r < 10 || r > 19.5) continue;
          var hh = hash(da2 + 50, dz2 + 50), edge = r > 18 || r < 11;
          if (edge && hh < 0.45) continue;
          pen.setW(wa + da2, wz + dz2, dz2 > 9 && r > 14 ? "#5aa860" : dz2 < -9 && r > 14 ? "#1f5a2c" : hh < 0.3 ? "#2a6e38" : hh > 0.8 ? "#4b9a54" : "#367f42");
        }
        [[0.1, "#d8343e"], [0.3, "#ffd23f"], [0.45, "#d8343e"], [0.62, "#ffd23f"], [0.8, "#d8343e"], [0.95, "#d8343e"]].forEach(function (b) {
          var ang = b[0] * Math.PI * 2 + 0.6, ba = Math.round(wa + Math.cos(ang) * 21), bz = Math.round(wz + Math.sin(ang) * 21);
          pic([".11.", "1s11", "1111", ".11."], ba - 4, bz + 4, { "1": b[1], s: b[1] === "#ffd23f" ? "#fff4b8" : "#ff8a95" }, 2);
        });
        pic(["111.....111", "1dd1...1dd1", "1ddd1.1ddd1", "1dd11111dd1", "111.1d1.111", "...1d.d1...", "..1d...d1..", "..1.....1..", ".1.......1."], wa - 11, wz - 18, { "1": "#d8343e", d: "#a3202a" });
        // stockings hung on little gold hooks, each knitted differently: a fluffy cuff, a heel and toe patch
        var SOCK = ["..cccccccc..", ".cCcCcCcCcc.", "..cccccccc..", "...BBBBBBB..", "...BpBBpBB..", "...BBBBBBB..", "...BBpBBpB..", "...BBBBBBB..", "...BpBBpBB..", "...BBBBBBB..", "...BBBBBBB..", "..hBBBBBBBB.", ".hhBBBBBBBBB", "hhhBBBBBBBTT", "hhBBBBBBBTTT", ".BBBBBBBBTT.", "..BBBBBBTT.."];
        // stockings hung together from a short swag of greenery, like a mantel
        var s0 = Math.round(len * 0.48), s1 = s0 + 150, sz2 = 168;
        for (var a4 = s0; a4 < s1; a4++) {
          var z4 = Math.round(sz2 + 4 - Math.sin(((a4 - s0) % 50) / 50 * Math.PI) * 5);
          for (var dz4 = -3; dz4 <= 3; dz4++) { var h4 = hash(a4 * 5, (z4 + dz4) * 3); if (Math.abs(dz4) === 3 && h4 < 0.5) continue; pen.setW(a4, z4 + dz4, dz4 >= 2 ? "#4b9a54" : dz4 <= -2 ? "#1f5a2c" : h4 < 0.3 ? "#2a6e38" : "#367f42"); }
        }
        [[0, "#d8343e", "#f4f1e8", "#2f7a3f"], [50, "#2f7a3f", "#d8343e", "#f4f1e8"], [100, "#f4f1e8", "#d8343e", "#d8343e"]].forEach(function (st) {
          var sa2 = s0 + 12 + st[0], top2 = sz2 - 4;
          pic(SOCK, sa2, top2, { c: "#f4f1e8", C: "#ffffff", B: st[1], p: st[2], h: st[3], T: st[3] }, 2);
          for (var q2 = 6; q2 < 22; q2++) pen.setW(sa2 + q2, top2 - 34, "#d9c9ad"); // its shadow
        });
      }
    }
    if (sz === "spring") {
      var past = ["#ffb3c7", "#bfe3a8", "#ffe39a", "#b9d7ff"], q = 0;
      swag(292, 90, function (a, z) {
        pen.setW(a, z, "#a88d6b");
        if (a % 18 === 0) { var col = past[(q++) % 4]; for (var j = 1; j < 11; j++) for (var w = -Math.round((11 - j) / 2); w <= Math.round((11 - j) / 2); w++) if (free(a + w, z - j)) pen.setW(a + w, z - j, col); }
      });
      // paper flowers dotted about
      for (var f = 0; f < 6; f++) {
        var fa = Math.round(30 + (len - 60) * ((f * 0.37 + (name.length * 0.13)) % 1)), fz = 150 + ((f * 53) % 90);
        if (!free(fa, fz)) continue;
        for (var pt = 0; pt < 5; pt++) { var an = pt / 5 * Math.PI * 2; dot(Math.round(fa + Math.cos(an) * 5), Math.round(fz + Math.sin(an) * 5), 3, past[(f + pt) % 4]); }
        dot(fa, fz, 2, "#ffd23f");
      }
    }
  }
  // the walls' box numbers: a wall never hides a cat (Nick: a cat on the back of the couch was cut off by the wall)
  var WALLID = {};
  function seasonal(name, len) { return function (pen) { wallPaint(pen); seasonWall(pen, name, len); }; }
  var walls = {
    window: wallBox("window", -WT, 0, -WT, Y + WT, { px: function (pen) { windowPaint(pen); seasonWall(pen, "window", Y); } }),
    shelf: wallBox("shelf", 0, X, -WT, 0, { py: seasonal("shelf", X) }),
    far: wallBox("far", X, X + WT, -WT, Y + WT, { nx: seasonal("far", Y) }),
    front: wallBox("front", 0, X, Y, Y + WT, { ny: seasonal("front", X) }),
  };
  Object.keys(walls).forEach(function (k) { WALLID[walls[k].n] = true; });
  // the floor: wooden boards on a slab
  box(0, X, 0, Y, -SLAB, 0, "#4a3b32", { structural: true, k: [0.75, 0.6], topc: "#b07d52", paint: { top: function (pen) {
    pen.each(function (x, y) {
      var row = Math.floor(y / 14), seam = (x + row * 53) % 120;
      if (y % 14 === 0) return "#8c5f3b";
      if (seam === 0) return "#94663f";
      var g = hash(Math.floor(x / 9), y);
      return g < 0.12 ? "#a67449" : g > 0.9 ? "#ba875b" : "#b07d52";
    });
  } } });
  // a rug in the middle
  box(196, 424, 168, 332, 0, 1, "#b8504a", { structural: true, paint: { top: function (pen) {
    pen.each(function (x, y) {
      var e = Math.min(x - 196, 423 - x, y - 168, 331 - y);
      if (e < 3) return "#e8d9b8";
      if (e < 8) return (x + y) % 6 < 3 ? "#7d3330" : "#b8504a";
      if (e < 10) return "#e8d9b8";
      var cx = Math.abs(x - 310) / 100, cy = Math.abs(y - 250) / 70;
      return Math.abs(cx + cy - 0.6) < 0.04 || Math.abs(cx + cy - 0.3) < 0.04 ? "#e8d9b8" : hash(x, y) < 0.04 ? "#a64640" : "#b8504a";
    });
  } } });

  // ---------- furniture ----------
  function sisal(pen) { for (var v = 0; v < pen.h; v++) for (var u = 0; u < pen.w; u++) pen.set(u, v, v % 3 === 0 ? "#a8824c" : (hash(u, v) < 0.2 ? "#c49b62" : "#cfa86d")); }
  function carpet(base, fleck) { return function (pen) { pen.each(function (x, y) { return hash(x * 3 + y, x - y) < 0.14 ? fleck : null; }); }; }
  function carpetSide(fleck) { return function (pen) { pen.each(function (u, v) { return hash(u * 5 + v, v) < 0.12 ? fleck : null; }); }; }
  function bedTop(rim, cushion) {
    return function (pen) {
      var b = pen.box;
      pen.each(function (x, y) {
        var e = Math.min(x - b.x0, b.x1 - 1 - x, y - b.y0, b.y1 - 1 - y);
        return e < 3 ? (e === 0 ? shade(H(rim), 0.85) : rim) : e < 5 ? shade(H(cushion), 0.85) : (hash(x, y) < 0.06 ? shade(H(cushion), 0.93) : cushion);
      });
    };
  }
  function platform(x0, x1, y0, y1, z, col, fleck) {
    return box(x0, x1, y0, y1, z - 8, z, col, { paint: { top: carpet(col, fleck), side: carpetSide(fleck) } });
  }
  // the tall tower, in the back corner: a base, two posts, three perches (the top one a bed)
  platform(36, 176, 28, 116, 8, "#8794a1", "#7a8794");
  box(44, 56, 34, 46, 8, 232, "#cfa86d", { paint: { side: sisal } });
  box(160, 170, 88, 98, 8, 150, "#cfa86d", { paint: { side: sisal } });
  platform(36, 122, 28, 116, 80, "#8794a1", "#7a8794");
  platform(104, 176, 30, 104, 158, "#8794a1", "#7a8794");
  box(32, 124, 24, 112, 228, 240, "#8794a1", { paint: { side: carpetSide("#7a8794"), top: bedTop("#9aa7b4", "#e8e0d2") } });
  // a ball on a string under the first perch
  box(115, 117, 100, 102, 50, 72, "#e8e2d6");
  box(112, 120, 97, 105, 42, 50, "#d94f6a");
  // the wall shelves, a staircase up the shelf wall to a landing at the top
  var SH = [];
  for (var s = 0; s < 6; s++) {
    var sx0 = 186 + s * 64, sx1 = s === 5 ? 590 : sx0 + 56, sz = 54 + s * 42;
    SH.push({ x0: sx0, x1: sx1, z: sz });
    box(sx0, sx1, 0, 44, sz - 7, sz, "#b67f4c", { topc: "#c99260", paint: { top: function (pen) { pen.each(function (x, y) { return y % 11 === 0 ? "#b47d4b" : null; }); } } });
    box(sx0 + 6, sx0 + 10, 0, 30, sz - 22, sz - 7, "#3a3a40"); // brackets
    box(sx1 - 10, sx1 - 6, 0, 30, sz - 22, sz - 7, "#3a3a40");
  }
  box(506, 590, 36, 44, 264, 272, "#b67f4c"); // the landing's lip
  // the window perch over a low cabinet, under the window
  box(0, 62, 140, 300, 0, 82, "#e9e5dc", { topc: "#d8cfbf", paint: { px: function (pen) {
    pen.rectW(140, 300, 40, 42, "#c9c3b6"); pen.rectW(219, 221, 0, 82, "#c9c3b6");
    pen.rectW(176, 186, 58, 61, "#8a8478"); pen.rectW(254, 264, 58, 61, "#8a8478"); pen.rectW(176, 186, 20, 23, "#8a8478"); pen.rectW(254, 264, 20, 23, "#8a8478");
  } } });
  box(0, 48, 160, 262, 104, 112, "#b67f4c", { topc: "#d8a24a", paint: { top: function (pen) { pen.each(function (x, y) { return x > 44 ? "#b8863c" : (hash(x, y) < 0.08 ? "#c99441" : null); }); } } });
  box(0, 40, 166, 172, 82, 104, "#3a3a40"); box(0, 40, 250, 256, 82, 104, "#3a3a40");
  // the couch, against the window wall at the front
  var COUCH = "#4f7f8c", CUSH = "#5f909d";
  box(0, 28, 310, 436, 0, 92, COUCH, { topc: "#5a8c99" });
  box(28, 104, 322, 424, 0, 34, COUCH);
  [[324, 358], [358, 392], [392, 424]].forEach(function (c) {
    box(28, 102, c[0], c[1], 34, 44, CUSH, { paint: { top: function (pen) { var b = pen.box; pen.each(function (x, y) { return y === b.y0 || y === b.y1 - 1 ? "#4f7f8c" : hash(x, y) < 0.05 ? "#6a9ba8" : null; }); } } });
  });
  box(28, 104, 310, 324, 0, 62, COUCH, { topc: "#5a8c99" }); box(28, 104, 424, 436, 0, 62, COUCH, { topc: "#5a8c99" });
  box(30, 42, 326, 350, 44, 64, "#e0b04a"); // a pillow
  for (var leg = 0; leg < 4; leg++) box(leg % 2 ? 96 : 2, leg % 2 ? 102 : 8, leg < 2 ? 312 : 428, leg < 2 ? 318 : 434, -1, 0, "#3a2a20");
  // the short tower, front right: a condo with a hole, a side perch, a top perch
  var TEAL = "#5f8f8a", TEALF = "#527d79";
  box(472, 552, 236, 316, 0, 64, TEAL, { paint: { top: carpet(TEAL, TEALF), side: function (pen) {
    carpetSide(TEALF)(pen);
    var cu = pen.w / 2, cv = 28;
    pen.each(function (u, v) { var d = Math.hypot((u - cu) / 1.0, (v - cv) * 1.1); return d < 16 ? (d > 13.5 ? "#3f6662" : "#20282b") : null; });
  } } });
  box(436, 446, 288, 298, 0, 104, "#cfa86d", { paint: { side: sisal } });
  platform(412, 470, 244, 304, 112, TEAL, TEALF);
  box(540, 550, 296, 306, 64, 184, "#cfa86d", { paint: { side: sisal } });
  box(476, 556, 232, 312, 184, 192, TEAL, { paint: { side: carpetSide(TEALF), top: bedTop("#6a9c97", "#e8e0d2") } });
  // the scratching post, by the rug
  platform(368, 412, 116, 160, 6, "#8794a1", "#7a8794");
  box(384, 396, 132, 144, 6, 110, "#cfa86d", { paint: { side: sisal } });
  platform(370, 410, 118, 158, 116, "#8794a1", "#7a8794");
  // a knitted pouf
  box(140, 188, 248, 296, 0, 34, "#b0577a", { paint: { side: function (pen) { pen.each(function (u, v) { return (u + (v >> 1)) % 4 === 0 ? "#9a4a69" : null; }); }, top: function (pen) { pen.each(function (x, y) { return Math.hypot(x - 164, y - 272) < 5 ? "#9a4a69" : (x + y) % 5 === 0 ? "#bd6688" : null; }); } } });
  // three cat beds
  box(156, 220, 352, 416, 0, 12, "#c96565", { paint: { top: bedTop("#d77a7a", "#f3e6d6") } });
  box(300, 364, 62, 118, 0, 12, "#5d7fbd", { paint: { top: bedTop("#6f91cf", "#f3e6d6") } });
  box(520, 584, 140, 204, 0, 12, "#d6a640", { paint: { top: bedTop("#e2b452", "#f3e6d6") } });
  // two cardboard boxes, open at the top (four thin sides round a floor)
  function cardboard(x0, x1, y0, y1, h) {
    var col = "#c69757", top = "#d4a868", tape = function (pen) { pen.each(function (u, v) { return v > pen.h - 3 && Math.abs(u - pen.w / 2) < 5 ? "#e6c98f" : hash(u, v) < 0.03 ? "#b88a4c" : null; }); };
    box(x0, x1, y0, y1, 0, 2, "#a87e45");
    box(x0, x1, y0, y0 + 3, 0, h, col, { topc: top, paint: { side: tape } });
    box(x0, x1, y1 - 3, y1, 0, h, col, { topc: top, paint: { side: tape } });
    box(x0, x0 + 3, y0 + 3, y1 - 3, 0, h, col, { topc: top, paint: { side: tape } });
    box(x1 - 3, x1, y0 + 3, y1 - 3, 0, h, col, { topc: top, paint: { side: tape } });
  }
  cardboard(380, 440, 376, 426, 40);
  cardboard(228, 282, 58, 102, 36);
  // food and water
  function bowl(x0, y0, fill) {
    box(x0, x0 + 24, y0, y0 + 24, 0, 8, "#d94f4f", { topc: "#e86a6a", paint: { top: function (pen) { pen.each(function (x, y) { return Math.min(x - x0, x0 + 23 - x, y - y0, y0 + 23 - y) > 2 ? (fill === "food" ? (hash(x, y) < 0.5 ? "#8a5a2b" : "#a06a35") : (hash(x, y) < 0.1 ? "#9fd2f0" : "#6fb6e0")) : null; }); } } });
  }
  box(286, 352, 400, 432, 0, 1, "#d9cbb4"); // the mat
  bowl(290, 404, "food"); bowl(322, 404, "water");
  // the litter box, front right
  box(520, 596, 376, 436, 0, 22, "#8f98a2", { topc: "#a3acb5", paint: { top: function (pen) { var b = pen.box; pen.each(function (x, y) { return Math.min(x - b.x0, b.x1 - 1 - x, y - b.y0, b.y1 - 1 - y) > 3 ? (hash(x, y) < 0.3 ? "#cdc3aa" : "#d8cfb8") : null; }); } } });
  // a plant in the far corner (put away in winter, when the Christmas tree stands there; Nick)
  if (season() !== "winter") {
    box(556, 594, 6, 44, 0, 34, "#b8613f", { topc: "#5a3a28" });
    [[566, 576, 14, 24, 34, 90], [574, 586, 22, 34, 34, 76], [560, 572, 26, 38, 34, 70], [578, 590, 8, 20, 34, 100]].forEach(function (l, i) {
      box(l[0], l[1], l[2], l[3], l[4], l[5], i % 2 ? "#3f7a3a" : "#4f8f45", { topc: "#5fa352" });
    });
  }

  // the Christmas tree (winter only; Nick: "where's the large xmas tree for winter?"): a stepped evergreen built of
  // blocks like the furniture, far right between the shelves and the short tower, ornaments and lights on every
  // face, a gold star on top, presents in front; the cats walk round it (TREE_OBST)
  // in the back corner between the plant and the yellow bed (Nick: the short tower was in the way where it first
  // stood, which was also on top of the yellow bed)
  var TREE_OBST = [512, 598, 44, 130];
  // against the back wall under the middle shelves (Nick: by the tree it crowded the scratching post and a floor
  // spot); found by a search for the most room from all furniture and cats' spots
  var OPEN_BOX = [404, 440, 20, 52]; // the opened present beside the tree (x0, x1, y0, y1): a cat can climb in (winterLife) // the opened present beside the tree (x0, x1, y0, y1): a cat can climb in (winterLife)
  var TREEID = {}; // the tree's and its presents' box numbers: they never hide an ornament (drawOrnaments)
  if (season() === "winter") (function () {
    var first = boxes.length;
    var cx = 556, cy = 86, BULBS = ["#ff4d6d", "#ffd23f", "#7cc4ff", "#f4f1e8", "#ff9f43"];
    function dots(n0) { return function (pen) { pen.each(function (u, v) { var h = hash(u * 7 + n0, v * 13 + n0); return h < 0.02 ? BULBS[Math.floor(h * 250) % BULBS.length] : h < 0.06 ? "#3f8f4c" : h > 0.94 ? "#256b33" : null; }); }; }
    box(cx - 7, cx + 7, cy - 7, cy + 7, 0, 24, "#6b4a2e", { topc: "#5a3a28" }); // the trunk
    [[40, 16, 62], [33, 52, 98], [26, 88, 132], [19, 122, 162], [11, 154, 186]].forEach(function (t, i) {
      box(cx - t[0], cx + t[0], cy - t[0], cy + t[0], t[1], t[2], "#2f7a3f", { topc: "#3a8a48", paint: { side: dots(i * 31 + 5), top: dots(i * 17 + 3) } });
    });
    box(cx - 5, cx + 5, cy - 5, cy + 5, 186, 198, "#ffd23f", { topc: "#fff2a8" }); // the star
    // presents on the floor under the tree (under the bottom tier, which starts at z 16), a couple peeking out at the
    // front: [x0, x1, y0, y1, height, paper, ribbon]
    [[520, 538, 112, 130, 13, "#d8343e", "#ffd23f"], [540, 556, 118, 134, 11, "#4a8fe0", "#f4f1e8"], [562, 582, 110, 128, 14, "#7ee0b5", "#d8343e"],
     [520, 536, 54, 70, 12, "#b07ad6", "#f4f1e8"], [574, 592, 60, 78, 13, "#ffd23f", "#d8343e"], [524, 540, 78, 94, 10, "#f4f1e8", "#2f7a3f"]].forEach(function (g) {
      var rib = function (pen) { pen.each(function (u, v) { return Math.abs(u - pen.w / 2) < 2 || Math.abs(v - pen.h / 2) < 1.5 ? g[6] : null; }); };
      box(g[0], g[1], g[2], g[3], 0, g[4], g[5], { topc: g[5], paint: { side: rib, top: function (pen) { pen.each(function (x, y) { return Math.abs(x - (g[0] + g[1]) / 2) < 2 || Math.abs(y - (g[2] + g[3]) / 2) < 2 ? g[6] : null; }); } } });
    });
    // the one opened present (Nick: "only one christmas box being opened and a cat can sit inside it"): red paper
    // round four thin sides, flaps folded open on the floor, tissue paper at the corners, the bow beside it
    var px0 = OPEN_BOX[0], px1 = OPEN_BOX[1], py0 = OPEN_BOX[2], py1 = OPEN_BOX[3], ph = 20, red = "#d8343e";
    var ribbon = function (pen) { pen.each(function (u, v) { return Math.abs(u - pen.w / 2) < 2 ? "#ffd23f" : hash(u, v) < 0.03 ? "#b82a33" : null; }); };
    box(px0, px1, py0, py1, 0, 2, "#a82830");
    box(px0, px1, py0, py0 + 2, 0, ph, red, { topc: "#e84a52", paint: { side: ribbon } });
    box(px0, px1, py1 - 2, py1, 0, ph, red, { topc: "#e84a52", paint: { side: ribbon } });
    box(px0, px0 + 2, py0 + 2, py1 - 2, 0, ph, red, { topc: "#e84a52", paint: { side: ribbon } });
    box(px1 - 2, px1, py0 + 2, py1 - 2, 0, ph, red, { topc: "#e84a52", paint: { side: ribbon } });
    var flap = { topc: "#e84a52", paint: { top: function (pen) { var b = pen.box; pen.each(function (x, y) { return Math.abs((b.y0 + b.y1) / 2 - y) < 2 || Math.abs((b.x0 + b.x1) / 2 - x) < 2 ? "#ffd23f" : null; }); } } };
    box(px0, px1, py1, py1 + 14, 0, 1, red, flap); // the front flap, folded down
    box(px0 - 14, px0, py0, py1, 0, 1, red, flap); // the left one
    [[px0 + 1, py0 + 1], [px1 - 7, py0 + 1], [px0 + 1, py1 - 7]].forEach(function (t) { box(t[0], t[0] + 6, t[1], t[1] + 6, ph - 4, ph + 5, "#f4f1e8", { topc: "#ffffff" }); }); // tissue paper
    box(px1 + 2, px1 + 8, py1 + 4, py1 + 10, 0, 5, "#ffd23f", { topc: "#fff2a8" }); // the bow, set aside
    for (var n = first; n < boxes.length; n++) TREEID[boxes[n].n] = true;
  })();

  // ---------- the spots: where a cat can be (the Worker has the same ids) ----------
  // x, y, z: where it sits; via: the spot it's reached from (null: the floor); from: the floor point it jumps up from;
  // kind: what it likes doing there
  var SPOTS = {
    ta1: { x: 80, y: 80, z: 80, from: [104, 140], kind: "perch", label: "the tall tower’s first perch" },
    ta2: { x: 140, y: 68, z: 158, via: "ta1", kind: "perch", label: "the tall tower’s middle perch" },
    ta3: { x: 78, y: 70, z: 240, via: "ta2", kind: "bed", label: "the top of the tall tower" },
    tb1: { x: 512, y: 280, z: 64, from: [512, 340], kind: "perch", label: "the cat condo" },
    tb2: { x: 441, y: 270, z: 112, from: [440, 332], kind: "perch", label: "the short tower’s side perch" },
    tb3: { x: 514, y: 268, z: 192, via: "tb1", kind: "bed", label: "the top of the short tower" },
    sh1: { x: 214, y: 24, z: 54, from: [212, 70], kind: "perch", label: "the bottom shelf" },
    sh2: { x: 278, y: 24, z: 96, via: "sh1", kind: "perch", label: "the second shelf" },
    sh3: { x: 342, y: 24, z: 138, via: "sh2", kind: "perch", label: "the third shelf" },
    sh4: { x: 406, y: 24, z: 180, via: "sh3", kind: "perch", label: "the fourth shelf" },
    sh5: { x: 470, y: 24, z: 222, via: "sh4", kind: "perch", label: "the fifth shelf" },
    sh6: { x: 550, y: 22, z: 264, via: "sh5", kind: "perch", label: "the top shelf" },
    cabinet: { x: 32, y: 284, z: 82, from: [92, 284], kind: "perch", label: "the cabinet" },
    window: { x: 26, y: 212, z: 112, via: "cabinet", kind: "window", label: "the window perch" },
    couch1: { x: 66, y: 341, z: 44, from: [130, 341], kind: "couch", label: "the couch" },
    couch2: { x: 66, y: 375, z: 44, from: [130, 375], kind: "couch", label: "the couch" },
    couch3: { x: 66, y: 408, z: 44, from: [130, 408], kind: "couch", label: "the couch" },
    couchback: { x: 18, y: 375, z: 92, via: "couch2", kind: "perch", label: "the back of the couch" }, // (was 14: a lying cat poked into the wall)
    rug1: { x: 250, y: 212, z: 1, kind: "floor", label: "the rug" },
    rug2: { x: 366, y: 236, z: 1, kind: "floor", label: "the rug" },
    rug3: { x: 300, y: 300, z: 1, kind: "floor", label: "the rug" },
    bed1: { x: 188, y: 384, z: 6, kind: "bed", label: "the red bed" },
    bed2: { x: 332, y: 90, z: 6, kind: "bed", label: "the blue bed" },
    bed3: { x: 552, y: 172, z: 6, kind: "bed", label: "the yellow bed" },
    box1: { x: 410, y: 401, z: 2, from: [410, 356], kind: "box", label: "a cardboard box" },
    box2: { x: 255, y: 80, z: 2, from: [255, 126], kind: "box", label: "a cardboard box" },
    pouf: { x: 164, y: 272, z: 34, from: [206, 272], kind: "perch", label: "the pouf" },
    post: { x: 390, y: 138, z: 116, from: [392, 184], kind: "perch", label: "the top of the scratching post" },
    fl1: { x: 120, y: 150, z: 0, kind: "floor", label: "the floor" },
    fl2: { x: 300, y: 150, z: 0, kind: "floor", label: "the floor" },
    fl3: { x: 250, y: 380, z: 0, kind: "floor", label: "the floor" },
    fl4: { x: 476, y: 396, z: 0, kind: "floor", label: "the floor" },
    fl5: { x: 96, y: 222, z: 0, kind: "floor", label: "a sunny spot under the window" },
    fl6: { x: 150, y: 326, z: 0, kind: "floor", label: "the floor" },
    fl7: { x: 452, y: 200, z: 0, kind: "floor", label: "the floor" },
    fl8: { x: 470, y: 110, z: 0, kind: "floor", label: "the floor" },
  };
  var EAT = { x: 318, y: 382, z: 0 }; // where a cat eats from the bowls
  Object.keys(SPOTS).forEach(function (id) { SPOTS[id].id = id; });
  function chainOf(id) { var c = []; for (var s2 = SPOTS[id]; s2; s2 = s2.via ? SPOTS[s2.via] : null) c.unshift(s2); return c; }
  function groundOf(id) { var root = chainOf(id)[0]; return root.from ? { x: root.from[0], y: root.from[1], z: 0 } : { x: root.x, y: root.y, z: root.z }; }

  // things a cat walks round rather than through (their footprints on the floor)
  var OBST = (season() === "winter" ? [TREE_OBST] : []).concat([[36, 176, 28, 116], [0, 62, 140, 300], [0, 104, 310, 436], [472, 552, 236, 316], [436, 446, 288, 298], [368, 412, 116, 160],
    [140, 188, 248, 296], [380, 440, 376, 426], [228, 282, 58, 102], [286, 352, 400, 432], [520, 596, 376, 436]].concat(season() === "winter" ? [] : [[556, 594, 6, 44]])); // (the plant, not in winter)
  function blocked(a, b) {
    var n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8);
    for (var i = 1; i < n; i++) {
      var x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
      for (var k = 0; k < OBST.length; k++) {
        var o = OBST[k];
        if (x > o[0] - 8 && x < o[1] + 8 && y > o[2] - 8 && y < o[3] + 8 && !(a.x > o[0] - 9 && a.x < o[1] + 9 && a.y > o[2] - 9 && a.y < o[3] + 9) && !(b.x > o[0] - 9 && b.x < o[1] + 9 && b.y > o[2] - 9 && b.y < o[3] + 9)) return true;
      }
    }
    return false;
  }
  var AISLES = [{ x: 310, y: 250 }, { x: 300, y: 140 }, { x: 300, y: 350 }, { x: 140, y: 220 }, { x: 470, y: 200 }, { x: 470, y: 350 }, { x: 200, y: 330 }, { x: 130, y: 140 }];
  function route(a, b) { // floor points from a to b, round the furniture
    if (!blocked(a, b)) return [b];
    var best = null, bl = Infinity;
    AISLES.forEach(function (w) {
      if (blocked(a, w) || blocked(w, b)) return;
      var l = Math.hypot(w.x - a.x, w.y - a.y) + Math.hypot(b.x - w.x, b.y - w.y);
      if (l < bl) { bl = l; best = [w, b]; }
    });
    if (best) return best;
    AISLES.forEach(function (w1) { AISLES.forEach(function (w2) {
      if (w1 === w2 || blocked(a, w1) || blocked(w1, w2) || blocked(w2, b)) return;
      var l = Math.hypot(w1.x - a.x, w1.y - a.y) + Math.hypot(w2.x - w1.x, w2.y - w1.y) + Math.hypot(b.x - w2.x, b.y - w2.y);
      if (l < bl) { bl = l; best = [w1, w2, b]; }
    }); });
    return best || [b];
  }

  // ---------- drawing the room ----------
  var keyOf = [];
  function renderRoom() {
    origin();
    bg.fill(0); ids.fill(-1); depth.fill(-32000); zat.fill(-1000);
    var backs = {};
    [walls.window, walls.shelf, walls.far, walls.front].forEach(function (w) { var vb = viewBox(w); if (vb.vx1 <= 0 || vb.vy1 <= 0) backs[w.wall] = true; });
    var vis = boxes.filter(function (b) { return b.wall ? backs[b.wall] : true; });
    sortBoxes(vis).forEach(drawBox);
    // a darker edge where an object meets anything that isn't part of it
    boxes.forEach(function (b) { keyOf[b.n] = b.structural ? -1 : b.n; });
    var copy = new Uint32Array(bg);
    for (var y = 1; y < CH - 1; y++) for (var x = 1; x < CW - 1; x++) {
      var i = y * CW + x, n = ids[i];
      if (n < 0 || keyOf[n] === -1) continue;
      var a = ids[i - CW], b = ids[i - 1], c = ids[i + 1], d = ids[i + CW];
      if (a !== n || b !== n || c !== n || d !== n) {
        // only against things behind it or beside it (not the face of the same object under its top)
        copy[i] = shade(bg[i], 0.66);
      }
    }
    bg.set(copy);
    roomDirty = false;
  }
  var roomDirty = true;
  setInterval(function () { roomDirty = true; }, 120000); // the sky moves on

  // ---------- the cats ----------
  var room = { cats: [], rel: {}, log: [], mine: null, owner: false, max: 30 };
  var cats = {}; // id -> the cat on screen: { data, x, y, z, spot, facing, pose, path, idle, emote... }
  var now = 0, clock = 0;
  function isMine(id) { return !!room && (room.mines || []).indexOf(id) >= 0; }
  function relOf(a, b) { return room.rel[a < b ? a + "|" + b : b + "|" + a] || { f: 0, r: 0 }; }
  function spotPos(id) { var s2 = SPOTS[id] || SPOTS.fl3; return { x: s2.x, y: s2.y, z: s2.z }; }

  function addCat(d) {
    var p = spotPos(d.spot);
    var c = cats[d.id] = { id: d.id, data: d, x: p.x, y: p.y, z: p.z, spot: d.spot, facing: hash(d.look.seed || 1, 3) < 0.5 ? 1 : -1, path: [], idle: null, emote: null, act: null, sprite: null, key: "" };
    pickIdle(c);
    return c;
  }
  // what a cat does while it's just sitting about, by where it is
  var IDLE = {
    bed: [["sleep", 6, 22, 45], ["loaf", 3, 12, 25], ["groom", 1, 4, 6]],
    perch: [["loaf", 4, 12, 26], ["sit", 3, 8, 16], ["sleep", 2, 18, 40], ["groom", 1, 4, 6]],
    window: [["sit", 5, 12, 24], ["loaf", 3, 12, 25], ["sleep", 1, 18, 30]],
    couch: [["loaf", 4, 12, 25], ["sleep", 4, 18, 40], ["sit", 2, 8, 14], ["groom", 1, 4, 6]],
    box: [["loaf", 4, 10, 22], ["sit", 3, 8, 16], ["sleep", 2, 15, 30]],
    floor: [["sit", 5, 8, 16], ["stand", 2, 4, 8], ["groom", 2, 4, 6], ["loaf", 3, 10, 20], ["stretch", 1, 2, 2.6], ["sleep", 1, 15, 30], ["bat", 1, 2.5, 3.2]],
  };
  function pickIdle(c) {
    var kind = (SPOTS[c.spot] || {}).kind || "floor";
    var list = IDLE[kind] || IDLE.floor, hr = new Date().getHours(), sleepy = hr >= 22 || hr < 6;
    var total = 0, w = list.map(function (o) { var x = o[1] * (o[0] === "sleep" && sleepy ? 3 : 1); total += x; return x; });
    var r = Math.random() * total, pick = list[0];
    for (var i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) { pick = list[i]; break; } }
    c.idle = { pose: pick[0], until: now + (pick[2] + Math.random() * (pick[3] - pick[2])) * 1000 };
    if ((pick[0] === "sit" || pick[0] === "stand") && Math.random() < 0.35) c.facing = -c.facing;
    if (pick[0] === "sleep") c.emote = { kind: "z", until: c.idle.until };
  }

  // ---------- moving about ----------
  function plan(c, toSpot, then) {
    var segs = [], at = { x: c.x, y: c.y, z: c.z };
    // down from where it is (back along its chain of perches, then to the floor)
    if (c.spot && SPOTS[c.spot] && (SPOTS[c.spot].z > 8 || SPOTS[c.spot].kind === "box") && !c.offSpot) {
      var down = chainOf(c.spot).reverse();
      for (var i = 1; i < down.length; i++) { segs.push(jump(at, down[i])); at = { x: down[i].x, y: down[i].y, z: down[i].z }; }
      var g = groundOf(c.spot);
      segs.push(jump(at, g)); at = g;
    }
    var target = typeof toSpot === "object" ? toSpot : null; // a point on the floor (the bowls, a cat to meet) rather than a spot
    var dest = target || groundOf(toSpot);
    route(at, dest).forEach(function (p) { segs.push(walk(at, { x: p.x, y: p.y, z: dest.z })); at = { x: p.x, y: p.y, z: dest.z }; });
    if (!target) {
      var up = chainOf(toSpot);
      if (up[0].from || up[0].z > 8) up.forEach(function (s3) { segs.push(jump(at, s3)); at = { x: s3.x, y: s3.y, z: s3.z }; });
      else if (Math.hypot(at.x - up[0].x, at.y - up[0].y) > 1) segs.push(walk(at, up[0]));
    }
    c.path = segs.filter(function (s4) { return s4.dur > 0; });
    c.then = then || null;
    c.idle = null; c.emote = null;
  }
  function walk(a, b) { var d = Math.hypot(b.x - a.x, b.y - a.y); return { type: "walk", a: a, b: { x: b.x, y: b.y, z: b.z }, dur: d / 95 * 1000 }; }
  function jump(a, b) { var dz = Math.abs(b.z - a.z); return { type: "jump", a: a, b: { x: b.x, y: b.y, z: b.z }, dur: 480 + dz * 1.5, hop: Math.max(14, (b.z - a.z) * 0.35 + 14) }; }

  function step(c) {
    var seg = c.path[0];
    if (!seg) return;
    if (!seg.start) {
      seg.start = now;
      var pa = project(seg.a.x, seg.a.y, 0), pb = project(seg.b.x, seg.b.y, 0);
      if (!seg.keepFacing && Math.abs(pb.sx - pa.sx) > 2) c.facing = pb.sx > pa.sx ? 1 : -1;
    }
    var pre = seg.type === "jump" ? 170 : 0, post = seg.type === "jump" ? 110 : 0;
    var t = (now - seg.start - pre) / seg.dur;
    if (seg.type === "jump" && now - seg.start < pre) { c.pose = "crouch"; return; }
    if (t >= 1) {
      c.x = seg.b.x; c.y = seg.b.y; c.z = seg.b.z;
      if (seg.type === "jump" && now - seg.start < pre + seg.dur + post) { c.pose = "crouch"; return; }
      c.path.shift();
      if (!c.path.length) { var f = c.then; c.then = null; if (f) f(c); else pickIdle(c); }
      return;
    }
    t = Math.max(0, t);
    c.x = seg.a.x + (seg.b.x - seg.a.x) * t;
    c.y = seg.a.y + (seg.b.y - seg.a.y) * t;
    if (seg.type === "jump") { c.z = seg.a.z + (seg.b.z - seg.a.z) * t + Math.sin(t * Math.PI) * seg.hop; c.pose = "jump"; }
    else { c.z = seg.a.z + (seg.b.z - seg.a.z) * t; c.pose = seg.keepFacing ? (c.act ? c.pose : "crouch") : "walk"; }
  }

  function update(c) {
    if (c.path.length) { step(c); return; }
    if (c.act) {
      if (now < c.act.until) { c.pose = typeof c.act.pose === "function" ? c.act.pose(now - c.act.start) : c.act.pose; return; }
      var done = c.act.done; c.act = null;
      if (done) { done(c); return; }
      pickIdle(c);
    }
    if (!c.idle || now > c.idle.until) { if (c.emote && c.emote.kind === "z") c.emote = null; pickIdle(c); }
    c.pose = c.idle.pose;
  }

  // a little scene between two cats near each other, by how they get on (just for show; the Worker keeps the score).
  // Rare on purpose (Nick: "sparingly, not so sequential and constant"): one every 2 to 6 minutes. The real meetings
  // (each cat's own clock in the Worker) play as they come in: see playMeeting().
  var nextScene = 0;
  function scenes() {
    if (!nextScene) nextScene = now + 120000 + Math.random() * 240000;
    if (now < nextScene) return;
    nextScene = now + 120000 + Math.random() * 240000;
    var list = Object.keys(cats).map(function (k) { return cats[k]; }).filter(function (c) { return !c.path.length && !c.act && !c.fighting && !c.hiding && !isAway(c); });
    if (list.length < 2) return;
    var a = list[Math.floor(Math.random() * list.length)], b = null, bd = 170;
    list.forEach(function (o) { if (o === a) return; var d = Math.hypot(o.x - a.x, o.y - a.y) + Math.abs(o.z - a.z) * 0.5; if (d < bd) { bd = d; b = o; } });
    if (!b) return;
    var rel = relOf(a.id, b.id);
    var pa = project(a.x, a.y, a.z), pb = project(b.x, b.y, b.z);
    a.facing = pb.sx > pa.sx ? 1 : -1;
    if (rel.r >= 70) { perform(a, "happy", 3500, "heart"); perform(b, "happy", 3500, "heart"); b.facing = -a.facing; }
    else if (rel.r >= 35) perform(a, "sit", 3000, "heart");
    else if (rel.f >= 40) perform(a, Math.random() < 0.5 ? "groom" : "sit", 3000, "note");
    else if (rel.f <= -40) { perform(a, "hiss", 1800, "bang"); perform(b, "crouch", 1800, null); b.facing = -a.facing; if (Math.random() < 0.5) SFX.hiss(0.25); }
  }
  // a meeting from the history that happened while you're watching: the two cats act it out where they are
  var SWEET = { blink: 1, gift: 1, serenade: 1, cuddle: 1, love: 1 }, MEAN = { hiss: 1, swat: 1, stare: 1, steal: 1, rivals: 1 };
  function playMeeting(e) {
    var a = cats[e.a], b = cats[e.b];
    if (!a || !b || a.path.length || b.path.length || a.act || b.act || a.fighting || b.fighting || a.hiding || b.hiding || isAway(a) || isAway(b)) return;
    var pa = project(a.x, a.y, a.z), pb = project(b.x, b.y, b.z);
    a.facing = pb.sx > pa.sx ? 1 : -1; b.facing = -a.facing;
    if (SWEET[e.k]) { perform(a, "happy", 3500, "heart"); perform(b, "happy", 3500, "heart"); }
    else if (MEAN[e.k]) { perform(a, "hiss", 1800, "bang"); perform(b, "crouch", 1800, null); if (Math.random() < 0.5) SFX.hiss(0.25); }
    else if (e.k === "sniff") perform(a, "sit", 2500, "q");
    else { perform(a, e.k === "groom" ? "groom" : "happy", 3000, "note"); perform(b, "sit", 3000, null); }
  }
  // rivals caught mid-fight (Nick: "if 2 hate each other, they will be found fighting each other 30% of the time when
  // a visitor lands on the cat room"): on the first look only, each pair at -40 or worse has a 30% chance to be squared
  // off on the nearest open floor (the rug, mostly), hissing and swatting in turns, before they stalk back to their own spots.
  // Just for show: nothing is saved or logged.
  // At most 3 at once, each on its own patch of floor with its own cloud.
  function landingFights() {
    if (roomDirty) renderRoom(); // blockedView() reads the room's depth, so the room has to be drawn first
    var busy = {}, arenas = {}, n = 0;
    Object.keys(room.rel).forEach(function (k) {
      var ids = k.split("|"), a = cats[ids[0]], b = cats[ids[1]];
      if (n >= 3 || !a || !b || isAway(a) || isAway(b) || busy[a.id] || busy[b.id] || (room.rel[k].f || 0) > -40 || Math.random() >= 0.3) return;
      busy[a.id] = busy[b.id] = true; n++;
      fight(a, b, arenas);
    });
  }
  var ARENAS = ["rug1", "rug2", "rug3", "fl2", "fl3", "fl6", "fl7"]; // open floor; fight() takes the one least hidden from the current view
  // The fight (Nick: lunges, a brawl cloud, a chase): a stare-down, two or three lunges (the attacker hops in and
  // swats, the other is knocked back a step, both go back to their marks), a tumble in a dust cloud with paws, tails
  // and stars poking out, they pop out on opposite sides, then the loser runs home and the winner chases it partway.
  function fight(a, b, taken) {
    taken = taken || {};
    var g = (SPOTS[b.spot] && (SPOTS[b.spot].z > 8 || SPOTS[b.spot].kind === "box")) ? groundOf(b.spot) : { x: b.x, y: b.y };
    // the open floor least hidden by furniture from where the visitor is looking (nearer the cats on a tie), and clear
    // of the other fights ON SCREEN, so none is in front of another (Nick: "make sure that fights are not right in
    // front of each other"): a fight takes about 170 x 130 px of the canvas (two cats 52 apart, the cloud, the stars)
    var best = ARENAS.filter(function (k) {
      var p = project(SPOTS[k].x, SPOTS[k].y, 0);
      return blockedView(SPOTS[k]) < 0.12 && // and not behind furniture
        Object.keys(taken).every(function (o) { var q = taken[o]; return Math.abs(p.sx - q.sx) > 170 || Math.abs(p.sy - q.sy) > 130; });
    }).map(function (k) { return { k: k, v: blockedView(SPOTS[k]) * 1000 + Math.hypot(SPOTS[k].x - g.x, SPOTS[k].y - g.y) }; })
      .sort(function (p, q) { return p.v - q.v; })[0];
    if (!best) return; // nowhere clear of the other fights: these two leave it for another day
    taken[best.k] = project(SPOTS[best.k].x, SPOTS[best.k].y, 0);
    var m = SPOTS[best.k];
    var side = Math.random() < 0.5, dx = side ? 26 : 0, dy = side ? 0 : 26;
    var homeA = { x: m.x - dx, y: m.y - dy, z: 0 }, homeB = { x: m.x + dx, y: m.y + dy, z: 0 };
    a.x = homeA.x; a.y = homeA.y; a.z = 0; b.x = homeB.x; b.y = homeB.y; b.z = 0;
    [a, b].forEach(function (c) { c.path = []; c.offSpot = true; c.fighting = true; });
    face(a, b);
    perform(a, "hiss", 1400, "bang"); hold(b, "crouch");
    var lunges = 2 + Math.floor(Math.random() * 2);
    setTimeout(function () {
      (function next(i) {
        if (i >= lunges) { brawl(a, b, homeA, homeB, function () { chase(a, b); }); return; }
        var x = i % 2 ? b : a, y = i % 2 ? a : b;
        lunge(x, y, i % 2 ? homeB : homeA, i % 2 ? homeA : homeB, function () { next(i + 1); });
      })(0);
    }, 1400);
  }
  function blockedView(pt) { // how much of a fight there would be behind something (0..1)
    var p = project(pt.x, pt.y, 0), n = 0, hid = 0;
    for (var y = -90; y <= 0; y += 6) for (var x = -70; x <= 70; x += 7) {
      var sx = Math.round(p.sx + x), sy = Math.round(p.sy + y);
      if (sx < 0 || sy < 0 || sx >= CW || sy >= CH) continue;
      n++; var i = sy * CW + sx;
      if (depth[i] > p.d + 0.5 && zat[i] > 2) hid++;
    }
    return n ? hid / n : 1;
  }
  function face(a, b) { var pa = project(a.x, a.y, 0), pb = project(b.x, b.y, 0); a.facing = pb.sx > pa.sx ? 1 : -1; b.facing = -a.facing; }
  function hold(c, pose, emote) { perform(c, pose, 60000, emote || null); }
  // a short slide that doesn't turn the cat round (knocked back, backing off to its mark)
  function slide(c, to, ms, then) { c.act = null; c.path = [{ type: "walk", a: { x: c.x, y: c.y, z: 0 }, b: to, dur: ms, keepFacing: true }]; c.then = then || null; }
  function lunge(x, y, xHome, yHome, done) {
    var d = Math.hypot(y.x - x.x, y.y - x.y) || 1, ux = (y.x - x.x) / d, uy = (y.y - x.y) / d;
    hold(y, "crouch");
    x.act = null;
    x.path = [jump({ x: x.x, y: x.y, z: 0 }, { x: y.x - ux * 16, y: y.y - uy * 16, z: 0 })];
    x.then = function () {
      face(x, y);
      perform(x, "bat", 460, "bang", function () {
        slide(x, xHome, 300, function () { face(x, y); hold(x, "hiss"); done(); });
        slide(y, yHome, 300, function () { face(y, x); hold(y, "hiss"); });
      });
      if (Math.random() < 0.6) SFX.hiss(0.25);
      slide(y, { x: y.x + ux * 12, y: y.y + uy * 12, z: 0 }, 150, function () { hold(y, "crouch"); }); // knocked back
    };
  }
  var brawlFx = []; // the dust clouds being drawn: { x, y, until, cols }
  function brawl(a, b, homeA, homeB, done) {
    var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    [a, b].forEach(function (c) { c.act = null; c.path = [{ type: "walk", a: { x: c.x, y: c.y, z: 0 }, b: { x: mid.x, y: mid.y, z: 0 }, dur: 160, keepFacing: true }]; c.then = null; });
    setTimeout(function () {
      a.hidden = b.hidden = true;
      var fx = { x: mid.x, y: mid.y, until: now + 2200, cols: [CD.FURS[a.data.look.base], CD.FURS[b.data.look.base]].map(function (f) { return H((f || CD.FURS.ginger).hex); }) };
      brawlFx.push(fx);
      SFX.hiss(0.35);
      setTimeout(function () {
        brawlFx.splice(brawlFx.indexOf(fx), 1); a.hidden = b.hidden = false;
        a.x = homeB.x; a.y = homeB.y; b.x = homeA.x; b.y = homeA.y; // out on opposite sides
        face(a, b);
        perform(a, "hiss", 900, "bang"); perform(b, "hiss", 900, "bang", done);
      }, 2200);
    }, 170);
  }
  function chase(a, b) {
    var loser = Math.random() < 0.5 ? a : b, winner = loser === a ? b : a;
    [a, b].forEach(function (c) { c.act = null; c.fighting = false; });
    plan(loser, loser.spot); loser.offSpot = false;
    loser.path.forEach(function (sg) { if (sg.type === "walk") sg.dur *= 0.45; }); // running
    var gl = groundOf(loser.spot), to = { x: winner.x + (gl.x - winner.x) * 0.55, y: winner.y + (gl.y - winner.y) * 0.55, z: 0 };
    plan(winner, to, function () {
      perform(winner, "hiss", 900, "bang", function () { plan(winner, winner.spot); winner.offSpot = false; });
    });
    winner.path.forEach(function (sg) { if (sg.type === "walk") sg.dur *= 0.55; });
  }
  // the dust cloud: overlapping puffs that churn every few frames, with paws and tails in the two cats' colours
  // poking out and stars going round
  function drawBrawl() { brawlFx.forEach(drawCloud); }
  function drawCloud(fx) {
    var p = project(fx.x, fx.y, 0), cx = Math.round(p.sx), cy = Math.round(p.sy) - 30, k = Math.floor(now / 110), cd = p.d;
    function hidden(i) { return depth[i] > cd + 0.5 && zat[i] > 2; } // behind furniture, like the cats
    function rnd(n) { var v = Math.sin(k * 127.1 + n * 311.7 + fx.x * 7.3) * 43758.5453; return v - Math.floor(v); }
    var puffs = [];
    for (var i = 0; i < 7; i++) puffs.push({ x: cx + (rnd(i) - 0.5) * 70, y: cy + (rnd(i + 20) - 0.5) * 30, r: 20 + rnd(i + 40) * 12 });
    var x0 = cx - 70, y0 = cy - 50, W = 140, Hh = 100, mask = new Uint8Array(W * Hh);
    for (var y = 0; y < Hh; y++) for (var x = 0; x < W; x++) {
      for (var j = 0; j < puffs.length; j++) { var q = puffs[j]; if (Math.hypot(x0 + x - q.x, (y0 + y - q.y) * 1.25) < q.r) { mask[y * W + x] = 1; break; } }
    }
    // things poking out, drawn first so the cloud's edge overlaps them
    for (var n = 0; n < 4; n++) {
      var ang = rnd(n + 60) * Math.PI * 2, col = fx.cols[n % 2], ex = cx + Math.cos(ang) * 42, ey = cy + Math.sin(ang) * 26;
      if (n % 2) { blob(ex + Math.cos(ang) * 10, ey + Math.sin(ang) * 8, 7.5, col); blob(ex + Math.cos(ang) * 16, ey + Math.sin(ang) * 12, 3, H("#f2b8c2")); } // a paw, pink pad
      else for (var t = 0; t < 24; t++) blob(ex + Math.cos(ang) * t + Math.sin(t / 4 + k) * 3, ey + Math.sin(ang) * t * 0.8 - Math.sin(t / 3) * 3, 4, col); // a tail
    }
    var dust = H("#efe6d6"), shade = H("#cdbfa6"), ink = H("#1a1418");
    for (var y2 = 0; y2 < Hh; y2++) for (var x2 = 0; x2 < W; x2++) {
      var sx = x0 + x2, sy = y0 + y2;
      if (sx < 0 || sy < 0 || sx >= CW || sy >= CH) continue;
      if (hidden(sy * CW + sx)) continue;
      if (mask[y2 * W + x2]) out[sy * CW + sx] = y2 > Hh * 0.62 || (x2 + y2 + k) % 23 === 0 ? shade : dust;
      else if ((x2 > 0 && mask[y2 * W + x2 - 1]) || (x2 < W - 1 && mask[y2 * W + x2 + 1]) || (y2 > 0 && mask[(y2 - 1) * W + x2]) || (y2 < Hh - 1 && mask[(y2 + 1) * W + x2])) out[sy * CW + sx] = ink;
    }
    for (var st = 0; st < 3; st++) { var a2 = now / 260 + st * 2.1; icon("star", cx + Math.cos(a2) * 58, cy - 26 + Math.sin(a2) * 14, 2); }
    function blob(bx, by, r, c) {
      for (var yy = -r - 1; yy <= r + 1; yy++) for (var xx = -r - 1; xx <= r + 1; xx++) {
        var dd = Math.hypot(xx, yy), px = Math.round(bx + xx), py = Math.round(by + yy);
        if (dd > r + 1 || px < 0 || py < 0 || px >= CW || py >= CH || hidden(py * CW + px)) continue;
        out[py * CW + px] = dd > r ? ink : c;
      }
    }
  }
  function perform(c, pose, ms, emote, done) {
    c.act = { pose: pose, start: now, until: now + ms, done: done };
    c.idle = null;
    c.emote = emote ? { kind: emote, until: now + ms } : null;
  }


  // ================= the "coming home" update (Nick, 2026-10-14: build 1-5 and 8) =================
  // 1 "While you were away": a recap of your cats' lines since your last visit (localStorage nm-cats-visit)
  // 2 your cat greets you when you've been away an hour or more
  // 3 gifts your cat found while you were away, waiting by its spot (collected when you open its card)
  // 4 Share a treat / Set up a date / Keep apart (pick another cat, like Meet)
  // 5 room events: a thunderstorm, a sunbeam (the Worker starts them; Nick can too, in History)
  // 8 a diary on every cat's card: one line a day in the cat's own voice, from its history
  var GIFT_NAME = { mouse: "a toy mouse", cap: "a bottle cap", hairtie: "a hair tie", crinkle: "a crinkle ball", leaf: "a leaf",
    feather: "a feather", ribbon: "a ribbon", sock: "a single sock", bell: "a golden bell", clover: "a four-leaf clover", crown: "a tiny crown" };
  var GIFT_RARE = { feather: 1, ribbon: 1, sock: 1, bell: 2, clover: 2, crown: 2 };
  var EVENT_SAY = { storm: "A thunderstorm rolled in. Everyone hid.", sunbeam: "A big sunbeam came through the window." };
  var EVENT_NAME = { storm: "a thunderstorm", sunbeam: "a big sunbeam" };
  var VISIT_KEY = "nm-cats-visit", lastVisit = null;
  try { lastVisit = +localStorage.getItem(VISIT_KEY) || null; } catch (e) {}
  function markVisit() { try { localStorage.setItem(VISIT_KEY, String(Date.now())); } catch (e) {} }
  setInterval(function () { if (!document.hidden && room && room.mines && room.mines.length) markVisit(); }, 60000);
  window.addEventListener("pagehide", function () { if (room && room.mines && room.mines.length) markVisit(); });

  function joinList(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function sinceWhen(t) {
    var h = (Date.now() - t) / 3600e3, d = new Date(t);
    if (h < 20) return "In the last " + Math.max(1, Math.round(h)) + " hour" + (Math.round(h) === 1 ? "" : "s");
    if (h < 48) return "Since yesterday";
    if (h < 24 * 7) return "Since " + d.toLocaleDateString("en-US", { weekday: "long" });
    return "Since " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  var NICE_K = { groom: 1, play: 1, nap: 1, headbutt: 1, sunbeam: 1, chase: 1, share: 1, sniff: 1, blink: 1, gift: 1, serenade: 1, treat: 1, date: 1 };
  var MEAN_K = { hiss: 1, swat: 1, stare: 1, steal: 1 };
  // 1: what one of your cats got up to, as one sentence
  function recapOf(id, lines) {
    var name = catName(id), other = function (e) { return e.a === id ? e.b : e.a; }, otherName = function (e) { return catName(other(e), e.a === id ? e.bn : e.an); };
    var bits = [], seen = {}, fights = {}, nice = {}, cuddles = {};
    lines.slice().reverse().forEach(function (e) {
      if (e.k === "love") bits.push("fell in love with " + otherName(e) + " ♥");
      else if (e.k === "breakup") bits.push("broke up with " + otherName(e));
      else if (e.k === "friends") bits.push("became close friends with " + otherName(e));
      else if (e.k === "rivals") bits.push("became rivals with " + otherName(e));
      else if (e.k === "makeup") bits.push("made up with " + otherName(e));
      else if (e.k === "found" && e.a === id) bits.push("found " + esc(GIFT_NAME[e.g] || "something") + (GIFT_RARE[e.g] === 2 ? " (rare!)" : ""));
      else if (e.k === "kitten") bits.push("had a kitten with " + otherName(e) + ": " + catName(e.c, e.cn) + " 🐾");
      else if (e.k === "kind" && e.a === id) bits.push((e.what === "treat" ? "got a treat from " : "got petted by ") + esc(e.by || "a visitor"));
      else if (e.k === "adventure" && e.a === id) bits.push("went out on an adventure");
      else if (e.k === "back" && e.a === id) bits.push("came home with a postcard: “" + esc(e.text) + "”" + (e.g ? " (and " + esc(GIFT_NAME[e.g]) + ")" : ""));
      else if (e.k === "cuddle") cuddles[other(e)] = (cuddles[other(e)] || 0) + 1;
      else if (MEAN_K[e.k]) fights[other(e)] = (fights[other(e)] || 0) + 1;
      else if (NICE_K[e.k] && e.b) nice[other(e)] = 1;
      else if (e.k === "hungry" && !seen.hungry) { seen.hungry = 1; bits.push("got hungry"); }
    });
    Object.keys(cuddles).forEach(function (o) { bits.push("cuddled up with " + catName(o) + (cuddles[o] > 1 ? " " + cuddles[o] + " times" : "")); });
    var fk = Object.keys(fights).sort(function (a, b) { return fights[b] - fights[a]; });
    if (fk.length) { var n = fk.reduce(function (s2, o) { return s2 + fights[o]; }, 0); bits.push("got into " + (n === 1 ? "a scrap" : n + " scraps") + " with " + joinList(fk.slice(0, 2).map(function (o) { return catName(o); })) + (fk.length > 2 ? " and others" : "")); }
    var nk = Object.keys(nice).filter(function (o) { return !cuddles[o] && !fights[o]; });
    if (nk.length) bits.push("spent time with " + (nk.length > 2 ? nk.length + " cats" : joinList(nk.map(function (o) { return catName(o); }))));
    if (!bits.length) return null;
    return name + " " + joinList(bits) + ".";
  }
  function showRecap(d) {
    var since = lastVisit, el = document.querySelector(".cats-recap");
    if (!since || Date.now() - since < 3600e3 || !el) return;
    var lines = (d.mineLog || []).filter(function (e) { return e.t > since; });
    var sentences = room.mines.map(function (id) { return recapOf(id, lines.filter(function (e) { return e.a === id || e.b === id; })); }).filter(Boolean);
    var events = (d.log || []).filter(function (e) { return e.k === "event" && e.t > since; }).map(function (e) { return EVENT_NAME[e.e]; });
    if (events.length) sentences.push("The room had " + joinList(events.filter(function (x, i, a) { return a.indexOf(x) === i; })) + ".");
    if (!sentences.length) return;
    el.querySelector(".cats-recap-when").textContent = sinceWhen(since) + ":";
    el.querySelector(".cats-recap-body").innerHTML = sentences.map(function (x) { return "<p>" + x + "</p>"; }).join("");
    el.hidden = false;
  }

  // 2: your cat comes to say hello (or asks for dinner, or sulks if it's been a long time)
  function greet() {
    var c = cats[room.mine];
    if (!c || c.fighting || c.path.length || c.act) return;
    var away = Date.now() - lastVisit, hungry = fullness(c.data) < 0.25;
    if (hungry) { visit(c, EAT, function () { return { pose: "sit", ms: 3500, emote: "food" }; }); SFX.mew(c.data.look.seed); return; }
    if (away > 4 * 86400e3) { perform(c, "sit", 3500, "bang"); c.facing = -c.facing; c.say = { text: "Hmph.", until: now + 2500 }; return; }
    var front = ARENAS.map(function (k) { return SPOTS[k]; }).sort(function (p, q) { return project(q.x, q.y, 0).sy - project(p.x, p.y, 0).sy; })[0];
    visit(c, { x: front.x, y: front.y, z: 0 }, function () { SFX.mew(c.data.look.seed); return { pose: "happy", ms: 3200, emote: "heart" }; });
  }

  // 3: the gifts on its card, and collecting the new ones
  function giftsHtml(d) {
    var g = d.gifts || {}, keys = Object.keys(g).sort(function (a, b) { return (GIFT_RARE[b] || 0) - (GIFT_RARE[a] || 0) || g[b] - g[a]; });
    if (!keys.length) return '<li class="cats-empty">Nothing found yet.</li>';
    return keys.map(function (k) { return '<li class="gift r' + (GIFT_RARE[k] || 0) + '">' + esc(GIFT_NAME[k] || k).replace(/^an? /, "") + (g[k] > 1 ? " ×" + g[k] : "") + "</li>"; }).join("");
  }
  function collectGifts(c) {
    if (!(c.data.newGifts || []).length) return;
    var found = c.data.newGifts.map(function (x) { return GIFT_NAME[x.k] || "something"; });
    send(c, { action: "collect" }).then(function (d) {
      if (d.error) return;
      toast(esc(c.data.name) + " found " + esc(joinList(found)) + " while you were away!");
      perform(c, "happy", 2600, "heart"); SFX.mew(c.data.look.seed);
    });
  }

  // 4: a treat, a date, keeping apart (after picking the other cat). A date and Keep apart are once a day per cat, a
  // treat every 6 h (the Worker's rule): the buttons are greyed out until then, saying when
  var WAITS = { treat: 6, date: 24, apart: 24 };
  function cooldowns(d) {
    Object.keys(WAITS).forEach(function (k) {
      var b = card.querySelector('.cats-card-actions [data-act="' + k + '"]'), left = (d[k + "At"] || 0) + WAITS[k] * 3600e3 - Date.now();
      if (!b.dataset.label) b.dataset.label = b.textContent;
      b.disabled = left > 0;
      b.textContent = b.dataset.label + (left > 0 ? " · " + (left > 3600e3 ? Math.ceil(left / 3600e3) + "h" : Math.ceil(left / 60e3) + "m") : "");
      b.title = left > 0 ? "Again in " + b.textContent.split(" · ")[1] : "";
    });
  }
  var PAIR = { meet: "Click the cat you want yours to meet", treat: "Click the cat to share a treat with", date: "Click the cat to set yours up with", apart: "Click the cat to keep yours away from" };
  function pairAct(kind, o) {
    var c = cats[room.mine];
    endPick();
    if (!c) return;
    if (kind === "meet") { meet(o); return; }
    send(c, { action: kind, with: o.id }).then(function (d) {
      if (d.error) { toast(esc(d.error)); return; }
      var e = d.event, extra = d.extra || [];
      load();
      var said = sayOf(e, false) + extra.map(function (x) { return " <b>" + sayOf(x, false) + "</b>"; }).join("");
      if (kind === "apart") { perform(c, "sit", 2400, "bang"); toast(said); return; }
      visit(c, besideOf(c, o), function () {
        var pc = project(c.x, c.y, c.z), po = project(o.x, o.y, o.z);
        c.facing = po.sx > pc.sx ? 1 : -1; o.facing = -c.facing;
        toast(said);
        if (e.k === "treat") { perform(o, "eat", 3200, "food"); SFX.crunch(); return { pose: "happy", ms: 3200, emote: "heart" }; }
        if (e.k === "date") { perform(o, "happy", 4000, "heart"); SFX.purr(); return { pose: "happy", ms: 4000, emote: "heart" }; }
        o.facing = -o.facing; perform(o, "sit", 2600, "q"); // turned up their nose / not interested
        return { pose: "sit", ms: 2600, emote: "q" };
      });
    });
  }

  // 5: room events
  var roomEvent = null, eventNext = 0, sunPix = null, sunKey = "";
  function setEvent(ev) {
    var was = roomEvent && roomEvent.k;
    roomEvent = ev && ev.until > Date.now() ? ev : null;
    if (roomEvent && roomEvent.k !== was) { toast(esc(EVENT_SAY[roomEvent.k] || "")); eventNext = 0; }
    stormSound(!!(roomEvent && roomEvent.k === "storm"));
    if (!(roomEvent && roomEvent.k === "storm")) releaseAll();
    var bar = panel.querySelector(".cats-events");
    if (bar) bar.hidden = !room.owner;
  }
  function idleCats() { return Object.keys(cats).map(function (k) { return cats[k]; }).filter(function (c) { return !c.path.length && !c.act && !c.fighting && !c.hidden && !c.hiding && !isAway(c); }); }

  // The storm: cats hide (Nick: "no cats hide during thunderstorm that I saw"). In the cardboard boxes and the condo,
  // and behind furniture: floor points the room hides most of from where you're looking (just ears showing), worked
  // out for the current view; the rest flatten down where they are. They come out when it's over.
  var HIDE_SPOTS = ["box1", "box2", "tb1"];
  function hiddenness(x, y) { // how much of a cat standing there is behind the room (0..1)
    var p = project(x, y, 0), n = 0, hid = 0;
    for (var yy = -50; yy <= -4; yy += 5) for (var xx = -26; xx <= 26; xx += 6) {
      var sx = Math.round(p.sx + xx), sy = Math.round(p.sy + yy);
      if (sx < 0 || sy < 0 || sx >= CW || sy >= CH) continue;
      n++; var i = sy * CW + sx;
      if (depth[i] > p.d + 0.5 && zat[i] > 2) hid++;
    }
    return n ? hid / n : 0;
  }
  var hideKey = "", hidePoints = [];
  function hidePlaces() {
    if (roomDirty) renderRoom(); // hiddenness() reads the room's depth
    if (hideKey === String(rot) && hidePoints.length) return hidePoints;
    hideKey = String(rot); hidePoints = [];
    for (var x = 20; x < X - 20; x += 22) for (var y = 20; y < Y - 20; y += 22) {
      if (inObst(x, y)) continue;
      var h = hiddenness(x, y);
      if (h > 0.45 && h < 0.92) hidePoints.push({ x: x, y: y, z: 0, h: h });
    }
    hidePoints.sort(function (a, b) { return b.h - a.h; });
    // not two cats on top of each other
    var kept = [];
    hidePoints.forEach(function (p) { if (kept.every(function (q) { return Math.hypot(q.x - p.x, q.y - p.y) > 34; })) kept.push(p); });
    return (hidePoints = kept);
  }
  function hideAll() {
    if (!roomEvent || roomEvent.k !== "storm") return;
    var taken = {}, list = Object.keys(cats).map(function (k) { return cats[k]; });
    list.forEach(function (c) { if (c.spot) taken[c.spot] = 1; if (c.hideAt) taken[c.hideAt] = 1; });
    var spots = HIDE_SPOTS.filter(function (k) { return !taken[k]; }), floor = hidePlaces().filter(function (p) { return !taken[p.x + "," + p.y]; });
    list.forEach(function (c) {
      if (c.hiding || c.fighting || c.hidden || c.path.length || c.offSpot) return;
      if (HIDE_SPOTS.indexOf(c.spot) >= 0) { c.hiding = true; c.hideAt = c.spot; c.home = c.spot; hold(c, "crouch"); return; } // already in a box
      var home = c.spot, sp = spots.length ? spots.shift() : null, fp = !sp && floor.length ? nearest(floor, c) : null;
      if (!sp && !fp) { if (!c.act) perform(c, "crouch", 6000, Math.random() < 0.3 ? "bang" : null); return; }
      c.hiding = true; c.home = home;
      if (sp) { c.hideAt = sp; plan(c, sp, function () { c.spot = sp; hold(c, "crouch"); }); }
      else { floor.splice(floor.indexOf(fp), 1); c.hideAt = fp.x + "," + fp.y; plan(c, fp, function () { c.offSpot = true; hold(c, Math.random() < 0.5 ? "crouch" : "loaf"); }); }
      c.path.forEach(function (sg) { if (sg.type === "walk") sg.dur *= 0.5; }); // running for cover
      if (Math.random() < 0.4) c.emote = { kind: "bang", until: now + 1200 };
    });
  }
  function nearest(points, c) { return points.slice().sort(function (p, q) { return Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y); })[0]; }
  function releaseAll() {
    Object.keys(cats).forEach(function (k) {
      var c = cats[k];
      if (!c.hiding) return;
      c.hiding = false; c.act = null;
      var home = c.home || c.spot, from = c.hideAt;
      c.hideAt = null;
      if (home === from) { pickIdle(c); return; }
      plan(c, home); c.spot = home; c.offSpot = false;
    });
  }

  function eventLife() { // a cat now and then does the event's thing
    if (!roomEvent) return;
    if (roomEvent.until < Date.now()) { roomEvent = null; stormSound(false); releaseAll(); return; }
    if (now < eventNext) return;
    eventNext = now + 4000 + Math.random() * 6000;
    if (roomEvent.k === "storm") { hideAll(); return; } // everyone (that can) hides; checked again now and then for cats that come by
    var list = idleCats().filter(function (c) { return !isMine(c.id) || !room.mine; });
    if (!list.length) return;
    var c = list[Math.floor(Math.random() * list.length)];
    if (roomEvent.k === "storm") { hideAll(); return; }
    if (roomEvent.k === "sunbeam") { visit(c, sunSpot(), function () { return { pose: Math.random() < 0.7 ? "sleep" : "loaf", ms: 60000 + Math.random() * 90000, emote: "z" }; }); return; }
  }
  // The sunbeam (Nick: a glow from the window, halfway into the room, room for more cats): the light falls from the
  // window (wall x = 0, y 150-280) across the floor to x = 300, fanning out a little; BEAM is that patch of floor
  var BEAM = [[62, 140], [62, 290], [300, 350], [300, 190]];
  function inObst(x, y) { return OBST.some(function (o) { return x > o[0] - 14 && x < o[1] + 14 && y > o[2] - 14 && y < o[3] + 14; }); }
  function sunSpot() { // somewhere in the beam a cat can lie down (not under the cabinet, the couch...)
    for (var n = 0; n < 30; n++) {
      var u = Math.random(), v = Math.random();
      var x = 70 + u * 220, y0 = 140 + u * 50, y1 = 290 + u * 60, y = y0 + v * (y1 - y0);
      if (!inObst(x, y)) return { x: x, y: y, z: 0 };
    }
    return { x: 200, y: 260, z: 0 };
  }
  // The storm's soundtrack: Nick's recording (sounds/storm.mp3, 9 min 42 s of rain and thunder, replaced 2026-10-15),
  // looped while the storm lasts, with the lightning on its thunder cracks (found in the recording: STORM_HITS,
  // seconds; 1 = a big one, flashes brighter). Between cracks more than 40 s apart, a faint distant flicker now and then.
  var STORM_HITS = [[11.4, 0], [44.7, 1], [49.8, 1], [60.2, 0], [65.75, 0], [108.4, 0], [209.3, 0], [231.25, 0], [357.4, 1], [491.2, 1], [506.7, 1], [512.25, 0]];
  var lastHitAt = 0;
  var stormAudio = null, stormWait = null, lastStormT = 0;
  function stormSound(on) {
    if (on && soundOn) {
      if (!stormAudio) { stormAudio = new Audio(SOUND_DIR + "storm.mp3"); stormAudio.loop = true; stormAudio.volume = 0.6; }
      var p = stormAudio.play();
      if (p && p.catch) p.catch(function () { // the browser wants a tap first
        if (stormWait) return;
        stormWait = function () { document.removeEventListener("pointerdown", stormWait); stormWait = null; if (roomEvent && roomEvent.k === "storm") stormSound(true); };
        document.addEventListener("pointerdown", stormWait);
      });
    } else if (stormAudio) stormAudio.pause();
  }
  var flash = { until: 0, big: 0, bolt: null }, nextFlash = 0;
  function lightning(big) {
    if (reduceMotion) return; // no flashing light for people who've asked their device for less motion (Nick: yes)
    flash.until = now + (big ? 260 : 150); flash.big = big;
    // a bolt in window coordinates: from the top of the glass down, zigzagging, with a branch
    var a = WIN.y0 + 20 + Math.random() * (WIN.y1 - WIN.y0 - 40), z = WIN.z1, pts = [[a, z]];
    while (z > WIN.z0 + 20) { z -= 6 + Math.random() * 10; a += (Math.random() - 0.5) * 16; pts.push([a, z]); }
    flash.bolt = pts;
  }
  function stormTick() { // flashes on the recording's cracks while it plays, otherwise now and then
    var playing = stormAudio && !stormAudio.paused;
    if (playing) {
      var t = stormAudio.currentTime;
      STORM_HITS.forEach(function (h) { if ((lastStormT < h[0] && t >= h[0]) || (t < lastStormT && t >= h[0] && h[0] < 0.5)) { lightning(h[1]); lastHitAt = now; } });
      lastStormT = t;
      if (now - lastHitAt > 40000 && now > nextFlash) { nextFlash = now + 25000 + Math.random() * 25000; lightning(0); flash.bolt = null; flash.until = now + 90; } // far off, no thunder
    } else if (now > nextFlash) { nextFlash = now + 7000 + Math.random() * 9000; lightning(Math.random() < 0.4); }
  }
  function nearBolt(a, z) { // how far (in window units) a point is from the bolt, across
    var p = flash.bolt, best = 9;
    if (!p) return best;
    for (var i = 1; i < p.length; i++) {
      var a0 = p[i - 1][0], z0 = p[i - 1][1], a1 = p[i][0], z1 = p[i][1];
      if (z > z0 || z < z1) continue;
      var f = (z0 - z) / (z0 - z1 || 1), x = a0 + (a1 - a0) * f;
      best = Math.min(best, Math.abs(a - x));
    }
    return best;
  }

  // ---------- winter: ball ornaments dangling from the tree that cats swat (they swing), and the opened present a
  // cat curls up in (Nick: "dangling ball ornaments on the tree that cats can go play with. animate the ball swinging
  // when they swat at it")
  var ORN_C = ["#d8343e", "#ffd23f", "#4a8fe0", "#b07ad6", "#f4f1e8", "#7ee0b5"];
  // hang: a point on a tier's bottom edge; play: the floor a cat swats from (null: too high, it only sways)
  // hung round all four sides of every tier, from each tier's eave over the one below (the bottom tier's hang low,
  // where a cat can reach them: play = the floor it swats from, if that's in the room and clear)
  var TREE_C = [556, 86], TIERS = [[40, 16, 62], [33, 52, 98], [26, 88, 132], [19, 122, 162], [11, 154, 186]];
  var ORNS = [];
  TIERS.slice(0, 4).forEach(function (t, i) {
    var half = t[0] + 1, z = i ? TIERS[i - 1][2] + 4 : t[1], offs = i === 0 ? [-20, 18] : i === 1 ? [-12, 14] : i === 2 ? [-9, 8] : [3];
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (f, k) {
      offs.forEach(function (o, j) {
        var x = TREE_C[0] + f[0] * half + (f[0] ? 0 : o), y = TREE_C[1] + f[1] * half + (f[1] ? 0 : o), orn = { x: x, y: y, z: z, side: f };
        if (i === 0) { // swatted from the floor 24 out: in the room, clear, and not on the yellow bed (520-584, 140-204)
          var px2 = x + f[0] * 24, py2 = y + f[1] * 24, onBed = px2 > 510 && px2 < 594 && py2 > 130 && py2 < 214;
          if (px2 > 20 && px2 < X - 20 && py2 > 20 && py2 < Y - 20 && !inObst(px2, py2) && !onBed) orn.play = { x: px2, y: py2 };
        }
        ORNS.push(orn);
      });
    });
  });
  ORNS.forEach(function (o, i) { o.c = ORN_C[(i * 7) % ORN_C.length]; o.ang = 0; o.vel = 0; o.len = o.z < 30 ? 9 : 7; o.ph = i * 1.7; });
  var ornT = 0, winterNext = 0, boxBusyUntil = 0;
  function swingOrnaments() {
    var dt = Math.min(0.05, ornT ? (now - ornT) / 1000 : 0.016); ornT = now;
    ORNS.forEach(function (o) { // a damped pendulum, plus the faintest sway
      o.vel += (-26 * Math.sin(o.ang) - 1.4 * o.vel) * dt;
      o.ang += o.vel * dt;
    });
  }
  function drawOrnaments() {
    swingOrnaments();
    var ink = H("#1a1418"), str = H("#d8cfb8");
    var mid = project(TREE_C[0], TREE_C[1], 0).d;
    ORNS.forEach(function (o) {
      var p = project(o.x, o.y, o.z), hx = p.sx, hy = p.sy, a = o.ang + Math.sin(now / 1100 + o.ph) * 0.05;
      if (p.d < mid) return; // the far side of the tree, from here
      var bx = hx + Math.sin(a) * o.len, by = hy + Math.cos(a) * o.len;
      function put(x, y, col) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= CW || y >= CH) return; var q = y * CW + x; if (depth[q] > p.d + 1 && zat[q] > o.z - 6 && !TREEID[ids[q]]) return; out[q] = col; }
      for (var t = 0; t < 1; t += 0.1) put(hx + (bx - hx) * t, hy + (by - hy) * t, str); // the string
      var col = H(o.c), shine = H("#ffffff"), r = o.z < 30 ? 4 : 3;
      for (var yy = -r - 1; yy <= r + 1; yy++) for (var xx = -r - 1; xx <= r + 1; xx++) {
        var d = Math.hypot(xx, yy);
        if (d > r + 1) continue;
        put(bx + xx, by + r + yy, d > r ? ink : (xx === -1 && yy === -2) ? shine : col);
      }
      put(bx, by - 1, H("#c9a227")); // the cap
    });
  }
  function winterLife() { // now and then: a cat swats an ornament, or curls up in the opened present
    if (season() !== "winter" || now < winterNext) return;
    winterNext = now + 9000 + Math.random() * 14000;
    var list = idleCats();
    if (!list.length) return;
    var c = list[Math.floor(Math.random() * list.length)];
    if (Math.random() < 0.35 && now > boxBusyUntil) { // into the box
      var ms = 40000 + Math.random() * 50000;
      boxBusyUntil = now + ms + 15000;
      visit(c, { x: (OPEN_BOX[0] + OPEN_BOX[1]) / 2, y: (OPEN_BOX[2] + OPEN_BOX[3]) / 2, z: 0 }, function () { return { pose: Math.random() < 0.5 ? "loaf" : "sit", ms: ms, emote: Math.random() < 0.5 ? "heart" : null }; });
      return;
    }
    var o = ORNS.filter(function (x) { return x.play && Math.abs(x.vel) < 0.3; });
    o = o[Math.floor(Math.random() * o.length)];
    if (!o) return;
    visit(c, { x: o.play.x, y: o.play.y, z: 0 }, function () {
      var pc = project(c.x, c.y, 0), po = project(o.x, o.y, 0), dir = po.sx > pc.sx ? 1 : -1;
      c.facing = dir;
      o.vel += dir * (3.2 + Math.random() * 1.6); // whack
      setTimeout(function () { o.vel += dir * (2.4 + Math.random() * 1.6); if (Math.random() < 0.5) SFX.jingle(); }, 1300); // and again
      return { pose: function (t) { return t % 1300 < 700 ? "bat" : "crouch"; }, ms: 2800, emote: "note" };
    });
  }

  // ---------- the seasons (Nick: Halloween, winter, spring): by the visitor's date; ?season=halloween|winter|spring|none previews one ----------
  function season() {
    if (SEASON_PREVIEW) return SEASON_PREVIEW === "none" ? null : SEASON_PREVIEW;
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate(), md = m * 100 + day;
    if (md >= 1010 && md <= 1102) return "halloween";
    if (md >= 1201 || md <= 110) return "winter";
    if (md >= 320 && md <= 531) return "spring";
    return null;
  }
  // a little pixel picture on the floor of the room (pumpkins, the tree), hidden by the room where it's behind something
  function stamp(map, cols, wx, wy, wz) { // drawn 2 x 2 per pixel, like the cats' hats
    var P = 2, p = project(wx, wy, wz || 0), wd = map[0].length, x0 = Math.round(p.sx - wd * P / 2), y0 = Math.round(p.sy - map.length * P);
    for (var j = 0; j < map.length; j++) for (var i = 0; i < wd; i++) {
      var ch = map[j][i];
      if (ch === "." || !cols[ch]) continue;
      for (var yy = 0; yy < P; yy++) for (var xx = 0; xx < P; xx++) {
        var x = x0 + i * P + xx, y = y0 + j * P + yy;
        if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
        var q = y * CW + x;
        if (depth[q] > p.d + 0.5 && zat[q] > 2) continue;
        out[q] = cols[ch];
      }
    }
  }
  var PUMPKIN_AT = [[200, 20], [470, 40], [586, 250], [230, 430]]; // checked clear of OBST (with a margin) and the cats' spots
  var PUMPKIN = ["......oo......", ".....o*o......", "..oooooooooo..", ".o##########o.", "o###yy##yy###o", "o###yy##yy###o", "o############o", "o##yyyyyyyy##o", "o###yy##yy###o", ".o##########o.", "..oooooooooo.."];
  var COBWEB = ["o.o.o.o.o.o", ".o..o..o..o", "o.o.o.o.o..", "..o..o..o..", "o..o.o.o...", "...o..o....", "o...o.o....", "....o......", "o...o......", ".....o.....", "o..........", ];
  function drawSeason() {
    var sz = season();
    if (!sz) return;
    if (sz === "halloween") {
      var glow = Math.sin(now / 260) > 0.2 ? "#ffd84a" : "#ffb02e";
      var pc = { o: H("#5a2a08"), "#": H("#f08a24"), y: H(glow), "*": H("#4a8a3a") };
      // on clear floor only (Nick: one ended up in the water bowl): never on furniture, the bowls or a cat's spot
      PUMPKIN_AT.forEach(function (w) { if (!inObst(w[0], w[1])) stamp(PUMPKIN, pc, w[0], w[1], 0); });
      var c0 = project(0, 0, WALL - 4), cx = Math.round(c0.sx), cy = Math.round(c0.sy), web = H("#d8d4cc");
      for (var j = 0; j < COBWEB.length; j++) for (var i = 0; i < COBWEB[j].length; i++) {
        if (COBWEB[j][i] === ".") continue;
        [[cx + i, cy + j], [cx - i, cy + j]].forEach(function (q) { if (q[0] >= 0 && q[1] >= 0 && q[0] < CW && q[1] < CH && zat[q[1] * CW + q[0]] > WALL - 60) out[q[1] * CW + q[0]] = web; });
      }
    }
    // (winter: the Christmas tree is part of the room itself now, built of blocks; see TREE_OBST; its ornaments swing)
    if (sz === "winter") drawOrnaments();
  }
  // the season outside the window (when there's no storm): bats at Halloween, snow in winter, birds in spring
  function seasonWindow(p, a, z) {
    var sz = season();
    if (sz === "winter") {
      if (z < WIN.z0 + 6) return "#f4f7fb"; // snow on the sill outside
      for (var k = 0; k < 3; k++) { // three layers of flakes falling, drifting
        var fa = (a + Math.sin((z + now / 30) / 9 + k) * 2 + k * 7) % (9 + k * 2), fz = (z + now / (40 - k * 8) + k * 13) % (11 + k * 3);
        if (fa < 1 && fz < 1) return "#ffffff";
      }
      return null;
    }
    if (sz === "halloween") { // two bats flapping across
      for (var b = 0; b < 2; b++) {
        var span = WIN.y1 - WIN.y0 + 40, bx = WIN.y0 - 20 + ((now / (55 + b * 20) + b * 70) % span), bz = WIN.z0 + 70 + b * 28 + Math.sin(now / 300 + b) * 6;
        var dx = a - bx, dz = z - bz, wing = Math.floor(now / 140 + b) % 2 ? 2 : -2;
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) return "#141018";
        if (Math.abs(dx) <= 5 && Math.abs(dx) > 1 && Math.abs(dz - wing * (Math.abs(dx) - 1) / 4) < 1) return "#141018";
      }
      return null;
    }
    if (sz === "spring") { // two birds on the sill, hopping now and then
      for (var q = 0; q < 2; q++) {
        var hop = Math.floor(now / 1700 + q * 3) % 4 === 0 ? 3 : 0, bx2 = WIN.y0 + 30 + q * 52, bz2 = WIN.z0 + 4 + hop;
        var ex = a - bx2, ez = z - bz2;
        if (ex * ex / 16 + ez * ez / 9 <= 1) return q ? "#c8743a" : "#5a7fbf"; // body
        if (Math.abs(ex - (q ? -4 : 4)) <= 1.5 && ez > 1 && ez < 5) return q ? "#c8743a" : "#5a7fbf"; // head
        if (Math.abs(ex - (q ? -6 : 6)) < 1 && Math.abs(ez - 3) < 1) return "#ffb02e"; // beak
      }
      return null;
    }
    return null;
  }

  // the window's glass, redrawn each frame during an event: a storm sky (clouds racing, rain, the bolt) or bright sun
  var winCol = {};
  function wc(hex, k) { var key = hex + k; return winCol[key] || (winCol[key] = shade(H(hex), k)); }
  function drawWindowFx() {
    if (!WINPIX.length) return;
    var storm = !!roomEvent && roomEvent.k === "storm", sun = !!roomEvent && roomEvent.k === "sunbeam";
    if (!storm && !sun) { // no event: only the season, over the usual sky
      if (!season()) return;
      for (var m = 0; m < WINPIX.length; m++) {
        var w = WINPIX[m];
        if (ids[w.i] !== WIN_N) continue;
        var sc = seasonWindow(w, w.a, w.z);
        if (sc) out[w.i] = wc(sc, w.k);
      }
      return;
    }
    if (storm) stormTick();
    var lit = now < flash.until, drift = now / 90;
    for (var n = 0; n < WINPIX.length; n++) {
      var p = WINPIX[n];
      if (ids[p.i] !== WIN_N) continue; // something in front of the window here
      var a = p.a, z = p.z, f = (z - WIN.z0) / (WIN.z1 - WIN.z0), col;
      if (storm) {
        var bd = lit ? nearBolt(a, z) : 9;
        if (bd < 1.4) col = "#ffffff";
        else if (bd < 3.6) col = "#d9e6ff"; // its glow
        else {
          // heavy clouds racing across, lighter at the top
          var cl = Math.sin((a + drift) / 9 + z / 17) + Math.sin((a * 0.7 - drift * 0.6) / 6 + z / 9) + Math.cos(z / 7 + drift / 40) + f * 0.8;
          col = cl > 1.8 ? "#8a93a6" : cl > 1.1 ? "#6e7689" : cl > 0.3 ? "#575e6f" : cl > -0.5 ? "#454b5a" : "#363b48";
          if (lit) col = flash.big ? (cl > 0.6 ? "#a9b4cc" : "#8793ad") : (cl > 0.6 ? "#8f99b0" : "#727c93");
          // rain: slanted streaks falling (along a + 0.4 z = constant), in dashes
          var line = (a * 2.5 + z) % 17, dash = (z - a * 0.4 + now / 9) % 26;
          if (line < 1.4 && (dash < 0 ? dash + 26 : dash) < 8) col = lit ? "#cdd8ea" : "#b4c2d8";
        }
      } else col = f > 0.6 ? "#fff6d8" : f > 0.3 ? "#ffefc0" : "#ffe6a6"; // the sun pouring in
      // the room is darkened afterwards (drawEvent); the window is outside, so it's drawn brighter to come out right
      out[p.i] = wc(col, storm ? p.k / (lit ? (flash.big ? 1.3 : 1.1) : 0.62) : p.k);
    }
  }
  // the light falling through the room: a faint shaft from the window to the floor, and the bright patch on the floor
  var beamPix = null, shaftPix = null, beamKey = "";
  function polyPix(q, test) {
    var xs = q.map(function (p) { return p[0]; }), ys = q.map(function (p) { return p[1]; }), list = [];
    for (var y = Math.max(0, Math.floor(Math.min.apply(0, ys))); y < Math.min(CH, Math.ceil(Math.max.apply(0, ys))); y++)
      for (var x = Math.max(0, Math.floor(Math.min.apply(0, xs))); x < Math.min(CW, Math.ceil(Math.max.apply(0, xs))); x++) {
        var inside = false;
        for (var a = 0, b = q.length - 1; a < q.length; b = a++) if ((q[a][1] > y) !== (q[b][1] > y) && x < (q[b][0] - q[a][0]) * (y - q[a][1]) / (q[b][1] - q[a][1]) + q[a][0]) inside = !inside;
        if (inside && (!test || test(y * CW + x))) list.push(y * CW + x);
      }
    return list;
  }
  function hull(pts) { // convex hull (screen points), so the shaft is one shape whichever way the room is turned
    pts = pts.slice().sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    pts.forEach(function (p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    pts.slice().reverse().forEach(function (p) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); });
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function sunPixels() {
    var key = rot + "|" + WINPIX.length;
    if (beamKey === key && beamPix) return;
    beamKey = key;
    var floor = BEAM.map(function (w) { var p = project(w[0], w[1], 0); return [p.sx, p.sy]; });
    beamPix = polyPix(floor, function (i) { return zat[i] <= 1; });
    var win = [[0, WIN.y0, WIN.z1], [0, WIN.y1, WIN.z1], [0, WIN.y0, WIN.z0], [0, WIN.y1, WIN.z0]].map(function (w) { var p = project(w[0], w[1], w[2]); return [p.sx, p.sy]; });
    shaftPix = polyPix(hull(win.concat(floor)));
  }
  function drawEvent() {
    if (!roomEvent) return;
    var d = img.data, i, n = d.length;
    if (roomEvent.k === "storm") {
      var lit = now < flash.until, k = lit ? (flash.big ? 1.3 : 1.1) : 0.62, kb = lit ? (flash.big ? 1.3 : 1.12) : 0.78; // darker, a little blue; the room lights up in a flash
      for (i = 0; i < n; i += 4) { d[i] = d[i] * k; d[i + 1] = d[i + 1] * k; d[i + 2] = d[i + 2] * kb; }
      return;
    }
    if (roomEvent.k === "sunbeam") {
      sunPixels();
      var j, sh = 0.09 + Math.sin(now / 1400) * 0.015; // the dust in the air shimmers a little
      for (j = 0; j < shaftPix.length; j++) { i = shaftPix[j] * 4; d[i] = d[i] + (255 - d[i]) * sh; d[i + 1] = d[i + 1] + (244 - d[i + 1]) * sh; d[i + 2] = d[i + 2] + (200 - d[i + 2]) * sh * 0.7; }
      for (j = 0; j < beamPix.length; j++) { i = beamPix[j] * 4; d[i] = d[i] + (255 - d[i]) * 0.42; d[i + 1] = d[i + 1] + (238 - d[i + 1]) * 0.38; d[i + 2] = d[i + 2] + (165 - d[i + 2]) * 0.2; }
      return;
    }
  }

  // 8: the diary, one line a day from the cat's history, in its own voice (the same line every time for a given day)
  var DIARY = {
    love: ["I think I'm in love with {b}. Don't tell anyone.", "{b}. That's it. That's the entry.", "Fell for {b} today. My whiskers are tingling."],
    breakup: ["{b} and I are over. I'll be on the shelf, staring at the wall.", "It's done with {b}. I need a long nap."],
    rivals: ["{b} is my sworn enemy now. I will remember this.", "Note to self: never trust {b}."],
    makeup: ["{b} and I made up. I suppose they're alright.", "Called a truce with {b}. For now."],
    friends: ["{b} is my best friend. We have a whole system.", "Me and {b}: inseparable."],
    date: ["Went on a date with {b}. They smelled nice.", "Date with {b}. Would recommend."],
    found: ["Found {g}. It's mine now.", "Look what I found: {g}. Treasure.", "Brought home {g}. My human had better appreciate this."],
    mean: ["{b} stole my spot again. I will remember this.", "Had words with {b}. Mostly hissing.", "{b} looked at me funny. I looked back funnier."],
    cuddle: ["Cuddled up with {b}. Warm. Ten out of ten.", "Long nap on {b}. Best pillow in the room."],
    nice: ["Spent the afternoon with {b}. Not bad.", "{b} and I shared a sunbeam. Peaceful.", "Groomed {b}. They needed it."],
    owner: ["My human came by. Snacks were had.", "Got pets today. Acceptable.", "My human visited. I pretended not to care."],
    treat: ["Got a treat out of making peace with {b}. Worth it.", "{b} ate my treat and we're fine now, apparently."],
    hungry: ["Nobody fed me. I am wasting away.", "Hungry. Writing this from the bowl."],
    wander: ["Moved to {s}. A change of scenery.", "Tried out {s}. It'll do."],
    event: ["There was a storm. I was not scared. I was hiding for strategic reasons.", "Something happened in the room today. I watched."],
  };
  DIARY.kitten = ["We had a kitten! {c}. Look at those tiny paws.", "A kitten. Our kitten. {c}. I am very tired."];
  DIARY.back = ["{p}", "Back home. {p}"];
  DIARY.adventure = ["Going out. Don’t wait up.", "The window was open. I had places to be."];
  DIARY.kind = ["{by} gave me a treat. A stranger with taste.", "Someone called {by} petted me. I allowed it."];
  var DIARY_ORDER = ["kitten", "love", "breakup", "back", "rivals", "makeup", "friends", "date", "adventure", "found", "kind", "treat", "cuddle", "mean", "owner", "nice", "hungry", "wander"];
  function diaryKind(e) {
    if (DIARY[e.k] && e.k !== "found") return e.k;
    if (e.k === "found") return "found";
    if (MEAN_K[e.k] || e.k === "treatno" || e.k === "datefail") return "mean";
    if (e.k === "fed" || e.k === "pet" || (e.k === "play" && !e.b)) return "owner";
    if (NICE_K[e.k] && e.b) return "nice";
    return null;
  }
  function hashStr(t) { var h = 7; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }
  function diary(id) {
    var all = (room.mineLog || []).concat(room.log), keep = {}, days = {};
    all.forEach(function (e) {
      if (e.a !== id && e.b !== id) return;
      var key = e.t + e.k + e.a; if (keep[key]) return; keep[key] = 1;
      var k = diaryKind(e); if (!k) return;
      var day = new Date(e.t).toDateString();
      var rank = DIARY_ORDER.indexOf(k);
      if (!days[day] || rank < days[day].rank) days[day] = { rank: rank, k: k, e: e, t: e.t };
    });
    var list = Object.keys(days).map(function (k) { return days[k]; }).sort(function (a, b) { return b.t - a.t; }).slice(0, 5);
    if (!list.length) return '<li class="cats-empty">Nothing written yet.</li>';
    return list.map(function (x) {
      var opts = DIARY[x.k], line = opts[hashStr(id + new Date(x.t).toDateString()) % opts.length], e = x.e;
      var b = e.a === id ? e.bn : e.an, bid = e.a === id ? e.b : e.a;
      line = esc(line).replace("{b}", bid ? catName(bid, b) : "someone").replace("{g}", esc(GIFT_NAME[e.g] || "something")).replace("{s}", esc(spotLabel(e.s)))
        .replace("{c}", e.c ? catName(e.c, e.cn) : "").replace("{p}", esc(e.text || "")).replace("{by}", esc(e.by || "Someone"));
      var when = Date.now() - x.t < 6 * 86400e3 ? new Date(x.t).toLocaleDateString("en-US", { weekday: "long" }) : new Date(x.t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return "<li><b>" + when + ".</b> " + line + "</li>";
    }).join("");
  }


  // ================= the second update (Nick, 2026-10-15: kittens, kindness, wearing gifts, tricks, adventures,
  // the Times, the seasons, snapshots) =================
  var DAY = 864e5;
  // kittens are small, growing to full size over their first 14 days (the Worker's KITTEN_DAYS)
  function kittenScale(d) { if (!d.kitten) return 1; var age = (Date.now() - d.born) / DAY; return age >= 14 ? 1 : 0.55 + 0.45 * Math.max(0, age) / 14; }
  function isKittenNow(d) { return !!d.kitten && Date.now() - d.born < 14 * DAY; }
  function isAway(c) { return !!(c && c.data.away && c.data.away.until > Date.now()); }
  // the picture made smaller round its feet (nearest pixel, so it stays pixel art); head and neck move with it
  function shrink(sp, k) {
    var out = new Uint32Array(sp.w * sp.h), ax = sp.ax, ay = sp.ay;
    for (var y = 0; y < sp.h; y++) for (var x = 0; x < sp.w; x++) {
      var sx = Math.round(ax + (x - ax) / k), sy = Math.round(ay + (y - ay) / k);
      if (sx >= 0 && sy >= 0 && sx < sp.w && sy < sp.h) out[y * sp.w + x] = sp.px[sy * sp.w + sx];
    }
    function at(p) { return { x: ax + (p.x - ax) * k, y: ay + (p.y - ay) * k, top: p.top == null ? undefined : ay + (p.top - ay) * k, r: p.r && p.r * k }; }
    return { w: sp.w, h: sp.h, px: out, ax: ax, ay: ay, facing: sp.facing, head: at(sp.head), neck: at(sp.neck), k: k };
  }

  // things worn on the head or neck: a gift the cat has found (its owner picks one), or at Halloween a costume.
  // Little pixel pictures: "#" the colour, "*" the second colour, "o" the dark edge
  var WEAR = {
    crown: { at: "top", map: [".o..o..o.", "o#oo#oo#o", "o#######o", "o#*#*#*#o", "ooooooooo"], c: ["#ffd23f", "#ff4d6d", "#7a5a10"] },
    ribbon: { at: "back", map: ["oo...oo", "o#o.o#o", "o##o##o", "o#o.o#o", "oo...oo"], c: ["#ff6fa6", "#ff6fa6", "#8a2a52"] },
    bell: { at: "neck", map: ["ooooooooooo", "o#########o", "ooooo*ooooo", "....o*o....", "....ooo...."], c: ["#d8434e", "#ffd23f", "#5a1a20"] },
    feather: { at: "back", map: ["..*.", ".**.", ".*#.", "*##.", "*#..", "##..", "#...", "o..."], c: ["#7ad7c8", "#ff7aa8", "#2c5a55"] },
    clover: { at: "back", map: [".##.##.", "#######", ".#####.", "..###..", "...o..."], c: ["#5fae4e", "#5fae4e", "#2f6b2a"] },
    leaf: { at: "top", map: ["..##..", ".####.", "######", ".####.", "..o..."], c: ["#7cbf4f", "#7cbf4f", "#3b6b22"] },
    sock: { at: "top", map: ["..oooo.", ".o#*#*o", ".o*#*#o", "o#*#*#o", "o*#*#*o", "ooooooo"], c: ["#f2efe8", "#d8434e", "#5a3a3a"] },
    // Halloween costumes
    witch: { at: "top", map: ["....o....", "...o#o...", "...o#o...", "..o###o..", "..o***o..", ".o#####o.", "ooooooooo"], c: ["#2a2333", "#8e5bd6", "#0d0a12"] },
    horns: { at: "horns", map: [".o.....o.", "o#o...o#o", "o#o...o#o", ".o.....o."], c: ["#d8343e", "#d8343e", "#5a1015"] },
    pumpkin: { at: "top", map: ["...oo...", "..o*o...", ".oooooo.", "o######o", "o#o##o#o", "o######o", ".oooooo."], c: ["#f08a24", "#4a8a3a", "#7a3a0a"] },
  };
  var COSTUMES = ["witch", "horns", "pumpkin"];
  function wearOf(c) {
    if (c.data.wear && WEAR[c.data.wear]) return c.data.wear;
    if (season() === "halloween") return COSTUMES[hashStr(c.id) % COSTUMES.length];
    return null;
  }
  // what a cat is wearing, pixel by pixel in its picture's coordinates: put(x, y, colour)
  function wearPixels(c, sp, put) {
    var k = wearOf(c);
    if (!k || !sp.head) return;
    // each pixel of the little picture is drawn 2 x 2 (1 x 1 on a small kitten), so it reads at the room's size
    var w = WEAR[k], m = w.map, f = sp.facing || 1, h = sp.head, s2 = sp.k || 1, P = s2 < 0.8 ? 1 : 2, cx, top;
    var headTop = h.top == null ? h.y - 14 * s2 : h.top, wd = m[0].length, ht = m.length * P;
    if (w.at === "neck") { cx = sp.neck.x; top = sp.neck.y - P; }
    else if (w.at === "back") { cx = h.x - f * 9 * s2; top = headTop - ht + 4 * P; }
    else if (w.at === "horns") { cx = h.x + f * s2; top = headTop - ht + 3 * P; }
    else { cx = h.x - f * s2; top = headTop - ht + 2 * P; }
    var cols = { "#": H(w.c[0]), "*": H(w.c[1]), "o": H(w.c[2]) };
    for (var j = 0; j < m.length; j++) for (var i = 0; i < wd; i++) {
      var ch = m[j][f < 0 ? wd - 1 - i : i];
      if (ch === ".") continue;
      for (var yy = 0; yy < P; yy++) for (var xx = 0; xx < P; xx++) put(Math.round(cx - wd * P / 2 + i * P + xx), Math.round(top + j * P + yy), cols[ch]);
    }
  }
  function drawWear(c, sp, ox, oy, cd, cz) {
    wearPixels(c, sp, function (x, y, col) {
      var sx = ox + x, sy = oy + y;
      if (sx < 0 || sy < 0 || sx >= CW || sy >= CH) return;
      var q = sy * CW + sx;
      if (depth[q] > cd + 0.5 && zat[q] > cz + 2 && !WALLID[ids[q]]) return; // behind the room, like the cat
      out[q] = col;
    });
  }

  // tricks: learned by checking in on different days (the Worker counts them: days); missing a day only pauses it
  var TRICKS = [[2, "sit", "Sit"], [4, "highfive", "High-five"], [7, "spin", "Spin"], [10, "roll", "Roll over"], [14, "flip", "Backflip"]];
  function tricksOf(d) { return TRICKS.filter(function (t) { return (d.days || 0) >= t[0]; }); }
  function doTrick(c, k) {
    var f0 = c.facing;
    if (k === "sit") perform(c, "sit", 2200, "note");
    else if (k === "highfive") perform(c, function (t) { return Math.floor(t / 500) % 2 ? "bat" : "sit"; }, 2400, "heart");
    else if (k === "spin") perform(c, function (t) { c.facing = Math.floor(t / 140) % 2 ? -f0 : f0; return "stand"; }, 2000, "note", function () { c.facing = f0; });
    else if (k === "roll") perform(c, function (t) { return Math.floor(t / 450) % 3 === 1 ? "sleep" : Math.floor(t / 450) % 3 === 2 ? "happy" : "loaf"; }, 2800, "heart");
    else perform(c, function (t) { return Math.floor(t / 280) % 3 === 0 ? "crouch" : "jump"; }, 2400, "bang");
    SFX.mew(c.data.look.seed);
  }
  function trickNews() { // "Mochi learned a new trick" the first time you see it
    (room.mines || []).forEach(function (id) {
      var c = cats[id]; if (!c) return;
      var n = tricksOf(c.data).length, key = "nm-cats-tricks-" + id, had = null;
      try { had = localStorage.getItem(key); } catch (e) {}
      if (had !== null && n > +had) toast(esc(c.data.name) + " learned a new trick: <b>" + TRICKS[n - 1][2] + "</b>!");
      try { localStorage.setItem(key, String(n)); } catch (e) {}
    });
  }

  // kindness to someone else's cat (once a day each; this browser remembers so the buttons can say so)
  function kindDone(id, what) { try { return (JSON.parse(localStorage.getItem("nm-cats-kind") || "{}")[id + ":" + what]) === new Date().toDateString(); } catch (e) { return false; } }
  function kindMark(id, what) { try { var m = JSON.parse(localStorage.getItem("nm-cats-kind") || "{}"), today = new Date().toDateString(); Object.keys(m).forEach(function (k) { if (m[k] !== today) delete m[k]; }); m[id + ":" + what] = today; localStorage.setItem("nm-cats-kind", JSON.stringify(m)); } catch (e) {} }
  function giveKind(c, what) {
    var by = ""; try { by = localStorage.getItem("nm-name") || ""; } catch (e) {}
    send(c, { action: "kind", what: what, by: by }).then(function (d) {
      if (d.error) { toast(esc(d.error)); if (/already/.test(d.error)) { kindMark(c.id, what); openCard(c.id); } return; }
      kindMark(c.id, what);
      if (what === "treat") { perform(c, "eat", 3000, "food"); SFX.crunch(); } else { perform(c, "happy", 3000, "heart"); SFX.purr(); }
      toast("You gave " + esc(c.data.name) + " a " + what + ". " + esc(c.data.ownerName || "Its owner") + " will hear about it.");
      openCard(c.id);
    });
  }

  // ---------- the sprites ----------
  // a cat is drawn again only when its picture changes (the walk at 12 frames a second, sitting about at 6)
  var FPS = { walk: 12, jump: 1, crouch: 14, bat: 12, groom: 10, eat: 10, hiss: 14 };
  function spriteOf(c) {
    var fps = FPS[c.pose] || 6, frame = reduceMotion ? 0 : Math.floor(now / 1000 * fps);
    var ks = kittenScale(c.data), key = c.pose + "|" + frame + "|" + c.facing + "|" + Math.round(ks * 40);
    if (key !== c.key) {
      var sp = CD.render(c.data.look, c.pose, frame / fps, c.facing);
      if (ks < 1) sp = shrink(sp, ks);
      // the box round its pixels, so drawing it skips the empty edges
      var x0 = sp.w, x1 = 0, y0 = sp.h, y1 = 0;
      for (var y = 0; y < sp.h; y++) for (var x = 0; x < sp.w; x++) if (sp.px[y * sp.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      sp.bx0 = x0; sp.bx1 = x1; sp.by0 = y0; sp.by1 = y1;
      c.sprite = sp; c.key = key;
    }
    return c.sprite;
  }

  // ---------- each frame ----------
  var drawn = []; // the cats drawn this frame, front last (for clicks)
  var hover = null, selected = null, pickMode = null, toy = null;
  function drawCat(c, glow) {
    var sp = spriteOf(c), p = project(c.x, c.y, c.z);
    var ox = Math.round(p.sx) - sp.ax, oy = Math.round(p.sy) - sp.ay, cd = p.d, cz = c.z;
    var w = sp.w, px = sp.px;
    for (var y = sp.by0; y <= sp.by1; y++) {
      var sy = oy + y;
      if (sy < 0 || sy >= CH) continue;
      for (var x = sp.bx0; x <= sp.bx1; x++) {
        var col = px[y * w + x];
        if (!col) continue;
        var sx = ox + x;
        if (sx < 0 || sx >= CW) continue;
        var i = sy * CW + sx;
        if (depth[i] > cd + 0.5 && zat[i] > cz + 2 && !WALLID[ids[i]]) continue; // something in the room is in front (never a wall: they're all at the edge)
        out[i] = col;
      }
    }
    if (glow) { // an outline round the one you're pointing at or looking after
      var g = H(glow);
      for (var y2 = sp.by0 - 1; y2 <= sp.by1 + 1; y2++) for (var x2 = sp.bx0 - 1; x2 <= sp.bx1 + 1; x2++) {
        var here = x2 >= 0 && y2 >= 0 && x2 < w && y2 < sp.h ? px[y2 * w + x2] : 0;
        if (here) continue;
        var nb = (x2 > 0 && y2 >= 0 && y2 < sp.h && px[y2 * w + x2 - 1]) || (x2 < w - 1 && y2 >= 0 && y2 < sp.h && px[y2 * w + x2 + 1]) || (y2 > 0 && x2 >= 0 && x2 < w && px[(y2 - 1) * w + x2]) || (y2 < sp.h - 1 && x2 >= 0 && x2 < w && px[(y2 + 1) * w + x2]);
        if (!nb) continue;
        var sx2 = ox + x2, sy2 = oy + y2;
        if (sx2 < 0 || sy2 < 0 || sx2 >= CW || sy2 >= CH) continue;
        var j = sy2 * CW + sx2;
        if (depth[j] > cd + 0.5 && zat[j] > cz + 2) continue;
        out[j] = g;
      }
    }
    drawWear(c, sp, ox, oy, cd, cz);
    drawn.push({ c: c, ox: ox, oy: oy, sp: sp, sx: p.sx, sy: p.sy });
  }

  // little pixel pictures over a cat's head
  var ICONS = {
    heart: ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"],
    note: ["0001111", "0001001", "0001001", "0111001", "1111111", "0110110"],
    bang: ["01110", "01110", "01110", "00100", "00000", "00100"],
    z: ["11111", "00010", "00100", "01000", "11111"],
    food: ["0011100", "0111110", "1111111", "1011101", "0111110"],
    q: ["01110", "10001", "00010", "00100", "00000", "00100"],
    star: ["00100", "01110", "11111", "01110", "01010"],
    gift: ["1101011", "0111110", "1111111", "1001001", "1001001", "1111111"],
  };
  var ICON_COL = { heart: "#ff5d7a", note: "#ffe08a", bang: "#ffd23f", z: "#dfe8ff", food: "#c98a4b", q: "#ffffff", star: "#ffe066", gift: "#ff8fb1" };
  function icon(kind, cx, cy, k) {
    var rows = ICONS[kind], col = H(ICON_COL[kind]), ink = H("#1a1418"), s2 = k || 2;
    var w = rows[0].length, x0 = Math.round(cx - w * s2 / 2), y0 = Math.round(cy - rows.length * s2);
    for (var pass = 0; pass < 2; pass++) for (var j = 0; j < rows.length; j++) for (var i = 0; i < w; i++) {
      if (rows[j][i] !== "1") continue;
      for (var dy = -1; dy <= s2; dy++) for (var dx = -1; dx <= s2; dx++) {
        var inner = dx >= 0 && dy >= 0 && dx < s2 && dy < s2;
        if (pass === 0 && inner) continue;
        if (pass === 1 && !inner) continue;
        var x = x0 + i * s2 + dx, y = y0 + j * s2 + dy;
        if (x >= 0 && y >= 0 && x < CW && y < CH) out[y * CW + x] = pass ? col : ink;
      }
    }
  }
  function emotes() {
    drawn.forEach(function (d) {
      var e = d.c.emote;
      if (!e) return;
      if (e.until < now) { d.c.emote = null; return; }
      var bob = Math.sin(now / 300) * 2, top = d.sy - (d.c.pose === "sleep" || d.c.pose === "loaf" ? 50 : 84);
      if (e.kind === "z") { var t = (now / 900) % 1; icon("z", d.sx + 18 + t * 10, top + 10 - t * 18, 1); icon("z", d.sx + 26 + t * 6, top - 6 - t * 10, 2); return; }
      icon(e.kind, d.sx + (e.kind === "heart" ? 0 : 10), top + bob, 2);
    });
  }
  // the feather toy (Play): bobbing in front of the cat
  function drawToy() {
    if (!toy || toy.until < now) { toy = null; return; }
    var c = toy.c, p = project(c.x, c.y, c.z), t = (now - toy.start) / 1000;
    var tx = Math.round(p.sx + c.facing * (40 + Math.sin(t * 3.1) * 10)), ty = Math.round(p.sy - 30 - Math.abs(Math.sin(t * 4.3)) * 26);
    var stick = H("#8a6a45");
    for (var i = 0; i < 40; i++) { var x = tx + c.facing * Math.round(i * 0.7), y = ty - Math.round(i * 0.9); if (x >= 0 && y >= 0 && x < CW && y < CH) out[y * CW + x] = stick; }
    var cols = [H("#e94f6a"), H("#f6c445"), H("#5fb8e8")];
    for (var f = 0; f < 9; f++) for (var k = 0; k < 3; k++) {
      var fx = tx - c.facing * (f % 3) + (k - 1), fy = ty + f;
      if (fx >= 0 && fy >= 0 && fx < CW && fy < CH) out[fy * CW + fx] = cols[f % 3];
    }
  }
  // Move: a ring on every free spot
  function freeSpots() {
    var taken = {};
    Object.keys(cats).forEach(function (k) { taken[cats[k].spot] = true; });
    return Object.keys(SPOTS).filter(function (id) { return !taken[id]; });
  }
  function drawSpots() {
    if (!pickMode || pickMode.kind !== "go") return;
    var pulse = 0.5 + 0.5 * Math.sin(now / 220), ring = mix(H("#ff7a59"), H("#ffffff"), pulse), ink = H("#1a1418");
    var white = H("#ffffff");
    pickMode.spots.forEach(function (id) {
      // a thick ring lying flat on the spot, outlined, with a dot in the middle (bigger under the pointer)
      var s2 = SPOTS[id], p = project(s2.x, s2.y, s2.z), on = pickMode.hover === id;
      var rx = on ? 24 : 19, ry = Math.round(rx / 2), cx = Math.round(p.sx), cy = Math.round(p.sy); // (whole pixels: a half-pixel row would land half the canvas away)
      for (var y = -ry - 2; y <= ry + 2; y++) for (var x = -rx - 2; x <= rx + 2; x++) {
        var d = Math.sqrt((x * x) / (rx * rx) + (y * y) / (ry * ry)), xx = cx + x, yy = cy + y;
        if (xx < 0 || yy < 0 || xx >= CW || yy >= CH) continue;
        var dot = Math.sqrt((x * x) / 36 + (y * y) / 9);
        if (d <= 1 && d > 0.62) out[yy * CW + xx] = on ? white : ring;
        else if ((d <= 1.12 && d > 1) || (d <= 0.62 && d > 0.5)) out[yy * CW + xx] = ink;
        else if (dot <= 1) out[yy * CW + xx] = on ? white : ring;
      }
    });
  }

  var lastDraw = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    now = ts;
    var list = Object.keys(cats).map(function (k) { return cats[k]; });
    list.forEach(update);
    scenes();
    eventLife();
    winterLife();
    if (ts - lastDraw < 30) return; // about 30 frames a second is plenty for cats
    lastDraw = ts;
    if (roomDirty) renderRoom();
    out.set(bg);
    drawWindowFx();
    drawSeason();
    drawn = [];
    list.sort(function (a, b) { var pa = project(a.x, a.y, 0).d, pb = project(b.x, b.y, 0).d; return pa - pb || a.z - b.z; });
    var pulse = Math.floor(now / 350) % 2 ? "#ffffff" : "#ffe08a";
    list.forEach(function (c) {
      var glow = c === hover || c === selected || (pickMode && PAIR[pickMode.kind] && c === pickMode.hoverCat) ? pulse : null;
      if (!c.hidden && !isAway(c)) drawCat(c, glow);
    });
    drawEvent();
    drawBrawl();
    drawToy();
    drawn.forEach(function (d) { // gifts waiting by your cat
      if (isMine(d.c.id) && (d.c.data.newGifts || []).length && !d.c.emote) icon("gift", d.sx + 30, d.sy - 4 + Math.sin(now / 400) * 2, 2);
    });
    emotes();
    drawSpots();
    ctx.putImageData(img, 0, 0);
    tags();
  }

  // ---------- name tags (HTML, over the canvas) ----------
  var tagBox = document.querySelector(".cats-tags"), tagEls = {};
  function toScreen(x, y) {
    var r = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    return { x: r.left - sr.left + x / CW * r.width, y: r.top - sr.top + y / CH * r.height };
  }
  function tags() {
    var want = {};
    drawn.forEach(function (d) {
      var c = d.c, mine = isMine(c.id);
      if (!(c === hover || c === selected || mine || (c.say && c.say.until > now))) return;
      var top = d.oy + d.sp.by0 - 4, p = toScreen(d.sx, top);
      var el = tagEls[c.id];
      if (!el) { el = tagEls[c.id] = document.createElement("span"); tagBox.appendChild(el); }
      var say = c.say && c.say.until > now ? c.say.text : "";
      el.className = "cats-tag" + (say ? " say" : mine ? " mine" : "");
      el.textContent = say || c.data.name;
      el.style.left = p.x + "px"; el.style.top = p.y + "px";
      want[c.id] = true;
    });
    Object.keys(tagEls).forEach(function (id) { if (!want[id]) { tagEls[id].remove(); delete tagEls[id]; } });
  }

  // ---------- size, zoom, turning (as in office.js) ----------
  var view = { scale: 1 }, zoom = 1, panX = 0, panY = 0;
  function resize() {
    var r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    // as big as fits: in whole screen pixels where that costs little; smaller than the room's own pixels (phones,
    // laptops), just as big as fits, drawn smoothly rather than dropping rows of pixels
    var fitS = Math.min(r.height / CH, r.width / CW), whole = Math.floor(fitS * dpr) / dpr;
    var s = (fitS * dpr < 1 ? fitS : whole >= fitS * 0.92 ? whole : Math.floor(fitS * dpr * 4) / (dpr * 4)) * zoom;
    view.scale = s;
    canvas.style.width = CW * s + "px";
    canvas.style.height = CH * s + "px";
    canvas.style.imageRendering = s * dpr < 0.999 ? "auto" : "";
    stage.style.setProperty("--tile", 48 * s / zoom + "px");
    clampPan();
  }
  function clampPan() {
    var r = stage.getBoundingClientRect();
    var mx = Math.max(0, (CW * view.scale - r.width) / 2), my = Math.max(0, (CH * view.scale - r.height) / 2);
    // zoomed in, you can pan on past the room's edges into the blank space round it (Nick: on a phone the room is wide
    // and short, so it could hardly move up and down), until an edge of the room reaches about the middle of the screen
    if (zoom > 1.001) { mx = Math.abs(CW * view.scale - r.width) / 2 + r.width * 0.4; my = Math.abs(CH * view.scale - r.height) / 2 + r.height * 0.4; }
    panX = Math.max(-mx, Math.min(mx, panX)); panY = Math.max(-my, Math.min(my, panY));
    canvas.style.transform = "translate(-50%, -50%) translate(" + panX + "px," + panY + "px)";
  }
  window.addEventListener("resize", resize);
  resize();
  function turn(dir) { rot = (rot + dir + 4) % 4; roomDirty = true; hover = null; SFX.turn(); hideHint(); }
  document.querySelector(".cats-pan.left").addEventListener("click", function () { turn(-1); });
  document.querySelector(".cats-pan.right").addEventListener("click", function () { turn(1); });
  var zoomBtn = document.querySelector(".cats-zoom");
  var ZOOM_MAX = 4, zoomTarget = 1, zoomAt = null, zoomRaf = 0;
  zoomBtn.addEventListener("click", function () {
    zoomTarget = zoomTarget > 1 ? 1 : matchMedia("(pointer: coarse)").matches ? 2.5 : 1.6; zoomAt = null;
    if (zoomTarget === 1) panX = panY = 0;
    easeZoom();
  });
  function setZoom(z, at) {
    var r = stage.getBoundingClientRect(), before = view.scale;
    zoom = z;
    resize();
    if (at) { var cx = at.x - (r.left + r.width / 2), cy = at.y - (r.top + r.height / 2), k = view.scale / before; panX = cx - (cx - panX) * k; panY = cy - (cy - panY) * k; }
    if (zoom <= 1.001) panX = panY = 0;
    clampPan();
    zoomBtn.setAttribute("aria-pressed", String(zoom > 1.01));
    stage.style.touchAction = zoom > 1.01 ? "none" : "";
  }
  function easeZoom() {
    if (zoomRaf) return;
    (function stepZ() {
      var d = zoomTarget - zoom;
      if (Math.abs(d) < 0.002 || reduceMotion) { setZoom(zoomTarget, zoomAt); zoomRaf = 0; return; }
      setZoom(zoom + d * 0.22, zoomAt);
      zoomRaf = requestAnimationFrame(stepZ);
    })();
  }
  stage.addEventListener("wheel", function (e) {
    if (e.target.closest(".cats-card, .cats-panel")) return;
    e.preventDefault();
    var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomTarget = Math.max(1, Math.min(ZOOM_MAX, zoomTarget * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))));
    zoomAt = { x: e.clientX, y: e.clientY };
    hideHint();
    easeZoom();
  }, { passive: false });
  // two fingers pinch to zoom
  var touches = {}, pinch = null;
  function twoFingers() {
    var k = Object.keys(touches);
    if (k.length < 2) return null;
    var a = touches[k[0]], b = touches[k[1]];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  stage.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var f = twoFingers();
    if (!f || pinch) return;
    pinch = { d: f.d, z: zoom, x: f.x, y: f.y };
    if (zoomRaf) { cancelAnimationFrame(zoomRaf); zoomRaf = 0; }
    dragging = false; moved = Infinity;
    hideHint();
  }, true);
  stage.addEventListener("pointermove", function (e) {
    if (!touches[e.pointerId]) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var f = pinch && twoFingers();
    if (!f) return;
    zoomTarget = Math.max(1, Math.min(ZOOM_MAX, pinch.z * f.d / pinch.d)); zoomAt = null;
    setZoom(zoomTarget, f);
    panX += f.x - pinch.x; panY += f.y - pinch.y; pinch.x = f.x; pinch.y = f.y;
    clampPan();
  }, true);
  function liftFinger(e) {
    delete touches[e.pointerId];
    if (!pinch) return;
    var f = twoFingers();
    if (f) { pinch = { d: f.d, z: zoom, x: f.x, y: f.y }; return; }
    pinch = null;
  }
  stage.addEventListener("pointerup", liftFinger, true);
  stage.addEventListener("pointercancel", liftFinger, true);
  stage.addEventListener("touchmove", function (e) { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  stage.addEventListener("gesturestart", function (e) { e.preventDefault(); });

  // ---------- pointing and clicking ----------
  function roomPoint(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * CW, y: (e.clientY - r.top) / r.height * CH }; }
  function catAt(e) {
    var p = roomPoint(e);
    for (var i = drawn.length - 1; i >= 0; i--) {
      var d = drawn[i], x = Math.floor(p.x - d.ox), y = Math.floor(p.y - d.oy);
      if (x < 0 || y < 0 || x >= d.sp.w || y >= d.sp.h) continue;
      // a little forgiving: any of the pixels round the point
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        var xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < d.sp.w && yy < d.sp.h && d.sp.px[yy * d.sp.w + xx]) return d.c;
      }
    }
    return null;
  }
  function spotAt(e) {
    var p = roomPoint(e), best = null, bd = 26;
    pickMode.spots.forEach(function (id) { var s2 = SPOTS[id], q = project(s2.x, s2.y, s2.z), d = Math.hypot(q.sx - p.x, (q.sy - p.y) * 1.6); if (d < bd) { bd = d; best = id; } });
    return best;
  }
  var dragging = false, downX = 0, downY = 0, lastX = 0, lastY = 0, moved = 0, turned = false;
  canvas.addEventListener("pointerdown", function (e) {
    if (pinch) return;
    dragging = true; moved = 0; turned = false;
    downX = lastX = e.clientX; downY = lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragging) {
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
      if (zoom > 1) { panX += e.clientX - lastX; panY += e.clientY - lastY; clampPan(); }
      else if (!turned && Math.abs(e.clientX - downX) > 60) { turn(e.clientX < downX ? 1 : -1); turned = true; }
      lastX = e.clientX; lastY = e.clientY;
      return;
    }
    if (e.pointerType !== "mouse") return;
    if (pickMode && pickMode.kind === "go") { pickMode.hover = spotAt(e); canvas.classList.toggle("over", !!pickMode.hover); return; }
    var c = catAt(e);
    if (pickMode && PAIR[pickMode.kind]) pickMode.hoverCat = c && c.id !== room.mine ? c : null;
    hover = c;
    canvas.classList.toggle("over", !!c);
  });
  canvas.addEventListener("pointerleave", function () { hover = null; canvas.classList.remove("over"); });
  canvas.addEventListener("pointerup", function (e) {
    dragging = false;
    if (moved > 6) return;
    if (pickMode && pickMode.kind === "go") { var s2 = spotAt(e); if (s2) goTo(s2); return; }
    var c = catAt(e);
    if (pickMode && PAIR[pickMode.kind]) { if (c && c.id !== room.mine) pairAct(pickMode.kind, c); return; }
    if (c) { openCard(c.id); SFX.mew(c.data.look.seed); } else closeCard();
  });
  canvas.addEventListener("pointercancel", function () { dragging = false; });
  document.addEventListener("keydown", function (e) {
    if (e.target.closest && e.target.closest("input, textarea, dialog")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); turn(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); turn(1); }
    else if (e.key === "Escape") { if (pickMode) endPick(); else closeCard(); }
  });

  // ---------- words ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ago(t) {
    var s2 = Math.max(0, (Date.now() - t) / 1000);
    if (s2 < 60) return "just now";
    if (s2 < 3600) return Math.floor(s2 / 60) + "m ago";
    if (s2 < 86400) return Math.floor(s2 / 3600) + "h ago";
    var d = Math.floor(s2 / 86400);
    return d === 1 ? "yesterday" : d < 30 ? d + " days ago" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function catName(id, fallback) { var c = cats[id]; return '<a class="cat-link" data-cat="' + esc(id) + '">' + esc(c ? c.data.name : fallback || "a cat") + "</a>"; }
  function spotLabel(id) { return (SPOTS[id] || {}).label || "somewhere new"; }
  var SAY = {
    joined: "{a} moved into the room. Say hi!", fed: "{a} had dinner.", pet: "{a} got some pets.", play: "{a} played with the feather toy.",
    moved: "{a} went to {s}.", wander: "{a} wandered over to {s}.", hungry: "{a} is hungry.",
    groom: "{a} groomed {b}.", playwith: "{a} and {b} played together.", nap: "{a} napped next to {b}.", headbutt: "{a} bonked heads with {b}.",
    sunbeam: "{a} shared a sunbeam with {b}.", chase: "{a} chased {b} round the room.", share: "{a} let {b} have the comfy spot.",
    hiss: "{a} hissed at {b}.", swat: "{a} swatted {b}.", stare: "{a} and {b} had a staring contest.", steal: "{a} stole {b}’s spot.",
    sniff: "{a} sniffed {b}.", blink: "{a} slow-blinked at {b}.", gift: "{a} brought {b} a toy mouse.", serenade: "{a} serenaded {b}.",
    cuddle: "{a} and {b} cuddled up.", love: "{a} and {b} are in love!", breakup: "{a} and {b} broke up.", friends: "{a} and {b} are close friends now.",
    rivals: "{a} and {b} are rivals now.", makeup: "{a} and {b} made up.", movedout: "{a} moved out to live with a family down the street.",
    left: "{a} left the room.", removed: "{a} left the room.",
    found: "{a} found {g}.", treat: "{a} shared a treat with {b}. Things are looking up.", treatno: "{b} turned up their nose at {a}’s treat.",
    date: "{a} and {b} went on a date.", datefail: "{b} wasn’t interested in a date with {a}.", apart: "{a} is keeping away from {b} today.",
    kitten: "{a} and {b} had a kitten: {c}!", named: "The new kitten is called {a}.", kindtreat: "{by} gave {a} a treat.", kindpet: "{by} petted {a}.",
    adventure: "{a} slipped out of the window for an adventure.", back: "{a} came home from an adventure with a postcard.",
  };
  var BIG = { love: 1, breakup: 1, friends: 1, rivals: 1, makeup: 1, joined: 1, movedout: 1, kitten: 1 };
  var OWNED = { fed: "{o} fed {a}.", pet: "{o} petted {a}.", play: "{o} played with {a} and the feather toy." };
  var OWNER = { fed: 1, pet: 1, play: 1, moved: 1, treat: 1, treatno: 1, date: 1, datefail: 1, apart: 1 };
  function sayOf(e, html) {
    var k = e.k === "play" && e.b ? "playwith" : e.k === "kind" ? "kind" + e.what : e.k;
    // an owner looking after their own cat, by name (Nick: "Nick petted Mochi"), when the cat has its owner's name
    var own = (cats[e.a] && cats[e.a].data.ownerName) || "";
    if (own && OWNED[k]) return OWNED[k].replace("{o}", esc(own)).replace("{a}", html ? catName(e.a, e.an) : esc(e.an));
    var t = k === "event" ? (EVENT_SAY[e.e] || "Something happened in the room.") : SAY[k] || (e.an + " did something.");
    function n(id, fb) { return html ? catName(id, fb) : esc(cats[id] ? cats[id].data.name : fb); }
    return t.replace("{a}", n(e.a, e.an)).replace("{b}", n(e.b, e.bn)).replace("{s}", esc(spotLabel(e.s))).replace("{g}", esc(GIFT_NAME[e.g] || "something")).replace("{c}", n(e.c, e.cn)).replace("{by}", esc(e.by || "A visitor"));
  }

  // how a cat gets on with the others: best friend, love, crush, rivals; and the room's cliques
  function others(id) { return Object.keys(cats).filter(function (k) { return k !== id; }); }
  function bestFriend(id) { var b = null, top = 29; others(id).forEach(function (o) { var f = relOf(id, o).f; if (f > top) { top = f; b = o; } }); return b; }
  function loveOf(id) { var b = null, top = 69; others(id).forEach(function (o) { var r = relOf(id, o).r; if (r > top) { top = r; b = o; } }); return b; }
  function crushOf(id) { var b = null, top = 34; others(id).forEach(function (o) { var r = relOf(id, o).r; if (r > top && r < 70) { top = r; b = o; } }); return b; }
  function rivalsOf(id) { return others(id).filter(function (o) { return relOf(id, o).f <= -40; }); }
  var ZONE = { ta1: "tall", ta2: "tall", ta3: "tall", tb1: "short", tb2: "short", tb3: "short", cabinet: "window", window: "window", fl5: "window", couch1: "couch", couch2: "couch", couch3: "couch", couchback: "couch", fl6: "couch" };
  var CLIQUE_NAMES = {
    tall: ["The Tower Gang", "The High Perch Society"], short: ["The Condo Crew", "The Penthouse Club"], window: ["The Window Watchers", "The Bird Spotters"],
    couch: ["The Couch Potatoes", "The Cushion Club"], shelves: ["The Shelf Climbers", "The Top Shelf"], floor: ["The Floor Patrol", "The Sunbeam Club"],
  };
  // a clique: three or more cats who all get on with each other (friendship 35+ between every pair). Built from the
  // closest pairs first; a cat is in one clique at most.
  function cliques() {
    var ids2 = Object.keys(cats), pairs = [], taken = {};
    ids2.forEach(function (a) { ids2.forEach(function (b) { if (a < b && relOf(a, b).f >= 45) pairs.push([a, b, relOf(a, b).f]); }); });
    pairs.sort(function (p, q) { return q[2] - p[2]; });
    var groups = [];
    pairs.forEach(function (p) {
      if (taken[p[0]] || taken[p[1]]) return;
      var g = [p[0], p[1]];
      ids2.filter(function (o) { return !taken[o] && g.indexOf(o) < 0; })
        .map(function (o) { return [o, g.reduce(function (s3, m) { return s3 + relOf(o, m).f; }, 0)]; })
        .sort(function (a, b) { return b[1] - a[1]; })
        .forEach(function (o) { if (g.length < 6 && g.every(function (m) { return relOf(o[0], m).f >= 35; })) g.push(o[0]); });
      if (g.length >= 3) { g.forEach(function (m) { taken[m] = true; }); groups.push(g); }
    });
    var used = {};
    return groups.map(function (g) {
      var count = {};
      g.forEach(function (i) { var s2 = cats[i].spot, z = ZONE[s2] || (/^sh|box2|bed2|fl8/.test(s2) ? "shelves" : "floor"); count[z] = (count[z] || 0) + 1; });
      var zone = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
      var names = CLIQUE_NAMES[zone], name = names[used[zone] || 0] || names[0] + " " + ((used[zone] || 0) + 1);
      used[zone] = (used[zone] || 0) + 1;
      return { name: name, members: g };
    });
  }
  function cliqueOf(id) { return cliques().filter(function (q) { return q.members.indexOf(id) >= 0; })[0] || null; }

  // ---------- a cat's card ----------
  var card = document.querySelector(".cats-card");
  var cardFace = card.querySelector(".cats-card-face");
  cardFace.width = 64; cardFace.height = 52;
  var cardFor = null;
  function hoursSince(t) { return (Date.now() - t) / 3600000; }
  function fullness(d) { return Math.max(0, Math.min(1, 1 - hoursSince(d.fed) / 36)); }
  function happiness(d) { var last = Math.max(d.petted || 0, d.played || 0, d.born); return Math.max(0, Math.min(1, 1 - hoursSince(last) / 30)); }
  // how a cat feels about every other cat (Nick: "bars of connection and hatred between all the cats"): friendship
  // -100..100 as a bar from the middle, red to the left (hatred), green to the right (connection); the strongest
  // feelings first, love or hate (Nick couldn't see the rivals at the bottom of a best-first list), never-met last;
  // a heart where there's romance (40+)
  function feelings(id) {
    var rows = Object.keys(cats).filter(function (o) { return o !== id; }).map(function (o) { return { id: o, rel: relOf(id, o) }; });
    if (!rows.length) return '<li class="cats-empty">No other cats yet.</li>';
    function strength(r) { return Math.abs(r.f || 0) + (r.r || 0) / 4; }
    rows.sort(function (a, b) { return strength(b.rel) - strength(a.rel) || cats[a.id].data.name.localeCompare(cats[b.id].data.name); });
    return rows.map(function (x) {
      var f = Math.max(-100, Math.min(100, x.rel.f || 0)), r = x.rel.r || 0;
      var word = r >= 70 ? "In love" : f >= 60 ? "Best friends" : f >= 40 ? "Friends" : f >= 15 ? "Friendly" : f > -15 ? (f || r ? "Neutral" : "Never met") : f > -40 ? "Not keen" : "Rivals";
      var bar = f >= 0 ? '<i class="love" style="left:50%;width:' + (f / 2) + '%"></i>' : '<i class="hate" style="right:50%;width:' + (-f / 2) + '%"></i>';
      return '<li><span class="feel-name">' + catName(x.id) + (r >= 40 ? ' <b class="feel-heart" title="Romance ' + r + '">♥</b>' : "") + '</span>' +
        '<span class="feel-bar" role="img" aria-label="' + word + " (" + f + ')">' + bar + '</span><span class="feel-word">' + word + "</span></li>";
    }).join("");
  }
  // "N more" under the Feelings list while it has rows below the fold
  function moreFeel() {
    var feel = card.querySelector(".cats-card-feel"), more = card.querySelector(".cats-card-feel-more");
    var rowH = feel.firstElementChild ? feel.firstElementChild.offsetHeight || 23 : 23;
    var left = Math.round((feel.scrollHeight - feel.clientHeight - feel.scrollTop) / rowH);
    more.hidden = left < 1;
    more.textContent = left + " more ↓";
  }
  function meter(v) { return '<span class="meter"><i style="width:' + Math.round(v * 100) + '%"></i></span>'; }
  function personality(tr) {
    tr = tr || {};
    var words = [];
    if (tr.friendly > 0.7) words.push("friendly"); else if (tr.friendly < 0.25) words.push("aloof");
    if (tr.playful > 0.7) words.push("playful"); else if (tr.playful < 0.25) words.push("lazy");
    if (tr.bossy > 0.7) words.push("bossy"); else if (tr.bossy < 0.2) words.push("gentle");
    if (tr.romantic > 0.75) words.push("a romantic");
    if (!words.length) words.push("easygoing");
    return words.join(", ").replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function openCard(id) {
    var c = cats[id];
    if (!c) return;
    cardFor = id; selected = c;
    var d = c.data, mine = isMine(id);
    if (mine) room.mine = id; // the one you're looking after now (Nick can have several)
    card.querySelector("h2").textContent = d.name + (mine ? " (yours)" : "");
    card.querySelector(".cats-card-look").textContent = CD.describe(d.look) + (GENDER[d.gender] ? " · " + GENDER[d.gender] : "");
    var away = isAway(c);
    card.querySelector(".cats-card-age").textContent = away ? "Out on an adventure · back in about " + Math.max(1, Math.round((d.away.until - Date.now()) / 3600e3)) + " h"
      : isKittenNow(d) ? "Kitten · " + Math.max(1, Math.ceil((Date.now() - d.born) / DAY)) + " days old · on " + spotLabel(c.spot)
      : (d.kitten ? "Born " : "Moved in ") + ago(d.born) + " · on " + spotLabel(c.spot);
    var fc = cardFace.getContext("2d"), sp = CD.render(d.look, "sit", 0.2, 1), im = fc.createImageData(64, 52), o32 = new Uint32Array(im.data.buffer);
    var face = new Uint32Array(sp.px); // with what it's wearing (Nick: the crown on the card too)
    wearPixels(c, sp, function (wx, wy, col) { if (wx >= 0 && wy >= 0 && wx < sp.w && wy < sp.h) face[wy * sp.w + wx] = col; });
    for (var y = 0; y < 52; y++) for (var x = 0; x < 64; x++) o32[y * 64 + x] = face[(y + 42) * sp.w + x + 62] || 0;
    fc.putImageData(im, 0, 0);
    var facts = [];
    if (mine) facts.push(["Owner", "You"]);
    else if (d.ownerName) facts.push(["Owner", esc(d.ownerName)]);
    facts.push(["Personality", esc(personality(d.traits))]);
    if (d.parents) facts.push(["Parents", d.parents.map(function (p) { return catName(p, "a cat who moved out"); }).join(" &amp; ")]);
    var kids = room.cats.filter(function (x) { return x.parents && x.parents.indexOf(id) >= 0; });
    if (kids.length) facts.push([kids.length > 1 ? "Kittens" : "Kitten", kids.map(function (x) { return catName(x.id, x.name); }).join(", ")]);
    facts.push(["Fed", meter(fullness(d)) + (fullness(d) > 0.6 ? "Full" : fullness(d) > 0.25 ? "Peckish" : "Hungry")]);
    facts.push(["Happy", meter(happiness(d)) + (happiness(d) > 0.6 ? "Very" : happiness(d) > 0.25 ? "Okay" : "Wants attention")]);
    var bf = bestFriend(id), lv = loveOf(id), cr = crushOf(id), rv = rivalsOf(id), cq = cliqueOf(id);
    if (bf) facts.push(["Best friend", catName(bf)]);
    if (lv) facts.push(["In love with", catName(lv) + " ♥"]);
    else if (cr) facts.push(["Crush", catName(cr)]);
    if (rv.length) facts.push(["Rivals", rv.map(function (r) { return catName(r); }).join(", ")]);
    if (cq) facts.push(["Clique", esc(cq.name) + " (with " + cq.members.filter(function (m) { return m !== id; }).map(function (m) { return catName(m); }).join(", ") + ")"]);
    card.querySelector(".cats-card-facts").innerHTML = facts.map(function (f) { return "<dt>" + f[0] + "</dt><dd>" + f[1] + "</dd>"; }).join("");
    card.querySelector(".cats-card-gifts").innerHTML = giftsHtml(d);
    card.querySelector(".cats-card-diary ul").innerHTML = diary(id);
    if (mine) { collectGifts(c); cooldowns(d); }
    var feel = card.querySelector(".cats-card-feel");
    feel.innerHTML = feelings(id); feel.scrollTop = 0; setTimeout(moreFeel, 0); // once the card is on screen
    var mineLog = room.log.filter(function (e) { return e.a === id || e.b === id; }).slice(0, 4); // the last 4 (Nick)
    card.querySelector(".cats-card-log").innerHTML = mineLog.length ? mineLog.map(function (e) { return "<li><span>" + sayOf(e, true) + "</span><time>" + ago(e.t) + "</time></li>"; }).join("") : '<li class="cats-empty">Nothing yet.</li>';
    card.querySelector(".cats-card-actions").hidden = !mine || away;
    // naming a kitten (its owners, once)
    card.querySelector(".cats-card-name").hidden = !(mine && d.kitten && !d.named);
    // kindness: someone else's cat, here in the room
    var kindRow = card.querySelector(".cats-card-kind");
    kindRow.hidden = mine || away || !VID;
    ["treat", "pet"].forEach(function (w) { var b = kindRow.querySelector('[data-kind="' + w + '"]'); b.disabled = kindDone(id, w); b.textContent = (w === "treat" ? "Give a treat" : "Pet") + (b.disabled ? " ✓" : ""); });
    // what it's wearing (your cat: any wearable gift it has found)
    var wearRow = card.querySelector(".cats-card-wear"), owned = Object.keys(d.gifts || {}).filter(function (g) { return WEAR[g] && d.gifts[g] > 0; });
    wearRow.hidden = !mine || !owned.length;
    wearRow.querySelector(".cats-chips").innerHTML = ['<button type="button" data-wear="" aria-pressed="' + !d.wear + '">Nothing</button>'].concat(owned.map(function (g) {
      return '<button type="button" data-wear="' + g + '" aria-pressed="' + (d.wear === g) + '">' + esc(GIFT_NAME[g].replace(/^an? /, "")) + "</button>";
    })).join("");
    // tricks (your cat)
    var tr = tricksOf(d), next = TRICKS.filter(function (t) { return (d.days || 0) < t[0]; })[0], trRow = card.querySelector(".cats-card-tricks");
    trRow.hidden = !mine;
    trRow.querySelector(".cats-tricks-list").innerHTML = (tr.length ? "Knows: " + tr.map(function (t) { return "<b>" + t[2] + "</b>"; }).join(", ") + "." : "No tricks yet.") +
      (next ? " Visit on " + (next[0] - (d.days || 0)) + " more day" + (next[0] - (d.days || 0) === 1 ? "" : "s") + " to learn " + next[2].toLowerCase() + "." : " Every trick learned!");
    trRow.querySelector(".cats-trick-go").hidden = !tr.length || away;
    // postcards from its adventures
    var pc = card.querySelector(".cats-card-postcards"), cards2 = (d.postcards || []).slice().reverse();
    pc.hidden = !cards2.length;
    pc.querySelector("summary").textContent = "Postcards (" + cards2.length + ")";
    pc.querySelector("ul").innerHTML = cards2.map(function (x) { return "<li>“" + esc(x.text) + "”<small>" + ago(x.t) + (x.g ? " · brought back " + esc(GIFT_NAME[x.g]) : "") + "</small></li>"; }).join("");
    card.querySelector(".cats-card-more").hidden = !mine;
    card.querySelector(".cats-remove").hidden = !(room.owner && !mine);
    if (mine) {
      card.querySelector('[data-act="feed"]').textContent = fullness(d) > 0.94 ? "Feed (full)" : "Feed";
      card.querySelector(".cats-code").textContent = "••••••";
      card.querySelector(".cats-code-copy").hidden = true;
      card.querySelector(".cats-code-show").hidden = false;
    }
    card.hidden = false;
  }
  function closeCard() { card.hidden = true; cardFor = null; selected = null; }
  card.querySelector(".cats-card-close").addEventListener("click", closeCard);
  card.querySelector(".cats-card-name button").addEventListener("click", function () {
    var c = cats[cardFor], v = card.querySelector(".cats-card-name input").value.trim();
    if (!c || !v) return;
    send(c, { action: "name", name: v }).then(function (d) { if (d.error) { toast(esc(d.error)); return; } toast("Welcome to the room, <b>" + esc(v) + "</b>!"); load().then(function () { openCard(c.id); }); });
  });
  card.querySelector(".cats-card-kind").addEventListener("click", function (e) { var b = e.target.closest("[data-kind]"), c = cats[cardFor]; if (b && c && !b.disabled) giveKind(c, b.dataset.kind); });
  card.querySelector(".cats-card-wear").addEventListener("click", function (e) {
    var b = e.target.closest("[data-wear]"), c = cats[cardFor];
    if (!b || !c) return;
    send(c, { action: "wear", g: b.dataset.wear }).then(function (d) { if (d.error) toast(esc(d.error)); else { c.key = null; openCard(c.id); } });
  });
  card.querySelector(".cats-trick-go").addEventListener("click", function () {
    var c = cats[cardFor], tr = c && tricksOf(c.data);
    if (!tr || !tr.length) return;
    closeCard(); doTrick(c, tr[Math.floor(Math.random() * tr.length)][1]);
  });
  document.querySelector(".cats-recap-ok").addEventListener("click", function () { document.querySelector(".cats-recap").hidden = true; });
  card.querySelector(".cats-card-feel").addEventListener("scroll", moreFeel, { passive: true });
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.cat-link");
    if (!a) return;
    e.preventDefault();
    openCard(a.dataset.cat);
    if (!panel.hidden && matchMedia("(max-width: 600px)").matches) closePanel();
  });
  card.querySelector(".cats-card-actions").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var c = cats[room.mine];
    if (!c) return;
    var actn = b.dataset.act;
    if (actn === "feed") feed(c);
    else if (actn === "pet") pet(c);
    else if (actn === "play") play(c);
    else if (actn === "go") startPick("go");
    else if (PAIR[actn]) startPick(actn);
  });
  card.querySelector(".cats-code-show").addEventListener("click", function () {
    fetch(API + "/cats/" + room.mine + "/code?visitorId=" + encodeURIComponent(VID)).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.code) return;
      card.querySelector(".cats-code").textContent = d.code;
      card.querySelector(".cats-code-show").hidden = true;
      card.querySelector(".cats-code-copy").hidden = false;
    });
  });
  card.querySelector(".cats-code-copy").addEventListener("click", function (e) { copy(card.querySelector(".cats-code").textContent, e.target); });
  card.querySelector(".cats-letgo").addEventListener("click", function () {
    var c = cats[room.mine];
    if (!c || !confirm("Let " + c.data.name + " go? They’ll leave the room for good, and their history goes with them.")) return;
    fetch(API + "/cats/" + c.id + "?visitorId=" + encodeURIComponent(VID), { method: "DELETE", headers: headers() }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) { toast(d.error); return; }
      closeCard(); toast(c.data.name + " left the room."); load();
    });
  });
  card.querySelector(".cats-remove").addEventListener("click", function () {
    var c = cats[cardFor];
    if (!c || !confirm("Remove " + c.data.name + " from the room?")) return;
    fetch(API + "/cats/" + c.id, { method: "DELETE", headers: headers() }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) { toast(d.error); return; }
      closeCard(); load();
    });
  });
  function copy(text, btn) {
    var done = function () { var t = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = t; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {}); else done();
  }

  // ---------- looking after your cat ----------
  var toastEl = document.querySelector(".cats-toast"), toastT = 0;
  function toast(msg) { toastEl.innerHTML = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 4200); }
  function send(c, body) {
    body.visitorId = VID;
    return fetch(API + "/cats/" + c.id, { method: "POST", headers: headers(true), body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.cat) { c.data = d.cat; var i = room.cats.findIndex(function (x) { return x.id === d.cat.id; }); if (i >= 0) room.cats[i] = d.cat; }
        if (d.event) { room.log.unshift(d.event); renderPanel(); }
        if (d.rel && d.event && d.event.b) room.rel[d.event.a < d.event.b ? d.event.a + "|" + d.event.b : d.event.b + "|" + d.event.a] = d.rel;
        if (cardFor === c.id) openCard(c.id);
        return d;
      })
      .catch(function () { return { error: "Couldn’t reach the room. Try again in a bit." }; });
  }
  function feed(c) {
    send(c, { action: "feed" }).then(function (d) {
      if (d.error) { toast(esc(d.error)); return; }
      if (d.message) { toast(esc(d.message)); c.say = { text: "Not hungry", until: now + 2000 }; return; }
      closeCard();
      SFX.bowl();
      visit(c, EAT, function () {
        var p = project(EAT.x, EAT.y, 0), pb = project(EAT.x, EAT.y + 30, 0);
        c.facing = pb.sx > p.sx ? 1 : -1;
        SFX.crunch();
        return { pose: "eat", ms: 5200, emote: "food" };
      });
    });
  }
  // go somewhere on the floor, do something there (what arrive() returns), then go back to its spot
  function visit(c, point, arrive) {
    plan(c, point, function () {
      c.offSpot = true;
      var a = arrive(c);
      perform(c, a.pose, a.ms, a.emote, function () { plan(c, c.spot); c.offSpot = false; });
    });
  }
  // the floor next to another cat (or at the foot of its tower), on your cat's side of it
  function besideOf(c, o) {
    var g = (SPOTS[o.spot] && (SPOTS[o.spot].z > 8 || SPOTS[o.spot].kind === "box")) ? groundOf(o.spot) : { x: o.x, y: o.y };
    var dx = c.x - g.x, dy = c.y - g.y, d = Math.hypot(dx, dy) || 1;
    return { x: Math.max(24, Math.min(X - 24, g.x + dx / d * 38)), y: Math.max(24, Math.min(Y - 24, g.y + dy / d * 38)), z: 0 };
  }
  function pet(c) {
    perform(c, "happy", 3800, "heart"); SFX.purr(); closeCard();
    send(c, { action: "pet" });
  }
  function play(c) {
    closeCard();
    toy = { c: c, start: now, until: now + 5600 };
    perform(c, function (t) { var k = Math.floor(t / 700) % 4; return k === 0 ? "crouch" : k === 1 ? "bat" : k === 2 ? "crouch" : "bat"; }, 5600, null);
    SFX.jingle();
    send(c, { action: "play" });
  }
  function goTo(spot) {
    var c = cats[room.mine];
    endPick();
    if (!c) return;
    send(c, { action: "go", spot: spot }).then(function (d) {
      if (d.error) { toast(esc(d.error)); return; }
      plan(c, spot); c.spot = spot; // (the plan starts from where it was)
      SFX.mew(c.data.look.seed);
    });
  }
  function meet(o) {
    var c = cats[room.mine];
    endPick();
    if (!c) return;
    send(c, { action: "meet", with: o.id }).then(function (d) {
      if (d.error) { toast(esc(d.error)); return; }
      var e = d.event;
      if (!e) return;
      var good = { groom: 1, play: 1, nap: 1, headbutt: 1, sunbeam: 1, chase: 1, share: 1, blink: 1, gift: 1, serenade: 1, cuddle: 1 }, sweet = { blink: 1, gift: 1, serenade: 1, cuddle: 1 };
      var extra = d.extra || [], love = extra.some(function (x) { return x.k === "love"; });
      load(); // how they get on now
      // your cat goes over, and the meeting plays out when it gets there
      visit(c, besideOf(c, o), function () {
        var pc = project(c.x, c.y, c.z), po = project(o.x, o.y, o.z);
        c.facing = po.sx > pc.sx ? 1 : -1; o.facing = -c.facing;
        toast(sayOf(e, false) + extra.map(function (x) { return " <b>" + sayOf(x, false) + "</b>"; }).join(""));
        if (sweet[e.k] || love) { perform(o, "happy", 4000, "heart"); SFX.purr(); return { pose: "happy", ms: 4000, emote: "heart" }; }
        if (good[e.k]) {
          perform(o, e.k === "play" || e.k === "chase" ? "crouch" : "sit", 3400, "note"); SFX.mew(o.data.look.seed);
          return { pose: e.k === "groom" ? "groom" : e.k === "play" || e.k === "chase" ? "bat" : "sit", ms: 3400, emote: "note" };
        }
        if (e.k === "sniff") return { pose: "stand", ms: 2600, emote: "q" };
        perform(o, "hiss", 2400, "bang"); SFX.hiss(0.4);
        return { pose: "hiss", ms: 2400, emote: "bang" };
      });
    });
  }
  // picking a spot (Move) or another cat (Meet)
  var modeEl = document.querySelector(".cats-mode");
  function startPick(kind) {
    closeCard();
    pickMode = { kind: kind, spots: kind === "go" ? freeSpots() : [], hover: null, hoverCat: null };
    modeEl.querySelector("span").textContent = kind === "go" ? "Click a ring to send your cat there" : PAIR[kind];
    modeEl.hidden = false;
    canvas.classList.add("picking");
  }
  function endPick() { pickMode = null; modeEl.hidden = true; canvas.classList.remove("picking"); }
  modeEl.querySelector("button").addEventListener("click", endPick);

  // ---------- the panel: history, who's who ----------
  var panel = document.querySelector(".cats-panel"), histBtn = document.querySelector(".cats-history-btn");
  function closePanel() { panel.hidden = true; histBtn.setAttribute("aria-expanded", "false"); }
  histBtn.addEventListener("click", function () { var open = panel.hidden; panel.hidden = !open; histBtn.setAttribute("aria-expanded", String(open)); if (open) renderPanel(); });
  panel.querySelector(".cats-panel-close").addEventListener("click", closePanel);
  panel.querySelector(".cats-tabs").addEventListener("click", function (e) {
    var t = e.target.closest("[role=tab]");
    if (!t) return;
    [].forEach.call(panel.querySelectorAll("[role=tab]"), function (b) { b.setAttribute("aria-selected", String(b === t)); });
    [].forEach.call(panel.querySelectorAll(".cats-tab"), function (d) { d.hidden = d.dataset.tab !== t.dataset.tab; });
  });
  panel.querySelector('.cats-tab[data-tab="history"]').addEventListener("click", function (e) { // Nick starts a room event
    var b = e.target.closest("[data-ev]");
    if (!b) return;
    fetch(API + "/cats/event", { method: "POST", headers: headers(true), body: JSON.stringify({ k: b.dataset.ev }) })
      .then(function (r) { return r.json(); }).then(function (d) { if (d.error) toast(esc(d.error)); load(); });
  });
  var onlyMine = panel.querySelector(".cats-filter input");
  onlyMine.addEventListener("change", renderPanel);
  function renderPanel() {
    if (panel.hidden) return;
    panel.querySelector(".cats-filter").hidden = !room.mine;
    var log = room.log.filter(function (e) { return !onlyMine.checked || isMine(e.a) || isMine(e.b); });
    panel.querySelector(".cats-log").innerHTML = log.length ? log.map(function (e) {
      return '<li class="' + (BIG[e.k] ? "big" : OWNER[e.k] ? "owner" : "") + '"><span>' + sayOf(e, true) + "</span><time>" + ago(e.t) + "</time></li>";
    }).join("") : '<li class="cats-empty">Nothing’s happened yet. Make a cat to get things going!</li>';
    var qs = cliques();
    panel.querySelector(".cats-cliques").innerHTML = qs.length ? qs.map(function (q) {
      return "<li><b>" + esc(q.name) + "</b>: " + q.members.map(function (m) { return catName(m); }).join(", ") + "</li>";
    }).join("") : '<li class="cats-empty">No cliques yet. Three cats who all get on make one.</li>';
    var list = Object.keys(cats).map(function (k) { return cats[k]; }).sort(function (a, b) { return a.data.name.localeCompare(b.data.name); });
    panel.querySelector(".cats-list").innerHTML = list.length ? list.map(function (c) {
      var bits = [], bf = bestFriend(c.id), lv = loveOf(c.id);
      if (lv) bits.push("in love with " + esc(cats[lv].data.name));
      if (bf) bits.push("best friends with " + esc(cats[bf].data.name));
      if (!bits.length) bits.push(esc(CD.describe(c.data.look)));
      return '<li><button type="button" data-cat="' + esc(c.id) + '">' + esc(c.data.name) + "</button>" + (isMine(c.id) ? " (yours)" : c.data.ownerName ? " · " + esc(c.data.ownerName) + "’s" : "") + "<small>" + bits.join(" · ") + "</small></li>";
    }).join("") : '<li class="cats-empty">No cats yet.</li>';
  }
  panel.querySelector(".cats-list").addEventListener("click", function (e) { var b = e.target.closest("button[data-cat]"); if (b) openCard(b.dataset.cat); });

  // ---------- How the Cattery works (the "?" in the header) ----------
  (function () {
    var dlg = document.querySelector(".cats-help"), btn = document.querySelector(".cats-help-btn");
    btn.addEventListener("click", function () { dlg.querySelector(".cats-log-body").scrollTop = 0; dlg.showModal(); });
    dlg.querySelector(".cats-log-close").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
  })();

  // ---------- The Cattery Times (Nick: a weekly front page from the room's history) ----------
  var timesDlg = document.querySelector(".cats-times");
  document.querySelector(".cats-times-btn").addEventListener("click", function () {
    timesDlg.querySelector(".cats-times-paper").innerHTML = '<p style="text-align:center;padding:40px 0">Fetching this week’s paper…</p>';
    timesDlg.showModal();
    fetch(API + "/cats/times").then(function (r) { return r.json(); }).then(function (d) { timesDlg.querySelector(".cats-times-paper").innerHTML = writeTimes(d); })
      .catch(function () { timesDlg.querySelector(".cats-times-paper").innerHTML = '<p style="text-align:center;padding:40px 0">The paper didn’t arrive. Try again in a bit.</p>'; });
  });
  timesDlg.querySelector(".cats-times-close").addEventListener("click", function () { timesDlg.close(); });
  timesDlg.addEventListener("click", function (e) { if (e.target === timesDlg) timesDlg.close(); var a = e.target.closest(".cat-link"); if (a) { timesDlg.close(); openCard(a.dataset.cat); } });
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function writeTimes(d) {
    var L = d.lines || [], stories = [], nm = function (id, fb) { return catName(id, fb); };
    function pair(e) { return [e.a, e.b].sort().join("|"); }
    function add(score, kicker, head, body) { stories.push({ s: score, k: kicker, h: head, b: body }); }
    function pickOne(list, seed) { return list[hashStr(seed) % list.length]; }
    L.filter(function (e) { return e.k === "kitten"; }).forEach(function (e) {
      add(100, "Baby boom", pickOne(["It’s a kitten!", "Tiny paws on the rug", "Welcome to the world"], e.c) + ": " + nm(e.a, e.an) + " and " + nm(e.b, e.bn) + " welcome " + nm(e.c, e.cn),
        "The proud parents were seen cuddling on " + esc(spotLabel((cats[e.a] || {}).spot)) + ". Visitors are asked to keep the noise down.");
    });
    L.filter(function (e) { return e.k === "love"; }).forEach(function (e) { add(90, "Romance", "Love blooms: " + nm(e.a, e.an) + " and " + nm(e.b, e.bn) + " are an item", pickOne(["Witnesses report slow blinks across the room and at least one shared sunbeam.", "Sources close to the couple say it started with a stolen spot. It always does."], pair(e))); });
    L.filter(function (e) { return e.k === "breakup"; }).forEach(function (e) { add(85, "Heartbreak", "It’s over for " + nm(e.a, e.an) + " and " + nm(e.b, e.bn), "Neither cat would comment. One was seen staring at a wall for an hour."); });
    var feud = {};
    L.forEach(function (e) { if (MEAN_K[e.k] && e.b) { var k = pair(e); (feud[k] = feud[k] || { n: 0, e: e }).n++; } });
    Object.keys(feud).sort(function (a, b) { return feud[b].n - feud[a].n; }).slice(0, 2).forEach(function (k, i) {
      var f = feud[k], e = f.e;
      if (f.n < 2) return;
      add(80 - i * 10 + f.n, "Scandal", (i ? "Tensions rise" : "Feud boils over") + ": " + nm(e.a, e.an) + " vs. " + nm(e.b, e.bn), f.n + " hisses, swats, stares and stolen spots this week" + (f.n > 5 ? ". Mediators have been called in." : ". Neither cat is backing down."));
    });
    L.filter(function (e) { return e.k === "makeup"; }).forEach(function (e) { add(70, "Peace talks", nm(e.a, e.an) + " and " + nm(e.b, e.bn) + " bury the hatchet", "After weeks of hissing, the two were seen sharing a spot. Nobody knows how long it will last."); });
    var riv = L.filter(function (e) { return e.k === "rivals"; }); // one story, the rest rounded up (not a page of them)
    if (riv.length) add(65, "Battle lines", nm(riv[0].a, riv[0].an) + " and " + nm(riv[0].b, riv[0].bn) + " are officially rivals", "Their side of the room is now a no-go zone.");
    if (riv.length > 1) add(48, "Taking sides", "The room picks sides", "Also declaring war this week: " + riv.slice(1).map(function (e) { return nm(e.a, e.an) + " and " + nm(e.b, e.bn); }).join("; ") + ".");
    L.filter(function (e) { return e.k === "back"; }).forEach(function (e) { add(60, "Postcard", nm(e.a, e.an) + " writes home from an adventure", "“" + esc(e.text) + "”" + (e.g ? " " + nm(e.a, e.an) + " brought back " + esc(GIFT_NAME[e.g]) + "." : "")); });
    L.filter(function (e) { return e.k === "found" && GIFT_RARE[e.g] === 2; }).forEach(function (e) { add(55, "Treasure", nm(e.a, e.an) + " finds " + esc(GIFT_NAME[e.g]), "The find has not been reported to the authorities."); });
    L.filter(function (e) { return e.k === "friends"; }).slice(0, 2).forEach(function (e) { add(45, "Friendship", nm(e.a, e.an) + " and " + nm(e.b, e.bn) + " are inseparable", "They have a whole system now."); });
    var joined = L.filter(function (e) { return e.k === "joined"; });
    if (joined.length) add(50, "New in town", (joined.length === 1 ? nm(joined[0].a, joined[0].an) + " moves in" : joined.length + " new cats move in"), "Please welcome " + joined.map(function (e) { return nm(e.a, e.an); }).join(", ") + " to the room.");
    var gone = L.filter(function (e) { return e.k === "movedout"; });
    if (gone.length) add(40, "Farewell", gone.map(function (e) { return esc(e.an); }).join(", ") + (gone.length > 1 ? " have" : " has") + " moved out", "They went to live with a family down the street. Owners, remember to visit!");
    var storms = L.filter(function (e) { return e.k === "event" && e.e === "storm"; }).length, suns = L.filter(function (e) { return e.k === "event" && e.e === "sunbeam"; }).length;
    if (storms || suns) add(35, "Weather", storms ? (storms === 1 ? "A thunderstorm" : storms + " thunderstorms") + " send" + (storms === 1 ? "s" : "") + " everyone into hiding" : "Sunbeam season", (storms ? "Boxes were at capacity. " : "") + (suns ? suns + " big sunbeam" + (suns > 1 ? "s" : "") + " drew record nap crowds." : "No injuries were reported, only dignity."));
    var kind = L.filter(function (e) { return e.k === "kind"; });
    if (kind.length) { var givers = {}; kind.forEach(function (e) { givers[e.by] = (givers[e.by] || 0) + 1; }); var top = Object.keys(givers).sort(function (a, b) { return givers[b] - givers[a]; })[0];
      add(30, "Good neighbours", "Visitors hand out " + kind.length + " treat" + (kind.length > 1 ? "s and pets" : ""), esc(top) + " was the most generous, with " + givers[top] + ". The cats would like more."); }
    var social = {};
    L.forEach(function (e) { if (NICE_K[e.k] && e.b) { social[e.a] = (social[e.a] || 0) + 1; social[e.b] = (social[e.b] || 0) + 1; } });
    var star = Object.keys(social).sort(function (a, b) { return social[b] - social[a]; })[0];
    if (star && social[star] > 2) add(25, "Social butterfly", nm(star) + " is the cat about town", "Spent time with more cats than anyone else this week: " + social[star] + " friendly moments.");
    stories.sort(function (a, b) { return b.s - a.s; });
    var lead = stories[0], rest = stories.slice(1, 9);
    var start = new Date("2026-10-15T12:00:00"), no = Math.max(1, Math.floor((Date.now() - start) / (7 * DAY)) + 1);
    var counts = { meet: L.filter(function (e) { return e.b && (NICE_K[e.k] || MEAN_K[e.k]); }).length, gifts: L.filter(function (e) { return e.k === "found"; }).length, adv: L.filter(function (e) { return e.k === "adventure"; }).length };
    return '<header class="tm-mast"><h2>The Cattery Times</h2><div class="tm-dateline"><span>Week ending ' + new Date(d.to).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) +
      "</span><span>Vol. 1 · No. " + no + "</span><span>Price: one treat</span></div></header>" +
      (lead ? '<article class="tm-lead"><span class="tm-kicker">' + lead.k + "</span><h3>" + lead.h + "</h3><p>" + lead.b + "</p></article>" :
        '<article class="tm-lead"><span class="tm-kicker">Slow news week</span><h3>Nothing to report</h3><p>The cats napped. Check back next week.</p></article>') +
      (rest.length ? '<div class="tm-cols">' + rest.map(function (x) { return '<article class="tm-story"><span class="tm-kicker">' + x.k + "</span><h4>" + x.h + "</h4><p>" + x.b + "</p></article>"; }).join("") + "</div>" : "") +
      '<p class="tm-brief"><b>In brief:</b> ' + plural(counts.meet, "meeting") + " between cats, " + plural(counts.gifts, "gift") + " found, " + plural(counts.adv, "adventure") + ", and " + plural(room.cats.length, "cat") + " in the room.</p>";
  }

  // ---------- Snapshot: a picture of a cat (and its love or best friend) to save or share ----------
  function spriteCanvas(c, pose, facing) { // the cat's picture with what it's wearing, at its own pixels
    var sp = CD.render(c.data.look, pose, 0.3, facing), cv = document.createElement("canvas");
    cv.width = sp.w; cv.height = sp.h;
    var x = cv.getContext("2d"), im = x.createImageData(sp.w, sp.h), p32 = new Uint32Array(im.data.buffer);
    p32.set(sp.px);
    wearPixels(c, sp, function (px2, py2, col) { if (px2 >= 0 && py2 >= 0 && px2 < sp.w && py2 < sp.h) p32[py2 * sp.w + px2] = col; });
    x.putImageData(im, 0, 0);
    return cv;
  }
  function snapshot(id) {
    var c = cats[id];
    if (!c) return;
    var d = c.data, buddy = loveOf(id) || bestFriend(id), rel = loveOf(id) ? "In love with" : "Best friends with";
    var W = 1200, Hh = 900, cv = document.createElement("canvas"); cv.width = W; cv.height = Hh;
    var g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;
    // the room behind: wallpaper, the panelling, the wooden floor
    g.fillStyle = "#efe2cb"; g.fillRect(0, 0, W, 470);
    for (var i = 0; i < W; i += 48) for (var j = 0; j < 470; j += 48) { g.fillStyle = "#e6d6bc"; g.fillRect(i + 22, j + 22, 4, 4); }
    g.fillStyle = "#956d4f"; g.fillRect(0, 300, W, 170); g.fillStyle = "#c99c74"; g.fillRect(0, 292, W, 10);
    for (var b2 = 0; b2 < 8; b2++) { g.fillStyle = b2 % 2 ? "#8a6448" : "#7d5a40"; g.fillRect(0, 470 + b2 * 54, W, 54); }
    if (season() === "halloween") { // the room's jack-o'-lanterns, big
      var pcol = { o: "#5a2a08", "#": "#f08a24", y: "#ffd84a", "*": "#4a8a3a" };
      [[40, 560], [1076, 570]].forEach(function (q) { PUMPKIN.forEach(function (row, j) { for (var i2 = 0; i2 < row.length; i2++) if (pcol[row[i2]]) { g.fillStyle = pcol[row[i2]]; g.fillRect(q[0] + i2 * 6, q[1] + j * 6, 6, 6); } }); });
    }
    var big = buddy ? 4 : 5, me = spriteCanvas(c, "sit", 1);
    if (buddy) {
      var other = spriteCanvas(cats[buddy], "sit", -1);
      g.drawImage(me, 600 - 168 * big + 120, 640 - 136 * big + 60, 168 * big, 136 * big);
      g.drawImage(other, 600 - 120, 640 - 136 * big + 60, 168 * big, 136 * big);
      if (loveOf(id)) { g.fillStyle = "#ff5d7a"; g.font = "700 72px sans-serif"; g.textAlign = "center"; g.fillText("♥", 600, 250); }
    } else g.drawImage(me, (W - 168 * big) / 2, 640 - 136 * big + 80, 168 * big, 136 * big);
    // the caption band
    g.fillStyle = "rgba(16,16,20,0.92)"; g.fillRect(0, Hh - 200, W, 200);
    g.fillStyle = "#ff7a59"; g.textAlign = "left"; g.font = "700 64px Unbounded, sans-serif"; g.fillText(d.name, 48, Hh - 118);
    g.fillStyle = "#f2f1ec"; g.font = "500 30px 'Space Grotesk', sans-serif";
    g.fillText((d.ownerName ? d.ownerName + "’s cat · " : "") + CD.describe(d.look), 48, Hh - 70);
    if (buddy) { g.fillStyle = "#a9a7a0"; g.fillText(rel + " " + cats[buddy].data.name + (loveOf(id) ? " ♥" : ""), 48, Hh - 30); }
    g.fillStyle = "#a9a7a0"; g.textAlign = "right"; g.font = "500 24px 'Space Grotesk', sans-serif"; g.fillText("nickmade.net/play/cats", W - 48, Hh - 30);
    cv.toBlob(function (blob) {
      var file = new File([blob], d.name.replace(/[^\w-]+/g, "-") + "-the-cattery.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: d.name + " in the Cattery", text: d.name + " in the Cattery at nickmade.net/play/cats" }).catch(function () {}); return; }
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      toast("Saved a snapshot of " + esc(d.name) + ".");
    }, "image/png");
  }
  card.querySelector(".cats-snap").addEventListener("click", function () { if (cardFor) snapshot(cardFor); });

  // ---------- the Cattery's own changelog (changelog.js): the version in the header, and the list it opens ----------
  (function () {
    var log = window.CATTERY_LOG || [], btn = document.querySelector(".cats-ver"), dlg = document.querySelector(".cats-log-dlg:not(.cats-help)");
    if (!log.length || !btn || !dlg) return;
    btn.textContent = "v" + log[0].version;
    function when(d) { var t = new Date(d + "T12:00:00"); return isNaN(t) ? "" : t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
    dlg.querySelector(".cats-log-body").innerHTML = log.map(function (r) {
      return '<section class="cats-rel"><div class="cats-rel-head"><span class="cats-rel-v">v' + esc(r.version) + '</span><span class="cats-rel-t">' + esc(r.title || "") +
        '</span><time class="cats-rel-d">' + esc(when(r.date)) + "</time></div><ul>" + (r.items || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></section>";
    }).join("");
    btn.addEventListener("click", function () { dlg.showModal(); });
    dlg.querySelector(".cats-log-close").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); }); // outside the box
  })();

  // ---------- the Cat Maker ----------
  var maker = document.querySelector(".maker"), form = maker.querySelector(".maker-form"), done = maker.querySelector(".maker-done");
  var nameInput = form.querySelector('input[name="name"]');
  var ownerInput = form.querySelector('input[name="owner"]'); // the visitor's name, shared with the queue's "Your name" (nm-name)
  try { ownerInput.value = localStorage.getItem("nm-name") || ""; } catch (e) {}
  if (ADMIN && !ownerInput.value) ownerInput.value = "Nick";
  var look = CD.randomLook(), previewPose = "sit", gender = null; // "f" / "m", picked in the maker (required)
  var GENDER = { f: "girl", m: "boy" }, SHE = { f: "she’ll", m: "he’ll" };
  // the preview: the middle of the cat's picture (140 x 100 of its 168 x 136), shown at twice the size
  var pcv = maker.querySelector(".maker-preview canvas"), pctx = pcv.getContext("2d");
  pcv.width = 140; pcv.height = 100;
  var pimg = pctx.createImageData(140, 100), p32 = new Uint32Array(pimg.data.buffer);
  function chips() {
    var pc = maker.querySelector('[data-field="pattern"]');
    pc.innerHTML = Object.keys(CD.PATTERNS).map(function (k) { return '<button type="button" data-v="' + k + '" aria-pressed="false">' + CD.PATTERNS[k].name + "</button>"; }).join("");
    ["base", "second"].forEach(function (f) {
      maker.querySelector('[data-field="' + f + '"]').innerHTML = Object.keys(CD.FURS).map(function (k) { return '<button type="button" data-v="' + k + '" aria-pressed="false" title="' + CD.FURS[k].name + '" aria-label="' + CD.FURS[k].name + '" style="background:' + CD.FURS[k].hex + '"></button>'; }).join("");
    });
    maker.querySelector('[data-field="eyes"]').innerHTML = Object.keys(CD.EYES).map(function (k) {
      var bgc = CD.EYES[k].hex || "linear-gradient(90deg," + CD.EYES.blue.hex + " 50%," + CD.EYES.gold.hex + " 50%)";
      return '<button type="button" data-v="' + k + '" aria-pressed="false" title="' + CD.EYES[k].name + '" aria-label="' + CD.EYES[k].name + '" style="background:' + bgc + '"></button>';
    }).join("");
  }
  chips();
  function syncMaker() {
    ["pattern", "base", "second", "eyes"].forEach(function (f) {
      [].forEach.call(maker.querySelectorAll('[data-field="' + f + '"] button'), function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === look[f])); });
    });
    var sec = CD.PATTERNS[look.pattern].second;
    var secBox = maker.querySelector(".maker-second");
    secBox.hidden = !sec;
    if (sec) secBox.querySelector("legend").textContent = sec;
    form.fluffy.checked = !!look.fluffy;
    [].forEach.call(maker.querySelectorAll('[data-field="gender"] button'), function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === gender)); });
    maker.querySelector(".maker-desc").textContent = CD.describe(look) + (gender ? " · " + GENDER[gender] : "");
  }
  maker.querySelector(".maker-controls").addEventListener("click", function (e) {
    var b = e.target.closest("[data-v]");
    if (!b) return;
    var f = b.parentNode.dataset.field;
    if (f === "gender") { gender = b.dataset.v; maker.querySelector(".maker-msg").textContent = ""; SFX.tick(); syncMaker(); return; }
    look[f] = b.dataset.v;
    if (f === "pattern" && CD.PATTERNS[look.pattern].second && (!look.second || look.second === look.base)) look.second = look.base === "black" ? "ginger" : "black";
    if (f === "pattern" && look.pattern === "colorpoint" && look.eyes !== "blue") look.eyes = "blue";
    SFX.tick();
    syncMaker();
  });
  form.fluffy.addEventListener("change", function () { look.fluffy = form.fluffy.checked; syncMaker(); });
  maker.querySelector(".maker-random").addEventListener("click", function () { look = CD.randomLook(); gender = Math.random() < 0.5 ? "f" : "m"; syncMaker(); SFX.mew(look.seed); });
  maker.querySelector(".maker-poses").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pose]");
    if (!b) return;
    previewPose = b.dataset.pose;
    [].forEach.call(maker.querySelectorAll(".maker-poses button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
  });
  (function previewLoop(ts) {
    requestAnimationFrame(previewLoop);
    if (!maker.open || !form.offsetParent) return;
    var fps = FPS[previewPose] || 8, t = reduceMotion ? 0 : Math.floor(ts / 1000 * fps) / fps;
    var sp = CD.render(look, previewPose, t, 1);
    for (var y = 0; y < 100; y++) p32.set(sp.px.subarray((y + 32) * sp.w + 14, (y + 32) * sp.w + 154), y * 140);
    pctx.putImageData(pimg, 0, 0);
  })(0);
  var makeBtn = document.querySelector(".cats-make"), mineBtn = document.querySelector(".cats-mine");
  function openMaker() {
    // drop #make from the address first (the Play page links here with it): back-close.js adds a history step for the
    // open dialog and steps back out when it's closed; if that landed on #make again, hashchange would reopen the
    // maker, round and round (Nick, 2026-10-15)
    if (location.hash === "#make") history.replaceState(history.state, "", location.pathname + location.search);
    form.hidden = false; done.hidden = true;
    maker.querySelector(".maker-msg").textContent = "";
    syncMaker();
    if (!maker.open) maker.showModal();
    if (!matchMedia("(pointer: coarse)").matches) nameInput.focus();
  }
  makeBtn.addEventListener("click", openMaker);
  mineBtn.addEventListener("click", function () { var c = cats[room.mine]; if (c) { openCard(c.id); } });
  maker.querySelector(".maker-close").addEventListener("click", function () { maker.close(); });
  maker.addEventListener("click", function (e) { if (e.target === maker) maker.close(); });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = maker.querySelector(".maker-msg"), go = maker.querySelector(".maker-go");
    var name = nameInput.value.trim();
    if (!name) { msg.textContent = "Give your cat a name."; nameInput.focus(); return; }
    if (!gender) { msg.textContent = "Pick girl or boy."; return; }
    var ownerName = ownerInput.value.replace(/\s+/g, " ").trim();
    if (!ownerName && !ADMIN) { msg.textContent = "Add your name, so everyone knows whose cat it is."; ownerInput.focus(); return; }
    if (ownerName && !ADMIN) { try { localStorage.setItem("nm-name", ownerName); } catch (e) {} }
    go.disabled = true; msg.textContent = "";
    fetch(API + "/cats", { method: "POST", headers: headers(true), body: JSON.stringify({ visitorId: VID, name: name, ownerName: ownerName, gender: gender, look: look }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        go.disabled = false;
        if (d.error) { msg.textContent = d.error; return; }
        form.hidden = true; done.hidden = false;
        done.querySelector("h2 span").textContent = d.cat.name;
        done.querySelector(".maker-stay span").textContent = d.cat.name;
        done.querySelector(".maker-stay i").textContent = SHE[d.cat.gender] || "they’ll";
        done.querySelector(".maker-stay").hidden = !!ADMIN; // Nick's cats never move out (cats.js retire())
        done.querySelector("code").textContent = d.code;
        SFX.mew(d.cat.look.seed);
        load(d.cat.id);
      })
      .catch(function () { go.disabled = false; msg.textContent = "Couldn’t reach the room. Try again in a bit."; });
  });
  done.querySelector(".maker-copy").addEventListener("click", function (e) { copy(done.querySelector("code").textContent, e.target); });
  done.querySelector(".maker-to-room").addEventListener("click", function () { maker.close(); if (room.mine) openCard(room.mine); });
  maker.querySelector(".maker-claim-go").addEventListener("click", function () {
    var code = maker.querySelector(".maker-code").value.trim(), msg = maker.querySelector(".maker-msg");
    if (!code) return;
    fetch(API + "/cats/claim", { method: "POST", headers: headers(true), body: JSON.stringify({ visitorId: VID, code: code }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { msg.textContent = d.error; return; }
        maker.close(); toast("You’re looking after " + esc(d.cat.name) + " here now."); load(d.cat.id);
      })
      .catch(function () { msg.textContent = "Couldn’t reach the room. Try again in a bit."; });
  });

  // ---------- the room from the Worker ----------
  var hint = document.querySelector(".cats-hint");
  function hideHint() { hint.classList.add("gone"); }
  setTimeout(hideHint, 8000);
  var lastT = 0; // the newest history line already seen on this page
  var landed = false;
  function apply(d, arrived) {
    var fresh = lastT ? (d.log || []).filter(function (e) { return e.t > lastT && e.b && Date.now() - e.t < 5 * 60e3; }) : [];
    (d.log || []).forEach(function (e) { if (e.t > lastT) lastT = e.t; });
    setTimeout(function () { fresh.forEach(playMeeting); }, 600); // after the cats are updated below
    var active = room && room.mine;
    room = { cats: d.cats || [], rel: d.rel || {}, log: d.log || [], mine: d.mine, mines: d.mines || (d.mine ? [d.mine] : []), owner: !!d.owner, max: d.max || 30 };
    if (arrived && room.mines.indexOf(arrived) >= 0) room.mine = arrived; // the one just made
    else if (active && room.mines.indexOf(active) >= 0) room.mine = active;
    var seen = {};
    room.cats.forEach(function (cd) {
      seen[cd.id] = true;
      var c = cats[cd.id];
      if (!c) { c = addCat(cd); if (cd.id === arrived) { var door = { x: 300, y: Y - 20, z: 0 }; c.x = door.x; c.y = door.y; c.z = 0; c.spot = null; plan(c, cd.spot); c.spot = cd.spot; } return; }
      c.data = cd;
      if (c.hiding) c.home = cd.spot; // back there when the storm's over
      else if (cd.spot !== c.spot && !c.path.length && !c.fighting) { plan(c, cd.spot); c.spot = cd.spot; } // it moved since we last looked
      else c.spot = cd.spot;
    });
    Object.keys(cats).forEach(function (id) { if (!seen[id]) delete cats[id]; });
    makeBtn.hidden = !!room.mine && !room.owner; // Nick can always make another
    mineBtn.hidden = !room.mine;
    if (room.mine && cats[room.mine]) mineBtn.textContent = cats[room.mine].data.name;
    renderPanel();
    if (cardFor && cats[cardFor] && !card.hidden) openCard(cardFor);
    room.mineLog = d.mineLog || [];
    setEvent(d.event);
    if (!landed) {
      landed = true; landingFights();
      if (room.mines.length) {
        trickNews();
        showRecap(d);
        if (lastVisit && Date.now() - lastVisit > 3600e3) setTimeout(greet, 1500);
        markVisit();
      }
    }
  }
  function load(arrived) {
    return fetch(API + "/cats?visitorId=" + encodeURIComponent(VID), { headers: headers() })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.error) apply(d, arrived); })
      .catch(function (e) { if (window.console) console.error("cattery:", e); }); // offline: try again next minute
  }
  load().then(function () { if (location.hash === "#make" && (!room.mine || room.owner)) openMaker(); });
  setInterval(function () { if (!document.hidden) load(); }, 60000);
  window.addEventListener("hashchange", function () { if (location.hash === "#make" && (!room.mine || room.owner)) openMaker(); });

  // ---------- sound (a tiny synth: mews, purrs, crunching; nothing plays until you do something) ----------
  var audio = null, soundOn = true;
  try { soundOn = localStorage.getItem("nm-cats-sound") !== "off"; } catch (e) {}
  var soundBtn = document.querySelector(".cats-sound");
  soundBtn.setAttribute("aria-pressed", String(soundOn));
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    try { localStorage.setItem("nm-cats-sound", soundOn ? "on" : "off"); } catch (e) {}
    stormSound(!!(roomEvent && roomEvent.k === "storm"));
  });
  function ac() {
    if (!soundOn) return null;
    if (!audio) { var A = window.AudioContext || window.webkitAudioContext; if (!A) return null; audio = new A(); }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }
  function noiseBuf(a, dur) {
    var n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Recorded sounds (Nick, 2026-10-14; from Pixabay, see NOTES), trimmed, mono, levelled, 96 kbps. They're fetched
  // shortly after the page loads and decoded the first time a sound plays (browsers only allow audio after a tap).
  var SOUND_DIR = new URL("sounds/", script.src).href;
  var SOUNDS = { meows: ["meow-1", "meow-2", "meow-3"], purr: "purr" };
  var lastSample = -1, raw = {}, decoded = {};
  setTimeout(function () {
    SOUNDS.meows.concat(SOUNDS.purr).forEach(function (name) {
      raw[name] = fetch(SOUND_DIR + name + ".mp3").then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
      raw[name].catch(function () {});
    });
  }, 1200);
  // play one: rate (also its pitch), vol, and optionally only the first `cut` seconds (faded out)
  function sample(a, name, rate, vol, cut) {
    if (!decoded[name]) {
      if (!raw[name]) return Promise.reject(new Error("not loaded"));
      decoded[name] = raw[name].then(function (b) { return new Promise(function (ok, no) { a.decodeAudioData(b.slice(0), ok, no); }); });
    }
    return decoded[name].then(function (buf) {
      var t = a.currentTime, src = a.createBufferSource(), g = a.createGain();
      src.buffer = buf; src.playbackRate.value = rate;
      var len = Math.min(buf.duration / rate, cut || 99);
      g.gain.setValueAtTime(vol, t);
      if (cut && cut < buf.duration / rate) { g.gain.setValueAtTime(vol, t + len - 0.5); g.gain.linearRampToValueAtTime(0.0001, t + len); }
      src.connect(g); g.connect(a.destination); src.start(t); src.stop(t + len + 0.02);
    });
  }
  // the vowels, as formant frequencies for a cat-sized mouth (about 1.3x a person's)
  var VOWELS = { m: [420, 1300, 2900], i: [560, 2900, 3800], e: [780, 2500, 3500], a: [1150, 1750, 3100], o: [820, 1250, 3000], u: [560, 1050, 2800], r: [650, 1500, 2300] };
  // each call: dur (s), pitch [time 0..1, x base], vowel [time 0..1, vowel], and extras: trill (Hz), rough (a growl an
  // octave down), breath, vib (vibrato depth), vol (evened out so every call peaks near 0.35), at (a second call's start, s)
  var MEOWS = {
    meow: [{ dur: 0.58, pitch: [[0, 0.85], [0.3, 1.18], [0.65, 1.05], [1, 0.72]], vowel: [[0, "m"], [0.12, "e"], [0.45, "a"], [0.8, "u"]] }],
    mew: [{ dur: 0.26, pitch: [[0, 1.2], [0.35, 1.45], [1, 1.1]], vowel: [[0, "m"], [0.15, "i"], [0.85, "u"]], vol: 1.18 }],
    mrrp: [{ dur: 0.34, pitch: [[0, 0.8], [0.5, 0.95], [1, 1.35]], vowel: [[0, "r"], [0.55, "r"], [1, "i"]], trill: 26, vol: 1.29 }],
    maaow: [{ dur: 0.95, pitch: [[0, 0.9], [0.18, 1.12], [0.6, 1.08], [1, 0.68]], vowel: [[0, "m"], [0.1, "e"], [0.25, "a"], [0.7, "a"], [0.95, "u"]], vib: 0.035, vol: 0.7 }],
    mrow: [{ dur: 0.48, pitch: [[0, 0.68], [0.3, 0.8], [1, 0.55]], vowel: [[0, "m"], [0.15, "r"], [0.4, "a"], [0.9, "u"]], rough: 0.5, breath: 0.12, vol: 0.77 }],
    meep: [{ dur: 0.15, pitch: [[0, 1.3], [1, 1.65]], vowel: [[0, "m"], [0.25, "i"], [1, "i"]], vol: 2.6 }],
    mewmew: [{ dur: 0.22, pitch: [[0, 1.1], [0.4, 1.3], [1, 1.0]], vowel: [[0, "m"], [0.2, "e"], [0.9, "u"]], vol: 0.62 },
      { at: 0.3, dur: 0.3, pitch: [[0, 1.05], [0.35, 1.25], [1, 0.85]], vowel: [[0, "m"], [0.2, "e"], [0.9, "u"]], vol: 0.66 }],
  };
  var lastMeow = null;
  function meowCall(a, t, c, base, stretch) {
    var dur = c.dur * stretch, end = t + dur, out = a.createGain(), master = a.createGain(), lp = a.createBiquadFilter();
    var src = a.createOscillator(), vib = a.createOscillator(), vg = a.createGain();
    src.type = "sawtooth";
    c.pitch.forEach(function (p, i) { var f = base * p[1], at = t + p[0] * dur; if (!i) src.frequency.setValueAtTime(f, at); else src.frequency.exponentialRampToValueAtTime(f, at); });
    vib.frequency.value = 5.5 + Math.random() * 2; vg.gain.value = base * (c.vib || 0.012); vib.connect(vg); vg.connect(src.frequency);
    // the mouth: closed for the "m", then open
    lp.type = "lowpass"; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(c.vowel[0][1] === "m" ? 700 : 3000, t); lp.frequency.exponentialRampToValueAtTime(6500, t + Math.min(0.09, dur * 0.3));
    lp.frequency.setValueAtTime(6500, end - dur * 0.2); lp.frequency.exponentialRampToValueAtTime(1600, end);
    // three formants following the vowels
    [[1, 6], [0.62, 9], [0.3, 12]].forEach(function (fm, n) {
      var bp = a.createBiquadFilter(), g = a.createGain();
      bp.type = "bandpass"; bp.Q.value = fm[1]; g.gain.value = fm[0] * 4.2;
      c.vowel.forEach(function (v, i) { var f = VOWELS[v[1]][n], at = t + v[0] * dur; if (!i) bp.frequency.setValueAtTime(f, at); else bp.frequency.linearRampToValueAtTime(f, at); });
      src.connect(bp); bp.connect(g); g.connect(lp);
      if (c.rough) { // a growl an octave down, through the same mouth
        if (!n) { var sub = a.createOscillator(), sg = a.createGain(); sub.type = "square"; sub.frequency.value = base * 0.34; sg.gain.value = c.rough * 0.5; sub.connect(sg); sg.connect(bp); sub.start(t); sub.stop(end + 0.05); }
      }
    });
    // breath: a little noise through the second formant
    var nz = a.createBufferSource(), nf = a.createBiquadFilter(), ng = a.createGain();
    nz.buffer = noiseBuf(a, dur + 0.05); nf.type = "bandpass"; nf.Q.value = 1.2; nf.frequency.value = VOWELS.e[1]; ng.gain.value = c.breath || 0.05;
    nz.connect(nf); nf.connect(ng); ng.connect(lp);
    lp.connect(out); out.connect(master); master.connect(a.destination);
    // loudness: soft onset, hold, tail off
    var vol = 0.22 * (c.vol || 1);
    master.gain.setValueAtTime(0.0001, t); master.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur * 0.25));
    master.gain.setValueAtTime(vol, end - dur * 0.3); master.gain.exponentialRampToValueAtTime(0.0001, end);
    if (c.trill) { // the rolled "rrr": the voice pulsing on and off
      var tr = a.createOscillator(), tg = a.createGain();
      tr.type = "square"; tr.frequency.value = c.trill; tg.gain.setValueAtTime(0.5, t); tg.gain.linearRampToValueAtTime(0, t + dur * 0.6);
      out.gain.value = 0.5; tr.connect(tg); tg.connect(out.gain); tr.start(t); tr.stop(end);
    }
    src.start(t); vib.start(t); nz.start(t); src.stop(end + 0.05); vib.stop(end + 0.05); nz.stop(end + 0.05);
  }
  var SFX = {
    // synthMew (below, the fallback): a meow (Nick: "more like a real cat meow ... at least 5 variations"): a buzzy voice (sawtooth + a little breath,
    // with vibrato) through three formant filters that glide through the vowels of m-e-o-w, behind a lowpass that
    // opens from the closed-mouth "m". One of seven calls at random, never the same twice running; each cat has its own
    // pitch (seed), and every call is a little higher or lower and longer or shorter than the last.
    // real recordings first (Nick's, play/cats/sounds/: see SOUNDS); the synthesized calls below only if they can't play
    mew: function (seed) {
      var a = ac(); if (!a) return;
      var n = SOUNDS.meows.length, i;
      do { i = Math.floor(Math.random() * n); } while (i === lastSample && n > 1);
      lastSample = i;
      // each cat a little higher or lower (by its seed), and every call a touch different
      var rate = (0.88 + ((seed || 1) % 9) * 0.035) * (0.97 + Math.random() * 0.06);
      sample(a, SOUNDS.meows[i], rate, 0.42).catch(function () { SFX.synthMew(seed); });
    },
    synthMew: function (seed) {
      var a = ac(); if (!a) return;
      var kinds = Object.keys(MEOWS), k;
      do { k = kinds[Math.floor(Math.random() * kinds.length)]; } while (k === lastMeow && kinds.length > 1);
      lastMeow = k;
      var base = (480 + ((seed || 1) % 9) * 35) * (0.94 + Math.random() * 0.12), stretch = 0.88 + Math.random() * 0.24;
      MEOWS[k].forEach(function (c) { meowCall(a, a.currentTime + 0.01 + (c.at || 0) * stretch, c, base, stretch); });
    },
    // a purr: the recording; synthPurr (low rumbling noise pulsing about 25 times a second) if it can't play
    purr: function () {
      var a = ac(); if (!a) return;
      sample(a, SOUNDS.purr, 0.96 + Math.random() * 0.08, 0.5, 3.6).catch(function () { SFX.synthPurr(); });
    },
    synthPurr: function () {
      var a = ac(); if (!a) return;
      var t = a.currentTime, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
      src.buffer = noiseBuf(a, 2.6); f.type = "lowpass"; f.frequency.value = 180;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.3); g.gain.setValueAtTime(0.28, t + 2.1); g.gain.linearRampToValueAtTime(0.0001, t + 2.6);
      lfo.frequency.value = 24; lg.gain.value = 0.22; lfo.connect(lg); lg.connect(g.gain);
      src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); lfo.start(t); src.stop(t + 2.6); lfo.stop(t + 2.6);
    },
    hiss: function (vol) {
      var a = ac(); if (!a) return;
      var t = a.currentTime, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = noiseBuf(a, 0.7); f.type = "highpass"; f.frequency.value = 2500;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + 0.7);
    },
    crunch: function () {
      var a = ac(); if (!a) return;
      for (var i = 0; i < 9; i++) {
        var t = a.currentTime + 0.35 + i * 0.42 + Math.random() * 0.1, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
        src.buffer = noiseBuf(a, 0.06); f.type = "bandpass"; f.frequency.value = 1400 + Math.random() * 900; f.Q.value = 1.4;
        g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + 0.07);
      }
    },
    bowl: function () { // kibble poured into the bowl
      var a = ac(); if (!a) return;
      for (var i = 0; i < 16; i++) {
        var t = a.currentTime + i * 0.025 + Math.random() * 0.02, o = a.createOscillator(), g = a.createGain();
        o.type = "triangle"; o.frequency.value = 2200 + Math.random() * 1800;
        g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.04);
      }
    },
    jingle: function () { // the bell on the feather toy
      var a = ac(); if (!a) return;
      [0, 0.09, 0.2, 0.31].forEach(function (d) {
        var t = a.currentTime + d, o = a.createOscillator(), g = a.createGain();
        o.type = "sine"; o.frequency.value = 3100 + Math.random() * 300;
        g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.26);
      });
    },
    tick: function () {
      var a = ac(); if (!a) return;
      var t = a.currentTime, o = a.createOscillator(), g = a.createGain();
      o.type = "square"; o.frequency.value = 1200; g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.05);
    },
    turn: function () {
      var a = ac(); if (!a) return;
      var t = a.currentTime, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = noiseBuf(a, 0.3); f.type = "bandpass"; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(1600, t + 0.25);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.08, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 0.3);
      src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + 0.3);
    },
  };

  requestAnimationFrame(frame);
})();
