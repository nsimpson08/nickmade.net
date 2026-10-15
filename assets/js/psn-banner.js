// Games page: a PlayStation "Trophy earned" banner beside the Xbox one (xbox-banner.js): PlayStation blue, his
// bronze, silver, gold and platinum trophies as drawn cups with their counts (Nick: like PlayStation's own), his level
// and total, and how many he earned in the last day, 7 days and 30 days (Worker GET
// /psn/trophies: the total checked every 4 hours, the gains once a day). Same pill, animation and count-up as the
// Xbox banner (site.css .xa, in PlayStation blue with .xa-ps). Hidden if it can't load (PlayStation not connected,
// or its sign-in expired). Owner-mode Refresh (live.js) calls window.NMPsnBanner.reload().
// Links to Nick's trophies on PSNProfiles (data-profile on the script tag), in a new tab.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var PROFILE = script.dataset.profile || "";
  var root = document.getElementById("psn-banner");
  if (!root) return;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COUNT_AT = 1000, COUNT_MS = 900;

  // PlayStation's trophies, drawn: bronze, silver and gold cups (two handles, a stem, a stepped base) and the platinum
  // one (a sphere in a swirl on a base), each in its own metal. Gradient ids are made unique per drawing (svg()).
  var METAL = {
    bronze: ["#ffd2b0", "#d98b55", "#8c4a22"],
    silver: ["#ffffff", "#c3cad3", "#7b848f"],
    gold: ["#fff3b0", "#e6b83a", "#93650c"],
    platinum: ["#ffffff", "#c9d8f0", "#7f9cc8"],
  };
  var uid = 0;
  function svg(kind) {
    var m = METAL[kind], id = "psm" + uid++;
    var defs = '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + m[2] + '"/>' +
      '<stop offset=".38" stop-color="' + m[0] + '"/><stop offset=".62" stop-color="' + m[1] + '"/><stop offset="1" stop-color="' + m[2] + '"/></linearGradient></defs>';
    var f = 'fill="url(#' + id + ')"';
    var base = '<path ' + f + ' d="M12.5 27h7l1.2 4h-9.4z"/><rect ' + f + ' x="9.5" y="31" width="13" height="3.2" rx="1"/>';
    var top = kind === "platinum"
      ? '<path fill="none" stroke="url(#' + id + ')" stroke-width="2.2" stroke-linecap="round" d="M6.5 15.5c1 6 6 9 9.5 9s8.5-3 9.5-9M9 6.5C11 3.2 21 3.2 23 6.5"/>' +
        '<circle ' + f + ' cx="16" cy="13" r="7"/><path fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.1" d="M12.2 10.5a4.6 4.6 0 0 1 4-2.3"/>' +
        '<rect ' + f + ' x="14.4" y="20" width="3.2" height="7.5" rx="1"/>'
      : '<path fill="none" stroke="url(#' + id + ')" stroke-width="2.2" stroke-linecap="round" d="M8 6.5C3.2 6.5 3.8 14 8.6 14.6M24 6.5c4.8 0 4.2 7.5-.6 8.1"/>' +
        '<path ' + f + ' d="M7.5 4h17v7.5c0 5.4-3.8 9.3-8.5 9.3S7.5 16.9 7.5 11.5z"/>' +
        '<path fill="rgba(255,255,255,.55)" d="M10.2 6h2v6.5c0 2.3.7 4 1.8 5.3-2.4-.8-3.8-2.9-3.8-5.5z"/>' +
        '<rect ' + f + ' x="14.5" y="20" width="3" height="7.5" rx="1"/>';
    return '<svg class="ps-trophy ' + kind + '" viewBox="0 0 32 36" aria-hidden="true">' + defs + top + base + "</svg>";
  }

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
    var c = d.counts || {};
    var about = [d.level ? "Level " + d.level : "", fmt(d.total) + " trophies"].filter(Boolean).join(" · ");
    // bronze to platinum, left to right, like PlayStation shows them
    var cups = '<span class="ps-cups">' + ["bronze", "silver", "gold", "platinum"].map(function (k, i) {
      return '<span class="ps-cup" style="--i:' + i + '">' + svg(k) + "<b>" + fmt(c[k] || 0) + "</b></span>";
    }).join("") + "</span>";
    var label = "PlayStation trophies " + fmt(d.total) + (d.level ? ", level " + d.level : "") +
      ", " + fmt(c.platinum || 0) + " platinum, " + fmt(c.gold || 0) + " gold, " + fmt(c.silver || 0) + " silver, " + fmt(c.bronze || 0) + " bronze" +
      windows.map(function (w) { return ", " + (w[0] < 0 ? "down " + fmt(-w[0]) : "up " + fmt(w[0])) + " " + (w[2] || w[1]); }).join("") +
      (PROFILE ? ". Opens Nick's trophies on PSNProfiles in a new tab" : "");
    var tag = PROFILE ? "a" : "div";
    root.innerHTML =
      "<" + tag + ' class="xa-toast"' + (PROFILE ? ' href="' + PROFILE.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener"' : ' role="img"') + ">" +
        '<span class="xa-badge" aria-hidden="true"><span class="xa-ring"></span>' + svg("platinum") + "</span>" +
        '<span class="xa-body" aria-hidden="true">' +
          '<span class="xa-label"><span class="xa-label-in"><span>Trophy earned</span><span>' + about + "</span></span></span>" +
          '<span class="xa-score">' + cups + gain + "</span>" +
        "</span>" +
      "</" + tag + ">";
    root.firstChild.setAttribute("aria-label", label);
    root.classList.add("play");
    if (cycle) showPeriod(clock.now(), true);

    // each cup's number counts up from zero as the cups come in
    if (still) return;
    var nums = root.querySelectorAll(".ps-cup b");
    ["bronze", "silver", "gold", "platinum"].forEach(function (k, i) { nums[i].textContent = "0"; });
    setTimeout(function () {
      var start = performance.now();
      (function tick(now) {
        var t = Math.min(1, (now - start) / COUNT_MS), e = 1 - Math.pow(1 - t, 3);
        ["bronze", "silver", "gold", "platinum"].forEach(function (k, i) { nums[i].textContent = fmt(Math.round((c[k] || 0) * e)); });
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
    return fetch(API + "/psn/trophies", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) {
        if (!(d && d.total >= 0)) throw new Error("no trophies");
        return d;
      });
  }

  load().then(function (d) { render(d); }).catch(function () { root.remove(); });

  window.NMPsnBanner = {
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
