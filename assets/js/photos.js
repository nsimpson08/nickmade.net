// Photography page: renders window.PHOTOS in the sections from PHOTO_CONFIG.sections (Film, Pixel, Cats...),
// the 1/2/4 column toggle, and the full-resolution lightbox. (The framed "Featured" photo above them was removed in 1.3.)
// The toggle's 4th option is a slideshow (see "Slideshow" below): one big photo and a strip of thumbnails instead of
// the long page.
(function () {
  var all = window.PHOTOS || [];
  var config = window.PHOTO_CONFIG || {};
  var root = document.getElementById("photos");
  var sections = (config.sections || []).map(function (s) {
    return { id: s.folder, title: s.title, photos: all.filter(function (p) { return p.section === s.folder; }) };
  }).filter(function (s) { return s.photos.length; });
  // each section's photos in page order; this is also the lightbox's and the slideshow's order
  var photos = [];
  sections.forEach(function (s) { photos = photos.concat(s.photos); });

  // Instagram link
  if (config.instagram) {
    var ig = document.getElementById("instagram");
    var handle = String(config.instagram).replace(/^@/, "");
    ig.href = "https://www.instagram.com/" + encodeURIComponent(handle) + "/";
    ig.querySelector("span").textContent = "@" + handle;
    ig.hidden = false;
  }

  if (!photos.length) {
    root.innerHTML = '<p class="empty content">Photos coming soon.</p>';
    document.querySelector(".layout-toggle").hidden = true;
    return;
  }

  function mb(bytes) { return (bytes / 1e6).toFixed(1) + " MB"; }

  // How wide each photo is on screen, so the browser picks the right file from srcset
  function sizesFor(cols) {
    if (cols === 4) return "(max-width: 900px) 50vw, 25vw";
    if (cols === 2) return "(max-width: 560px) 100vw, 50vw";
    return "100vw";
  }

  function photoLink(p, i) {
    var srcset = p.sizes.map(function (s) { return s.src + " " + s.w + "w"; })
      .concat([p.src + " " + p.w + "w"]).join(", ");
    return '<a class="photo" href="' + p.src + '" data-index="' + i + '">' +
      '<img src="' + (p.sizes.length ? p.sizes[0].src : p.src) + '" srcset="' + srcset + '" sizes="100vw"' +
      ' width="' + p.w + '" height="' + p.h + '" alt="Photo ' + (i + 1) + '"' +
      (i > 1 ? ' loading="lazy"' : "") + ' decoding="async"></a>';
  }

  // A row with the jump links (when there's more than one section) and the column toggle, then a header and
  // grid per section
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var n = 0;
  root.innerHTML = '<div class="photo-bar">' + (sections.length > 1
    ? '<div class="bar-group"><span class="bar-label" aria-hidden="true">Category</span>' +
      '<nav class="jump photo-jump" aria-label="Sections">' + sections.map(function (s) {
        return '<a href="#' + esc(s.id) + '">' + esc(s.title) + "</a>";
      }).join("") + "</nav></div>"
    : "") + '<div class="bar-group"><span class="bar-label" aria-hidden="true">Layout</span></div></div>' +
    sections.map(function (s) {
      return '<section class="photo-section" id="' + esc(s.id) + '">' +
        '<h2 class="subhead"><span>' + esc(s.title) + "</span></h2>" +
        '<div class="photos">' + s.photos.map(function (p) { return photoLink(p, n++); }).join("") + "</div>" +
        "</section>";
    }).join("");
  // the column toggle moves from the page header into that row, beside the section links, under its "Layout" label
  root.querySelector(".photo-bar .bar-group:last-child").appendChild(document.querySelector(".photo-controls .layout-toggle"));

  // Pinned control bar, bottom right, once you've scrolled down: a link per section (the one you're in is lit),
  // the 1/2/4 column toggle (kept in sync with the one at the top), and the jump button. It rests collapsed to
  // just the arrow and opens while hovered (or focused, or after a tap on touch screens), folding back up
  // a few seconds after you leave it. Inside a section the jump button first goes to that section's top
  // ("Top of Pixel"); from there (or above the sections) it goes to the top of the page ("Jump to top").
  var dock = document.createElement("div");
  dock.className = "photo-dock";
  dock.setAttribute("role", "toolbar");
  dock.setAttribute("aria-label", "Photo controls");
  dock.innerHTML =
    '<div class="dock-more">' +
      (sections.length > 1
        ? '<nav class="dock-sections" aria-label="Sections">' + sections.map(function (s) {
            return '<a href="#' + esc(s.id) + '">' + esc(s.title) + "</a>";
          }).join("") + "</nav>"
        : "") +
      '<div class="layout-toggle" role="group" aria-label="Columns">' + [1, 2, 4].map(function (c) {
        return '<button type="button" data-cols="' + c + '" aria-label="' + c + (c === 1 ? " column" : " columns") + '">' +
          new Array(c + 1).join("<i></i>") + "</button>";
      }).join("") +
      '<button type="button" data-cols="show" aria-label="Slideshow"><i></i><b><i></i><i></i><i></i></b></button>' + "</div>" +
    "</div>" +
    '<button type="button" class="to-top"><span aria-hidden="true">&uarr;</span><b></b></button>';
  document.body.appendChild(dock);
  var toTop = dock.querySelector(".to-top");
  var toTopLabel = toTop.querySelector("b");
  var dockLinks = [].slice.call(dock.querySelectorAll(".dock-sections a"));
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sectionEls = [].slice.call(root.querySelectorAll(".photo-section"));
  var target = null; // the section the jump button goes to next, or null for the page top

  // where a section's top lands when scrolled to (its scroll-margin-top leaves a little room above the header)
  function sectionTop(el) {
    return el.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
  }
  function scrollToY(y) { window.scrollTo({ top: y, behavior: reduceMotion ? "auto" : "smooth" }); }
  toTop.addEventListener("click", function () { scrollToY(target ? sectionTop(target) : 0); });
  dockLinks.forEach(function (a, i) {
    a.addEventListener("click", function (e) { e.preventDefault(); scrollToY(sectionTop(sectionEls[i])); });
  });
  function updateDock() {
    var y = window.scrollY;
    var current = null;
    sectionEls.forEach(function (el) { if (sectionTop(el) <= y + 2) current = el; });
    // already at (or just above) the section's top: the next click goes to the page top
    target = current && y > sectionTop(current) + 4 ? current : null;
    toTopLabel.textContent = target ? "Top of " + target.querySelector(".subhead span").textContent : "Jump to top";
    toTop.setAttribute("aria-label", toTopLabel.textContent); // phones show only the arrow
    dockLinks.forEach(function (a, i) {
      if (sectionEls[i] === current) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
    var show = y > 400;
    dock.classList.toggle("show", show);
    if (!show) dock.classList.remove("open");
    dock.inert = !show; // not reachable by Tab while hidden
    dock.setAttribute("aria-hidden", String(!show));
  }
  window.addEventListener("scroll", updateDock, { passive: true });
  window.addEventListener("resize", updateDock);

  // Collapsed <-> open
  var COLLAPSE_AFTER = 3000;
  var collapseTimer = null;
  function openDock() { clearTimeout(collapseTimer); dock.classList.add("open"); }
  function collapseSoon() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(function () {
      if (dock.matches(":hover") || dock.contains(document.activeElement)) return collapseSoon();
      dock.classList.remove("open");
    }, COLLAPSE_AFTER);
  }
  dock.addEventListener("mouseenter", openDock);
  dock.addEventListener("mousemove", function () { if (!dock.classList.contains("open")) openDock(); });
  dock.addEventListener("mouseleave", collapseSoon);
  // Scrolling the page folds it right away, except scrolling the dock itself caused (a section jump's smooth
  // scroll, or the page shifting after a column change): that's ignored until it settles
  var ownScroll = false, ownScrollTimer = null;
  dock.addEventListener("click", function () {
    ownScroll = true;
    clearTimeout(ownScrollTimer);
    ownScrollTimer = setTimeout(function () { ownScroll = false; }, 300); // nothing scrolled after the click
  });
  window.addEventListener("scroll", function () {
    if (ownScroll) {
      clearTimeout(ownScrollTimer);
      ownScrollTimer = setTimeout(function () { ownScroll = false; }, 150); // still moving; wait for it to stop
      return;
    }
    if (dock.classList.contains("open")) { clearTimeout(collapseTimer); dock.classList.remove("open"); }
  }, { passive: true });
  dock.addEventListener("focusin", openDock);
  dock.addEventListener("focusout", function () { setTimeout(function () { if (!dock.contains(document.activeElement)) collapseSoon(); }, 0); });
  // Touch: the first tap only opens it (no jump); taps while open work and restart the countdown
  var touched = false;
  dock.addEventListener("pointerdown", function (e) { touched = e.pointerType === "touch" || e.pointerType === "pen"; });
  dock.addEventListener("click", function (e) {
    if (!touched) return;
    if (!dock.classList.contains("open")) { e.preventDefault(); e.stopPropagation(); }
    openDock();
    collapseSoon();
  }, true);
  updateDock();

  // Column toggle (the one at the top and the dock's): 1, 2, 4, or "show" (the slideshow, the default since 1.3).
  // Saved only when a visitor clicks one (localStorage nm-photo-layout), so everyone else gets the default. (The old
  // key, nm-photo-cols, was written on every visit, so it can't tell a choice from the old default; it's ignored.)
  var buttons = document.querySelectorAll(".layout-toggle button");
  function setCols(cols, chosen) {
    var slides = cols === "show";
    document.documentElement.classList.toggle("photo-slides", slides);
    if (slides) slideshow();
    else {
      root.querySelectorAll(".photos").forEach(function (g) { g.setAttribute("data-cols", cols); });
      root.querySelectorAll(".photos img").forEach(function (img) { img.sizes = sizesFor(cols); });
    }
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.cols === String(cols))); });
    if (chosen) try { localStorage.setItem("nm-photo-layout", cols); } catch (e) {}
    updateDock();
  }
  function colsOf(v) { return v === "show" ? "show" : [1, 2, 4].indexOf(+v) >= 0 ? +v : DEFAULT_COLS; }
  var DEFAULT_COLS = "show"; // the slideshow, until a visitor picks their own
  var saved = DEFAULT_COLS;
  try { saved = localStorage.getItem("nm-photo-layout") || DEFAULT_COLS; } catch (e) {}
  buttons.forEach(function (b) {
    b.addEventListener("click", function () { setCols(colsOf(b.dataset.cols), true); });
  });

  // ---------- Slideshow (the toggle's 4th option) ----------
  // The long section grids give way to one viewer about a screen tall: the photo on the left
  // (75% of the width) and a narrow column of small square thumbnails on the right, grouped by section, scrolling on
  // its own. Arrows, the arrow keys, and swipes step through every photo (the lightbox's order); clicking the photo
  // opens it full resolution in the lightbox; the Film / Pixel / Cats links jump to that section's first photo.
  // Phones: the photo on top, the thumbnails in a strip below that scrolls sideways.
  var ss = null, ssAt = 0;
  var titleOf = {};
  sections.forEach(function (s) { titleOf[s.id] = s.title; });
  function thumbOf(p) { // tools/thumbs.py's 400px copy of the 800px size
    var small = p.sizes.length ? p.sizes[0].src : p.src;
    return small.replace(/^sizes\/(.+)-\d+\.jpg$/, "thumbs/$1.webp");
  }
  function slideshow() {
    if (ss) return slideTo(ssAt);
    ss = document.createElement("div");
    ss.className = "slideshow";
    var groups = [];
    var k = 0;
    sections.forEach(function (s) {
      groups.push({ title: s.title, id: s.id, idx: s.photos.map(function () { return k++; }) });
    });
    // An SVG arrow (pointing right; flipped for Previous in site.css): a text arrow sat off center in the circle
    var SS_ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    ss.innerHTML =
      '<div class="ss-stage">' +
        '<a class="ss-main" href="#"><img alt="" sizes="(max-width: 760px) 100vw, 75vw"></a>' +
        '<button type="button" class="ss-prev" aria-label="Previous photo">' + SS_ARROW + "</button>" +
        '<button type="button" class="ss-next" aria-label="Next photo">' + SS_ARROW + "</button>" +
        '<div class="ss-bar"><span class="ss-where"></span><a class="ss-full" target="_blank" rel="noopener"></a></div>' +
      "</div>" +
      '<div class="ss-thumbs" aria-label="All photos">' + groups.map(function (g) {
        return '<div class="ss-group"' + (g.id ? ' data-section="' + esc(g.id) + '"' : "") + '><p class="ss-sec">' + esc(g.title) + "</p>" +
          '<div class="ss-grid">' + g.idx.map(function (i) {
            var p = photos[i];
            return '<button type="button" class="ss-thumb" data-index="' + i + '" aria-label="Photo ' + (i + 1) + '">' +
              '<img src="' + esc(thumbOf(p)) + '" alt="" loading="lazy" decoding="async"' +
              ' onerror="if (!this.dataset.f) { this.dataset.f = 1; this.src = \'' + esc(p.sizes.length ? p.sizes[0].src : p.src) + '\'; }"></button>';
          }).join("") + "</div></div>";
      }).join("") + "</div>";
    root.querySelector(".photo-bar").after(ss);
    ss.querySelector(".ss-prev").addEventListener("click", function () { slideTo(ssAt - 1); });
    ss.querySelector(".ss-next").addEventListener("click", function () { slideTo(ssAt + 1); });
    ss.querySelector(".ss-main").addEventListener("click", function (e) { e.preventDefault(); open(ssAt); });
    ss.querySelector(".ss-thumbs").addEventListener("click", function (e) {
      var t = e.target.closest(".ss-thumb");
      if (t) slideTo(+t.dataset.index);
    });
    // swipe on touch screens
    var x0 = null;
    var stage = ss.querySelector(".ss-stage");
    stage.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) slideTo(ssAt + (dx < 0 ? 1 : -1));
    });
    slideTo(ssAt);
  }
  function srcsetOf(p) {
    return p.sizes.map(function (s) { return s.src + " " + s.w + "w"; }).concat([p.src + " " + p.w + "w"]).join(", ");
  }
  function slideTo(i) {
    if (!ss) return;
    ssAt = (i + photos.length) % photos.length;
    var p = photos[ssAt];
    var img = ss.querySelector(".ss-main img");
    img.classList.add("loading");
    img.onload = function () { img.classList.remove("loading"); };
    img.srcset = srcsetOf(p);
    img.src = p.sizes.length ? p.sizes[p.sizes.length > 1 ? 1 : 0].src : p.src;
    img.alt = "Photo " + (ssAt + 1);
    if (img.complete) img.classList.remove("loading");
    ss.querySelector(".ss-main").href = p.src;
    ss.querySelector(".ss-where").textContent = (titleOf[p.section] || "") + " · " + (ssAt + 1) + " / " + photos.length;
    var full = ss.querySelector(".ss-full");
    full.href = p.src;
    full.textContent = "Full resolution · " + p.w + " × " + p.h + " · " + mb(p.bytes);
    // the thumbnail: lit, and scrolled to the middle of its strip (without moving the page)
    var strip = ss.querySelector(".ss-thumbs");
    ss.querySelectorAll(".ss-thumb").forEach(function (t) {
      var on = +t.dataset.index === ssAt;
      t.classList.toggle("on", on);
      if (on) {
        t.setAttribute("aria-current", "true");
        var st = t.getBoundingClientRect(), sr = strip.getBoundingClientRect();
        strip.scrollTo({
          top: strip.scrollTop + st.top - sr.top - (strip.clientHeight - st.height) / 2,
          left: strip.scrollLeft + st.left - sr.left - (strip.clientWidth - st.width) / 2,
          behavior: reduceMotion ? "auto" : "smooth",
        });
      } else t.removeAttribute("aria-current");
    });
    // the next and previous ones, ready to show
    [ssAt + 1, ssAt - 1].forEach(function (j) {
      var q = photos[(j + photos.length) % photos.length];
      if (q.sizes.length > 1) { var pre = new Image(); pre.src = q.sizes[1].src; }
    });
  }
  // the section links (top and dock) go to that section's first photo in the slideshow
  document.addEventListener("click", function (e) {
    var a = e.target.closest(".photo-jump a, .dock-sections a");
    if (!a || !ss || !document.documentElement.classList.contains("photo-slides")) return;
    var g = ss.querySelector('.ss-group[data-section="' + a.getAttribute("href").slice(1) + '"] .ss-thumb');
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    slideTo(+g.dataset.index);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (!ss || !box.hidden || !document.documentElement.classList.contains("photo-slides")) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); slideTo(ssAt - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); slideTo(ssAt + 1); }
  });
  // for the poster wall (wall.js): in the slideshow, a photo on the wall opens in it instead of scrolling the page
  window.NMPhotos = {
    slides: function () { return !!ss && document.documentElement.classList.contains("photo-slides"); },
    slideTo: function (i) { slideTo(i); ss.scrollIntoView({ block: "nearest" }); },
  };

  // Lightbox with the full-resolution file
  var box = document.getElementById("lightbox");
  var big = box.querySelector("img");
  var download = box.querySelector(".lightbox-download");
  var count = box.querySelector(".lightbox-count");
  var current = 0;

  function show(i) {
    current = (i + photos.length) % photos.length;
    var p = photos[current];
    big.classList.add("loading");
    big.removeAttribute("src");
    // show the largest already-downloaded size first, then swap to full resolution
    var preview = p.sizes.length ? p.sizes[p.sizes.length - 1].src : p.src;
    big.src = preview;
    var full = new Image();
    full.onload = function () {
      if (photos[current] === p) { big.src = p.src; big.classList.remove("loading"); }
    };
    full.src = p.src;
    download.href = p.src;
    download.textContent = "Full resolution · " + p.w + " × " + p.h + " · " + mb(p.bytes);
    count.textContent = (current + 1) + " / " + photos.length;
  }
  function open(i) {
    show(i);
    box.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function close() {
    box.hidden = true;
    document.body.style.overflow = "";
  }

  root.addEventListener("click", function (e) {
    var a = e.target.closest(".photo");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    open(+a.dataset.index);
  });
  box.querySelector(".lightbox-close").addEventListener("click", close);
  box.querySelector(".lightbox-prev").addEventListener("click", function () { show(current - 1); });
  box.querySelector(".lightbox-next").addEventListener("click", function () { show(current + 1); });
  box.addEventListener("click", function (e) { if (e.target === box) close(); });
  setCols(colsOf(saved)); // last, once the lightbox it uses is set up

  document.addEventListener("keydown", function (e) {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") show(current - 1);
    else if (e.key === "ArrowRight") show(current + 1);
  });
})();
