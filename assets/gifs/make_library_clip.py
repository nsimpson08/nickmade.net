#!/usr/bin/env python3
"""The home page's Library tile: library.mp4 + .jpg, the real Library pages with their real covers (Nick, 2026-11-06:
"make it specific towards the libraries and the way they look and their images"; until then a drawn shelf): Movies'
A–Z shelf rising past with its letter tabs and a case pulled up; Vinyl's covers, a red and a marble record sliding out
of their sleeves and II: Revisited's card opening with the record pulled out; a book's card opening as the book falls
shut; the board game boxes with players and time. record_library.js records the frames (see it for what has to be
running); this draws the pointer and its click ripples, crossfades between the shelves and back to the start, and
encodes.

    node record_library.js <work folder> && python3 make_library_clip.py <work folder>    # Pillow, ffmpeg
"""
import json, os, sys
from PIL import Image, ImageDraw
from cliplib import W, H, FPS, Frames, ease, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
RAW = os.path.join(WORK, "library-raw")
FADE = 8                   # frames of crossfade between shelves
RED = (255, 79, 94)        # the Library's colour (site.css --red): the click ripples


def pointer(d, x, y, s):
    """The macOS arrow pointer, black with a white edge, tip at (x, y)."""
    pts = [(0, 0), (0, 17), (4.2, 13.2), (7, 19.5), (9.6, 18.4), (6.9, 12.2), (12.2, 12.2)]
    d.polygon([(x + px * s, y + py * s) for px, py in pts], fill=(16, 16, 18), outline=(255, 255, 255), width=max(2, int(1.3 * s)))


def main():
    cur = json.load(open(os.path.join(RAW, "cursor.json")))
    scenes = json.load(open(os.path.join(RAW, "scenes.json")))
    raw = sorted(f for f in os.listdir(RAW) if f.endswith(".png"))
    clicks = [i for i, c in enumerate(cur) if c[2]]
    out = []
    for i, f in enumerate(raw):
        im = Image.open(os.path.join(RAW, f)).convert("RGB").resize((W, H), Image.LANCZOS)
        S = 2
        lay = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        x, y = cur[i][0] * S, cur[i][1] * S
        for c in clicks:  # a ripple from each click, over a third of a second
            a = (i - c) / (FPS / 3)
            if 0 <= a <= 1:
                cx, cy = cur[c][0] * S, cur[c][1] * S
                r = (8 + 30 * ease(a)) * S
                d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=RED + (int(230 * (1 - a)),), width=int(3 * S))
        pointer(d, x, y, 1.6 * S)
        frame = im.convert("RGBA")
        frame.alpha_composite(lay.resize((W, H), Image.LANCZOS))
        out.append(frame.convert("RGB"))
    # crossfade into each next shelf, and from the end back into the first frame so the loop has no seam
    for s in scenes[1:] + [len(out)]:
        nxt = out[s] if s < len(out) else out[0]
        for k in range(FADE):
            u = ease((k + 1) / (FADE + 1))
            out[s - FADE + k] = Image.blend(out[s - FADE + k], nxt, u)
    frames = Frames(WORK, "library")
    for im in out:
        frames.add(im)
    frames.encode(crf=36, poster_at=1.0)  # the Movies shelf with its letter tabs


if __name__ == "__main__":
    main()
