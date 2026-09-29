#!/usr/bin/env python3
"""Add Trackman rounds to the Golf page from the Trackman activity page.

    1. On Trackman's website, open your activities, right-click the list of round cards,
       Inspect, and copy the element that holds them (Copy > Copy outerHTML).
    2. python3 tools/import_trackman.py            (reads the clipboard)
       python3 tools/import_trackman.py file.html  (or a saved file)

New rounds are added to extras/golf/trackman.js (rounds already there are skipped, matched by
Trackman's activity id), and each course's photo is saved to extras/golf/courses/.
Then preview, commit, and push.
"""
import html
import json
import os
import re
import subprocess
import sys
import urllib.request
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "extras", "golf", "trackman.js")
PHOTOS = os.path.join(ROOT, "extras", "golf", "courses")
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


class Cards(HTMLParser):
    """Collects, per activity card, its id, visible text in order, and image"""

    def __init__(self):
        super().__init__()
        self.cards = []
        self.depth = 0  # element depth inside the current card
        self.skip = 0  # inside a <button> or <svg> (the delete button)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if (a.get("data-testid") or "").startswith("activity-card-"):
            self.cards.append({"id": a["data-testid"][len("activity-card-"):], "kind": a.get("data-activity-kind"), "text": [], "img": None})
            self.depth = 1
            return
        if not self.depth:
            return
        if tag not in ("img", "source", "br", "input", "meta", "link", "hr"):  # void tags never close
            self.depth += 1
        if tag in ("button", "svg"):
            self.skip += 1
        if tag == "img" and a.get("src"):
            self.cards[-1]["img"] = a["src"]

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag in ("button", "svg") and self.skip:
            self.skip -= 1
        self.depth -= 1

    def handle_data(self, data):
        if self.depth and not self.skip and data.strip():
            self.cards[-1]["text"].append(html.unescape(data.strip()))


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse(source):
    p = Cards()
    p.feed(source)
    rounds = []
    for c in p.cards:
        t = c["text"]
        # Month, Day, Year, Score, Format ("Stroke" / "Stroke Net"), To par, "Course play", Course name
        try:
            month, day, year, score, fmt, to_par = t[0], t[1], t[2], t[3], t[4], t[5]
            course = t[-1].strip()
            date = "%04d-%02d-%02d" % (int(year), MONTHS[month[:3]], int(day))
            to_par = int(to_par.replace("−", "-").replace("E", "0"))
            score = int(score)
        except (IndexError, KeyError, ValueError):
            print("  ! skipped a card I couldn't read:", " | ".join(t)[:120])
            continue
        r = {"id": c["id"], "date": date, "course": course, "score": score, "toPar": to_par}
        if "net" in fmt.lower():
            r["net"] = True
        else:
            r["par"] = score - to_par
        r["_img"] = c["img"]
        rounds.append(r)
    return rounds


def save_photo(r):
    url = r.pop("_img", None)
    if not url:
        return
    os.makedirs(PHOTOS, exist_ok=True)
    name = slug(r["course"]) + ".webp"
    path = os.path.join(PHOTOS, name)
    if not os.path.exists(path):
        # Trackman's image service resizes on request; ask for a card-sized landscape crop
        url = re.sub(r"\?tr=[^\"]*$", "", url) + "?tr=w-640%2Ch-360%2Cq-75"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (nickmade.net)"})
        with urllib.request.urlopen(req, timeout=30) as res, open(path, "wb") as f:
            f.write(res.read())
    r["image"] = "courses/" + name


def load_existing():
    try:
        text = open(OUT, encoding="utf-8").read()
        return json.loads(text[text.index("["):text.rindex("]") + 1])
    except (FileNotFoundError, ValueError):
        return []


def main():
    source = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else subprocess.run(["pbpaste"], capture_output=True, text=True).stdout
    found = parse(source)
    if not found:
        sys.exit("No Trackman round cards found. Copy the outerHTML of the list of rounds and try again.")
    existing = load_existing()
    have = {r["id"] for r in existing}
    new = [r for r in found if r["id"] not in have]
    for r in new:
        save_photo(r)
        print("  + %s  %s  %d (%s%s)" % (r["date"], r["course"], r["score"], "%+d" % r["toPar"] if r["toPar"] else "E", " net" if r.get("net") else ""))
    for r in found:
        r.pop("_img", None)
    rounds = sorted(existing + new, key=lambda r: r["date"], reverse=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Trackman rounds, written by tools/import_trackman.py (edit freely; the importer only adds new ids).\n")
        f.write("// toPar is Trackman's figure; for net rounds (net: true) it's net to par, so par isn't known.\n")
        f.write("window.GOLF_TRACKMAN = " + json.dumps(rounds, indent=2, ensure_ascii=False) + ";\n")
    print("Added %d new round%s (%d already there). %d Trackman rounds in total." % (len(new), "" if len(new) == 1 else "s", len(found) - len(new), len(rounds)))


if __name__ == "__main__":
    main()
