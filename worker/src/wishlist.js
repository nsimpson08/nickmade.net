// Nick's wishlist (wishlist/, nickmade.net/wishlist): public to anyone with the link, linked from nowhere on the site
// (Nick, 2026-10-19). Nick adds items in owner mode; visitors can mark one "I'm getting this" so two people don't buy
// the same thing. Claims are hidden from Nick (owner mode) so gifts stay a surprise, unless he asks with ?reveal=1.
//
//   GET    /wishlist?visitorId=[&reveal=1]  { items: [{ id, title, url, image, price, note, group, star, added,
//                                          claimed?, mine? }], groups: [names] }  claimed: someone's getting it;
//                                          mine: this browser is. Owner mode: no claim info unless reveal=1
//   POST   /wishlist/:id/claim         { visitorId } -> { item }: "I'm getting this" (one claim per item)
//   DELETE /wishlist/:id/claim?visitorId=   takes this browser's claim back
//   GET    /wishlist/preview?url=      (admin) a product page's title, picture and price, to fill the add form
//   POST   /wishlist                   (admin) { title, url?, image?, price?, note?, group?, star? } -> { item }
//   PATCH  /wishlist/:id               (admin) any of those -> { item }
//   DELETE /wishlist/:id               (admin) the item (and its claim) goes
//
// Storage (the QUEUE namespace): wishlist:items  JSON array of items
//                                wishlist:claims { itemId: { key: hashed visitor id, at } }

const ITEMS = "wishlist:items";
const CLAIMS = "wishlist:claims";
const VID = /^[a-z0-9-]{8,64}$/i;
const MAX_ITEMS = 300;

export async function wishlistRoute(request, url, env, cors, h) {
  const path = url.pathname, m = request.method, admin = h.isAdmin(request, env);
  if (path === "/wishlist" && m === "GET") return list(request, url, env, cors, h, admin);
  if (path === "/wishlist/preview" && m === "GET") {
    if (!admin) return h.json({ error: "Unauthorized" }, 401, cors);
    return preview(url.searchParams.get("url"), cors, h);
  }
  if (path === "/wishlist" && m === "POST") {
    if (!admin) return h.json({ error: "Unauthorized" }, 401, cors);
    return add(request, env, cors, h);
  }
  const cm = /^\/wishlist\/([a-z0-9]{6,16})\/claim$/.exec(path);
  if (cm && m === "POST") return claim(cm[1], request, env, cors, h);
  if (cm && m === "DELETE") return unclaim(cm[1], url, env, cors, h);
  const im = /^\/wishlist\/([a-z0-9]{6,16})$/.exec(path);
  if (im && (m === "PATCH" || m === "DELETE")) {
    if (!admin) return h.json({ error: "Unauthorized" }, 401, cors);
    return m === "PATCH" ? edit(im[1], request, env, cors, h) : remove(im[1], env, cors, h);
  }
  return null;
}

async function getJSON(env, key, fallback) {
  try { return JSON.parse((await env.QUEUE.get(key)) || "null") || fallback; } catch (e) { return fallback; }
}
const visitorKey = (h, env, vid) => h.sha256((env.SALT || "nickmade") + "wish:" + vid);

// what one visitor sees of an item: whether it's taken, and whether they're the one taking it
function shown(it, claims, me, hide) {
  const c = claims[it.id];
  if (hide) return it;
  return { ...it, claimed: !!c, mine: !!(c && me && c.key === me) };
}

async function list(request, url, env, cors, h, admin) {
  const [items, claims] = await Promise.all([getJSON(env, ITEMS, []), getJSON(env, CLAIMS, {})]);
  const vid = url.searchParams.get("visitorId");
  const me = VID.test(vid || "") ? await visitorKey(h, env, vid) : null;
  const hide = admin && url.searchParams.get("reveal") !== "1"; // Nick doesn't see what's claimed
  const groups = [...new Set(items.map((it) => it.group).filter(Boolean))];
  return h.json({ items: items.map((it) => shown(it, claims, me, hide)), groups, owner: admin }, 200, cors);
}

