#!/usr/bin/env python3
"""Find which 4K discs in the Library have Dolby Vision, HDR10+ and HDR10 (Ver 1.4).

    python3 tools/hdr.py ["My Movie Collection.txt"] [--retry]

The My Movies export has no HDR field, so this looks each 4K disc up on blu-ray.com, whose release pages list it
("HDR: Dolby Vision, HDR10"): by the disc's barcode from the export (the exact edition), else by title among 4K
releases of the same year. Results go to movies/library/hdr.json (disc id -> ["dv", "hdr10+", "hdr10"], [] = no HDR
listed); discs found before aren't asked again (--retry asks again for the ones not found). Then every disc in
discs.js gets its "hdr" field from that file (tools/discs.py does the same when it rewrites discs.js).
Blu-ray (1080p) discs have no HDR, so only 4K discs are looked up. blu-ray.com turns away quick runs ("Error42"),
so it waits a few seconds between requests: about 10 minutes for 90 discs.
Discs added on the site get theirs from the Worker (worker/src/library.js, the same lookup).
"""
import csv
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import discs as importer  # disc_id(), FORMATS, ROOT, OUT

HDR_FILE = os.path.join(importer.ROOT, "movies", "library", "hdr.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
WAIT = 4  # seconds between blu-ray.com requests


def fetch(url, data=None):
    for attempt in range(4):
        req = urllib.request.Request(url, data=data and urllib.parse.urlencode(data).encode(), headers={
            "User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "en-US,en", "Referer": "https://www.blu-ray.com/"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("latin-1")
        time.sleep(WAIT)
        if body.strip() != "Error42":
            return body
        time.sleep(20 * (attempt + 1))  # turned away: back off and try again
    raise RuntimeError("blu-ray.com keeps saying Error42")


def search(keyword):
    """blu-ray.com's quick search (4K section, US): [(title, year, url)]"""
    body = fetch("https://www.blu-ray.com/search/quicksearch.php",
                 {"section": "4kbluraymovies", "userid": "-1", "country": "US", "keyword": keyword})
    names = re.findall(r'id="match\d+">.*?&nbsp;(.*?)</li>', body)
    urls = re.findall(r"'(https://www\.blu-ray\.com/movies/[^']+)'", body)
    out = []
    for n, u in zip(names, urls):
        n = html.unescape(re.sub(r"<[^>]+>", "", n))
        m = re.search(r"\((\d{4})\)\s*$", n)
        out.append((n, int(m.group(1)) if m else None, u))
    return out


PARSE = [("dv", r"dolby vision"), ("hdr10+", r"hdr10\+"), ("hdr10", r"hdr10(?!\+)")]


def hdr_of(url):
    """The release page's "HDR: ..." line as ["dv", "hdr10+", "hdr10"] (only those present), [] when there's none"""
    page = fetch(url)
    i = page.find("HDR:")
    if i < 0:
        return []
    # the values can sit in their own tags ("HDR: <a>Dolby Vision</a>, HDR10"): the text up to the next spec
    line = re.sub(r"<[^>]+>", " ", page[i + 4:i + 400])
    line = re.split(r"Aspect ratio|Original aspect|Audio|\n", line, flags=re.I)[0].lower()
    return [k for k, rx in PARSE if re.search(rx, line)]


def norm(t):
    return re.sub(r"[^a-z0-9]+", " ", t.lower().replace("&", "and")).strip()


def valid_barcode(code):
    """UPC-A / EAN-13 / EAN-8 with a correct check digit (the export has some "000000000000")"""
    if not re.match(r"^(\d{8}|\d{12,13})$", code or "") or len(set(code)) == 1:
        return False
    digits = [int(c) for c in code]
    check = digits.pop()
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digits)))
    return (10 - total % 10) % 10 == check


def find(d, barcode):
    if valid_barcode(barcode):
        hits = search(barcode)
        if hits:
            return hits[0][2], "barcode"
    want = norm(d["title"])
    # the title alone, then with its year (a short title like "Dune" gets no quick-search results by itself)
    for keyword in [d["title"]] + ([d["title"] + " " + str(d["year"])] if d.get("year") else []):
        for name, year, url in search(keyword):
            # 4K releases only (the 4K section lists Blu-rays too), by the title in the page address ("Dune-4K-Blu-ray");
            # the names in the list are cut short and carry the edition, so the address is the cleaner match
            m = re.search(r"/movies/(.+)-4K-Blu-ray/\d+/", url)
            if m and norm(m.group(1).replace("-", " ")) == want and (not d.get("year") or not year or abs(year - d["year"]) <= 1):
                return url, "title"
    return None, None


def load_discs():
    s = open(importer.OUT, encoding="utf-8").read()
    return s, json.loads(s[s.index("["):s.rindex("]") + 1])


def apply(found):
    """Write each disc's hdr list into discs.js (keeping its header and one-disc-per-line layout)"""
    s, discs = load_discs()
    head = s[:s.index("window.DISCS")]
    for d in discs:
        d.pop("hdr", None)
        if found.get(d["id"]):
            d["hdr"] = found[d["id"]]
    with open(importer.OUT, "w", encoding="utf-8") as f:
        f.write(head + "window.DISCS = [\n" + ",\n".join("  " + json.dumps(d, ensure_ascii=False) for d in discs) + "\n];\n")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = args[0] if args else os.path.join(importer.ROOT, "My Movie Collection.txt")
    retry = "--retry" in sys.argv
    barcodes, set_barcodes = {}, {}
    for r in csv.DictReader(open(src, encoding="utf-8-sig", newline="")):
        fmt = importer.FORMATS.get(r["Disc Type"].strip())
        if fmt:
            barcodes[importer.disc_id(r["Title"].strip(), r["Production Year"].strip(), fmt)] = r["Barcode"].strip()
            set_barcodes[r["Title"].strip()] = r["Barcode"].strip()
    found = json.load(open(HDR_FILE)) if os.path.exists(HDR_FILE) else {}
    _, discs = load_discs()
    todo = [d for d in discs if d["format"] == "4k" and (d["id"] not in found or retry and found[d["id"]] is None)]
    print("%d 4K discs to look up" % len(todo))
    for i, d in enumerate(todo, 1):
        try:
            # a film that came in a box set has "000000000000" in the export: the set's barcode (its page lists the HDR)
            code = barcodes.get(d["id"], "")
            if not valid_barcode(code) and d.get("boxSet"):
                code = set_barcodes.get(d["boxSet"], "")
            url, how = find(d, code)
            found[d["id"]] = hdr_of(url) if url else None
            print("  %d/%d %s: %s%s" % (i, len(todo), d["title"], ", ".join(found[d["id"]] or []) or ("no HDR listed" if url else "not found"),
                                        " (by %s)" % how if url else ""))
        except Exception as e:
            print("  %d/%d %s: failed (%s), will retry next run" % (i, len(todo), d["title"], e))
            continue
        with open(HDR_FILE, "w") as f:  # saved as it goes, so a stopped run keeps what it found
            json.dump(found, f, indent=0, sort_keys=True)
    apply(found)
    n = sum(1 for d in discs if found.get(d["id"]))
    dv = sum(1 for d in discs if "dv" in (found.get(d["id"]) or []))
    print("Done: %d discs with HDR (%d Dolby Vision); %d not found on blu-ray.com." %
          (n, dv, sum(1 for d in discs if d["format"] == "4k" and found.get(d["id"], 0) is None)))


if __name__ == "__main__":
    main()
