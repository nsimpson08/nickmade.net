#!/usr/bin/env python3
"""Copy what you added on the live site (owner mode) into the repo.

    python3 tools/pull_live.py            # do it
    python3 tools/pull_live.py --dry-run  # just show what would change

For every movie/game you added from the site to a live section (live: "key" in list.js),
and everything you added to a page's In the Queue yourself, this:
  1. saves its poster into movies/posters/ or games/posters/ (max 700px wide)
  2. adds it to that section in list.js with the art credit: at the TOP for live sections (newest first, the order
     the site shows), at the end for In the Queue
and for every list.js item you removed on the site (owner mode Remove), deletes it from list.js; once that's pushed,
the next run clears it from the live site's hidden list.
Then commit and push as usual. Until you push, the site keeps showing the live copy; after you
push, the page hides the live copy (same title already in list.js), and the next run of this
script clears those from the live site's storage (needs the admin password: set
NICKMADE_ADMIN_TOKEN, or it will ask).

Visitor suggestions and Recently Watched/Played stay on the live site (they need the site to
show names, dates, and ratings), but everything live is saved to backups/live-YYYY-MM-DD.json.

It also deletes games from games/list.js In the Queue that are now in Recently Played (same title,
ignoring only case and symbols like the trademark sign). The site already hides them; this makes it permanent.
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


def _match(text, i):
    """Index just past the bracket/brace that closes the one at text[i], skipping over strings."""
    open_ch = text[i]
    close_ch = {"[": "]", "{": "}"}[open_ch]
    depth, j, quote = 0, i, None
    while j < len(text):
        c = text[j]
        if quote:
            if c == "\\":
                j += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    raise ValueError("unbalanced list.js")


def _objects(block):
    """The top-level { ... } entries in an array's inside text, as written."""
    out, i = [], 0
    while True:
        i = block.find("{", i)
        if i < 0:
            return out
        end = _match(block, i)
        out.append(block[i:end])
        i = end


def _title(obj):
    m = re.search(r'title:\s*"((?:[^"\\]|\\.)*)"', obj)
    return json.loads('"%s"' % m.group(1)) if m else ""


def _items_span(text, marker):
    """(start, end) of the inside of the items array of the section containing marker."""
    m = re.compile(r"items: \[").search(text, text.index(marker))
    close = _match(text, m.end() - 1)
    return m.end(), close - 1


def _rebuild(text, marker, objs):
    a, b = _items_span(text, marker)
    body = ("\n      " + ",\n      ".join(objs) + "\n    ") if objs else ""
    return text[:a] + body + text[b:]


def put_on_top(text, marker, new_lines):
    """Live sections: new entries go first (newest first), above what's already there."""
    a, b = _items_span(text, marker)
    return _rebuild(text, marker, [l.strip() for l in new_lines] + _objects(text[a:b]))


def remove_titled(text, marker, title):
    """Delete the entries titled `title` (same_title match) from the section containing marker. Returns (text, removed?)."""
    a, b = _items_span(text, marker)
    objs = _objects(text[a:b])
    kept = [o for o in objs if same_title(_title(o)) != same_title(title)]
    return (_rebuild(text, marker, kept), True) if len(kept) != len(objs) else (text, False)


def section_marker(text, key):
    """The list.js marker for a section key: 'live: "key"', or for "s:<slug>" (no live key) its title line."""
    if not key.startswith("s:"):
        return 'live: "%s"' % key
    for t in re.findall(r'\n    title: "((?:[^"\\]|\\.)*)"', text):
        if slug(json.loads('"%s"' % t)) == key[2:]:
            return 'title: %s' % js(json.loads('"%s"' % t))
    return None


def section_titles(text, marker):
    """Titles in the items of the section containing marker ("" text or no section: none)."""
    if marker not in text:
        return set()
    at = text.index(marker)
    m = re.compile(r"items: \[").search(text, at)
    end = text.find("\n    ]", m.end()) if m else -1
    block = text[m.end():end if end > 0 else len(text)] if m else ""
    return {json.loads('"%s"' % t).lower() for t in re.findall(r'title:\s*"((?:[^"\\]|\\.)*)"', block)}


