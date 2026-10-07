// My Office (Ver 1.4): My real office as an pixel-art diorama, in the style of Unpacking: the room cut
// away on a slab, two walls standing at the back, the front two removed so you can see in. Turn the room (the buttons,
// the arrow keys, or a sideways drag) to see each pair of walls; click (or tap) a thing: it does something, and a card says what it is, most with a link to its part
// of the site. Some show live data from the Worker: the Magnavox plays the movie Nick watched last, the big TV his
// gamerscore, the headphones what he's listening to.
//
// How it's drawn: everything in the room is a box in room units (x along the desk wall, y along the window wall, z up;
// 1 unit = 1 screen pixel across). Each frame the boxes are sorted back to front and drawn into a pixel buffer as true
// 2:1 isometric pixels: a box's top and its two faces toward you, each a plain colour (shaded by side) with optional
// painting on it (a monitor's screen, a tape's spine, the window's view). Every pixel also records which box drew it,
// which is how clicks and the hover outline find things. Turning the room maps the room's coordinates before drawing.
// Then: outlines round objects, the hover outline, and at night the dark with pools of lamp and screen light.
(function () {
  "use strict";
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- the canvas ----------
  var WIN_C = 78; // where the window's middle is along the window wall (room y)
  var X = 210, Y = 150, WALL = 122, WT = 6, SLAB = 8, M = 8; // room size, wall height and thickness, slab, margin
  var CW = X + Y + 2 * WT + 2 * M, CH = M + WALL + WT + (X + Y) / 2 + SLAB + M + 6;
  var canvas = document.getElementById("office");
  var ctx = canvas.getContext("2d");
  var stage = document.querySelector(".office-stage");
  // The room is drawn at CW x CH; the canvas is twice that, each room pixel shown as 2x2, so the Magnavox's screen
  // alone can show double the detail (hiScreen, see present())
  canvas.width = CW * 2;
  canvas.height = CH * 2;
  var img = ctx.createImageData(CW * 2, CH * 2);
  var hb = new Uint32Array(img.data.buffer);
  var buf = new Uint32Array(CW * CH);
  var hiScreen = new Uint32Array(32 * 28); // the Magnavox's screen at double resolution, row 0 at the top
  var hiMap = new Int16Array(CW * CH); // room pixels showing that screen: 1 + its cell (u + v * 16, v up from the bottom)
  var ids = new Int16Array(CW * CH); // which box drew each pixel (-1: background)
  var glow = new Uint8Array(CW * CH); // 1 where a pixel gives off light (screens, lamps): night doesn't darken it
  var windowPx = new Uint8Array(CW * CH); // 1 where the window is (it's painted on its wall)
  var mirrorPx = new Uint8Array(CW * CH); // 1 where the mirror's glass shows (compositeMirror fills it with the reflection)
  // the reflection: the room drawn again, flipped across the mirror's wall (see renderReflection)
  var rBuf = new Uint32Array(CW * CH), rIds = new Int16Array(CW * CH), rGlow = new Uint8Array(CW * CH);

  // ---------- colour helpers (pixels are 0xAABBGGRR) ----------
  var cache = {};
  function H(hex) {
    var c = cache[hex];
    if (c === undefined) {
      var n = parseInt(hex.slice(1), 16);
      c = cache[hex] = (255 << 24 | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0;
    }
    return c;
  }
  function shade(c, k) {
    if (k === 1) return c;
    var r = Math.min(255, (c & 255) * k), g = Math.min(255, (c >> 8 & 255) * k), bl = Math.min(255, (c >> 16 & 255) * k);
    return (255 << 24 | bl << 16 | g << 8 | r) >>> 0;
  }
  function mix(c, d, a) { // c, a of the way to d
    var r = (c & 255) * (1 - a) + (d & 255) * a, g = (c >> 8 & 255) * (1 - a) + (d >> 8 & 255) * a, bl = (c >> 16 & 255) * (1 - a) + (d >> 16 & 255) * a;
    return (255 << 24 | bl << 16 | g << 8 | r) >>> 0;
  }
  function hash(a, b) { var h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  // A 3x5 pixel font for screens and speech bubbles
  var GLYPHS = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
    "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
    A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
    F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
    K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
    P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
    U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
    Z: "111001010100111", " ": "000000000000000", ".": "000000000000010", ",": "000000000010100", "!": "010010010000010",
    "?": "110001010000010", "-": "000000111000000", "+": "000010111010000", ":": "000010000010000", "'": "010010000000000",
    "&": "010101010101011", "/": "001001010100100", "*": "101010101000000", "#": "101111101111101",
  };
  function textW(s) { return String(s).length * 4 - 1; }
  function fit(s, max) { s = String(s).toUpperCase().replace(/[^A-Z0-9 .,!?\-+:'&/*#]/g, ""); return s.length > max ? s.slice(0, max - 1).trim() + "." : s; }

  // ---------- turning the room ----------
  // rot 0: the window wall on the left and the desk wall on the right, at the back (the view in Nick's photo); each
  // turn brings the next wall round
  var rot = 0;
  function dims() { return rot % 2 ? [Y, X] : [X, Y]; }
  var reflect = false; // drawing the room as seen in the mirror: flipped across its wall (y = Y)
  function vcell(x, y) { // a room cell -> its cell in the turned view
    if (reflect) y = 2 * Y - 1 - y;
    switch (rot) {
      case 0: return [x, y];
      case 1: return [y, X - 1 - x];
      case 2: return [X - 1 - x, Y - 1 - y];
      default: return [Y - 1 - y, x];
    }
  }
  var FACE_VX = ["px", "py", "nx", "ny"], FACE_VY = ["py", "nx", "ny", "px"]; // the room face that shows as each front face
  function faceOf(which) { // ...and in the mirror, where the room is flipped across y, the +y and -y faces trade places
    var f = which === "vy" ? FACE_VY[rot] : FACE_VX[rot];
    return reflect && (f === "py" || f === "ny") ? (f === "py" ? "ny" : "py") : f;
  }
  var OX = 0, OY = M + WALL + WT;
  function origin() { OX = M + WT + dims()[1]; }

  // ---------- drawing boxes ----------
  var cur = null; // the box being drawn
  function put(sx, sy, c, em) { // em: true gives off light; "glass" is the mirror's glass
    if (sx < 0 || sy < 0 || sx >= CW || sy >= CH) return;
    var i = sy * CW + sx;
    buf[i] = c;
    ids[i] = cur.n;
    glow[i] = em === true ? 1 : 0;
    if (!reflect) mirrorPx[i] = em === "glass" ? 1 : 0;
  }
  // A pen for one face: set(u, v, colour) with u left to right as you see it and v up from the bottom (the same on the
  // thing whichever way the room is turned); setW(a, z) uses the room's own coordinate along the face (x or y).
  function facePen(b, vb, which, k) {
    var vy = which === "vy";
    var face = faceOf(which);
    var w = vy ? vb.vx1 - vb.vx0 : vb.vy1 - vb.vy0, h = b.z1 - b.z0;
    var alongX = face === "py" || face === "ny";
    function uOf(a) {
      var c = alongX ? vcell(a, b.y0) : vcell(b.x0, a);
      return vy ? c[0] - vb.vx0 : vb.vy1 - 1 - c[1];
    }
    var pen = {
      w: w, h: h, face: face, box: b,
      set: function (u, v, col, em) {
        u = Math.round(u); v = Math.round(v);
        if (u < 0 || v < 0 || u >= w || v >= h || col == null) return;
        var c = typeof col === "number" ? col : H(col);
        if (!em) c = shade(c, k);
        var z = b.z0 + v, sx, sy;
        if (vy) { var vx = vb.vx0 + u, r = vb.vy1 - 1; sx = OX + vx - r; sy = OY + Math.floor((vx + r) / 2) - z; }
        else { var vyy = vb.vy1 - 1 - u, cc = vb.vx1 - 1; sx = OX + cc - vyy; sy = OY + Math.floor((cc + vyy) / 2) - z; }
        put(sx, sy, c, em);
      },
      rect: function (u, v, rw, rh, col, em) { for (var j = 0; j < rh; j++) for (var i = 0; i < rw; i++) pen.set(u + i, v + j, col, em); },
      at: function (u, v) { // the room pixel (u, v) lands on, or -1
        if (u < 0 || v < 0 || u >= w || v >= h) return -1;
        var z = b.z0 + v, sx, sy;
        if (vy) { var vx = vb.vx0 + u, r = vb.vy1 - 1; sx = OX + vx - r; sy = OY + Math.floor((vx + r) / 2) - z; }
        else { var vyy = vb.vy1 - 1 - u, cc = vb.vx1 - 1; sx = OX + cc - vyy; sy = OY + Math.floor((cc + vyy) / 2) - z; }
        return sx < 0 || sy < 0 || sx >= CW || sy >= CH ? -1 : sy * CW + sx;
      },
      setW: function (a, z, col, em) { pen.set(uOf(a), z - b.z0, col, em); },
      rectW: function (a0, a1, z0, z1, col, em) { for (var z = z0; z < z1; z++) for (var a = a0; a < a1; a++) pen.setW(a, z, col, em); },
      eachW: function (a0, a1, z0, z1, fn) {
        for (var z = z0; z < z1; z++) for (var a = a0; a < a1; a++) { var c = fn(a, z); if (c) { if (c.push) pen.setW(a, z, c[0], c[1]); else pen.setW(a, z, c); } }
      },
      text: function (u, vTop, s, col, em) {
        s = String(s).toUpperCase();
        for (var i = 0; i < s.length; i++) {
          var g = GLYPHS[s[i]] || GLYPHS["?"];
          for (var q = 0; q < 15; q++) if (g[q] === "1") pen.set(u + i * 4 + q % 3, vTop - Math.floor(q / 3), col, em);
        }
      },
      disc: function (cu, cv, r, col, em) { for (var j = -r; j <= r; j++) for (var i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.6) pen.set(cu + i, cv + j, col, em); },
    };
    return pen;
  }
  // the top: set(x, y, colour) in room coordinates
  function topPen(b) {
    var pen = {
      top: true, box: b,
      set: function (x, y, col, em) {
        x = Math.round(x); y = Math.round(y);
        if (x < b.x0 || y < b.y0 || x >= b.x1 || y >= b.y1 || col == null) return;
        var c = vcell(x, y);
        put(OX + c[0] - c[1], OY + Math.floor((c[0] + c[1]) / 2) - b.z1, typeof col === "number" ? col : H(col), em);
      },
      rect: function (x, y, w, h, col, em) { for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) pen.set(x + i, y + j, col, em); },
      each: function (fn) { for (var y = b.y0; y < b.y1; y++) for (var x = b.x0; x < b.x1; x++) { var c = fn(x, y); if (c) { if (c.push) pen.set(x, y, c[0], c[1]); else pen.set(x, y, c); } } },
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
    if (b.sprite) { b.sprite(b); return; } // drawn straight onto the screen (the plant), in its place among the boxes
    var base = b.c == null ? null : H(b.c), k = b.k || [0.86, 0.7];
    ["vx", "vy"].forEach(function (which) {
      var pen = facePen(b, vb, which, which === "vy" ? k[0] : k[1]);
      if (base != null) {
        var fc = b.faces && b.faces[pen.face] ? H(b.faces[pen.face]) : base;
        for (var v = 0; v < pen.h; v++) for (var u = 0; u < pen.w; u++) pen.set(u, v, fc);
      }
      var p = b.paint && (b.paint[pen.face] || b.paint.side);
      if (p) p.call(b, pen);
    });
    var tp = topPen(b);
    if (base != null) {
      var tc = b.topc ? H(b.topc) : base;
      for (var y = b.y0; y < b.y1; y++) for (var x = b.x0; x < b.x1; x++) tp.set(x, y, tc);
    }
    if (b.paint && b.paint.top) b.paint.top.call(b, tp);
  }

  // Back to front: two boxes that overlap on screen go in the order of an axis that separates them
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
      else aFirst = A.vx0 + A.vy0 + A.z0 <= B.vx0 + B.vy0 + B.z0; // they intersect: a guess
      if (aFirst) { after[i].push(j); deg[j]++; } else { after[j].push(i); deg[i]++; }
    }
    var out = [], q = [];
    for (i = 0; i < n; i++) if (!deg[i]) q.push(i);
    while (q.length) { var k = q.shift(); out.push(list[k]); after[k].forEach(function (m) { if (!--deg[m]) q.push(m); }); }
    if (out.length < n) list.forEach(function (bx) { if (out.indexOf(bx) < 0) out.push(bx); }); // a loop: draw the rest anyway
    return out;
  }

  // ---------- state ----------
  var hour = new Date().getHours();
  var state = { night: false, lamp: false, lampHue: 0, live: {}, on: { magnavox: true, "side-monitor": true } }; // on: TVs switched on (the Magnavox starts on, showing the last movie; the second monitor too)
  // Night switches the room's lamps on: the desk lamp and the lava lamp (the floor lamp is always on); day switches the
  // desk lamp off again. Either can still be flipped by hand after.
  function setNight(on) {
    state.night = !!on;
    state.lamp = state.night;
    if (state.night && byId.lava) byId.lava.off = false;
  }
  // a TV: clicking switches it on (static, then its picture, looping until it's switched off) or off
  function tvSwitch(id) {
    state.on[id] = !state.on[id];
    var on = state.on[id];
    if (id === "tv") on ? SFX.flatOn() : SFX.flatOff(); // the big flat TV
    else if (id === "side-monitor") on ? SFX.lcdOn() : SFX.lcdOff();
    else if (id === "samsung") on ? SFX.crtOn(7800) : SFX.crtOff(7800); // the two CRTs, each its own whine
    else on ? SFX.crtOn(9400) : SFX.crtOff(9400);
  }
  var anims = {}, now = 0;
  function since(id) { return anims[id] == null ? Infinity : now - anims[id]; }

  // ---------- sound (a tiny synth; nothing plays until something is clicked) ----------
  var audio = null, soundOn = true;
  try { soundOn = localStorage.getItem("nm-office-sound") !== "off"; } catch (e) {}
  function ac() {
    if (!soundOn) return null;
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }
  function tone(freq, dur, type, vol, slide, delay) {
    var a = ac(); if (!a) return;
    var t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, delay) {
    var a = ac(); if (!a) return;
    var bf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate), d = bf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var s = a.createBufferSource(), g = a.createGain();
    s.buffer = bf; g.gain.value = vol || 0.04;
    s.connect(g); g.connect(a.destination); s.start(a.currentTime + (delay || 0));
  }
  // noise through a band-pass swept from f0 to f1 Hz, swelling in and fading out: fabric moving
  function whoosh(dur, vol, f0, f1, delay) {
    var a = ac(); if (!a) return;
    var t = a.currentTime + (delay || 0);
    var bf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate), d = bf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = bf; f.type = "bandpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(t);
  }
  var SFX = {
    blip: function () { tone(660, 0.08, "square", 0.05); tone(990, 0.08, "square", 0.04, null, 0.06); },
    power: function () { noise(0.35, 0.03); tone(120, 0.3, "sawtooth", 0.03, 60); },
    off: function () { tone(900, 0.18, "sine", 0.05, 80); },
    oneUp: function () { [660, 784, 1319, 1047, 1175, 1568].forEach(function (f, i) { tone(f, 0.09, "square", 0.04, null, i * 0.07); }); },
    boing: function () { tone(220, 0.25, "square", 0.05, 660); },
    meow: function () { tone(700, 0.18, "triangle", 0.08, 1100); tone(1000, 0.3, "triangle", 0.07, 520, 0.16); },
    honk: function () { tone(330, 0.12, "square", 0.05); tone(330, 0.16, "square", 0.05, null, 0.17); },
    swish: function () { noise(0.25, 0.025); },
    notes: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.16, "triangle", 0.05, null, i * 0.12); }); },
    click: function () { tone(1800, 0.03, "square", 0.03); },
    portal: function () { tone(200, 0.6, "sawtooth", 0.04, 900); tone(300, 0.6, "sine", 0.05, 1400, 0.05); },
    coin: function () { tone(988, 0.08, "square", 0.05); tone(1319, 0.3, "square", 0.05, null, 0.08); },
    turn: function () { tone(440, 0.06, "square", 0.03, 660); },
    // night falls: a soft chime stepping down, then two cricket chirps
    night: function () {
      [784, 659, 523, 392].forEach(function (f, i) { tone(f, 0.5, "sine", 0.05, null, i * 0.13); });
      for (var c = 0; c < 2; c++) for (var i = 0; i < 4; i++) tone(4200, 0.022, "square", 0.012, null, 0.75 + c * 0.32 + i * 0.045);
    },
    // morning: the chime stepping up, then a bird's tweet-tweet
    day: function () {
      [392, 523, 659, 784].forEach(function (f, i) { tone(f, 0.45, "sine", 0.05, null, i * 0.11); });
      tone(2600, 0.07, "sine", 0.04, 3600, 0.6); tone(2800, 0.09, "sine", 0.04, 3900, 0.72);
    },
    // the curtains: the rings clicking along the rod over the cloth's whoosh (lower when closing, brighter opening)
    curtains: function (closing) {
      whoosh(0.7, 0.09, closing ? 2400 : 900, closing ? 700 : 2600);
      for (var i = 0; i < 6; i++) tone(2200 + (i % 2) * 400, 0.018, "triangle", 0.025, null, 0.04 + i * 0.09);
    },
    // the mirror: a bright "sha-WEENG", a quick shimmer sliding up into a ringing high note, sparkles on top
    shine: function () {
      whoosh(0.35, 0.05, 1500, 7000);
      tone(880, 0.18, "sine", 0.05, 2640, 0.04); tone(1320, 0.18, "triangle", 0.03, 3960, 0.04);
      tone(2637, 0.9, "sine", 0.05, null, 0.2); tone(3951, 0.7, "sine", 0.03, null, 0.22);
      [5274, 6272, 4699, 7040].forEach(function (f, i) { tone(f, 0.12, "sine", 0.02, null, 0.3 + i * 0.07); });
    },
    // each screen sounds like what it is (tvSwitch):
    // the old CRTs: a low thunk, then a wash of "shhh" static that fades as the picture comes in, a few crackles in
    // it; off, a short burst of static collapsing down. pitch: each set's static a little different
    crtOn: function (pitch) {
      var p = (pitch || 7800) / 7800;
      tone(70, 0.18, "sine", 0.09, 45);
      whoosh(1.1, 0.07, 5200 * p, 2600 * p); // the shhh
      whoosh(0.9, 0.035, 1400 * p, 900 * p, 0.05); // its body
      for (var i = 0; i < 5; i++) noise(0.012, 0.05, 0.08 + Math.random() * 0.7); // crackles
    },
    crtOff: function (pitch) {
      var p = (pitch || 7800) / 7800;
      whoosh(0.3, 0.06, 4000 * p, 600 * p);
      tone(70, 0.08, "sine", 0.06, null, 0.04);
    },
    // the big flat TV: its little start-up chime; off, a soft blip down
    flatOn: function () { tone(523, 0.18, "sine", 0.045); tone(784, 0.35, "sine", 0.045, null, 0.12); },
    flatOff: function () { tone(660, 0.15, "sine", 0.04, 330); },
    // the second monitor: a quick electronic chirp on; a tick off
    lcdOn: function () { tone(1800, 0.05, "square", 0.02); tone(2400, 0.06, "square", 0.02, null, 0.06); },
    lcdOff: function () { tone(1200, 0.04, "square", 0.02, 600); },
    // the chair: a creak, then the casters rolling round as it spins
    chair: function () {
      tone(240, 0.12, "sawtooth", 0.02, 320); tone(300, 0.1, "sawtooth", 0.015, 220, 0.1);
      whoosh(1.1, 0.035, 300, 160, 0.08);
    },
    // the fan: its motor winding up to full blast, then easing off
    fan: function () {
      tone(90, 2.6, "sawtooth", 0.012, 140);
      whoosh(2.8, 0.05, 500, 1400);
    },
    // the plant: a rustle of leaves, a few quick dry bursts
    rustle: function () { for (var i = 0; i < 4; i++) whoosh(0.09, 0.05, 3500 + i * 600, 5500, i * 0.07); },
    // the treadmill: the belt motor whirring up, and footsteps
    treadmill: function () {
      tone(60, 1.6, "sawtooth", 0.015, 110);
      for (var i = 0; i < 4; i++) tone(95, 0.06, "sine", 0.07, 50, 0.35 + i * 0.32);
    },
    // the boom mic: two taps on the grille, a low thump each, and a faint ring of feedback
    micTap: function () {
      for (var i = 0; i < 2; i++) { tone(110, 0.09, "sine", 0.12, 60, i * 0.22); noise(0.03, 0.035, i * 0.22); }
      tone(1800, 0.5, "sine", 0.008, 2100, 0.5);
    },
    // the Olipop: the tab's click and pop, then the fizz hissing out
    canOpen: function () {
      tone(2600, 0.02, "square", 0.04); tone(900, 0.04, "triangle", 0.06, 300, 0.03); // click, pop
      whoosh(0.9, 0.05, 6000, 3500, 0.05); // the fizz
      for (var i = 0; i < 6; i++) tone(3000 + Math.random() * 2500, 0.015, "sine", 0.015, null, 0.15 + Math.random() * 0.6); // bubbles
    },
    // the coffee: drips falling into the mug, each a little plink that drops in pitch, slowing, a soft pour under them
    drip: function () {
      whoosh(0.5, 0.012, 900, 500);
      for (var i = 0; i < 6; i++) {
        var f = 1500 + Math.random() * 500, d = 0.1 + i * 0.16 + i * i * 0.02;
        tone(f, 0.08, "sine", 0.05, f * 0.55, d);
      }
    },
    // the Wolf of Wall Street: money. A cash register's drawer and its "cha-ching" bell, then a stack of bills riffled
    cash: function () {
      tone(180, 0.05, "square", 0.04); tone(120, 0.12, "triangle", 0.05, 70, 0.04); // the drawer clunking open
      tone(2093, 0.5, "sine", 0.05, null, 0.12); tone(2637, 0.6, "sine", 0.045, null, 0.2); tone(4186, 0.3, "sine", 0.015, null, 0.2); // cha-CHING
      for (var i = 0; i < 9; i++) whoosh(0.035, 0.05, 2500, 4500, 0.55 + i * 0.045); // bills flicking past a thumb
    },
    twist: function () { for (var i = 0; i < 8; i++) tone(1400 + (i % 3) * 300, 0.025, "square", 0.03, null, i * 0.15 + (i % 2) * 0.03); }, // the cube, turning
  };

  // the speaker plays the latest song (from Spotify's recently played): Apple Music's 30-second preview of it, found by
  // title and artist (Apple's terms: streamed, never hosted, credited in the card). Click again to stop.
  var music = { audio: null, on: false, at: 0, failed: false };
  function previewFor(song) {
    var plain = function (x) { return String(x || "").toLowerCase().replace(/\s*[([].*?[)\]]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); };
    return fetch("https://itunes.apple.com/search?entity=song&limit=10&country=US&term=" + encodeURIComponent(song.title + " " + (song.artist || "")))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var rs = (d.results || []).filter(function (r) { return r.previewUrl; });
        var byArtist = rs.filter(function (r) { return !song.artist || plain(r.artistName).indexOf(plain(song.artist).split(" ")[0]) >= 0; });
        var exact = byArtist.filter(function (r) { return plain(r.trackName) === plain(song.title); });
        var hit = exact[0] || byArtist[0];
        if (!hit) throw new Error("no preview");
        return hit.previewUrl;
      });
  }
  function stopMusic() {
    music.on = false;
    if (music.audio) music.audio.pause();
  }
  function toggleMusic() {
    if (music.on) { stopMusic(); SFX.off(); return; }
    var song = state.live.song;
    if (!song || !soundOn) { SFX.notes(); return; }
    music.on = true; music.at = now; music.failed = false;
    (music.url ? Promise.resolve(music.url) : previewFor(song)).then(function (url) {
      music.url = url;
      if (!music.on) return;
      if (!music.audio) {
        music.audio = new Audio(); music.audio.volume = 0.6;
        music.audio.addEventListener("ended", function () { music.on = false; });
      }
      if (music.audio.src !== url) music.audio.src = url;
      music.audio.currentTime = 0;
      return music.audio.play();
    }).catch(function () { music.on = false; music.failed = true; SFX.notes(); });
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) stopMusic(); });

  var LAMP = [ // the floor lamp's colours: its LED, the wash on the wall, the light it gives at night
    { rainbow: true }, // first, so it starts on it (Nick): the colours below flowing up the pole in a loop, the wall's glow shifting through them
    { led: "#7aa0ff", wash: "#4a6ad8", light: [0.45, 0.6, 1] },
    { led: "#c890ff", wash: "#8a5ad8", light: [0.75, 0.5, 1] },
    { led: "#ff7a8a", wash: "#d8506a", light: [1, 0.5, 0.6] },
    { led: "#7affb0", wash: "#4ab88a", light: [0.5, 1, 0.7] },
    { off: true, led: "#2e2e34" }, // off: a dark strip, no colour on the walls, no light at night
  ];

  // ---------- the room, as boxes ----------
  var boxes = [];
  function box(x0, x1, y0, y1, z0, z1, c, o) {
    var b = { x0: x0, x1: x1, y0: y0, y1: y1, z0: z0, z1: z1, c: c };
    for (var key in o) b[key] = o[key];
    b.n = boxes.length;
    boxes.push(b);
    return b;
  }

  // walls: each is drawn only while it's one of the two at the back
  var WALLC = "#a3b29f";
  function wallBox(name, x0, x1, y0, y1, paint) {
    return box(x0, x1, y0, y1, 0, WALL, WALLC, { wall: name, structural: true, topc: "#e4e6df", k: [0.97, 0.86], paint: paint });
  }
  function skirting(pen) { // baseboard and a little texture
    for (var u = 0; u < pen.w; u++) {
      pen.set(u, 0, "#c9c9c0"); pen.set(u, 1, "#dededa"); pen.set(u, 2, "#dededa"); pen.set(u, 3, "#d4d4cd"); pen.set(u, 4, "#b8bfb4");
      for (var v = 5; v < pen.h; v++) if (hash(u, v) < 0.035) pen.set(u, v, "#97a693");
      pen.set(u, pen.h - 1, "#8d9c8a");
    }
  }
  // the floor lamp's colour on the wall near it: every pixel (the wall's speckles too, so there are no gaps), strongest
  // by the lamp and fading smoothly to the plain wall toward the edges (the pen shades it like the rest of the wall)
  // the colours the rainbow setting flows through (the four plain settings)
  function lampColours() { return LAMP.filter(function (l) { return !l.rainbow && !l.off; }); }
  function blendHex(a, b, f) { return "#" + [0, 2, 4].map(function (i) { var x = parseInt(a.substr(1 + i, 2), 16), y = parseInt(b.substr(1 + i, 2), 16); return ("0" + Math.round(x + (y - x) * f).toString(16)).slice(-2); }).join(""); }
  // where the loop is (0 to the number of colours), for a spot up the pole (v) at this moment
  function rainbowAt(v) { var n = lampColours().length; return (((now / 1400 - v / 30) % n) + n) % n; }
  function rainbowPick(p, key) { // the colour at loop position p, blended between its two neighbours
    var cs = lampColours(), i = Math.floor(p), f = p - i, a = cs[i % cs.length][key], b = cs[(i + 1) % cs.length][key];
    return key === "light" ? a.map(function (x, k) { return x + (b[k] - x) * f; }) : blendHex(a, b, f);
  }
  function lampNow() { // the lamp's colours right now (the rainbow's are the ones at the middle of the pole)
    var L = LAMP[state.lampHue];
    if (!L.rainbow) return L;
    var p = rainbowAt(48);
    return { wash: rainbowPick(p, "wash"), light: rainbowPick(p, "light") };
  }
  function lampWash(pen, a0, a1, ca) {
    if (LAMP[state.lampHue].off) return;
    var lc = H(lampNow().wash), wc = H(WALLC);
    pen.eachW(a0, a1, 5, WALL - 1, function (a, z) {
      var d = Math.hypot(a - ca, (z - 60) * 0.6), s = Math.max(0, 1 - d / 60);
      return s > 0.02 ? mix(wc, lc, 0.75 * s * s * (3 - 2 * s)) : null; // smoothstep: no hard rim
    });
  }
  var windowWall = wallBox("window", -WT, 0, -WT, Y + WT, { px: function (pen) {
    skirting(pen);
    lampWash(pen, -WT, 64, 5); // from inside the corner, so no pale seam shows up it
    pen.eachW(WIN_C - 25, WIN_C + 25, 26, 112, windowPixel);
  } });
  wallBox("desk", 0, X, -WT, 0, { py: function (pen) { skirting(pen); lampWash(pen, -WT, 64, 5); } });
  wallBox("rm", X, X + WT, -WT, Y + WT, { nx: function (pen) { skirting(pen); } });
  // TV wall: the doorway into the hall at the Rick and Morty end, the schedule taped up between it and the dresser
  wallBox("tv", 0, X, Y, Y + WT, { ny: function (pen) {
    skirting(pen);
    pen.rectW(176, 185, 58, 80, "#f4f4f0");
    for (var l = 0; l < 6; l++) pen.rectW(177, 181 + l % 3, 76 - l * 3, 77 - l * 3, "#9a9a9a");
    // the doorway: a way through into the dim hall, not a picture on the wall. The frame's inner edges (the wall's
    // thickness) in shadow, the hall darker the further in, its carpet running back.
    pen.rectW(186, 209, 0, 98, "#eaeae4"); // trim
    pen.eachW(189, 206, 0, 95, function (a, z) {
      var edge = Math.min(a - 189, 205 - a, 94 - z); // distance from the frame
      if (a < 192) return a < 190 ? "#2f342e" : "#3d433c"; // the jamb on the hinge side, in shadow
      if (z > 91) return z > 93 ? "#2a2e29" : "#373c36"; // the head of the frame
      if (z < 8) return (a + z) % 3 ? "#5a5348" : "#524b41"; // the hall's carpet
      if (z < 9) return "#3f3a33"; // where the carpet meets the far wall
      var far = Math.min(1, edge / 9);
      return far > 0.6 ? "#4f574d" : far > 0.3 ? "#454c43" : "#3c423a"; // the hall's far wall, darker toward the frame
    });
    pen.rectW(189, 206, 95, 98, "#d8d8d0"); // the trim's underside catching the light
  } });
  // the floor: carpet on a slab, the chair's mat
  box(0, X, 0, Y, -SLAB, 0, "#3d3a40", { structural: true, k: [0.75, 0.6], topc: "#b3a58b", paint: { top: function (pen) {
    pen.each(function (x, y) {
      if (x >= 64 && x < 120 && y >= 30 && y < 68) return x === 64 || y === 67 || x === 119 ? "#d6cdb9" : "#c6bca6";
      var h = hash(x, y);
      return h < 0.09 ? "#a6987e" : h > 0.95 ? "#c0b399" : null;
    });
  } } });

  // ---- the corner: the floor lamp ----
  box(1, 11, 1, 11, 0, 2, "#1c1c1e", { thing: "floor-lamp", topc: "#2a2a2e" });
  box(4, 8, 4, 8, 2, 100, "#1c1c1e", { thing: "floor-lamp", topc: "#2a2a2e", paint: { side: function (pen) {
    var L = LAMP[state.lampHue];
    if (L.rainbow) { for (var v = 4; v < pen.h - 2; v++) pen.rect(1, v, 2, 1, rainbowPick(rainbowAt(v), "led"), true); } // flowing up
    else pen.rect(1, 4, 2, pen.h - 6, L.led, !L.off);
  } } });

  // ---- desk wall: the black L desk, from just past the lamp ----
  box(42, 134, 0, 32, 38, 41, "#232228", { topc: "#34323a", paint: { top: function (pen) { // desk mat, keyboard, mouse
    pen.each(function (x, y) { return x >= 68 && x < 120 && y >= 14 && y < 30 ? (x < 84 ? "#5a3a8a" : x < 102 ? "#a24a86" : "#d0705a") : null; });
    pen.rect(75, 19, 28, 6, "#2b2b30");
    pen.each(function (x, y) { return x >= 76 && x < 102 && y >= 20 && y < 24 && (x + y) % 2 ? (x === 76 && y === 21 ? "#e8823a" : "#6a6a72") : null; });
    pen.rect(107, 21, 3, 4, "#1d1d22");
  } } });
  box(42, 44, 30, 32, 0, 38, "#1a191e"); box(132, 134, 30, 32, 0, 38, "#1a191e");
  // the drawer unit: its drawers and their handles on the front only
  box(112, 132, 2, 30, 0, 38, "#1d1c21", { paint: { py: function (pen) { for (var d = 0; d < 3; d++) { pen.rect(0, 12 * d, pen.w, 1, "#2e2d33"); pen.rect(Math.floor(pen.w / 2) - 4, 12 * d + 6, 8, 1, "#c9c9c9"); } } } });
  // the dots poster, and the second monitor (orange mountains) under it at the desk's end; jug and tissues
  box(26, 50, 0, 1, 70, 104, "#0e0e10", { wallItem: "desk", paint: { py: dotsPoster } }); // just art (Nick: nothing on click)
  box(45, 67, 4, 7, 46, 64, "#0b0b0d", { thing: "side-monitor", paint: { py: screenSide } });
  box(54, 58, 7, 10, 41, 46, "#2a2a2e");
  // a mug of coffee on its warmer (its little light glows), steam rising
  box(43, 52, 16, 25, 41, 42, "#1e1e22", { thing: "coffee", topc: "#2c2c31", paint: { side: function (pen) { pen.set(pen.w - 2, 0, "#ff6a2a", true); } } });
  box(45, 50, 18, 23, 42, 49, "#efe9df", { thing: "coffee", topc: "#efe9df", paint: {
    top: function (pen) { pen.rect(46, 19, 3, 3, "#4a2c1a"); pen.set(46, 19, "#6a4028"); },
    side: function (pen) { pen.rect(0, 5, pen.w, 1, "#c9c2b6"); },
  } });
  box(50, 51, 19, 22, 43, 47, "#efe9df", { thing: "coffee" }); // handle
  box(45, 50, 18, 23, 49, 60, null, { thing: "coffee", paint: { side: steam } });
  // the boom mic on its elbow arm, clamped to the desk's left end at the back: a post up, the upper arm rising forward
  // to the elbow, the forearm reaching down and forward, the mic hanging in its shock mount at the front of the desk
  box(42, 45, 0, 3, 36, 43, "#1c1c20", { thing: "mic" }); // the clamp, over the desk's edge
  box(43, 44, 1, 2, 43, 62, "#26262b", { thing: "mic" }); // the post
  for (var bk = 0; bk < 6; bk++) box(43, 44, 1 + 2 * bk, 3 + 2 * bk, 62 + 2 * bk, 64 + 2 * bk, "#26262b", { thing: "mic" }); // upper arm
  box(42, 45, 12, 15, 73, 76, "#1c1c20", { thing: "mic" }); // the elbow
  for (bk = 0; bk < 6; bk++) box(43, 44, 15 + 2 * bk, 17 + 2 * bk, 73 - bk, 75 - bk, "#26262b", { thing: "mic" }); // forearm
  box(43, 44, 27, 28, 66, 70, "#26262b", { thing: "mic" }); // its drop to the mount
  box(41, 46, 26, 29, 64, 66, "#3a3a40", { thing: "mic", topc: "#4a4a50" }); // the shock mount's ring
  box(42, 45, 26, 29, 52, 64, "#18181b", { thing: "mic", topc: "#2a2a2e", paint: { side: function (pen) { // the mic: a grille at the top
    for (var gv = 6; gv < pen.h - 1; gv++) for (var gu = 0; gu < pen.w; gu++) if ((gu + gv) % 2) pen.set(gu, gv, "#3c3c42");
    pen.rect(0, 4, pen.w, 1, "#55555c");
  } } });
  // main monitor (screen live) and stand
  box(70, 112, 6, 9, 46, 74, "#0b0b0d", { thing: "monitor", paint: { py: screenMain } });
  box(89, 93, 9, 12, 41, 46, "#2a2a2e"); box(83, 99, 6, 15, 41, 42, "#2a2a2e");
  // the shelf of VHS tapes and what stands on it
  box(66, 120, 0, 9, 84, 86, "#1a1a1d", { wallItem: "desk", topc: "#2c2c31" });
  box(67, 119, 1, 8, 86, 97, "#222222", { wallItem: "desk", thing: "vhs-shelf", topc: "#151515", paint: { py: function (pen) {
    var cols = ["#e8e2d0", "#c8322b", "#2f5fb3", "#f2c230", "#1d1d1f", "#6a2a8a", "#e86a2a", "#3a8a4a", "#dcdcdc", "#8a1a1a"];
    for (var u = 0; u < pen.w; u++) {
      var tape = Math.floor(u / 2.6), c = cols[Math.floor(hash(tape, 7) * cols.length)];
      pen.rect(u, 0, 1, pen.h, u % 3 === 2 ? shade(H(c), 0.75) : c);
      pen.rect(u, 6, 1, 2, hash(tape, 3) < 0.5 ? "#f4f0e0" : "#222222");
    }
    var t = since("vhs-shelf");
    if (t < 1600) { var out = t < 400 ? t / 400 : t < 1200 ? 1 : 1 - (t - 1200) / 400; pen.rect(this.pick || 20, Math.round(out * 6), 3, pen.h, "#c8322b"); }
  } } });
  box(68, 75, 1, 8, 97, 107, "#121214", { wallItem: "desk", paint: { py: function (pen) { for (var i = 0; i < 9; i++) pen.set(1 + i % 3 * 2, 2 + Math.floor(i / 3) * 3, "#2e2e33"); } } });
  box(77, 89, 1, 3, 97, 110, "#e8c33a", { wallItem: "desk", paint: { py: function (pen) { pen.rect(1, 6, 5, 6, "#d9452b"); pen.rect(1, 1, 5, 4, "#3a7bd5"); pen.rect(6, 0, 6, 13, "#f2f2f0"); pen.rect(7, 6, 4, 5, "#3ab0e0"); pen.rect(7, 1, 4, 4, "#e84a3a"); } } });
  box(92, 98, 2, 6, 97, 110, null, { wallItem: "desk", thing: "dude", paint: { side: dude, top: function (pen) { pen.rect(92, 2, 6, 4, "#6a4a2a"); } } });
  box(99, 103, 2, 6, 97, 101, "#0d0d0d", { wallItem: "desk", paint: { py: function (pen) { pen.set(0, 2, "#ffffff"); pen.set(2, 2, "#ffffff"); } } });
  box(105, 111, 1, 2, 97, 113, "#f4f4f2", { wallItem: "desk", paint: { py: function (pen) { pen.rect(1, 1, 4, 14, "#0c0f12"); pen.disc(3, 6, 1, "#4a5a52"); } } });
  box(111, 119, 1, 6, 97, 105, "#f06aa0", { wallItem: "desk", paint: { py: function (pen) { pen.rect(1, 4, 6, 3, "#f5d23a"); pen.rect(1, 1, 2, 2, "#5ac83a"); pen.rect(5, 1, 2, 2, "#e84a3a"); } } });
  // desk lamp: base, brass pole and arm, black head
  // (just right of the main monitor: the base by the wall, the pole up, the arm reaching forward below the shelf, and
  // the head hanging over the desk, pointing down)
  box(114, 120, 0, 6, 41, 43, "#1a1a1a", { thing: "desk-lamp" });
  box(116, 117, 2, 3, 43, 80, "#b08d4a", { thing: "desk-lamp" });
  box(116, 117, 3, 14, 80, 81, "#b08d4a", { thing: "desk-lamp" });
  box(113, 120, 12, 18, 74, 80, "#161616", { thing: "desk-lamp", paint: { side: function (pen) { if (state.lamp) pen.rect(1, 0, pen.w - 2, 1, "#fff2c8", true); } } });
  // pencil cup, gum
  box(122, 126, 6, 10, 41, 49, "#b88a4a", { topc: "#3a2a1a", paint: { top: function (pen) { pen.set(123, 7, "#2a5fd0"); pen.set(124, 8, "#d03a3a"); pen.set(123, 8, "#3ac0e0"); } } });
  box(127, 132, 4, 9, 41, 47, "#7cc4e4", { topc: "#3b8fd9" });
  // the Wolf of Wall Street painting and a sticky note
  box(140, 190, 0, 1, 64, 98, "#101012", { wallItem: "desk", thing: "wolf", paint: { py: wolf } });
  box(180, 186, 0, 1, 56, 62, "#c6f06a", { wallItem: "desk", paint: { py: function (pen) { pen.rect(1, 3, 4, 1, "#8fb840"); pen.rect(1, 1, 3, 1, "#8fb840"); } } });

  // ---- desk wall: the grey desk, what's under it and on it ----
  box(136, 210, 0, 30, 38, 41, "#4b4b50", { topc: "#5c5c61" });
  box(136, 138, 28, 30, 0, 38, "#3e3e42"); box(208, 210, 28, 30, 0, 38, "#3e3e42");
  box(139, 147, 4, 22, 0, 20, "#17171a", { paint: { py: function (pen) { pen.set(4, 17, "#3a8bff", true); pen.rect(1, 13, 6, 1, "#26262a"); } } });
  box(150, 168, 4, 24, 0, 12, "#8f969e", { topc: "#6f757c" });
  box(171, 190, 4, 26, 0, 14, "#a9814f", { topc: "#c49a65", paint: { top: function (pen) { pen.rect(171, 14, 19, 1, "#8a6a3e"); } } });
  box(192, 206, 6, 24, 0, 10, "#a07848", { topc: "#c49a65" });
  box(139, 159, 4, 26, 41, 61, "#19191b", { thing: "samsung", topc: "#2a2a2e", paint: { py: samsung } });
  box(141, 150, 10, 19, 61, 63, "#3e9a3a", { thing: "golf-ball", topc: "#62b84f" });
  // the ball on its tee: a rounded voxel ball (a 3x3 layer, a 5x5 middle, a 3x3 layer); it hops when clicked (propsStep)
  box(145, 146, 14, 15, 63, 64, "#c8322b", { thing: "golf-ball" });
  var ball = [
    box(144, 147, 13, 16, 64, 65, "#e8e8e2", { thing: "golf-ball", topc: "#f4f4f0" }),
    box(143, 148, 12, 17, 65, 68, "#f4f4f0", { thing: "golf-ball", topc: "#ffffff", paint: { side: function (pen) {
      pen.set(1, 1, "#d8d8d2"); pen.set(3, 2, "#d8d8d2"); pen.set(2, 0, "#d8d8d2"); pen.set(2, 1, "#c8322b"); // dimples, the red "1"
    } } }),
    box(144, 147, 13, 16, 68, 69, "#f4f4f0", { thing: "golf-ball", topc: "#ffffff" }),
  ];
  ball.forEach(function (b) { b.bz0 = b.z0; b.bz1 = b.z1; });
  // the mushroom: a domed red cap with white spots on a cream stem with a little door (its top squashes when clicked)
  var mushTop = box(152, 157, 13, 18, 68, 69, "#d8322b", { thing: "mushroom", topc: "#e04030", paint: { top: function (pen) { pen.set(154, 15, "#ffffff"); } } });
  box(151, 158, 12, 19, 65, 68, "#d8322b", { thing: "mushroom", topc: "#e04030", paint: {
    side: function (pen) { pen.set(1, 1, "#ffffff"); pen.set(4, 2, "#ffffff"); pen.set(6, 0, "#ffffff"); },
    top: function (pen) { pen.set(152, 13, "#ffffff"); pen.set(157, 17, "#ffffff"); pen.set(151, 17, "#ffffff"); },
  } });
  box(153, 156, 14, 17, 61, 65, "#e8c9a0", { thing: "mushroom", paint: { side: function (pen) { pen.rect(1, 0, 1, 2, "#5a3a2a"); } } });
  // the lava lamp: a wide purple base with its palm-tree bands, the glass (glowing, orange blobs rising and falling), a cap
  box(160, 167, 21, 28, 41, 46, "#8a3ab9", { thing: "lava", topc: "#9a4ac9", paint: { side: function (pen) {
    pen.rect(0, 0, pen.w, 1, "#6a2a90"); pen.rect(0, 2, pen.w, 1, "#f2c230"); pen.rect(0, 3, pen.w, 1, "#f08a3a");
  } } });
  box(161, 166, 22, 27, 46, 58, "#7b3aa0", { thing: "lava", paint: { side: lavaGlass } });
  box(162, 165, 23, 26, 58, 62, "#8a3ab9", { thing: "lava", topc: "#6a2a90" });
  box(168, 182, 8, 22, 41, 45, "#b9b9be", { thing: "snes", topc: "#cfcfd3", paint: { top: function (pen) { pen.rect(171, 12, 4, 2, "#7b6aa8"); pen.rect(176, 13, 5, 2, "#8e8e93"); var t = since("snes"); if (t < 1300 && t > 150) pen.rect(176, 12, 5, 3, "#59c13a"); } } });
  box(169, 181, 25, 29, 41, 42, "#b9b9be", { thing: "snes", topc: "#c9c9ce", paint: { top: function (pen) { // its controller
    pen.rect(170, 26, 3, 1, "#3a3a40"); pen.rect(171, 25, 1, 3, "#3a3a40"); // d-pad
    pen.rect(174, 27, 2, 1, "#7b6aa8"); // select, start
    pen.set(178, 25, "#3a8ad8"); pen.set(177, 26, "#5ac83a"); pen.set(179, 26, "#e8323a"); pen.set(178, 27, "#f2c230"); // X Y A B
  } } });
  box(183, 186, 18, 21, 41, 46, "#151515", { thing: "film", topc: "#7a7a7a", paint: { top: function (pen) { if (since("film") < 2200) pen.rect(183, 18, 3, 3, "#e8c080"); } } });
  var magBox = box(186, 208, 4, 28, 41, 66, "#b4b6b9", { thing: "magnavox", topc: "#cfd1d3", paint: { py: magnavox } });
  // the VW Samba bus model, out of its box (Nick, 1.4), its nose toward the room (+y): red below, cream above with
  // its row of windows down each side, the split windshield and the red V and headlights on the nose, a cream roof,
  // four wheels; it rolls forward and back a little when clicked (propsStep)
  var vwParts = [
    box(190, 196, 9, 21, 75, 76, "#ece6d6", { thing: "vw", topc: "#f4efe2" }), // roof (first, for its speech bubble)
    box(189, 197, 8, 22, 71, 75, "#f4efe2", { thing: "vw", topc: "#f4efe2", paint: {
      side: function (pen) { for (var u = 2; u < pen.w - 2; u += 3) pen.rect(u, 1, 2, 2, "#3e5266"); }, // windows down the side
      py: function (pen) { pen.rect(1, 1, 2, 2, "#3e5266"); pen.rect(5, 1, 2, 2, "#3e5266"); }, // the split windshield
      ny: function (pen) { pen.rect(2, 1, pen.w - 4, 2, "#3e5266"); }, // the back window
    } }),
    box(189, 197, 8, 22, 67, 71, "#c8322b", { thing: "vw", topc: "#c8322b", paint: {
      py: function (pen) { // the V and the headlights
        pen.set(1, 3, "#f4efe2"); pen.set(2, 2, "#f4efe2"); pen.set(3, 1, "#f4efe2"); pen.set(4, 1, "#f4efe2"); pen.set(5, 2, "#f4efe2"); pen.set(6, 3, "#f4efe2");
        pen.set(0, 1, "#fff6c8"); pen.set(pen.w - 1, 1, "#fff6c8");
      },
      side: function (pen) { pen.rect(0, 0, pen.w, 1, "#9a2420"); }, // the bumper line
    } }),
    box(189, 190, 9, 12, 66, 67, "#111111", { thing: "vw" }), box(196, 197, 9, 12, 66, 67, "#111111", { thing: "vw" }),
    box(189, 190, 18, 21, 66, 67, "#111111", { thing: "vw" }), box(196, 197, 18, 21, 66, 67, "#111111", { thing: "vw" }),
  ];
  vwParts.forEach(function (b) { b.by0 = b.y0; b.by1 = b.y1; });
  box(199, 207, 16, 23, 66, 79, "#1f6fd6", { thing: "funko", topc: "#f5c31b", paint: { py: funko } });
  box(201, 205, 18, 22, 79, 83, "#e8323a", { thing: "rubik", paint: { side: rubik, top: rubikTop } });
  // the office chair, its back to you, at the main monitor. Clicked, it spins round twice: the back and the armrests
  // swing to each side of the seat in turn (chairStep)
  box(79, 103, 37, 61, 2, 4, null, { thing: "chair", paint: { top: function (pen) {
    pen.each(function (x, y) { var dx = x - 91, dy = y - 49; return (Math.abs(dx) < 2 || Math.abs(dy) < 2 || Math.abs(dx - dy) < 2) && dx * dx + dy * dy < 140 ? "#2a2a2e" : null; });
    [[80, 49], [102, 49], [91, 38], [91, 60], [83, 41], [99, 57]].forEach(function (w) { pen.set(w[0], w[1], "#111111"); });
  } } });
  box(90, 92, 48, 50, 4, 20, "#3a3a3e", { thing: "chair" });
  box(79, 103, 37, 61, 20, 25, "#1b1b1e", { thing: "chair", topc: "#26262b" });
  var chairBack = box(79, 103, 61, 65, 25, 54, "#1b1b1e", { thing: "chair", topc: "#2c2c31", paint: { side: function (pen) {
    for (var l = 0; l < 4; l++) pen.rect(2, 6 + l * 6, pen.w - 4, 1, "#27272c");
  } } });
  var chairArms = [box(77, 79, 41, 57, 28, 30, "#222226", { thing: "chair" }), box(103, 105, 41, 57, 28, 30, "#222226", { thing: "chair" })];

  // ---- window wall ----
  // the window near the middle of the wall (WIN_C) between its curtains, a poster either side of it: the sunset one
  // centred between the floor lamp and the curtain, the pink figure one between the other curtain and the corner
  box(0, 1, 17, 39, 62, 96, "#0f0f12", { wallItem: "window", paint: { px: sunsetPoster } }); // just art
  box(1, 2, WIN_C - 33, WIN_C + 33, 112, 113, "#1a1a1a", { wallItem: "window" }); // curtain rod
  // the curtains: click either to draw them closed across the window (they slide in to meet in the middle), again to
  // open them (curtainStep)
  var curtains = [
    box(0, 4, WIN_C - 31, WIN_C - 24, 6, 112, "#22252b", { wallItem: "window", thing: "curtains", paint: { side: curtain } }),
    box(0, 4, WIN_C + 24, WIN_C + 31, 6, 112, "#22252b", { wallItem: "window", thing: "curtains", paint: { side: curtain } }),
  ];
  box(0, 1, 118, 140, 62, 96, "#0e0e10", { wallItem: "window", paint: { px: pinkPoster } }); // just art; the sunset poster's size
  // the treadmill desk, running along the window wall between it and the monitor desk: the belt reaching toward the
  // desk corner (by the floor lamp), the console and the desk board at the other end in front of the window, headphones
  // hanging off the board
  box(4, 34, 22, 100, 0, 6, "#18191d", { thing: "treadmill", topc: "#26272c", paint: { top: treadBelt, side: function (pen) { pen.rect(0, 0, pen.w, 1, "#3a5bff", true); } } });
  box(6, 9, 92, 96, 6, 46, "#1c1d22", { thing: "treadmill" }); box(29, 32, 92, 96, 6, 46, "#1c1d22", { thing: "treadmill" });
  box(4, 34, 94, 101, 46, 56, "#1c1d22", { thing: "treadmill", topc: "#2a2b31", paint: { top: function (pen) { pen.rect(12, 95, 10, 5, "#8ab4e8", true); pen.rect(13, 96, 4, 2, "#c9dcf2", true); } } });
  box(6, 8, 78, 92, 44, 46, "#2a2b31", { thing: "treadmill" }); box(30, 32, 78, 92, 44, 46, "#2a2b31", { thing: "treadmill" });
  box(4, 36, 78, 91, 46, 48, "#4d372c", { thing: "treadmill", topc: "#5c4334" });
  // a laptop, open, its screen toward whoever's walking
  box(8, 22, 79, 88, 48, 49, "#b8bcc2", { thing: "laptop", topc: "#c4c8ce", paint: { top: function (pen) {
    pen.rect(9, 80, 12, 5, "#2b2d33");
    pen.each(function (x, y) { return x > 9 && x < 20 && y > 80 && y < 84 && (x + y) % 2 ? "#4a4d55" : null; });
    pen.rect(13, 86, 4, 1, "#a8acb2");
  } } });
  box(8, 22, 88, 89, 48, 58, "#9ea2a8", { thing: "laptop", paint: { ny: function (pen) {
    pen.rect(1, 1, pen.w - 2, pen.h - 2, "#1d2a44", true);
    pen.rect(2, pen.h - 3, pen.w - 4, 1, "#3a4a6a", true);
    var t = since("laptop");
    pen.rect(2, 2, 5, 5, "#5ab0f0", true); pen.rect(8, 4, 4, 3, t < 3000 ? "#5ad8a8" : "#f2a43a", true); // windows open
    pen.rect(2, 7, Math.min(pen.w - 4, 2 + Math.floor(now / 400) % 9), 1, "#c8c8d0", true);
  } } });
  box(26, 30, 82, 86, 48, 55, "#f2c531", { thing: "can", topc: "#c8c8c8", paint: { side: function (pen) { pen.rect(0, 2, pen.w, 2, "#f08a3a"); if (since("can") < 1500) for (var i = 0; i < 3; i++) pen.set(i, pen.h - 1, "#fff4c0", true); } } });
  box(36, 38, 82, 90, 28, 46, null, { thing: "headphones", paint: { side: function (pen) {
    // hung on the board's end: the cup below, the band looping up over the board, outlined in grey so they show against
    // the black desk (v counts up from the bottom)
    var w = pen.w, h = pen.h, G = "#8a8e96", L = "#b8bcc4";
    pen.rect(0, 0, w, 8, "#141414"); pen.rect(1, 2, w - 2, 4, "#2a2a2e"); // the cup and its cushion
    pen.rect(0, 0, w, 1, G); pen.rect(0, 7, w, 1, L); pen.rect(0, 0, 1, 8, G); pen.rect(w - 1, 0, 1, 8, G);
    pen.rect(1, 8, 2, h - 9, "#141414"); pen.rect(w - 3, 8, 2, h - 9, "#141414"); pen.rect(1, h - 2, w - 2, 1, "#141414"); // the band
    pen.rect(0, 8, 1, h - 9, G); pen.rect(w - 1, 8, 1, h - 9, G);
    pen.rect(1, h - 1, w - 2, 1, L); // its top, catching the light
    notes(pen, since("headphones"), 1);
  } } });

  // ---- Rick and Morty wall ----
  box(198, 210, 32, 44, 0, 40, "#151517", { topc: "#2a2a2e", paint: { nx: function (pen) { pen.rect(Math.floor(pen.w / 2), 2, 1, pen.h - 4, "#2a2a2e"); } } });
  [[36, 50, 60, 96], [51, 67, 56, 100], [68, 84, 58, 98], [85, 99, 62, 94]].forEach(function (p) {
    box(209, 210, p[0], p[1], p[2], p[3], "#120c14", { wallItem: "rm", thing: "canvas", paint: { nx: function (pen) { pen.eachW(p[0], p[1], p[2], p[3], rickPixel); portal(pen, p); } } });
  });
  box(190, 210, 46, 86, 0, 34, "#ecece6", { thing: "bookcase", topc: "#c8202a", paint: { nx: bookcase, top: function (pen) { for (var y = 48; y < 86; y += 8) pen.rect(190, y, 20, 1, "#a81a24"); } } });
  box(199, 205, 50, 56, 34, 36, "#1a1a1c", { thing: "fan", topc: "#26262a" }); // its stand
  box(201, 203, 52, 54, 36, 38, "#1a1a1c", { thing: "fan" });
  // the fan's body, solid: a round disc built from slices (like the mushroom), so it's round from every side; the
  // grill and its spinning blades painted on a thin face in front
  for (var fz = 38; fz < 50; fz++) {
    var fh = Math.round(Math.sqrt(Math.max(0, 36 - Math.pow(fz + 0.5 - 44, 2))));
    if (fh > 0) box(198, 201, 53 - fh, 53 + fh, fz, fz + 1, "#151517", { thing: "fan", topc: "#1c1c1f" });
  }
  box(197, 198, 47, 59, 38, 50, null, { thing: "fan", paint: { nx: fan } });
  box(198, 206, 60, 66, 34, 44, "#1a1a1c", { thing: "speaker", topc: "#2c2c30", paint: { side: function (pen) { notes(pen, music.on ? (now - music.at) % 1800 : since("speaker"), 3); } } }); // notes rise while it plays
  box(198, 204, 68, 74, 34, 37, "#2a2a2a", { paint: { top: function (pen) { pen.set(200, 70, "#5d9a52"); pen.set(202, 71, "#4f8a4a"); pen.set(201, 72, "#5d9a52"); } } });
  box(200, 205, 77, 82, 34, 40, "#111111");
  [0, 14, 28].forEach(function (z, i) {
    box(192, 210, 86, 100, z, z + 14, "#1a1a1c", { topc: "#2c2c30", paint: { nx: function (pen) { pen.rect(3, 3, pen.w - 6, 8, "#f2f2f0"); pen.rect(4, 4, pen.w - 8, 4, ["#e8823a", "#c8442e", "#d89a3a"][i]); } } });
  });


  // ---- TV wall ----
  // the dresser; the TV a little in from the wall, its soundbar in front; the plant behind the TV at the door end,
  // against the wall, its leaves fanning out above and beside the TV
  box(96, 184, 128, 150, 0, 34, "#19181c", { topc: "#2b2a2f", paint: { ny: dresser } });
  box(128, 138, 133, 140, 34, 37, "#222222");
  box(104, 162, 136, 139, 37, 72, "#08080a", { thing: "tv", paint: { ny: bigTv } });
  box(110, 152, 129, 134, 34, 37, "#2a2a2e", { topc: "#3a3a3f" });
  box(166, 176, 140, 150, 34, 44, "#c9d1cc", { thing: "plant", topc: "#4a3a2a" });
  box(158, 184, 140, 150, 44, 76, null, { thing: "plant", sprite: plantSprite });
  // the door, open into the room, hinged on the doorway's corner side (it goes with its wall)
  box(206, 208, 132, 150, 0, 95, "#ecece6", { wallItem: "tv", thing: "door", paint: { side: doorPanels } });
  var mirrorBox = box(14, 86, 148, 150, 0, 114, "#c9a24a", { wallItem: "tv", thing: "mirror", topc: "#e5c574", paint: { ny: mirror } });

  // the cat tower: a carpeted base, two sisal posts, two plush beds, and a cat sitting in each (they stay put)
  // (in the window/TV-wall corner, past the treadmill's end, a little out from the mirror, where the first view sees it)
  box(4, 36, 119, 140, 0, 3, "#cbb79a", { thing: "cat-tower", topc: "#d8c6a8" });
  box(12, 16, 127, 131, 3, 22, "#c9a46a", { thing: "cat-tower", paint: { side: sisal } });
  box(26, 30, 129, 133, 3, 46, "#c9a46a", { thing: "cat-tower", paint: { side: sisal } });
  box(6, 22, 121, 137, 22, 28, "#d9cbb6", { thing: "cat-tower", topc: "#e8dccb", paint: { top: bedTop, side: plush } });
  box(20, 36, 123, 139, 46, 52, "#d9cbb6", { thing: "cat-tower", topc: "#e8dccb", paint: { top: bedTop, side: plush } });
  makeCat("cat", { fur: "#808289", top: "#9a9ca3", dark: "#6c6e75", eyes: "#c8e05a", white: "#f2f2ee" }, 14, 129, 28, 3); // Dennis, grey and white, lower bed
  makeCat("cat2", { fur: "#1f1f23", top: "#2e2e34", dark: "#151518", eyes: "#e8d84a", white: "#f2f2ee" }, 28, 131, 52, 1); // Mac, black and white, top bed

  // ---------- the paintings on things ----------
  function screenMain(pen) {
    var t = since("monitor");
    if (t < 4000) { // the site, booting up
      pen.rect(2, 2, pen.w - 4, pen.h - 4, "#0b0b0d", true);
      pen.text(5, pen.h - 5, "NICK", "#f2f1ec", true); pen.text(21, pen.h - 5, "MADE", "#6fb3ff", true);
      ["#8a6ae8", "#f2a43a", "#f05a9a", "#5ab0f0", "#ff7a59", "#5ad8a8"].forEach(function (c, i) { pen.rect(5 + i % 3 * 12, 12 - Math.floor(i / 3) * 6, 10, 4, c, true); });
      return;
    }
    pen.rect(2, 2, pen.w - 4, pen.h - 4, "#161b26", true); // a code editor, scrolling
    pen.rect(2, pen.h - 4, pen.w - 4, 2, "#1f2533", true);
    var scroll = Math.floor(now / 380);
    for (var col = 0; col < 3; col++) for (var l = 0; l < 8; l++) {
      var n = (l + scroll + col * 7) % 23, len = 3 + (n * 7 + col * 3) % 9;
      pen.rect(4 + col * 13, pen.h - 7 - Math.floor(l * 2.5), Math.min(len, 11), 1, ["#5ab0f0", "#c8c8d0", "#e8a85a", "#9ad87a", "#c88ae8"][(n + col) % 5], true);
    }
    pen.rect(1, 1, 5, 5, "#b6e05a"); pen.rect(2, 3, 3, 1, "#8fb840"); // the sticky note
  }
  function screenSide(pen) {
    if (!state.on["side-monitor"]) return; // off: a dark screen (just on and off, no montage)
    for (var v = 2; v < pen.h - 2; v++) for (var u = 1; u < pen.w - 1; u++) {
      var peak = 8 + Math.max(0, 8 - Math.abs(u - 14) * 0.9) + Math.max(0, 5 - Math.abs(u - 22) * 0.8);
      pen.set(u, v, v < peak ? (v < peak - 4 ? "#7a2414" : (u + v) % 3 ? "#d2552a" : "#f08a4a") : v > 15 ? "#2a5a98" : "#6a90c0", true);
    }
  }
  function dude(pen) {
    var t = since("dude"), tilt = t < 1200 ? Math.round(Math.sin(t / 60) * (1 - t / 1200)) : 0;
    pen.rect(0, 0, pen.w, 3, "#3a4a6a"); pen.rect(0, 3, pen.w, 5, "#c8b48a"); pen.rect(0, 5, pen.w, 1, "#8a3a3a");
    pen.rect(tilt, 8, pen.w, 5, "#d8a880"); pen.rect(tilt, 8, pen.w, 2, "#6a4a2a"); pen.rect(tilt, 12, pen.w, 1, "#6a4a2a");
    pen.set(1 + tilt, 11, "#222222"); pen.set(pen.w - 2 + tilt, 11, "#222222");
  }
  function wolf(pen) {
    var splash = ["#f2c230", "#2f5fb3", "#c8432f", "#f4f1e8", "#1b1b1b", "#3a8ad8", "#e8823a", "#5a3a9a"];
    for (var v = 1; v < pen.h - 1; v++) for (var u = 1; u < pen.w - 1; u++) pen.set(u, v, splash[Math.floor(hash(Math.floor(u / 3) * 31 + Math.floor(v / 2), 11) * 8)]);
    var cu = Math.floor(pen.w / 2);
    pen.rect(cu - 11, 1, 22, 12, "#1b2233"); pen.rect(cu - 2, 4, 4, 9, "#f0f0ea"); pen.rect(cu - 1, 4, 2, 8, "#b02a2a"); // suit, shirt, tie
    pen.rect(cu - 5, 16, 10, 12, "#e0a986"); pen.rect(cu - 6, 26, 12, 4, "#c9a26a"); pen.rect(cu - 6, 21, 2, 6, "#c9a26a"); // face, hair
    pen.set(cu - 2, 22, "#2a1a10"); pen.set(cu + 2, 22, "#2a1a10"); pen.rect(cu - 2, 18, 4, 1, "#a0583a");
    pen.rect(cu - 14, 12, 28, 5, "#cfe0b0"); pen.rect(cu - 14, 12, 28, 1, "#8aa070"); pen.rect(cu - 14, 16, 28, 1, "#8aa070"); pen.rect(cu - 2, 13, 4, 3, "#9ab880"); // the bill
    pen.rect(cu - 15, 10, 4, 4, "#e0a986"); pen.rect(cu + 11, 10, 4, 4, "#e0a986");
    var t = since("wolf");
    if (t < 3000) for (var i = 0; i < 10; i++) { // bills fluttering down
      var x = 4 + i * 13 % (pen.w - 8) + Math.sin(t / 180 + i) * 3, y = pen.h - 4 - t * (0.012 + i % 3 * 0.004) + i % 4 * 6;
      if (y > 1) { pen.rect(x, y, 4, 2, "#cfe0b0"); pen.set(x + 1, y, "#8aa070"); }
    }
  }
  function staticFx(pen, u0, v0, w, h) {
    for (var v = v0; v < v0 + h; v++) for (var u = u0; u < u0 + w; u++) { var g = 40 + Math.floor(Math.random() * 200); pen.set(u, v, (255 << 24 | g << 16 | g << 8 | g) >>> 0, true); }
  }
  function samsung(pen) {
    pen.rect(3, 6, 14, 12, "#2f3a36"); pen.rect(4, 7, 12, 10, "#34403b");
    pen.rect(4, 2, 12, 1, "#0a0a0b"); pen.rect(6, 4, 7, 1, "#6a6a70");
    for (var g = 0; g < 4; g++) pen.rect(18, 3 + g * 2, 3, 1, "#2c2c30");
    var t = since("samsung");
    if (!state.on.samsung) return;
    if (t < 500) return staticFx(pen, 4, 7, 12, 10);
    pen.rect(4, 13, 12, 4, "#7ac8f0", true); pen.rect(4, 7, 12, 6, "#4aa83a", true); // sky, fairway
    pen.rect(13, 10, 1, 6, "#f4f4f0", true); pen.rect(14, 14, 2, 2, "#e8323a", true); pen.rect(12, 9, 3, 1, "#1a1a1a", true); // flag, hole
    var p = Math.min(1, ((t - 500) % 3500) / 2500); // the ball drops in, a pause, the next shot
    pen.set(5 + p * 7, 10 + Math.sin(p * Math.PI) * 5, "#ffffff", true);
  }
  function lavaGlass(pen) { // the same blobs on every side, so it reads as one glass
    var off = byId.lava.off;
    pen.rect(0, 0, pen.w, pen.h, off ? "#3a1a4a" : "#8a44b4", !off);
    if (off) return;
    pen.rect(0, 0, 1, pen.h, "#a05ad0", true); // a highlight down one edge
    var s = reduceMotion ? 0 : now / 900;
    [[0, 1.0, 1], [2.1, 0.7, 2], [4.2, 1.3, 1]].forEach(function (bl) {
      var v = Math.round(5 + Math.sin(s * bl[1] + bl[0]) * 4);
      pen.rect(bl[2], v, 2, 2, "#ff8a2a", true); pen.set(bl[2], v + 1, "#ffb05a", true);
    });
  }
  // the props that move when clicked: the golf ball hops, the mushroom's cap squashes
  var curtainsShut = false, curtainFrom = 0, curtainAt = -1e9; // closed or opening/closing, from how far, since when
  function curtainStep() {
    var t = Math.min(1, (now - curtainAt) / (reduceMotion ? 1 : 800)), e = t * t * (3 - 2 * t);
    var p = curtainFrom + ((curtainsShut ? 1 : 0) - curtainFrom) * e; // 0 open, 1 closed
    curtains[0].y1 = Math.round(WIN_C - 24 + 24 * p);
    curtains[1].y0 = Math.round(WIN_C + 24 - 24 * p);
    curtainStep.p = p;
  }
  function propsStep() {
    curtainStep();
    var t = since("golf-ball"), hop = t < 900 && !reduceMotion ? Math.round(Math.abs(Math.sin(t / 900 * Math.PI * 2)) * 4 * (1 - t / 900)) : 0;
    ball.forEach(function (b) { b.z0 = b.bz0 + hop; b.z1 = b.bz1 + hop; });
    mushTop.hide = since("mushroom") < 300;
    var tv = since("vw"), roll = tv < 1200 && !reduceMotion ? Math.round(Math.sin(tv / 1200 * Math.PI * 2) * 2) : 0; // forward, back
    vwParts.forEach(function (b) { b.y0 = b.by0 + roll; b.y1 = b.by1 + roll; });
  }
  // the Magnavox's title colour: picked from the movie's title, so each new latest movie comes up in a different one
  // (never the same as the movie watched before it)
  var TITLE_COLOURS = ["#f2a43a", "#5ad8a8", "#6fb3ff", "#f05a9a", "#c88ae8", "#f2e04a", "#ff7a59", "#7affd8", "#ff9ad0", "#a8e05a"];
  function colourIndex(m) {
    var key = (m.title || "") + (m.year || ""), h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h % TITLE_COLOURS.length;
  }
  function titleColour(m) {
    var i = colourIndex(m), prev = state.live.prevMovie;
    if (prev && colourIndex(prev) === i) i = (i + 1) % TITLE_COLOURS.length;
    return TITLE_COLOURS[i];
  }
  // The Magnavox. Its screen (u 3..18, v 8..21) is drawn twice: at room resolution (what the mirror shows), and at
  // double resolution into hiScreen, which present() puts on the room pixels where the screen still shows.
  function hiSet(x, y, c) { if (x >= 0 && y >= 0 && x < 32 && y < 28) hiScreen[y * 32 + x] = typeof c === "number" ? c : H(c); }
  function magnavox(pen) {
    pen.rect(2, 7, 18, 16, "#7d8084"); pen.rect(3, 8, 16, 14, "#262b29");
    pen.rect(3, 3, 13, 1, "#7d7f83"); for (var bt = 0; bt < 4; bt++) pen.set(4 + bt * 3, 1, "#6a6c70");
    for (var sp = 0; sp < 8; sp++) pen.set(21 + sp % 2 * 2, 2 + Math.floor(sp / 2) * 2, "#8a8c90");
    var t = since("magnavox");
    if (!state.on.magnavox) return;
    if (!reflect) for (var mv = 0; mv < 14; mv++) for (var mu = 0; mu < 16; mu++) { var at = pen.at(3 + mu, 8 + mv); if (at >= 0) hiMap[at] = 1 + mu + mv * 16; }
    if (t === Infinity) t = 600 + now; // on from the start (never clicked): showing, its title scrolling from page load
    var i, g;
    if (t < 600) { staticFx(pen, 3, 8, 16, 14); hiStatic(); return; }
    pen.rect(3, 8, 16, 14, "#0a0a0c", true);
    hiScreen.fill(H("#0a0a0c"));
    var m = state.live.movie, frames = state.live.stills, tt = t - 600;
    // its title scrolls across first, then a trailer-style montage: the film's scene stills (TMDB), a cut about every
    // second with a flicker of static; round again
    var s = m ? fit(m.title, 40) : "", w = textW(s);
    var titleMs = m ? (w + 34) * 45 : 0, montageMs = frames && frames.length ? 5000 : 0;
    var loop = montageMs + titleMs || 1, ph = tt % loop;
    if (montageMs && ph >= titleMs) { // (only once the stills are in)
      var mp = ph - titleMs, f = Math.floor(mp / 1000) % frames.length, fp = mp % 1000;
      if (fp < 90) { staticFx(pen, 3, 8, 16, 14); hiStatic(); return; }
      var fr = frames[f];
      for (var fv = 0; fv < 14; fv++) for (var fu = 0; fu < 16; fu++) pen.set(3 + fu, 21 - fv, fr.lo[fv * 16 + fu], true);
      for (var hy = 0; hy < 28; hy++) for (var hx = 0; hx < 32; hx++) {
        var pc = fr.hi[hy * 32 + hx];
        if (hy % 2) pc = ((pc >>> 1 & 0x7f7f7f) + (pc >>> 2 & 0x3f3f3f) | 0xff000000) >>> 0; // every other row dimmed: CRT scanlines
        hiScreen[hy * 32 + hx] = pc;
      }
      return;
    }
    tt = ph;
    if (m) { // the last movie's title, scrolling across the middle of the screen, in the 3x5 font at double resolution
      var off = Math.floor(tt / 45) % (w + 34), col = titleColour(m);
      for (i = 0; i < s.length; i++) {
        g = GLYPHS[s[i]] || GLYPHS["?"];
        for (var q = 0; q < 15; q++) if (g[q] === "1") {
          var hx2 = 32 - off + i * 4 + q % 3;
          hiSet(hx2, 11 + Math.floor(q / 3), col);
          var uu = 3 + Math.floor(hx2 / 2); // and roughly, at room resolution (the mirror's view)
          if (hx2 >= 0 && uu < 19) pen.set(uu, 16 - Math.floor(q / 3), col, true);
        }
      }
    }
  }
  function hiStatic() { for (var k = 0; k < 32 * 28; k++) { var g = 40 + Math.floor(Math.random() * 200); hiScreen[k] = (255 << 24 | g << 16 | g << 8 | g) >>> 0; } }
  function funko(pen) {
    pen.rect(1, 1, pen.w - 2, 9, "#e8f0fa"); pen.rect(0, 10, 4, 2, "#f5c31b");
    var t = since("funko"), bob = t < 1500 ? Math.round(Math.sin(t / 50) * (1 - t / 1500)) : 0;
    pen.rect(3, 2, 3, 3, "#151515"); pen.rect(2 + bob, 5, 5, 4, "#e0b08a"); pen.rect(2 + bob, 5, 5, 2, "#2a1c14"); pen.rect(2 + bob, 8, 5, 1, "#2a1c14");
    pen.set(3 + bob, 7, "#111111"); pen.set(5 + bob, 7, "#111111");
  }
  var RUBIK = ["#e8323a", "#f2c230", "#3a8ad8", "#5ac83a", "#f4f4f0", "#f08a3a"];
  function rubik(pen) {
    var mixed = since("rubik") < 1500;
    for (var v = 0; v < 4; v++) for (var u = 0; u < 4; u++) pen.set(u, v, mixed ? RUBIK[Math.floor(hash(u + v * 4, Math.floor(now / 150)) * 6)] : RUBIK[pen.face === "py" || pen.face === "ny" ? 0 : 2]);
  }
  function rubikTop(pen) { pen.each(function (x, y) { return since("rubik") < 1500 ? RUBIK[Math.floor(hash(x * 7 + y, Math.floor(now / 150)) * 6)] : "#f4f4f0"; }); }
  function dotsPoster(pen) {
    var dots = ["#e8323a", "#f2c230", "#3a8ad8", "#f07ab0", "#5ac83a", "#f08a3a", "#ffffff", "#9a5ae8"];
    pen.rect(2, 2, pen.w - 4, pen.h - 4, "#15101e");
    for (var v = 2; v < pen.h - 2; v++) for (var u = 2; u < pen.w - 2; u++) if (hash(u, v + 50) < 0.32) pen.set(u, v, dots[Math.floor(hash(v, u) * 8)]);
    pen.disc(Math.floor(pen.w / 2), Math.floor(pen.h / 2), 4, "#0e0a14"); pen.set(Math.floor(pen.w / 2), Math.floor(pen.h / 2), "#c8a080");
  }
  function sunsetPoster(pen) {
    var stripes = ["#2a1e5a", "#5a2a8a", "#a8389a", "#e84a5a", "#f08a3a", "#f5c542", "#f08a3a", "#a8389a"];
    for (var v = 2; v < pen.h - 2; v++) for (var u = 2; u < pen.w - 2; u++) {
      var c = stripes[Math.min(7, Math.floor((pen.h - 2 - v) / 3.8))];
      if (v < 10 + Math.sin(u * 0.5) * 1.5) c = "#1a1230";
      if (u === 7 && v < 14) c = "#0a0810";
      pen.set(u, v, c);
    }
  }
  function curtain(pen) { for (var u = 0; u < pen.w; u++) if (u % 3 === 1) pen.rect(u, 0, 1, pen.h, "#2e323a"); }
  // the window, painted on its wall: an arch with sky, trees and the hedge (or the night)
  function windowPixel(a, z) {
    var cx = WIN_C, half = 23, top = 108, d = Math.abs(a - cx) / half;
    var arch = top - 12 * (1 - Math.sqrt(Math.max(0, 1 - d * d)));
    if (z > arch + 2 || a < cx - half - 2 || a > cx + half + 1 || z < 28) return null;
    if (z > arch || a < cx - half || a > cx + half - 1) return "#4a8a86"; // teal frame
    if (z < 30) return "#e4e4de"; // sill
    var n = state.night, h = hash(a, z);
    // a tree outside, by the window's edge, so about half of it is in view: a round leafy crown up against the sky,
    // lit from the upper left, deeper green than the hedge behind it, over its trunk
    var tx = cx + half - 4, cz = 93, crown = Math.hypot((a - tx) * 1.05, (z - cz) * 1.15) + (hash(a * 3, z * 7) - 0.5) * 2.2;
    if (crown < 16) {
      if (n) return crown < 14.5 && h < 0.04 ? "#1a2a22" : "#06100a";
      var lit = (a - tx) + (z - cz) * 0.7; // lighter toward the upper left
      return crown > 14.8 ? "#1f4a24" : lit < -9 && h < 0.7 ? "#5fa04a" : lit < 0 ? (h < 0.5 ? "#3d7d3a" : "#357236") : h < 0.5 ? "#2f6a32" : "#285c2b";
    }
    if (z <= cz - 8 && Math.abs(a - tx) < 3.2 + Math.max(0, 40 - z) * 0.12) return n ? "#0a0a0c" : a < tx - 1 ? "#6a4a32" : a < tx + 1 ? "#5a3e2a" : "#4e3624"; // the trunk, flaring at the foot
    if (z > 84) return n ? (h < 0.01 ? "#e8e8ff" : z > 96 ? "#0c1230" : "#162048") : z > 96 ? "#bcd8e6" : "#d8e8ee";
    if (z > 66) {
      return n ? "#0f1a14" : h < 0.5 ? "#6a8f4a" : "#55803c";
    }
    if (z > 62) return n ? "#2a2a30" : "#9a9a98";
    return n ? (h < 0.5 ? "#0f1c10" : "#132414") : h < 0.5 ? "#3f6b2e" : "#5d8f3d";
  }
  function treadBelt(pen) { // the belt runs along the window: slats across it, moving toward the corner while it runs
    var off = since("treadmill") < 5000 ? Math.floor(now / 70) % 6 : 0;
    for (var y = 24; y < 92; y++) if ((y + off) % 6 === 0) pen.rect(8, y, 22, 1, "#33343a");
  }
  function steam(pen) { // wisps off the coffee; more of them just after it's clicked
    if (reduceMotion) return;
    var busy = since("coffee") < 2500, n = busy ? 4 : 2;
    for (var i = 0; i < n; i++) {
      var v = (now / 90 + i * (pen.h / n)) % pen.h, u = Math.floor(pen.w / 2) + Math.round(Math.sin(now / 300 + i * 2 + v * 0.4) * 1.5);
      if (v < pen.h - 1) pen.set(u, v, v > pen.h * 0.6 ? "#c8c8c8" : "#e8e8e8", true);
    }
  }
  function notes(pen, t, u0) {
    if (t > 2200) return;
    for (var i = 0; i < 2; i++) { var tt = t - i * 400; if (tt < 0 || tt > 1500) continue; var v = pen.h - 3 + tt / 200; if (v < pen.h) pen.set(u0 + i, v, "#ffffff", true); }
  }
  // the Rick and Morty canvas: deep red and orange to pink to gold, a ringed planet, stars, two running silhouettes
  var RICK = {};
  // two little figures standing on the ridge, looking out (a tall one in a long dark coat with grey hair, a kid in a
  // green hoodie), with a dark outline so they read against the sky. Rows top to bottom; [left a, bottom z].
  var SIL = {}, SIL_COL = { h: "#c8c8c8", s: "#f0d0b0", w: "#3a3f5a", c: "#e8e4d8", p: "#2a2a30", b: "#1a1410", m: "#3a2a1a", y: "#4ab86a", q: "#5a6a8a" };
  [[44, 70, ["hhhh.", "hhhhh", ".sss.", ".sss.", "..s..", "wwcww", "wwcww", "wwcww", "wwwww", "ww.ww", ".p.p.", ".p.p.", "bb.bb"]],
   [37, 70, [".yyy.", "yyyyy", "yssy.", ".sss.", "..y..", "yyyyy", "yyyyy", ".yyy.", ".q.q.", ".q.q.", "bb.bb"]],
  ].forEach(function (f) {
    var rows = f[2];
    rows.forEach(function (row, r) { for (var i = 0; i < row.length; i++) if (row[i] !== ".") SIL[(f[0] + i) * 1000 + f[1] + rows.length - 1 - r] = SIL_COL[row[i]]; });
  });
  function silRim(a, z) { return !SIL[a * 1000 + z] && (SIL[(a - 1) * 1000 + z] || SIL[(a + 1) * 1000 + z] || SIL[a * 1000 + z - 1] || SIL[a * 1000 + z + 1]); }
  function rickPixel(a, z) {
    var key = a * 1000 + z;
    if (RICK[key]) return RICK[key];
    var u = (a - 36) / 63, v = (z - 56) / 44, h = hash(a, z);
    var cols = u < 0.3 ? ["#7a1e1e", "#b8392a", "#e0642e"] : u < 0.62 ? ["#9a2a5a", "#d8487a", "#f07aa0"] : ["#e86a8a", "#f4a85a", "#f8d870"];
    var c = cols[Math.min(2, Math.floor(v * 2.2 + h * 0.9))];
    if (Math.abs(Math.hypot(a - 28, z - 20) - 76) < 1.3) c = "#ffe9a0";
    if (h > 0.975) c = "#fff6e0";
    if (z < 66 + Math.sin(a * 0.21) * 2 + Math.sin(a * 0.07) * 3) c = "#120c14";
    if (SIL[key]) c = SIL[key];
    else if (silRim(a, z)) c = "#120c14";
    return (RICK[key] = c);
  }
  function portal(pen, p) {
    var t = since("canvas");
    if (t > 6000) return;
    var r = Math.min(10, t / 50), spin = now / 120;
    pen.eachW(p[0], p[1], p[2], p[3], function (a, z) {
      var d = Math.hypot(a - 68, (z - 80) * 1.1);
      if (d > r) return null;
      var ang = Math.atan2(z - 80, a - 68) + spin + d * 0.4;
      return [["#2a8a1a", "#5ad83a", "#a8f070", "#e8ffd0"][Math.floor((Math.sin(ang * 2) + 1) * 1.6 + (d < r * 0.4 ? 1 : 0)) % 4], true];
    });
  }
  function bookcase(pen) {
    var cols = ["#f4f2ea", "#f2c230", "#c8322b", "#2f5fb3", "#e86a2a", "#7a3ab0", "#1d1d1f", "#3a9a5a", "#f07ab0", "#e8e8e8"];
    [[2, 10], [13, 10], [24, 9]].forEach(function (row, r) {
      for (var u = 2; u < pen.w - 2; u++) {
        var tape = Math.floor(u / 2.5) + r * 40, c = cols[Math.floor(hash(tape, r) * cols.length)];
        pen.rect(u, row[0], 1, row[1], c);
        pen.set(u, row[0] + row[1] - 3, hash(tape, 5) < 0.5 ? "#222222" : "#fffbe8");
      }
      pen.rect(0, row[0] - 1, pen.w, 1, "#d2d2ca");
    });
    if (since("bookcase") < 1400) pen.rect(this.pick || 20, 13, 2, 10, "#2f5fb3");
  }
  // the fan's front, facing into the room: the grill and its spinning blades (the body behind it is solid slices)
  function fan(pen) {
    var r = 5.6, cv = (pen.h - 1) / 2, cu = (pen.w - 1) / 2;
    for (var vv = 0; vv < pen.h; vv++) for (var u = 0; u < pen.w; u++) {
      var d = Math.hypot(u - cu, vv - cv);
      if (d > r) continue;
      pen.set(u, vv, d > r - 1 ? "#0e0e10" : "#202024");
      if (Math.abs(d - 3) < 0.5) pen.set(u, vv, "#3c3c42"); // the grill's ring
    }
    var fast = since("fan") < 3000, a = reduceMotion ? 0 : now / (fast ? 25 : 140);
    for (var k = 0; k < 3; k++) for (var q = 1; q < 5; q++) pen.set(cu + Math.cos(a + k * 2.09) * q, cv + Math.sin(a + k * 2.09) * q, "#77777e");
    pen.set(Math.round(cu), Math.round(cv), "#a0a0a6");
  }
  function doorPanels(pen) {
    if (pen.w < 10) return; // its edge
    var pw = Math.floor((pen.w - 7) / 2);
    [[2, 66, 24], [2, 36, 24], [2, 4, 26]].forEach(function (r) {
      [2, 5 + pw].forEach(function (u) {
        pen.rect(u, r[1], pw, r[2], "#dedcd5"); pen.rect(u, r[1] + r[2] - 1, pw, 1, "#c8c6bf"); pen.rect(u, r[1], 1, r[2], "#c8c6bf");
      });
    });
    pen.setW(134, 46, "#202022"); pen.setW(134, 45, "#202022"); pen.setW(135, 46, "#55555a"); // the knob, by the free edge (room y 132)
  }
  function dresser(pen) {
    var w = Math.floor(pen.w / 2);
    for (var r = 0; r < 3; r++) for (var col = 0; col < 2; col++) {
      pen.rect(col * w, 10 * r + 3, w - 1, 1, "#29282d");
      pen.rect(col * w + w / 2 - 4, 10 * r + 8, 8, 1, "#c8c8c8");
    }
  }
  function bigTv(pen) {
    pen.rect(1, 1, pen.w - 2, pen.h - 2, "#101116");
    for (var i = 0; i < 18; i++) pen.rect(20 + i, pen.h - 3 - i, 6, 1, "#1a1c22"); // the glare
    var t = since("tv");
    if (!state.on.tv) return;
    pen.rect(1, 1, pen.w - 2, pen.h - 2, "#0f1f12", true);
    if (t < 600) return;
    var slide = Math.min(1, (t - 600) / 300); // the achievement toast slides in
    pen.rect(7, 13, Math.round(44 * slide), 9, "#1b1b1f", true);
    if (slide < 1) return;
    pen.disc(11, 17, 3, "#107c10", true); pen.set(11, 17, "#ffffff", true);
    pen.text(16, 20, t < 3000 ? "ACHIEVED" : "SCORE", "#a9a7a0", true);
    var g = state.live.gamerscore;
    pen.text(16, 14, g ? String(g.total) : "UNLOCKED", "#ffffff", true);
  }
  // The plant: one spiky fan growing out of the middle of its pot, drawn straight onto the screen from the pot's centre
  // (so it's the same plant from every side, not one on each face): long blades tapering to a point, the outer ones
  // arching down, darker ones behind and lighter ones in front; it sways a little, and shakes when clicked.
  var LEAVES = (function () {
    var out = [], n = 24;
    for (var i = 0; i < n; i++) {
      var f = i / (n - 1), a = (f - 0.5) * 2.5 + (hash(i, 3) - 0.5) * 0.18; // angle from straight up
      var outer = Math.abs(a) / 1.25;
      out.push({ a: a, len: (34 - outer * 12 + hash(i, 7) * 6) * 0.85, droop: outer * outer * 12, back: hash(i, 5) < 0.45, k: i }); // 0.85: a little smaller (Nick)
    }
    // behind first (the darker, taller ones), then the ones in front
    return out.filter(function (l) { return l.back; }).concat(out.filter(function (l) { return !l.back; }));
  })();
  var PLANT_BACK = ["#34502f", "#3e5a3a"], PLANT_FRONT = ["#4f6b4a", "#5d7a55", "#6d8c62"], PLANT_EDGE = "#86a676";
  function plantSprite(b) {
    var t = since("plant"), sway = reduceMotion ? 0 : Math.sin(now / 1400) * 0.8 + (t < 1200 ? Math.sin(t / 50) * 2 * (1 - t / 1200) : 0);
    var c = vcell(171, 145), sx = OX + c[0] - c[1], sy = OY + Math.floor((c[0] + c[1]) / 2) - 44; // the middle of the pot's soil
    LEAVES.forEach(function (l) {
      var cols = l.back ? PLANT_BACK : PLANT_FRONT, steps = Math.ceil(l.len * 1.2);
      for (var st = 0; st <= steps; st++) {
        var f = st / steps;
        var x = sx + Math.sin(l.a) * l.len * f + sway * f * (l.k % 2 ? 1 : 0.7);
        var y = sy - Math.cos(l.a) * l.len * f + l.droop * f * f;
        var col = H(cols[Math.min(cols.length - 1, Math.floor(f * cols.length))]);
        put(Math.round(x), Math.round(y), col);
        if (f < 0.6) put(Math.round(x) + (l.a > 0 ? -1 : 1), Math.round(y), col); // wider toward the base
        if (!l.back && f > 0.15 && f < 0.7 && st % 3 === 0) put(Math.round(x) + (l.a > 0 ? 1 : -1), Math.round(y), H(PLANT_EDGE)); // a lit edge
      }
    });
    for (var k = -2; k <= 2; k++) put(sx + k, sy - (k === 0 ? 1 : 0), H("#34502f")); // where it comes out of the soil
  }

  // The mirror's glass: marked "glass" here, then compositeMirror shows the reflection in it (the room drawn again,
  // flipped across this wall), so it shows whatever is really across the room from where you're looking
  function mirror(pen) {
    pen.rect(2, 2, pen.w - 4, pen.h - 4, "#8a9496", "glass");
    pen.rect(Math.floor(pen.w / 2) - 1, 0, 2, pen.h, "#c9a24a"); // where the two sliding doors overlap
  }
  function pinkPoster(pen) {
    pen.rect(2, 2, pen.w - 4, pen.h - 4, "#1a1426");
    for (var i = 0; i < 70; i++) { var a = hash(i, 1) * 6.28, r = hash(i, 2); pen.set(pen.w / 2 + Math.cos(a) * r * pen.w * 0.3, 13 + Math.sin(a) * r * 10, ["#f04a8a", "#e8323a", "#3a6ae8", "#f07ab0"][i % 4]); }
    pen.disc(Math.floor(pen.w / 2), 25, 3, "#d8307a");
  }

  // ---------- the cats ----------
  // A cat sitting, made of boxes (head first, so its speech bubble goes over its head): body, head with eyes and nose
  // on the side it faces, ears, its tail curled on the bed, two front paws. dir: the way it faces, 0 +x, 1 +y, 2 -x, 3 -y.
  // The black and white one has a white muzzle, chest, belly and paws.
  function makeCat(id, L, cx, cy, z, dir) {
    var faceSide = ["px", "py", "nx", "ny"][dir];
    function range(c, a0, a1, sign) { return sign > 0 ? [c + a0, c + a1] : [c - a1 + 1, c - a0 + 1]; }
    function part(f0, f1, s0, s1, z0, z1, col, o) { // from the cat's own frame (f forward, s to its side) into the room
      var fr, sr, x, y;
      if (dir === 0) { fr = range(cx, f0, f1, 1); sr = range(cy, s0, s1, 1); x = fr; y = sr; }
      else if (dir === 2) { fr = range(cx, f0, f1, -1); sr = range(cy, s0, s1, -1); x = fr; y = sr; }
      else if (dir === 1) { fr = range(cy, f0, f1, 1); sr = range(cx, s0, s1, -1); y = fr; x = sr; }
      else { fr = range(cy, f0, f1, -1); sr = range(cx, s0, s1, 1); y = fr; x = sr; }
      o = o || {};
      o.thing = id;
      return box(x[0], x[1], y[0], y[1], z + z0, z + z1, col, o);
    }
    part(3, 8, -2, 3, 6, 12, L.fur, { topc: L.top, paint: { side: function (pen) {
      if (pen.face !== faceSide) return;
      if (L.white) pen.rect(1, 0, pen.w - 2, 2, L.white);
      pen.set(1, 3, L.eyes); pen.set(pen.w - 2, 3, L.eyes);
      pen.set(Math.floor(pen.w / 2), 2, "#e88a9a");
    } } });
    part(-4, 3, -2, 3, 0, 7, L.fur, { topc: L.top, paint: { side: function (pen) {
      if (L.white) { // a white chest at the front, a white belly along the sides
        if (pen.face === faceSide) pen.rect(1, 0, pen.w - 2, pen.h - 1, L.white);
        else pen.rect(1, 0, pen.w - 2, 1, L.white);
      } else if (pen.w > 6) for (var u = 2; u < pen.w - 1; u += 3) pen.rect(u, pen.h - 2, 1, 2, L.dark); // tabby stripes
    } } });
    part(4, 5, -2, -1, 12, 14, L.dark); part(4, 5, 2, 3, 12, 14, L.dark);
    part(-7, -4, 2, 3, 0, 1, L.dark, { topc: L.dark });
    part(3, 5, -2, -1, 0, 2, L.white || L.dark); part(3, 5, 1, 2, 0, 2, L.white || L.dark);
  }
  function sisal(pen) { for (var v = 0; v < pen.h; v += 2) pen.rect(0, v, pen.w, 1, "#b38c52"); }
  function plush(pen) { for (var v = 0; v < pen.h; v++) for (var u = 0; u < pen.w; u++) if (hash(u * 3 + v, pen.w) < 0.15) pen.set(u, v, "#cbbca5"); }
  function bedTop(pen) { // a raised rim round a softer, deeper cushion
    var b = pen.box;
    pen.each(function (x, y) {
      var e = Math.min(x - b.x0, b.x1 - 1 - x, y - b.y0, b.y1 - 1 - y);
      return e === 0 ? "#f2e8da" : e === 1 ? "#e6d9c5" : "#c9b8a2";
    });
  }

  // the chair's spin: which side of the seat (centre 91, 49) its back is on, 0 +y (away from the desk), 1 +x, 2 -y, 3 -x
  var CHAIR_BACK = [[79, 103, 61, 65], [103, 107, 37, 61], [79, 103, 33, 37], [75, 79, 37, 61]];
  var CHAIR_ARMS = [[[77, 79, 41, 57], [103, 105, 41, 57]], [[83, 99, 35, 37], [83, 99, 61, 63]]];
  function chairStep() {
    var t = since("chair"), dir = t < 1200 && !reduceMotion ? Math.floor(t / 150) % 4 : 0;
    var bk = CHAIR_BACK[dir];
    chairBack.x0 = bk[0]; chairBack.x1 = bk[1]; chairBack.y0 = bk[2]; chairBack.y1 = bk[3];
    CHAIR_ARMS[dir % 2].forEach(function (a, i) { var b = chairArms[i]; b.x0 = a[0]; b.x1 = a[1]; b.y0 = a[2]; b.y1 = a[3]; });
  }

  // ---------- the things you can click ----------
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function stars(r) { return r ? new Array(Math.floor(r) + 1).join("★") + (r % 1 ? "½" : "") : ""; }
  var PAGES = ["/games/", "/movies/", "/movies/library/", "/music/", "/photography/", "/play/", "/extras/", "/extras/golf/", "/changelog/"];
  // light: [x, y, z, radius, strength (or a function), colour] for the night
  var things = [
    { id: "monitor", name: "Main monitor", text: "Worky worky worky work.", go: "/changelog/", label: "What’s new on the site", click: function () { SFX.blip(); }, light: [91, 10, 60, 50, 0.55] },
    { id: "side-monitor", name: "Second monitor", text: "", go: "/extras/", label: "Extras", click: function () { tvSwitch("side-monitor"); }, light: [56, 8, 55, 36, function () { return state.on["side-monitor"] ? 0.45 : 0; }] },
    { id: "vhs-shelf", name: "Shelf of VHS tapes", text: "NixFlix! Main 2024 hobby, modern movies in VHS, custom VHS slipcovers.", go: "/photography/#photo=pxl-20261001-003513280-mp-2", label: "See the photo", click: function () { SFX.click(); boxOf("vhs-shelf").pick = 2 + Math.floor(Math.random() * 46); } },
    { id: "dude", name: "The Dude", text: "The Dude abides.", go: "/movies/#the-big-lebowski", label: "The Big Lebowski", click: function () { SFX.boing(); }, say: "THE DUDE ABIDES." },
    { id: "desk-lamp", dayLight: [116, 16, 50, 46, function () { return state.lamp ? 0.6 : 0; }, [1, 0.8, 0.45]], name: "Desk lamp", text: "", click: function () { state.lamp = !state.lamp; SFX.click(); }, light: [116, 16, 60, 60, function () { return state.lamp ? 1 : 0; }, [1, 0.85, 0.6]] },
    { id: "wolf", name: "The Wolf of Wall Street", text: "", go: "/movies/library/#disc=the-wolf-of-wall-street-2013-bluray", label: "Open it in my Library", click: function () { SFX.cash(); } },
    { id: "samsung", name: "13\" Samsung TV/VCR", text: "My go-to cozy CRT. Rare for the VHS player to still work in these built-ins!", go: "/extras/golf-game/", label: "Play Nick’s Nine", click: function () { tvSwitch("samsung"); }, light: [149, 28, 50, 34, function () { return state.on.samsung ? 0.6 : 0; }] },
    { id: "golf-ball", name: "TaylorMade golf ball piggy bank", text: "Color Me Mine!", go: "/extras/golf/", label: "My golf rounds", click: function () { SFX.boing(); } },
    { id: "mushroom", name: "Mushroom", text: "1-UP.", click: function () { SFX.oneUp(); }, say: "1UP" },
    { id: "lava", name: "Lava lamp", text: "", click: function () { this.off = !this.off; SFX.click(); }, light: [163, 24, 52, 26, function () { return byId.lava.off ? 0 : 0.5; }, [1, 0.6, 0.4]] },
    { id: "snes", name: "Super Nintendo", text: "Yoshi's Island almost always stays in the system", go: "/games/#all-time-favorites", label: "My favorite games", click: function () { SFX.coin(); }, say: "YOSHI!" },
    { id: "film", name: "Roll of film", text: "Kodak Portra 400. The film photos are scans of rolls like this one.", go: "/photography/#film", label: "Film photos", click: function () { SFX.click(); } },
    { id: "magnavox", name: "Magnavox TV/DVD", text: function () { var m = state.live.movie; return m ? "Now showing: " + m.title + (m.rating ? " " + stars(m.rating) : "") + ", the last movie I watched." : "The last movie I watched plays here."; }, note: function () { return state.live.stills && state.live.stills.length ? "Stills · TMDB" : ""; }, go: function () { var m = state.live.movie; return m && m.imdbId ? "/movies/#film=" + m.imdbId : "/movies/#recently-watched"; }, label: "Recently Watched", click: function () { tvSwitch("magnavox"); }, light: [197, 30, 54, 40, function () { return state.on.magnavox ? 0.65 : 0; }] },
    { id: "vw", name: "VW bus model", text: "It's red...and it's a van...", click: function () { SFX.honk(); }, say: "BEEP BEEP" },
    { id: "funko", name: "Funko Pop: Nick Simpson", text: "It's me in vinyl! Hi!", go: "/", label: "Home", click: function () { SFX.boing(); }, say: "THAT'S ME!" },
    { id: "rubik", name: "Rubik's cube", text: "", click: function () { SFX.twist(); } }, // no text: no card, just the twists
    { id: "coffee", name: "Coffee", text: "Full caf now! I'm addicted!", click: function () { SFX.drip(); } },
    { id: "chair", name: "Office chair", text: "", click: function () { SFX.chair(); } },
    { id: "canvas", name: "Rick and Morty canvas", text: "The portal takes you somewhere random", go: "random", label: "Through the portal", click: function () { SFX.portal(); }, light: [208, 68, 80, 40, function () { return since("canvas") < 6000 ? 0.7 : 0; }, [0.5, 1, 0.4]] },
    { id: "fan", name: "Desk fan", text: "", click: function () { SFX.fan(); } },
    { id: "speaker", name: "Speaker", text: function () {
      var s = state.live.song;
      if (!s) return "What I'm listening to lately, and the playlists.";
      var what = s.title + (s.artist ? " by " + s.artist : "");
      if (!soundOn) return "The latest song I played: " + what + ". Turn the sound on to hear it.";
      return music.on ? "Playing my latest track [" + what + "]" : "Stopped [" + what + "]";
    }, note: function () { return music.on ? "Preview · Apple Music" : ""; }, go: "/music/", label: "Music", click: function () { toggleMusic(); } },
    { id: "bookcase", name: "Bookcase of VHS tapes", text: "The rest of the tapes. Disney clamshells, mostly. VHS has its own shelf in the Library now.", go: "/movies/library/", label: "My disc library", click: function () { SFX.click(); boxOf("bookcase").pick = 2 + Math.floor(Math.random() * 40); } },
    { id: "door", name: "Door", text: "The way out, back to the Play page.", go: "/play/", label: "Back to Play", click: function () { SFX.click(); } },
    { id: "plant", name: "Plant", text: "I can only keep fake plants alive!", click: function () { SFX.rustle(); } },
    { id: "tv", name: "Big TV", text: function () { var g = state.live.gamerscore; return g ? "Xbox gamerscore: " + fmt(g.total) + (g.gained ? " (+" + fmt(g.gained) + " in the last day)" : "") + ". And what I've been playing." : "Where the Xbox lives."; }, go: "/games/", label: "Games", click: function () { tvSwitch("tv"); if (state.on.tv) setTimeout(SFX.coin, 900); }, light: [133, 137, 55, 60, function () { return state.on.tv ? 0.55 : 0; }] },
    { id: "mirror", name: "Mirror closet", text: "", click: function () { SFX.shine(); } },
    { id: "window", name: "Window", text: "", click: function () { setNight(!state.night); if (state.night) SFX.night(); else SFX.day(); } },
    { id: "laptop", name: "Laptop", text: "", click: function () { SFX.click(); }, light: [15, 86, 54, 22, 0.35] },
    { id: "curtains", name: "Curtains", text: "", click: function () { curtainFrom = curtainStep.p || 0; curtainsShut = !curtainsShut; curtainAt = now; SFX.curtains(curtainsShut); } }, // no card: they just open and close
    { id: "treadmill", name: "Treadmill desk", text: "A walking desk: work, walk, repeat. Tryna daily 10k!", click: function () { SFX.treadmill(); } },
    { id: "headphones", name: "Headphones", text: function () { var s = state.live.song; return s ? (s.nowPlaying ? "Playing right now: " : "Last played: ") + s.title + (s.artist ? " by " + s.artist : "") + "." : "What I've been listening to."; }, go: "/music/", label: "Music", go2: "https://www.audeze.com/products/lcd-x", label2: "Audeze LCD-X", click: function () { SFX.notes(); } },
    { id: "mic", name: "Boom mic", text: "", click: function () { SFX.micTap(); }, say: "TESTING 1 2" },
    { id: "can", name: "Olipop", text: "", click: function () { SFX.canOpen(); } },
    { id: "floor-lamp", name: "Floor lamp", text: "", click: function () { state.lampHue = (state.lampHue + 1) % LAMP.length; SFX.click(); }, light: [6, 6, 60, 90, function () { return LAMP[state.lampHue].off ? 0 : 0.95; }, "lamp"] },
    { id: "cat", name: "Dennis", text: "Dennis. Dennis Reynolds. Dennis the Menace. Fwoopy Butt. Hunky Chunky.", go: "/photography/#cats", label: "Cat photos", click: function () { SFX.meow(); }, say: "MEOW!" },
    { id: "cat2", name: "Mac", text: "Mac. Macaroni. Macaroni Tony. Macaroni Noodle. Mr. Noodle.", go: "/photography/#cats", label: "Cat photos", click: function () { tone(900, 0.12, "triangle", 0.07, 1300); tone(1200, 0.2, "triangle", 0.06, 800, 0.12); }, say: "MRRP?" },
  ];
  var byId = {};
  things.forEach(function (o) { byId[o.id] = o; });
  setNight(hour >= 19 || hour < 7); // the visitor's own time of day
  function boxOf(id) { return boxes.filter(function (b) { return b.thing === id; })[0]; }

  // ---------- each frame ----------
  var bgFill = new Uint32Array(CW * CH); // see-through: the page's checkered blue shows round the room (office.css)
  var hover = null, order = [];
  function visibleBoxes() {
    var backs = {}; // the walls standing at the back in this view
    boxes.forEach(function (b) { if (b.wall) { var vb = viewBox(b); if (vb.vx1 <= 0 || vb.vy1 <= 0) backs[b.wall] = true; } });
    return boxes.filter(function (b) { return !b.hide && (b.wall ? backs[b.wall] : b.wallItem ? backs[b.wallItem] : true); });
  }
  // the window's pixels on screen (it's painted on its wall), for clicks and the hover outline
  function markWindow() {
    windowPx.fill(0);
    if (order.indexOf(windowWall) < 0) return;
    var vb = windowWall.vb;
    for (var z = 26; z < 112; z++) for (var a = WIN_C - 25; a < WIN_C + 25; a++) {
      if (!windowPixel(a, z)) continue;
      var sx, sy;
      if (rot === 0) { var c0 = vb.vx1 - 1; sx = OX + c0 - a; sy = OY + Math.floor((c0 + a) / 2) - z; }
      else if (rot === 3) { var r3 = vb.vy1 - 1, vx = Y - 1 - a; sx = OX + vx - r3; sy = OY + Math.floor((vx + r3) / 2) - z; }
      else continue;
      if (sx >= 0 && sy >= 0 && sx < CW && sy < CH && ids[sy * CW + sx] === windowWall.n) windowPx[sy * CW + sx] = 1;
    }
  }
  function thingOfPixel(i) {
    var n = ids[i];
    if (n < 0) return null;
    if (windowPx[i]) return byId.window;
    return boxes[n].thing ? byId[boxes[n].thing] : null;
  }
  // a darker edge where an object meets anything that isn't part of it, like the hand-drawn outlines in Unpacking
  var keyOf = [];
  function outlines() {
    boxes.forEach(function (b) { keyOf[b.n] = b.structural ? -1 : b.thing ? b.thing : b.n; });
    for (var y = 1; y < CH - 1; y++) for (var x = 1; x < CW - 1; x++) {
      var i = y * CW + x, n = ids[i];
      if (n < 0) continue;
      var t = keyOf[n];
      if (t === -1) continue;
      var a = ids[i - CW], b = ids[i - 1], c = ids[i + 1], d = ids[i + CW];
      if (a < 0 || keyOf[a] !== t || b < 0 || keyOf[b] !== t || c < 0 || keyOf[c] !== t || d < 0 || keyOf[d] !== t) buf[i] = shade(buf[i], 0.62);
    }
  }
  function highlight(o) {
    var col = Math.floor(now / 350) % 2 ? H("#ffffff") : H("#ffe08a");
    var mine = new Uint8Array(CW * CH);
    for (var i = 0; i < CW * CH; i++) { var n = ids[i]; if (n >= 0 && (o.id === "window" ? windowPx[i] : boxes[n].thing === o.id)) mine[i] = 1; }
    for (var y = 1; y < CH - 1; y++) for (var x = 1; x < CW - 1; x++) {
      var k = y * CW + x;
      if (!mine[k] && (mine[k - 1] || mine[k + 1] || mine[k - CW] || mine[k + CW])) buf[k] = col;
    }
  }
  // speech bubbles over things that say something when clicked
  function rectB(x, y, w, h, c) { for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) { var sx = x + i, sy = y + j; if (sx >= 0 && sy >= 0 && sx < CW && sy < CH) buf[sy * CW + sx] = c; } }
  function speech() {
    things.forEach(function (o) {
      if (!o.say || since(o.id) > 2000) return;
      var b = boxOf(o.id);
      if (!b || order.indexOf(b) < 0) return;
      var vb = b.vb, sx = OX + Math.floor((vb.vx0 + vb.vx1) / 2) - Math.floor((vb.vy0 + vb.vy1) / 2), sy = OY + Math.floor((vb.vx0 + vb.vy0) / 2) - vb.z1 - 4;
      var s = o.say, w = textW(s) + 6, x0 = Math.round(sx - w / 2), y0 = sy - 11 - Math.round(Math.min(1, since(o.id) / 200) * 2);
      var ink = H("#111111");
      rectB(x0, y0, w, 9, ink); rectB(x0 + 1, y0 + 1, w - 2, 7, H("#f4f4f0")); rectB(sx, y0 + 9, 1, 2, ink);
      for (var i = 0; i < s.length; i++) { var g = GLYPHS[s[i]] || GLYPHS["?"]; for (var q = 0; q < 15; q++) if (g[q] === "1") rectB(x0 + 3 + i * 4 + q % 3, y0 + 2 + Math.floor(q / 3), 1, 1, ink); }
    });
  }
  // Night: everything dims and turns blue, except what gives off light; lamps and screens light the room round them
  function darkness() {
    var lights = [];
    things.forEach(function (o) {
      if (!o.light) return;
      var L = o.light, s = typeof L[4] === "function" ? L[4]() : L[4];
      if (!s) return;
      var c = vcell(L[0], L[1]), col = L[5] === "lamp" ? lampNow().light : L[5] || [0.75, 0.85, 1];
      lights.push({ x: OX + c[0] - c[1], y: OY + Math.floor((c[0] + c[1]) / 2) - L[2], r: L[3], s: s, col: col });
    });
    for (var y = 0; y < CH; y++) for (var x = 0; x < CW; x++) {
      var i = y * CW + x;
      if (glow[i] || ids[i] < 0) continue;
      var lr = 0.22, lg = 0.25, lb = 0.42;
      for (var k = 0; k < lights.length; k++) {
        var L2 = lights[k], dx = x - L2.x, dy = (y - L2.y) * 1.2, d2 = dx * dx + dy * dy, r2 = L2.r * L2.r;
        if (d2 < r2) { var f = (1 - d2 / r2) * L2.s; lr += f * L2.col[0]; lg += f * L2.col[1]; lb += f * L2.col[2]; }
      }
      var c = buf[i];
      buf[i] = (255 << 24 | Math.min(255, (c >> 16 & 255) * Math.min(1.1, lb)) << 16 | Math.min(255, (c >> 8 & 255) * Math.min(1.1, lg)) << 8 | Math.min(255, (c & 255) * Math.min(1.1, lr))) >>> 0;
    }
  }
  // The room as seen in the mirror: everything but the mirror's own wall (and what hangs on it) drawn again, flipped
  // across that wall, into its own buffer. All four walls are in it, since the room really has them.
  function renderReflection() {
    var keepBuf = buf, keepIds = ids, keepGlow = glow;
    buf = rBuf; ids = rIds; glow = rGlow;
    reflect = true;
    rBuf.fill(0); rIds.fill(-1); rGlow.fill(0);
    sortBoxes(boxes.filter(function (b) { return !b.hide && b.wall !== "tv" && b.wallItem !== "tv"; })).forEach(drawBox);
    reflect = false;
    buf = keepBuf; ids = keepIds; glow = keepGlow;
  }
  // ...shown through the glass: a touch of the glass's own tint, faint diagonal glare, and a bright sweep when clicked
  function compositeMirror() {
    var tint = H("#c4d0d4"), white = H("#ffffff"), empty = H("#8a9496"), lo = Infinity, hi = -Infinity, i, d;
    for (i = 0; i < CW * CH; i++) if (mirrorPx[i]) { d = i % CW + Math.floor(i / CW) * 0.5; if (d < lo) lo = d; if (d > hi) hi = d; }
    var t = since("mirror"), sweep = t < 900 ? lo + (hi - lo + 40) * t / 900 - 20 : -999;
    for (i = 0; i < CW * CH; i++) {
      if (!mirrorPx[i]) continue;
      var c = mix(rIds[i] >= 0 ? rBuf[i] : empty, tint, 0.14);
      d = i % CW + Math.floor(i / CW) * 0.5;
      if ((((d - lo) % 44) + 44) % 44 < 3) c = mix(c, white, 0.16);
      if (Math.abs(d - sweep) < 4) c = mix(c, white, 0.6);
      buf[i] = c;
      glow[i] = rGlow[i];
    }
  }
  // By day the lamps you switch on still show: a soft warm brightening round them (things[].dayLight: [x, y, z,
  // radius, strength, colour], used while it's on)
  function dayGlow() {
    var lights = [];
    things.forEach(function (o) {
      if (!o.dayLight) return;
      var L = o.dayLight, s = L[4]();
      if (!s) return;
      var c = vcell(L[0], L[1]);
      lights.push({ x: OX + c[0] - c[1], y: OY + Math.floor((c[0] + c[1]) / 2) - L[2], r: L[3], s: s, col: L[5] });
    });
    if (!lights.length) return;
    lights.forEach(function (L) {
      var x0 = Math.max(0, Math.floor(L.x - L.r)), x1 = Math.min(CW, Math.ceil(L.x + L.r)), y0 = Math.max(0, Math.floor(L.y - L.r)), y1 = Math.min(CH, Math.ceil(L.y + L.r));
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
        var i = y * CW + x;
        if (ids[i] < 0 || glow[i]) continue;
        var dx = x - L.x, dy = (y - L.y) * 1.2, d2 = dx * dx + dy * dy, r2 = L.r * L.r;
        if (d2 >= r2) continue;
        var f = (1 - d2 / r2) * L.s, c = buf[i];
        var r = c & 255, g = c >> 8 & 255, bl = c >> 16 & 255;
        r = Math.min(255, r + (255 - r) * f * L.col[0] * 0.5 + r * f * 0.25);
        g = Math.min(255, g + (255 - g) * f * L.col[1] * 0.5 + g * f * 0.25);
        bl = Math.min(255, bl + (255 - bl) * f * L.col[2] * 0.5 + bl * f * 0.25);
        buf[i] = (255 << 24 | bl << 16 | g << 8 | r) >>> 0;
      }
    });
  }
  // the room onto the double-size canvas: each pixel as 2x2, except where the Magnavox's screen still shows (nothing in
  // front of it), which gets its double-resolution picture
  function present() {
    var W2 = CW * 2, mag = magBox.n;
    for (var y = 0; y < CH; y++) {
      var o = y * 2 * W2, i = y * CW;
      for (var x = 0; x < CW; x++, i++, o += 2) {
        var c = buf[i], cell = hiMap[i];
        if (cell && ids[i] === mag) {
          cell--;
          var hu = (cell % 16) * 2, hr = (13 - Math.floor(cell / 16)) * 2;
          hb[o] = hiScreen[hr * 32 + hu]; hb[o + 1] = hiScreen[hr * 32 + hu + 1];
          hb[o + W2] = hiScreen[(hr + 1) * 32 + hu]; hb[o + W2 + 1] = hiScreen[(hr + 1) * 32 + hu + 1];
        } else { hb[o] = hb[o + 1] = hb[o + W2] = hb[o + W2 + 1] = c; }
      }
    }
  }
  var last = performance.now();
  function frame(ts) {
    var dt = Math.min(50, ts - last);
    last = ts;
    now = ts;
    chairStep();
    propsStep();
    origin();
    var vis = visibleBoxes();
    var mirrorOn = vis.indexOf(mirrorBox) >= 0;
    if (mirrorOn) renderReflection();
    order = sortBoxes(vis);
    buf.set(bgFill); ids.fill(-1); glow.fill(0); mirrorPx.fill(0); hiMap.fill(0);
    order.forEach(drawBox);
    if (mirrorOn) compositeMirror();
    markWindow();
    outlines();
    if (state.night) darkness(); else dayGlow();
    if (hover) highlight(hover);
    speech();
    present();
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(frame);
  }

  // ---------- size and zoom ----------
  var view = { scale: 2 }, zoom = 1, panX = 0, panY = 0;
  function resize() {
    var r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    // as big as fits (in whole screen pixels where that costs little), times the zoom
    var fitS = Math.min(r.height / CH, r.width / CW), whole = Math.floor(fitS * dpr) / dpr;
    var s = (whole >= fitS * 0.92 ? whole : Math.floor(fitS * dpr * 4) / (dpr * 4)) * zoom;
    view.scale = s;
    canvas.style.width = CW * s + "px";
    canvas.style.height = CH * s + "px";
    stage.style.setProperty("--tile", 48 * s / zoom + "px"); // the checks, in room pixels like Unpacking's
    clampPan();
  }
  function clampPan() {
    var r = stage.getBoundingClientRect();
    var mx = Math.max(0, (CW * view.scale - r.width) / 2), my = Math.max(0, (CH * view.scale - r.height) / 2);
    panX = Math.max(-mx, Math.min(mx, panX)); panY = Math.max(-my, Math.min(my, panY));
    canvas.style.transform = "translate(-50%, -50%) translate(" + panX + "px," + panY + "px)"; // (centred, see office.css)
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- turning ----------
  var tip = document.querySelector(".office-tip"), card = document.querySelector(".office-card");
  function turn(dir) {
    rot = (rot + dir + 4) % 4;
    hover = null; tip.hidden = true;
    SFX.turn();
    hideHint();
  }
  document.querySelector(".office-pan.left").addEventListener("click", function () { turn(-1); });
  document.querySelector(".office-pan.right").addEventListener("click", function () { turn(1); });
  var zoomBtn = document.querySelector(".office-zoom");
  zoomBtn.addEventListener("click", function () {
    // a fixed zoom: in to 1.5x (2.5x on phones, where the room is small), or (zoomed in any way) back out
    zoomTarget = zoomTarget > 1 ? 1 : matchMedia("(pointer: coarse)").matches ? 2.5 : 1.5; zoomAt = null;
    if (zoomTarget === 1) panX = panY = 0;
    easeZoom();
  });

  // the mouse wheel (or a trackpad's pinch) zooms in and out smoothly, towards whatever is under the pointer: from the
  // whole room up to 3x. Zoomed in, drag to look around.
  var ZOOM_MAX = 3, zoomTarget = 1, zoomAt = null, zoomRaf = 0;
  function setZoom(z, at) {
    var r = stage.getBoundingClientRect(), before = view.scale;
    zoom = z;
    resize();
    if (at) { // keep the point under the pointer where it is
      var cx = at.x - (r.left + r.width / 2), cy = at.y - (r.top + r.height / 2), k = view.scale / before;
      panX = cx - (cx - panX) * k; panY = cy - (cy - panY) * k;
    }
    if (zoom <= 1.001) panX = panY = 0;
    clampPan();
    zoomBtn.setAttribute("aria-pressed", String(zoom > 1.01));
    stage.style.touchAction = zoom > 1.01 ? "none" : ""; // zoomed in, a finger looks around every way; out, it scrolls the page
  }
  function easeZoom() {
    if (zoomRaf) return;
    (function step() {
      var d = zoomTarget - zoom;
      if (Math.abs(d) < 0.002 || reduceMotion) { setZoom(zoomTarget, zoomAt); zoomRaf = 0; return; }
      setZoom(zoom + d * 0.22, zoomAt);
      zoomRaf = requestAnimationFrame(step);
    })();
  }
  stage.addEventListener("wheel", function (e) {
    if (e.target.closest(".office-card, .office-list")) return; // the card and the list scroll as usual
    e.preventDefault();
    var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines -> pixels
    zoomTarget = Math.max(1, Math.min(ZOOM_MAX, zoomTarget * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))));
    zoomAt = { x: e.clientX, y: e.clientY };
    hideHint();
    easeZoom();
  }, { passive: false });

  // two fingers pinch to zoom (phones and tablets), towards the point between them, and pan as they move. Watched in
  // the capture phase so the second finger never reaches the canvas as a drag or a click.
  var touches = {}, pinch = null;
  function twoFingers() {
    var ids = Object.keys(touches);
    if (ids.length < 2) return null;
    var a = touches[ids[0]], b = touches[ids[1]];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  stage.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var f = twoFingers();
    if (!f || pinch) return;
    pinch = { d: f.d, z: zoom, x: f.x, y: f.y };
    if (zoomRaf) { cancelAnimationFrame(zoomRaf); zoomRaf = 0; }
    dragging = false; moved = Infinity; // no drag, and no click when the fingers lift
    hover = null; tip.hidden = true;
    hideHint();
  }, true);
  stage.addEventListener("pointermove", function (e) {
    if (!touches[e.pointerId]) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var f = pinch && twoFingers();
    if (!f) return;
    zoomTarget = Math.max(1, Math.min(ZOOM_MAX, pinch.z * f.d / pinch.d));
    zoomAt = null;
    setZoom(zoomTarget, f);
    panX += f.x - pinch.x; panY += f.y - pinch.y; pinch.x = f.x; pinch.y = f.y;
    clampPan();
  }, true);
  function liftFinger(e) {
    delete touches[e.pointerId];
    if (!pinch) return;
    var f = twoFingers();
    if (f) { pinch = { d: f.d, z: zoom, x: f.x, y: f.y }; return; } // a third finger was down: carry on with the other two
    pinch = null;
  }
  stage.addEventListener("pointerup", liftFinger, true);
  stage.addEventListener("pointercancel", liftFinger, true);
  // keep the browser's own pinch (and Safari's page zoom) out of it while two fingers are on the room
  stage.addEventListener("touchmove", function (e) { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  stage.addEventListener("gesturestart", function (e) { e.preventDefault(); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { e.preventDefault(); turn(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); turn(1); }
    else if (e.key === "Escape") closeCard();
  });

  // ---------- pointer: click things, drag sideways to turn (or to look around when zoomed in) ----------
  var dragging = false, downX = 0, downY = 0, lastX = 0, lastY = 0, moved = 0, turned = false;
  function thingAt(e) {
    var r = canvas.getBoundingClientRect();
    var x = Math.floor((e.clientX - r.left) / r.width * CW), y = Math.floor((e.clientY - r.top) / r.height * CH);
    return x >= 0 && y >= 0 && x < CW && y < CH ? thingOfPixel(y * CW + x) : null;
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (pinch) return; // the second finger of a pinch
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
    var o = thingAt(e);
    hover = o;
    canvas.classList.toggle("over", !!o);
    if (o) {
      var r = stage.getBoundingClientRect();
      tip.textContent = o.name;
      tip.style.left = e.clientX - r.left + "px";
      tip.style.top = e.clientY - r.top + "px";
      tip.hidden = false;
    } else tip.hidden = true;
  });
  canvas.addEventListener("pointerleave", function () { hover = null; tip.hidden = true; canvas.classList.remove("over"); });
  canvas.addEventListener("pointerup", function (e) {
    dragging = false;
    if (moved > 6) return;
    var o = thingAt(e);
    if (o) activate(o); else closeCard();
  });
  canvas.addEventListener("pointercancel", function () { dragging = false; });

  // ---------- clicking a thing ----------
  function activate(o) {
    anims[o.id] = now;
    if (o.click) o.click.call(o);
    hideHint();
    // a thing with nothing to say and nowhere to go (the Rubik's cube) just does its thing: no card
    if (!o.text && !o.go) { closeCard(); return; }
    card.querySelector("h2").textContent = o.name;
    card.querySelector(".office-card-text").textContent = typeof o.text === "function" ? o.text.call(o) : o.text;
    var note = card.querySelector(".office-card-note"), nt = typeof o.note === "function" ? o.note.call(o) : o.note; // a small print line (the speaker's preview credit)
    note.textContent = nt || ""; note.hidden = !nt;
    var a = card.querySelector(".office-card-link:not(.second)");
    if (o.go) {
      var go = typeof o.go === "function" ? o.go.call(o) : o.go; // (a function: worked out when clicked, like the Magnavox's)
      a.href = go === "random" ? PAGES[Math.floor(Math.random() * PAGES.length)] : go;
      a.textContent = (o.label || "Open") + " →";
      a.hidden = false;
    } else a.hidden = true;
    var a2 = card.querySelector(".office-card-link.second"); // a second link (go2/label2), e.g. off the site
    if (o.go2) {
      a2.href = o.go2; a2.textContent = (o.label2 || "More") + (/^https?:/.test(o.go2) ? " ↗" : " →");
      if (/^https?:/.test(o.go2)) { a2.target = "_blank"; a2.rel = "noopener"; } else { a2.removeAttribute("target"); a2.removeAttribute("rel"); }
      a2.hidden = false;
    } else a2.hidden = true;
    card.hidden = false;
    hideHint();
  }
  function closeCard() { card.hidden = true; }
  card.querySelector(".office-card-close").addEventListener("click", closeCard);

  // the list of everything (keyboards, screen readers): picking one turns the room so its wall is at the back
  var FACING = { window: 0, desk: 0, rm: 1, tv: 2 };
  var list = document.querySelector(".office-list ul"), toggle = document.querySelector(".office-list-toggle");
  list.innerHTML = things.map(function (o) { return '<li><button type="button" data-id="' + o.id + '">' + o.name + "</button></li>"; }).join("");
  toggle.addEventListener("click", function () { var open = list.hidden; list.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); });
  list.addEventListener("click", function (e) {
    var bt = e.target.closest("button[data-id]");
    if (!bt) return;
    var b = boxOf(bt.dataset.id);
    if (b && b.wallItem) rot = FACING[b.wallItem];
    activate(byId[bt.dataset.id]);
    list.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  });

  var hint = document.querySelector(".office-hint");
  function hideHint() { hint.classList.add("gone"); }
  setTimeout(hideHint, 7000);
  var soundBtn = document.querySelector(".office-sound");
  soundBtn.setAttribute("aria-pressed", String(soundOn));
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    if (!soundOn) stopMusic();
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    try { localStorage.setItem("nm-office-sound", soundOn ? "on" : "off"); } catch (e) {}
    if (soundOn) SFX.blip();
  });

  // ---------- live things from the Worker ----------
  // the latest movie's scene stills for the Magnavox montage, each shrunk to the screen (cropped to its middle) at room
  // resolution (16x14) and double (32x28),
  // read through the Worker's image proxy so the canvas may read them
  function loadStills(imdb) {
    getJson("/library/stills?imdb=" + encodeURIComponent(imdb)).then(function (d) {
      var urls = (d && d.stills || []).slice(0, 5), out = [];
      urls.forEach(function (u, k) {
        var im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = function () {
          try {
            var shrink = function (W, Hh) { // the middle of the still at W x Hh pixels
              var c = document.createElement("canvas"); c.width = W; c.height = Hh;
              var x = c.getContext("2d"), sh = im.height, sw = Math.min(im.width, sh * W / Hh);
              x.imageSmoothingQuality = "high";
              x.drawImage(im, (im.width - sw) / 2, 0, sw, sh, 0, 0, W, Hh);
              var dd = x.getImageData(0, 0, W, Hh).data, px = [];
              for (var i = 0; i < W * Hh; i++) px.push((255 << 24 | dd[i * 4 + 2] << 16 | dd[i * 4 + 1] << 8 | dd[i * 4]) >>> 0);
              return px;
            };
            out[k] = { lo: shrink(16, 14), hi: shrink(32, 28) };
            state.live.stills = out.filter(Boolean);
          } catch (e) { /* a still the canvas can't read: skipped */ }
        };
        im.src = API + "/img?u=" + encodeURIComponent(u);
      });
    });
  }
  function getJson(path) { return fetch(API + path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  if (API) {
    getJson("/watched?page=movies").then(function (d) {
      var m = d && d.items && d.items[0];
      if (!m) return;
      state.live.movie = m;
      state.live.prevMovie = d.items[1]; // so its title colour differs from the one before
      if (m.imdbId) loadStills(m.imdbId);
    });
    getJson("/xbox/gamerscore").then(function (d) { if (d && d.total >= 0) state.live.gamerscore = d; });
    getJson("/spotify/now").then(function (d) { if (d && d.title) state.live.song = d; });
  }

  // for testing (and the curious): turn the room, click a thing, switch night, outline a thing
  window.NMOffice = {
    turn: function (r) { rot = (r % 4 + 4) % 4; },
    click: function (id) { if (byId[id]) activate(byId[id]); },
    night: function (on) { setNight(on); },
    hover: function (id) { hover = byId[id] || null; },
  };

  requestAnimationFrame(frame);
})();
