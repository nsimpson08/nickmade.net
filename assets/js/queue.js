// Visitor submissions for the Movies "In the Queue" section, backed by the nickmade-queue Worker (worker/).
// Adds submitted movies after yours, then a "+" card to suggest one (or a closed card when full).
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var section = document.getElementById("in-the-queue");
  if (!API || !section) return;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // A random id this browser keeps, used (with the server's hashed IP) for the 3-per-person limit
  function visitorId() {
    var id = null;
    try { id = localStorage.getItem("nm-visitor"); } catch (e) {}
    if (!id) {
      var m = document.cookie.match(/(?:^|; )nm_visitor=([^;]+)/);
      id = m ? m[1] : null;
    }
    if (!id) id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    try { localStorage.setItem("nm-visitor", id); } catch (e) {}
    document.cookie = "nm_visitor=" + id + "; max-age=31536000; path=/; SameSite=Lax";
    return id;
  }
  var VID = visitorId();

  function grid() {
    var g = section.querySelector(".poster-grid");
    if (!g) {
      var empty = section.querySelector(".empty");
      g = document.createElement("div");
      g.className = "poster-grid";
      if (empty) empty.replaceWith(g); else section.appendChild(g);
    }
    return g;
  }

  // IMDb images can be resized by editing the URL; ask for a card-sized copy
  function imgUrl(u, width) {
    if (!u) return "";
    if (/m\.media-amazon\.com/.test(u)) u = u.replace(/\._V1_[^.]*\./, "._V1_UX" + (width || 700) + "_.");
    return API + "/img?u=" + encodeURIComponent(u);
  }

  function card(it) {
    var fig = document.createElement("figure");
    fig.className = "poster suggested";
    var credit = "";
    if (it.credit && it.credit.artist) {
      credit = '<div class="credit">Art by <a href="' + esc(it.credit.url) + '" target="_blank" rel="noopener">' + esc(it.credit.artist) + "</a></div>";
    } else {
      credit = '<div class="credit">Official poster</div>';
    }
    fig.innerHTML =
      (it.image
        ? '<div class="art"><img src="' + esc(imgUrl(it.image)) + '" alt="' + esc(it.title) + ' poster art" loading="lazy"></div>'
        : '<div class="art blank">' + esc(it.title) + "</div>") +
      '<figcaption><span class="title">' + esc(it.title) + "</span>" +
      (it.year ? ' <span class="year">' + esc(it.year) + "</span>" : "") + "</figcaption>" +
      credit +
      '<div class="suggested-by">Suggested by ' + esc(it.suggestedBy) + "</div>";
    return fig;
  }

  function updateCount() {
    var count = section.querySelector(".subhead .count");
    var n = section.querySelectorAll(".poster-grid > .poster").length;
    if (count) count.textContent = (n < 10 ? "0" : "") + n;
  }

  var slot; // the + card or the closed card
  function renderSlot(state) {
    if (slot) slot.remove();
    slot = document.createElement(state.open && state.yourRemaining > 0 ? "button" : "div");
    if (!state.open) {
      slot.className = "queue-slot closed";
      slot.innerHTML = "<span>Not taking submissions at this time</span>";
    } else if (state.yourRemaining <= 0) {
      slot.className = "queue-slot closed";
      slot.innerHTML = "<span>Thanks for your " + state.perVisitor + " picks!</span>";
    } else {
      slot.type = "button";
      slot.className = "queue-slot add";
      slot.setAttribute("aria-label", "Suggest a movie for the queue");
      slot.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Suggest a movie</span>';
      slot.addEventListener("click", function () { openDialog(state); });
    }
    grid().appendChild(slot);
  }

  var state = null;
  fetch(API + "/queue?visitorId=" + encodeURIComponent(VID))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state = data;
      var g = grid();
      (data.items || []).forEach(function (it) { g.appendChild(card(it)); });
      updateCount();
      renderSlot(data);
    })
    .catch(function () { /* service unreachable: just show your own queue */ });

  // ---------- the add-a-movie dialog ----------

  var dialog = document.createElement("dialog");
  dialog.className = "queue-dialog";
  dialog.innerHTML =
    '<form method="dialog" novalidate>' +
      '<button class="close" type="button" aria-label="Close">&times;</button>' +
      "<h2>Suggest a movie</h2>" +
      '<p class="hint"></p>' +
      '<label for="q-movie">Movie</label>' +
      '<div class="combo">' +
        '<input id="q-movie" type="text" autocomplete="off" placeholder="Start typing a title" role="combobox" aria-expanded="false" aria-controls="q-results" aria-autocomplete="list">' +
        '<ul id="q-results" role="listbox" hidden></ul>' +
      "</div>" +
      '<label for="q-name">Your name</label>' +
      '<input id="q-name" type="text" maxlength="40" autocomplete="nickname" placeholder="So Nick knows who it\'s from">' +
      '<p class="error" role="alert"></p>' +
      '<button class="open submit" type="submit" disabled>Add to the queue</button>' +
    "</form>";
  document.body.appendChild(dialog);

  var form = dialog.querySelector("form");
  var movie = dialog.querySelector("#q-movie");
  var list = dialog.querySelector("#q-results");
  var nameInput = dialog.querySelector("#q-name");
  var errorEl = dialog.querySelector(".error");
  var submit = dialog.querySelector(".submit");
  var hint = dialog.querySelector(".hint");
  var chosen = null;
  var results = [];
  var active = -1;
  var timer = null;
  var seq = 0;

  try { nameInput.value = localStorage.getItem("nm-name") || ""; } catch (e) {}

  function openDialog(s) {
    hint.textContent = "You can add " + s.yourRemaining + " more. " + s.remaining + " spot" + (s.remaining === 1 ? "" : "s") + " left in the queue.";
    errorEl.textContent = "";
    dialog.showModal();
    movie.focus();
  }
  dialog.querySelector(".close").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });

  function validate() {
    submit.disabled = !(chosen && nameInput.value.trim());
  }
  nameInput.addEventListener("input", validate);

  function showResults() {
    list.innerHTML = results.map(function (r, i) {
      return '<li role="option" id="q-opt-' + i + '"' + (i === active ? ' aria-selected="true"' : "") + ' data-i="' + i + '">' +
        (r.image ? '<img src="' + esc(imgUrl(r.image, 80)) + '" alt="">' : '<span class="noimg"></span>') +
        '<span class="t">' + esc(r.title) + (r.year ? ' <span class="y">' + r.year + "</span>" : "") +
        (r.stars ? '<span class="s">' + esc(r.stars) + "</span>" : "") + "</span></li>";
    }).join("");
    list.hidden = !results.length;
    movie.setAttribute("aria-expanded", String(!!results.length));
    movie.setAttribute("aria-activedescendant", active >= 0 ? "q-opt-" + active : "");
  }

  function pick(i) {
    chosen = results[i];
    movie.value = chosen.title + (chosen.year ? " (" + chosen.year + ")" : "");
    results = [];
    showResults();
    validate();
    nameInput.focus();
  }

  movie.addEventListener("input", function () {
    chosen = null;
    validate();
    clearTimeout(timer);
    var q = movie.value.trim();
    if (q.length < 2) { results = []; showResults(); return; }
    timer = setTimeout(function () {
      var mine = ++seq;
      fetch(API + "/search?q=" + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (mine !== seq) return;
          results = data.results || [];
          active = -1;
          showResults();
        })
        .catch(function () {});
    }, 220);
  });

  movie.addEventListener("keydown", function (e) {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); showResults(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); showResults(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { pick(active); e.preventDefault(); }
    else if (e.key === "Escape") { results = []; showResults(); e.preventDefault(); }
  });
  list.addEventListener("mousedown", function (e) {
    var li = e.target.closest("li");
    if (li) { e.preventDefault(); pick(+li.dataset.i); }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!chosen || !nameInput.value.trim()) return;
    submit.disabled = true;
    submit.textContent = "Finding poster art…";
    errorEl.textContent = "";
    try { localStorage.setItem("nm-name", nameInput.value.trim()); } catch (e2) {}
    fetch(API + "/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imdbId: chosen.id, name: nameInput.value.trim(), visitorId: VID }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        submit.textContent = "Add to the queue";
        if (!res.ok) { errorEl.textContent = res.d.error || "Couldn't add that one."; validate(); return; }
        grid().insertBefore(card(res.d.item), slot);
        state.yourRemaining = res.d.yourRemaining;
        state.remaining = Math.max(0, state.remaining - 1);
        state.open = res.d.open;
        renderSlot(state);
        updateCount();
        chosen = null;
        movie.value = "";
        validate();
        dialog.close();
      })
      .catch(function () {
        submit.textContent = "Add to the queue";
        errorEl.textContent = "Couldn't reach the server. Try again in a bit.";
        validate();
      });
  });
})();
