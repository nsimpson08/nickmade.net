#!/usr/bin/env python3
"""Import Nick's disc collection (an export from the My Movies app) into the Library page.

ONE TIME (2026-10-03): Nick adds new discs on the site now (owner mode on /movies/library/, stored in the Worker; see
worker/src/library.js), not by re-exporting. Re-running this only rewrites discs.js from the export; site-added discs
and removals are kept separately in the Worker and still apply (removals by disc id).

    python3 tools/discs.py ["My Movie Collection.txt"] [--no-covers]

Reads the export (a CSV, despite the .txt name; it's git-ignored, since it's the raw personal export with barcodes)
and writes movies/library/discs.js (window.DISCS), one entry per disc, sorted by sort title. Covers are saved to
movies/library/covers/<slug>.webp, 400px wide: the IMDb poster for films and series (by the export's IMDb id), and for
box sets (no IMDb id) the first portrait store photo of that barcode from UPCitemdb's free lookup (100 a day). Covers already
there are kept, so re-running after a new export only downloads the new ones. A box set with no cover whose films are
in BOX_SETS shows a grid of up to 4 of their posters (covers/parts/<film>.webp); any other disc with no cover gets a
title card on the page. Delete a cover file to fetch it again, or save your own as covers/<slug>.webp (it is kept).

Left out: the "Digital" group (not a disc) and the "Bonus Disc" entries of box sets.
Needs cwebp (brew install webp).
"""
import colorsys
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "movies", "library", "discs.js")
COVERS = os.path.join(ROOT, "movies", "library", "covers")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
FORMATS = {"4K Ultra HD": "4k", "Blu-ray": "bluray", "DVD": "dvd"}
GENRES = {"Science-Fiction": "Sci-Fi", "Suspense/Thriller": "Thriller", "Film-Noir": "Film Noir"}
ABOUT_MAX = 700
# What's in each box set (the export doesn't say); a shelved set lists these on the back of its case. A box set whose films are ALL on the shelves as their own entries is
# left out, so they aren't shelved twice (Nick, 2026-10-03); those films say "From the <set>" on the back of the case.
# Sets with films missing stay as one case. Add a set here when a new one turns up.
BOX_SETS = {
    "The Daniel Craig Collection": ["Casino Royale", "Quantum of Solace", "Skyfall", "Spectre"],
    "Jurassic World: 5-Movie Collection": ["Jurassic Park", "The Lost World: Jurassic Park", "Jurassic Park III",
                                           "Jurassic World", "Jurassic World: Fallen Kingdom"],
    "Harry Potter 8-Film Collection": ["Harry Potter and the Sorcerer's Stone", "Harry Potter and the Chamber of Secrets",
                                       "Harry Potter and the Prisoner of Azkaban", "Harry Potter and the Goblet of Fire",
                                       "Harry Potter and the Order of the Phoenix", "Harry Potter and the Half-Blood Prince",
                                       "Harry Potter and the Deathly Hallows - Part 1", "Harry Potter and the Deathly Hallows - Part 2"],
    "Tarantino XX": ["Reservoir Dogs", "True Romance", "Pulp Fiction", "Jackie Brown", "Kill Bill: Vol. 1",
                     "Kill Bill: Vol. 2", "Death Proof", "Inglourious Basterds"],
    "The Hunger Games: Complete 4-Film Collection": ["The Hunger Games", "The Hunger Games: Catching Fire",
                                                     "The Hunger Games: Mockingjay - Part 1", "The Hunger Games: Mockingjay - Part 2"],
    "Battle Royale: The Complete Collection": ["Battle Royale", "Battle Royale II"],
    "The Purge: 4-Movie Collection": ["The Purge", "The Purge: Anarchy", "The Purge: Election Year", "The First Purge"],
    "The Matrix Trilogy": ["The Matrix", "The Matrix Reloaded", "The Matrix Revolutions"],
    "Dune: 2-Film Collection": ["Dune", "Dune: Part Two"],
    "The Before Trilogy": ["Before Sunrise", "Before Sunset", "Before Midnight"],
    "Dirty Harry Collection": ["Dirty Harry", "Magnum Force", "The Enforcer", "Sudden Impact"],  # "4 Film Favorites"
    "Reel Heroes": ["Hellboy II: The Golden Army", "Kick-Ass", "Scott Pilgrim vs. the World", "Wanted"],
    # read off their covers (2026-10-03)
    "Universal 10-Film Sci-Fi Collection": ["12 Monkeys", "Hellboy II: The Golden Army", "Lucy", "Oblivion",
                                            "Pacific Rim Uprising", "Pitch Black", "Repo Men", "Serenity", "Seventh Son",
                                            "Waterworld"],
    "Illumination Presents: 10-Movie Collection": ["Despicable Me", "Despicable Me 2", "Despicable Me 3", "Minions",
                                                   "The Secret Life of Pets", "The Secret Life of Pets 2", "Sing", "Hop",
                                                   "Dr. Seuss' The Lorax", "Dr. Seuss' The Grinch"],
    "Focus Features: 10 - Movie Spotlight Collection": ["Lost in Translation", "Eternal Sunshine of the Spotless Mind",
                                                        "Pride & Prejudice", "Brokeback Mountain", "Atonement",
                                                        "Burn After Reading", "Moonrise Kingdom", "The Theory of Everything",
                                                        "On the Basis of Sex", "Harriet"],
}
# Sets shelved as their films instead (Nick, 2026-10-03): the set is left out and each IMDb id becomes its own disc in
# the set's format, with the set's added date. Facts come from IMDb and the blurb from Wikipedia, as for discs added on
# the site (worker/src/library.js).
SPLIT_SETS = {
    "Wyatt Earp / The Assassination of Jesse James": ["tt0111756", "tt0443680"],
    # (Nick, 1.4) each film on the shelf by itself, noted as from the set
    "The Hunger Games: Complete 4-Film Collection": ["tt1392170", "tt1951264", "tt1951265", "tt1951266"],
}
SPLIT_NOTED = {"The Hunger Games: Complete 4-Film Collection"}  # split sets whose films say "From the ..." on the case
# ...and shelve under one name, so they sit together in release order (ties sort by year)
SPLIT_SORT = {"The Hunger Games: Complete 4-Film Collection": "Hunger Games, The"}
# Films shelved together under another name, in release order: every film in that box set sorts as this (Nick,
# 2026-10-03: the Daniel Craig Bond films go under "#" as 007)
SHELVE_AS = {"The Daniel Craig Collection": "007"}
# The app files a box set's films under the set's name ("Tarantino XX 05: Kill Bill: Vol. 01"), which keeps a series
# together (Harry Potter, Jurassic Park). These sets aren't a series, so their films go back under their own titles.
UNGROUP_SETS = {"Tarantino XX"}


