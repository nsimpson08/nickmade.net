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

    return '<article class="entry">' +
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
    return '<figure class="poster">' + track(it, withPlayers) + poster(it) +
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

  var titled = sections.filter(function (s) { return s.title; });
  var jump = titled.length > 1
    ? '<nav class="jump" aria-label="Sections">' + titled.map(function (s) {
        return '<a href="#' + slug(s.title) + '">' + esc(s.title) + "</a>";
      }).join("") + "</nav>"
    : "";

  root.innerHTML = jump + sections.map(function (sec) {
    return '<section class="subsection"' + (sec.title ? ' id="' + slug(sec.title) + '"' : "") + ">" +
      (sec.title ? '<h2 class="subhead"><span>' + esc(sec.title) + "</span>" +
        ((sec.items || []).length ? '<span class="count">' + (sec.items.length < 10 ? "0" : "") + sec.items.length + "</span>" : "") +
        "</h2>" : "") +
      body(sec) + "</section>";
  }).join("");
})();
