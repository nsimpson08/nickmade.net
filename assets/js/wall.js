// Movies and Games: "Poster wall". A button at the start of the section links opens every poster on the page edge to
// edge in a slowly drifting mosaic: columns scroll endlessly, alternating up and down, at slightly different speeds,
// tilted a little. No text until you hover a poster (title, year, section, rating); hovering a column pauses it.
// Clicking a poster closes the wall and scrolls to it on the page. Esc or × closes. The order is shuffled each time.
// Posters are read from the page when the wall opens, so it includes the live sections (Recently Watched, queue, ...).
// With reduced motion it's a still, scrollable grid.
//
// Background mode (trial, 2026-10-02): with data-background="0.25" on the script tag, the same wall also runs behind
// the whole page, dimmed to that brightness (0-1), with no hover, captions or clicks. Delete the attribute to turn it off.
(function () {
  var script = document.currentScript;
  var root = document.getElementById("entries");
  if (!root) return;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var NAME = document.body.classList.contains("page-games") ? "Games" : "Movies";
  var ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="4" height="6" rx="1"/><rect x="6" y="1" width="4" height="9" rx="1"/>' +
    '<rect x="11" y="1" width="4" height="5" rx="1"/><rect x="1" y="8" width="4" height="7" rx="1"/><rect x="6" y="11" width="4" height="4" rx="1"/><rect x="11" y="7" width="4" height="8" rx="1"/></svg>';
  var SPEED = [16, 22]; // px per second, a random speed in this range for each column

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function text(el) { return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }

  // ---------- the button (first in the section links, in its own group so the divider follows it; reviews.js
  // builds the links and runs before this) ----------
  var open = document.createElement("button");
  open.type = "button";
  open.className = "wall-open";
  open.innerHTML = ICON + "<span>Poster wall</span>";
  var nav = root.querySelector(".jump");
  if (nav) {
    var group = document.createElement("span");
    group.className = "jump-group";
    group.appendChild(open);
    nav.insertBefore(group, nav.firstChild);
  } else root.insertBefore(open, root.firstChild);
  open.addEventListener("click", show);

  // ---------- what's on the page ----------
  function collect() {
    var seen = {}, out = [];
    [].forEach.call(root.querySelectorAll("section.subsection"), function (sec) {
      var section = text(sec.querySelector(".subhead span"));
      [].forEach.call(sec.querySelectorAll(".poster"), function (fig) {
        var img = fig.querySelector(".art img");
        if (!img || fig.closest("[hidden]")) return; // no art, or hidden (a played queue game, a removed favorite)
        var host = fig.closest(".entry") || fig; // review layout: the poster sits in an .entry with the title in h3
        var title = text(fig.querySelector(".title")) || text(host.querySelector("h3")) || host.dataset.title || "";
        var k = title.toLowerCase();
        if (!title || seen[k]) return; // the same title in two sections shows once
        seen[k] = true;
        var stars = fig.querySelector(".rating");
        var score = host.querySelector(".score");
        out.push({
          src: img.currentSrc || img.src,
          title: title,
          year: text(fig.querySelector(".year")) || (text(host.querySelector(".meta")).match(/^\d{4}/) || [""])[0],
          section: section,
          rating: stars ? stars.outerHTML : score ? '<span class="score">' + esc(text(score)) + "</span>" : "",
          el: host,
        });
      });
    });
    return out;
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ---------- the wall ----------
  var wall = null, items = [];

  function tile(p, i, copy, bg) {
    var img = '<img src="' + esc(p.src) + '" alt="" decoding="async" onload="this.classList.add(\'in\')" onerror="this.classList.add(\'in\')">';
    if (bg) return '<div class="wall-tile">' + img + "</div>"; // background: just the poster
    return '<button type="button" class="wall-tile" data-i="' + i + '"' + (copy ? ' tabindex="-1" aria-hidden="true"' : "") +
      ' aria-label="' + esc(p.title + (p.year ? " (" + p.year + ")" : "") + (p.section ? ", " + p.section : "")) + '">' +
      img +
      '<span class="wall-cap"><b>' + esc(p.title) + "</b>" +
        '<span class="wall-meta">' + esc([p.year, p.section].filter(Boolean).join(" · ")) + "</span>" +
        (p.rating ? '<span class="wall-rating">' + p.rating + "</span>" : "") +
      "</span></button>";
  }

  // Fill a wall element's .wall-cols with columns of these posters (bg: plain tiles for the background)
  function build(el, items, bg) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var cols = Math.max(3, Math.min(10, Math.round(vw / 190)));
    if (!still) cols += 1; // the tilt needs an extra column to cover the corners
    var colW = (vw * (still ? 1 : 1.2)) / cols;
    var tileH = colW * 1.5;
    var html = "";
    for (var c = 0; c < cols; c++) {
      // this column's posters: every cols-th one, starting at c, so each poster is in one column only
      // (with fewer posters than columns, columns start over from the top of the list)
      var list = [];
      for (var n = c; n < items.length; n += cols) list.push(n);
      if (!list.length) list.push(c % items.length);
      if (still) {
        html += '<div class="wall-col">' + list.map(function (i) { return tile(items[i], i, false, bg); }).join("") + "</div>";
        continue;
      }
      // repeat until the column is taller than the screen (with the tilt), then twice over for a seamless loop
      var loop = list.slice();
      while (loop.length * tileH < vh * 1.4) loop = loop.concat(list);
      var speed = SPEED[0] + Math.random() * (SPEED[1] - SPEED[0]);
      var secs = Math.round((loop.length * tileH) / speed);
      html += '<div class="wall-col"><div class="wall-track' + (c % 2 ? " up" : "") + '" style="animation-duration:' + secs + "s;animation-delay:-" +
        Math.round(Math.random() * secs) + 's">' +
        loop.map(function (i, k) { return tile(items[i], i, k >= list.length, bg); }).join("") +
        loop.map(function (i) { return tile(items[i], i, true, bg); }).join("") +
        "</div></div>";
    }
    el.querySelector(".wall-cols").innerHTML = html;
    el.querySelector(".wall-cols").style.setProperty("--cols", cols);
  }

  function show() {
    items = shuffle(collect());
    if (!items.length) return;
    wall = document.createElement("div");
    wall.className = "wall" + (still ? " still" : "");
    wall.setAttribute("role", "dialog");
    wall.setAttribute("aria-modal", "true");
    wall.setAttribute("aria-label", NAME + " poster wall");
    wall.innerHTML = '<div class="wall-cols"></div>' +
      '<div class="wall-bar"><span class="wall-name">' + ICON + NAME + ' <small>' + items.length + " posters</small></span>" +
      '<button type="button" class="wall-close" aria-label="Close the poster wall">×</button></div>';
    document.body.appendChild(wall);
    build(wall, items);
    document.documentElement.classList.add("wall-on"); // stops the page scrolling underneath
    requestAnimationFrame(function () { wall.classList.add("in"); });
    wall.querySelector(".wall-close").focus();
    wall.addEventListener("click", function (e) {
      if (e.target.closest(".wall-close")) return hide();
      var t = e.target.closest(".wall-tile");
      if (t) goTo(items[+t.dataset.i]);
    });
    document.addEventListener("keydown", onKey);
  }

  function hide(then) {
    if (!wall) return;
    var w = wall;
    wall = null;
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("wall-on");
    w.classList.remove("in");
    setTimeout(function () { w.remove(); }, 300);
    if (typeof then === "function") then();
    else open.focus({ preventScroll: true }); // back to the button (Safari doesn't focus buttons on click)
  }

  // Close the wall and bring that poster into view on the page, with a brief glow
  function goTo(p) {
    hide(function () {
      p.el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
      p.el.classList.remove("wall-found");
      void p.el.offsetWidth;
      p.el.classList.add("wall-found");
      setTimeout(function () { p.el.classList.remove("wall-found"); }, 2400);
    });
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); hide(); return; }
    if (e.key !== "Tab" || !wall) return;
    // keep Tab inside the wall
    var f = wall.querySelectorAll('button:not([tabindex="-1"])');
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  var resizeTimer = null;
  window.addEventListener("resize", onResize); // rebuilds the open wall and the background for the new size
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (wall) build(wall, items);
      if (bgWall) build(bgWall, bgItems, true);
    }, 200);
  }

  // ---------- background mode (data-background on the script tag) ----------
  // Waits until the live sections have filled in (the page stops changing for a moment, or 3s at most), then builds
  // the wall behind everything and fades it in.
  var bgWall = null, bgItems = [];
  var dim = parseFloat(script && script.dataset.background);
  if (dim >= 0 && dim <= 1) {
    var settle = null, started = Date.now();
    var watch = new MutationObserver(function () { clearTimeout(settle); settle = setTimeout(startBg, Date.now() - started > 3000 ? 0 : 700); });
    watch.observe(root, { childList: true, subtree: true });
    settle = setTimeout(startBg, 700);
  }
  function startBg() {
    if (bgWall) return;
    watch.disconnect();
    bgItems = shuffle(collect());
    if (!bgItems.length) return;
    bgWall = document.createElement("div");
    bgWall.className = "wall wall-bg" + (still ? " still" : "");
    bgWall.setAttribute("aria-hidden", "true");
    bgWall.style.setProperty("--wall-shade", String(1 - dim));
    bgWall.innerHTML = '<div class="wall-cols"></div>';
    document.body.insertBefore(bgWall, document.body.firstChild);
    build(bgWall, bgItems, true);
    requestAnimationFrame(function () { bgWall.classList.add("in"); });
  }
})();
