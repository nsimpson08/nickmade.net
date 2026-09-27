// The Movies page's live sections, backed by the nickmade-queue Worker (worker/):
//   In the Queue      visitor suggestions after yours, then a "+" card to suggest one (or a closed card when full)
//   Recently Watched  movies you log from the site with the date you watched them, newest first
// Owner mode: open the page with ?admin and enter the ADMIN_TOKEN once; ?logout forgets it.
// In owner mode the + cards are always there, your picks have no "Suggested by", and every added movie gets a Remove button.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var section = document.getElementById("in-the-queue");
  var watchedSection = document.getElementById("recently-watched");
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

  // ---------- owner mode ----------

  var params = new URLSearchParams(location.search);
  var ADMIN = null;
  try {
    if (params.has("logout")) localStorage.removeItem("nm-admin-token");
    ADMIN = localStorage.getItem("nm-admin-token");
  } catch (e) {}

  function authHeaders(h) {
    h = h || {};
    if (ADMIN) h.Authorization = "Bearer " + ADMIN;
    return h;
  }

  function ownerBar() {
    var bar = document.createElement("div");
    bar.className = "owner-bar";
    bar.innerHTML = "<span>Owner mode</span> <a href=\"?logout\">Log out</a>";
    var head = document.querySelector(".page-head");
    head.parentNode.insertBefore(bar, head.nextSibling);
  }

  function login() {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog");
      d.className = "queue-dialog";
      d.innerHTML =
        '<form novalidate><h2>Owner login</h2>' +
        '<p class="hint">Enter your admin password. This browser will remember it.</p>' +
        '<label for="q-admin">Password</label><input id="q-admin" type="password" autocomplete="current-password">' +
        '<p class="error" role="alert"></p><button class="open submit" type="submit">Log in</button></form>';
      document.body.appendChild(d);
      var input = d.querySelector("input");
      var err = d.querySelector(".error");
      d.addEventListener("close", function () { d.remove(); resolve(); });
      d.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        var token = input.value.trim();
        fetch(API + "/admin/check", { headers: { Authorization: "Bearer " + token } }).then(function (r) {
          if (!r.ok) { err.textContent = "Wrong password."; return; }
          ADMIN = token;
          try { localStorage.setItem("nm-admin-token", token); } catch (e2) {}
          history.replaceState(null, "", location.pathname + location.hash);
          d.close();
        }).catch(function () { err.textContent = "Couldn't reach the server."; });
      });
      d.showModal();
      input.focus();
    });
  }

  function grid(sec) {
    sec = sec || section;
    var g = sec.querySelector(".poster-grid");
    if (!g) {
      var empty = sec.querySelector(".empty");
      g = document.createElement("div");
      g.className = "poster-grid";
      if (empty) empty.replaceWith(g); else sec.appendChild(g);
    }
    return g;
  }

  // IMDb images can be resized by editing the URL; ask for a card-sized copy
  function imgUrl(u, width) {
    if (!u) return "";
    if (/m\.media-amazon\.com/.test(u)) u = u.replace(/\._V1_[^.]*\./, "._V1_UX" + (width || 700) + "_.");
    return API + "/img?u=" + encodeURIComponent(u);
  }

  // r out of 5 in halves: a dim row of stars with a lit copy clipped to r/5 of its width
  function stars(r) {
    return '<span class="stars" style="--r:' + (+r || 0) + '"><span aria-hidden="true">★★★★★</span><span class="on" aria-hidden="true">★★★★★</span></span>';
  }
  function ratingText(r) {
    return r ? r + " out of 5 stars" : "No rating";
  }

  function watchedOn(date) {
    var d = new Date(date + "T00:00:00");
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // kind: "queue" (default) or "watched"
  function card(it, kind) {
    var watched = kind === "watched";
    var fig = document.createElement("figure");
    fig.className = "poster suggested";
    fig.dataset.imdb = it.imdbId;
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
      (watched && it.rating ? '<div class="rating" aria-label="' + ratingText(it.rating) + '">' + stars(it.rating) + "</div>" : "") +
      credit +
      (it.suggestedBy ? '<div class="suggested-by">Suggested by ' + esc(it.suggestedBy) + "</div>" : "") +
      (watched && it.date ? '<div class="watched-on">Watched ' + esc(watchedOn(it.date)) + "</div>" : "") +
      (ADMIN ? '<div class="owner-actions">' + (watched ? '<button class="edit" type="button">Edit</button>' : "") +
        '<button class="remove" type="button">Remove</button></div>' : "");
    if (ADMIN && watched) {
      fig.querySelector(".edit").addEventListener("click", function () { openDialog(state, "edit", it); });
    }
    if (ADMIN) {
      fig.querySelector(".remove").addEventListener("click", function () {
        if (!confirm("Remove " + it.title + " from " + (watched ? "Recently Watched" : "the queue") + "?")) return;
        var path = watched ? "/watched/" + encodeURIComponent(it.id) : "/queue/" + encodeURIComponent(it.imdbId);
        fetch(API + path, { method: "DELETE", headers: authHeaders() })
          .then(function (r) {
            if (!r.ok) throw new Error();
            fig.remove();
            if (watched) { updateCount(watchedSection); return; }
            state.remaining += 1;
            state.open = state.remaining > 0;
            updateCount();
          })
          .catch(function () { alert("Couldn't remove it. Try logging in again."); });
      });
    }
    return fig;
  }

  function updateCount(sec) {
    sec = sec || section;
    var count = sec.querySelector(".subhead .count");
    if (!count) {
      count = document.createElement("span");
      count.className = "count";
      sec.querySelector(".subhead").appendChild(count);
    }
    var n = sec.querySelectorAll(".poster-grid > .poster").length;
    count.textContent = (n < 10 ? "0" : "") + n;
  }

  var slot; // the + card or the closed card
  function renderSlot(state) {
    if (slot) slot.remove();
    var canAdd = ADMIN || (state.open && state.yourRemaining > 0);
    slot = document.createElement(canAdd ? "button" : "div");
    if (ADMIN) {
      slot.type = "button";
      slot.className = "queue-slot add";
      slot.setAttribute("aria-label", "Submit a movie to the queue");
      slot.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Suggest me a movie!</span>';
      slot.addEventListener("click", function () { openDialog(state, "queue"); });
    } else if (!state.open) {
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
      slot.addEventListener("click", function () { openDialog(state, "queue"); });
    }
    grid().appendChild(slot);
  }

  var state = null;
  var ready = (params.has("admin") && !ADMIN ? login() : Promise.resolve());
  ready
    .then(function () {
      if (ADMIN) ownerBar();
      return fetch(API + "/queue?visitorId=" + encodeURIComponent(VID));
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state = data;
      var g = grid();
      (data.items || []).forEach(function (it) { g.appendChild(card(it)); });
      updateCount();
      renderSlot(data);
    })
    .catch(function () { /* service unreachable: just show your own queue */ });

  // ---------- Recently Watched ----------

  var watchedSlot; // owner-only + card
  function renderWatchedSlot() {
    if (!ADMIN || !watchedSection) return;
    if (watchedSlot) watchedSlot.remove();
    watchedSlot = document.createElement("button");
    watchedSlot.type = "button";
    watchedSlot.className = "queue-slot add";
    watchedSlot.setAttribute("aria-label", "Log a movie you watched");
    watchedSlot.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Log a movie</span>';
    watchedSlot.addEventListener("click", function () { openDialog(state, "watched"); });
    grid(watchedSection).appendChild(watchedSlot);
  }

  function renderWatched(items) {
    var g = grid(watchedSection);
    g.querySelectorAll(".poster").forEach(function (el) { el.remove(); });
    items.forEach(function (it) { g.appendChild(card(it, "watched")); });
    updateCount(watchedSection);
    renderWatchedSlot();
  }

  if (watchedSection) {
    ready
      .then(function () { return fetch(API + "/watched"); })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = data.items || [];
        if (items.length || ADMIN) renderWatched(items); // visitors keep "Coming soon." until there's one
      })
      .catch(function () {});
  }

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
      '<label for="q-date">Date watched</label>' +
      '<input id="q-date" type="date">' +
      '<label id="q-rating-label">Your rating</label>' +
      '<div class="rate" id="q-rating" role="slider" tabindex="0" aria-labelledby="q-rating-label" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0" aria-valuetext="No rating">' +
        stars(0) + '<span class="rate-text">No rating</span>' +
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

  var nameLabel = dialog.querySelector('label[for="q-name"]');
  var dateInput = dialog.querySelector("#q-date");
  var dateLabel = dialog.querySelector('label[for="q-date"]');
  var heading = dialog.querySelector("h2");
  var mode = "queue"; // or "watched"

  // Star picker: click (or arrow keys) in half-star steps; clicking the current rating again clears it
  var rate = dialog.querySelector("#q-rating");
  var rateLabel = dialog.querySelector("#q-rating-label");
  var rateStars = rate.querySelector(".stars");
  var rateText = rate.querySelector(".rate-text");
  var rating = 0;
  // Picker-only helper phrases (never shown on the cards), indexed by half stars: 0.5 -> 1, 5 -> 10
  var PHRASES = ["", "Unwatchable", "Awful", "Bad", "Weak", "Mixed bag", "Good", "Really good", "Great", "Excellent", "Masterpiece"];
  function showRating(r) {
    rateStars.style.setProperty("--r", r);
    rateText.innerHTML = r ? esc(r) + ' <span class="phrase">' + PHRASES[r * 2] + "</span>" : "No rating";
  }
  function setRating(r) {
    rating = Math.max(0, Math.min(5, r));
    showRating(rating);
    rate.setAttribute("aria-valuenow", rating);
    rate.setAttribute("aria-valuetext", ratingText(rating));
  }
  function ratingAt(e) {
    var box = rateStars.getBoundingClientRect();
    return Math.max(0.5, Math.min(5, Math.ceil(((e.clientX - box.left) / box.width) * 10) / 2));
  }
  rateStars.addEventListener("pointermove", function (e) { showRating(ratingAt(e)); });
  rateStars.addEventListener("pointerleave", function () { showRating(rating); });
  rateStars.addEventListener("click", function (e) {
    var r = ratingAt(e);
    setRating(r === rating ? 0 : r);
  });
  rate.addEventListener("keydown", function (e) {
    var step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
    if (step) setRating(rating + step);
    else if (e.key === "Home" || e.key === "Delete" || e.key === "Backspace") setRating(0);
    else if (e.key === "End") setRating(5);
    else return;
    e.preventDefault();
  });

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function submitLabel() {
    return mode === "edit" ? "Save changes" : mode === "watched" ? "Add to Recently Watched" : ADMIN ? "Add to my queue" : "Add to the queue";
  }

  function resetFields() {
    chosen = null;
    movie.value = "";
    dateInput.value = "";
    setRating(0);
  }

  // m: "queue", "watched" (log a movie) or "edit" (change the rating/date of a Recently Watched movie `it`)
  var editing = null;
  function openDialog(s, m, it) {
    if (mode === "edit") resetFields(); // don't carry an edited movie into a new one
    mode = m || "queue";
    editing = mode === "edit" ? it : null;
    var watching = mode === "watched" || !!editing;
    nameLabel.hidden = nameInput.hidden = !!ADMIN;
    dateLabel.hidden = dateInput.hidden = !watching;
    rateLabel.hidden = rate.hidden = !watching;
    movie.readOnly = !!editing;
    dateInput.max = today();
    if (editing) {
      chosen = { id: it.imdbId };
      movie.value = it.title + (it.year ? " (" + it.year + ")" : "");
      dateInput.value = it.date;
      setRating(it.rating || 0);
    }
    if (watching && !dateInput.value) dateInput.value = today();
    heading.textContent = editing ? "Edit " + it.title : watching ? "Log a movie" : ADMIN ? "Submit a movie" : "Suggest a movie";
    submit.textContent = submitLabel();
    hint.textContent = editing
      ? "Change your rating or the date you watched it."
      : watching
      ? "Shows up in Recently Watched, newest first. If it's in the queue, it comes out of the queue."
      : ADMIN
      ? "Goes straight into your queue. " + (s ? s.remaining : 0) + " spot" + (s && s.remaining === 1 ? "" : "s") + " left for visitors."
      : "You can add " + s.yourRemaining + " more. " + s.remaining + " spot" + (s.remaining === 1 ? "" : "s") + " left in the queue.";
    errorEl.textContent = "";
    validate();
    dialog.showModal();
    (editing ? rate : movie).focus();
  }
  dialog.querySelector(".close").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });

  function validate() {
    submit.disabled = !(chosen && (ADMIN || nameInput.value.trim()) && (mode === "queue" || dateInput.value));
  }
  nameInput.addEventListener("input", validate);
  dateInput.addEventListener("input", validate);

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
    (ADMIN ? submit : nameInput).focus();
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
    if (submit.disabled) return;
    if (editing) return saveEdit();
    var watching = mode === "watched";
    submit.disabled = true;
    submit.textContent = "Finding poster art…";
    errorEl.textContent = "";
    if (!ADMIN) { try { localStorage.setItem("nm-name", nameInput.value.trim()); } catch (e2) {} }
    var label = submitLabel();
    fetch(API + (watching ? "/watched" : "/queue"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(watching
        ? { imdbId: chosen.id, date: dateInput.value, rating: rating }
        : { imdbId: chosen.id, name: ADMIN ? "" : nameInput.value.trim(), visitorId: VID }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        submit.textContent = label;
        if (!res.ok) { errorEl.textContent = res.d.error || "Couldn't add that one."; validate(); return; }
        if (watching) {
          if (res.d.removedFromQueue) {
            var old = section.querySelector('.poster.suggested[data-imdb="' + res.d.item.imdbId + '"]');
            if (old) old.remove();
            state.remaining += 1;
            state.open = state.remaining > 0;
            updateCount();
          }
          return reloadWatched();
        }
        grid().insertBefore(card(res.d.item), slot);
        state.yourRemaining = res.d.yourRemaining;
        state.remaining = res.d.remaining;
        state.open = res.d.open;
        renderSlot(state);
        updateCount();
        chosen = null;
        movie.value = "";
        validate();
        dialog.close();
      })
      .catch(function () {
        submit.textContent = label;
        errorEl.textContent = "Couldn't reach the server. Try again in a bit.";
        validate();
      });
  });

  function reloadWatched() {
    return fetch(API + "/watched").then(function (r) { return r.json(); }).then(function (data) {
      renderWatched(data.items || []);
      resetFields();
      validate();
      dialog.close();
    });
  }

  function saveEdit() {
    submit.disabled = true;
    submit.textContent = "Saving…";
    errorEl.textContent = "";
    fetch(API + "/watched/" + encodeURIComponent(editing.id), {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ date: dateInput.value, rating: rating }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        submit.textContent = submitLabel();
        if (!res.ok) { errorEl.textContent = res.d.error || "Couldn't save that."; validate(); return; }
        return reloadWatched();
      })
      .catch(function () {
        submit.textContent = submitLabel();
        errorEl.textContent = "Couldn't reach the server. Try again in a bit.";
        validate();
      });
  }
})();
