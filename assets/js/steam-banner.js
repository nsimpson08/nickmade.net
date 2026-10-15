// Games page: a Steam "Achievement unlocked" banner, the third after Xbox and PlayStation (on its own row on desktop):
// Steam navy, his unlocked Steam achievements across every game, his Steam level and perfect games, and how many he
// unlocked in the last day, 7 days and 30 days (Worker GET /steam/achievements; steam.js). Same pill, animation,
// count-up and shared gain clock as the other two (site.css .xa, .xa-steam). Hidden if it can't load, and while the
// Worker is still making its first count of every game. Owner-mode Refresh (live.js) calls window.NMSteamBanner.reload().
// Links to his Steam profile (data-profile), in a new tab.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var PROFILE = script.dataset.profile || "";
  var root = document.getElementById("steam-banner");
  if (!root) return;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COUNT_AT = 1000, COUNT_MS = 900;

  // a generic achievement medal (Steam's own logo is theirs): a star on a ribbon
  var MEDAL = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 2h4l1.2 4.2L13.4 2h3.6l-2.6 7.1A6.5 6.5 0 1 1 9.6 9.1L7 2zm5 9.2l1.15 2.33 2.57.37-1.86 1.82.44 2.56L12 17.07l-2.3 1.21.44-2.56-1.86-1.82 2.57-.37L12 11.2z"/></svg>';

  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  var shown = null;

  function render(d, fromTotal) {
    shown = d.total;
    var gained = typeof d.gained === "number" ? d.gained : null;
    // a period the Worker has no number for (a missed night, or not enough history yet) shows +0 (Nick), so both
    // banners always have all three and stay in step
    var num = function (x) { return typeof x === "number" ? x : 0; };
    var windows = [[num(gained), "in the last 24h", "in the last 24 hours", 1], [num(d.gained7), "in the last 7 days", "", 7], [num(d.gained30), "in the last 30 days", "", 30]];
    var cycle = !still && windows.length > 1;
    var gain = windows.length ? '<span class="xa-gains' + (cycle ? " cycle" : "") + '">' + windows.map(function (w, k) {
      return '<span class="xa-gain" data-w="' + w[3] + '">' + (w[0] < 0 ? "−" + fmt(-w[0]) : "+" + fmt(w[0])) + " <span>" + w[1] + "</span></span>";
    }).join("") + "</span>" : "";
    var about = [d.level ? "Level " + d.level : "", d.perfect ? fmt(d.perfect) + (d.perfect === 1 ? " perfect game" : " perfect games") : ""].filter(Boolean).join(" · ") || "Steam achievements";
    var label = "Steam achievements " + fmt(d.total) + (d.level ? ", Steam level " + d.level : "") + (d.perfect ? ", " + fmt(d.perfect) + " perfect games" : "") +
      windows.map(function (w) { return ", " + (w[0] < 0 ? "down " + fmt(-w[0]) : "up " + fmt(w[0])) + " " + (w[2] || w[1]); }).join("") +
      (PROFILE ? ". Opens Nick's Steam profile in a new tab" : "");
    var tag = PROFILE ? "a" : "div";
    root.innerHTML =
      "<" + tag + ' class="xa-toast"' + (PROFILE ? ' href="' + PROFILE.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener"' : ' role="img"') + ">" +
        '<span class="xa-badge" aria-hidden="true"><span class="xa-ring"></span>' + MEDAL + "</span>" +
        '<span class="xa-body" aria-hidden="true">' +
          '<span class="xa-label"><span class="xa-label-in"><span>Achievement unlocked</span><span>' + about + "</span></span></span>" +
          '<span class="xa-score"><span class="xa-total"><span class="xa-g xa-medal">' + MEDAL + "</span><b>" + fmt(d.total) + "</b></span>" + gain + "</span>" +
        "</span>" +
      "</" + tag + ">";
    root.firstChild.setAttribute("aria-label", label);
    root.classList.add("play");
    if (cycle) showPeriod(clock.now(), true);

    // the total counts up from a day ago's (or, on reload, the one that was showing)
    var from = fromTotal != null ? fromTotal : gained > 0 ? d.total - gained : d.total;
    if (still || from === d.total) return;
    var out = root.querySelector(".xa-total b");
    out.textContent = fmt(from);
    setTimeout(function () {
      var start = performance.now();
      (function tick(now) {
        var t = Math.min(1, (now - start) / COUNT_MS);
        out.textContent = fmt(Math.round(from + (d.total - from) * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(tick);
      })(start);
    }, COUNT_AT);
  }

  // One clock for all the banners (Xbox, PlayStation, Steam): every 3 seconds they move to the next period together, so both
  // always show the same one (24h, 7 days, 30 days). Whichever banner loads first starts it.
  var PERIODS = [1, 7, 30];
  var clock = window.NMGainClock || (window.NMGainClock = (function () {
    var subs = [], k = 0, on = false;
    return {
      now: function () { return k; },
      sub: function (f) {
        subs.push(f);
        if (on) return;
        on = true;
        setTimeout(function step() { k++; subs.forEach(function (g) { g(k); }); setTimeout(step, 3000); }, 2400 + 3000); // after the intro
      },
    };
  })());
  // show the line for the clock's period (or the nearest one this banner has); paused while hovered or focused
  function showPeriod(k, force) {
    var toast = root.firstChild;
    var lines = root.querySelectorAll(".xa-gains.cycle .xa-gain");
    if (!toast || !lines.length || (!force && toast.matches(":hover, :focus-visible"))) return;
    var want = PERIODS[k % PERIODS.length], pick = lines[0];
    [].forEach.call(lines, function (l) { if (+l.dataset.w <= want) pick = l; });
    [].forEach.call(lines, function (l) {
      if (l === pick) { l.classList.remove("out"); l.classList.add("on"); }
      else if (l.classList.contains("on")) {
        l.classList.remove("on"); l.classList.add("out");
        setTimeout(function () { l.classList.remove("out"); }, 500); // back below, ready to come round again
      }
    });
  }
  clock.sub(function (k) { showPeriod(k); });

  function load() {
    return fetch(API + "/steam/achievements", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) {
        if (!(d && d.total >= 0)) throw new Error("no achievements");
        return d;
      });
  }

  load().then(function (d) { render(d); }).catch(function () { root.remove(); });

  window.NMSteamBanner = {
    reload: function () {
      var was = shown;
      return load().then(function (d) {
        if (!root.isConnected) return d;
        root.classList.remove("play");
        void root.offsetWidth;
        render(d, was);
        return d;
      });
    },
  };
})();
