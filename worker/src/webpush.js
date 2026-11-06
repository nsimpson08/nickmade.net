// Web Push for the site's "Get notified" (fans.js): a message encrypted for one browser (RFC 8291 aes128gcm) and sent
// to its push service, signed with the site's VAPID key (VAPID_PUBLIC in wrangler.toml, VAPID_PRIVATE a secret).

export async function sendPush(env, sub, payload) {
  const aud = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(env, aud);
  const body = await encrypt(sub.keys, new TextEncoder().encode(payload));
  return fetch(sub.endpoint, {
    method: "POST",
    headers: { TTL: "86400", Urgency: "high", // high: delivered at once to a phone on standby, like the owner pages' own (normal can wait for the phone to wake)
      Authorization: "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC,
      "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" },
    body,
  });
}

// RFC 8291 (Message Encryption for Web Push) with RFC 8188's aes128gcm, one record: a fresh key pair and salt per
// message, the browser's p256dh public key and auth secret from its subscription
async function encrypt(keys, plain) {
  const uaPub = unb64(keys.p256dh), auth = unb64(keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const te = new TextEncoder();
  const ikm = await hkdf(auth, shared, cat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(plain, new Uint8Array([2])))); // 2: the last record
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return cat(head, asPub, sealed);
}
async function hkdf(salt, ikm, info, len) {
  const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len);
}
function cat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function unb64(s) {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
}

let signKey = null;
async function vapidJwt(env, aud) {
  if (!signKey) signKey = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ typ: "JWT", alg: "ES256" });
  const body = enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://nickmade.net" });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(new Uint8Array(sig));
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
