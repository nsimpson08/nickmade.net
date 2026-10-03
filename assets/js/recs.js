// Music page "Community Recs": visitors search Spotify for a song and send it to Nick; it's added right away to his
// private "NickMade Community Recs!" playlist (Worker /music/search and /music/recs, see worker/src/music.js).
// 10 songs per visitor, no repeats. Below the search: everything suggested so far, newest first, each linking to
// Spotify; the visitor who sent a song (or Nick, in owner mode) can remove it. Sits right after the Lately panel.
// The playlist is private, so it can't be embedded: instead one Spotify player above "Sent so far" plays the songs
// (click a row, or Play all), moving on to the next song when one ends. Visitors not signed in to Spotify hear
// 30-second previews, like Recently Listened (recent.js, which shares the player script and pauses when this plays).
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var root = document.getElementById("playlists");
  if (!API || !root) return;
  var SHOW = 10; // suggestions listed before "Show all"

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
  }
  // The same browser id as the movie and game queues (live.js)
  function visitorId() {
    var id = store("nm-visitor");
    if (!id) { var m = document.cookie.match(/(?:^|; )nm_visitor=([^;]+)/); id = m ? m[1] : null; }
    if (!id) id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    store("nm-visitor", id);
    document.cookie = "nm_visitor=" + id + "; max-age=31536000; path=/; SameSite=Lax";
    return id;
  }
  var VID = visitorId();
  var ADMIN = store("nm-admin-token"); // owner mode: log in on Games or Movies (?admin)
  function headers(h) { h = h || {}; if (ADMIN) h.Authorization = "Bearer " + ADMIN; return h; }

  // "just now", "12m ago", "3h ago", "4d ago", "Aug 4"
  function ago(iso) {
    var mins = Math.round((Date.now() - new Date(iso)) / 6e4);
    if (isNaN(mins)) return "";
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    if (mins < 14 * 1440) return Math.round(mins / 1440) + "d ago";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  var E = '<abbr class="rec-e" title="Explicit">E</abbr>';

  // ---------- the panel ----------
  var box = document.createElement("div");
  box.className = "group playlist-group panel recs";
  box.id = "community-recs";
  box.innerHTML =
    '<div class="group-head"><span class="group-name">Community Recs</span>' +
      '<span class="group-note">Send me a song. It goes straight onto my playlist.</span></div>' +
    '<section class="playlist">' +
      '<h2>Suggest a song</h2>' +
      '<div class="rec-form" hidden>' +
        '<div class="rec-search"><input type="search" id="rec-q" placeholder="Search for a song or artist" autocomplete="off" aria-label="Search Spotify for a song">' +
          '<span class="rec-spin" hidden></span></div>' +
        '<ol class="recent-list rec-results" hidden></ol>' +
        '<div class="rec-pick" hidden></div>' +
        '<p class="rec-msg" role="status"></p>' +
      "</div>" +
      '<p class="empty rec-closed" hidden>Song suggestions open soon.</p>' +
      '<div class="rec-sent" hidden><div class="rec-sent-head"><h3>Sent so far <small class="recent-sub"></small></h3>' +
        '<button class="open rec-all" type="button">Play all</button></div>' +
        '<div class="recent-player rec-player" hidden><div></div></div><ol class="recent-list rec-list"></ol>' +
        '<button class="open rec-more" type="button" hidden></button></div>' +
    "</section>";
  var lately = [].find.call(root.querySelectorAll(".playlist-group"), function (g) {
    var n = g.querySelector(".group-name");
    return n && n.textContent === "Lately";
  });
  if (lately) lately.after(box); else root.prepend(box);

  var form = box.querySelector(".rec-form");
  var q = box.querySelector("#rec-q");
  var spin = box.querySelector(".rec-spin");
  var results = box.querySelector(".rec-results");
  var pick = box.querySelector(".rec-pick");
  var msg = box.querySelector(".rec-msg");
  var sent = box.querySelector(".rec-sent");
  var list = box.querySelector(".rec-list");
  var more = box.querySelector(".rec-more");
  var countLabel = box.querySelector(".rec-sent .recent-sub");

  var items = [], left = 10, per = 10, showAll = false, chosen = null;

  function row(s, extra, badge) {
    return '<span class="recent-art">' + (badge ? '<span class="recent-play"></span>' : "") + (s.image ? '<img src="' + esc(s.image) + '" alt="" loading="lazy">' : "") + "</span>" +
      '<span class="recent-text"><span class="recent-title">' + esc(s.title) + (s.explicit ? " " + E : "") + "</span>" +
      '<span class="recent-artist">' + esc(s.artist) + "</span></span>" + (extra || "");
  }
  function leftText() { return ADMIN ? "Owner mode" : left + " of " + per + " left"; }

  function renderList() {
    sent.hidden = !items.length;
    countLabel.textContent = items.length === 1 ? "1 song" : items.length + " songs";
    var shown = showAll ? items : items.slice(0, SHOW);
    list.innerHTML = shown.map(function (s) {
      var who = s.owner ? "Nick" : s.suggestedBy || "Someone";
      return '<li data-id="' + esc(s.id) + '"><div class="recent-row rec-row">' +
        '<button type="button" class="rec-play" aria-label="' + esc("Play " + s.title + " by " + s.artist) + '"></button>' +
        row(s, '<span class="recent-when">' + (s.mine ? "You" : esc(who)) + " · " + esc(ago(s.createdAt)) +
          (s.canRemove ? ' <button type="button" class="rec-remove">Remove</button>' : "") + "</span>", true) +
        "</div></li>";
    }).join("");
    more.hidden = items.length <= SHOW;
    more.textContent = showAll ? "Show fewer" : "Show all " + items.length;
    mark();
  }
  more.addEventListener("click", function () { showAll = !showAll; renderList(); });

  list.addEventListener("click", function (e) {
    var p = e.target.closest(".rec-play");
    if (p) { play(p.closest("li").dataset.id); return; }
    var btn = e.target.closest(".rec-remove");
    if (!btn) return;
    var li = btn.closest("li");
    var s = items.find(function (x) { return x.id === li.dataset.id; });
    if (!s || !confirm("Remove “" + s.title + "” from Nick's playlist?")) return;
    btn.disabled = true;
    fetch(API + "/music/recs/" + encodeURIComponent(s.id) + "?visitorId=" + encodeURIComponent(VID), { method: "DELETE", headers: headers() })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Couldn't remove it."); }); })
      .then(function () {
        items = items.filter(function (x) { return x !== s; });
        if (s.mine && !ADMIN) left = Math.min(per, left + 1);
        renderList();
        if (chosen) showPick(chosen);
      })
      .catch(function (err) { btn.disabled = false; alert(err.message); });
  });

  // ---------- the player ----------
  var player = box.querySelector(".rec-player");
  var embed = player.firstChild;
  var allBtn = box.querySelector(".rec-all");
  var controller = null, current = null, paused = true, loading = false, queued = null, lastPos = 0;

  function mark() {
    [].forEach.call(list.children, function (li) {
      var on = li.dataset.id === current;
      li.classList.toggle("selected", on);
      li.classList.toggle("playing", on && !paused);
    });
    allBtn.textContent = current && !paused ? "Pause" : current ? "Resume" : "Play all";
  }
  function play(id) {
    if (id === current && controller) { controller.togglePlay(); return; }
    current = id;
    paused = true;
    lastPos = 0;
    player.hidden = false;
    mark();
    var uri = "spotify:track:" + id;
    if (controller) { controller.loadUri(uri); controller.play(); return; }
    queued = uri;
    if (loading) return;
    loading = true;
    spotifyApi(function (IFrameAPI) {
      IFrameAPI.createController(embed, { uri: queued, width: "100%", height: 80 }, function (c) {
        controller = c;
        c.addListener("ready", function () { c.play(); });
        c.addListener("playback_update", function (e) {
          var d = e.data || {};
          var was = paused;
          paused = !!d.isPaused;
          if (was && !paused) document.dispatchEvent(new CustomEvent("nm-spotify-play", { detail: "recs" }));
          // Ended (not paused by hand): stopped at the end, or jumped back to 0 right after the end
          var ended = paused && !d.isBuffering && d.duration > 0 &&
            (d.position >= d.duration - 1500 || (d.position === 0 && lastPos >= d.duration - 2500));
          lastPos = d.position || 0;
          if (ended) next(); else mark();
        });
      });
    });
  }
  // The next song down the list (wrapping to the top); stops after the last one
  function next() {
    var i = items.findIndex(function (x) { return x.id === current; });
    if (i < 0 || i + 1 >= items.length) { paused = true; mark(); return; }
    if (!showAll && i + 1 >= SHOW) { showAll = true; renderList(); }
    play(items[i + 1].id);
  }
  allBtn.addEventListener("click", function () {
    if (current && controller) controller.togglePlay();
    else if (items.length) play(items[0].id);
  });
  document.addEventListener("nm-spotify-play", function (e) {
    if (e.detail !== "recs" && controller && !paused) controller.pause();
  });

  // Spotify's iFrame API, loaded once and shared with recent.js (it calls onSpotifyIframeApiReady a single time)
  function spotifyApi(cb) {
    if (window.NMSpotifyAPI) return cb(window.NMSpotifyAPI);
    var wait = window.NMSpotifyWait = window.NMSpotifyWait || [];
    wait.push(cb);
    if (wait.length > 1) return;
    window.onSpotifyIframeApiReady = function (api) {
      window.NMSpotifyAPI = api;
      wait.splice(0).forEach(function (f) { f(api); });
    };
    var sc = document.createElement("script");
    sc.src = "https://open.spotify.com/embed/iframe-api/v1";
    sc.async = true;
    document.body.appendChild(sc);
  }

  // ---------- search ----------
  var timer = null, seq = 0, found = [];
  q.addEventListener("input", function () {
    clearTimeout(timer);
    var text = q.value.trim();
    if (text.length < 2) { results.hidden = true; spin.hidden = true; seq++; return; }
    timer = setTimeout(function () { searchFor(text); }, 300);
  });
  function searchFor(text) {
    var mine = ++seq;
    spin.hidden = false;
    fetch(API + "/music/search?q=" + encodeURIComponent(text))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (mine !== seq) return;
        spin.hidden = true;
        found = d.results || [];
        results.hidden = false;
        results.innerHTML = found.length ? found.map(function (s, i) {
          var dup = items.some(function (x) { return x.id === s.id; });
          return '<li><button type="button" class="recent-row" data-i="' + i + '"' + (dup ? " disabled" : "") + ">" +
            row(s, '<span class="recent-when">' + (dup ? "Already sent" : "Pick") + "</span>") + "</button></li>";
        }).join("") : '<li class="rec-none">' + esc(d.error || "No songs found.") + "</li>";
      })
      .catch(function () { if (mine === seq) { spin.hidden = true; results.hidden = false; results.innerHTML = '<li class="rec-none">Search isn\'t working right now.</li>'; } });
  }
  results.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-i]");
    if (!b) return;
    showPick(found[+b.dataset.i]);
  });

  // ---------- the picked song: name + send ----------
  function showPick(s) {
    chosen = s;
    results.hidden = true;
    msg.textContent = "";
    msg.className = "rec-msg";
    pick.hidden = false;
    var out = !ADMIN && left <= 0;
    pick.innerHTML =
      '<div class="rec-chosen">' + row(s) + '<button type="button" class="rec-cancel" aria-label="Pick a different song">×</button></div>' +
      (out ? '<p class="rec-out">You\'ve sent ' + per + " songs. Thanks!</p>" :
        '<form class="rec-send" novalidate>' +
          (ADMIN ? "" : '<input id="rec-name" maxlength="40" placeholder="Your name (optional)" aria-label="Your name (optional)" autocomplete="nickname">') +
          '<button class="open submit" type="submit">Add to Nick\'s playlist</button><span class="left">' + esc(leftText()) + "</span>" +
        "</form>");
    var name = pick.querySelector("#rec-name");
    if (name) name.value = store("nm-name") || "";
    pick.querySelector(".rec-cancel").addEventListener("click", reset);
    var f = pick.querySelector("form");
    if (f) f.addEventListener("submit", function (e) { e.preventDefault(); send(s, name ? name.value.trim() : "", f.querySelector("button")); });
  }
  function reset() {
    chosen = null;
    pick.hidden = true;
    pick.innerHTML = "";
    if (q.value.trim().length >= 2) results.hidden = false;
    q.focus();
  }
  function send(s, name, btn) {
    btn.disabled = true;
    btn.textContent = "Adding…";
    if (name) store("nm-name", name);
    fetch(API + "/music/recs", {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ trackId: s.id, name: name, visitorId: VID }),
    })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Couldn't add it."); return d; }); })
      .then(function (d) {
        items.unshift(d.item);
        left = d.yourRemaining;
        renderList();
        chosen = null;
        pick.hidden = true;
        pick.innerHTML = "";
        q.value = "";
        results.hidden = true;
        msg.className = "rec-msg ok";
        msg.textContent = "Added “" + s.title + "” to Nick's playlist. Thanks!" + (ADMIN ? "" : " " + leftText() + ".");
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Add to Nick's playlist";
        msg.className = "rec-msg error";
        msg.textContent = err.message;
      });
  }

  // ---------- load ----------
  fetch(API + "/music/recs?visitorId=" + encodeURIComponent(VID), { headers: headers() })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      items = d.items || [];
      per = d.perVisitor || per;
      left = d.yourRemaining != null ? d.yourRemaining : per;
      form.hidden = !d.ready;
      box.querySelector(".rec-closed").hidden = !!d.ready;
      renderList();
    })
    .catch(function () { box.remove(); });
})();
