// Nick's wishlist (wishlist/; the Worker's wishlist.js). Anyone with the link sees the items in Nick's groups (most
// wanted first) and can mark one "I'm getting this" (once per item; only they can undo it). In owner mode (the admin
// token, as on the other pages; ?admin to log in) Nick adds, edits and removes items, pasting a product link to fill
// in its name, picture and price, and never sees what's claimed unless he asks to ("Show what's claimed").
(function () {
  var root = document.getElementById("wl");
  if (!root) return;
  var script = document.currentScript || document.querySelector('script[src*="wishlist.js"]');
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = (local && script.dataset.apiLocal) || script.dataset.api;
  var params = new URLSearchParams(location.search);
  var ADMIN = null;
  try {
    if (params.has("logout")) localStorage.removeItem("nm-admin-token");
    ADMIN = localStorage.getItem("nm-admin-token");
  } catch (e) {}
  var reveal = false, items = [], groups = [];
  // how this viewer looks at the list (Nick, 2026-10-19: sort by price; tick groups on or off), remembered here
  var view = { sort: "group", off: {} };
  try { var saved = JSON.parse(localStorage.getItem("nm-wishlist-view") || "null"); if (saved) view = { sort: saved.sort || "group", off: saved.off || {} }; } catch (e) {}
  function saveView() { try { localStorage.setItem("nm-wishlist-view", JSON.stringify(view)); } catch (e) {} }
  function amount(it) { var n = parseFloat(String(it.price || "").replace(/[^0-9.]/g, "")); return n > 0 ? n : null; }

  // the random id this browser keeps (the queues and the Cattery use the same one)
  function visitorId() {
    var id = null;
    try { id = localStorage.getItem("nm-visitor"); } catch (e) {}
    if (!id) { var m = document.cookie.match(/(?:^|; )nm_visitor=([^;]+)/); id = m ? m[1] : null; }
    if (!id) id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    try { localStorage.setItem("nm-visitor", id); } catch (e) {}
    document.cookie = "nm_visitor=" + id + "; max-age=31536000; path=/; SameSite=Lax";
    return id;
  }
  var VID = visitorId();

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function headers(json) { var h = {}; if (json) h["Content-Type"] = "application/json"; if (ADMIN) h.Authorization = "Bearer " + ADMIN; return h; }
  function api(path, opts) {
    opts = opts || {};
    return fetch(API + path, { method: opts.method || "GET", headers: headers(!!opts.body), body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "Something went wrong."); return d; }); });
  }
  // a price typed as just a number ("180") shows with a dollar sign (Nick, 2026-10-19); "$49" or "€30" stay as typed
  function money(p) { p = String(p).trim(); return /^\d[\d,]*(\.\d+)?$/.test(p) ? "$" + p : p; }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }

  function load() {
    return api("/wishlist?visitorId=" + encodeURIComponent(VID) + (reveal ? "&reveal=1" : "")).then(function (d) {
      items = d.items || []; groups = d.groups || [];
      if (ADMIN && !d.owner) { ADMIN = null; try { localStorage.removeItem("nm-admin-token"); } catch (e) {} } // an old password
      render();
    }, function () { root.innerHTML = '<p class="wl-msg">Couldn’t load the list. Try again in a bit.</p>'; });
  }

  // the groups in the order Nick named them (each group's newest item first), "Other" last; most wanted first in each
  function render() {
    var byGroup = {}, order = [];
    items.forEach(function (it) {
      var g = it.group || "";
      if (!byGroup[g]) { byGroup[g] = []; if (g) order.push(g); }
      byGroup[g].push(it);
    });
    order.sort(function (a, b) { return a.localeCompare(b); });
    if (byGroup[""]) order.push("");
    var html = "";
    if (ADMIN) html += '<div class="owner-bar wl-owner"><span>Owner mode</span>' +
      '<button type="button" class="open wl-add"><span aria-hidden="true">+</span> Add an item</button>' +
      '<button type="button" class="wl-reveal">' + (reveal ? "Hide what's claimed" : "Show what's claimed") + "</button>" +
      '<a href="?logout">Log out</a></div>';
    if (!items.length) html += '<p class="wl-msg">' + (ADMIN ? "Nothing on the list yet. Add something." : "Nothing on the list right now.") + "</p>";
    var shown = order.filter(function (g) { return !view.off[g || "Other"]; });
    if (items.length) {
      // the bar: sort, then a chip per group to show or hide it (only when there's more than one)
      html += '<div class="wl-bar"><label class="wl-sort">Sort <select>' +
        [["group", "Priority"], ["low", "Price: low to high"], ["high", "Price: high to low"]] /* Priority: by group, in Nick's own (dragged) order */.map(function (o) {
          return '<option value="' + o[0] + '"' + (view.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
        }).join("") + "</select></label>" +
        (order.length > 1 ? '<div class="wl-chips" role="group" aria-label="Groups to show">' + order.map(function (g) {
          var name = g || "Other";
          return '<button type="button" class="wl-chip" data-group="' + esc(name) + '" aria-pressed="' + !view.off[name] + '">' + esc(name) + "</button>";
        }).join("") + "</div>" : "") + "</div>";
    }
    if (items.length && !shown.length) html += '<p class="wl-msg">Every group is hidden. Tap one above to show it.</p>';
    if (view.sort === "group") {
      shown.forEach(function (g) {
        var list = byGroup[g]; // Nick's own order, top to bottom (drag and drop in owner mode)
        html += '<section class="wl-group" data-group="' + esc(g) + '">' + (order.length > 1 || g ? "<h2>" + esc(g || "Other") + "</h2>" : "") +
          '<ul class="wl-grid">' + list.map(function (it) { return card(it); }).join("") + "</ul></section>";
      });
    } else if (shown.length) {
      // by price: one list across the groups shown, no-price items last; each card says its group
      var all = [].concat.apply([], shown.map(function (g) { return byGroup[g]; })), dir = view.sort === "low" ? 1 : -1;
      all.sort(function (a, b) {
        var x = amount(a), y = amount(b);
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
        return (x - y) * dir;
      });
      html += '<section class="wl-group"><ul class="wl-grid">' + all.map(function (it) { return card(it, order.length > 1); }).join("") + "</ul></section>";
    }
    root.innerHTML = html;
  }
  function card(it, withGroup) {
    var taken = it.claimed && !it.mine;
    var drag = ADMIN && view.sort === "group";
    return '<li class="wl-item' + (taken ? " taken" : "") + (it.mine ? " mine" : "") + '" data-id="' + it.id + '">' +
      (drag ? '<button type="button" class="wl-handle" aria-label="Drag to reorder ' + esc(it.title) + '" title="Drag to reorder">⠿</button>' : "") +
      (it.url ? '<a class="wl-pic" href="' + esc(it.url) + '" target="_blank" rel="noopener" tabindex="-1">' : '<div class="wl-pic">') +
        (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span class="wl-noimg" aria-hidden="true">🎁</span>') +
        (it.star ? '<span class="wl-star">★ Most wanted</span>' : "") +
      (it.url ? "</a>" : "</div>") +
      '<div class="wl-body">' +
        (withGroup ? '<p class="wl-in">' + esc(it.group || "Other") + "</p>" : "") +
        "<h3>" + esc(it.title) + "</h3>" +
        (it.price ? '<p class="wl-price">' + esc(money(it.price)) + "</p>" : "") +
        (it.note ? '<p class="wl-note">' + esc(it.note) + "</p>" : "") +
        '<div class="wl-actions">' +
          (it.url ? '<a class="open wl-shop" href="' + esc(it.url) + '" target="_blank" rel="noopener">View' + (host(it.url) ? '<span class="wl-host">&nbsp;at ' + esc(host(it.url)) + "</span>" : "") + "&nbsp;↗</a>" : "") +
          (ADMIN && !reveal ? "" :
            it.mine ? '<span class="wl-yours">You’re getting this</span> <button type="button" class="wl-undo">Undo</button>' :
            taken ? '<span class="wl-taken">Someone’s getting this</span>' :
            '<button type="button" class="open wl-claim">I’m getting this</button>') +
          (ADMIN ? '<button type="button" class="wl-edit">Edit</button><button type="button" class="wl-remove">Remove</button>' : "") +
        "</div>" +
      "</div></li>";
  }

  root.addEventListener("change", function (e) {
    if (e.target.closest(".wl-sort")) { view.sort = e.target.value; saveView(); render(); }
  });
  root.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("wl-chip")) {
      var g = b.dataset.group;
      if (view.off[g]) delete view.off[g]; else view.off[g] = true;
      saveView(); render();
      return;
    }
    var li = b.closest(".wl-item"), id = li && li.dataset.id, it = items.filter(function (x) { return x.id === id; })[0];
    if (b.classList.contains("wl-claim") && it) {
      if (!confirm("Mark “" + it.title + "” as yours to get? Everyone else will see it's taken (Nick won't).")) return;
      b.disabled = true;
      api("/wishlist/" + id + "/claim", { method: "POST", body: { visitorId: VID } }).then(function () { return load(); }, function (err) { alert(err.message); load(); });
    }
    if (b.classList.contains("wl-undo") && it) {
      b.disabled = true;
      api("/wishlist/" + id + "/claim?visitorId=" + encodeURIComponent(VID), { method: "DELETE" }).then(load, function (err) { alert(err.message); load(); });
    }
    if (b.classList.contains("wl-add")) editor(null);
    if (b.classList.contains("wl-edit") && it) editor(it);
    if (b.classList.contains("wl-remove") && it && confirm("Take “" + it.title + "” off the list?")) {
      api("/wishlist/" + id, { method: "DELETE" }).then(load, function (err) { alert(err.message); });
    }
    if (b.classList.contains("wl-reveal")) {
      if (!reveal && !confirm("This shows which gifts people are getting you. Spoil the surprise?")) return;
      reveal = !reveal; load();
    }
  });

  // ---------- Nick's order, by drag and drop (owner mode, By group): the handle drags its card within its own group,
  // with a mouse or a finger; letting go saves the whole list's order (PUT /wishlist/order) ----------
  var dragging = null;
  root.addEventListener("pointerdown", function (e) {
    var hnd = e.target.closest(".wl-handle");
    if (!hnd || e.button > 0) return;
    e.preventDefault();
    var li = hnd.closest(".wl-item");
    dragging = { li: li, grid: li.parentNode, id: li.dataset.id, before: [].map.call(li.parentNode.children, function (x) { return x.dataset.id; }).join() };
    li.classList.add("dragging");
    hnd.setPointerCapture(e.pointerId);
  });
  root.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var over = document.elementFromPoint(e.clientX, e.clientY), other = over && over.closest(".wl-item");
    if (!other || other === dragging.li || other.parentNode !== dragging.grid) return;
    var kids = [].slice.call(dragging.grid.children), from = kids.indexOf(dragging.li), to = kids.indexOf(other);
    dragging.grid.insertBefore(dragging.li, from < to ? other.nextSibling : other);
  });
  function drop() {
    if (!dragging) return;
    var d = dragging; dragging = null;
    d.li.classList.remove("dragging");
    var now = [].map.call(d.grid.children, function (x) { return x.dataset.id; });
    if (now.join() === d.before) return;
    // the group's items take their new order in the same places in the whole list
    var slots = [], rank = {};
    now.forEach(function (id, i) { rank[id] = i; });
    items.forEach(function (it, i) { if (it.id in rank) slots.push(i); });
    var moved = now.map(function (id) { return items.filter(function (x) { return x.id === id; })[0]; });
    slots.forEach(function (at, k) { items[at] = moved[k]; });
    api("/wishlist/order", { method: "PUT", body: { ids: items.map(function (x) { return x.id; }) } }).catch(function (err) { alert(err.message); load(); });
  }
  root.addEventListener("pointerup", drop);
  root.addEventListener("pointercancel", drop);

  // ---------- adding and editing (owner mode) ----------
  function editor(it) {
    var d = document.createElement("dialog");
    d.className = "queue-dialog wl-dialog";
    d.innerHTML = '<form novalidate>' +
      '<button class="close" type="button" aria-label="Close">&times;</button>' +
      "<h2>" + (it ? "Edit item" : "Add an item") + "</h2>" +
      '<label for="wl-url">Link <span class="optional">(paste one and the rest fills in)</span></label>' +
      '<input id="wl-url" type="url" inputmode="url" autocomplete="off" placeholder="https://…" value="' + esc(it && it.url) + '">' +
      '<p class="hint wl-fetch" role="status"></p>' +
      '<div class="wl-prev"' + (it && it.image ? "" : " hidden") + '><img alt="" referrerpolicy="no-referrer" src="' + esc(it && it.image) + '"></div>' +
      '<label for="wl-title">Name</label><input id="wl-title" type="text" maxlength="140" value="' + esc(it && it.title) + '">' +
      '<label for="wl-price">Price <span class="optional">(optional)</span></label><input id="wl-price" type="text" maxlength="24" placeholder="$49" value="' + esc(it && it.price) + '">' +
      '<label for="wl-note">Note <span class="optional">(size, color…)</span></label><input id="wl-note" type="text" maxlength="200" placeholder="Size L, black" value="' + esc(it && it.note) + '">' +
      '<label for="wl-group">Group <span class="optional">(optional)</span></label><input id="wl-group" type="text" maxlength="40" list="wl-groups" placeholder="Golf, Games, Clothes…" value="' + esc(it && it.group) + '">' +
      '<datalist id="wl-groups">' + groups.map(function (g) { return '<option value="' + esc(g) + '">'; }).join("") + "</datalist>" +
      '<label for="wl-image">Picture link <span class="optional">(filled in from the link; change it if it’s wrong)</span></label><input id="wl-image" type="url" autocomplete="off" value="' + esc(it && it.image) + '">' +
      '<label class="wl-check"><input type="checkbox" id="wl-star"' + (it && it.star ? " checked" : "") + "> ★ Most wanted</label>" +
      '<p class="error" role="alert"></p>' +
      '<button class="open submit" type="submit">' + (it ? "Save" : "Add to the list") + "</button></form>";
    document.body.appendChild(d);
    var f = d.querySelector("form"), $ = function (s) { return d.querySelector(s); };
    d.addEventListener("close", function () { d.remove(); });
    $(".close").addEventListener("click", function () { d.close(); });
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
    function showPic() { var u = $("#wl-image").value.trim(); $(".wl-prev").hidden = !u; $(".wl-prev img").src = u; }
    $("#wl-image").addEventListener("change", showPic);
    var lastFetched = it ? it.url : "";
    function fill() {
      var u = $("#wl-url").value.trim();
      if (!/^https?:\/\//i.test(u) || u === lastFetched) return;
      lastFetched = u;
      $(".wl-fetch").textContent = "Looking up the link…";
      api("/wishlist/preview?url=" + encodeURIComponent(u)).then(function (p) {
        if (!p.found) { $(".wl-fetch").textContent = "That store didn't share its details. Type them in."; return; }
        $(".wl-fetch").textContent = "";
        if (p.title && !$("#wl-title").value.trim()) $("#wl-title").value = p.title;
        if (p.price && !$("#wl-price").value.trim()) $("#wl-price").value = p.price;
        if (p.image && !$("#wl-image").value.trim()) { $("#wl-image").value = p.image; showPic(); }
      }, function () { $(".wl-fetch").textContent = "Couldn't look that up. Type the details in."; });
    }
    $("#wl-url").addEventListener("change", fill);
    $("#wl-url").addEventListener("paste", function () { setTimeout(fill, 0); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = { url: $("#wl-url").value, title: $("#wl-title").value, price: $("#wl-price").value, note: $("#wl-note").value,
        group: $("#wl-group").value, image: $("#wl-image").value, star: $("#wl-star").checked };
      if (!body.title.trim()) { $(".error").textContent = "Give it a name."; return; }
      var btn = f.querySelector(".submit"); btn.disabled = true;
      api(it ? "/wishlist/" + it.id : "/wishlist", { method: it ? "PATCH" : "POST", body: body }).then(function () { d.close(); load(); },
        function (err) { btn.disabled = false; $(".error").textContent = err.message; });
    });
    d.showModal();
    (it ? $("#wl-title") : $("#wl-url")).focus();
  }

  function login() {
    var d = document.createElement("dialog");
    d.className = "queue-dialog";
    d.innerHTML = '<form novalidate><h2>Owner login</h2><p class="hint">Enter your admin password. This browser will remember it.</p>' +
      '<label for="wl-admin">Password</label><input id="wl-admin" type="password" autocomplete="current-password">' +
      '<p class="error" role="alert"></p><button class="open submit" type="submit">Log in</button></form>';
    document.body.appendChild(d);
    var input = d.querySelector("input"), err = d.querySelector(".error");
    d.addEventListener("close", function () { d.remove(); });
    d.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var token = input.value.trim();
      fetch(API + "/admin/check", { headers: { Authorization: "Bearer " + token } }).then(function (r) {
        if (!r.ok) { err.textContent = "Wrong password."; return; }
        ADMIN = token;
        try { localStorage.setItem("nm-admin-token", token); } catch (e2) {}
        history.replaceState(null, "", location.pathname);
        d.close();
        load();
      }).catch(function () { err.textContent = "Couldn't reach the server."; });
    });
    d.showModal();
    input.focus();
  }

  load();
  if (!ADMIN && params.has("admin")) login();
})();
