// "What's new" (Nick, 2026-10-15: a returning visitor sees a dialog about the new features, with links, on the first
// page they land on). Everything it says is in /changelog/popup.js (window.WHATS_NEW), written separately from the
// changelog; this loads that and shows it when this browser last saw an older version than WHATS_NEW.version
// (localStorage "nm-seen-version", kept by footer.js; first-time visitors start up to date and never get it). Once per
// version ("nm-whatsnew"), never on the changelog page. Tags are the changelog's outlined bubbles in each section's
// colour. The phone's Back button closes it (back-close.js knows dialogs).
// Loaded by footer.js on every page with a footer, and directly by play/cats/ and play/office/.
(function () {
  if (window.NMWhatsNew) return;
  window.NMWhatsNew = true;
  if (/^\/changelog\/?$/.test(location.pathname)) return;
  var seen = null;
  try { seen = localStorage.getItem("nm-seen-version"); } catch (e) { return; }
  if (!seen) return; // a first visit: nothing is "new" yet
  // the pop-up's text, and the changelog (for "You also missed": the versions between theirs and this one); pages
  // with a footer have the changelog already
  var need = 1 + (window.CHANGELOG ? 0 : 1);
  function loaded() { if (!--need) maybeShow(window.WHATS_NEW); }
  [["/changelog/popup.js", true], ["/changelog/log.js", !window.CHANGELOG]].forEach(function (f) {
    if (!f[1]) return;
    var s = document.createElement("script");
    s.src = f[0]; s.onload = loaded; s.onerror = loaded;
    document.head.appendChild(s);
  });

  function num(v) { return String(v || "0").split(".").map(Number); }
  function newer(a, b) { a = num(a); b = num(b); for (var i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return false; }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var PAGE = { // label and colour (the site's section colours)
    site: ["Site", "#9d9b95"], home: ["Home", "#ecebe7"], games: ["Games", "#a78bfa"], movies: ["Movies", "#f5b451"],
    music: ["Music", "#ff7eb6"], photography: ["Photography", "#7cc4ff"], play: ["Play", "#ff8a66"], extras: ["Extras", "#7ee0b5"],
  };
  function rgba(hex, a) { var n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")"; }

  // the versions they also skipped: newer than the one they last saw, older than this pop-up's (from the changelog)
  function missedList(w) {
    return (window.CHANGELOG || []).filter(function (r) { return newer(r.version, seen) && newer(w.version, r.version); });
  }
  var MISSED = [];
  function missed() {
    if (!MISSED.length) return "";
    return '<li class="nm-new-missed"><b>You also missed:</b> ' + MISSED.map(function (r) {
      return '<a href="/changelog/#v' + esc(String(r.version).replace(/\./g, "-")) + '">Ver ' + esc(r.version) + (r.title ? " " + esc(r.title) : "") + "</a>";
    }).join(" &middot; ") + "</li>";
  }
  function maybeShow(w) {
    MISSED = w ? missedList(w) : [];
    var shown = null;
    try { shown = localStorage.getItem("nm-whatsnew"); } catch (e) {}
    if (!w || !w.version || !newer(w.version, seen) || shown === w.version) return;
    var css = document.createElement("style");
    css.textContent =
      ".nm-new{width:min(600px,calc(100% - 32px));max-height:min(82vh,760px);padding:0;border:1px solid #2a2a31;border-radius:16px;background:#0f0f13;color:#ecebe7;font:400 15px/1.55 'Space Grotesk',system-ui,sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden;box-sizing:border-box}" + // never scrolls itself: only the list does (Nick: no double scroll bars)
      ".nm-new::backdrop{background:rgba(0,0,0,.6)}" +
      ".nm-new-in{display:flex;flex-direction:column;max-height:calc(min(82vh,760px) - 2px)}" +
      ".nm-new header{padding:22px 24px 6px}" +
      ".nm-new .nm-new-kicker{margin:0 0 6px;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:#7ee0b5;display:flex;align-items:center;gap:8px}" +
      ".nm-new .nm-new-kicker i{width:7px;height:7px;border-radius:50%;background:#7ee0b5;box-shadow:0 0 10px #7ee0b5}" +
      ".nm-new h2{margin:0;font:700 1.35rem/1.25 'Unbounded',system-ui,sans-serif;color:#ecebe7}" +
      ".nm-new .nm-new-intro{margin:10px 0 0;color:#9d9b95}" +
      ".nm-new ul{list-style:none;margin:0;padding:10px 24px 6px;overflow-y:auto;display:grid;grid-template-columns:max-content 1fr;gap:14px 12px;align-items:baseline}" + // the tag column as wide as the widest tag
      ".nm-new ul:focus{outline:none}" +
      // a fade at the bottom while there's more to scroll to (Nick)
      ".nm-new-scroll{position:relative;display:flex;flex-direction:column;min-height:0;overflow:hidden}.nm-new-scroll ul{min-height:0;scrollbar-width:thin;scrollbar-color:#3a3a44 transparent}" + // the list scrolls inside the space left
      ".nm-new-scroll::after{content:'';position:absolute;left:0;right:0;bottom:0;height:64px;background:linear-gradient(rgba(15,15,19,0),#0f0f13 85%);pointer-events:none;opacity:0;transition:opacity .2s}" +
      ".nm-new-scroll.more::after{opacity:1}" +
      ".nm-new li{display:contents}" +
      ".nm-new .nm-new-tag{justify-self:start;padding:3px 10px;border:1px solid;border-radius:999px;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}" +
      ".nm-new .nm-new-text{margin:0;color:#ecebe7}" +
      ".nm-new .nm-new-go{display:inline-block;margin-top:3px;font-size:.88rem;text-decoration:none}" +
      ".nm-new .nm-new-go:hover,.nm-new .nm-new-go:focus-visible{text-decoration:underline;text-underline-offset:3px;outline:none}" +
      ".nm-new li.nm-new-missed{display:block;grid-column:1/-1;margin:2px 0 4px;padding-top:12px;border-top:1px solid #1f1f25;color:#9d9b95;font-size:.9rem}" +
      ".nm-new .nm-new-missed b{color:#ecebe7;font-weight:500}" +
      ".nm-new .nm-new-missed a{color:#ecebe7;text-underline-offset:3px}" +
      ".nm-new .nm-new-missed a:hover{color:#7ee0b5}" +
      ".nm-new footer{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;padding:14px 24px 20px;border-top:1px solid #1f1f25;margin-top:8px}" +
      ".nm-new footer a,.nm-new footer button{padding:9px 16px;border-radius:999px;font:500 .9rem 'Space Grotesk',system-ui,sans-serif;cursor:pointer;text-decoration:none}" +
      ".nm-new footer a{border:1px solid #3a3a44;color:#ecebe7}" +
      ".nm-new footer button{border:0;background:#ecebe7;color:#0b0b0d}" +
      "@media (max-width:480px){.nm-new header{padding:18px 18px 4px}.nm-new ul{padding:8px 18px 4px}.nm-new ul{grid-template-columns:1fr;gap:6px}.nm-new li>div{margin-bottom:10px}.nm-new footer{padding:12px 18px 16px}}";
    document.head.appendChild(css);

    var d = document.createElement("dialog");
    d.className = "nm-new";
    d.setAttribute("aria-labelledby", "nm-new-title");
    d.innerHTML = '<div class="nm-new-in"><header>' +
      (w.kicker ? '<p class="nm-new-kicker"><i aria-hidden="true"></i>' + esc(w.kicker) + "</p>" : "") +
      '<h2 id="nm-new-title">' + esc(w.title || "What's new") + "</h2>" +
      (w.intro ? '<p class="nm-new-intro">' + esc(w.intro) + "</p>" : "") + '</header><div class="nm-new-scroll"><ul>' +
      (w.items || []).map(function (it) {
        var p = PAGE[it.page] || PAGE.site;
        return '<li><span class="nm-new-tag" style="color:' + p[1] + ";border-color:" + rgba(p[1], 0.45) + '">' + p[0] + "</span><div>" +
          '<p class="nm-new-text">' + esc(it.text) + "</p>" +
          (it.cta && it.link ? '<a class="nm-new-go" style="color:' + p[1] + '" href="' + esc(it.link) + '">' + esc(it.cta) + " &rarr;</a>" : "") + "</div></li>";
      }).join("") +
      missed() +
      "</ul></div><footer>" + (w.more ? '<a href="/changelog/">' + esc(w.more) + "</a>" : "") +
      '<button type="button" class="nm-new-ok" autofocus>' + esc(w.ok || "Got it") + "</button></footer></div>";

    function show() {
      document.body.appendChild(d);
      try { localStorage.setItem("nm-whatsnew", w.version); } catch (e) {}
      d.querySelector(".nm-new-ok").addEventListener("click", function () { d.close(); });
      d.addEventListener("click", function (e) { if (e.target === d) d.close(); }); // outside the box
      d.addEventListener("close", function () { d.remove(); });
      if (d.showModal) d.showModal(); else d.setAttribute("open", "");
      var box = d.querySelector(".nm-new-scroll"), list = box.querySelector("ul");
      function fade() { box.classList.toggle("more", list.scrollHeight - list.clientHeight - list.scrollTop > 4); }
      list.addEventListener("scroll", fade, { passive: true });
      window.addEventListener("resize", fade);
      fade();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(show, 600); });
    else setTimeout(show, 600); // a moment after the page appears
  }
})();
