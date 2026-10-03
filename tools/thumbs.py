#!/usr/bin/env python3
"""Small WebP copies of the site's images for the poster walls (assets/js/wall.js).

    python3 tools/thumbs.py

The walls show each image only ~190-280px wide (and dimmed, as the page background), so they load these 400px-wide
copies instead of the full posters and photos, about a tenth of the size. Each folder below gets a thumbs/ folder:

    movies/posters/<name>.jpg              -> movies/posters/thumbs/<name>.webp
    games/posters/<name>.jpg               -> games/posters/thumbs/<name>.webp
    extras/golf/courses/<name>.webp        -> extras/golf/courses/thumbs/<name>.webp
    photography/sizes/<name>-800.jpg       -> photography/thumbs/<name>.webp

Only missing or out-of-date thumbnails are made; ones whose image is gone are deleted. Run it after adding posters
(tools/photos.py runs it for photos). A missing thumbnail isn't an error: the wall falls back to the full image.
Needs cwebp (brew install webp).
"""
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTH = 400
QUALITY = "72"
# (source folder, thumbs folder, which files, how to name the thumbnail from the file name)
SETS = [
    ("movies/posters", "movies/posters/thumbs", r"\.(jpe?g|png|webp)$", lambda f: re.sub(r"\.[a-z]+$", "", f)),
    ("games/posters", "games/posters/thumbs", r"\.(jpe?g|png|webp)$", lambda f: re.sub(r"\.[a-z]+$", "", f)),
    ("extras/golf/courses", "extras/golf/courses/thumbs", r"\.(jpe?g|png|webp)$", lambda f: re.sub(r"\.[a-z]+$", "", f)),
    ("photography/sizes", "photography/thumbs", r"-800\.jpg$", lambda f: re.sub(r"-800\.jpg$", "", f)),
]


def main():
    if not shutil.which("cwebp"):
        sys.exit("cwebp isn't installed: brew install webp")
    made = removed = 0
    for src_dir, out_dir, pattern, name_of in SETS:
        src_path, out_path = os.path.join(ROOT, src_dir), os.path.join(ROOT, out_dir)
        if not os.path.isdir(src_path):
            continue
        os.makedirs(out_path, exist_ok=True)
        wanted = set()
        for f in sorted(os.listdir(src_path)):
            if not re.search(pattern, f, re.I):
                continue
            src = os.path.join(src_path, f)
            out = os.path.join(out_path, name_of(f) + ".webp")
            wanted.add(os.path.basename(out))
            if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
                continue
            # -resize W 0 keeps the shape; images narrower than WIDTH are converted at their own size
            subprocess.run(["cwebp", "-quiet", "-q", QUALITY, "-m", "6", "-resize", str(WIDTH), "0", src, "-o", out], check=True)
            made += 1
        for f in os.listdir(out_path):
            if f.endswith(".webp") and f not in wanted:
                os.remove(os.path.join(out_path, f))
                removed += 1
    print("Thumbnails: %d made, %d removed." % (made, removed))


if __name__ == "__main__":
    main()
