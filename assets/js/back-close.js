// The phone's Back button closes what's open instead of leaving the page (Ver 1.4): a photo in the full view, any
// dialog (a disc's case, the add and login dialogs...), the poster wall, Nick's Office's card. Opening one adds a step
// to the browser's history; Back takes that step and this closes the window, the same as its ×. Closing it any other
// way (×, Escape, clicking outside) takes the step back out, so the history stays as it was.
// Loaded on every page by footer.js (and by play/office/ directly, which has no footer).
(function () {
  if (window.NMBackClose) return;
  window.NMBackClose = true;

  // what counts as an open window, and how to close it, the topmost first
  var KINDS = [
    { open: function () { var d = document.querySelectorAll("dialog[open]"); return d[d.length - 1]; }, close: function (el) { el.close(); } },
    { open: function () { return document.querySelector('.wall[role="dialog"]'); }, close: function (el) { click(el, ".wall-close"); } },
    { open: function () { return document.querySelector("#lightbox:not([hidden])"); }, close: function (el) { click(el, ".lightbox-close"); } },
    { open: function () { return document.querySelector(".office-card:not([hidden])"); }, close: function (el) { click(el, ".office-card-close"); } },
  ];
  function click(el, sel) { var b = el.querySelector(sel); if (b) b.click(); }
  function count() {
    return document.querySelectorAll('dialog[open], .wall[role="dialog"], #lightbox:not([hidden]), .office-card:not([hidden])').length;
  }

  var open = 0; // how many we've added a history step for
  var fromBack = false; // a window is closing because Back was pressed (its step is already gone)
  var skipPop = 0; // our own history.back() calls, whose popstate we ignore

  function sync() {
    var n = count();
    while (n > open) { history.pushState({ nmWindow: true }, ""); open++; }
    while (n < open) {
      open--;
      if (fromBack) fromBack = false;
      else { skipPop++; history.back(); } // closed with ×, Escape...: take its step back out
    }
  }

  window.addEventListener("popstate", function () {
    if (skipPop) { skipPop--; return; }
    if (!open) return;
    for (var i = 0; i < KINDS.length; i++) {
      var el = KINDS[i].open();
      if (el) { fromBack = true; KINDS[i].close(el); break; }
    }
    // if nothing closed after all (some close after a short animation), forget the step
    setTimeout(function () { if (fromBack) { fromBack = false; open = count(); } }, 1000);
  });

  new MutationObserver(function () { sync(); }).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden"],
  });
})();
