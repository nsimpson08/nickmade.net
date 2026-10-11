// The scorecard full screen, with its own pinch zoom (Scorecard's "Scorecard so far" and finish screen, and the Golf
// page's "On the course" rounds). The page itself never zooms (Nick, 2026-10-10: pinching a card in a sheet zoomed the
// whole page, and the hole screen then couldn't be zoomed back out). Pinch or double-tap to zoom, drag to look
// around; Done, Escape or the phone's Back closes it. Needs card.js (NMCard) and the card's fonts on the page.
//
//   NMCardViewer.open(round)   round: { course, tee, holes, scores, player, date }
(function () {
  var css = document.createElement("style");
  css.textContent = '/* the card full screen (viewer.js): it zooms itself, so the page never does */\n.sc-viewer {\n  width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0;\n  background: #0b0b0c; color: #ecebe7; display: flex; flex-direction: column;\n}\n.sc-viewer:not([open]) { display: none; }\n.sc-viewer::backdrop { background: #000; }\n.sc-viewer-bar {\n  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px;\n  padding: calc(8px + env(safe-area-inset-top)) 12px 8px 16px; font-size: 0.85rem; color: #9d9b95;\n}\n.sc-viewer-done { min-height: 48px; padding: 0 20px; border: 0; border-radius: 14px; background: #7ee0b5; color: #062218; font-weight: 700; }\n.sc-viewer-stage { position: relative; flex: 1; overflow: hidden; touch-action: none; }\n.sc-viewer-stage canvas { position: absolute; transform-origin: 0 0; border-radius: 6px; }';
  document.head.appendChild(css);

  function open(r) {
    var d = document.createElement("dialog");
    d.className = "sc-viewer";
    d.innerHTML = '<div class="sc-viewer-bar"><span>Pinch or double-tap to zoom</span><button type="button" class="sc-viewer-done">Done</button></div>' +
      '<div class="sc-viewer-stage"><canvas class="sc-card" aria-label="The scorecard"></canvas></div>';
    document.body.appendChild(d);
    var stage = d.querySelector(".sc-viewer-stage"), cv = d.querySelector("canvas");
    var s = 1, tx = 0, ty = 0, w = 0, h = 0, ox = 0, oy = 0;
    var pts = {}, start = null, lastTap = 0;
    function fit() {
      var sw = stage.clientWidth, sh = stage.clientHeight, ar = cv.width / cv.height || 1.3;
      w = Math.min(sw, sh * ar); h = w / ar;
      ox = (sw - w) / 2; oy = (sh - h) / 2;
      cv.style.width = w + "px"; cv.style.height = h + "px";
      cv.style.left = ox + "px"; cv.style.top = oy + "px";
      apply();
    }
    function clampAxis(t, size, room, o) { // keep the card on screen: centered while it fits, edges to the edges after
      var big = size * s;
      if (big <= room) return (room - big) / 2 - o;
      return Math.min(-o, Math.max(room - big - o, t));
    }
    function apply() {
      s = Math.max(1, Math.min(5, s));
      tx = clampAxis(tx, w, stage.clientWidth, ox);
      ty = clampAxis(ty, h, stage.clientHeight, oy);
      cv.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
    }
    function zoomAt(px, py, ns) { // zoom to ns keeping the point under (px, py) still
      var qx = (px - ox - tx) / s, qy = (py - oy - ty) / s;
      s = Math.max(1, Math.min(5, ns));
      tx = px - ox - qx * s; ty = py - oy - qy * s;
      apply();
    }
    function local(e) { var b = stage.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
    function pair() {
      var a = Object.keys(pts).map(function (k) { return pts[k]; });
      return { mid: [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2], dist: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || 1 };
    }
    stage.addEventListener("pointerdown", function (e) {
      stage.setPointerCapture(e.pointerId);
      pts[e.pointerId] = local(e);
      var n = Object.keys(pts).length;
      if (n === 2) { var pr = pair(); start = { s: s, tx: tx, ty: ty, mid: pr.mid, dist: pr.dist }; }
      else if (n === 1) {
        var now = Date.now(), p = pts[e.pointerId];
        if (now - lastTap < 300) { zoomAt(p[0], p[1], s > 1.2 ? 1 : 2.5); lastTap = 0; }
        else lastTap = now;
        start = { s: s, tx: tx, ty: ty, at: p };
      }
    });
    stage.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId] || !start) return;
      pts[e.pointerId] = local(e);
      var n = Object.keys(pts).length;
      if (n >= 2 && start.dist) {
        var pr = pair();
        // the content point that was under the fingers' first midpoint stays under their midpoint now
        var qx = (start.mid[0] - ox - start.tx) / start.s, qy = (start.mid[1] - oy - start.ty) / start.s;
        s = Math.max(1, Math.min(5, start.s * pr.dist / start.dist));
        tx = pr.mid[0] - ox - qx * s; ty = pr.mid[1] - oy - qy * s;
        apply();
      } else if (n === 1 && start.at) {
        var p = pts[e.pointerId];
        tx = start.tx + p[0] - start.at[0]; ty = start.ty + p[1] - start.at[1];
        apply();
      }
    });
    function lift(e) {
      delete pts[e.pointerId];
      var left = Object.keys(pts);
      // one finger still down after a pinch: carry on as a drag from where it is
      start = left.length === 1 ? { s: s, tx: tx, ty: ty, at: pts[left[0]] } : null;
    }
    stage.addEventListener("pointerup", lift);
    stage.addEventListener("pointercancel", lift);
    stage.addEventListener("wheel", function (e) { // trackpads and mice
      e.preventDefault();
      var p = local(e);
      zoomAt(p[0], p[1], s * Math.exp(-e.deltaY / 300));
    }, { passive: false });
    // Back (the phone's button) closes it: it takes a history step of its own, given back when closed another way
    var stepped = false;
    function onPop() { stepped = false; if (d.open) d.close(); }
    try { history.pushState({ scViewer: true }, ""); stepped = true; window.addEventListener("popstate", onPop); } catch (e) {}
    d.querySelector(".sc-viewer-done").addEventListener("click", function () { d.close(); });
    d.addEventListener("close", function () {
      window.removeEventListener("resize", fit);
      window.removeEventListener("popstate", onPop);
      d.remove();
      if (stepped) { stepped = false; history.back(); }
    });
    window.addEventListener("resize", fit);
    d.showModal();
    NMCard.draw(cv, r.course, r, { scale: 3 }).then(fit);
  }

  window.NMCardViewer = { open: open };
})();
