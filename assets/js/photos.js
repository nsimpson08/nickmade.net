// Photography page: renders window.PHOTOS in the sections from PHOTO_CONFIG.sections (Film, Pixel, Cats...),
// the 1/2/4 column toggle, and the full-resolution lightbox. The newest photo overall is featured above them.
(function () {
  var all = window.PHOTOS || [];
  var config = window.PHOTO_CONFIG || {};
  var root = document.getElementById("photos");
  var sections = (config.sections || []).map(function (s) {
    return { id: s.folder, title: s.title, photos: all.filter(function (p) { return p.section === s.folder; }) };
  }).filter(function (s) { return s.photos.length; });
  // featured first, then each section's photos in page order; this is also the lightbox's order
  // config.featured names a photo by its original's file name (matched the way tools/photos.py names the copies)
  var want = String(config.featured || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  var featuredPhoto = (want && all.filter(function (p) { return /([^/]+)\.jpg$/.exec(p.src)[1] === want; })[0]) || all[0];
  var photos = featuredPhoto ? [featuredPhoto] : [];
  sections.forEach(function (s) {
    s.photos.forEach(function (p) { if (p !== featuredPhoto) photos.push(p); });
  });

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

  // The first photo sits above the grid in a gilded frame with a "Featured" plaque
  var featured = document.createElement("div");
  featured.className = "featured";
  featured.innerHTML = '<div class="frame"><div class="mat">' + photoLink(photos[0], 0) +
    '<span class="plaque">Featured</span></div></div>';
  featured.querySelector("img").sizes = "(max-width: 900px) 100vw, 900px";
  root.parentNode.insertBefore(featured, root);
  featured.addEventListener("click", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || !e.target.closest(".photo")) return;
    e.preventDefault();
    open(0);
  });

  // A row with the jump links (when there's more than one section) and the column toggle, then a header and
  // grid per section
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var n = 1;
  root.innerHTML = '<div class="photo-bar">' + (sections.length > 1
    ? '<nav class="jump photo-jump" aria-label="Sections">' + sections.map(function (s) {
        return '<a href="#' + esc(s.id) + '">' + esc(s.title) + "</a>";
      }).join("") + "</nav>"
    : "") + "</div>" +
    sections.map(function (s) {
      var rest = s.photos.filter(function (p) { return p !== featuredPhoto; });
      return '<section class="photo-section" id="' + esc(s.id) + '">' +
        '<h2 class="subhead"><span>' + esc(s.title) + "</span></h2>" +
        (rest.length
          ? '<div class="photos">' + rest.map(function (p) { return photoLink(p, n++); }).join("") + "</div>"
          : '<p class="photo-only-featured">Featured above.</p>') +
        "</section>";
    }).join("");
  // the column toggle moves from the page header into that row, beside the section links
  root.querySelector(".photo-bar").appendChild(document.querySelector(".photo-controls .layout-toggle"));

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
      }).join("") + "</div>" +
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

  // Column toggle (the one at the top and the dock's), remembered per visitor
  var buttons = document.querySelectorAll(".layout-toggle button");
  function setCols(cols) {
    root.querySelectorAll(".photos").forEach(function (g) { g.setAttribute("data-cols", cols); });
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.cols === cols)); });
    root.querySelectorAll("img").forEach(function (img) { img.sizes = sizesFor(cols); });
    try { localStorage.setItem("nm-photo-cols", cols); } catch (e) {}
  }
  var DEFAULT_COLS = 2; // until a visitor picks their own
  var saved = DEFAULT_COLS;
  try { saved = parseInt(localStorage.getItem("nm-photo-cols"), 10) || DEFAULT_COLS; } catch (e) {}
  setCols([1, 2, 4].indexOf(saved) >= 0 ? saved : DEFAULT_COLS);
  buttons.forEach(function (b) {
    b.addEventListener("click", function () { setCols(+b.dataset.cols); });
  });

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
  document.addEventListener("keydown", function (e) {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") show(current - 1);
    else if (e.key === "ArrowRight") show(current + 1);
  });
})();
