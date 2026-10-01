// /changelog/: renders window.CHANGELOG (changelog/log.js), newest version first, each change tagged with its page.
(function () {
  var log = window.CHANGELOG || [];
  var root = document.getElementById("changelog");
  var PAGES = { site: "Site", home: "Home", games: "Games", movies: "Movies", music: "Music", photography: "Photography", extras: "Extras" };
  var LINKS = { home: "/", games: "/games/", movies: "/movies/", music: "/music/", photography: "/photography/", extras: "/extras/" };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function when(d) {
    var date = new Date(d + "T00:00:00");
    return isNaN(date) ? d : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  root.innerHTML = log.map(function (v, i) {
    return '<section class="release' + (i === 0 ? " latest" : "") + '">' +
      '<h2 class="release-head"><span class="release-version">Ver ' + esc(v.version) + "</span>" +
        (v.title ? '<span class="release-title">' + esc(v.title) + "</span>" : "") +
        '<time datetime="' + esc(v.date) + '">' + esc(when(v.date)) + "</time></h2>" +
      '<ul class="release-changes">' + (v.changes || []).map(function (c) {
        var page = PAGES[c.page] ? c.page : "site";
        var tag = LINKS[page]
          ? '<a class="tag tag-' + page + '" href="' + LINKS[page] + '">' + PAGES[page] + "</a>"
          : '<span class="tag tag-' + page + '">' + PAGES[page] + "</span>";
        return "<li>" + tag + "<span>" + esc(c.text) + "</span></li>";
      }).join("") + "</ul></section>";
  }).join("") || '<p class="empty">Nothing here yet.</p>';
})();
