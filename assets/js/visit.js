// Counts this page view for Nick's private Visitors page (the Worker's /visit, worker/src/visits.js). Loaded by
// footer.js on every page, and on its own by the few pages without that footer. Sends: this browser's id (the same
// nm-visitor the suggestion boxes use), the name typed into a suggestion box here before (nm-name), the page, and
// later how long it was in view. Nothing at all from a browser that has been in owner mode (Nick).
(function () {
  if (window.__nmVisit) return;
  window.__nmVisit = true;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  if (store.get("nm-admin-token")) store.set("nm-me", "1");
  if (store.get("nm-me") || navigator.webdriver) return;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = local ? "http://localhost:8787" : "https://api.nickmade.net";

  function rid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16) + "-" + Math.random().toString(16).slice(2, 12); }
  var vid = store.get("nm-visitor");
  if (!vid) {
    var m = document.cookie.match(/(?:^|; )nm_visitor=([^;]+)/);
    vid = m ? m[1] : rid();
    store.set("nm-visitor", vid);
    document.cookie = "nm_visitor=" + vid + "; max-age=31536000; path=/; SameSite=Lax";
  }
  function send(path, body) {
    var data = JSON.stringify(body);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(API + path, new Blob([data], { type: "text/plain" }))) return;
    } catch (e) {}
    try { fetch(API + path, { method: "POST", body: data, keepalive: true, mode: "no-cors" }); } catch (e) {}
  }

  var view, shown, since;
  function start() {
    view = rid(); shown = 0; since = document.visibilityState === "visible" ? Date.now() : 0;
    var ref = "";
    try { if (document.referrer && new URL(document.referrer).host !== location.host) ref = document.referrer; } catch (e) {}
    send("/visit", { v: vid, i: view, n: store.get("nm-name") || "", p: location.pathname + location.search, t: document.title, r: ref, m: navigator.maxTouchPoints || 0 });
  }
  // the time in view, sent each time the page goes out of sight (a phone may never fire pagehide)
  function away() {
    if (since) { shown += Date.now() - since; since = 0; }
    if (view) send("/visit/end", { v: vid, i: view, s: Math.round(shown / 1000) });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { if (!since) since = Date.now(); } else away();
  });
  window.addEventListener("pagehide", away);
  window.addEventListener("pageshow", function (e) { if (e.persisted) start(); }); // back to a page kept in memory: a new view
  start();
})();