async function claim(id, request, env, cors, h) {
  let b = {};
  try { b = await request.json(); } catch (e) {}
  if (!VID.test(b.visitorId || "")) return h.json({ error: "Your browser didn't send its id. Try reloading." }, 400, cors);
  const items = await getJSON(env, ITEMS, []), it = items.find((x) => x.id === id);
  if (!it) return h.json({ error: "That item isn't on the list any more." }, 404, cors);
  const claims = await getJSON(env, CLAIMS, {}), me = await visitorKey(h, env, b.visitorId);
  if (claims[id] && claims[id].key !== me) return h.json({ error: "Someone's already getting this one." }, 409, cors);
  claims[id] = { key: me, at: Date.now() };
  await env.QUEUE.put(CLAIMS, JSON.stringify(claims));
  return h.json({ item: shown(it, claims, me, false) }, 200, cors);
}

async function unclaim(id, url, env, cors, h) {
  const vid = url.searchParams.get("visitorId");
  if (!VID.test(vid || "")) return h.json({ error: "Your browser didn't send its id. Try reloading." }, 400, cors);
  const claims = await getJSON(env, CLAIMS, {}), me = await visitorKey(h, env, vid);
  if (claims[id] && claims[id].key !== me) return h.json({ error: "Only the person getting it can undo that." }, 403, cors);
  delete claims[id];
  await env.QUEUE.put(CLAIMS, JSON.stringify(claims));
  const it = (await getJSON(env, ITEMS, [])).find((x) => x.id === id);
  return h.json({ item: it ? shown(it, claims, me, false) : null }, 200, cors);
}

// ---------- Nick's edits ----------

