// Photography: photos Nick adds on the site in owner mode (Ver 1.4), from his phone, on top of the ones in
// photography/photos.js (tools/photos.py). Each goes to the top of its section (Pixel or Cats).
//
//   GET    /photos           { items: [site-added photos, newest first] (same shape as photos.js entries),
//                              hidden: [names of photos.js photos removed on the site] }
//   POST   /photos           (admin) multipart form: section ("pixel" | "cats"), w, h, and the files the browser made:
//                            full (the photo re-encoded at full size, so no location or camera data), s800, s1600, s2400
//                            (smaller copies, the ones that exist), thumb (400px, for the thumbnails and the poster wall)
//                            -> { item }
//   DELETE /photos/:id       (admin) a site-added photo (its id): taken off the page and its files deleted. A photos.js
//                            photo (its file name without ".jpg", e.g. "r01-k400-16"): hidden for everyone (its files
//                            stay; the repo is tools/photos.py's to change), like the Library's removed discs
//   GET    /photos/file/<key> one of the files from R2: only used locally (PHOTO_URL in worker/.dev.vars); on the live
//                            site they're served straight from the bucket at photos.nickmade.net
//
// Files: the R2 bucket nickmade-photos (binding PHOTOS), the same one tools/photos.py uploads full-size copies to,
// under site/<id>.jpg, site/<id>-800.jpg ..., site/<id>-thumb.webp. The list: KV key "photos"; removed photos.js
// photos: KV key "photos:hidden".
// The browser does the resizing (a Worker can't decode images), which also strips the metadata: canvas re-encodes
// only the pixels.

const KEY = "photos";
const HIDDEN = "photos:hidden";
const SECTIONS = ["pixel", "cats"]; // where site uploads can go (Film is scanned film, added with tools/photos.py)
const SIZES = [800, 1600, 2400];
const MAX_BYTES = 40e6; // per file

export async function photosRoute(request, url, env, cors, h) {
  if (url.pathname === "/photos" && request.method === "GET") {
    return h.json({ items: await list(env), hidden: await list(env, HIDDEN) }, 200, cors);
  }
  if (url.pathname === "/photos" && request.method === "POST") return add(request, env, cors, h);
  if (url.pathname.startsWith("/photos/file/") && request.method === "GET") return file(url, env);
  if (url.pathname.startsWith("/photos/") && request.method === "DELETE") return remove(request, url, env, cors, h);
  return null;
}

async function list(env, key) {
  try { return JSON.parse((await env.QUEUE.get(key || KEY)) || "[]"); } catch (e) { return []; }
}

function base(env) {
  return (env.PHOTO_URL || "https://photos.nickmade.net/").replace(/\/?$/, "/");
}

async function add(request, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  if (!env.PHOTOS) return h.json({ error: "Photo storage isn't set up." }, 500, cors);
  let form;
  try { form = await request.formData(); } catch (e) { return h.json({ error: "Bad upload." }, 400, cors); }
  const section = String(form.get("section") || "");
  if (!SECTIONS.includes(section)) return h.json({ error: "Pick Pixel or Cats." }, 400, cors);
  const w = parseInt(form.get("w"), 10), hgt = parseInt(form.get("h"), 10);
  const full = form.get("full");
  if (!(w > 0 && hgt > 0) || !full || typeof full === "string") return h.json({ error: "No photo in the upload." }, 400, cors);
  const files = { full };
  for (const s of SIZES) if (form.get("s" + s) && typeof form.get("s" + s) !== "string") files["s" + s] = form.get("s" + s);
  if (form.get("thumb") && typeof form.get("thumb") !== "string") files.thumb = form.get("thumb");
  for (const f of Object.values(files)) {
    if (f.size > MAX_BYTES) return h.json({ error: "That photo is too big (40 MB at most)." }, 413, cors);
    if (!/^image\/(jpeg|webp)$/.test(f.type)) return h.json({ error: "Only JPEG and WebP files." }, 400, cors);
  }

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: env.TIMEZONE || "America/Chicago" }).format(new Date()).replace(/-/g, "");
  const id = section + "-" + day + "-" + crypto.randomUUID().slice(0, 6);
  const put = (name, f) => env.PHOTOS.put("site/" + name, f.stream(), {
    httpMetadata: { contentType: f.type, cacheControl: "public, max-age=31536000, immutable" },
  });
  const sizes = [];
  const jobs = [put(id + ".jpg", full)];
  for (const s of SIZES) {
    if (!files["s" + s]) continue;
    jobs.push(put(id + "-" + s + ".jpg", files["s" + s]));
    sizes.push({ w: s, src: base(env) + "site/" + id + "-" + s + ".jpg" });
  }
  if (files.thumb) jobs.push(put(id + "-thumb.webp", files.thumb));
  await Promise.all(jobs);

  const item = {
    id,
    section,
    src: base(env) + "site/" + id + ".jpg",
    w,
    h: hgt,
    bytes: full.size,
    date: new Date().toISOString(),
    sizes,
    thumb: files.thumb ? base(env) + "site/" + id + "-thumb.webp" : "",
    site: true,
  };
  const items = await list(env);
  items.unshift(item);
  await env.QUEUE.put(KEY, JSON.stringify(items));
  return h.json({ item }, 200, cors);
}

async function remove(request, url, env, cors, h) {
  if (!h.isAdmin(request, env)) return h.json({ error: "Unauthorized" }, 401, cors);
  const id = decodeURIComponent(url.pathname.slice("/photos/".length));
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) return h.json({ error: "Bad id." }, 400, cors);
  const items = await list(env);
  const it = items.find((p) => p.id === id);
  if (!it) { // a photos.js photo: hide it for everyone
    const hidden = await list(env, HIDDEN);
    if (!hidden.includes(id)) hidden.push(id);
    await env.QUEUE.put(HIDDEN, JSON.stringify(hidden));
    return h.json({ hidden: id }, 200, cors);
  }
  await env.QUEUE.put(KEY, JSON.stringify(items.filter((p) => p !== it)));
  if (env.PHOTOS) {
    await env.PHOTOS.delete(["site/" + id + ".jpg", "site/" + id + "-thumb.webp"].concat(SIZES.map((s) => "site/" + id + "-" + s + ".jpg")));
  }
  return h.json({ removed: id }, 200, cors);
}

async function file(url, env) {
  const key = decodeURIComponent(url.pathname.slice("/photos/file/".length));
  if (!env.PHOTOS || !/^site\/[a-z0-9-]+\.(jpg|webp)$/.test(key)) return new Response("Not found", { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata.contentType || "image/jpeg", "Cache-Control": "public, max-age=3600" } });
}
