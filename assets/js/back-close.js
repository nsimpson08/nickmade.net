// The phone's Back button closes what's open instead of leaving the page (Ver 1.4): a photo in the full view, any
// dialog (a disc's case, the add and login dialogs...), the poster wall, Nick's Office's card, the Cattery's card and
// history panel. Opening one adds a step
// to the browser's history; Back takes that step and this closes the window, the same as its ×. Closing it any other
// way (×, Escape, clicking outside) takes the step back out, so the history stays as it was. A dialog marked
// data-close-only (the log box in live.js) stays open on Back. When the history has grown since a window's step was
// added (a Spotify player on the page loading another song adds steps of its own: the Vinyl page's turntable), its
// step is left: history.back() would take the player's step instead, and stop or change the song (2026-11-02).
// Loaded on every page by footer.js (and by play/office/ and play/cats/ directly, which have no footer).
(function () {
  if (window.NMBackClose) return;
  window.NMBackClose = true;

  // what counts as an open window, and how to close it, the topmost first
  var KINDS = [
    { open: function () { var d = document.querySelectorAll("dialog[open]"); return d[d.length - 1]; }, close: function (el) { el.close(); } },
    { open: function () { return document.querySelector('.wall[role="dialog"]'); }, close: function (el) { click(el, ".wall-close"); } },
    { open: function () { return document.querySelector("#lightbox:not([hidden])"); }, close: function (el) { click(el, ".lightbox-close"); } },
    { open: function () { return document.querySelector(".office-card:not([hidden])"); }, close: function (el) { click(el, ".office-card-close"); } },
    { open: function () { return document.querySelector(".cats-card:not([hidden])"); }, close: function (el) { click(el, ".cats-card-close"); } },
    { open: function () { return document.querySelector(".cats-panel:not([hidden])"); }, close: function (el) { click(el, ".cats-panel-close"); } },
  ];
  function click(el, sel) { var b = el.querySelector(sel); if (b) b.click(); }
  function count() {
    return document.querySelectorAll('dialog[open], .wall[role="dialog"], #lightbox:not([hidden]), .office-card:not([hidden]), .cats-card:not([hidden]), .cats-panel:not([hidden])').length;
  }

  var open = 0; // how many we've added a history step for
  var fromBack = false; // a window is closing because Back was pressed (its step is already gone)
  var skipPop = 0; // our own history.back() calls, whose popstate we ignore

  var lens = []; // history.length just after each of our steps went on
  function sync() {
    var n = count();
    while (n > open) { history.pushState({ nmWindow: true }, ""); open++; lens.push(history.length); }
    while (n < open) {
      open--;
      var len = lens.pop();
      if (fromBack) fromBack = false;
      // closed with ×, Escape...: take its step back out. (<=, not ===: with the tab's history full, Firefox's 50 steps,
      // history.length reads one more just after the push, then the oldest step is dropped and it's back to 50; with ===
      // every window closed in a long-used tab left its step, and Back took a press per card to leave the page: Nick,
      // 2026-11-04, after 3 board games. Only a longer history means the page's player added steps of its own.)
      else if (history.length <= len) { skipPop++; history.back(); }
    }
  }

  window.addEventListener("popstate", function () {
    if (skipPop) { skipPop--; return; }
    if (!open) return;
    // a dialog only its × may close (the movie/game log box): Back puts its step back and leaves it open
    var top = KINDS[0].open();
    if (top && top.dataset.closeOnly) { history.pushState({ nmWindow: true }, ""); lens[lens.length - 1] = history.length; return; }
    for (var i = 0; i < KINDS.length; i++) {
      var el = KINDS[i].open();
      if (el) { fromBack = true; KINDS[i].close(el); break; }
    }
    // if nothing closed after all (some close after a short animation), forget the step
    setTimeout(function () { if (fromBack) { fromBack = false; open = count(); lens.length = Math.min(lens.length, open); } }, 1000);
  });

  new MutationObserver(function () { sync(); }).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden"],
  });
})();