def same_title(s):
    """The Worker's normalize(): lowercase, accents dropped, & -> and, anything else not a letter/digit -> one space."""
    import unicodedata
    s = unicodedata.normalize("NFKD", str(s).lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).replace("&", "and")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def drop_played(text, played):
    """Remove In the Queue items (one per line) whose title is in played (same_title form). Returns (text, titles)."""
    marker = 'live: "queue"'
    if marker not in text:
        return text, []
    m = re.compile(r"items: \[").search(text, text.index(marker))
    if not m or text.startswith("]", m.end()):
        return text, []
    end = text.index("\n    ]", m.end())
    lines = text[m.end():end].split("\n")
    kept, dropped = [], []
    for line in lines:
        t = re.match(r'\s*\{\s*title:\s*"((?:[^"\\]|\\.)*)"', line)
        if t and same_title(json.loads('"%s"' % t.group(1))) in played:
            dropped.append(json.loads('"%s"' % t.group(1)))
        else:
            kept.append(line)
    if not dropped:
        return text, []
    items = [l for l in kept if l.strip()]
    items = [l.rstrip().rstrip(",") for l in items]
    body = ("\n" + ",\n".join(items)) if items else ""
    return text[:m.end()] + body + (text[end:] if items else text[end:].lstrip("\n").lstrip()), dropped


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
    # Games now in Recently Played come out of list.js In the Queue
    played = {same_title(it.get("title", "")) for it in snapshot["watched"]["games"]}
    games_path = os.path.join(args.root, "games", "list.js")
    new_text, dropped = drop_played(open(games_path, encoding="utf-8").read(), played)
    for t in dropped:
        print("  played %s: %s (in Recently Played, removing it from list.js In the Queue)" % ("games", t))
    if dropped and not args.dry_run:
        with open(games_path, "w", encoding="utf-8") as f:
            f.write(new_text)

    work = []  # (page, marker, section name, item, delete path)
    for page in PAGES:
        got = get_json(api + "/lists?page=" + page)
        lists = got.get("lists", {})
        snapshot["lists"][page] = lists
        snapshot.setdefault("hidden", {})[page] = got.get("hidden", {})
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

    # list.js items removed on the site: delete them from list.js; once the live list.js no longer has them, clear them
    unhide = []  # (page, key, title) to clear from the live site
    for page in PAGES:
        hidden = snapshot["hidden"].get(page, {})
        if not hidden:
            continue
        path = os.path.join(args.root, page, "list.js")
        text = open(path, encoding="utf-8").read()
        live_text = request("%s/%s/list.js?nocache=%d" % (args.site.rstrip("/"), page, datetime.datetime.now().timestamp())).decode("utf-8")
        for key, titles in hidden.items():
            marker, live_marker = section_marker(text, key), section_marker(live_text, key)
            for title in titles:
                gone_live = not live_marker or same_title(title) not in {same_title(t) for t in section_titles(live_text, live_marker)}
                if gone_live:
                    unhide.append((page, key, title))
                    print("  unhide %s / %s: %s (deleted from the live list.js, clearing it)" % (page, key, title))
                    continue
                if marker:
                    text, removed = remove_titled(text, marker, title)
                    print("  remove %s / %s: %s (%s)" % (page, key, title, "deleted from list.js; push it" if removed else "already deleted here, not pushed yet"))
        if not args.dry_run:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
    if unhide and not args.dry_run:
        token = os.environ.get("NICKMADE_ADMIN_TOKEN") or getpass.getpass("Admin password (to clear removed ones from the live site): ")
        os.environ["NICKMADE_ADMIN_TOKEN"] = token
        for page, key, title in unhide:
            req = urllib.request.Request(api + "/hidden", method="DELETE", data=json.dumps({"page": page, "list": key, "title": title}).encode(),
                                         headers={"User-Agent": UA, "Content-Type": "application/json", "Authorization": "Bearer " + token})
            urllib.request.urlopen(req, timeout=60).read()

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
            if marker == 'live: "queue"':
                text = append_items(text, marker, lines)
            else:
                text = put_on_top(text, marker, lines)  # group is newest first (the Worker's order)
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
