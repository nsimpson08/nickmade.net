// Renders the page's list.js into #entries.
// list.js sets either window.SECTIONS (titled subsections) or window.REVIEWS (a single list).
(function () {
  var root = document.getElementById("entries");
  var sections = window.SECTIONS || [{ layout: "reviews", items: window.REVIEWS || [] }];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function poster(it) {
    var art = it.image
      ? '<div class="art"><img src="' + esc(it.image) + '" alt="' + esc(it.title) + ' poster art" loading="lazy"></div>'
      : '<div class="art blank">' + esc(it.title) + "</div>";
    return art;
  }

  function credit(it) {
    if (it.credit && it.credit.official) return '<div class="credit">Official poster</div>';
    if (!it.credit || !it.credit.artist) return "";
    var name = it.credit.url
      ? '<a href="' + esc(it.credit.url) + '" target="_blank" rel="noopener">' + esc(it.credit.artist) + "</a>"
      : esc(it.credit.artist);
    return '<div class="credit">' + esc(it.credit.label || "Art by") + " " + name + "</div>";
  }

  function reviewEntry(it) {
    var meta = [];
    if (it.year) meta.push(esc(it.year));
    if (it.details) meta.push(esc(it.details));
    if (it.rating != null) meta.push('<span class="score">' + esc(it.rating) + "/10</span>");

    var review = it.review
      ? '<div class="review">' + it.review.trim().split(/\n\s*\n/).map(function (p) {
          return "<p>" + esc(p.trim()) + "</p>";
        }).join("") + "</div>"
      : '<div class="review pending"><p>Review coming soon.</p></div>';

    return '<article class="entry" id="' + slug(it.title) + '" data-title="' + esc(it.title) + '"' + (it.year ? ' data-year="' + esc(it.year) + '"' : "") + (it.imdbId ? ' data-imdb="' + esc(it.imdbId) + '"' : "") + ">" + // id: links straight to it (#the-big-lebowski)
      '<figure class="poster">' + poster(it) + credit(it) + "</figure>" +
      '<div class="entry-body">' +
        "<h3>" + esc(it.title) + "</h3>" +
        (meta.length ? '<div class="meta">' + meta.join(" &middot; ") + "</div>" : "") +
        (it.starring && it.starring.length
          ? '<div class="meta">Starring: ' + [].concat(it.starring).map(esc).join(", ") + "</div>"
          : "") +
        review +
      "</div></article>";
  }

  // A 30-second Apple Music preview, played by /assets/js/player.js.
  // Apple's terms: stream only, with a Listen on Apple Music badge and a "courtesy of iTunes" note nearby.
  // placeholder: in a section with players, a game without one gets an empty box the same size
  function track(it, placeholder) {
    var s = it.song;
    if (!s || !s.id) {
      if (!placeholder) return "";
      s = { title: "", artist: "" };
    }
    return '<div class="track' + (s.id ? '" data-track-id="' + esc(s.id) + '"' : ' track-empty"') + '>' +
      '<div class="track-row">' +
        '<button class="track-play" type="button" aria-label="Play ' + esc(s.title) + '"></button>' +
        '<div class="track-text" title="' + esc(s.title + (s.artist ? " — " + (s.cover ? "Cover by " : "") + s.artist : "")) + '"><span class="track-title">' + esc(s.title) + "</span>" +
          '<span class="track-artist">' + (s.cover ? "Cover by " : "") + esc(s.artist || "") + "</span></div>" +
      "</div>" +
      '<div class="track-bar"><span></span></div>' +
      '<label class="track-volume"><span class="visually-hidden">Volume</span>' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' +
        '<input type="range" min="0" max="1" step="0.01" value="0.7"></label>' +
    "</div>";
  }

  // Apple requires these near any preview player.
  function trackCredit(it) {
    var s = it.song;
    if (!s || !s.id) return "";
    return '<div class="track-credit">' +
      '<a href="https://music.apple.com/us/song/' + esc(s.id) + '" target="_blank" rel="noopener">' +
        '<img src="/assets/img/listen-on-apple-music.svg" alt="Listen on Apple Music" width="96" height="28"></a>' +
      "<small>Preview courtesy of iTunes</small>" +
    "</div>";
  }

  function gridItem(it, withPlayers) {
    return '<figure class="poster" data-title="' + esc(it.title) + '"' + (it.year ? ' data-year="' + esc(it.year) + '"' : "") + (it.imdbId ? ' data-imdb="' + esc(it.imdbId) + '"' : "") + ">" + track(it, withPlayers) + poster(it) +
      '<figcaption><span class="title">' + esc(it.title) + "</span>" +
        (it.year ? ' <span class="year">' + esc(it.year) + "</span>" : "") +
      "</figcaption>" + credit(it) + trackCredit(it) + "</figure>";
  }

  function body(sec) {
    var items = sec.items || [];
    if (!items.length) return '<p class="empty">Coming soon.</p>';
    if (sec.layout === "grid") {
      var withPlayers = items.some(function (it) { return it.song && it.song.id; });
      return '<div class="poster-grid">' + items.map(function (it) { return gridItem(it, withPlayers); }).join("") + "</div>";
    }
    return '<div class="entries">' + items.map(reviewEntry).join("") + "</div>";
  }

  // Every poster grid but In the Queue (Recently Watched/Played, Best ..., Hidden Gems, Games' All Time Favorites) shows
  // 8 posters (2 rows of 4 on desktop), or 6 when the grid is only 2 across (phones), with an Expand button for the rest.
  // Recently Watched/Played keep only their newest 8 in the Worker (the rest are in their Archive), so on desktop they
  // never need the button. The queue shows everything, so every suggestion can be voted on.
  var CAP = 8, CAP_NARROW = 6;
  function capped(sec) { return sec.layout === "grid" && sec.live !== "queue"; }

  function sectionHtml(sec) {
    return '<section class="subsection"' + (sec.title ? ' id="' + slug(sec.title) + '"' : "") + (capped(sec) ? " data-cap" : "") + ">" +
      (sec.title ? '<h2 class="subhead"><span>' + esc(sec.title) + "</span>" +
        (sec.subtitle ? '<small class="sub">' + esc(sec.subtitle) + "</small>" : "") +
        "</h2>" : "") +
      body(sec) +
      (capped(sec) ? '<div class="cap-more" hidden><button type="button" class="cap-toggle" aria-expanded="false"></button></div>' : "") +
      (sec.live === "watched" && sec.title && sec.archive !== false // only Recently Watched/Played have an Archive (filled by live.js); archive: false turns it off (Games, 1.3)
        ? '<div class="archive"><button type="button" class="archive-toggle" aria-expanded="false">Archive</button>' +
          '<div class="archive-panel" hidden></div></div>'
        : "") +
      "</section>";
  }

  // Consecutive sections sharing a `group` go together; the first one's groupNote/groupStyle describe the group
  var groups = [];
  sections.forEach(function (sec) {
    var last = groups[groups.length - 1];
    if (last && sec.group && last.name === sec.group) last.sections.push(sec);
    else groups.push({ name: sec.group || "", note: sec.groupNote, style: sec.groupStyle, sections: [sec] });
  });

  var titled = sections.filter(function (s) { return s.title; });
  var jump = titled.length > 1
    ? '<nav class="jump" aria-label="Sections">' + groups.map(function (g) {
        return '<span class="jump-group">' + g.sections.filter(function (s) { return s.title; }).map(function (s) {
          return '<a href="#' + slug(s.title) + '">' + esc(s.title) + "</a>";
        }).join("") + "</span>";
      }).join("") + "</nav>"
    : "";

  root.innerHTML = jump + groups.map(function (g) {
    var inner = g.sections.map(sectionHtml).join("");
    if (!g.name) return inner;
    return '<div class="group' + (g.style === "panel" ? " panel" : "") + '" id="' + slug(g.name) + '">' +
      '<div class="group-head"><span class="group-name">' + esc(g.name) + "</span>" +
        (g.note ? '<span class="group-note">' + esc(g.note) + "</span>" : "") + "</div>" +
      inner + "</div>";
  }).join("");

  // ---------- Archive (Recently Watched/Played only): what was pushed out of the newest 8 ----------
  var els = root.querySelectorAll("section.subsection");
  [].forEach.call(els, function (el) {
    if (el.querySelector(".archive")) el.nmArchive = { live: [] };
  });

  function archiveDate(d) {
    var date = new Date(d + "T00:00:00");
    return isNaN(date) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function renderArchive(el) {
    var a = el.nmArchive;
    var seen = {};
    var all = a.live.filter(function (it) {
      var k = String(it.title).toLowerCase() + "|" + (it.year || "") + "|" + (it.date || "");
      return seen[k] ? false : (seen[k] = true);
    });
    var panel = el.querySelector(".archive-panel");
    panel.innerHTML = all.length
      ? '<ol class="archive-list">' + all.map(function (it) {
          // each one opens its card on the Movies page (film-dialog.js), with Nick's rating and review in it
          var data = it.title ? ' class="archive-item"' + (it.imdbId ? ' data-imdb="' + esc(it.imdbId) + '"' : "") + ' data-film-title="' + esc(it.title) + '"' +
            (it.year ? ' data-year="' + esc(it.year) + '"' : "") + (it.image ? ' data-image="' + esc(it.image) + '"' : "") +
            (it.rating ? ' data-rating="' + esc(it.rating) + '"' : "") + (it.review ? ' data-review="' + esc(it.review) + '"' : "") +
            (it.watchedWith ? ' data-with="' + esc(it.watchedWith) + '"' : "") : ""; // (only the owner's Archive has it)
          return "<li" + data + "><span class=\"t\">" + esc(it.title) + "</span>" + (it.year ? ' <span class="y">' + esc(it.year) + "</span>" : "") +
            (it.date ? ' <span class="d">' + esc(archiveDate(it.date)) + "</span>" : "") + "</li>";
        }).join("") + "</ol>"
      : '<p class="archive-empty">Nothing archived yet.</p>';
    el.querySelector(".archive-toggle").textContent = "Archive" + (all.length ? " (" + all.length + ")" : "");
  }
  [].forEach.call(els, function (el) {
    if (!el.nmArchive) return;
    renderArchive(el);
    var btn = el.querySelector(".archive-toggle");
    btn.addEventListener("click", function () {
      var panel = el.querySelector(".archive-panel");
      panel.hidden = !panel.hidden;
      btn.setAttribute("aria-expanded", String(!panel.hidden));
    });
  });

  // ---------- 8 at a time (Nick, 1.3) ----------
  // Posters past the CAP-th get .capped (hidden by CSS, so the poster wall still finds them) until Expand. The live
  // sections change after load (site adds, owner Remove hides), so each section re-counts
  // whenever its posters change. Owner-mode "+" cards aren't posters, so they always show.
  function applyCap(el) {
    var grid = el.querySelector(".poster-grid");
    var more = el.querySelector(".cap-more");
    if (!more) return;
    var posters = grid ? [].filter.call(grid.children, function (c) { return c.classList.contains("poster") && !c.hidden; }) : [];
    var open = el.classList.contains("cap-open");
    var cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 4;
    var cap = cols <= 2 ? CAP_NARROW : CAP;
    posters.forEach(function (c, i) { c.classList.toggle("capped", !open && i >= cap); });
    var extra = posters.length - cap;
    more.hidden = extra <= 0;
    var btn = more.firstChild;
    var label = open ? "Show fewer" : "Expand \u00b7 " + extra + " more";
    if (btn.textContent !== label) btn.textContent = label; // (only when it changes: the observer below sees it)
    btn.setAttribute("aria-expanded", String(open));
  }
  var capSections = root.querySelectorAll("section[data-cap]");
  var capTimer = null;
  window.addEventListener("resize", function () { // a rotated phone or a resized window can change 2 across <-> 4 across
    clearTimeout(capTimer);
    capTimer = setTimeout(function () { [].forEach.call(capSections, applyCap); }, 150);
  });
  [].forEach.call(capSections, function (el) {
    applyCap(el);
    var queued = false;
    new MutationObserver(function (list) {
      if (queued || list.every(function (m) { return m.target.closest && m.target.closest(".cap-more"); })) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; applyCap(el); });
    }).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    el.querySelector(".cap-toggle").addEventListener("click", function () {
      var opening = !el.classList.contains("cap-open");
      el.classList.toggle("cap-open", opening);
      applyCap(el);
      if (!opening) el.querySelector(".cap-more").scrollIntoView({ block: "nearest" }); // don't leave you far below it
    });
  });

  // a link straight to one review (/movies/#the-big-lebowski, from Nick's Office): centre it and give its poster the
  // found glow, like the poster wall does
  function openReviewFromHash() {
    var id = decodeURIComponent(location.hash.slice(1)), el = id && document.getElementById(id);
    if (!el || !el.classList.contains("entry")) return;
    el.scrollIntoView({ block: "center" });
    el.classList.remove("wall-found"); void el.offsetWidth; el.classList.add("wall-found");
    setTimeout(function () { el.classList.remove("wall-found"); }, 2400);
  }
  if (location.hash) setTimeout(openReviewFromHash, 150); // after the browser's own jump, and the posters above settling
  window.addEventListener("hashchange", openReviewFromHash);

  // for live.js
  window.NMArchive = {
    setLive: function (el, items) { if (el && el.nmArchive) { el.nmArchive.live = items || []; renderArchive(el); } },
  };
})();
