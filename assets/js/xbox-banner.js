// Games page: an Xbox-style "Achievement unlocked" banner with Nick's total gamerscore and how much it went up
// in the last day (Worker GET /xbox/gamerscore: total checked every 4 hours, the gain once a day at midnight). The animation plays on
// every page load (CSS, in site.css); the number counts up from the total a day ago. Hidden if it can't load.
// Owner-mode Refresh (live.js) calls window.NMXboxBanner.reload(), which plays it again, counting up from the old total.
// The whole banner links to Nick's achievements profile (data-profile on the script tag: TrueAchievements, which is
// public, unlike xbox.com's profile, which asks visitors to sign in), in a new tab.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var PROFILE = script.dataset.profile || "";
  var root = document.getElementById("xbox-banner");
  if (!root) return;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COUNT_AT = 1000, COUNT_MS = 900; // when the count-up starts (after the pill opens) and how long it takes

  var TROPHY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3zM6 7v1a2 2 0 0 0 1 1.7V7H6zm11 0v2.7A2 2 0 0 0 18 8V7h-1z"/></svg>';

  function fmt(n) { return Number(n).toLocaleString("en-US"); }

  var shown = null; // the total on screen, for reload()

  function render(d, fromTotal) {
    var gained = typeof d.gained === "number" ? d.gained : null; // null until there are two snapshots
    shown = d.total;
    // the last day, 7 days and 30 days, taking turns in one spot every 3 seconds (stacked with reduced motion);
    // each is left out while the Worker has no number for it
    // a period the Worker has no number for (a missed night, or not enough history yet) shows +0 (Nick), so both
    // banners always have all three and stay in step
    var num = function (x) { return typeof x === "number" ? x : 0; };
    var windows = [[num(gained), "in the last 24h", "in the last 24 hours", 1], [num(d.gained7), "in the last 7 days", "", 7], [num(d.gained30), "in the last 30 days", "", 30]];
    var cycle = !still && windows.length > 1;
    var gain = windows.length ? '<span class="xa-gains' + (cycle ? " cycle" : "") + '">' + windows.map(function (w, k) {
      return '<span class="xa-gain" data-w="' + w[3] + '">' + (w[0] < 0 ? "−" + fmt(-w[0]) : "+" + fmt(w[0])) + "G <span>" + w[1] + "</span></span>";
    }).join("") + "</span>" : "";
    var label = "Xbox gamerscore " + fmt(d.total) +
      windows.map(function (w) { return ", " + (w[0] < 0 ? "down " + fmt(-w[0]) : "up " + fmt(w[0])) + " " + (w[2] || w[1]); }).join("") +
      (PROFILE ? ". Opens Nick's achievements on TrueAchievements in a new tab" : "");
    var tag = PROFILE ? "a" : "div";
    root.innerHTML =
      "<" + tag + ' class="xa-toast"' + (PROFILE ? ' href="' + PROFILE.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener"' : ' role="img"') + ">" +
        '<span class="xa-badge" aria-hidden="true"><span class="xa-ring"></span>' + TROPHY + "</span>" +
        '<span class="xa-body" aria-hidden="true">' +
          '<span class="xa-label"><span class="xa-label-in"><span>Achievement unlocked</span><span>Total gamerscore</span></span></span>' +
          '<span class="xa-score"><span class="xa-total"><span class="xa-g">G</span><b>' + fmt(d.total) + "</b></span>" + gain + "</span>" +
        "</span>" +
      "</" + tag + ">";
    root.firstChild.setAttribute("aria-label", label);
    root.classList.add("play");
    if (cycle) showPeriod(clock.now(), true);

    // Count up from a day ago's total (or, on reload, the one that was showing) to now
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
    return fetch(API + "/xbox/gamerscore", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) {
        if (!(d && d.total >= 0)) throw new Error("no gamerscore");
        return d;
      });
  }

  load().then(function (d) { render(d); }).catch(function () { root.remove(); });

  window.NMXboxBanner = {
    reload: function () {
      var was = shown;
      return load().then(function (d) {
        if (!root.isConnected) return d;
        root.classList.remove("play");
        void root.offsetWidth; // restart the animation
        render(d, was);
        return d;
      });
    },
  };
})();
