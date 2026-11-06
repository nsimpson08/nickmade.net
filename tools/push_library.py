#!/usr/bin/env python3
"""Copy the Library shelves Nick filled on localhost (vinyl, books, board games) to the live site, for the 1.7 release,
so the live Library opens full instead of empty.

    python3 tools/push_library.py          # a dry run: says what it would copy, changes nothing
    python3 tools/push_library.py --go     # do it

For each shelf (the Worker's storage key collection:<kind>):
  - its covers that live in the local photo store (http://localhost:8787/photos/file/covers/...), a record's back
    cover, and each cover's 400 px small copy (thumb; its thumbOf is pointed at the live cover), are uploaded to the live one (R2 nickmade-photos, served at photos.nickmade.net, kept a year like the
    Worker's own copies) and the item points there; one still at its catalogue's address (the copy failed when it was
    added) is left as it is
  - anything already on the live shelf that isn't on the local one (added on the live site) is kept: the two lists are
    put together, newest first
  - the live shelf is backed up first to backups/library-live-<kind>-<time>.json (backups/ is never pushed)

And the Movies page's Nick's Picks changed on localhost (library:picks, "Make it a Nick's Pick" on an open case): put
together with the live ones, localhost's choice winning for a film both changed (backed up the same way first).

Nothing is ever left off (Nick, 2026-10-30: "literally all current data in all libraries gets pushed live"): the dry
run checks every local cover can be read (through the local Worker on :8787, so have it running), --go uploads every
cover for every shelf BEFORE writing any shelf and stops if one fails, and afterwards reads the live site back and
checks every item, every field and every cover arrived (it says "ALL CHECKED" at the end, or what's wrong).

Run it after the Worker with the Library is deployed (the live pages read these through it) and before or with the
site push. Reads and writes with wrangler from worker/, so it needs the same Cloudflare login as deploying. It never
changes localhost.
"""
import datetime
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(ROOT, "worker")
BUCKET = "nickmade-photos"
LOCAL_PHOTOS = "http://localhost:8787/photos/file/"
LIVE_PHOTOS = "https://photos.nickmade.net/"
KINDS = ["vinyl", "books", "games"]
TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def wrangler(*args):
    return subprocess.run(["npx", "wrangler", *args], cwd=WORKER, capture_output=True, text=True)


def shelf(kind, where):
    """A shelf's items from the local (--local) or live (--remote) storage; [] when it has none."""
    r = wrangler("kv", "key", "get", "collection:" + kind, "--binding", "QUEUE", where)
    if r.returncode != 0 or not r.stdout.strip() or r.stdout.strip() == "Value not found":
        return []
    try:
        return json.loads(r.stdout)
    except ValueError:
        sys.exit("Couldn't read the %s shelf (%s): %s" % (kind, where, r.stdout[:200]))


def picks(where):
    """The Movies page's site-changed picks, { on: [title keys], off: [title keys] }."""
    r = wrangler("kv", "key", "get", "library:picks", "--binding", "QUEUE", where)
    try:
        p = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() not in ("", "Value not found") else {}
    except ValueError:
        sys.exit("Couldn't read the Movies picks (%s): %s" % (where, r.stdout[:200]))
    return {"on": list(p.get("on") or []), "off": list(p.get("off") or [])}


def push_picks(go, stamp, work):
    local, live = picks("--local"), picks("--remote")
    if not local["on"] and not local["off"]:
        print("picks  no Movies picks changed on localhost, skipped")
        return
    mine = set(local["on"]) | set(local["off"])
    merged = {"on": [k for k in live["on"] if k not in mine] + local["on"],
              "off": [k for k in live["off"] if k not in mine] + local["off"]}
    print("picks  Movies: %d made a Nick's Pick, %d taken off on localhost (%s)"
          % (len(local["on"]), len(local["off"]), ", ".join(local["on"] + ["not " + k for k in local["off"]])))
    if not go:
        return
    with open(os.path.join(ROOT, "backups", "library-live-picks-%s.json" % stamp), "w") as f:
        json.dump(live, f)
    path = os.path.join(work, "picks.json")
    with open(path, "w") as f:
        json.dump(merged, f)
    r = wrangler("kv", "key", "put", "library:picks", "--path", path, "--binding", "QUEUE", "--remote")
    if r.returncode != 0:
        sys.exit("Writing the live Movies picks failed: %s" % (r.stderr or r.stdout).strip()[-300:])
    back = picks("--remote")
    if back != merged:
        sys.exit("The live Movies picks didn't read back as written: run it again (it's safe to repeat).")
    print("picks  live now has %d on, %d off (checked)" % (len(merged["on"]), len(merged["off"])))


