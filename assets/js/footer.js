// Footer on every page: "© 2026 Nick Simpson · Ver 1.0", the version linking to /changelog/.
// The version is the newest entry in /changelog/log.js (load that first). Returning visitors who haven't seen
// the newest version get a small pulsing dot beside it until they open the changelog. That's remembered in their
// own browser only (localStorage "nm-seen-version"); first-time visitors start up to date, with no dot.
(function () {
  var log = window.CHANGELOG || [];
  var latest = log[0] && log[0].version;
  var footer = document.getElementById("site-footer");
  if (!footer) {
    footer = document.createElement("footer");
    footer.id = "site-footer";
    document.body.appendChild(footer);
  }
  footer.classList.add("site-footer");

  var seen = null;
  try { seen = localStorage.getItem("nm-seen-version"); } catch (e) {}
  var onChangelog = /^\/changelog\/?$/.test(location.pathname);
  if (latest && (seen === null || onChangelog)) {
    try { localStorage.setItem("nm-seen-version", latest); } catch (e) {}
    seen = latest;
  }
  var fresh = latest && seen !== latest;

  footer.innerHTML = "&copy; " + new Date().getFullYear() + " Nick Simpson" +
    (latest
      ? ' <span class="footer-sep" aria-hidden="true">&middot;</span> <a class="version" href="/changelog/"' +
        (fresh ? ' title="Updated since your last visit"' : "") + ">Ver " + latest +
        (fresh ? '<i class="version-new" aria-label="new"></i>' : "") + "</a>"
      : "");
})();
