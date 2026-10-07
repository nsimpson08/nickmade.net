// The Movies page's posters open like the Library's cases (Ver 1.4): click any poster's art for its details, the
// synopsis (Wikipedia's summary, credited), director, cast, and IMDb. The Worker looks the film up (GET /library/film):
// by IMDb id for the live posters (Recently Watched, the queue), by title and year for the ones in list.js.
// Loaded on /movies/ only, after live.js (its API attributes).
(function () {
  var root = document.getElementById("entries");
  if (!root) return;
  var me = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local && me.getAttribute("data-api-local")) || me.getAttribute("data-api");
  if (!API) return;

  var cache = {}; // lookup key -> the Worker's answer (a promise)
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function runtime(m) { return m ? (m >= 60 ? Math.floor(m / 60) + "h " : "") + (m % 60 ? m % 60 + "m" : "").trim() : ""; }

  function lookup(f) {
    var q = f.imdb ? "imdb=" + encodeURIComponent(f.imdb) : "title=" + encodeURIComponent(f.title) + (f.year ? "&year=" + encodeURIComponent(f.year) : "");
    if (!cache[q]) cache[q] = fetch(API + "/library/film?" + q).then(function (r) { return r.json(); }).catch(function () { return { error: "offline" }; });
    return cache[q];
  }

  var dialog = document.createElement("dialog");
  dialog.className = "lib-dialog film-dialog";
  document.body.appendChild(dialog);
  var opener = null;
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog || e.target.closest(".close")) { dialog.close(); return; }
    if (window.NMTrailer && NMTrailer.click(e, dialog)) return;
    var more = e.target.closest(".lib-more");
    if (more) {
      var box = more.closest(".lib-about-box"), open = !box.classList.contains("expanded");
      box.classList.toggle("expanded", open);
      more.textContent = open ? "Show less" : "Show more";
      more.setAttribute("aria-expanded", String(open));
    }
    if (e.target.closest(".film-review")) dialog.close(); // its link goes to the review on this page
  });
  dialog.addEventListener("close", function () {
    if (window.NMTrailer) NMTrailer.stop(dialog); // no trailer playing on behind a closed case
    if (opener) opener.focus({ preventScroll: true });
  });
  dialog.addEventListener("animationend", function (e) { if (e.target.classList.contains("lib-back")) dialog.classList.remove("flip"); });

  // out of 5: five outlined stars, the rating's share of them filled in over the top
  function stars(r) {
    r = Number(r) || 0;
    return '<span class="stars film-mine-stars" style="--r:' + r + '" role="img" aria-label="' + r + ' out of 5 stars">' +
      '<span aria-hidden="true">☆☆☆☆☆</span><span class="on" aria-hidden="true">★★★★★</span></span>';
  }
  function posterSrc(u) { return !u ? "" : /^https?:/.test(u) && !/\/img\?u=/.test(u) ? API + "/img?u=" + encodeURIComponent(u) : /^https?:/.test(u) ? u : "/movies/" + u; }

  // what a clicked poster (or Archive row) is: its title, year, IMDb id (live ones), poster image, Nick's rating and short
  // review from Recently Watched, and whether it has a full review on this page
  function filmOf(el) {
    var row = el.closest(".archive-item");
    if (row) {
      var rt = row.dataset.filmTitle, rr = document.getElementById(slug(rt));
      return {
        fig: row, title: rt, year: row.dataset.year || "", imdb: row.dataset.imdb || "", image: posterSrc(row.dataset.image),
        rating: row.dataset.rating || "", mine: row.dataset.review || "", with: row.dataset.with || "",
        review: rr && rr.classList.contains("entry") ? rr.id : "",
      };
    }
    var fig = el.closest(".entry") || el.closest(".poster"); // a review's poster is a figure.poster inside its .entry
    var title = fig.dataset.title || fig.dataset.filmTitle || (fig.querySelector(".title, h3") || {}).textContent || "";
    var yearEl = fig.querySelector(".year"), year = fig.dataset.year || (yearEl && /^\d{4}$/.test(yearEl.textContent.trim()) ? yearEl.textContent.trim() : "");
    if (!year) { var meta = fig.querySelector(".meta"); var y = meta && meta.textContent.match(/\b(18|19|20)\d{2}\b/); if (y) year = y[0]; }
    var img = fig.querySelector(".art img");
    var review = document.getElementById(slug(title));
    var ratingEl = fig.querySelector(".rating"), mineEl = fig.querySelector(".watched-review");
    return {
      rating: ratingEl ? ((ratingEl.getAttribute("aria-label") || "").match(/^[\d.]+/) || [""])[0] : "", // "4.5 out of 5 stars"
      mine: mineEl ? mineEl.textContent.trim() : "",
      with: (fig.querySelector(".watched-with") || { textContent: "" }).textContent.replace(/^With /, "").trim(), // owner mode only
      fig: fig, title: title.trim(), year: year, imdb: fig.dataset.imdb || "",
      image: img ? img.currentSrc || img.src : "",
      review: review && review.classList.contains("entry") && review !== fig ? review.id : "",
    };
  }

  function render(f, d) {
    var facts = [d && d.year || f.year, d && runtime(d.minutes), d && d.rated].filter(Boolean);
    var paras = String(d && d.about || "").split(/\n\n/).filter(Boolean);
    var links = [];
    if (d && d.trailer && window.NMTrailer) links.push(NMTrailer.button(d.trailer, d.title || f.title));
    if (f.review) links.push('<a class="open film-review" href="#' + esc(f.review) + '">My review</a>');
    var imdb = d && d.imdbId || f.imdb;
    if (imdb) links.push('<a class="open" href="https://www.imdb.com/title/' + esc(imdb) + '/" target="_blank" rel="noopener">IMDb</a>');
    return '<div class="lib-back">' +
      '<button type="button" class="close" aria-label="Close">&times;</button>' +
      '<div class="lib-front">' + (f.image ? '<img class="film-poster" src="' + esc(f.image) + '" alt="' + esc(f.title) + ' poster art">' : "") + "</div>" +
      '<div class="lib-info">' +
        "<h2>" + esc(d && d.title || f.title) + "</h2>" +
        (facts.length ? '<p class="lib-facts">' + facts.map(function (x, i) {
          return i === facts.length - 1 && d && d.rated && x === d.rated ? '<span class="rated">' + esc(x) + "</span>" : esc(x);
        }).join(" · ") + "</p>" : "") +
        // Nick's own rating and short review (Recently Watched and its Archive)
        (f.rating || f.mine || f.with ? '<div class="film-mine"><p class="film-mine-head">My take' +
          (/^[\d.]+$/.test(f.rating) ? " " + stars(f.rating) : "") + "</p>" +
          (f.mine ? "<p>" + esc(f.mine) + "</p>" : "") +
          (f.with ? '<p class="film-with" title="Only you see this">Watched with ' + esc(f.with) + "</p>" : "") + "</div>" : "") +
        (d && d.tagline ? '<p class="lib-tagline">' + esc(d.tagline) + "</p>" : "") +
        (!d ? '<p class="film-loading">Loading…</p>' : d.error ? '<p class="film-loading">Couldn’t load the details right now.</p>' : "") +
        (paras.length ? '<div class="lib-about-box"><div class="lib-about-text">' +
          paras.map(function (p) { return '<p class="lib-about">' + esc(p) + "</p>"; }).join("") + "</div>" +
          '<button type="button" class="lib-more" aria-expanded="false" hidden>Show more</button></div>' : "") +
        (d && d.aboutUrl ? '<p class="lib-source"><a href="' + esc(d.aboutUrl) + '" target="_blank" rel="noopener">From Wikipedia</a></p>' : "") +
        (d && (d.director || d.starring && d.starring.length || d.genres && d.genres.length) ? '<dl class="lib-credits">' +
          (d.director ? "<dt>Director</dt><dd>" + esc(d.director) + "</dd>" : "") +
          (d.starring && d.starring.length ? "<dt>Starring</dt><dd>" + esc(d.starring.join(", ")) + "</dd>" : "") +
          (d.genres && d.genres.length ? "<dt>Genres</dt><dd>" + esc(d.genres.join(", ")) + "</dd>" : "") +
        "</dl>" : "") +
        (links.length ? '<p class="lib-links">' + links.join("") + "</p>" : "") +
      "</div>" +
    "</div>";
  }

  function show(f, d, first) {
    dialog.innerHTML = render(f, d);
    var text = dialog.querySelector(".lib-about-text");
    if (text && text.scrollHeight > text.clientHeight + 4) dialog.querySelector(".lib-more").hidden = false;
    else if (text) text.parentNode.classList.add("short");
    if (!first) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(".lib-back").scrollTop = 0;
    dialog.classList.remove("flip"); void dialog.offsetWidth; dialog.classList.add("flip");
  }

  function open(el) {
    var f = filmOf(el);
    if (!f.title) return;
    opener = el;
    show(f, null, true);
    lookup(f).then(function (d) { if (dialog.open && dialog.dataset.for === f.title) show(f, d, false); });
    dialog.dataset.for = f.title;
  }

  // a link straight to one film's card (/movies/#film=tt0113568, from the Magnavox in Nick's Office): find its poster
  // (Recently Watched first; the live posters arrive a moment after the page), bring it into view with the found glow,
  // and open its card
  function openFromHash() {
    var m = /^#film=(tt\d+)$/.exec(location.hash);
    if (!m) return;
    var tries = 0;
    (function look() {
      var figs = root.querySelectorAll('[data-imdb="' + m[1] + '"]');
      var fig = figs[0];
      if (!fig) { if (++tries < 40) setTimeout(look, 150); return; }
      var capSec = fig.hidden !== true && fig.closest("section[data-cap]");
      if (capSec && fig.offsetParent === null && capSec.querySelector(".cap-toggle")) capSec.querySelector(".cap-toggle").click(); // past the first 8
      fig.scrollIntoView({ block: "center" });
      fig.classList.remove("wall-found"); void fig.offsetWidth; fig.classList.add("wall-found");
      setTimeout(function () { fig.classList.remove("wall-found"); }, 2400);
      var art = fig.querySelector(".art");
      if (art) open(art);
    })();
  }
  openFromHash();
  window.addEventListener("hashchange", openFromHash);

  // a click on a poster's art (not its song player, links, votes or owner buttons)
  root.addEventListener("click", function (e) {
    var row = e.target.closest(".archive-item");
    if (row) { e.preventDefault(); open(row); return; }
    var art = e.target.closest(".poster .art, .entry .art");
    if (!art || e.target.closest("a, button, .track")) return;
    e.preventDefault();
    open(art);
  });
  // keyboard: the art can be focused and opened with Enter or Space
  function focusable() {
    [].forEach.call(root.querySelectorAll(".archive-item:not([tabindex])"), function (li) {
      li.setAttribute("tabindex", "0"); li.setAttribute("role", "button");
      li.setAttribute("aria-label", "Details for " + li.dataset.filmTitle);
    });
    [].forEach.call(root.querySelectorAll(".poster .art, .entry .art"), function (a) {
      if (a.hasAttribute("tabindex")) return;
      a.setAttribute("tabindex", "0"); a.setAttribute("role", "button");
      var t = a.closest(".entry") || a.closest(".poster");
      a.setAttribute("aria-label", "Details for " + (t && (t.dataset.title || t.dataset.filmTitle) || "this film"));
    });
  }
  focusable();
  new MutationObserver(focusable).observe(root, { childList: true, subtree: true }); // live posters arrive later
  root.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches(".poster .art, .entry .art, .archive-item")) { e.preventDefault(); open(e.target); }
  });
})();
