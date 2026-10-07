// Photography, owner mode (?admin, Ver 1.4): add a photo from the phone, straight to the page, without code.
// "Add a photo" opens a dialog: pick a photo, pick Pixel or Cats, Add. The browser makes the files (assets/js/photos.js
// shows them): the photo at full size and 800/1600/2400px copies as JPEG, and a 400px WebP thumbnail, all drawn
// through a canvas, which keeps only the pixels, so the phone's location and camera details never leave it. They go to
// the Worker (POST /photos, worker/src/photos.js), which stores them in R2 next to the other full-size photos. The page
// then reloads with the new photo on top of its section, fresh.
// Every photo gets "Remove this photo" under it (slideshow and full view) in owner mode: one added on the site is
// deleted; one from photos.js is hidden for everyone (the Worker keeps the list; its files stay).
(function () {
  var root = document.getElementById("photos");
  if (!root) return;
  var params = new URLSearchParams(location.search);
  var ADMIN = null;
  try {
    if (params.has("logout")) localStorage.removeItem("nm-admin-token");
    ADMIN = localStorage.getItem("nm-admin-token");
  } catch (e) {}
  if (params.has("logout")) history.replaceState(null, "", location.pathname + location.hash);
  var SECTIONS = [{ id: "pixel", title: "Pixel" }, { id: "cats", title: "Cats" }]; // Film is scanned, added with tools/photos.py
  var SIZES = [800, 1600, 2400];

  function api() { return (window.NMPhotos && window.NMPhotos.api) || ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- login (the same token as the other pages: localStorage nm-admin-token) ----------
  function login() {
    var d = document.createElement("dialog");
    d.className = "queue-dialog";
    d.innerHTML =
      '<form novalidate><h2>Owner login</h2>' +
      '<p class="hint">Enter your admin password. This browser will remember it.</p>' +
      '<label for="ph-admin">Password</label><input id="ph-admin" type="password" autocomplete="current-password">' +
      '<p class="error" role="alert"></p><button class="open submit" type="submit">Log in</button></form>';
    document.body.appendChild(d);
    var input = d.querySelector("input"), err = d.querySelector(".error");
    d.addEventListener("close", function () { d.remove(); });
    d.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var token = input.value.trim();
      fetch(api() + "/admin/check", { headers: { Authorization: "Bearer " + token } }).then(function (r) {
        if (!r.ok) { err.textContent = "Wrong password."; return; }
        ADMIN = token;
        try { localStorage.setItem("nm-admin-token", token); } catch (e2) {}
        history.replaceState(null, "", location.pathname + location.hash);
        d.close();
        owner();
      }).catch(function () { err.textContent = "Couldn't reach the server."; });
    });
    d.showModal();
    input.focus();
  }

  // ---------- owner bar, Add a photo, Remove ----------
  function owner() {
    if (document.querySelector(".owner-bar")) return;
    var bar = document.createElement("div");
    bar.className = "owner-bar";
    bar.innerHTML = '<span>Owner mode</span> <a href="?logout">Log out</a>';
    var head = document.querySelector(".page-head");
    head.parentNode.insertBefore(bar, head.nextSibling);
    var add = document.createElement("button");
    add.type = "button";
    add.className = "open photo-add-btn";
    add.innerHTML = '<span aria-hidden="true">+</span> Add a photo';
    add.addEventListener("click", openAdd);
    (document.querySelector(".photo-controls") || head).appendChild(add);
    watchRemove();
  }

  // a "Remove this photo" button in the slideshow's bar and the full view's, shown while a site-added photo is on show
  function watchRemove() {
    var spots = [];
    function place(where) {
      if (!where || where.querySelector(".photo-remove")) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "photo-remove";
      b.textContent = "Remove this photo";
      b.hidden = true;
      b.addEventListener("click", removeCurrent);
      where.appendChild(b);
      spots.push(b);
    }
    function update() {
      place(document.querySelector(".ss-bar"));
      place(document.querySelector(".lightbox-bar"));
      var p = window.NMPhotos && window.NMPhotos.current();
      spots.forEach(function (b) { b.hidden = !p; });
    }
    update();
    // the photo on show changes on clicks and arrow keys; cheap enough to just check after each
    document.addEventListener("click", function () { setTimeout(update, 0); });
    document.addEventListener("keydown", function () { setTimeout(update, 0); });
    document.addEventListener("touchend", function () { setTimeout(update, 0); });
  }

  function removeCurrent(e) {
    var p = window.NMPhotos.current();
    var where = p && (p.section.charAt(0).toUpperCase() + p.section.slice(1));
    if (!p || !confirm("Remove this photo from " + where + "?" + (p.site ? " Its files are deleted too." : " It's hidden for everyone."))) return;
    var b = e.currentTarget;
    b.disabled = true;
    b.textContent = "Removing…";
    fetch(api() + "/photos/" + encodeURIComponent(p.site ? p.id : window.NMPhotoName(p)), { method: "DELETE", headers: { Authorization: "Bearer " + ADMIN } })
      .then(function (r) { if (!r.ok) throw new Error(); location.reload(); })
      .catch(function () { b.disabled = false; b.textContent = "Couldn't remove it. Try again"; });
  }

  // ---------- the add dialog ----------
  var dlg = null, picked = null;
  function openAdd() {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "queue-dialog photo-add";
      dlg.innerHTML =
        '<form novalidate>' +
          '<button class="close" type="button" aria-label="Close">&times;</button>' +
          "<h2>Add a photo</h2>" +
          '<p class="hint">It goes on top of its section, marked New for a week (or until the next one).</p>' +
          '<label class="photo-pick"><input type="file" accept="image/jpeg,image/png,image/webp" hidden>' +
            '<span class="photo-pick-empty"><b>Choose a photo</b><small>From your camera roll</small></span>' +
            '<img alt="" hidden></label>' +
          '<fieldset class="who"><legend>Section</legend>' + SECTIONS.map(function (s, i) {
            return '<label><input type="radio" name="section" value="' + s.id + '"' + (i ? "" : " checked") + ">" + esc(s.title) + "</label>";
          }).join("") + "</fieldset>" +
          '<p class="photo-info"></p>' +
          '<p class="error" role="alert"></p>' +
          '<button class="open submit" type="submit" disabled>Add photo</button>' +
        "</form>";
      document.body.appendChild(dlg);
      dlg.querySelector(".close").addEventListener("click", function () { dlg.close(); });
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
      dlg.querySelector('input[type="file"]').addEventListener("change", function (e) { choose(e.target.files[0]); });
      dlg.querySelector("form").addEventListener("submit", upload);
    }
    dlg.querySelector("form").reset();
    picked = null;
    dlg.querySelector(".photo-pick img").hidden = true;
    dlg.querySelector(".photo-pick-empty").hidden = false;
    dlg.querySelector(".photo-info").textContent = "";
    dlg.querySelector(".error").textContent = "";
    dlg.querySelector(".submit").disabled = true;
    dlg.querySelector(".submit").textContent = "Add photo";
    dlg.showModal();
  }

  function choose(file) {
    var err = dlg.querySelector(".error"), info = dlg.querySelector(".photo-info");
    err.textContent = "";
    picked = null;
    dlg.querySelector(".submit").disabled = true;
    if (!file) return;
    info.textContent = "Reading the photo…";
    // the phone's rotation applied, like it looks in the gallery
    createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
      picked = { file: file, bmp: bmp };
      var prev = dlg.querySelector(".photo-pick img");
      prev.src = URL.createObjectURL(file);
      prev.hidden = false;
      dlg.querySelector(".photo-pick-empty").hidden = true;
      info.textContent = bmp.width + " × " + bmp.height + " · " + (file.size / 1e6).toFixed(1) + " MB · location and camera details are removed";
      dlg.querySelector(".submit").disabled = false;
    }).catch(function () {
      info.textContent = "";
      err.textContent = "This browser can't open that file. Try a JPEG.";
    });
  }

  // the image drawn at a width (halving first for big drops, so the small copies stay sharp)
  function scaled(bmp, w) {
    var src = bmp, sw = bmp.width, sh = bmp.height;
    var h = Math.round(sh * w / sw);
    while (sw / 2 >= w * 1.5) {
      var half = document.createElement("canvas");
      half.width = Math.round(sw / 2);
      half.height = Math.round(sh / 2);
      var hc = half.getContext("2d");
      hc.imageSmoothingQuality = "high";
      hc.drawImage(src, 0, 0, half.width, half.height);
      src = half; sw = half.width; sh = half.height;
    }
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return c;
  }
  function blob(canvas, type, q) {
    return new Promise(function (done, fail) {
      canvas.toBlob(function (b) { b ? done(b) : fail(new Error("encode")); }, type, q);
    });
  }

  function upload(e) {
    e.preventDefault();
    if (!picked) return;
    var btn = dlg.querySelector(".submit"), err = dlg.querySelector(".error");
    var section = dlg.querySelector('input[name="section"]:checked').value;
    var bmp = picked.bmp;
    btn.disabled = true;
    err.textContent = "";
    btn.textContent = "Making the copies…";
    var form = new FormData();
    form.append("section", section);
    form.append("w", bmp.width);
    form.append("h", bmp.height);
    // full size first (re-encoded: pixels only), then each smaller copy, then the thumbnail
    var jobs = [blob(scaled(bmp, bmp.width), "image/jpeg", 0.93).then(function (b) { form.append("full", b, "full.jpg"); })];
    SIZES.filter(function (s) { return s < bmp.width; }).forEach(function (s) {
      jobs.push(blob(scaled(bmp, s), "image/jpeg", 0.85).then(function (b) { form.append("s" + s, b, s + ".jpg"); }));
    });
    jobs.push(blob(scaled(bmp, Math.min(400, bmp.width)), "image/webp", 0.8).then(function (b) {
      if (b.type === "image/webp") form.append("thumb", b, "thumb.webp"); // a browser without WebP: the 800px copy stands in
    }));
    Promise.all(jobs).then(function () {
      // XHR for the upload's progress (a big photo on a phone connection takes a while)
      return new Promise(function (done, fail) {
        var x = new XMLHttpRequest();
        x.open("POST", api() + "/photos");
        x.setRequestHeader("Authorization", "Bearer " + ADMIN);
        x.upload.onprogress = function (ev) {
          if (ev.lengthComputable) btn.textContent = "Uploading… " + Math.round(ev.loaded / ev.total * 100) + "%";
        };
        x.onload = function () {
          var res = {};
          try { res = JSON.parse(x.responseText); } catch (e2) {}
          x.status === 200 ? done(res) : fail(new Error(res.error || "Couldn't add it."));
        };
        x.onerror = function () { fail(new Error("Couldn't reach the server. Try again in a bit.")); };
        x.send(form);
      });
    }).then(function () {
      btn.textContent = "Added";
      try { localStorage.removeItem("nm-photo-layout"); } catch (e3) {} // land on the slideshow, which opens on it
      location.reload();
    }).catch(function (e4) {
      btn.disabled = false;
      btn.textContent = "Add photo";
      err.textContent = e4.message === "encode" ? "Couldn't make the copies on this device." : e4.message;
    });
  }

  function begin() {
    if (ADMIN) owner();
    else if (params.has("admin")) login();
  }
  // once photos.js has drawn the page (its API address and the slideshow's bar)
  if (window.NMPhotosReady) window.NMPhotosReady.then(begin);
  else begin();
})();