def upload(d, field, work):
    """d[field] (a cover, or a record's back) from the local photo store to the live one, and point it there."""
    url = str(d.get(field, ""))
    if not url.startswith(LOCAL_PHOTOS):
        return  # at its catalogue's address, or none
    key = url[len(LOCAL_PHOTOS):]
    path = os.path.join(work, key.replace("/", "_"))
    got = wrangler("r2", "object", "get", BUCKET + "/" + key, "--local", "--file", path)
    if got.returncode != 0 or not os.path.exists(path) or os.path.getsize(path) < 100:
        sys.exit("STOPPED, nothing written: couldn't read %s's local %s (%s)" % (d.get("title"), field, key))
    ext = key.rsplit(".", 1)[-1].lower()
    put = wrangler("r2", "object", "put", BUCKET + "/" + key, "--file", path, "--remote",
                   "--content-type", TYPES.get(ext, "image/jpeg"), "--cache-control", "public, max-age=31536000, immutable")
    if put.returncode != 0:
        sys.exit("Uploading %s failed: %s" % (key, (put.stderr or put.stdout).strip()[-300:]))
    d[field] = LIVE_PHOTOS + key


def readable(url, timeout=30):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "nickmade.net push_library"}), timeout=timeout) as r:
            return r.status == 200 and len(r.read()) >= 100
    except Exception:
        return False


def verify(sent, work):
    """Read every shelf back from the live site: every item and field as sent, every cover reachable."""
    problems = 0
    for kind, items in sent.items():
        live = {d.get("id"): d for d in shelf(kind, "--remote")}
        for d in items:
            got = live.get(d.get("id"))
            if got != d:
                problems += 1
                print("   ! %s: %s isn't on the live shelf as sent" % (kind, d.get("title")))
        urls = [d[f] for d in items for f in ("cover", "back", "thumb", "labelPic", "labelPicB") if str(d.get(f, "")).startswith(LIVE_PHOTOS)]
        bad = [u for u in urls if not readable(u)]
        for u in bad:
            print("   ! %s: cover not reachable live: %s" % (kind, u))
        problems += len(bad)
        print("%-6s checked live: %d items, %d covers" % (kind, len(items), len(urls)))
    return problems


def main():
    go = "--go" in sys.argv
    stamp = datetime.datetime.now().strftime("%Y-%m-%d-%H%M")
    os.makedirs(os.path.join(ROOT, "backups"), exist_ok=True)
    work = tempfile.mkdtemp(prefix="push-library-")
    print("Dry run: nothing changes. Add --go to copy.\n" if not go else "Copying the local Library shelves to the live site.\n")
    ready = {}
    for kind in KINDS:
        local, live = shelf(kind, "--local"), shelf(kind, "--remote")
        if not local:
            print("%-6s nothing on the local shelf, skipped" % kind)
            continue
        ids = {d.get("id") for d in local}
        keep = [d for d in live if d.get("id") not in ids]  # added on the live site: kept
        covers = [d for d in local for f in ("cover", "back", "thumb", "labelPic", "labelPicB") if str(d.get(f, "")).startswith(LOCAL_PHOTOS)]
        print("%-6s %d on the local shelf (%d cover images to upload), %d already live (%d of them only live, kept)"
              % (kind, len(local), len(covers), len(live), len(keep)))
        if not go:
            bad = [d.get("title") for d in local for f in ("cover", "back", "thumb", "labelPic", "labelPicB")
                   if str(d.get(f, "")).startswith(LOCAL_PHOTOS) and not readable(d[f])]
            print("       every local cover readable" if not bad else "   ! these covers can't be read locally (is the local Worker running on :8787?): " + ", ".join(bad))
            continue
        out = []
        for n, d in enumerate(local, 1):
            d = dict(d)
            for field in ("cover", "back", "thumb", "labelPic", "labelPicB"):  # (a record's back cover, and the cover's small copy, too)
                upload(d, field, work)
            if str(d.get("thumbOf", "")).startswith(LOCAL_PHOTOS):  # the small copy names the cover it was made from
                d["thumbOf"] = LIVE_PHOTOS + d["thumbOf"][len(LOCAL_PHOTOS):]
            print("   %s cover %d of %d" % (kind, n, len(local)), end="\r")
            out.append(d)
        print()
        ready[kind] = (live, out, keep)
    # every cover is up: now the shelves themselves
    sent = {}
    for kind, (live, out, keep) in ready.items():
        with open(os.path.join(ROOT, "backups", "library-live-%s-%s.json" % (kind, stamp)), "w") as f:
            json.dump(live, f)
        merged = sorted(out + keep, key=lambda d: str(d.get("added", "")), reverse=True)  # newest first, like the Worker keeps them
        path = os.path.join(work, kind + ".json")
        with open(path, "w") as f:
            json.dump(merged, f)
        r = wrangler("kv", "key", "put", "collection:" + kind, "--path", path, "--binding", "QUEUE", "--remote")
        if r.returncode != 0:
            sys.exit("Writing the live %s shelf failed: %s" % (kind, (r.stderr or r.stdout).strip()[-300:]))
        print("%-6s live now has %d (backup of what was there: backups/library-live-%s-%s.json)" % (kind, len(merged), kind, stamp))
        sent[kind] = out
    push_picks(go, stamp, work)
    if go:
        problems = verify(sent, work)
        print("\nALL CHECKED: every item, field and cover is live." if not problems else "\n%d PROBLEMS above: run it again (it's safe to repeat)." % problems)


if __name__ == "__main__":
    main()
