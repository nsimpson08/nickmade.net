#!/usr/bin/env python3
"""Copy what you added on the live site (owner mode) into the repo.

    python3 tools/pull_live.py            # do it
    python3 tools/pull_live.py --dry-run  # just show what would change

For every movie/game you added from the site to a live section (live: "key" in list.js),
and everything you added to a page's In the Queue yourself, this:
  1. saves its poster into movies/posters/ or games/posters/ (max 700px wide)
  2. adds it to the end of that section in list.js, with the art credit
Then commit and push as usual. Until you push, the site keeps showing the live copy; after you
push, the page hides the live copy (same title already in list.js), and the next run of this
script clears those from the live site's storage (needs the admin password: set
NICKMADE_ADMIN_TOKEN, or it will ask).

Visitor suggestions and Recently Watched/Played stay on the live site (they need the site to
show names, dates, and ratings), but everything live is saved to backups/live-YYYY-MM-DD.json.
"""
import argparse
import datetime
import getpass
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["movies", "games"]
UA = "Mozilla/5.0 (nickmade.net pull_live)"


def request(url, method="GET", token=None):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def get_json(url):
    return json.loads(request(url))


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def js(s):
    return json.dumps(s, ensure_ascii=False)


def save_poster(root, page, item):
    """Download the poster as posters/<title>.jpg (adding the year if that name is taken)."""
    url = item.get("image")
    if not url:
        return None
    if "m.media-amazon.com" in url:
        url = re.sub(r"\._V1_[^.]*\.", "._V1_UX700_.", url)
    folder = os.path.join(root, page, "posters")
    os.makedirs(folder, exist_ok=True)
    name = slug(item["title"])
    if os.path.exists(os.path.join(folder, name + ".jpg")) and item.get("year"):
        name += "-" + str(item["year"])
    n = 2
    base = name
    while os.path.exists(os.path.join(folder, name + ".jpg")):
        name = "%s-%d" % (base, n)
        n += 1
    path = os.path.join(folder, name + ".jpg")
    tmp = path + ".download"
    with open(tmp, "wb") as f:
        f.write(request(url))
    # JPEG, at most 700px wide, like the rest of posters/
    subprocess.run(["sips", "-s", "format", "jpeg", "-Z", "1400", tmp, "--out", path], check=True, capture_output=True)
    w = int(re.search(rb"pixelWidth: (\d+)", subprocess.run(["sips", "-g", "pixelWidth", path], capture_output=True).stdout).group(1))
    if w > 700:
        subprocess.run(["sips", "--resampleWidth", "700", path], check=True, capture_output=True)
    os.remove(tmp)
    return "posters/" + name + ".jpg"


def entry(item, image):
    credit = item.get("credit") or {}
    if credit.get("artist"):
        c = "{ artist: %s, url: %s }" % (js(credit["artist"]), js(credit.get("url", "")))
    else:
        c = "{ official: true }"
    parts = ["title: " + js(item["title"])]
    if item.get("year"):
        parts.append("year: %d" % int(item["year"]))
    if image:
        parts.append("image: " + js(image))
    parts.append("credit: " + c)
    return "      { " + ", ".join(parts) + " }"


def append_items(text, marker, lines):
    """Add lines to the end of the items array of the section containing marker."""
    at = text.index(marker)
    m = re.compile(r"items: \[").search(text, at)
    if not m:
        raise ValueError("no items list after " + marker)
    start = m.end()
    if text.startswith("]", start):  # items: []
        return text[:start] + "\n" + ",\n".join(lines) + "\n    " + text[start:]
    end = text.index("\n    ]", start)
    body = text[start:end].rstrip()
    if body.strip() and not body.endswith(","):
        body += ","
    return text[:start] + body + "\n" + ",\n".join(lines) + text[end:]


