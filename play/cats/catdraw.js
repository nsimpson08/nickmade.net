// The Cattery's cats (Ver 1.6), drawn in code as pixel art: each cat is a little posable model (a body of three
// joints, a neck, a head with ears, four legs, a tail), and every frame it's drawn straight into pixels, shaded from
// the top left in four tones of its fur, with its pattern (tabby stripes, tuxedo white, calico patches...) worked out
// from where each pixel is on the cat. So a new pose (walking, sleeping, pouncing) works for every fur and pattern,
// and nothing is hand-drawn frame by frame. Used by room.js for the room and the Cat Maker.
//
//   CatDraw.render(look, pose, t, facing) -> { w, h, px: Uint32Array (0xAABBGGRR, 0 = see-through), ax, ay }
//     look: { pattern, base, second, eyes, fluffy, seed }   pose: a name in CatDraw.POSES   t: seconds (animation)
//     facing: 1 right, -1 left   ax, ay: where the cat's feet touch the ground in the sprite
(function () {
  "use strict";

  // ---------- the choices (the Worker checks looks against the same lists, worker/src/cats.js) ----------
  var FURS = {
    black: { name: "Black", hex: "#2c2c33" }, charcoal: { name: "Charcoal", hex: "#4b4e57" }, blue: { name: "Blue grey", hex: "#7f8a99" },
    silver: { name: "Silver", hex: "#c4c7cd" }, white: { name: "White", hex: "#f2efe8" }, cream: { name: "Cream", hex: "#eed6ae" },
    fawn: { name: "Fawn", hex: "#d6b593" }, ginger: { name: "Ginger", hex: "#e3893b" }, red: { name: "Red", hex: "#c35a27" },
    cinnamon: { name: "Cinnamon", hex: "#ad6a3d" }, brown: { name: "Brown", hex: "#7a5334" }, chocolate: { name: "Chocolate", hex: "#56382a" },
    lilac: { name: "Lilac", hex: "#b9a8ad" },
  };
  var EYES = {
    green: { name: "Green", hex: "#8cc63f" }, gold: { name: "Gold", hex: "#e8b739" }, copper: { name: "Copper", hex: "#d9782a" },
    blue: { name: "Blue", hex: "#68b6ea" }, hazel: { name: "Hazel", hex: "#b2a44a" }, odd: { name: "Odd (blue and gold)", hex: null },
  };
  // second: whether the pattern uses a second fur colour (and what the Maker calls it)
  var PATTERNS = {
    solid: { name: "Solid" }, tabby: { name: "Tabby", second: "Stripes" }, tuxedo: { name: "Tuxedo" }, bicolor: { name: "Bicolour" },
    van: { name: "Van" }, calico: { name: "Calico", second: "Patches" }, tortie: { name: "Tortoiseshell", second: "Mottling" },
    colorpoint: { name: "Colourpoint", second: "Points" }, spotted: { name: "Spotted", second: "Spots" },
  };

  // ---------- colour ----------
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; }
  function pack(c) { return (255 << 24 | Math.max(0, Math.min(255, Math.round(c[2]))) << 16 | Math.max(0, Math.min(255, Math.round(c[1]))) << 8 | Math.max(0, Math.min(255, Math.round(c[0])))) >>> 0; }
  function lerp(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function lum(c) { return (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255; }
  // five tones of a fur: [outline, shadow, base, light, highlight]. Shadows lean cool and purple, lights warm, like
  // hand-picked pixel-art ramps rather than plain darker and lighter.
  var toneCache = {};
  function tones(hex) {
    if (toneCache[hex]) return toneCache[hex];
    var c = rgb(hex), L = lum(c);
    var shadow = lerp(c.map(function (x) { return x * (L > 0.8 ? 0.8 : 0.7); }), [70, 64, 110], L > 0.8 ? 0.28 : 0.16);
    var light = lerp(c, [255, 246, 228], L < 0.2 ? 0.14 : 0.2);
    var high = lerp(c, [255, 250, 238], L < 0.2 ? 0.3 : 0.42);
    var deep = L < 0.2 ? lerp(c, [8, 8, 12], 0.55) : lerp(c.map(function (x) { return x * 0.42; }), [30, 20, 40], 0.3);
    return (toneCache[hex] = [pack(deep), pack(shadow), pack(c), pack(light), pack(high)]);
  }
  function shadeU(c, k) { return pack([(c & 255) * k, (c >> 8 & 255) * k, (c >> 16 & 255) * k]); }

  // ---------- noise (for calico patches, tortie mottling, spots) ----------
  function hash(a, b, s) { var h = (a * 374761393 + b * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function noise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function frac(x) { return x - Math.floor(x); }

  // ---------- the pattern: which colour a spot on the cat is ----------
  // where: { p: part ("body", "neck", "haunch", "leg", "paw", "tail", "head", "ear", "muzzle"), a, b } with, per part:
  // body a 0 (hip) to 1 (shoulder), b -1 (belly) to 1 (back); leg/tail a 0 (top/base) to 1 (paw/tip); head a, b -1..1
  // across and up the face; haunch a, b -1..1 across and up it. Returns "base", "second", "white", or "light" (the
  // base colour, a shade lighter: chests and muzzles).
  function region(look, w) {
    var pat = look.pattern, s = look.seed || 1, p = w.p, a = w.a, b = w.b;
    if (p === "muzzle") return { tuxedo: "white", bicolor: "white", van: "white", calico: "white", colorpoint: "second" }[pat] || "light";
    switch (pat) {
      case "tabby":
        if (p === "body") return b > -0.45 && frac(a * 5.2 + 0.18 * Math.sin(b * 4 + s)) < 0.3 ? "second" : b < -0.6 ? "light" : "base";
        if (p === "neck") return b < 0 ? "light" : "base";
        if (p === "haunch") return frac(Math.atan2(b, a) * 1.1 + s) < 0.3 && Math.hypot(a, b) > 0.45 ? "second" : "base";
        if (p === "leg") return a > 0.15 && a < 0.82 && frac(a * 4.2) < 0.3 ? "second" : "base";
        if (p === "tail") return frac(a * 6.5) < 0.42 || a > 0.9 ? "second" : "base";
        if (p === "head") {
          if (b > 0.32 && Math.abs(frac(a * 3.3 + 0.5) - 0.5) < 0.11) return "second"; // the M on the forehead
          if (Math.abs(a) > 0.62 && b > -0.25 && b < 0.08 && frac(b * 9) < 0.45) return "second"; // cheek lines
          return "base";
        }
        return "base";
      case "tuxedo":
        if (p === "body") return b < -0.4 || (a > 0.78 && b < 0.25) ? "white" : "base";
        if (p === "neck") return b < 0.35 ? "white" : "base";
        if (p === "paw" || (p === "leg" && a > 0.8)) return "white";
        if (p === "head") return (b < -0.28 && Math.abs(a) < 0.5) || (Math.abs(a) < 0.11 && b < 0.32) ? "white" : "base";
        return "base";
      case "bicolor":
      case "calico": {
        var white = false;
        if (p === "body") white = b < 0.05 + 0.12 * Math.sin(a * 7 + s);
        else if (p === "neck") white = b < 0.5;
        else if (p === "leg") white = a > 0.22;
        else if (p === "paw") white = true;
        else if (p === "haunch") white = b < -0.1;
        else if (p === "head") white = b < -0.1 || (Math.abs(a) < 0.16 + (0.3 - b) * 0.25 && b < 0.45);
        if (white) return "white";
        if (pat === "bicolor") return "base";
        // calico: the coloured parts in patches of the two colours
        var nx = p === "head" ? a * 1.6 + 20 : p === "tail" ? a * 3 + 40 : p === "body" ? a * 2.4 : p === "haunch" ? a * 1.4 + 60 : a + 80;
        var ny = p === "head" ? b * 1.6 : p === "tail" ? 3 : p === "body" ? b * 1.4 : b * 1.4;
        return noise(nx + s * 3.1, ny + s * 1.7, s) > 0.5 ? "second" : "base";
      }
      case "van":
        if (p === "tail") return a > 0.08 ? "base" : "white";
        if (p === "ear") return "base";
        if (p === "head") return b > 0.3 && (Math.abs(a) > 0.14 || b > 0.75) && noise(a * 3 + s, b * 3, s) > 0.25 ? "base" : "white";
        return "white";
      case "tortie": {
        var key = { body: 0, neck: 10, haunch: 20, leg: 30, paw: 40, tail: 50, head: 60, ear: 70 }[p] || 0;
        var n = noise(a * 3.4 + key + s * 2.3, b * 3.4 + s, s) * 0.75 + noise(a * 9 + key, b * 9, s + 9) * 0.25;
        return n > 0.52 ? "second" : n > 0.47 ? "light" : "base";
      }
      case "colorpoint":
        if (p === "ear" || p === "paw" || (p === "leg" && a > 0.4) || (p === "tail" && a > 0.22)) return "second";
        if (p === "head") return Math.hypot(a * 1.05, (b + 0.35) * 1.25) < 0.68 ? "second" : "base";
        return "base";
      case "spotted":
        if (p === "body") return b > -0.5 && noise(a * 7 + s, b * 3.4, s) > 0.62 ? "second" : b < -0.6 ? "light" : "base";
        if (p === "haunch") return noise(a * 3 + 30 + s, b * 3, s) > 0.62 ? "second" : "base";
        if (p === "leg") return a < 0.8 && frac(a * 3.6) < 0.25 ? "second" : "base";
        if (p === "tail") return frac(a * 6) < 0.38 || a > 0.9 ? "second" : "base";
        if (p === "head") return b > 0.32 && Math.abs(frac(a * 3.3 + 0.5) - 0.5) < 0.1 ? "second" : "base";
        return "base";
      default:
        if (p === "body" && b < -0.65) return "light";
        return "base";
    }
  }
  function palettes(look) {
    var base = (FURS[look.base] || FURS.ginger).hex, sec = (FURS[look.second] || FURS.black).hex;
    if (look.pattern === "tabby" && !look.second) sec = null;
    var b = tones(base);
    var s = sec ? tones(sec) : [b[0], shadeU(b[1], 0.8), shadeU(b[2], 0.72), b[2], b[3]];
    var l = [b[0], b[2], b[3], b[4], b[4]]; // "light": the base a step up
    return { base: b, second: s, white: tones(FURS.white.hex), light: l };
  }

  // ---------- the poses ----------
  // Each returns the cat's joints in pixels: x forward (the way it faces), y up from the ground. A joint is [x, y, r].
  // body: hip, middle, shoulder; neck: shoulder end, head end; head: [x, y]; legs: { far: [...], near: [...] }, each leg
  // a list of joints down to the paw, with paw: [x, y]; haunch: { far, near }; tail: joints from the base to the tip.
  function sitTail(t, s) { var w = Math.sin(t * 2.1 + s) * 1.6; return [[-22, 9, 4.4], [-27, 4, 4.2], [-14, 2.2, 4], [2, 2.2, 3.8], [14, 3.5 + w * 0.4, 3.4], [21 + w * 0.6, 6 + w, 3.1]]; }
  var POSES = {
    stand: function (t, s) {
      var tw = Math.sin(t * 1.7 + s) * 2;
      return {
        body: [[-20, 33, 12.5], [-1, 35, 13], [17, 35, 13]], neck: [[17, 37, 10], [27, 44, 9]], head: [31, 51],
        legs: {
          far: [{ pts: [[13, 29, 4.6], [13, 15, 4], [13, 4, 3.8]], paw: [14, 3.5] }, { pts: [[-24, 20, 5], [-17, 14, 4.2], [-27, 8, 3.8], [-24, 4, 3.6]], paw: [-23, 3.5] }],
          near: [{ pts: [[19, 29, 4.8], [20, 15, 4.2], [21, 4, 4]], paw: [22, 3.5] }, { pts: [[-17, 20, 5], [-11, 14, 4.4], [-21, 8, 4], [-18, 4, 3.8]], paw: [-17, 3.5] }],
        },
        haunch: { far: [-23, 27, 11.5], near: [-18, 26, 12.5] },
        tail: [[-31, 38, 4.4], [-41, 45, 4.2], [-47, 56 + tw * 0.3, 4], [-46 + tw * 0.5, 67, 3.7], [-41 + tw, 74, 3.4], [-36 + tw, 76, 3.1]],
      };
    },
    walk: function (t, s) {
      var ph = t * 7.5, bob = Math.abs(Math.sin(ph)) * 1.2;
      function leg(x0, y0, off, rear, k) {
        var sw = Math.sin(ph + off), lift = Math.max(0, Math.cos(ph + off)) * 3.5, px = x0 + sw * 7;
        if (rear) return { pts: [[x0 - 4, 20 + bob, 5 * k], [x0 + 3 + sw * 2, 14 + bob, 4.3 * k], [px - 6, 8 + lift, 3.9 * k], [px - 3, 4 + lift, 3.7 * k]], paw: [px - 2, 3.5 + lift] };
        return { pts: [[x0, 29 + bob, 4.7 * k], [x0 + sw * 3.5, 15 + lift * 0.6 + bob * 0.5, 4.1 * k], [px, 4 + lift, 3.9 * k]], paw: [px + 1, 3.5 + lift] };
      }
      var tw = Math.sin(ph * 0.5) * 3;
      return {
        body: [[-20, 33 + bob, 12.5], [-1, 35 + bob, 13], [17, 35 + bob, 13]], neck: [[17, 37 + bob, 10], [27, 44 + bob, 9]], head: [31, 51 + bob],
        legs: { far: [leg(13, 0, Math.PI, false, 0.95), leg(-21, 0, 0, true, 0.95)], near: [leg(19, 0, 0, false, 1), leg(-15, 0, Math.PI, true, 1)] },
        haunch: { far: [-23, 27 + bob, 11.5], near: [-18, 26 + bob, 12.5] },
        tail: [[-31, 38 + bob, 4.4], [-41, 46 + bob, 4.2], [-48 + tw * 0.3, 57, 4], [-49 + tw, 68, 3.7], [-45 + tw * 1.4, 75, 3.4], [-40 + tw * 1.5, 77, 3.1]],
      };
    },
    sit: function (t, s) {
      var br = Math.sin(t * 1.6 + s) * 0.35;
      return {
        body: [[-12, 17, 14.5 + br], [-4, 28, 13.5 + br], [4, 38, 12]], neck: [[4, 40, 10], [8, 49, 9]], head: [10, 58],
        legs: {
          far: [{ pts: [[1, 33, 4.4], [1.5, 16, 4], [2, 4, 3.8]], paw: [2.5, 3.5] }, { pts: [[-16, 10, 4.5], [-6, 5, 4]], paw: [-4, 3.5] }],
          near: [{ pts: [[6, 33, 4.7], [7, 16, 4.3], [8, 4, 4]], paw: [9, 3.5] }, { pts: [[-9, 9, 4.8], [0, 4.5, 4.3]], paw: [3, 3.5] }],
        },
        haunch: { far: [-15, 16, 14], near: [-10, 15, 15] },
        tail: sitTail(t, s), tailFront: true,
      };
    },
    loaf: function (t, s) {
      var br = Math.sin(t * 1.4 + s) * 0.4;
      return {
        body: [[-18, 15, 15 + br], [-1, 17, 16 + br], [15, 16, 14 + br]], neck: [[15, 18, 11], [22, 24, 10]], head: [26, 31],
        legs: { far: [], near: [{ pts: [[20, 6, 4.4], [25, 3.5, 4]], paw: [26, 3.5] }] },
        haunch: { far: [-19, 14, 12], near: [-16, 13, 13] },
        tail: [[-30, 9, 4.3], [-31, 4, 4.1], [-18, 2.2, 3.9], [-2, 2.2, 3.6], [10, 3, 3.3], [17, 5, 3]], tailFront: true,
        eyes: "half",
      };
    },
    sleep: function (t, s) {
      var br = Math.sin(t * 1.1 + s) * 0.6;
      return {
        body: [[-15, 13, 14 + br * 0.5], [0, 17, 17 + br], [14, 14, 14 + br * 0.5]], neck: [[14, 15, 11], [19, 15, 10]], head: [21, 16],
        legs: { far: [], near: [{ pts: [[16, 6, 4.2], [24, 3.5, 3.9]], paw: [25, 3.5] }] },
        haunch: { far: [-16, 12, 12], near: [-13, 11, 13] },
        tail: [[-27, 9, 4.3], [-28, 3.5, 4.1], [-14, 2.2, 3.9], [2, 2.2, 3.6], [16, 2.5, 3.3], [27, 5, 3]], tailFront: true,
        eyes: "closed", headTilt: -0.35,
      };
    },
    eat: function (t, s) {
      var nod = Math.sin(t * 9) * 1;
      return {
        body: [[-20, 33, 12.5], [-1, 32, 13], [16, 28, 12.5]], neck: [[16, 29, 10], [26, 22 + nod, 9]], head: [31, 17 + nod],
        legs: {
          far: [{ pts: [[12, 23, 4.5], [14, 12, 4], [15, 4, 3.8]], paw: [16, 3.5] }, { pts: [[-24, 20, 5], [-17, 14, 4.2], [-27, 8, 3.8], [-24, 4, 3.6]], paw: [-23, 3.5] }],
          near: [{ pts: [[18, 23, 4.7], [21, 12, 4.2], [22, 4, 4]], paw: [23, 3.5] }, { pts: [[-17, 20, 5], [-11, 14, 4.4], [-21, 8, 4], [-18, 4, 3.8]], paw: [-17, 3.5] }],
        },
        haunch: { far: [-23, 27, 11.5], near: [-18, 26, 12.5] },
        tail: [[-31, 37, 4.4], [-42, 40, 4.2], [-51, 44, 4], [-58, 50, 3.7], [-60, 57, 3.4], [-57, 61, 3.1]],
        eyes: "half", headTilt: -0.25,
      };
    },
    groom: function (t, s) {
      var lick = Math.sin(t * 8) * 2.5, p = this.sit(t, s);
      p.legs.near[0] = { pts: [[6, 34, 4.7], [13, 42, 4.2], [14 + lick * 0.3, 50 + lick, 4]], paw: [14 + lick * 0.3, 51 + lick] };
      p.eyes = "closed"; p.tongue = true; p.headTilt = -0.15;
      return p;
    },
    happy: function (t, s) { // petted: eyes shut, the tail straight up with a hook
      var p = this.sit(t, s), w = Math.sin(t * 3) * 1.2;
      p.eyes = "closed"; p.tailFront = false;
      p.tail = [[-20, 22, 4.4], [-28, 30, 4.2], [-32, 44, 4], [-32, 58, 3.7], [-29 + w, 68, 3.4], [-23 + w, 71, 3.1]];
      return p;
    },
    crouch: function (t, s) { // about to pounce: low at the front, the back end wiggling
      var wig = Math.sin(t * 14) * 2;
      return {
        body: [[-17 + wig * 0.4, 27, 12.5], [-1, 22, 12.5], [14, 17, 12]], neck: [[14, 18, 10], [22, 22, 9]], head: [27, 27],
        legs: {
          far: [{ pts: [[11, 13, 4.4], [18, 6, 4], [22, 3.8, 3.8]], paw: [23, 3.5] }, { pts: [[-20 + wig * 0.3, 18, 5], [-10, 10, 4.2], [-9, 4, 3.8]], paw: [-8, 3.5] }],
          near: [{ pts: [[16, 13, 4.6], [23, 6, 4.2], [27, 3.8, 4]], paw: [28, 3.5] }, { pts: [[-15 + wig * 0.3, 18, 5], [-5, 10, 4.4], [-4, 4, 4]], paw: [-3, 3.5] }],
        },
        haunch: { far: [-20 + wig * 0.4, 21, 11.5], near: [-15 + wig * 0.4, 20, 12.5] },
        tail: [[-28 + wig * 0.4, 28, 4.3], [-39, 27, 4.1], [-50, 26, 3.9], [-60, 26 + Math.sin(t * 20) * 2, 3.6], [-67, 28 + Math.sin(t * 20 + 1) * 3, 3.3]],
        eyes: "wide",
      };
    },
    jump: function (t, s) { // in the air: stretched out, front paws reaching
      return {
        body: [[-22, 31, 12], [0, 34, 12.5], [19, 36, 12.5]], neck: [[19, 38, 10], [28, 44, 9]], head: [33, 49],
        legs: {
          far: [{ pts: [[15, 31, 4.5], [25, 25, 4], [33, 20, 3.8]], paw: [34, 19.5] }, { pts: [[-25, 22, 5], [-34, 16, 4.2], [-43, 13, 3.8]], paw: [-44, 12.5] }],
          near: [{ pts: [[20, 31, 4.7], [30, 25, 4.2], [37, 19, 4]], paw: [38, 18.5] }, { pts: [[-20, 22, 5], [-30, 15, 4.4], [-40, 11, 4]], paw: [-41, 10.5] }],
        },
        haunch: { far: [-25, 26, 11.5], near: [-20, 25, 12.5] },
        tail: [[-32, 34, 4.3], [-43, 38, 4.1], [-54, 42, 3.9], [-64, 47, 3.6], [-71, 53, 3.3]],
        eyes: "wide",
      };
    },
    bat: function (t, s) { // sitting up, swiping at a toy
      var p = this.sit(t, s), sw = Math.sin(t * 9), up = Math.abs(sw);
      p.legs.near[0] = { pts: [[6, 34, 4.7], [14 + sw * 3, 38 + up * 6, 4.2], [22 + sw * 5, 40 + up * 10, 4]], paw: [23 + sw * 5, 40 + up * 10] };
      p.eyes = "wide";
      return p;
    },
    hiss: function (t, s) { // arched back, puffed tail straight up, ears flat, mouth open
      var q = Math.sin(t * 30) * 0.4;
      return {
        body: [[-19, 33, 13], [-2, 47 + q, 14], [15, 37, 13]], neck: [[15, 38, 10.5], [24, 43, 9.5]], head: [29, 47],
        legs: {
          far: [{ pts: [[13, 31, 4.6], [14, 15, 4.1], [14, 4, 3.9]], paw: [15, 3.5] }, { pts: [[-22, 25, 5], [-22, 13, 4.3], [-23, 4, 3.8]], paw: [-22, 3.5] }],
          near: [{ pts: [[18, 31, 4.8], [19, 15, 4.3], [20, 4, 4]], paw: [21, 3.5] }, { pts: [[-17, 25, 5], [-17, 13, 4.5], [-18, 4, 4]], paw: [-17, 3.5] }],
        },
        haunch: { far: [-22, 29, 11.5], near: [-17, 28, 12.5] },
        tail: [[-30, 40, 6.5], [-34, 53, 7], [-34, 66, 7], [-32, 78, 6.5], [-30, 87, 5.5]],
        ears: "flat", eyes: "wide", mouth: "open", puff: 2,
      };
    },
    stretch: function (t, s) { // the downward cat
      return {
        body: [[-17, 35, 12.5], [0, 26, 12.5], [15, 15, 12]], neck: [[15, 16, 10], [24, 17, 9]], head: [29, 21],
        legs: {
          far: [{ pts: [[13, 10, 4.4], [24, 5, 4], [33, 3.8, 3.8]], paw: [34, 3.5] }, { pts: [[-20, 25, 5], [-21, 13, 4.3], [-21, 4, 3.8]], paw: [-20, 3.5] }],
          near: [{ pts: [[17, 10, 4.6], [28, 5, 4.2], [37, 3.8, 4]], paw: [38, 3.5] }, { pts: [[-15, 25, 5], [-16, 13, 4.5], [-16, 4, 4]], paw: [-15, 3.5] }],
        },
        haunch: { far: [-20, 30, 11.5], near: [-15, 29, 12.5] },
        tail: [[-28, 40, 4.3], [-34, 51, 4.1], [-36, 62, 3.9], [-33, 72, 3.6], [-28, 77, 3.3]],
        eyes: "closed", mouth: "open",
      };
    },
  };

  // ---------- drawing ----------
  var W = 168, H = 136, AX = 84, AY = 128;
  var LX = -0.45, LY = 0.62, LZ = 0.64; // the light: from the top left, toward you

  function render(look, poseName, t, facing) {
    facing = facing < 0 ? -1 : 1;
    var s = look.seed || 1;
    var P = (POSES[poseName] || POSES.sit).call(POSES, t || 0, s % 7);
    var pal = palettes(look);
    var px = new Uint32Array(W * H), ord = new Int16Array(W * H).fill(-1), grp = new Int8Array(W * H).fill(-1);
    var order = 0, puff = (look.fluffy ? 1.6 : 0) + (P.puff || 0);

    function toSx(x) { return AX + x * facing; }
    function toSy(y) { return AY - y; }
    // put a pixel of a part: its colour from where it is on the cat and how the light falls on it
    function plot(sx, sy, where, nx, ny, nz, g, shift) {
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
      var lv = nx * facing * LX + ny * LY + nz * LZ;
      var tone = lv > 0.86 ? 4 : lv > 0.52 ? 3 : lv > 0.04 ? 2 : 1;
      tone = Math.max(1, Math.min(4, tone + (shift || 0)));
      var k = sy * W + sx;
      px[k] = pal[region(look, where)][tone];
      ord[k] = order; grp[k] = g;
    }
    // a tapered capsule from joint A to joint B; where(t, side) says where on the cat each pixel is
    function capsule(A, B, g, where, shift, fluff) {
      var ax = A[0], ay = A[1], ar = A[2], bx = B[0], by = B[1], br = B[2];
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, len = Math.sqrt(L2);
      var rmax = Math.max(ar, br) + (fluff || 0) + 1;
      var x0 = Math.floor(Math.min(toSx(ax - rmax), toSx(bx - rmax), toSx(ax + rmax), toSx(bx + rmax))), x1 = Math.ceil(Math.max(toSx(ax - rmax), toSx(bx - rmax), toSx(ax + rmax), toSx(bx + rmax)));
      var y0 = Math.floor(toSy(Math.max(ay, by) + rmax)), y1 = Math.ceil(toSy(Math.min(ay, by) - rmax));
      for (var sy = y0; sy <= y1; sy++) for (var sx = x0; sx <= x1; sx++) {
        var x = (sx + 0.5 - AX) * facing, y = AY - (sy + 0.5);
        var t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        var cx = ax + dx * t, cy = ay + dy * t, r = ar + (br - ar) * t;
        var ex = x - cx, ey = y - cy, d = Math.sqrt(ex * ex + ey * ey);
        var rr = r + (fluff ? fluff * (0.55 + 0.45 * hash(Math.round(Math.atan2(ey, ex) * 6 + t * len / 3), 7, s)) : 0);
        if (d > rr) continue;
        var q = Math.min(1, d / rr), nz = Math.sqrt(1 - q * q);
        var side = (ex * -dy + ey * dx) / len / Math.max(1, rr); // + toward the back
        plot(sx, sy, where(t, side), ex / Math.max(1, rr), ey / Math.max(1, rr), nz, g, shift);
      }
    }
    function chain(J, g, whereAt, shift, fluff) { // joints in a row; whereAt(a along the whole chain, side)
      var n = J.length - 1;
      for (var i = 0; i < n; i++) (function (i) { capsule(J[i], J[i + 1], g, function (t, side) { return whereAt((i + t) / n, side); }, shift, fluff); })(i);
    }
    function ellipse(cx, cy, rx, ry, g, where, shift, fluff) {
      var x0 = Math.floor(Math.min(toSx(cx - rx - 3), toSx(cx + rx + 3))), x1 = Math.ceil(Math.max(toSx(cx - rx - 3), toSx(cx + rx + 3)));
      var y0 = Math.floor(toSy(cy + ry + 3)), y1 = Math.ceil(toSy(cy - ry - 3));
      for (var sy = y0; sy <= y1; sy++) for (var sx = x0; sx <= x1; sx++) {
        var x = (sx + 0.5 - AX) * facing, y = AY - (sy + 0.5);
        var a = (x - cx) / rx, b = (y - cy) / ry, d = Math.sqrt(a * a + b * b);
        var lim = 1 + (fluff ? fluff / rx * (0.5 + 0.5 * hash(Math.round(Math.atan2(b, a) * 7), 3, s)) : 0);
        if (d > lim) continue;
        var q = Math.min(1, d), nz = Math.sqrt(1 - q * q);
        plot(sx, sy, where(a, b), a, b, nz, g, shift);
      }
    }
    function tri(A, B, C, g, where, colour) { // an ear: flat, lit on its left edge
      var x0 = Math.floor(Math.min(toSx(A[0]), toSx(B[0]), toSx(C[0]))) - 1, x1 = Math.ceil(Math.max(toSx(A[0]), toSx(B[0]), toSx(C[0]))) + 1;
      var y0 = Math.floor(toSy(Math.max(A[1], B[1], C[1]))) - 1, y1 = Math.ceil(toSy(Math.min(A[1], B[1], C[1]))) + 1;
      function e(p, q, x, y) { return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]); }
      for (var sy = y0; sy <= y1; sy++) for (var sx = x0; sx <= x1; sx++) {
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        var x = (sx + 0.5 - AX) * facing, y = AY - (sy + 0.5);
        var w0 = e(A, B, x, y), w1 = e(B, C, x, y), w2 = e(C, A, x, y);
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;
        var k = sy * W + sx;
        if (colour != null) { px[k] = colour; ord[k] = order; grp[k] = g; continue; }
        plot(sx, sy, where, -0.3, 0.5, 0.8, g, 0);
      }
    }

    var B = P.body, hx = P.head[0], hy = P.head[1];
    function bodyAt(a, side) { return { p: "body", a: a, b: Math.max(-1, Math.min(1, side)) }; }
    function legAt(a) { return { p: a > 0.93 ? "paw" : "leg", a: a, b: 0 }; }
    function tailAt(a) { return { p: "tail", a: a, b: 0 }; }
    function haunchAt(a, b) { return { p: "haunch", a: a, b: b }; }
    function drawLeg(L, g, shift) {
      chain(L.pts, g, legAt, shift, 0);
      order++;
      ellipse(L.paw[0], L.paw[1], 5, 3.4, g, function () { return { p: "paw", a: 1, b: 0 }; }, shift, 0);
    }
    function drawTail() { order++; chain(P.tail, 4, tailAt, 0, puff * 1.2); }

    // back to front: (tail), far legs, far haunch, body, neck, near haunch, near legs, (tail), head
    if (!P.tailFront) drawTail();
    P.legs.far.forEach(function (L) { order++; drawLeg(L, 1, -1); });
    order++; ellipse(P.haunch.far[0], P.haunch.far[1], P.haunch.far[2], P.haunch.far[2], 1, haunchAt, -1, puff);
    order++; chain(B, 2, bodyAt, 0, puff);
    order++; capsule(P.neck[0], P.neck[1], 2, function (t, side) { return { p: "neck", a: t, b: side }; }, 0, puff);
    order++; ellipse(P.haunch.near[0], P.haunch.near[1], P.haunch.near[2], P.haunch.near[2], 3, haunchAt, 0, puff);
    P.legs.near.forEach(function (L) { order++; drawLeg(L, 3, 0); });
    if (P.tailFront) drawTail();

    // the head: ears, then the head and cheeks, then the muzzle
    var fs = 2.5, tilt = P.headTilt || 0; // the face's offset toward where it's looking; a tilt down for sleep
    var flat = P.ears === "flat";
    var earL = flat ? [[-14, 3], [-4, 10], [-19, 12]] : [[-13.5, 4], [-3.5, 11], [-12, 22]];
    var earR = flat ? [[4 + fs, 10], [14 + fs, 3], [19 + fs, 12]] : [[3.5 + fs, 11], [13.5 + fs, 4], [12.5 + fs, 22]];
    function earPts(E) { return E.map(function (p) { return [hx + p[0], hy + p[1] + tilt * p[0] * 0.3]; }); }
    var inner = pack(lum(rgb((FURS[look.base] || FURS.ginger).hex)) > 0.45 || look.pattern === "van" ? [232, 158, 168] : [176, 112, 122]);
    [earL, earR].forEach(function (E) {
      var e = earPts(E);
      order++; tri(e[0], e[1], e[2], 5, { p: "ear", a: 0.5, b: 0 }, null);
      var cxm = (e[0][0] + e[1][0] + e[2][0]) / 3, cym = (e[0][1] + e[1][1] + e[2][1]) / 3;
      var sh = function (p, k) { return [cxm + (p[0] - cxm) * k, cym + (p[1] - cym) * k - 0.8]; };
      tri(sh(e[0], 0.5), sh(e[1], 0.5), sh(e[2], 0.62), 5, null, inner);
    });
    order++;
    var hr = look.fluffy ? 1.5 : 0;
    ellipse(hx, hy, 15 + hr, 13.5 + hr * 0.5, 6, function (a, b) { return { p: "head", a: a - fs / 15, b: b }; }, 0, look.fluffy ? 1.5 : 0);
    ellipse(hx + fs * 0.4, hy - 3.5, 16 + hr, 9.5, 6, function (a, b) { return { p: "head", a: a * 1.05 - fs / 16, b: -0.15 + b * 0.55 }; }, 0, look.fluffy ? 2.4 : 0.8);
    var mx = hx + fs, my = hy - 5.5 + tilt * 2;
    order++;
    ellipse(mx - 2.9, my, 3.8, 3.1, 6, function () { return { p: "muzzle", a: 0, b: 0 }; }, 0, 0);
    ellipse(mx + 2.9, my, 3.8, 3.1, 6, function () { return { p: "muzzle", a: 0, b: 0 }; }, 0, 0);

    // outlines: a dark edge round the cat (its own fur's darkest tone), and a line where a part in front meets one behind
    var solid = new Uint8Array(W * H);
    for (var q0 = 0; q0 < W * H; q0++) solid[q0] = px[q0] ? 1 : 0;
    var out = new Uint32Array(px);
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
      var k = y * W + x;
      if (!px[k]) {
        var nb = px[k - 1] || px[k + 1] || px[k - W] || px[k + W];
        if (nb) out[k] = shadeU(nb, 0.38);
        continue;
      }
      var o = ord[k], g = grp[k];
      var front = [k - 1, k + 1, k - W, k + W].some(function (j) { return px[j] && grp[j] !== g && ord[j] > o && !(g === 2 && grp[j] === 2); });
      if (front && g !== 6) out[k] = shadeU(px[k], 0.62);
    }
    px = out;

    // the face, pixel by pixel: eyes, nose, mouth, whiskers
    function set(x, y, c) { var sx = Math.round(toSx(x)), sy = Math.round(toSy(y)); if (sx >= 0 && sy >= 0 && sx < W && sy < H) px[sy * W + sx] = c; }
    function setS(sx, sy, c) { if (sx >= 0 && sy >= 0 && sx < W && sy < H) px[sy * W + sx] = c; }
    var faceDeep = pal[region(look, { p: "head", a: 0, b: 0.1 })][0];
    var eyeY = hy + 1.5 + tilt * 2;
    var blink = P.eyes === "closed" || P.eyes === "half" ? P.eyes : frac((t || 0) / 4.3 + s * 0.37) < 0.035 ? "closed" : P.eyes || "open";
    [-1, 1].forEach(function (side) {
      var ex = Math.round(toSx(hx + fs + side * 6)), ey = Math.round(toSy(eyeY)) - 2;
      var eyeHex = look.eyes === "odd" ? (side * facing < 0 ? EYES.blue.hex : EYES.gold.hex) : (EYES[look.eyes] || EYES.green).hex;
      if (look.pattern === "colorpoint" && look.eyes == null) eyeHex = EYES.blue.hex;
      var ec = rgb(eyeHex), eye = pack(ec), lid = pack(lerp(ec, [10, 10, 10], 0.45)), lash = lum(rgb((FURS[look.base] || FURS.ginger).hex)) < 0.25 ? pack([90, 90, 100]) : faceDeep;
      if (blink === "closed") {
        [[-2, 2], [-1, 3], [0, 3], [1, 3], [2, 2]].forEach(function (p) { setS(ex + p[0], ey + p[1], lash); });
        return;
      }
      // big round eyes, 5 across and 6 down: a darker lid row, a slit pupil (round when wide awake), a glint
      var rows = blink === "half" ? [[-2, 2], [-2, 2], [-1, 1]] : [[-1, 1], [-2, 2], [-2, 2], [-2, 2], [-2, 2], [-1, 1]];
      var top = blink === "half" ? 2 : -1;
      rows.forEach(function (r, j) { for (var i = r[0]; i <= r[1]; i++) setS(ex + i, ey + top + j, j === 0 ? (blink === "half" ? lash : lid) : eye); });
      var wide = blink === "wide";
      for (var j2 = 1; j2 < rows.length - 1; j2++) { setS(ex, ey + top + j2, 0xff0c0c0c); if (wide && j2 > 1 && j2 < rows.length - 2) { setS(ex - 1, ey + top + j2, 0xff0c0c0c); setS(ex + 1, ey + top + j2, 0xff0c0c0c); } }
      if (blink !== "half") { setS(ex - facing, ey + top + 1, 0xffffffff); setS(ex - facing, ey + top + 2, 0xffffffff); }
    });
    var nx0 = Math.round(toSx(mx)), ny0 = Math.round(toSy(my + 2.2));
    var nose = lum(rgb((FURS[look.base] || FURS.ginger).hex)) > 0.3 || look.pattern === "tuxedo" || look.pattern === "bicolor" ? pack([224, 128, 140]) : pack([150, 88, 98]);
    setS(nx0 - 1, ny0, nose); setS(nx0, ny0, nose); setS(nx0 + 1, ny0, nose); setS(nx0, ny0 + 1, nose);
    var mouthC = pal[region(look, { p: "muzzle", a: 0, b: 0 })][0];
    if (P.mouth === "open") {
      for (var mx2 = -2; mx2 <= 2; mx2++) for (var my2 = 2; my2 <= 4; my2++) setS(nx0 + mx2, ny0 + my2, 0xff241418);
      setS(nx0, ny0 + 4, pack([214, 106, 120])); setS(nx0 - 1, ny0 + 2, 0xffffffff); setS(nx0 + 1, ny0 + 2, 0xffffffff);
    } else {
      setS(nx0, ny0 + 2, mouthC); setS(nx0 - 1, ny0 + 3, mouthC); setS(nx0 + 1, ny0 + 3, mouthC);
      if (P.tongue) setS(nx0, ny0 + 3, pack([224, 120, 134]));
    }
    // whiskers: three a side, fanning out from the muzzle
    var wc = pack([236, 233, 226]);
    [-1, 1].forEach(function (side) {
      [-0.28, 0, 0.26].forEach(function (ang, i) {
        var x = mx + side * 5.5, y = my - 0.5 + i * -1.2 + 1.2;
        for (var st = 0; st < 15; st++) {
          var xx = x + side * Math.cos(ang) * st, yy = y + Math.sin(ang) * st * (side > 0 ? 1 : 1) - st * st * 0.012;
          var sx = Math.round(toSx(xx)), sy = Math.round(toSy(yy));
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
          if (st > 2 && !solid[sy * W + sx]) px[sy * W + sx] = wc; // only off the face: across the outline and out
        }
      });
    });
    // where the head and neck are in the picture (hats, collars and the Halloween costumes go there; room.js)
    return { w: W, h: H, px: px, ax: AX, ay: AY, facing: facing,
      head: { x: toSx(hx), y: toSy(hy), top: toSy(hy + 13.5 + hr), r: 15 + hr },
      neck: { x: toSx(P.neck[1][0]), y: toSy(P.neck[1][1]) } };
  }

  // a random look (the Maker's Surprise me, and seeds for patches)
  function randomLook() {
    var pats = Object.keys(PATTERNS), furs = Object.keys(FURS), eyes = Object.keys(EYES);
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    var pattern = pick(pats), base = pick(furs), second = pick(furs);
    if (pattern === "calico") { base = pick(["ginger", "cream", "red", "fawn"]); second = pick(["black", "charcoal", "blue", "brown"]); }
    if (pattern === "tortie") { base = pick(["black", "chocolate", "blue", "charcoal"]); second = pick(["ginger", "red", "cream", "cinnamon"]); }
    if (pattern === "colorpoint") { base = pick(["cream", "white", "fawn", "silver"]); second = pick(["chocolate", "brown", "blue", "lilac", "red"]); }
    if (pattern === "tuxedo") base = pick(["black", "charcoal", "blue", "brown", "ginger"]);
    if (pattern === "tabby") { base = pick(["ginger", "brown", "silver", "cream", "blue", "fawn"]); second = { ginger: "red", brown: "chocolate", silver: "charcoal", cream: "ginger", blue: "charcoal", fawn: "cinnamon" }[base]; }
    if (base === second) second = base === "black" ? "white" : "black";
    return { pattern: pattern, base: base, second: second, eyes: pattern === "colorpoint" ? "blue" : pick(eyes), fluffy: Math.random() < 0.3, seed: 1 + Math.floor(Math.random() * 9999) };
  }

  // the look in words: "Ginger tabby, green eyes"
  function describe(look) {
    var p = PATTERNS[look.pattern] || PATTERNS.solid, b = (FURS[look.base] || {}).name || "", s2 = (FURS[look.second] || {}).name || "";
    var main = look.pattern === "solid" ? b : look.pattern === "calico" ? "Calico (" + b.toLowerCase() + " and " + s2.toLowerCase() + ")"
      : look.pattern === "tortie" ? "Tortoiseshell (" + b.toLowerCase() + " and " + s2.toLowerCase() + ")"
      : look.pattern === "colorpoint" ? b + " with " + s2.toLowerCase() + " points"
      : b + " " + p.name.toLowerCase();
    return main + (look.fluffy ? ", fluffy" : "") + ", " + ((EYES[look.eyes] || EYES.green).name || "").toLowerCase() + " eyes";
  }

  window.CatDraw = { FURS: FURS, EYES: EYES, PATTERNS: PATTERNS, POSES: Object.keys(POSES), render: render, randomLook: randomLook, describe: describe, tones: tones };
})();
