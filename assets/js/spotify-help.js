// "Not recognizing your Spotify Premium?" (Nick, 2026-11-02): a small link under the Spotify players (the
// Music page, a record's card on Vinyl) that opens the steps for getting the player on this page to see your Spotify
// login, so it plays whole songs. Browsers that keep a site's embeds apart from your other tabs (Firefox's Enhanced
// Tracking Protection, Safari's cross-site tracking, Edge's Strict mode) hand the player a fresh, logged-out Spotify.
// The visitor's own browser comes first, open; the others below, folded.
//   NMSpotifyHelp.link(): the link's HTML. Any .sp-help-link on the page opens the box.
(function () {
  var host = location.host || "nickmade.net";
  var ua = navigator.userAgent;
  var mine = /Firefox\//.test(ua) ? "firefox" : /Edg\//.test(ua) ? "edge" : /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Android/.test(ua) ? "safari" : "chrome";
  var STEPS = {
    firefox: ["Firefox",
      "<li>Click the <b>shield</b> at the left of the address bar.</li>" +
      "<li>Turn <b>Enhanced Tracking Protection</b> off for " + host + ". The page reloads.</li>" +
      "<li>Still not working? In <b>Settings → Privacy &amp; Security → Cookies and Site Data → Manage Exceptions</b>, add <code>https://open.spotify.com</code> and choose <b>Allow</b>.</li>"],
    safari: ["Safari",
      "<li><b>Mac:</b> Safari → Settings → Privacy, untick <b>Prevent cross-site tracking</b>.</li>" +
      "<li><b>iPhone or iPad:</b> Settings → Apps → Safari, turn off <b>Prevent Cross-Site Tracking</b>.</li>" +
      "<li>Reload this page. (This one is for every site, so you may want to turn it back on later.)</li>"],
    chrome: ["Chrome",
      "<li>Chrome usually works as it is.</li>" +
      "<li>If not, click the <b>eye</b> (or the settings icon) at the left of the address bar and allow <b>third-party cookies</b> for " + host + ".</li>" +
      "<li>Reload this page.</li>"],
    edge: ["Edge",
      "<li>Click the <b>lock</b> at the left of the address bar.</li>" +
      "<li>Turn <b>Tracking prevention</b> off for " + host + " (Strict mode blocks the player's login).</li>" +
      "<li>Reload this page.</li>"],
  };
  var box = null;
  function open() {
    if (!box) {
      box = document.createElement("dialog");
      box.className = "lib-dialog sp-help";
      var order = [mine].concat(Object.keys(STEPS).filter(function (k) { return k !== mine; }));
      box.innerHTML = '<button type="button" class="close" aria-label="Close">×</button>' +
        "<h2>Play whole songs</h2>" +
        "<p>The Spotify player here plays 30-second previews until it knows you're logged in. With Spotify Premium it can play every song in full.</p>" +
        "<ol class=\"sp-help-first\"><li>Log in at <a href=\"https://open.spotify.com\" target=\"_blank\" rel=\"noopener\">open.spotify.com</a> in this browser (not in a private window).</li>" +
        "<li>Then, for your browser:</li></ol>" +
        order.map(function (k, i) {
          return "<details" + (i ? "" : " open") + "><summary>" + STEPS[k][0] + (i ? "" : " <small>(yours)</small>") + "</summary><ol>" + STEPS[k][1] + "</ol></details>";
        }).join("") +
        '<p class="sp-help-note">Still a preview? Press <b>Log in</b> inside the player, and allow it if the browser asks. Without Premium, Spotify only plays previews here.</p>';
      box.addEventListener("click", function (e) { if (e.target === box || e.target.closest(".close")) box.close(); });
      document.body.appendChild(box);
    }
    box.showModal();
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".sp-help-link");
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    open();
  }, true);
  window.NMSpotifyHelp = {
    link: function () { return '<a href="#" class="sp-help-link">Not recognizing your Spotify Premium?</a>'; },
  };
})();