function clean(b, old) {
  const s = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  const link = (v) => { const u = s(v, 1000); return /^https?:\/\//i.test(u) ? u : ""; };
  const it = { ...(old || {}) };
  if (b.title !== undefined) it.title = s(b.title, 140);
  if (b.url !== undefined) it.url = link(b.url);
  if (b.image !== undefined) it.image = link(b.image);
  if (b.price !== undefined) it.price = s(b.price, 24);
  if (b.note !== undefined) it.note = s(b.note, 200);
  if (b.group !== undefined) it.group = s(b.group, 40);
  if (b.star !== undefined) it.star = !!b.star;
  for (const k of Object.keys(it)) if (it[k] === "" || it[k] === false) delete it[k];
  return it;
}

async function add(request, env, cors, h) {
  let b = {};
  try { b = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const it = clean(b);
  if (!it.title) return h.json({ error: "Give it a name." }, 400, cors);
  const items = await getJSON(env, ITEMS, []);
  if (items.length >= MAX_ITEMS) return h.json({ error: "The list is full (" + MAX_ITEMS + " items)." }, 409, cors);
  it.id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  it.added = new Date().toISOString().slice(0, 10);
  items.unshift(it);
  await env.QUEUE.put(ITEMS, JSON.stringify(items));
  return h.json({ item: it }, 200, cors);
}

async function edit(id, request, env, cors, h) {
  let b = {};
  try { b = await request.json(); } catch (e) { return h.json({ error: "Bad request." }, 400, cors); }
  const items = await getJSON(env, ITEMS, []), i = items.findIndex((x) => x.id === id);
  if (i < 0) return h.json({ error: "No such item." }, 404, cors);
  const it = clean(b, items[i]);
  if (!it.title) return h.json({ error: "Give it a name." }, 400, cors);
  items[i] = it;
  await env.QUEUE.put(ITEMS, JSON.stringify(items));
  return h.json({ item: it }, 200, cors);
}

async function remove(id, env, cors, h) {
  const items = await getJSON(env, ITEMS, []), kept = items.filter((x) => x.id !== id);
  if (kept.length !== items.length) await env.QUEUE.put(ITEMS, JSON.stringify(kept));
  const claims = await getJSON(env, CLAIMS, {});
  if (claims[id]) { delete claims[id]; await env.QUEUE.put(CLAIMS, JSON.stringify(claims)); }
  return h.json({ removed: id }, 200, cors);
}

// ---------- a product link's details (for the add form; Nick fixes anything it gets wrong) ----------
// The page's Open Graph tags, then its schema.org Product data (JSON-LD) for the price. Some stores (Amazon) turn
// servers away; then the form just keeps the link and Nick types the rest.
async function preview(raw, cors, h) {
  let u;
  try { u = new URL(String(raw || "")); } catch (e) { return h.json({ error: "That isn't a link." }, 400, cors); }
  if (!/^https?:$/.test(u.protocol)) return h.json({ error: "That isn't a link." }, 400, cors);
  let html = "";
  try {
    // some stores never answer a server (Best Buy hangs): 8 seconds, then the form is filled in by hand
    const r = await fetch(u.href, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" } });
    if (!r.ok) return h.json({ found: false, status: r.status }, 200, cors);
    html = (await Promise.race([r.text(), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 8000))])).slice(0, 1500000);
  } catch (e) { return h.json({ found: false }, 200, cors); }
  const meta = (name) => {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + name.replace(/[:.]/g, "\\$&") + '["\'][^>]*>', "i");
    const tag = (html.match(re) || [])[0];
    return tag ? decode((tag.match(/content=["']([^"']*)["']/i) || [])[1] || "") : "";
  };
  let title = meta("og:title") || meta("twitter:title") || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "");
  let image = meta("og:image") || meta("og:image:secure_url") || meta("twitter:image");
  let price = meta("product:price:amount") || meta("og:price:amount");
  let currency = meta("product:price:currency") || meta("og:price:currency");
  // schema.org Product: offers.price (or lowPrice)
  for (const block of html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []) {
    let data;
    try { data = JSON.parse(block.replace(/^<script[^>]*>|<\/script>$/gi, "")); } catch (e) { continue; }
    const all = [].concat(data, data && data["@graph"] || []).flat();
    const prod = all.find((x) => x && /Product/i.test([].concat(x["@type"] || []).join(" ")));
    if (!prod) continue;
    if (!title && prod.name) title = String(prod.name);
    if (!image && prod.image) image = String([].concat(prod.image)[0] && ([].concat(prod.image)[0].url || [].concat(prod.image)[0]));
    const offer = [].concat(prod.offers || [])[0] || {};
    if (!price && (offer.price || offer.lowPrice)) { price = String(offer.price || offer.lowPrice); currency = currency || offer.priceCurrency || ""; }
    break;
  }
  // Amazon has no Open Graph picture or price: its main picture and the "price to pay" box
  if (!image) image = decode((html.match(/id="landingImage"[^>]*data-old-hires="([^"]+)"/) || html.match(/"hiRes":"(https:[^"]+)"/) || [])[1] || "");
  if (!price) { const pp = html.match(/priceToPay[\s\S]{0,400}?class="a-offscreen">\s*([^<]+)</); if (pp) price = pp[1]; }
  if (image && !/^https?:/i.test(image)) { try { image = new URL(image, u.href).href; } catch (e) { image = ""; } }
  title = title.replace(/\s+/g, " ").trim().replace(/\s*[|:–-]\s*(Amazon\.com|Walmart\.com|Target|Best Buy)\s*$/i, "").replace(/^Amazon\.com\s*:\s*/i, "").slice(0, 140);
  const n = parseFloat(String(price).replace(/[^0-9.]/g, ""));
  const priceText = n > 0 ? ((!currency || /usd/i.test(currency)) ? "$" + (n % 1 ? n.toFixed(2) : n) : n + " " + currency) : "";
  return h.json({ found: !!(title || image), title, image, price: priceText }, 200, cors);
}
function decode(s) {
  return String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, x) => String.fromCharCode(parseInt(x, 16)));
}
