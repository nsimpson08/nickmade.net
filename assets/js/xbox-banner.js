// Games page: an Xbox-style "Achievement unlocked" banner with Nick's total gamerscore and how much it went up
// since the night before (Worker GET /xbox/gamerscore, saved by the nightly Xbox sync). The animation plays on
// every page load (CSS, in site.css); the number counts up from last night's total. Hidden if it can't load.
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

  function render(d) {
    var gained = typeof d.gained === "number" ? d.gained : null; // null until there are two nights of snapshots
    var gain = gained === null ? "" :
      '<span class="xa-gain">' + (gained < 0 ? "−" + fmt(-gained) : "+" + fmt(gained)) + "G <span>in the last 24h</span></span>";
    var label = "Xbox gamerscore " + fmt(d.total) +
      (gained === null ? "" : ", " + (gained < 0 ? "down " + fmt(-gained) : "up " + fmt(gained)) + " in the last 24 hours") +
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

    // Count up from last night's total to now
    var from = gained > 0 ? d.total - gained : d.total;
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

  fetch(API + "/xbox/gamerscore")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (d) {
      if (!(d && d.total >= 0)) throw new Error("no gamerscore");
      render(d);
    })
    .catch(function () { root.remove(); });
})();
