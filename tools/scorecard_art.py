#!/usr/bin/env python3
"""Cut a course's hole drawings out of a photo or scan of its real scorecard, for the Scorecard's redrawn card
(extras/scorecard/card.js draws them in the card's header, from the course file's card.header.art).

The card's background color is made see-through (soft edges, so no halo), so the drawings sit on the redrawn card's
own background. The course's logo is left out: card.js draws a clean vector version of it.

    python3 tools/scorecard_art.py <card image> <out.png> <x0,y0,x1,y1 as fractions of the image> <background r,g,b>
        [--tolerance 34] [--softness 40] [--sharpen]

e.g. Pecan Hollow (the course's June 2024 card, its lime background), holes 1-9 and their numbers:
    python3 tools/scorecard_art.py ph2024.jpg extras/scorecard/courses/pecan-hollow-holes-1.png 0.035,0,0.395,0.285 170,202,32
Needs Pillow. The drawings belong to the course: they're only drawn on that course's card.
"""
import argparse
from PIL import Image, ImageFilter


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("box", help="x0,y0,x1,y1 as fractions of the image's width and height")
    ap.add_argument("bg", help="the card's background color, r,g,b")
    ap.add_argument("--tolerance", type=float, default=34, help="colors this close to the background vanish")
    ap.add_argument("--softness", type=float, default=40, help="over this much more distance they fade back in")
    ap.add_argument("--sharpen", action="store_true", help="a light unsharp mask (for soft photos)")
    a = ap.parse_args()

    im = Image.open(a.image).convert("RGB")
    w, h = im.size
    x0, y0, x1, y1 = [float(v) for v in a.box.split(",")]
    im = im.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
    if a.sharpen:
        im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=70, threshold=2))
    br, bg, bb = [float(v) for v in a.bg.split(",")]
    px = im.load()
    out = Image.new("RGBA", im.size)
    po = out.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b = px[x, y]
            d = ((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2) ** 0.5
            alpha = max(0.0, min(1.0, (d - a.tolerance) / a.softness))
            po[x, y] = (r, g, b, round(alpha * 255))
    out.save(a.out, optimize=True)
    print("%s: %dx%d" % (a.out, out.size[0], out.size[1]))


if __name__ == "__main__":
    main()