def section_titles(text, marker):
    """Titles in the items of the section containing marker ("" text or no section: none)."""
    if marker not in text:
        return set()
    at = text.index(marker)
    m = re.compile(r"items: \[").search(text, at)
    end = text.find("\n    ]", m.end()) if m else -1
    block = text[m.end():end if end > 0 else len(text)] if m else ""
    return {json.loads('"%s"' % t).lower() for t in re.findall(r'title:\s*"((?:[^"\\]|\\.)*)"', block)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="show what would change, touch nothing")
    ap.add_argument("--api", default="https://api.nickmade.net")
    ap.add_argument("--site", default="https://nickmade.net")
    ap.add_argument("--root", default=ROOT, help=argparse.SUPPRESS)  # for testing on a copy
    args = ap.parse_args()
    api = args.api.rstrip("/")

    snapshot = {"lists": {}, "watched": {}, "queue": {}}
    for page in PAGES:
        snapshot["watched"][page] = get_json(api + "/watched?page=" + page).get("items", [])
        snapshot["queue"][page] = get_json(api + "/queue?page=" + page).get("items", [])
    work = []  # (page, marker, section name, item, delete path)
    for page in PAGES:
        lists = get_json(api + "/lists?page=" + page).get("lists", {})
        snapshot["lists"][page] = lists
        for key, items in lists.items():
            for it in items:
                work.append((page, 'live: "%s"' % key, key, it, "/lists/%s/%s/%s" % (page, key, it["imdbId"])))
    for page in PAGES:
        for it in snapshot["queue"][page]:
            if it.get("owner"):
                work.append((page, 'live: "queue"', "In the Queue", it, "/queue/%s?page=%s" % (it["imdbId"], page)))

    if not args.dry_run:
        os.makedirs(os.path.join(args.root, "backups"), exist_ok=True)
        snap = os.path.join(args.root, "backups", "live-%s.json" % datetime.date.today().isoformat())
        with open(snap, "w") as f:
            json.dump(snapshot, f, indent=2, ensure_ascii=False)
        print("Saved a snapshot of everything live to", os.path.relpath(snap, args.root))

    if not work:
        print("Nothing to copy: no site additions waiting.")
        return

    live_js = {p: request("%s/%s/list.js?nocache=%d" % (args.site.rstrip("/"), p, datetime.datetime.now().timestamp())).decode("utf-8") for p in PAGES}
    local_js = {p: open(os.path.join(args.root, p, "list.js"), encoding="utf-8").read() for p in PAGES}
    copy, clean, waiting = [], [], []
    for w in work:
        page, marker, _, it, _ = w
        live_text, local_text = live_js[page], local_js[page]
        title = it["title"].lower()
        if title in section_titles(live_text, marker):
            clean.append(w)  # already pushed: the live copy is redundant
        elif title in section_titles(local_text, marker):
            waiting.append(w)  # copied before, not pushed yet
        else:
            copy.append(w)

    for page in PAGES:
        rows = [w for w in copy if w[0] == page]
        if not rows:
            continue
        path = os.path.join(args.root, page, "list.js")
        text = open(path, encoding="utf-8").read()
        for marker in dict.fromkeys(r[1] for r in rows):
            group = [r for r in rows if r[1] == marker]
            if marker not in text:
                print("  ! %s: no section with %s in list.js, skipped %d" % (page, marker, len(group)))
                continue
            lines = []
            for _, _, name, it, _ in group:
                image = None if args.dry_run else save_poster(args.root, page, it)
                lines.append(entry(it, image or ("posters/%s.jpg" % slug(it["title"]))))
                print("  copy   %s / %s: %s (%s)" % (page, name, it["title"], it.get("year") or "?"))
            text = append_items(text, marker, lines)
        if not args.dry_run:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
    for w in waiting:
        print("  wait   %s / %s: %s (in your list.js, not pushed yet)" % (w[0], w[2], w[3]["title"]))
    for w in clean:
        print("  clear  %s / %s: %s (pushed, removing the live copy)" % (w[0], w[2], w[3]["title"]))

    if args.dry_run:
        print("Dry run: nothing changed.")
        return
    if clean:
        token = os.environ.get("NICKMADE_ADMIN_TOKEN") or getpass.getpass("Admin password (to clear pushed ones from the live site): ")
        for w in clean:
            request(api + w[4], method="DELETE", token=token)
    if copy:
        print("Copied %d into list.js. Review, then commit and push; run this again afterwards to tidy up." % len(copy))
    elif not clean:
        print("Nothing new to copy.")

if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit("Server said %s %s (wrong password?)" % (e.code, e.reason))
