// Photography page: renders window.PHOTOS, the 1/2/4 column toggle, and the full-resolution lightbox.
(function () {
  var photos = window.PHOTOS || [];
  var config = window.PHOTO_CONFIG || {};
  var root = document.getElementById("photos");

  // Instagram link
  if (config.instagram) {
    var ig = document.getElementById("instagram");
    var handle = String(config.instagram).replace(/^@/, "");
    ig.href = "https://www.instagram.com/" + encodeURIComponent(handle) + "/";
    ig.querySelector("span").textContent = "@" + handle;
    ig.hidden = false;
  }

  if (!photos.length) {
    root.innerHTML = '<p class="empty content">Photos coming soon.</p>';
    document.querySelector(".layout-toggle").hidden = true;
    return;
  }

  function mb(bytes) { return (bytes / 1e6).toFixed(1) + " MB"; }

  // How wide each photo is on screen, so the browser picks the right file from srcset
  function sizesFor(cols) {
    if (cols === 4) return "(max-width: 900px) 50vw, 25vw";
    if (cols === 2) return "(max-width: 560px) 100vw, 50vw";
    return "100vw";
  }

  function photoLink(p, i) {
    var srcset = p.sizes.map(function (s) { return s.src + " " + s.w + "w"; })
      .concat([p.src + " " + p.w + "w"]).join(", ");
    return '<a class="photo" href="' + p.src + '" data-index="' + i + '">' +
      '<img src="' + (p.sizes.length ? p.sizes[0].src : p.src) + '" srcset="' + srcset + '" sizes="100vw"' +
      ' width="' + p.w + '" height="' + p.h + '" alt="Photo ' + (i + 1) + '"' +
      (i > 1 ? ' loading="lazy"' : "") + ' decoding="async"></a>';
  }

  // The first photo sits above the grid in a gilded frame with a "Featured" plaque
  var featured = document.createElement("div");
  featured.className = "featured";
  featured.innerHTML = '<div class="frame"><div class="mat">' + photoLink(photos[0], 0) +
    '<span class="plaque">Featured</span></div></div>';
  featured.querySelector("img").sizes = "(max-width: 900px) 100vw, 900px";
  root.parentNode.insertBefore(featured, root);
  featured.addEventListener("click", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || !e.target.closest(".photo")) return;
    e.preventDefault();
    open(0);
  });

  root.innerHTML = photos.slice(1).map(function (p, i) { return photoLink(p, i + 1); }).join("");

  // Column toggle, remembered per visitor
  var buttons = document.querySelectorAll(".layout-toggle button");
  function setCols(cols) {
    root.setAttribute("data-cols", cols);
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.cols === cols)); });
    root.querySelectorAll("img").forEach(function (img) { img.sizes = sizesFor(cols); });
    try { localStorage.setItem("nm-photo-cols", cols); } catch (e) {}
  }
  var saved = 1;
  try { saved = parseInt(localStorage.getItem("nm-photo-cols"), 10) || 1; } catch (e) {}
  setCols([1, 2, 4].indexOf(saved) >= 0 ? saved : 1);
  buttons.forEach(function (b) {
    b.addEventListener("click", function () { setCols(+b.dataset.cols); });
  });

  // Lightbox with the full-resolution file
  var box = document.getElementById("lightbox");
  var big = box.querySelector("img");
  var download = box.querySelector(".lightbox-download");
  var count = box.querySelector(".lightbox-count");
  var current = 0;

  function show(i) {
    current = (i + photos.length) % photos.length;
    var p = photos[current];
    big.classList.add("loading");
    big.removeAttribute("src");
    // show the largest already-downloaded size first, then swap to full resolution
    var preview = p.sizes.length ? p.sizes[p.sizes.length - 1].src : p.src;
    big.src = preview;
    var full = new Image();
    full.onload = function () {
      if (photos[current] === p) { big.src = p.src; big.classList.remove("loading"); }
    };
    full.src = p.src;
    download.href = p.src;
    download.textContent = "Full resolution · " + p.w + " × " + p.h + " · " + mb(p.bytes);
    count.textContent = (current + 1) + " / " + photos.length;
  }
  function open(i) {
    show(i);
    box.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function close() {
    box.hidden = true;
    document.body.style.overflow = "";
  }

  root.addEventListener("click", function (e) {
    var a = e.target.closest(".photo");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    open(+a.dataset.index);
  });
  box.querySelector(".lightbox-close").addEventListener("click", close);
  box.querySelector(".lightbox-prev").addEventListener("click", function () { show(current - 1); });
  box.querySelector(".lightbox-next").addEventListener("click", function () { show(current + 1); });
  box.addEventListener("click", function (e) { if (e.target === box) close(); });
  document.addEventListener("keydown", function (e) {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") show(current - 1);
    else if (e.key === "ArrowRight") show(current + 1);
  });
})();
