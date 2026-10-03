// Music page "Recently Listened": Nick's last 10 songs on Spotify (the one playing now first, with equalizer
// bars), from the Worker's /spotify/recent, which caches Spotify for a minute. Sits first in the Lately panel;
// refreshes every minute while the tab is visible. Hidden if Spotify can't be reached.
// Clicking a song plays it in one Spotify embed above the list (Spotify's iFrame API, loaded on first click):
// a 30-second preview for visitors not signed in to Spotify, the full song for those who are.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  if (!API) return;

  var section = document.createElement("section");
  section.className = "playlist recent";
  section.hidden = true;
  var h = document.createElement("h2");
  h.textContent = "Recently Listened";
  var sub = document.createElement("small");
  sub.className = "recent-sub";
  sub.textContent = "";
  h.appendChild(sub);
  section.appendChild(h);
  var player = document.createElement("div");
  player.className = "recent-player";
  player.hidden = true;
  var embed = document.createElement("div");
  player.appendChild(embed);
  section.appendChild(player);
  var list = document.createElement("ol");
  list.className = "recent-list";
  section.appendChild(list);

  // ---------- previews: one Spotify embed, driven by the rows ----------
  // selected = the clicked row's key (song id + when it was played), so a song played twice lights up once
  var controller = null, selected = null, selectedId = null, paused = true, loading = false, queued = null;

  function trackId(url) {
    var m = /track\/([A-Za-z0-9]+)/.exec(url || "");
    return m ? m[1] : null;
  }
  function mark() {
    [].forEach.call(list.children, function (li) {
      var on = li.dataset.key === selected;
      li.classList.toggle("selected", on);
      li.classList.toggle("playing", on && !paused);
      var btn = li.querySelector(".recent-row");
      if (btn) btn.setAttribute("aria-pressed", String(on && !paused));
    });
  }
  function play(id, key) {
    if (key === selected && controller) { controller.togglePlay(); return; }
    selected = key;
    if (id === selectedId && controller) { mark(); controller.play(); return; }
    selectedId = id;
    paused = true;
    mark();
    player.hidden = false;
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
          var was = paused;
          paused = !!(e.data && e.data.isPaused);
          if (was && !paused) document.dispatchEvent(new CustomEvent("nm-spotify-play", { detail: "recent" }));
          mark();
        });
      });
    });
  }
  // Only one song at a time: pause when Community Recs (recs.js) starts playing
  document.addEventListener("nm-spotify-play", function (e) {
    if (e.detail !== "recent" && controller && !paused) controller.pause();
  });

  // Spotify's iFrame API, loaded once and shared with recs.js (it calls onSpotifyIframeApiReady a single time)
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

  var panel = document.querySelector(".playlist-group");
  if (panel) panel.insertBefore(section, panel.querySelector(".group-head").nextSibling);
  else document.getElementById("playlists").prepend(section);

  function ago(iso) {
    var mins = Math.round((Date.now() - new Date(iso)) / 6e4);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    var days = Math.round(mins / 1440);
    return days === 1 ? "yesterday" : days + "d ago";
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(items) {
    list.textContent = "";
    items.forEach(function (s) {
      var li = el("li", s.live ? "live" : "");
      var id = trackId(s.url);
      var a = el("button", "recent-row");
      a.type = "button";
      if (id) {
        var key = id + "@" + (s.live ? "live" : s.playedAt);
        li.dataset.key = key;
        a.setAttribute("aria-label", "Play " + s.title + (s.artist ? " by " + s.artist : ""));
        a.addEventListener("click", function () { play(id, key); });
      } else {
        a.disabled = true;
      }
      var art = el("span", "recent-art");
      art.appendChild(el("span", "recent-play")); // play / playing badge over the cover
      if (s.image) {
        var img = document.createElement("img");
        img.src = s.image;
        img.alt = "";
        img.loading = "lazy";
        art.appendChild(img);
      }
      var text = el("span", "recent-text");
      text.appendChild(el("span", "recent-title", s.title));
      text.appendChild(el("span", "recent-artist", s.artist || ""));
      var when = el("span", "recent-when");
      if (s.live) {
        var eq = el("span", "np-eq");
        eq.setAttribute("aria-hidden", "true");
        for (var i = 0; i < 4; i++) eq.appendChild(document.createElement("i"));
        when.appendChild(eq);
        when.appendChild(document.createTextNode("Now"));
      } else {
        when.textContent = ago(s.playedAt);
        when.title = new Date(s.playedAt).toLocaleString();
      }
      a.appendChild(art); a.appendChild(text); a.appendChild(when);
      li.appendChild(a);
      list.appendChild(li);
    });
    section.hidden = !items.length;
    mark(); // keep the playing song highlighted across refreshes
  }

  function load() {
    fetch(API + "/spotify/recent")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.items) render(d.items); })
      .catch(function () {});
  }

  load();
  setInterval(function () { if (document.visibilityState === "visible") load(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(); });
})();
