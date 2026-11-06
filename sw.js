// nickmade.net's service worker, only for "Get notified" (assets/js/fans.js; the Worker's fans.js sends): no fetch
// handler and no caching, so pages load exactly as without it. A push carries its message, encrypted for this
// browser; it's shown as is, and tapping it opens that page (or brings NickMade forward and goes there).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let m = null;
  try { m = e.data ? e.data.json() : null; } catch (err) {}
  if (!m || !m.title) m = { title: "NickMade", body: "Something new on the site.", url: "/" };
  e.waitUntil(self.registration.showNotification(m.title, {
    body: m.body || "",
    tag: m.tag || undefined,
    data: { url: m.url || "/" },
    icon: "/assets/app/icon-192.png",
    badge: "/assets/app/badge-96.png",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      if (c.url === url && "focus" in c) { try { return await c.focus(); } catch (err) {} }
    }
    for (const c of open) {
      if (!("navigate" in c)) continue;
      try { const n = await c.navigate(url); if (n) return await n.focus(); } catch (err) { /* not this window */ }
    }
    return self.clients.openWindow(url);
  })());
});
