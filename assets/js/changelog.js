// /changelog/: renders window.CHANGELOG (changelog/log.js), newest version first, each change tagged with its page.
(function () {
  var log = window.CHANGELOG || [];
  var root = document.getElementById("changelog");
  var PAGES = { site: "Site", home: "Home", games: "Games", movies: "Movies", music: "Music", photography: "Photography", library: "Library", play: "Play", extras: "Extras" };
  var LINKS = { home: "/", games: "/games/", movies: "/movies/", music: "/music/", photography: "/photography/", library: "/library/", play: "/play/", extras: "/extras/" };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  // A version's lines grouped by part of the site, in nav order; lines keep their written order within a group
  var ORDER = ["site", "home", "games", "movies", "music", "photography", "library", "play", "extras"]; // (Library after Photography, as in the menu)
  function grouped(changes) {
    function rank(c) { var i = ORDER.indexOf(c.page); return i < 0 ? 0 : i; }
    return changes.map(function (c, i) { return { c: c, i: i }; })
      .sort(function (a, b) { return rank(a.c) - rank(b.c) || a.i - b.i; })
      .map(function (x) { return x.c; });
  }

  function when(d) {
    var date = new Date(d + "T00:00:00");
    return isNaN(date) ? d : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  root.innerHTML = log.map(function (v, i) {
    // each version has an id (#v1-5), so the "What's new" pop-up can link to one ("You also missed")
    return '<section class="release' + (i === 0 ? " latest" : "") + '" id="v' + esc(String(v.version).replace(/\./g, "-")) + '">' +
      '<h2 class="release-head"><span class="release-version">Ver ' + esc(v.version) + "</span>" +
        (v.title ? '<span class="release-title">' + esc(v.title) + "</span>" : "") +
        '<time datetime="' + esc(v.date) + '">' + esc(when(v.date)) + "</time></h2>" +
      '<ul class="release-changes">' + grouped(v.changes || []).map(function (c) {
        var page = PAGES[c.page] ? c.page : "site";
        var tag = LINKS[page]
          ? '<a class="tag tag-' + page + '" href="' + LINKS[page] + '">' + PAGES[page] + "</a>"
          : '<span class="tag tag-' + page + '">' + PAGES[page] + "</span>";
        return "<li>" + tag + "<span>" + esc(c.text) + "</span></li>";
      }).join("") + "</ul></section>";
  }).join("") || '<p class="empty">Nothing here yet.</p>';
  // owner mode: "Notify subscribers" on the newest version, for the visitors who signed up for site updates on the home
  // page ("Get notified", the Worker's fans.js). Sent only when Nick taps it (Nick, 2026-10-22)
  var token = null;
  try { token = localStorage.getItem("nm-admin-token"); } catch (e) {}
  var script = document.currentScript || document.querySelector('script[src*="changelog.js"]');
  var API = script && (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && script.dataset.apiLocal || script.dataset.api);
  var newest = log[0], head = root.querySelector(".release.latest .release-head");
  if (token && API && newest && head) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "release-notify";
    b.textContent = "🔔 Notify subscribers";
    head.parentNode.insertBefore(b, head.nextSibling);
    b.addEventListener("click", function () {
      var title = "✨ NickMade Ver " + newest.version + (newest.title ? ": " + newest.title : "");
      if (!confirm("Send \"" + title + "\" to everyone signed up for site updates?")) return;
      b.disabled = true; b.textContent = "Sending…";
      fetch(API + "/fans/send", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ topic: "site", title: title, body: "Tap to see what's new.", url: "/changelog/#v" + String(newest.version).replace(/\./g, "-") }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { b.textContent = d.error ? d.error : "Sent to " + d.sent + (d.sent === 1 ? " subscriber" : " subscribers") + (d.waiting ? " (" + d.waiting + " more within 4 hours)" : ""); })
        .catch(function () { b.disabled = false; b.textContent = "Couldn't send. Try again"; });
    });
  }
  // the page is drawn after it loads, so a link to one version (#v1-5) has to be scrolled to now
  var target = location.hash && document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView();
})();
