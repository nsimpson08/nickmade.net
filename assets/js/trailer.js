// The official trailer in a case (Ver 1.4): the Library's cases and the Movies page's poster cards get a Trailer
// button with their links when TMDB lists one (the Worker's GET /library/film gives its YouTube id). Clicking it plays
// the trailer in YouTube's own embedded player (youtube-nocookie) under the title and its year, runtime and rating;
// nothing loads from YouTube before that. Used by library.js and film-dialog.js; load it before them.
(function () {
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

  window.NMTrailer = {
    // the button, first in a case's row of links
    button: function (key, title) {
      if (!/^[\w-]{11}$/.test(key || "")) return "";
      return '<button type="button" class="open trailer-btn" data-trailer="' + esc(key) + '" data-title="' + esc(title || "") + '" aria-expanded="false">' + PLAY + "<span>Trailer</span></button>";
    },
    // add the button to an open case once its trailer is known (the Library looks it up after the case opens)
    addTo: function (dialog, key, title) {
      var html = this.button(key, title);
      if (!html || dialog.querySelector(".trailer-btn")) return;
      var links = dialog.querySelector(".lib-links");
      if (!links) {
        links = document.createElement("p");
        links.className = "lib-links";
        var after = dialog.querySelector(".lib-credits") || dialog.querySelector(".lib-info h2");
        after.parentNode.insertBefore(links, after.nextSibling);
      }
      links.insertAdjacentHTML("afterbegin", html);
    },
    // a click in the case: the button plays the trailer under the title line, or puts it away again
    click: function (e, dialog) {
      var btn = e.target.closest(".trailer-btn");
      if (!btn) return false;
      if (dialog.querySelector(".trailer")) { this.stop(dialog); return true; }
      var info = dialog.querySelector(".lib-info");
      var box = document.createElement("div");
      box.className = "trailer";
      box.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(btn.dataset.trailer) + '?autoplay=1&rel=0&modestbranding=1&playsinline=1"' +
        ' title="' + esc((btn.dataset.title ? btn.dataset.title + " " : "") + "trailer") + '"' +
        ' allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
      var at = info.querySelector(".lib-facts") || info.querySelector("h2");
      at.parentNode.insertBefore(box, at.nextSibling);
      btn.setAttribute("aria-expanded", "true");
      btn.querySelector("span").textContent = "Close trailer";
      box.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return true;
    },
    // stop it (Close trailer, or the case closing)
    stop: function (dialog) {
      var box = dialog.querySelector(".trailer");
      if (box) box.remove();
      var btn = dialog.querySelector(".trailer-btn");
      if (btn) { btn.setAttribute("aria-expanded", "false"); btn.querySelector("span").textContent = "Trailer"; }
    },
  };
})();
