// Renders window.REVIEWS (set by each page's list.js) into #entries.
(function () {
  var root = document.getElementById("entries");
  var items = window.REVIEWS || [];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  if (!items.length) {
    root.innerHTML = '<p class="empty">Reviews coming soon.</p>';
    return;
  }

  root.innerHTML = items.map(function (it) {
    var art = it.image
      ? '<div class="art"><img src="' + esc(it.image) + '" alt="' + esc(it.title) + ' poster art" loading="lazy"></div>'
      : '<div class="art blank">' + esc(it.title) + "</div>";

    var credit = "";
    if (it.credit && it.credit.artist) {
      var name = it.credit.url
        ? '<a href="' + esc(it.credit.url) + '" target="_blank" rel="noopener">' + esc(it.credit.artist) + "</a>"
        : esc(it.credit.artist);
      credit = "<figcaption>Art by " + name + "</figcaption>";
    }

    var meta = [];
    if (it.details) meta.push(esc(it.details));
    if (it.rating != null) meta.push('<span class="score">' + esc(it.rating) + "/10</span>");

    var review = it.review
      ? '<div class="review">' + it.review.trim().split(/\n\s*\n/).map(function (p) {
          return "<p>" + esc(p.trim()) + "</p>";
        }).join("") + "</div>"
      : '<div class="review pending"><p>Review coming soon.</p></div>';

    return '<article class="entry">' +
      '<figure class="poster">' + art + credit + "</figure>" +
      '<div class="entry-body">' +
        (it.year ? '<div class="kicker">' + esc(it.year) + "</div>" : "") +
        "<h2>" + esc(it.title) + "</h2>" +
        (meta.length ? '<div class="meta">' + meta.join(" &middot; ") + "</div>" : "") +
        review +
      "</div></article>";
  }).join("");
})();
