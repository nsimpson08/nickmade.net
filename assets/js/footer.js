// Footer on every page: "© 2026 Nick Simpson · Ver 1.0", the version linking to /changelog/.
// The version is the newest entry in /changelog/log.js (load that first). Returning visitors who haven't seen
// the newest version get a small pulsing dot beside it until they open the changelog. That's remembered in their
// own browser only (localStorage "nm-seen-version"); first-time visitors start up to date, with no dot.
// It also adds the "Back to top" button (below) to every page with this footer except Home and Photography.
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

// "Back to top": a round arrow, bottom right, once you've scrolled down more than a screen and a bit (Nick, 1.3).
// Not on Home (short) or Photography (its pinned control bar has its own "Jump to top").
(function () {
  if (/^\/(photography\/?)?$/.test(location.pathname)) return;
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "Back to top");
  btn.title = "Back to top";
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5 5 12.5l1.4 1.4 4.6-4.6V19h2V9.3l4.6 4.6 1.4-1.4z"/></svg>';
  document.body.appendChild(btn);
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  });
  var queued = false;
  function update() {
    queued = false;
    btn.classList.toggle("show", window.scrollY > window.innerHeight * 1.2);
  }
  window.addEventListener("scroll", function () {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();
