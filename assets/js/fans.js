// "Get notified" on the home page (Nick, 2026-10-22: visitors sign up for notifications on their phones when he
// posts). The button under the Lately strip opens a box: pick any of movies, games, golf rounds (on a real course; Nick,
// 2026-10-27), photos and site updates, and
// this browser subscribes through the site's service worker (/sw.js) and tells the Worker (POST /fans; fans.js
// there sends them). Change the picks or turn them off from the same box. No accounts, nothing about the visitor.
// iPhones only allow it from the Home Screen app, so there it explains how to add NickMade to the Home Screen first.
(function () {
  var btn = document.getElementById("fans-btn");
  if (!btn) return;
  var script = document.currentScript || document.querySelector('script[src*="fans.js"]');
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local && script.dataset.apiLocal) || script.dataset.api;
  var TOPICS = [["movies", "Movies I watch"], ["games", "Games I play"], ["golf", "My golf rounds"], ["photos", "New photos"], ["site", "Site updates"]];
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  var can = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  var reg = can ? navigator.serviceWorker.register("/sw.js").catch(function () { return null; }) : Promise.resolve(null);

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function post(path, body) {
    return fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Something went wrong."); return d; }); });
  }
  function b64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); var raw = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); }); }
  function current() { return reg.then(function (r) { return r ? r.pushManager.getSubscription() : null; }); }
  // the Cattery's visitor id (play/cats/room.js keeps it); only a browser that owns a cat there gets "My cats"
  function visitor() { try { return localStorage.getItem("nm-visitor"); } catch (e) { return null; } }

  // the button says whether this browser is signed up
  function label(on) { btn.textContent = on ? "🔔 Notifications on" : "🔔 Get notified when I post"; btn.classList.toggle("on", !!on); }
  if (can) current().then(function (sub) { if (sub && Notification.permission === "granted") label(true); }).catch(function () {});

  btn.addEventListener("click", function () {
    var d = document.createElement("dialog");
    d.className = "queue-dialog fans-dialog";
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
    var head = '<button class="close" type="button" aria-label="Close">&times;</button><h2>Get notified</h2>';
    function closeBtn() { d.querySelector(".close").addEventListener("click", function () { d.close(); }); }
    if (!can || (ios && !standalone)) {
      d.innerHTML = '<div>' + head + (ios && !standalone
        ? '<p class="hint">On an iPhone, notifications work from the Home Screen app:</p><ol class="fans-steps">' +
          "<li>Tap <b>Share</b> (the square with the arrow) at the bottom of Safari.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>" +
          "<li>Open <b>NickMade</b> from your Home Screen and tap <b>Get notified</b> there.</li></ol>"
        : '<p class="hint">This browser can\'t do notifications. Try Chrome, Edge, Firefox or Safari.</p>') + "</div>";
      closeBtn(); d.showModal(); return;
    }
    d.innerHTML = '<form novalidate>' + head +
      '<p class="hint">A notification on this phone or computer when I post something new. Pick what you want:</p>' +
      '<div class="fans-topics">' + TOPICS.map(function (t) { return '<label><input type="checkbox" name="topic" value="' + t[0] + '" checked> ' + esc(t[1]) + "</label>"; }).join("") + "</div>" +
      '<div class="fans-cats" hidden></div>' +
      '<p class="hint small">No account, no email. At most one of each every few hours.</p>' +
      '<p class="error" role="alert"></p>' +
      '<button class="pill-btn submit" type="submit">Turn on</button>' +
      '<button class="fans-off" type="button" hidden>Turn off notifications</button></form>';
    closeBtn();
    var form = d.querySelector("form"), err = d.querySelector(".error"), go = d.querySelector(".submit"), off = d.querySelector(".fans-off");
    // a cat owner (Nick, 2026-10-25): their cats too, when one gets down to 25% fed or 25% happy (the Worker checks
    // every 4 hours and tells only that cat's owners)
    var vid = visitor(), catsBox = d.querySelector(".fans-cats"), catsAsked = null;
    if (vid) catsAsked = fetch(API + "/cats/mine?visitorId=" + encodeURIComponent(vid)).then(function (r) { return r.json(); }).then(function (r) {
      var names = r.names || [];
      if (!names.length) return;
      var who = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      catsBox.innerHTML = '<label><input type="checkbox" name="topic" value="cats" checked> 🐈 My cats in the Cattery</label>' +
        '<p class="hint small">When ' + esc(who) + (names.length === 1 ? " gets hungry or wants" : " get hungry or want") + " attention (down to 25%).</p>";
      catsBox.hidden = false;
    }).catch(function () {});
    function picked() { return [].map.call(form.querySelectorAll('input[name="topic"]:checked'), function (x) { return x.value; }); }
    // already signed up: its picks, and Save / Turn off
    current().then(function (sub) {
      if (!sub) return;
      return Promise.all([post("/fans/me", { endpoint: sub.endpoint }), catsAsked]).then(function (got) {
        var r = got[0];
        if (!r.topics) return;
        [].forEach.call(form.querySelectorAll('input[name="topic"]'), function (x) { x.checked = r.topics.indexOf(x.value) >= 0; });
        go.textContent = "Save"; off.hidden = false;
      });
    }).catch(function () {});
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var topics = picked();
      if (!topics.length) { err.textContent = "Pick at least one, or turn notifications off."; return; }
      err.textContent = ""; go.disabled = true;
      Notification.requestPermission().then(function (p) {
        if (p !== "granted") throw new Error(p === "denied" ? "Notifications are blocked for this site. Allow them in your browser's settings, then try again." : "Notifications weren't allowed.");
        return Promise.all([reg, fetch(API + "/fans/key").then(function (r) { return r.json(); })]);
      }).then(function (got) {
        var r = got[0];
        if (!r) throw new Error("This browser couldn't set up notifications.");
        return r.pushManager.getSubscription().then(function (sub) { return sub || r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(got[1].key) }); });
      }).then(function (sub) { return post("/fans", { sub: sub.toJSON(), topics: topics, visitorId: vid || undefined }); })
        .then(function () { label(true); d.close(); })
        .catch(function (e2) { go.disabled = false; err.textContent = e2.message || "Couldn't turn them on."; });
    });
    off.addEventListener("click", function () {
      off.disabled = true;
      current().then(function (sub) {
        if (!sub) return;
        return post("/fans/off", { endpoint: sub.endpoint }).catch(function () {}).then(function () { return sub.unsubscribe(); });
      }).then(function () { label(false); d.close(); }, function () { off.disabled = false; });
    });
    d.showModal();
  });
})();
