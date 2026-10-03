// Home page "Lately" strip: the newest game from Games' Recently Played, the newest movie from Movies'
// Recently Watched (with its rating), what's playing on Nick's Spotify (or his last played song), and his newest golf
// round from any source on the Golf page (score, to-par when known, course). Without
// Spotify it falls back to the top song on Music's Lately playlist, then that playlist's name.
// Updates itself as those lists change.
// A spinner shows while they load; parts that can't load are left out, and if none load, the strip hides.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var root = document.getElementById("now");
  if (!root) return;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // "today", "yesterday", "3d ago", "2w ago", "Aug 4"
  function ago(date) {
    var d = new Date(date + "T00:00:00");
    if (isNaN(d)) return "";
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var days = Math.round((today - d) / 864e5);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return days + "d ago";
    if (days < 56) return Math.round(days / 7) + "w ago";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // For an ISO timestamp: "just now", "12m ago", "3h ago", then the day-based ago()
  function agoTime(iso) {
    var mins = Math.round((Date.now() - new Date(iso)) / 6e4);
    if (isNaN(mins)) return "";
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 24 * 60) return Math.round(mins / 60) + "h ago";
    var d = new Date(iso);
    return ago(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  }

  // 4.5 -> ★★★★½
  function stars(r) {
    if (!r) return "";
    return new Array(Math.floor(r) + 1).join("★") + (r % 1 ? "½" : "");
  }

  function newest(page) {
    return fetch(API + "/watched?page=" + page)
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d.items || [])[0] || null; }) // the API sorts newest first
      .catch(function () { return null; });
  }

  function part(kind, href, verb, title, extra, when, image) {
    return '<a class="now-item now-' + kind + '" href="' + href + '">' +
      '<span class="now-verb">' + verb + "</span> " +
      (image ? '<img class="now-art" src="' + esc(image) + '" alt="" width="20" height="20">' : "") +
      '<span class="now-title">' + esc(title) + "</span>" +
      (extra ? ' <span class="now-extra">' + esc(extra) + "</span>" : "") +
      (when ? ' <span class="now-when">' + esc(when) + "</span>" : "") +
    "</a>";
  }

  var playlist = (window.PLAYLISTS || []).filter(function (p) { return p.group === "Lately" && p.url; })[0];

  // The playlist's own name from Spotify when playlist.js leaves the title blank
  function playlistTitle() {
    if (!playlist) return Promise.resolve(null);
    if (playlist.title) return Promise.resolve(playlist.title);
    return fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(playlist.url.split("?")[0]))
      .then(function (r) { return r.json(); })
      .then(function (d) { return d.title || null; })
      .catch(function () { return null; });
  }

  function getJson(path) {
    if (!API) return Promise.resolve(null);
    return fetch(API + path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  // 1) now playing / last played on Nick's Spotify, 2) the top song on the Lately playlist, 3) the playlist's name
  function listening() {
    return getJson("/spotify/now").then(function (s) {
      if (s && s.title) {
        return { title: s.title, extra: s.artist ? "by " + s.artist : "", when: s.nowPlaying ? "" : agoTime(s.playedAt), live: s.nowPlaying, image: s.image };
      }
      var m = playlist && /playlist\/([A-Za-z0-9]+)/.exec(playlist.url);
      return (m ? getJson("/spotify/top?playlist=" + m[1]) : Promise.resolve(null)).then(function (t) {
        if (t && t.title) return { title: t.title, extra: t.artist ? "by " + t.artist : "", when: "" };
        return playlistTitle().then(function (name) { return name ? { title: name, extra: "", when: "" } : null; });
      });
    });
  }

  function music(s) {
    var m = part("music" + (s.live ? " now-live" : ""), "/music/", "listening to", s.title, s.extra, s.when, s.image);
    // playing right now: little bouncing equalizer bars instead of a time
    if (s.live) m = m.replace(/<\/a>$/, ' <span class="np-eq now-eq" aria-label="playing now"><i></i><i></i><i></i><i></i></span></a>');
    return m;
  }

  // The newest golf round from any source on the Golf page: Trackman (trackman.js + GOLF.trackman), X-Golf, 18Birdies
  // (scores.js). Read like now.js's other data, without touching this page's globals.
  function loadData(src, name) {
    return fetch(src)
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (code) { var w = {}; try { new Function("window", code)(w); } catch (e) {} return w[name]; })
      .catch(function () { return undefined; });
  }
  function latestRound() {
    return Promise.all([loadData("/extras/golf/scores.js", "GOLF"), loadData("/extras/golf/trackman.js", "GOLF_TRACKMAN")]).then(function (d) {
      var golf = d[0] || {};
      var rounds = (d[1] || []).concat(golf.trackman || [], golf.xgolf || [], golf.birdies || [])
        .filter(function (r) { return r && r.date && r.score && r.course && !r.hidden && !r.example; })
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      return rounds[0] || null;
    });
  }
  function golf(r) {
    var toPar = r.toPar != null ? r.toPar : r.par ? r.score - r.par : null; // X-Golf rounds don't know par
    var par = toPar == null ? "" : ' <span class="now-par">' + (toPar === 0 ? "E" : (toPar > 0 ? "+" : "") + toPar) + (r.net ? " net" : "") + "</span>";
    return part("golf", "/extras/golf/", 'shot <span class="now-score">' + esc(r.score) + "</span>" + par + " at", r.course, "", ago(r.date));
  }

  // Each part shows up as soon as it loads (in its fixed order), with a spinner after them until the last one is in
  var sources = [
    [API ? newest("games") : null, function (g) { return part("games", "/games/#recently-played", "playing", g.title, stars(g.rating), ago(g.date)); }],
    [API ? newest("movies") : null, function (mv) { return part("movies", "/movies/#recently-watched", "watched", mv.title, stars(mv.rating), ago(mv.date)); }],
    [listening(), music],
    [latestRound(), golf],
  ];
  var slots = sources.map(function () { return ""; });
  var pending = sources.length;

  function render() {
    var parts = slots.filter(Boolean);
    if (!pending && !parts.length) { root.hidden = true; root.textContent = ""; return; } // nothing loaded: hide the strip
    root.setAttribute("aria-busy", String(pending > 0));
    root.innerHTML = '<span class="now-label"><i aria-hidden="true"></i>Lately</span>' +
      parts.join('<span class="now-sep" aria-hidden="true">·</span>') +
      (pending ? '<span class="now-loading" role="status"><i class="now-spin" aria-hidden="true"></i>' + (parts.length ? "" : "Loading…") + "</span>" : "");
  }

  render();
  root.hidden = false;
  requestAnimationFrame(function () { root.classList.add("in"); });
  sources.forEach(function (src, i) {
    Promise.resolve(src[0]).then(function (v) { return v ? src[1](v) : ""; }, function () { return ""; }).then(function (html) {
      slots[i] = html;
      pending--;
      render();
    });
  });
})();
