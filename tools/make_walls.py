#!/usr/bin/env python3
"""The poster wall BACKGROUND as one small picture per page (Nick, 2026-11-07: the live background took 1-2 s, dozens of
separate covers from the Worker, TMDB and R2 on every visit; now it's one cached file that's there at once).

    python3 tools/make_walls.py            # every page with a wall; needs Pillow, the local site on :8000 and the
                                           # local Worker on :8787 (localhost's data = live's since the 1.7 release)
    python3 tools/make_walls.py movies     # just these pages (their keys: home, movies, games, music, photography,
                                           # library, library-movies, library-vinyl, library-books, library-board-games)

For each page: tools/make_walls.js lists the pictures its background would pick (wall.js collectAll()), this takes
as many as the background uses (BG_MAX, shuffled; Home half of each page's share, like wall.js), downloads each
one's small copy, and packs them into assets/walls/<page>.webp: a grid COLS across, each cell W wide and W * 1.5
tall (the tallest shape), the picture covering the cell's top part in its own shape. Then it rewrites wall.js's
`var SPRITES = ...;` line (version, cell size, count, shapes), which wall.js uses to show each tile's cell.
Rerun it (and push) when the shelves or lists have changed a lot; the interactive Poster wall is always live.
"""
import io, json, os, random, re, subprocess, sys, time, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "walls")
WALL_JS = os.path.join(ROOT, "assets", "js", "wall.js")
NODE_PATH = os.environ.get("NODE_PATH", "/Users/nsimpson/Documents/Personal/Golf Game/node_modules")
COLS = 8                   # cells across in the picture
W = 180                    # a cell's width (the background is dimmed and moving; its columns are ~190 px wide)
QUALITY = 40               # WebP quality
MAX = 48                   # tiles per page (8 columns of 6: plenty to fill a screen without repeats showing)
LETTER = [(1.5, "a"), (1.0, "b"), (2 / 3, "c"), (9 / 16, "d")]


def letter(r):
    return min(LETTER, key=lambda x: abs(x[0] - r))


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "nickmade.net make_walls"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def cover(im, w, h):
    """im scaled to cover w x h and cut to it from the middle (CSS object-fit: cover)."""
    s = max(w / im.width, h / im.height)
    im = im.resize((max(w, round(im.width * s)), max(h, round(im.height * s))), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def main():
    only = set(sys.argv[1:])
    env = dict(os.environ, NODE_PATH=NODE_PATH)
    listed = subprocess.run(["node", os.path.join(ROOT, "tools", "make_walls.js")], env=env, capture_output=True, text=True)
    if listed.returncode:
        sys.exit("make_walls.js failed: " + listed.stderr[-500:])
    pages = json.loads(listed.stdout)
    os.makedirs(OUT, exist_ok=True)
    src = open(WALL_JS).read()
    m = re.search(r"  var SPRITES = (\{.*?\}); // WALLS", src)
    sprites = json.loads(m.group(1)) if m else {}
    version = time.strftime("%Y%m%d%H%M")
    for key, page in pages.items():
        if only and key not in only:
            continue
        items = page["items"]
        random.shuffle(items)
        if page["home"]:  # (wall.js: half of each page's share, clips kept)
            items = [x for k, x in enumerate(items) if k % 2 == 0 or x["video"]]
        items = items[: min(MAX, page["max"])]
        cells, shapes = [], []
        for it in items:
            pic = None
            for u in (it["small"], it["src"]):
                try:
                    pic = fetch(u)
                    break
                except Exception:
                    continue
            if pic is None:
                print("  ! skipped (couldn't load):", it["src"][:100])
                continue
            r, ch = letter(it["ratio"])
            cells.append(cover(pic, W, round(W * r)))
            shapes.append((r, ch))
        if not cells:
            print(key, "nothing to draw, skipped")
            continue
        rows = -(-len(cells) // COLS)
        H = round(W * 1.5)
        sheet = Image.new("RGB", (COLS * W, rows * H), (17, 17, 17))
        for i, c in enumerate(cells):
            sheet.paste(c, ((i % COLS) * W, (i // COLS) * H))
        path = os.path.join(OUT, key + ".webp")
        sheet.save(path, "WEBP", quality=QUALITY, method=6)
        same = len({s[1] for s in shapes}) == 1
        sprites[key] = {"v": version, "n": len(cells), "cols": COLS, "w": W, "h": H,
                        "r": round(shapes[0][0], 4) if same else "".join(s[1] for s in shapes)}
        print("%-20s %3d tiles  %4d KB  %s" % (key, len(cells), os.path.getsize(path) // 1024, os.path.relpath(path, ROOT)))
    line = "  var SPRITES = " + json.dumps(sprites, separators=(",", ":"), sort_keys=True) + "; // WALLS (tools/make_walls.py rewrites this line)"
    src = re.sub(r"  var SPRITES = \{.*?\}; // WALLS \(tools/make_walls\.py rewrites this line\)", lambda _: line, src, count=1)
    open(WALL_JS, "w").write(src)
    print("wall.js updated (%d pages)" % len(sprites))


if __name__ == "__main__":
    main()
