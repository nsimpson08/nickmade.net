// Mini players for song previews rendered by reviews.js (.track elements).
// Streams Apple's 30-second preview for the track id; nothing is hosted on this site.
(function () {
  var audio = new Audio();
  audio.preload = "none";
  var current = null; // the .track element that owns the audio
  var previews = {};  // track id -> preview URL

  var saved = 0.7;
  try { saved = parseFloat(localStorage.getItem("nm-volume")) || 0.7; } catch (e) {}
  audio.volume = saved;

  // iOS ignores audio.volume (hardware buttons only), so hide the sliders there.
  audio.volume = 0.5;
  var volumeWorks = audio.volume === 0.5;
  audio.volume = saved;

  function lookup(id) {
    if (previews[id]) return Promise.resolve(previews[id]);
    return fetch("https://itunes.apple.com/lookup?id=" + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var url = d.results && d.results[0] && d.results[0].previewUrl;
        if (!url) throw new Error("No preview for " + id);
        previews[id] = url;
        return url;
      });
  }

  function setState(el, state) {
    if (!el) return;
    el.classList.toggle("playing", state === "playing");
    el.classList.toggle("loading", state === "loading");
    el.classList.toggle("unavailable", state === "unavailable");
    var btn = el.querySelector(".track-play");
    var title = el.querySelector(".track-title").textContent;
    btn.setAttribute("aria-label", (state === "playing" ? "Pause " : "Play ") + title);
  }

  function stop() {
    audio.pause();
    if (current) {
      setState(current, "");
      current.querySelector(".track-bar span").style.width = "0";
    }
  }

  function play(el) {
    var id = el.getAttribute("data-track-id");
    if (current && current !== el) stop();
    current = el;
    setState(el, "loading");
    lookup(id).then(function (url) {
      if (current !== el) return;
      if (audio.src !== url) audio.src = url;
      return audio.play().then(function () { setState(el, "playing"); });
    }).catch(function () {
      setState(el, "unavailable");
    });
  }

  audio.addEventListener("timeupdate", function () {
    if (!current || !audio.duration) return;
    current.querySelector(".track-bar span").style.width = (audio.currentTime / audio.duration * 100) + "%";
  });
  audio.addEventListener("ended", function () {
    stop();
    audio.currentTime = 0;
  });

  document.querySelectorAll(".track[data-track-id]").forEach(function (el) {
    var slider = el.querySelector(".track-volume input");
    slider.value = audio.volume;
    if (!volumeWorks) el.querySelector(".track-volume").hidden = true;

    el.querySelector(".track-play").addEventListener("click", function () {
      if (current === el && !audio.paused) {
        audio.pause();
        setState(el, "");
      } else if (current === el && audio.src && audio.currentTime > 0) {
        audio.play().then(function () { setState(el, "playing"); });
      } else {
        play(el);
      }
    });

    slider.addEventListener("input", function () {
      audio.volume = parseFloat(slider.value);
      document.querySelectorAll(".track[data-track-id] .track-volume input").forEach(function (s) { s.value = slider.value; });
      try { localStorage.setItem("nm-volume", slider.value); } catch (e) {}
    });
  });
})();
