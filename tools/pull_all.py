#!/usr/bin/env python3
"""Download a full copy of everything the live site keeps outside the repo, for safekeeping.

    python3 tools/pull_all.py

Saves backups/full-YYYY-MM-DD-HHMM/ (backups/ is git-ignored, so none of it is ever pushed):
  kv.json   every entry in the Worker's storage (the KV namespace), exactly as stored, private fields included:
            the queue with every visitor's note, Recently Watched/Played and their archives (with who you watched
            with), section adds, removed items, Library discs, votes, the golf leaderboard, song suggestions,
            gamerscore history, everything. Skipped: Spotify's sign-in tokens (secrets; reconnect with
            tools/spotify_connect.py instead) and the short-lived caches.
  photos/   the files of every photo added from your phone (Photography, owner mode), from photos.nickmade.net

It only reads. Nothing on the live site changes, and a push never sends any of this back. (tools/pull_live.py is the
other backup: it copies your site adds into list.js; this one is the whole raw copy.) Reads storage with wrangler from
worker/, so it needs the same Cloudflare login as deploying.

To put an entry back by hand: from worker/, npx wrangler kv key put <key> --path <file with its JSON> --binding QUEUE
"""
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(ROOT, "worker")
UA = "Mozilla/5.0 (nickmade.net pull_all)"
# secrets and caches that would be stale or unsafe to keep a copy of
SKIP = re.compile(r"^spotify:(refresh|access|state:|now$|recent$|top:)|^xbox:recent$")


def wrangler(*args):
    out = subprocess.run(["npx", "wrangler", "kv", "key"] + list(args) + ["--binding", "QUEUE"],
                         cwd=WORKER, capture_output=True, text=True)
    if out.returncode:
        sys.exit("wrangler failed: " + (out.stderr.strip().splitlines() or ["?"])[-1])
    return out.stdout


def main():
    names = sorted(k["name"] for k in json.loads(wrangler("list")))
    stamp = datetime.datetime.now().strftime("%Y-%m-%d-%H%M")
    folder = os.path.join(ROOT, "backups", "full-" + stamp)
    os.makedirs(folder, exist_ok=True)

    kv, skipped = {}, []
    for i, name in enumerate(names, 1):
        if SKIP.search(name):
            skipped.append(name)
            continue
        print("\r  reading %d of %d: %-40s" % (i, len(names), name[:40]), end="", flush=True)
        raw = wrangler("get", name, "--text")
        try:
            kv[name] = json.loads(raw)
        except ValueError:
            kv[name] = raw
    print("\r" + " " * 70 + "\r", end="")
    with open(os.path.join(folder, "kv.json"), "w", encoding="utf-8") as f:
        json.dump(kv, f, indent=2, ensure_ascii=False)
    print("Saved %d storage entries to %s" % (len(kv), os.path.relpath(folder, ROOT) + "/kv.json"))
    if skipped:
        print("  (skipped %d: %s)" % (len(skipped), ", ".join(skipped)))

    urls = []
    for p in kv.get("photos") or []:
        urls += [p.get("src"), p.get("thumb")] + [s.get("src") for s in p.get("sizes") or []]
    urls = [u for u in urls if u]
    if urls:
        os.makedirs(os.path.join(folder, "photos"), exist_ok=True)
        for n, u in enumerate(urls, 1):
            print("\r  photo file %d of %d" % (n, len(urls)), end="", flush=True)
            req = urllib.request.Request(u, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as res, open(os.path.join(folder, "photos", u.rsplit("/", 1)[-1]), "wb") as f:
                f.write(res.read())
        print("\rSaved %d photo files to %s" % (len(urls), os.path.relpath(folder, ROOT) + "/photos/"))
    else:
        print("No photos added from the phone yet.")


if __name__ == "__main__":
    main()
