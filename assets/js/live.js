// Live sections on the Movies and Games pages, backed by the nickmade-queue Worker (worker/):
//   live: "queue"    In the Queue: visitor suggestions after yours, then a "+" card to suggest one (or a closed card when full)
//   live: "watched"  Recently Watched/Played: what you log from the site with the date and a rating, newest first
//   live: any other key: movies/games you add from the site, shown after the ones in list.js
// Owner mode: open the page with ?admin and enter the ADMIN_TOKEN once; ?logout forgets it.
// In owner mode the + cards are always there, your picks have no "Suggested by", and every site-added one gets a Remove button.
// Site additions live in Cloudflare, not in this repo; tools/pull_live.py copies them into list.js.
(function () {
  var script = document.currentScript;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local ? script.dataset.apiLocal : script.dataset.api) || "";
  var PAGE = script.dataset.page || "movies";
  var KIND = PAGE === "games" ? "game" : "movie";
  var DID = PAGE === "games" ? "Played" : "Watched"; // "Watched Sep 4, 2026" / "Played Sep 4, 2026"
  var LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  var COMMENT_MAX = 200; // visitors' "Why should Nick watch it?" note (the Worker enforces the same limit)
  var PQ = "page=" + PAGE;
  if (!API) return;

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function sectionFor(key) {
    var sec = (window.SECTIONS || []).filter(function (s) { return s.live === key && s.title; })[0];
    return sec ? { title: sec.title, el: document.getElementById(slug(sec.title)) } : { title: "", el: null };
  }
  var queueSec = sectionFor("queue");
  var watchedSec = sectionFor("watched");
  var section = queueSec.el;
  var watchedSection = watchedSec.el;

  // Other sections marked live: "key" in list.js (the key names their storage, so renaming the title is safe)
  var LISTS = (window.SECTIONS || []).filter(function (s) { return s.live && s.live !== "queue" && s.live !== "watched" && s.title; }).map(function (s) {
    return { key: s.live, title: s.title, el: document.getElementById(slug(s.title)), slot: null };
  }).filter(function (l) { return l.el; });

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
    if (/store-images\.s-microsoft\.com/.test(u)) u = u.replace(/\?.*$/, "") + "?w=" + (width || 700);
    return API + "/img?u=" + encodeURIComponent(u);
  }

  // r out of 5 in halves: a dim row of stars with a lit copy clipped to r/5 of its width
  function stars(r) {
    return '<span class="stars" style="--r:' + (+r || 0) + '"><span aria-hidden="true">★★★★★</span><span class="on" aria-hidden="true">★★★★★</span></span>';
  }
  function ratingText(r) {
    return r ? r + " out of 5 stars" : "No rating";
  }

  // Minutes played -> "33h 30m" / "45m"
  function playtime(min) {
    if (min == null) return "";
    var h = Math.floor(min / 60);
    return h ? h + "h" + (min % 60 ? " " + (min % 60) + "m" : "") : min + "m";
  }

  // Local YYYY-MM-DD for an ISO timestamp
  function localDate(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // "2026-05-19" -> "May 2026"; "2026" stays "2026"
  function releasedOn(r) {
    if (!/^\d{4}-\d{2}/.test(r)) return String(r);
    return new Date(r.slice(0, 7) + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  function watchedOn(date) {
    var d = new Date(date + "T00:00:00");
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // kind: "queue" (default), "watched", or "list" (then l is the live section it belongs to)
  function card(it, kind, l) {
    var watched = kind === "watched";
    // a visitor's own queue suggestion (the Worker marks it mine for their browser): they can edit or remove it
    var yours = !ADMIN && !watched && !l && it.mine;
    var fig = document.createElement("figure");
    fig.className = "poster suggested";
    fig.dataset.imdb = it.imdbId;
    var credit = "";
    if (it.credit && it.credit.artist) {
      credit = '<div class="credit">Art by <a href="' + esc(it.credit.url) + '" target="_blank" rel="noopener">' + esc(it.credit.artist) + "</a></div>";
    } else if (!(PAGE === "games" && (watched || !l))) {
      // Games' Recently Played and In the Queue are always official art, so they go unlabeled there
      credit = '<div class="credit">Official poster</div>';
    }
    // In a section with song players, leave the same empty player box the list.js items without a song get
    var track = l && l.el.querySelector(".track")
      ? '<div class="track track-empty"><div class="track-row"><span class="track-play"></span><div class="track-text"><span class="track-title"></span></div></div><div class="track-bar"><span></span></div></div>'
      : "";
    fig.innerHTML = track +
      (it.image
        ? '<div class="art"><img src="' + esc(imgUrl(it.image)) + '" alt="' + esc(it.title) + ' poster art" loading="lazy"></div>'
        : '<div class="art blank">' + esc(it.title) + "</div>") +
      '<figcaption><span class="title">' + esc(it.title) + "</span>" +
      (watched && it.xbox && it.released
        ? ' <span class="year">Released: ' + esc(releasedOn(it.released)) + "</span>"
        : it.year ? ' <span class="year">' + esc(it.year) + "</span>" : "") + "</figcaption>" +
      (watched && it.rating ? '<div class="rating" aria-label="' + ratingText(it.rating) + '">' + stars(it.rating) + "</div>" : "") +
      credit +
      (it.suggestedBy ? '<div class="suggested-by">Suggested by ' + esc(it.suggestedBy) + "</div>" : "") +
      (it.comment
        ? '<blockquote class="suggest-comment' + (it.commentPrivate ? " private" : "") + '" title="' + esc(it.comment) + '">' + esc(it.comment) + "</blockquote>" +
          (it.commentPrivate ? '<div class="comment-private">' + LOCK + (ADMIN ? "Only you can see this" : "Only you and Nick can see this") + "</div>" : "")
        : "") +
      (watched && it.xbox
        ? '<div class="xbox-stats">' +
            (it.xbox.minutes != null ? "<span>" + esc(playtime(it.xbox.minutes)) + " played</span>" : "") +
            (it.xbox.percent != null ? '<span' + (it.xbox.percent >= 100 ? ' class="complete"' : "") + // 100%: gold (site.css)
              ' title="' + esc(it.xbox.gamerscore + " / " + it.xbox.totalGamerscore + " Gamerscore" + (it.xbox.percent >= 100 ? ", 100% complete" : "")) + '">Achievements ' + esc(it.xbox.percent) + "%</span>" : "") +
          "</div>"
        : "") +
      (watched && it.date ? '<div class="watched-on">' + (it.xbox ? "Last played" : DID) + " " + esc(watchedOn(it.date)) + "</div>" : "") +
      (ADMIN ? '<div class="owner-actions">' + (watched ? '<button class="edit" type="button">Edit</button>' : "") +
        '<button class="remove" type="button">Remove</button></div>'
        : yours ? '<div class="owner-actions mine-actions"><span>Your suggestion</span><button class="edit" type="button">Edit</button>' +
          '<button class="remove" type="button">Remove</button></div>' : "");
    if (ADMIN && watched) {
      fig.querySelector(".edit").addEventListener("click", function () { openDialog(state, "edit", it); });
    }
    if (ADMIN) {
      fig.querySelector(".remove").addEventListener("click", function () {
        if (!confirm("Remove " + it.title + " from " + (l ? l.title : watched ? watchedSec.title : "the queue") + "?")) return;
        var path = l ? "/lists/" + PAGE + "/" + encodeURIComponent(l.key) + "/" + encodeURIComponent(it.imdbId)
          : (watched ? "/watched/" + encodeURIComponent(it.id) : "/queue/" + encodeURIComponent(it.imdbId)) + "?" + PQ;
        fetch(API + path, { method: "DELETE", headers: authHeaders() })
          .then(function (r) {
            if (!r.ok) throw new Error();
            fig.remove();
            if (l || watched) return;
            state.remaining += 1;
            state.open = state.remaining > 0;
          })
          .catch(function () { alert("Couldn't remove it. Try logging in again."); });
      });
    }
    if (yours) {
      fig.querySelector(".edit").addEventListener("click", function () { openDialog(state, "mine", it); });
      fig.querySelector(".remove").addEventListener("click", function () {
        if (!confirm("Remove your suggestion of " + it.title + "? You'll get the spot back.")) return;
        fetch(API + "/queue/" + encodeURIComponent(it.imdbId) + "?" + PQ + "&visitorId=" + encodeURIComponent(VID), { method: "DELETE" })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.d.error);
            fig.remove();
            if (res.d.remaining != null) {
              state.remaining = res.d.remaining;
              state.open = res.d.open;
              state.yourRemaining = res.d.yourRemaining;
              renderSlot(state);
            }
          })
          .catch(function (e) { alert((e && e.message) || "Couldn't remove it. Try again in a bit."); });
      });
    }
    return fig;
  }

  var slot; // the + card or the closed card
  function renderSlot(state) {
    if (slot) slot.remove();
    var canAdd = ADMIN || (state.open && state.yourRemaining > 0);
    slot = document.createElement(canAdd ? "button" : "div");
    if (ADMIN) {
      slot.type = "button";
      slot.className = "queue-slot add";
      slot.setAttribute("aria-label", "Add a " + KIND + " to the queue");
      slot.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Suggest me a ' + KIND + "!</span>";
      slot.addEventListener("click", function () { openDialog(state, "queue"); });
    } else if (!state.open) {
      slot.className = "queue-slot closed";
      slot.innerHTML = "<span>Not taking submissions at this time</span>";
    } else if (state.yourRemaining <= 0) {
      slot.className = "queue-slot closed";
      // removing one of theirs gives the spot back, so say so
      slot.innerHTML = "<span>Thanks for your " + state.perVisitor + " picks!</span>" +
        '<span class="left">Remove one of yours to suggest another</span>';
    } else {
      slot.type = "button";
      slot.className = "queue-slot add";
      var left = state.yourRemaining + " of " + state.perVisitor + " left";
      slot.setAttribute("aria-label", "Suggest a " + KIND + " for the queue (" + left + ")");
      slot.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Suggest a ' + KIND + "</span>" +
        '<span class="left">' + left + "</span>";
      slot.addEventListener("click", function () { openDialog(state, "queue"); });
    }
    grid().appendChild(slot);
  }

  var state = null;
  var ready = (params.has("admin") && !ADMIN ? login() : Promise.resolve());
  ready.then(function () { if (ADMIN) ownerBar(); });
  if (section) {
    ready
      .then(function () { return fetch(API + "/queue?" + PQ + "&visitorId=" + encodeURIComponent(VID), { headers: authHeaders() }); })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state = data;
        var g = grid();
        (data.items || []).forEach(function (it) { if (!inSection(section, it.title)) g.appendChild(card(it)); });
        renderSlot(data);
        return loadVotes();
      })
      .catch(function () { /* service unreachable: just show your own queue */ });
  }

  // ---------- votes on In the Queue ----------
  // Every queue poster (list.js picks and suggestions) gets an upvote button under it, right of the title; most-voted go first.
  // The order is set when the page loads, not on each click, so a poster doesn't jump away from the cursor.
  // Every title starts at 1: whoever added it counts as its first vote. So a visitor's own suggestion shows as voted
  // and can't be clicked, and in owner mode the pills only show the counts (Nick's picks are already his votes).
  // Votes are keyed by sameTitle() (the Worker's normalize). See worker/src/votes.js.
  var votes = {}, myVotes = {}, ownVotes = {};
  var ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5 13 9.5H9.6V13H6.4V9.5H3z" fill="currentColor"/></svg>';
  function loadVotes() {
    return fetch(API + "/votes?" + PQ + "&visitorId=" + encodeURIComponent(VID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        votes = d.votes || {};
        myVotes = {};
        ownVotes = {};
        (d.mine || []).forEach(function (k) { myVotes[k] = true; });
        (d.own || []).forEach(function (k) { ownVotes[k] = true; });
        applyVotes(true);
      })
      .catch(function () {});
  }
  function queuePosters() {
    return [].filter.call(grid().querySelectorAll(".poster"), function (fig) { return fig.querySelector(".title"); });
  }
  function voteKey(fig) { return sameTitle(fig.querySelector(".title").textContent); }
  function voteCount(k) { return votes[k] || 1; } // 1 = just the adder's vote
  function paintVote(btn, k) {
    var n = voteCount(k), own = !!ownVotes[k], on = own || !!myVotes[k];
    var votes_ = n + (n === 1 ? " vote" : " votes");
    btn.classList.toggle("on", on);
    btn.classList.toggle("own", own);
    btn.classList.toggle("display", !!ADMIN);
    btn.disabled = own || !!ADMIN;
    btn.setAttribute("aria-pressed", String(on));
    btn.title = own ? "Your suggestion counts as your vote" : ADMIN ? votes_ : "";
    btn.setAttribute("aria-label", own ? "Your suggestion counts as your vote (" + votes_ + ")"
      : ADMIN ? votes_ : (on ? "Take back your vote" : "Upvote") + " (" + votes_ + ")");
    btn.querySelector(".n").textContent = n;
  }
  function applyVotes(sort) {
    if (!section) return;
    if (!ADMIN && !section.querySelector(".vote-hint")) {
      var hint = document.createElement("p");
      hint.className = "vote-hint";
      hint.innerHTML = ARROW + "<span>Vote for what I should " + (PAGE === "games" ? "play" : "watch") + " next</span>";
      section.querySelector(".subhead").after(hint);
    }
    queuePosters().forEach(function (fig) {
      var k = voteKey(fig);
      var btn = fig.querySelector(".vote");
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "vote";
        btn.innerHTML = ARROW + '<span class="n"></span>';
        btn.addEventListener("click", function () { castVote(btn, k); });
        (fig.querySelector("figcaption") || fig).appendChild(btn); // under the poster, on the right of the title
      }
      paintVote(btn, k);
    });
    if (!sort) return;
    // Most votes first; ties keep their current order (Array sort is stable). The + card stays last.
    var g = grid();
    queuePosters()
      .map(function (fig, i) { return { fig: fig, i: i, n: voteCount(voteKey(fig)) }; })
      .sort(function (a, b) { return b.n - a.n || a.i - b.i; })
      .forEach(function (x) { g.insertBefore(x.fig, slot && slot.parentNode === g ? slot : null); });
  }
  // A vote that gives a poster more votes than every other one (a tie isn't enough) slides it into the first slot,
  // the rest sliding along one place to make room (FLIP: note where everything is, move it, then animate from there).
  function takeTheLead(fig, k) {
    var all = queuePosters();
    if (all[0] === fig) return;
    var n = voteCount(k);
    var beaten = all.every(function (f) { return f === fig || voteCount(voteKey(f)) < n; });
    if (!beaten) return;
    var g = grid();
    var moving = all.concat(slot && slot.parentNode === g ? [slot] : []);
    var before = moving.map(function (el) { return el.getBoundingClientRect(); });
    g.insertBefore(fig, all[0]);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    fig.classList.add("lead-new"); // above the others while it passes over them, then a glow
    moving.forEach(function (el, i) {
      var now = el.getBoundingClientRect();
      var dx = before[i].left - now.left, dy = before[i].top - now.top;
      if (!dx && !dy) return;
      el.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }],
        { duration: el === fig ? 750 : 550, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    setTimeout(function () { fig.classList.remove("lead-new"); }, 1600);
  }
  function castVote(btn, k) {
    var fig = btn.closest(".poster");
    if (ownVotes[k] || ADMIN) return;
    var on = !myVotes[k];
    // show it right away; put it back if the Worker says no
    var before = { n: voteCount(k), on: !!myVotes[k] };
    votes[k] = before.n + (on ? 1 : -1);
    if (on) myVotes[k] = true; else delete myVotes[k];
    paintVote(btn, k);
    btn.disabled = true;
    fetch(API + "/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: PAGE, title: fig.querySelector(".title").textContent, visitorId: VID, vote: on }),
    })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Couldn't save your vote."); return d; }); })
      .then(function (d) {
        votes[k] = d.count;
        if (d.voted) myVotes[k] = true; else delete myVotes[k];
        if (d.voted) takeTheLead(fig, k);
      })
      .catch(function (e) {
        votes[k] = before.n;
        if (before.on) myVotes[k] = true; else delete myVotes[k];
        alert(e.message);
      })
      .then(function () { paintVote(btn, k); });
  }

  // ---------- live sections (owner adds from the site) ----------

  // Is this title already in the section? Once tools/pull_live.py copies a site addition into list.js and it's
  // pushed, both copies exist until the script's next run clears the live one; show just the list.js one.
  function inSection(el, title) {
    return [].some.call(el.querySelectorAll(".poster:not(.suggested) .title"), function (t) {
      return t.textContent.trim().toLowerCase() === String(title).toLowerCase();
    });
  }

  // Favorites/best sections (everything but In the Queue and Recently ...): no cap, Nick keeps them at 12 himself.
  // In owner mode every list.js item there gets a Remove button. The Worker can't edit list.js, so Remove hides it
  // (POST /hidden; hidden for everyone) and tools/pull_live.py deletes it from list.js for good.
  var FAVS = (window.SECTIONS || []).filter(function (s) { return s.title && s.live !== "queue" && s.live !== "watched"; }).map(function (s) {
    return { key: s.live || "s:" + slug(s.title), title: s.title, el: document.getElementById(slug(s.title)) };
  }).filter(function (f) { return f.el; });
  function codedItems(el) { return [].slice.call(el.querySelectorAll("[data-title]")); }
  function applyHidden(hidden) {
    FAVS.forEach(function (f) {
      var gone = (hidden[f.key] || []).map(function (t) { return sameTitle(t); });
      codedItems(f.el).forEach(function (item) { if (gone.indexOf(sameTitle(item.dataset.title)) >= 0) item.hidden = true; });
    });
  }
  function addRemoveButtons() {
    if (!ADMIN) return;
    FAVS.forEach(function (f) {
      codedItems(f.el).forEach(function (item) {
        if (item.querySelector(".owner-actions")) return;
        var bar = document.createElement("div");
        bar.className = "owner-actions";
        bar.innerHTML = '<button class="remove" type="button">Remove</button>';
        (item.querySelector(".entry-body") || item).appendChild(bar);
        bar.querySelector(".remove").addEventListener("click", function () {
          var title = item.dataset.title;
          if (!confirm("Remove " + title + " from " + f.title + "?")) return;
          fetch(API + "/hidden", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ page: PAGE, list: f.key, title: title }) })
            .then(function (r) { if (!r.ok) throw new Error(); item.hidden = true; })
            .catch(function () { alert("Couldn't remove it. Try logging in again."); });
        });
      });
    });
  }

  function renderListSlot(l) {
    if (!ADMIN) return;
    if (l.slot) l.slot.remove();
    l.slot = document.createElement("button");
    l.slot.type = "button";
    l.slot.className = "queue-slot add";
    l.slot.setAttribute("aria-label", "Add a " + KIND + " to " + l.title);
    l.slot.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Add a ' + KIND + "</span>";
    l.slot.addEventListener("click", function () { openDialog(state, "list", l); });
    grid(l.el).appendChild(l.slot);
    // In a section with song players, line the card up with the posters, not the players
    var track = l.el.querySelector(".poster .track");
    if (track) l.slot.style.marginTop = (track.nextElementSibling.offsetTop - track.offsetTop) + "px";
  }

  if (FAVS.length) {
    ready
      .then(function () { return fetch(API + "/lists?page=" + PAGE); })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        applyHidden(data.hidden || {});
        addRemoveButtons();
        var lists = data.lists || {};
        LISTS.forEach(function (l) {
          var items = (lists[l.key] || []).filter(function (it) { return !inSection(l.el, it.title); }); // newest first
          if (!items.length && !ADMIN) return;
          var g = grid(l.el);
          // site-added picks go on top, newest first, above the list.js ones
          items.slice().reverse().forEach(function (it) { g.insertBefore(card(it, "list", l), g.firstChild); });
          renderListSlot(l);
        });
      })
      .catch(function () { addRemoveButtons(); /* service unreachable: just show list.js */ });
  }

  // ---------- Recently Watched / Recently Played ----------

  var watchedSlot; // owner-only + card
  function renderWatchedSlot() {
    if (!ADMIN || !watchedSection) return;
    if (watchedSlot) watchedSlot.remove();
    watchedSlot = document.createElement("button");
    watchedSlot.type = "button";
    watchedSlot.className = "queue-slot add";
    watchedSlot.setAttribute("aria-label", "Log a " + KIND + " you " + DID.toLowerCase());
    watchedSlot.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Log a ' + KIND + "</span>";
    watchedSlot.addEventListener("click", function () { openDialog(state, "watched"); });
    grid(watchedSection).appendChild(watchedSlot);
    if (PAGE === "games") {
      if (xboxSlot) xboxSlot.remove();
      xboxSlot = document.createElement("button");
      xboxSlot.type = "button";
      xboxSlot.className = "queue-slot add xbox";
      xboxSlot.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Get latest from Xbox</span>';
      xboxSlot.addEventListener("click", openXbox);
      grid(watchedSection).insertBefore(xboxSlot, watchedSlot);
      renderSyncButton();
    }
  }
  var xboxSlot;

  // ---------- Refresh from Xbox (Games, owner only) ----------
  // A button in Recently Played's heading runs the every-4-hours Xbox sync now (POST /xbox/sync: playtime,
  // achievements and last played for every game here, plus the latest gamerscore total; 3 OpenXBL requests), then
  // redraws this section and the gamerscore banner.
  var syncBtn = null;
  function renderSyncButton() {
    if (syncBtn || !watchedSection) return;
    var head = watchedSection.querySelector(".subhead");
    if (!head) return;
    var box = document.createElement("span");
    box.className = "xbox-sync";
    box.innerHTML = '<span class="xbox-sync-status" role="status"></span>' +
      '<button type="button" class="xbox-sync-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>' +
      "<span>Refresh</span></button>";
    head.appendChild(box);
    syncBtn = box.querySelector("button");
    syncBtn.title = "Get the latest playtime, achievements and gamerscore from Xbox";
    syncBtn.addEventListener("click", syncXbox);
  }

  function syncXbox() {
    var status = watchedSection.querySelector(".xbox-sync-status");
    syncBtn.disabled = true;
    syncBtn.classList.add("busy");
    status.textContent = "Checking Xbox…";
    fetch(API + "/xbox/sync", { method: "POST", headers: authHeaders() })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw { said: res.d.error || "Couldn't refresh from Xbox." };
        return Promise.all([
          fetch(API + "/watched?" + PQ, { cache: "no-store" }).then(function (r) { return r.json(); }),
          window.NMXboxBanner ? window.NMXboxBanner.reload().catch(function () {}) : null,
        ]).then(function (out) {
          renderWatched(out[0].items || [], out[0].archive);
          var n = res.d.updated || 0;
          status.textContent = "Updated just now · " + (n ? n + (n === 1 ? " game" : " games") + " changed" : "no changes");
        });
      })
      .catch(function (e) { status.textContent = (e && e.said) || "Couldn't reach the server. Try again in a bit."; })
      .then(function () { syncBtn.disabled = false; syncBtn.classList.remove("busy"); });
  }

  // ---------- Get latest from Xbox (Games, owner only) ----------

  var watchedItems = [];
  var xbox = null;
  function openXbox() {
    if (!xbox) {
      xbox = document.createElement("dialog");
      xbox.className = "queue-dialog xbox-dialog";
      xbox.innerHTML =
        '<form method="dialog" novalidate>' +
          '<button class="close" type="button" aria-label="Close">&times;</button>' +
          "<h2>Get latest from Xbox</h2>" +
          '<p class="hint">Your most recently played Xbox games. Pick the ones to show in ' + esc(watchedSec.title) +
            "; ones already there get their playtime and achievements refreshed.</p>" +
          '<ul class="xbox-list"></ul>' +
          '<p class="error" role="alert"></p>' +
          '<button class="open submit" type="submit" disabled>Add selected</button>' +
        "</form>";
      document.body.appendChild(xbox);
      xbox.querySelector(".close").addEventListener("click", function () { xbox.close(); });
      xbox.addEventListener("click", function (e) { if (e.target === xbox) xbox.close(); });
      xbox.querySelector(".xbox-list").addEventListener("change", countXbox);
      xbox.querySelector("form").addEventListener("submit", importXbox);
    }
    var listEl = xbox.querySelector(".xbox-list");
    xbox.querySelector(".error").textContent = "";
    listEl.innerHTML = '<li class="none">Loading your Xbox games…</li>';
    countXbox();
    xbox.showModal();
    fetch(API + "/xbox/recent", { headers: authHeaders() })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { listEl.innerHTML = ""; xbox.querySelector(".error").textContent = res.d.error || "Couldn't load your Xbox games."; return; }
        var have = {};
        watchedItems.forEach(function (it) { if (it.xbox) have[it.xbox.titleId] = true; });
        listEl.innerHTML = (res.d.games || []).map(function (g) {
          var bits = ["Last played " + watchedOn(localDate(g.lastPlayed))];
          if (g.minutes != null) bits.push(playtime(g.minutes) + " played");
          if (g.percent != null) bits.push(g.percent + "% achievements");
          return '<li><label>' +
            '<input type="checkbox" value="' + esc(g.titleId) + '" data-date="' + esc(localDate(g.lastPlayed)) + '">' +
            (g.image ? '<img src="' + esc(imgUrl(g.image, 96)) + '" alt="" loading="lazy">' : '<span class="noimg"></span>') +
            '<span class="t">' + esc(g.name) + (have[g.titleId] ? ' <span class="tag">Update</span>' : "") +
              '<span class="s">' + esc(bits.join(" · ")) + "</span></span>" +
          "</label></li>";
        }).join("") || '<li class="none">No recent games found.</li>';
        countXbox();
      })
      .catch(function () { listEl.innerHTML = ""; xbox.querySelector(".error").textContent = "Couldn't reach the server. Try again in a bit."; });
  }

  function countXbox() {
    var n = xbox.querySelectorAll(".xbox-list input:checked").length;
    var btn = xbox.querySelector(".submit");
    btn.disabled = !n;
    btn.textContent = n ? "Add " + n + " to " + watchedSec.title : "Add selected";
  }

  function importXbox(e) {
    e.preventDefault();
    var picked = [].map.call(xbox.querySelectorAll(".xbox-list input:checked"), function (c) {
      return { titleId: c.value, date: c.dataset.date };
    });
    if (!picked.length) return;
    var btn = xbox.querySelector(".submit");
    var err = xbox.querySelector(".error");
    btn.disabled = true;
    btn.textContent = "Getting poster art…";
    err.textContent = "";
    fetch(API + "/xbox/import", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ games: picked }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { err.textContent = res.d.error || "Couldn't add those."; countXbox(); return; }
        return reloadWatched().then(function () {
          if (!section) return;
          // importing can take games out of the queue, so refresh it too
          return fetch(API + "/queue?" + PQ + "&visitorId=" + encodeURIComponent(VID), { headers: authHeaders() }).then(function (r) { return r.json(); }).then(function (data) {
            grid().querySelectorAll(".poster.suggested").forEach(function (el) { el.remove(); });
            (data.items || []).forEach(function (it) { if (!inSection(section, it.title)) grid().insertBefore(card(it), slot); });
            applyVotes(true);
            state = data;
            renderSlot(data);
          });
        }).then(function () { xbox.close(); });
      })
      .catch(function () { err.textContent = "Couldn't reach the server. Try again in a bit."; countXbox(); });
  }

  // Games: hide a list.js "In the Queue" game once the same game is in Recently Played. Exact title match, ignoring only
  // case and symbols like ™ (the Worker's normalize), so "Gears of War" never hides "Gears of War: E-Day".
  // The Worker drops it from the cap too; tools/pull_live.py deletes it from list.js for good.
  function sameTitle(t) {
    return String(t).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function hidePlayedQueueGames(items) {
    if (PAGE !== "games" || !section) return;
    var played = {};
    items.forEach(function (it) { played[sameTitle(it.title)] = true; });
    section.querySelectorAll(".poster:not(.suggested)").forEach(function (fig) {
      var t = fig.querySelector(".title");
      if (t && played[sameTitle(t.textContent)]) fig.hidden = true;
    });
  }

  function renderWatched(items, archive) {
    if (archive && window.NMArchive) window.NMArchive.setLive(watchedSection, archive);
    watchedItems = items;
    hidePlayedQueueGames(items);
    var g = grid(watchedSection);
    g.querySelectorAll(".poster").forEach(function (el) { el.remove(); });
    items.forEach(function (it) { g.appendChild(card(it, "watched")); });
    renderWatchedSlot();
  }

  if (watchedSection) {
    ready
      .then(function () { return fetch(API + "/watched?" + PQ); })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = data.items || [];
        hidePlayedQueueGames(items);
        if (window.NMArchive) window.NMArchive.setLive(watchedSection, data.archive);
        if (items.length || ADMIN) renderWatched(items); // visitors keep "Coming soon." until there's one
      })
      .catch(function () {});
  }

  // ---------- the add dialog ----------

  var dialog = document.createElement("dialog");
  dialog.className = "queue-dialog";
  dialog.innerHTML =
    '<form method="dialog" novalidate>' +
      '<button class="close" type="button" aria-label="Close">&times;</button>' +
      "<h2>Suggest a movie</h2>" +
      '<p class="hint"></p>' +
      // the poster this add will use, at the top once a title is picked
      '<div class="pick-preview" hidden aria-live="polite"><div class="pp-art"></div>' +
        '<div class="pp-choices" role="radiogroup" aria-label="Poster to use" hidden></div></div>' +
      '<label for="q-movie">' + (KIND === "game" ? "Game" : "Movie") + "</label>" +
      '<div class="combo">' +
        '<input id="q-movie" type="text" autocomplete="off" placeholder="Start typing a title" role="combobox" aria-expanded="false" aria-controls="q-results" aria-autocomplete="list">' +
        '<ul id="q-results" role="listbox" hidden></ul>' +
      "</div>" +
      '<label for="q-date">Date ' + DID.toLowerCase() + "</label>" +
      '<input id="q-date" type="date">' +
      '<label id="q-rating-label">Your rating</label>' +
      '<div class="rate" id="q-rating" role="slider" tabindex="0" aria-labelledby="q-rating-label" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0" aria-valuetext="No rating">' +
        stars(0) + '<span class="rate-text">No rating</span>' +
      "</div>" +
      '<label for="q-name">Your name</label>' +
      '<input id="q-name" type="text" maxlength="40" autocomplete="nickname" placeholder="So Nick knows who it\'s from">' +
      // optional note shown on the card under "Suggested by"; visitors' suggestions only
      '<label for="q-comment">Why should Nick ' + (KIND === "game" ? "play" : "watch") + ' it? <span class="optional">(optional)</span></label>' +
      '<textarea id="q-comment" maxlength="' + COMMENT_MAX + '" rows="3" placeholder="' +
        (KIND === "game" ? "What makes it worth playing?" : "What makes it worth watching?") + '"></textarea>' +
      '<p class="count" id="q-count" aria-live="polite"></p>' +
      '<fieldset class="who" id="q-who"><legend>Who can see your note?</legend>' +
        '<label><input type="radio" name="q-who" value="public" checked> Everyone</label>' +
        '<label><input type="radio" name="q-who" value="private"> Just Nick</label>' +
      "</fieldset>" +
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

  var commentInput = dialog.querySelector("#q-comment");
  var commentLabel = dialog.querySelector('label[for="q-comment"]');
  var commentCount = dialog.querySelector("#q-count");
  var whoField = dialog.querySelector("#q-who");
  function commentPrivate() { return dialog.querySelector('input[name="q-who"]:checked').value === "private"; }
  function showCount() {
    var left = COMMENT_MAX - commentInput.value.length;
    commentCount.textContent = left < 60 ? left + " characters left" : "";
  }
  commentInput.addEventListener("input", showCount);

  // Poster preview: visitors get the official poster, which the search result already has. Nick's adds get a choice:
  // GET /poster (owner only) returns up to 3 fan-art posters and the official one; the big preview shows the picked
  // one (the first, unless he clicks another thumbnail) and his submit sends it as `poster`.
  var preview = dialog.querySelector(".pick-preview");
  var previewArt = preview.querySelector(".pp-art");
  var previewChoices = preview.querySelector(".pp-choices");
  var previewSeq = 0;
  var posterOptions = [];
  var posterPick = 0;
  function hidePreview() { previewSeq++; preview.hidden = true; posterOptions = []; previewChoices.hidden = true; previewChoices.innerHTML = ""; }
  function creditText(credit) { return credit && credit.artist ? "Art by " + credit.artist : "Official poster"; }
  function pickedPoster() { return ADMIN && posterOptions.length ? posterOptions[posterPick] : undefined; }
  function renderChoices() {
    var o = posterOptions[posterPick];
    showPoster(o.image, o.credit);
    previewChoices.hidden = posterOptions.length < 2;
    previewChoices.innerHTML = posterOptions.map(function (c, i) {
      return '<button type="button" role="radio" aria-checked="' + (i === posterPick) + '" data-i="' + i + '" title="' + esc(creditText(c.credit)) + '"' +
        ' aria-label="' + esc(creditText(c.credit)) + '"><img src="' + esc(imgUrl(c.image, 160)) + '" alt=""></button>';
    }).join("");
  }
  previewChoices.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-i]");
    if (!b) return;
    posterPick = +b.dataset.i;
    renderChoices();
    previewChoices.querySelector('[data-i="' + posterPick + '"]').focus();
  });
  function showPoster(image, credit) {
    preview.hidden = false;
    preview.classList.remove("loading");
    // just the image; who made it is only in the alt text
    var alt = "Poster that will be used: " + (credit && credit.artist ? "art by " + credit.artist : "official poster");
    previewArt.innerHTML = image ? '<img src="' + esc(imgUrl(image, 300)) + '" alt="' + esc(alt) + '">' : '<span class="pp-none">No poster</span>';
  }
  function previewFor(r) {
    var mine = ++previewSeq;
    if (!ADMIN) return showPoster(r.image, null);
    preview.hidden = false;
    preview.classList.add("loading");
    previewArt.innerHTML = '<span class="pp-spin" role="img" aria-label="Finding poster art"></span>';
    fetch(API + "/poster?" + PQ + "&imdbId=" + encodeURIComponent(r.id), { headers: authHeaders() })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        if (mine !== previewSeq) return;
        posterOptions = (d && d.options) || [];
        posterPick = 0;
        if (posterOptions.length) renderChoices();
        else showPoster(r.image, null);
      })
      .catch(function () { if (mine === previewSeq) showPoster(r.image, null); });
  }

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
  var PHRASES = ["", KIND === "game" ? "Unplayable" : "Unwatchable", "Awful", "Bad", "Weak", "Mixed bag", "Good", "Really good", "Great", "Excellent", "Masterpiece"];
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
    return mode === "edit" || mode === "mine" ? "Save changes" : mode === "watched" ? "Add to " + watchedSec.title : mode === "list" ? "Add to " + target.title
      : ADMIN ? "Add to my queue" : "Add to the queue";
  }

  function resetFields() {
    chosen = null;
    movie.value = "";
    results = [];
    noMatch = false;
    showResults();
    dateInput.value = "";
    setRating(0);
    commentInput.value = "";
    showCount();
    dialog.querySelector('input[name="q-who"][value="public"]').checked = true;
    hidePreview();
  }

  // m: "queue", "watched" (log a movie), "edit" (change the rating/date of a Recently Watched movie `it`)
  // or "list" (add to the live section `it`)
  var editing = null;
  var mineEdit = null; // a visitor's own suggestion being edited
  var target = null; // the live section being added to
  function openDialog(s, m, it) {
    if (mode === "edit" || mode === "mine") resetFields(); // don't carry an edited movie into a new one
    mode = m || "queue";
    editing = mode === "edit" ? it : null;
    mineEdit = mode === "mine" ? it : null;
    target = mode === "list" ? it : null;
    var watching = mode === "watched" || !!editing;
    nameLabel.hidden = nameInput.hidden = !!ADMIN;
    commentLabel.hidden = commentInput.hidden = commentCount.hidden = whoField.hidden = !!ADMIN || (mode !== "queue" && mode !== "mine");
    dateLabel.hidden = dateInput.hidden = !watching;
    rateLabel.hidden = rate.hidden = !watching;
    movie.readOnly = !!editing || !!mineEdit;
    if (mineEdit) {
      chosen = { id: it.imdbId };
      movie.value = it.title + (it.year ? " (" + it.year + ")" : "");
      nameInput.value = it.suggestedBy || "";
      commentInput.value = it.comment || "";
      showCount();
      dialog.querySelector('input[name="q-who"][value="' + (it.commentPrivate ? "private" : "public") + '"]').checked = true;
    }
    dateInput.max = today();
    if (editing || mineEdit) showPoster(it.image, it.credit);
    if (editing) {
      chosen = { id: it.imdbId };
      movie.value = it.title + (it.year ? " (" + it.year + ")" : "");
      dateInput.value = it.date;
      setRating(it.rating || 0);
    }
    if (watching && !dateInput.value) dateInput.value = today();
    heading.textContent = mineEdit ? "Edit your suggestion" : editing ? "Edit " + it.title : watching ? "Log a " + KIND : target ? "Add a " + KIND : ADMIN ? "Submit a " + KIND : "Suggest a " + KIND;
    submit.textContent = submitLabel();
    hint.textContent = mineEdit
      ? "Change your name or your note. Picked the wrong " + KIND + "? Remove it from the card instead, and you'll get the spot back."
      : editing
      ? "Change your rating or the date you " + DID.toLowerCase() + " it."
      : target
      ? "Goes at the end of " + target.title + ". Poster art is picked automatically."
      : watching
      ? "Shows up in " + watchedSec.title + ", newest first. If it's in the queue, it comes out of the queue."
      : ADMIN
      ? "Goes straight into your queue. " + (s ? s.remaining : 0) + " spot" + (s && s.remaining === 1 ? "" : "s") + " left for visitors."
      : "You can add " + s.yourRemaining + " more. " + s.remaining + " spot" + (s.remaining === 1 ? "" : "s") + " left in the queue.";
    errorEl.textContent = "";
    validate();
    dialog.showModal();
    (editing ? rate : mineEdit ? commentInput : movie).focus();
  }
  dialog.querySelector(".close").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("close", function () { resetFields(); errorEl.textContent = ""; });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });

  function validate() {
    // a date is only needed when logging or editing something watched/played
    submit.disabled = !(chosen && (ADMIN || nameInput.value.trim()) && (mode === "queue" || mode === "list" || mode === "mine" || dateInput.value));
  }
  nameInput.addEventListener("input", validate);
  dateInput.addEventListener("input", validate);

  var noMatch = false; // last search came back empty
  function showResults() {
    list.innerHTML = noMatch && !results.length
      ? '<li class="none">No matching ' + KIND + 's on IMDb</li>'
      : results.map(function (r, i) {
      return '<li role="option" id="q-opt-' + i + '"' + (i === active ? ' aria-selected="true"' : "") + ' data-i="' + i + '">' +
        (r.image ? '<img src="' + esc(imgUrl(r.image, 80)) + '" alt="">' : '<span class="noimg"></span>') +
        '<span class="t">' + esc(r.title) + (r.year ? ' <span class="y">' + r.year + "</span>" : "") +
        (r.stars ? '<span class="s">' + esc(r.stars) + "</span>" : "") + "</span></li>";
    }).join("");
    list.hidden = !results.length && !noMatch;
    movie.setAttribute("aria-expanded", String(!!results.length));
    movie.setAttribute("aria-activedescendant", active >= 0 ? "q-opt-" + active : "");
  }

  function pick(i) {
    if (!results[i]) return;
    chosen = results[i];
    movie.value = chosen.title + (chosen.year ? " (" + chosen.year + ")" : "");
    results = [];
    showResults();
    previewFor(chosen);
    validate();
    (ADMIN ? submit : nameInput).focus();
  }

  movie.addEventListener("input", function () {
    chosen = null;
    hidePreview();
    noMatch = false;
    validate();
    clearTimeout(timer);
    var q = movie.value.trim();
    if (q.length < 2) { results = []; showResults(); return; }
    timer = setTimeout(function () {
      var mine = ++seq;
      fetch(API + "/search?kind=" + KIND + "&q=" + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (mine !== seq) return;
          results = data.results || [];
          noMatch = !results.length;
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
    else if (e.key === "Escape") { results = []; noMatch = false; showResults(); e.preventDefault(); }
  });
  list.addEventListener("mousedown", function (e) {
    var li = e.target.closest("li");
    if (li) { e.preventDefault(); pick(+li.dataset.i); }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submit.disabled) return;
    if (editing) return saveEdit();
    if (mineEdit) return saveMine();
    if (target) return saveToList();
    var watching = mode === "watched";
    submit.disabled = true;
    // searching for art only when nothing was picked in the preview (visitors never search)
    submit.textContent = (ADMIN || watching) && !pickedPoster() ? "Finding poster art…" : "Adding…";
    errorEl.textContent = "";
    if (!ADMIN) { try { localStorage.setItem("nm-name", nameInput.value.trim()); } catch (e2) {} }
    var label = submitLabel();
    fetch(API + (watching ? "/watched" : "/queue"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(watching
        ? { page: PAGE, imdbId: chosen.id, date: dateInput.value, rating: rating, poster: pickedPoster() }
        : { page: PAGE, imdbId: chosen.id, name: ADMIN ? "" : nameInput.value.trim(), visitorId: VID, poster: pickedPoster(),
            comment: ADMIN ? "" : commentInput.value.trim(), commentPrivate: !ADMIN && commentPrivate() }),
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
          }
          return reloadWatched();
        }
        grid().insertBefore(card(res.d.item), slot);
        if (!ADMIN) ownVotes[sameTitle(res.d.item.title)] = true; // their suggestion is their vote
        applyVotes(false);
        state.yourRemaining = res.d.yourRemaining;
        state.remaining = res.d.remaining;
        state.open = res.d.open;
        renderSlot(state);
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

  // a visitor saving changes to their own suggestion
  function saveMine() {
    var it = mineEdit;
    submit.disabled = true;
    errorEl.textContent = "";
    try { localStorage.setItem("nm-name", nameInput.value.trim()); } catch (e) {}
    fetch(API + "/queue/" + encodeURIComponent(it.imdbId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: PAGE, visitorId: VID, name: nameInput.value.trim(), comment: commentInput.value.trim(), commentPrivate: commentPrivate() }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { errorEl.textContent = res.d.error || "Couldn't save that."; validate(); return; }
        var old = section.querySelector('.poster.suggested[data-imdb="' + it.imdbId + '"]');
        if (old) old.replaceWith(card(res.d.item));
        applyVotes(false);
        dialog.close();
      })
      .catch(function () { errorEl.textContent = "Couldn't reach the server. Try again in a bit."; validate(); });
  }

  function saveToList() {
    var l = target;
    // list.js entries aren't in the Worker, so check those here
    var have = inSection(l.el, chosen.title) || [].some.call(l.el.querySelectorAll(".poster.suggested .title"), function (t) {
      return t.textContent.trim().toLowerCase() === String(chosen.title).toLowerCase();
    });
    if (have) { errorEl.textContent = chosen.title + " is already in " + l.title + "."; return; }
    submit.disabled = true;
    submit.textContent = pickedPoster() ? "Adding…" : "Finding poster art…";
    errorEl.textContent = "";
    fetch(API + "/lists", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ page: PAGE, list: l.key, imdbId: chosen.id, poster: pickedPoster() }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        submit.textContent = submitLabel();
        if (!res.ok) { errorEl.textContent = res.d.error || "Couldn't add that one."; validate(); return; }
        var g = grid(l.el);
        g.insertBefore(card(res.d.item, "list", l), g.firstChild); // newest goes in the first slot
        resetFields();
        validate();
        dialog.close();
      })
      .catch(function () {
        submit.textContent = submitLabel();
        errorEl.textContent = "Couldn't reach the server. Try again in a bit.";
        validate();
      });
  }

  function reloadWatched() {
    return fetch(API + "/watched?" + PQ).then(function (r) { return r.json(); }).then(function (data) {
      renderWatched(data.items || [], data.archive);
      resetFields();
      validate();
      dialog.close();
    });
  }

  function saveEdit() {
    submit.disabled = true;
    submit.textContent = "Saving…";
    errorEl.textContent = "";
    fetch(API + "/watched/" + encodeURIComponent(editing.id) + "?" + PQ, {
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