def slug(s):
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:60]


def disc_id(title, year, fmt):
    """title-year-format; only the title part is shortened, so long titles keep their year and format (the Worker's
    discId() makes the same ids)"""
    return "-".join(p for p in (slug(title)[:60].strip("-"), str(year or ""), fmt) if p)


def minutes(t):
    m = re.match(r"^(\d+):(\d\d)$", t.strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def clean_text(s):
    """The app exports quote marks and line breaks as ';'. "; ;" is a paragraph break; a ';' after a space (or at the
    start) opens a quote and the next one closes it; any other ';' is a real semicolon."""
    s = re.sub(r"\s+", " ", s or "").strip()
    paras = []
    for p in re.split(r";\s*;", s):
        out, open_q = [], False
        for i, ch in enumerate(p):
            if ch != ";":
                out.append(ch)
                continue
            if open_q:
                out.append("”")
                open_q = False
            elif i == 0 or p[i - 1] == " ":
                out.append("“")
                open_q = True
            elif re.search(r"\b[A-Z]{2,}$", p[:i]):
                out.append("\n")  # an ALL-CAPS heading on its own line ("WITH ANSWERS COME QUESTIONS")
            else:
                out.append(";")
        t = "".join(out)
        if open_q:
            t += "”"
        t = re.sub(r"“\s+", "“", t)
        t = re.sub(r"\s+”", "”", t)
        t = re.sub(r"\s+([,.!?])", r"\1", t)
        for t in t.split("\n"):
            t = re.sub(r"\s{2,}", " ", t).strip(" ;")
            if t and t != "-":
                paras.append(t)
    return paras


# ---------- Extra features ("On this disc" on the back of the case) ----------
FEATURE_HEAD = re.compile(r"^(disc \w+|disc \w+.*features?|bonus features?|special features?|bonus (content|materials?)|extras?|features?|"
                          r"(4k|uhd|blu-?ray|dvd|digital)[^a-z]*(ultra hd|disc|blu-?ray|features?|bonus features?)?\s*)$", re.I)
FEATURE_FLUFF = re.compile(r"^(and |plus )?(much |many )?more!?$|^\W*$", re.I)
BULLET = re.compile(r"(?:^|;\s*)\s*[•・▪◦]\s*|(?:^|;\s*)-(?=\S)")


def feature_item(text):
    """One feature: quotes restored (the app writes them as ';'), any '-- description' or '(HD)' dropped; None if it's a
    heading, a blurb, or filler."""
    t = " ".join(clean_text(text)[:1]).strip(" .:;")
    t = re.sub(r"^[\s•・▪◦*†‡\-–—,;:.]+", "", t)  # leftover bullets: "- Item" (dash and space), "• Item", stray ", "
    t = re.split(r"\s+--\s+", t)[0]
    t = re.sub(r"\s*\((HD|SD)\)$", "", t).strip(" .:")
    if not t or FEATURE_FLUFF.match(t) or FEATURE_HEAD.match(t) or t.endswith(":"):
        return None
    if len(t) > 140 or len(t) > 90 and re.search(r"[a-z]{3}[.!?] [A-Z]", t):  # a blurb (initials like "A. L." aren't)
        return None
    return t


def features(raw):
    """The disc's extra features from the export's 'Extra Features' text, as a list. Three styles turn up: bullets
    ('; • Item'), dash bullets ('-Item'), or plain items split by ';' with '; ;' between groups; and ';' also stands for
    quote marks and line breaks inside an item."""
    raw = re.sub(r"\s+", " ", raw or "").strip()
    if not raw or raw == "-":
        return []
    out = []
    if BULLET.search(raw) and (raw.count("•") + raw.count("・") >= 2 or re.search(r"(^|; )-\S", raw)):
        for chunk in BULLET.split(raw)[1:]:  # what's before the first bullet is a heading ("UHD / Blu Ray:")
            item = feature_item(re.split(r";\s*;", chunk)[0])
            if item:
                out.append(item)
    else:
        for group in re.split(r";\s*;", raw):
            parts = [x.strip() for x in group.split(";") if x.strip()]
            # "Name; Featurette (6:05)": a name and its kind/length on two lines, one feature
            if len(parts) == 2 and re.match(r"^(featurette|documentary|short|\(?\d+:\d\d)", parts[1], re.I):
                parts = [parts[0] + " · " + parts[1]]
            for x in parts:
                item = feature_item(x)
                if item:
                    out.append(item)
    seen = set()
    return [x for x in out if not (x.lower() in seen or seen.add(x.lower()))]


def same(a, b):
    return re.sub(r"[^a-z0-9]+", "", a.lower()) == re.sub(r"[^a-z0-9]+", "", b.lower())


# Retail copy about the disc, not the film ("...roars onto Blu-ray!", "this ultimate Combo Pack", "packed with bonus
# features"): sentences matching this are dropped from the synopsis (Nick, 1.3: Alice in Wonderland 3D's was all promo)
PROMO = re.compile(r"blu-?ray|combo pack|\bdvd\b|digital (copy|code|hd)|4k ultra hd|ultra hd|\bhdr\b|high[- ]def|hi-def|"
                   r"bonus (features?|content|material)|special features|extras?\b|collector'?s (dream|edition)|\b\d-disc\b|"
                   r"for the first time (ever )?(on|in)\b|\bremastered\b|\bnew edition\b|\bin 3D\b|blu-ray 3D|\bown it\b|"
                   r"must-own|\brestoration\b|home theater|\bthis (extraordinary |stunning |new )?format\b|trivia track|"
                   r"\b(four|three|two|all-)?new games\b|deleted scenes|commentar(y|ies)|featurettes?|\bbonus\b|"
                   r"picture-(within|in)-|cine-explore|extended (cut|edition)|\bwidescreen\b|\bthis (\d-disc |special |"
                   r"collector'?s |anniversary )?(edition|set|release)\b", re.I)
ABOUT_MIN = 200  # a synopsis that lost promo and is now shorter than this: use Wikipedia's (main(), "Empty blurbs")
ABOUT_STUB = 80  # one shorter than this is a broken fragment ("Leonardo DiCaprio gives an OSCAR®-WINNING"): Wikipedia's too


def no_promo(text):
    keep = []
    for para in text.split("\n\n"):
        sents = re.split(r"(?<=[.!?…])\s+(?=[“\"‘'A-Z0-9])", para)
        sents = [x for x in sents if not PROMO.search(x)]
        if sents:
            keep.append(" ".join(sents))
    return "\n\n".join(keep)


def about(desc, tagline=""):
    """(blurb, cut) for the back of the case: whole paragraphs up to ABOUT_MAX characters (at least the first, cut at a
    sentence), without retail promo sentences (cut = some were removed). A paragraph that's just the tagline again
    ("THE FUTURE IS HISTORY") is left out; the page shows the tagline."""
    paras = [p for p in clean_text(desc) if not (tagline and same(p, tagline))]
    cleaned = [p for p in (no_promo(p) for p in paras) if p]
    cut = cleaned != paras
    paras = cleaned
    out, n = [], 0
    for p in paras:
        if out and n + len(p) > ABOUT_MAX:
            break
        out.append(p)
        n += len(p)
    if out and len(out[0]) > ABOUT_MAX:
        cut = out[0][:ABOUT_MAX]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        out[0] = cut[: end + 1] if end > 200 else cut.rsplit(" ", 1)[0] + "…"
    return "\n\n".join(out), cut


WIKI_UA = "nickmade.net disc library import (https://nickmade.net)"  # Wikimedia rate-limits browser-style agents


def get(url, binary=False, ua=UA):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def imdb_image(imdb_id):
    d = json.loads(get("https://v3.sg.media-imdb.com/suggestion/x/%s.json" % imdb_id)).get("d", [])
    for x in d:
        if x.get("id") == imdb_id and x.get("i", {}).get("imageUrl"):
            # Amazon resizes on the fly: 400px wide
            return re.sub(r"\._V1_.*\.jpg$", "._V1_UX400_.jpg", x["i"]["imageUrl"])
    return None


def film_image(title):
    """A film's IMDb poster (400px) by its title: the first feature film IMDb suggests with exactly that title."""
    q = re.sub(r"[^a-z0-9 ]", "", title.lower()).strip()
    d = json.loads(get("https://v3.sg.media-imdb.com/suggestion/x/%s.json" % urllib.parse.quote(q))).get("d", [])
    for x in d:
        if x.get("qid") == "movie" and re.sub(r"[^a-z0-9]", "", x.get("l", "").lower()) == re.sub(r"[^a-z0-9]", "", title.lower()) \
                and x.get("i", {}).get("imageUrl"):
            return re.sub(r"\._V1_.*\.jpg$", "._V1_UX400_.jpg", x["i"]["imageUrl"])
    return None


def imdb_facts(imdb_id):
    """IMDb's facts for a title, from its GraphQL API (the same query as worker/src/library.js)."""
    query = ('query { title(id: "%s") { titleText { text } releaseYear { year } runtime { seconds } certificate { rating } '
             'genres { genres { text } } principalCredits { category { id } credits { name { nameText { text } } } } '
             'companyCredits(first: 1, filter: { categories: ["production"] }) { edges { node { company { companyText { text } } } } } } }') % imdb_id
    req = urllib.request.Request("https://caching.graphql.imdb.com/", data=json.dumps({"query": query}).encode(),
                                 headers={"Content-Type": "application/json", "x-imdb-client-name": "imdb-web-next", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        t = json.loads(r.read())["data"]["title"]
    # principal credits are the top-billed people, in billing order (plain credits aren't)
    principal = {c["category"]["id"]: [x["name"]["nameText"]["text"] for x in c["credits"]] for c in (t.get("principalCredits") or [])}
    company = ((t.get("companyCredits") or {}).get("edges") or [])
    return {
        "title": t["titleText"]["text"],
        "year": (t.get("releaseYear") or {}).get("year"),
        "minutes": round(t["runtime"]["seconds"] / 60) if t.get("runtime") else None,
        "rated": (t.get("certificate") or {}).get("rating", ""),
        "genres": [g["text"] for g in ((t.get("genres") or {}).get("genres") or [])],
        "director": ", ".join(principal.get("director", [])[:2]),
        "starring": principal.get("cast", [])[:4],
        "studio": company[0]["node"]["company"]["companyText"]["text"] if company else "",
    }


def wikipedia(imdb_id):
    """(summary, url) of the film's English Wikipedia article, found by its IMDb id on Wikidata; trimmed like the Worker's."""
    time.sleep(1)  # be gentle: 3 requests per film
    found = json.loads(get("https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srsearch=" +
                           urllib.parse.quote("haswbstatement:P345=" + imdb_id), ua=WIKI_UA))
    hits = found.get("query", {}).get("search", [])
    if not hits:
        return "", ""
    qid = hits[0]["title"]
    ent = json.loads(get("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=" + qid, ua=WIKI_UA))
    link = ent["entities"][qid].get("sitelinks", {}).get("enwiki")
    if not link:
        return "", ""
    summary = json.loads(get("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(link["title"].replace(" ", "_")), ua=WIKI_UA))
    text = summary.get("extract", "")
    if len(text) > 600:
        cut = text[:600]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        text = cut[: end + 1] if end > 150 else cut.rsplit(" ", 1)[0] + "\u2026"
    return text, summary.get("content_urls", {}).get("desktop", {}).get("page", "")


def sort_title(t):
    m = re.match(r"^(the|a|an)\s+(.+)$", t, re.I)
    return m.group(2) + ", " + m.group(1) if m else t


def upc_images(barcode):
    time.sleep(2)  # the free lookup also limits bursts
    d = json.loads(get("https://api.upcitemdb.com/prod/trial/lookup?upc=" + urllib.parse.quote(barcode)))
    imgs = [img for item in d.get("items", []) for img in (item.get("images") or [])]
    # Best Buy's are flat front covers; others are often angled box shots
    return sorted(imgs, key=lambda u: 0 if "bbystatic" in u else 1)


def size_of(path):
    """(width, height) via macOS sips, or None if it can't tell."""
    try:
        out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path], capture_output=True, text=True).stdout
        w, h = re.search(r"pixelWidth: (\d+)", out), re.search(r"pixelHeight: (\d+)", out)
        return (int(w.group(1)), int(h.group(1))) if w and h else None
    except OSError:
        return None


def save_cover(urls, path, check_shape=False):
    """Save the first of these images that works. Store photos (check_shape) must be portrait like a case: their
    "Image unavailable" placeholders and small covers floating on white are square."""
    for url in urls:
        with tempfile.NamedTemporaryFile(suffix=".img", delete=False) as f:
            try:
                f.write(get(url, binary=True))
            except Exception:
                continue
            tmp = f.name
        try:
            size = size_of(tmp) if check_shape else None
            if check_shape and (not size or size[1] < size[0] * 1.15):
                continue
            subprocess.run(["cwebp", "-quiet", "-q", "74", "-m", "6", "-resize", "400", "0", tmp, "-o", path], check=True)
            if check_shape and os.path.getsize(path) < 4000:  # nearly all white: an "Image Coming Soon" card
                os.remove(path)
                continue
            return True
        finally:
            os.remove(tmp)
    return False


# ---------- Spines: the film's real title logo (TMDB) on a colour taken from its cover ----------
# Needs a TMDB API key (free, themoviedb.org > Settings > API): TMDB_API_KEY in the environment or worker/.dev.vars.
# Without one, spines keep text titles. TMDB's terms want a credit on the page (movies/library/index.html has it).
LOGOS = os.path.join(ROOT, "movies", "library", "logos")
LOGO_INDEX = os.path.join(LOGOS, "index.json")  # imdbId -> "file.webp", or "" when TMDB has no logo (not asked again)


def tmdb_key():
    if os.environ.get("TMDB_API_KEY"):
        return os.environ["TMDB_API_KEY"]
    try:
        for line in open(os.path.join(ROOT, "worker", ".dev.vars")):
            if line.startswith("TMDB_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return None


def tmdb(path, key):
    sep = "&" if "?" in path else "?"
    return json.loads(get("https://api.themoviedb.org/3" + path + sep + "api_key=" + key, ua=WIKI_UA))


def tmdb_logo(imdb_id, key):
    """The top-voted English (else language-neutral) PNG logo for this film or series: its image.tmdb.org path, or None."""
    found = tmdb("/find/%s?external_source=imdb_id" % imdb_id, key)
    for kind, results in (("movie", found.get("movie_results")), ("tv", found.get("tv_results"))):
        if results:
            logos = tmdb("/%s/%d/images?include_image_language=en,null" % (kind, results[0]["id"]), key).get("logos", [])
            logos = [l for l in logos if l["file_path"].endswith(".png")]
            for lang in ("en", None):
                for l in logos:
                    if l.get("iso_639_1") == lang:
                        return l["file_path"]
    return None


def lum(r, g, b):
    """Relative luminance (WCAG) of an 8-bit sRGB colour."""
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def logo_luminance(path):
    """Average luminance of a logo's solid pixels (ffmpeg decodes any PNG/WebP to a small RGBA grid), or None."""
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-vf", "scale=120:40:flags=area", "-f", "rawvideo",
                          "-pix_fmt", "rgba", "-"], capture_output=True).stdout
    total = n = 0
    for o in range(0, len(out) - 3, 4):
        if out[o + 3] >= 160:
            total += lum(out[o], out[o + 1], out[o + 2])
            n += 1
    return total / n if n else None


def image_size(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    try:
        w, h = out.split(",")[:2]
        return int(w), int(h)
    except ValueError:
        return None


def edge_colour(path):
    """The average colour of a cover's left edge (where a spine meets the front), via ffmpeg."""
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-vf", "crop=iw*0.12:ih:0:0,scale=1:1:flags=area",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    return tuple(out[:3]) if len(out) >= 3 else None


def spine_colour(rgb, logo_y):
    """(hex colour, light?) for a spine: the cover's edge hue, made dark enough for a light logo or text, or light when
    the logo is too dark to read on a dark case (contrast under 1.8:1)."""
    h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in (rgb or (40, 40, 48))])
    def make(lo, hi):
        r, g, b = colorsys.hls_to_rgb(h, min(max(l, lo), hi), min(s, 0.75))
        return round(r * 255), round(g * 255), round(b * 255)
    dark = make(0.12, 0.30)
    contrast = lambda a, b: (max(a, b) + 0.05) / (min(a, b) + 0.05)
    if logo_y is not None and contrast(logo_y, lum(*dark)) < 1.8:
        return "#%02x%02x%02x" % make(0.74, 0.86), True
    return "#%02x%02x%02x" % dark, False


def save_logo(url, path):
    """Download a logo PNG and save it as WebP that fits 400x96 (spines show it ~22px tall). Returns its luminance."""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(get(url, binary=True))
        tmp = f.name
    try:
        y = logo_luminance(tmp)
        w, h = image_size(tmp) or (500, 150)
        scale = min(400 / w, 96 / h, 1)
        subprocess.run(["cwebp", "-quiet", "-q", "86", "-alpha_q", "100", "-resize", str(round(w * scale)), str(round(h * scale)),
                        tmp, "-o", path], check=True)
    finally:
        os.remove(tmp)
    return y


def spines(discs, limit):
    """Logos and colours for the spine view. limit: at most this many new TMDB lookups this run (None = all)."""
    key = tmdb_key()
    os.makedirs(LOGOS, exist_ok=True)
    index = json.load(open(LOGO_INDEX)) if os.path.exists(LOGO_INDEX) else {}
    looked = got = 0
    for d in discs:
        imdb, logo_y = d.get("imdbId"), None
        if imdb and d["kind"] != "box" and key and imdb not in index and (limit is None or looked < limit):
            looked += 1
            try:
                fp = tmdb_logo(imdb, key)
                name = ""
                if fp:
                    name = slug(d["title"] + "-" + str(d["year"] or "")) + ".webp"
                    index["_y:" + name] = save_logo("https://image.tmdb.org/t/p/w500" + fp, os.path.join(LOGOS, name))
                    got += 1
                index[imdb] = name
                time.sleep(0.25)
            except Exception as e:
                print("  no logo for %s: %s" % (d["title"], e))
        name = index.get(imdb) if imdb else ""
        if name and os.path.exists(os.path.join(LOGOS, name)):
            d["logo"] = "logos/" + name
            if index.get("_y:" + name) is None:  # measured from the saved copy if the download's wasn't
                index["_y:" + name] = logo_luminance(os.path.join(LOGOS, name))
            logo_y = index.get("_y:" + name)
        cover = os.path.join(ROOT, "movies", "library", d["cover"]) if d.get("cover") else None
        rgb = edge_colour(cover) if cover and os.path.exists(cover) else None
        if rgb:
            d["spine"], d["spineLight"] = spine_colour(rgb, logo_y)
    with open(LOGO_INDEX, "w") as f:
        json.dump(index, f, indent=1, sort_keys=True)
    if not key:
        print("Spines: no TMDB_API_KEY, so no logos (cover colours only).")
    else:
        print("Spines: %d looked up on TMDB, %d logos saved; %d discs have a logo." % (looked, got, sum(1 for d in discs if d.get("logo"))))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    covers = "--no-covers" not in sys.argv
    src = args[0] if args else os.path.join(ROOT, "My Movie Collection.txt")
    if covers and not shutil.which("cwebp"):
        sys.exit("cwebp isn't installed: brew install webp")
    rows = list(csv.DictReader(open(src, encoding="utf-8-sig", newline="")))

    discs, ids = [], set()
    for r in rows:
        title = r["Title"].strip()
        if r["Group"].strip().lower() == "digital" or re.match(r"^Bonus Disc\b", title, re.I):
            continue
        fmt = FORMATS.get(r["Disc Type"].strip())
        if not fmt:
            print("  skipped (no disc type):", title)
            continue
        imdb = r["IMDB Id"].strip()
        imdb = imdb if re.match(r"^tt\d+$", imdb) and imdb != "tt0000000" else ""
        year = r["Production Year"].strip()
        edition = r["Edition"].strip()
        d = {
            "id": disc_id(title, year, fmt),
            "title": title,
            "sort": r["Sort Title"].strip() or title,
            "year": int(year) if year.isdigit() else None,
            "format": fmt,
            "edition": edition,
            "discs": int(r["Discs"]) if r["Discs"].strip().isdigit() else None,
            "kind": "tv" if r["Media Type"].startswith("TV") else "box" if not imdb else "doc" if r["Media Type"] == "Documentary" else "movie",
            "minutes": minutes(r["Running Time"]),
            "rated": r["Par. Rating"].strip(),
            "genres": [GENRES.get(g.strip(), g.strip()) for g in r["Genres"].split(",") if g.strip()],
            "director": r["Director"].strip(),
            "starring": [a.strip() for a in r["Actors"].split(",") if a.strip()][:4],
            "tagline": " ".join(clean_text(r["Tagline"])),
            "about": "",
            "studio": r["Studios"].split(",")[0].strip(),
            "features": features(r["Extra Features"]),
            "steelbook": r["Cover Type"].strip() == "SteelBook",
            "criterion": "criterion" in edition.lower(),
            "threeD": r["3D"].strip() == "yes",
            "added": r["Added Date"].strip(),
            "imdbId": imdb,
        }
        while d["id"] in ids:
            d["id"] += "-2"
        ids.add(d["id"])
        d["about"], d["_promo"] = about(r["Description"], d["tagline"])
        d["_barcode"] = r["Barcode"].strip()
        discs.append(d)

    # Sets shelved as their own films
    for name, ids_ in SPLIT_SETS.items():
        sets = [d for d in discs if d["title"] == name]
        if not sets:
            continue
        box = sets[0]
        discs = [d for d in discs if d["title"] != name]
        for tt in ids_:
            f = imdb_facts(tt)
            about_text, about_url = wikipedia(tt)
            d = {"id": disc_id(f["title"], f["year"], box["format"]), "title": f["title"],
                 "sort": sort_title(f["title"]), "year": f["year"], "format": box["format"], "edition": "", "discs": None,
                 "kind": "movie", "minutes": f["minutes"], "rated": f["rated"], "genres": f["genres"],
                 "director": f["director"], "starring": f["starring"], "tagline": "", "about": about_text,
                 "aboutUrl": about_url, "studio": f["studio"], "steelbook": False, "criterion": False, "threeD": False,
                 "added": box["added"], "imdbId": tt, "_barcode": ""}
            if name in SPLIT_NOTED:
                d["boxSet"] = name
            if name in SPLIT_SORT:
                d["sort"] = SPLIT_SORT[name]
            discs.append(d)
            print("  split %s: %s (%s)" % (name, f["title"], f["year"]))

    # Box sets whose films are all here on their own: leave the set out, and note it on its films
    def key(t):
        return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()
    by_title = {}
    for d in discs:
        by_title.setdefault(key(d["title"]), []).append(d)
    for name, films in BOX_SETS.items():
        if all(key(f) in by_title for f in films) and key(name) in by_title:
            fmt = by_title[key(name)][0]["format"]
            discs = [d for d in discs if key(d["title"]) != key(name)]
            for f in films:
                copies = by_title[key(f)]
                # owning a film twice: only the copy in the set's format came in the set (Inglourious Basterds 4K is separate)
                for d in [c for c in copies if c["format"] == fmt] or copies:
                    d["boxSet"] = name
                    if name in SHELVE_AS:
                        d["sort"] = SHELVE_AS[name]  # ties sort by year, so release order
                    elif name in UNGROUP_SETS:
                        d["sort"] = sort_title(d["title"])
            print("  left out %s: all %d films are on the shelves" % (name, len(films)))
    # the sets still shelved list their films on the back of the case ("In this set")
    for d in discs:
        if d["title"] in BOX_SETS:
            d["films"] = BOX_SETS[d["title"]]

    # A film whose export description is empty (Lolita, Pulp Fiction...) gets its Wikipedia summary instead, credited on
    # the page like a disc added on the site. (Box sets list their films instead.)
    # The same synopsis on different films is the box set's blurb copied onto each (all eight Harry Potters had the
    # first film's): those films get their own Wikipedia summary too
    films_by_about = {}
    for d in discs:
        if d["about"] and d["imdbId"]:
            films_by_about.setdefault(d["about"], set()).add(d["imdbId"])
    for d in discs:
        shared = d["about"] and len(films_by_about.get(d["about"], ())) > 1
        short = shared or len(d["about"]) < ABOUT_STUB or d.get("_promo") and len(d["about"]) < ABOUT_MIN
        if short and d["imdbId"] and d["kind"] != "box":
            try:
                text, url = wikipedia(d["imdbId"])
                if text:
                    d["about"], d["aboutUrl"] = text, url
                    print("  blurb from Wikipedia:", d["title"])
            except Exception as e:
                print("  no blurb for %s: %s" % (d["title"], e))

    # Covers: downloaded unless --no-covers; ones already saved are always used
    os.makedirs(COVERS, exist_ok=True)
    got = missing = 0
    skip = set()  # tried this run and found nothing (a film in two formats shares one cover)
    for d in discs:
        # films share a cover across formats; box sets are by their own title
        name = slug(d["title"] + "-" + str(d["year"] or "")) + ".webp"
        path = os.path.join(COVERS, name)
        if covers and not os.path.exists(path) and name not in skip:
            try:
                if d["imdbId"]:
                    url = imdb_image(d["imdbId"])
                    ok = bool(url) and save_cover([url], path)
                    time.sleep(0.3)
                else:
                    ok = bool(d["_barcode"]) and save_cover(upc_images(d["_barcode"]), path, check_shape=True)
                if ok:
                    got += 1
                else:
                    skip.add(name)
                    print("  no usable cover for", d["title"])
            except Exception as e:  # a missing cover just shows a title card
                print("  no cover for %s: %s" % (d["title"], e))
        if os.path.exists(path):
            d["cover"] = "covers/" + name
        elif d["title"] in BOX_SETS:
            # no cover for a set we know the films of: up to 4 of their posters, shown as a grid (covers/parts/)
            parts = []
            for f in BOX_SETS[d["title"]][:4]:
                ppath = os.path.join(COVERS, "parts", slug(f) + ".webp")
                if covers and not os.path.exists(ppath):
                    os.makedirs(os.path.dirname(ppath), exist_ok=True)
                    try:
                        url = film_image(f)
                        if url:
                            save_cover([url], ppath)
                        time.sleep(0.3)
                    except Exception as e:
                        print("  no poster for %s: %s" % (f, e))
                if os.path.exists(ppath):
                    parts.append("covers/parts/" + slug(f) + ".webp")
            if parts:
                d["parts"] = parts
            else:
                missing += 1
        else:
            missing += 1
    print("Covers: %d downloaded, %d without one." % (got, missing))

    # Spines (logo + cover colour); --logos N limits new TMDB lookups (a test run)
    lim = next((int(a.split("=", 1)[1]) for a in sys.argv if a.startswith("--logos=")), None)
    spines(discs, lim)

    # HDR (Ver 1.4): what tools/hdr.py found on blu-ray.com, by disc id ("dv", "hdr10+", "hdr10")
    hdr_file = os.path.join(ROOT, "movies", "library", "hdr.json")
    found = json.load(open(hdr_file)) if os.path.exists(hdr_file) else {}
    for d in discs:
        if found.get(d["id"]):
            d["hdr"] = found[d["id"]]

    for d in discs:
        d.pop("_barcode", None)
        d.pop("_promo", None)
        for k in [k for k, v in d.items() if v in ("", None, [], False)]:
            del d[k]  # keep the file small: leave out empty fields
    discs.sort(key=lambda d: (re.sub(r"[^a-z0-9 ]", "", d["sort"].lower()), d.get("year") or 0))

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Nick's discs, from the My Movies app export (tools/discs.py writes this file; re-run it after a new export).\n")
        f.write("// Discs added on the site in owner mode live in the Worker and are merged in by library.js.\n")
        f.write("window.DISCS = [\n")
        f.write(",\n".join("  " + json.dumps(d, ensure_ascii=False) for d in discs))
        f.write("\n];\n")
    print("Wrote %d discs to %s" % (len(discs), os.path.relpath(OUT, ROOT)))


if __name__ == "__main__":
    main()
