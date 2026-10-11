// Scorecard's offline shell (SCORECARD-PLAN.md section 5). Its scope is /extras/scorecard/ only, so the rest of the
// site keeps loading fresh. The app's own files: network first (an update shows up the next time there's signal),
// the saved copy when there isn't. Google Fonts (the app's and the scorecards' fonts): saved copy first, since a
// font file at a given address never changes. Calls to the Worker (api.nickmade.net) aren't touched.
// Bump CACHE only to throw away everything saved (e.g. a course file was renamed).
var CACHE = "scorecard-v1";
var FONTS_CSS = "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Dancing+Script:wght@700&family=Roboto+Condensed:wght@400;700&family=Space+Grotesk:wght@400;500;700&family=Tinos:wght@400;700&family=Unbounded:wght@500;600;700&display=swap";
var SHELL = ["./", "scorecard.css", "scorecard.js", "card.js", "cardread.js", "viewer.js", "courses/index.json",
  "courses/pecan-hollow.json", "courses/firewheel-old.json", "/assets/favicon.svg",
  "courses/pecan-hollow-holes-1.png", "courses/pecan-hollow-holes-2.png", "courses/firewheel-old-holes-1.png", "courses/firewheel-old-holes-2.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL).then(function () {
      // the fonts too, so the first round can be offline: the stylesheet, then every font file it names
      return fetch(FONTS_CSS).then(function (r) {
        var copy = r.clone();
        return r.text().then(function (css) {
          var urls = css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) || [];
          return c.put(FONTS_CSS, copy).then(function () {
            return Promise.all(urls.map(function (u) { return fetch(u, { mode: "cors" }).then(function (f) { return c.put(u, f); }).catch(function () {}); }));
          });
        });
      }).catch(function () {});
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("scorecard-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return r;
      });
    }));
    return;
  }
  if (url.origin !== location.origin) return; // the Worker's API and anything else: straight to the network
  if (url.pathname.indexOf("/extras/scorecard/") !== 0 && url.pathname !== "/assets/favicon.svg") return;
  e.respondWith(fetch(req).then(function (r) {
    if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return r;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match("./"); });
  }));
});
