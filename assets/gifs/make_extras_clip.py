#!/usr/bin/env python3
"""The home page's Extras tile: extras.mp4 + .jpg, the real pages instead of drawings: the Golf page's Score Trend
chart with the pointer sweeping across Nick's rounds, then the Video Game Montage Maker loading his recent Xbox games
from his gamertag and ticking three. record_extras.js records the frames (see it for what has to be running); this
draws the pointer and its click ripples, crossfades between the two and back to the start, and encodes.

    node record_extras.js <work folder> && python3 make_extras_clip.py <work folder>    # Pillow, ffmpeg
"""
import json, os, sys
from PIL import Image, ImageDraw
from cliplib import W, H, FPS, Frames, ease, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
RAW = os.path.join(WORK, "extras-raw")
SCENE2 = 122       # first Montage Maker frame (6 + 14 + 60 + 18 + 24 Golf frames in record_extras.js)
FADE = 8           # frames of crossfade
MINT = (126, 224, 181)


def pointer(d, x, y, s):
    """The macOS arrow pointer, black with a white edge, tip at (x, y)."""
    pts = [(0, 0), (0, 17), (4.2, 13.2), (7, 19.5), (9.6, 18.4), (6.9, 12.2), (12.2, 12.2)]
    d.polygon([(x + px * s, y + py * s) for px, py in pts], fill=(16, 16, 18), outline=(255, 255, 255), width=max(2, int(1.3 * s)))


def main():
    cur = json.load(open(os.path.join(RAW, "cursor.json")))
    raw = sorted(f for f in os.listdir(RAW) if f.endswith(".png"))
    imgs = [Image.open(os.path.join(RAW, f)).convert("RGB").resize((W, H), Image.LANCZOS) for f in raw]
    clicks = [i for i, c in enumerate(cur) if c[2]]
    out = []
    for i, im in enumerate(imgs):
        S = 2
        lay = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        x, y = cur[i][0] * S, cur[i][1] * S
        for c in clicks:  # a mint ripple from each click, over a third of a second
            a = (i - c) / (FPS / 3)
            if 0 <= a <= 1 and abs(cur[c][0] * S - x) < 1 and abs(cur[c][1] * S - y) < 1:
                r = (8 + 30 * ease(a)) * S
                d.ellipse((x - r, y - r, x + r, y + r), outline=MINT + (int(230 * (1 - a)),), width=int(3 * S))
        pointer(d, x, y, 1.6 * S)
        frame = im.convert("RGBA")
        frame.alpha_composite(lay.resize((W, H), Image.LANCZOS))
        out.append(frame.convert("RGB"))
    # crossfade into the Montage Maker, and from the end back into the first frame so the loop has no seam
    for k in range(FADE):
        u = ease((k + 1) / (FADE + 1))
        out[SCENE2 - FADE + k] = Image.blend(out[SCENE2 - FADE + k], out[SCENE2], u)
        out[len(out) - FADE + k] = Image.blend(out[len(out) - FADE + k], out[0], u)
    frames = Frames(WORK, "extras")
    for im in out:
        frames.add(im)
    frames.encode(crf=30, poster_at=7.85)  # all three games ticked


if __name__ == "__main__":
    main()
