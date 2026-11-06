#!/usr/bin/env python3
"""The home page's Library tile: library.mp4 + .jpg. A slow pan along one long shelf holding the four libraries in
turn: disc cases (4K and Blu-ray caps), a crate of records, a row of books, a stack of board games. Each does one
thing as it passes the middle: a case slides up off the shelf, a record rises out of the crate turning, a book is
pulled half out, the top game's lid lifts. All drawn (no film, album or book art: like the Movies tile, nothing here
is someone else's); the record's label in the Library's red. The shelf repeats, so the end runs straight into the start: 9 s.

    python3 make_library_clip.py <work folder>    # needs Pillow and ffmpeg
"""
import math, os, random, sys
from PIL import Image, ImageDraw, ImageFilter
from cliplib import W, H, FPS, Frames, ease, font, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
S = 2                      # drawn at twice the size, then scaled down (smooth edges)
SECONDS = 9.0
SHELF = 505                # the top of the board: everything stands on it
CREAM = (232, 213, 166)
RED = (255, 79, 94)        # the Library's colour (site.css --red)
rnd = random.Random(17)    # the same shelf every run


def sc(*v):
    return [int(round(x * S)) for x in v]


def box(d, x0, y0, x1, y1, fill, r=0, outline=None, width=1):
    if r:
        d.rounded_rectangle(sc(x0, y0, x1, y1), radius=r * S, fill=fill, outline=outline, width=width * S)
    else:
        d.rectangle(sc(x0, y0, x1, y1), fill=fill, outline=outline, width=width * S)


def shade(d, x0, y0, x1, y1):
    """A spine's roundness: a lit left edge and a darker right one."""
    box(d, x0, y0, x0 + 2, y1, (255, 255, 255, 34))
    box(d, x1 - 4, y0, x1, y1, (0, 0, 0, 70))


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# ---------- the shelf's contents, laid out once along a strip that repeats every PERIOD px ----------
items = []
x = 0

CASES = [  # body colour, 4K (black cap) or Blu-ray (blue cap), title bar colour
    ((22, 22, 28), "4k", (236, 235, 231)), ((40, 26, 26), "br", (245, 180, 81)), ((16, 34, 58), "4k", (124, 196, 255)),
    ((30, 30, 18), "br", (236, 235, 231)), ((58, 30, 46), "4k", (255, 126, 182)), ((233, 228, 216), "br", (40, 40, 44)),
    ((18, 44, 38), "4k", (126, 224, 181)), ((44, 20, 20), "4k", (255, 138, 102)), ((24, 24, 30), "br", (232, 213, 166)),
    ((60, 48, 20), "br", (20, 20, 20)), ((20, 26, 48), "4k", (167, 139, 250)), ((34, 34, 36), "br", (236, 235, 231)),
    ((70, 22, 26), "4k", (236, 235, 231)),
]
for i, (body, cap, ink) in enumerate(CASES):
    items.append(dict(kind="case", x=x, w=34, h=300, body=body, cap=cap, ink=ink, bar=rnd.randint(90, 150), lift=(i == 6)))
    x += 36
x += 56

SLEEVES = [  # (background, art colours, design), back to front
    ((40, 70, 110), [(124, 196, 255), (236, 235, 231)], "rings"),
    ((150, 40, 50), [(245, 180, 81), (30, 20, 20)], "stripes"),
    ((236, 228, 210), [(255, 126, 182), (40, 40, 44)], "dot"),
    ((24, 24, 28), [(232, 213, 166), (126, 224, 181)], "sun"),
]
items.append(dict(kind="crate", x=x, w=330))
x += 330 + 56

SPINES = [(122, 46, 46), (36, 64, 107), (62, 90, 58), (176, 112, 42), (75, 59, 99), (201, 162, 39), (30, 107, 107),
          (125, 44, 85), (43, 45, 51), (160, 82, 45), (217, 207, 182), (45, 95, 138)]
for i, c in enumerate(SPINES):
    w = rnd.choice([28, 32, 36, 40, 46, 52])
    items.append(dict(kind="book", x=x, w=w, h=rnd.randint(205, 285), body=c, bands=rnd.random() < 0.5,
                      light=sum(c) > 500, lift=(i == 5)))
    x += w + 2
x += 60

items.append(dict(kind="games", x=x, w=340))
x += 340 + 70
PERIOD = x


# ---------- drawing each thing ----------
def draw_case(d, it, sx, m):
    up = 64 * ease(m) if it["lift"] else 0
    x0, x1, y1 = sx, sx + it["w"], SHELF - up
    y0 = y1 - it["h"]
    box(d, x0, y0, x1, y1, it["body"], r=2)
    capc = (12, 12, 14) if it["cap"] == "4k" else (31, 95, 191)
    box(d, x0, y0, x1, y0 + 30, capc, r=2)
    if it["cap"] == "4k":
        f = font(WORK, "Unbounded.ttf", 11 * S, 800)
        d.text(sc((x0 + x1) / 2, y0 + 15), "4K", font=f, fill=(255, 255, 255), anchor="mm")
    else:
        box(d, x0 + 8, y0 + 11, x1 - 8, y0 + 19, (255, 255, 255), r=4)
    cx = (x0 + x1) / 2
    box(d, cx - 3, y0 + 52, cx + 3, y0 + 52 + it["bar"], it["ink"], r=3)    # the title, running down the spine
    box(d, cx - 3, y1 - 34, cx + 3, y1 - 18, mix(it["ink"], it["body"], 0.45), r=3)  # the year
    shade(d, x0, y0, x1, y1)


def record_image():
    n = 230 * S
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((0, 0, n - 1, n - 1), fill=(14, 14, 16, 255))
    for k in range(16):
        r = n / 2 * (0.95 - k * 0.034)
        c = 28 + (k % 3) * 6
        d.ellipse((n / 2 - r, n / 2 - r, n / 2 + r, n / 2 + r), outline=(c, c, c + 2, 255), width=S)
    lr = n * 0.17
    d.ellipse((n / 2 - lr, n / 2 - lr, n / 2 + lr, n / 2 + lr), fill=RED + (255,))
    d.pieslice((n / 2 - lr, n / 2 - lr, n / 2 + lr, n / 2 + lr), -20, 40, fill=CREAM + (255,))  # shows it turning
    hr = n * 0.018
    d.ellipse((n / 2 - hr, n / 2 - hr, n / 2 + hr, n / 2 + hr), fill=(10, 10, 10, 255))
    return im


RECORD = None


def sleeve_art(bg, cols, design, size):
    n = size * S
    im = Image.new("RGBA", (n, n), bg + (255,))
    d = ImageDraw.Draw(im)
    if design == "rings":
        for k in range(6):
            r = n * (0.42 - k * 0.065)
            d.ellipse((n * 0.5 - r, n * 0.55 - r, n * 0.5 + r, n * 0.55 + r), outline=cols[k % 2], width=int(n * 0.022))
    elif design == "stripes":
        for k in range(-4, 9):
            o = k * n * 0.16
            d.polygon([(o, n), (o + n * 0.07, n), (o + n * 0.07 + n, 0), (o + n, 0)], fill=cols[0])
        d.rectangle((n * 0.1, n * 0.1, n * 0.48, n * 0.2), fill=cols[1])
    elif design == "dot":
        r = n * 0.26
        d.ellipse((n * 0.55 - r, n * 0.42 - r, n * 0.55 + r, n * 0.42 + r), fill=cols[0])
        d.rectangle((n * 0.12, n * 0.78, n * 0.62, n * 0.84), fill=cols[1])
    else:  # sun
        cx, cy = n * 0.5, n * 0.62
        for k in range(16):
            a = math.pi * k / 16
            d.polygon([(cx, cy), (cx + math.cos(a) * n, cy - math.sin(a) * n), (cx + math.cos(a + 0.09) * n, cy - math.sin(a + 0.09) * n)], fill=cols[0])
        r = n * 0.18
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=cols[1])
    return im


SLEEVE_IMS = None


def draw_crate(canvas, d, it, sx, m):
    global RECORD, SLEEVE_IMS
    if RECORD is None:
        RECORD = record_image()
        SLEEVE_IMS = [sleeve_art(bg, cols, des, 236) for bg, cols, des in SLEEVES]
    x0, x1 = sx, sx + it["w"]
    front_top = SHELF - 150
    # the sleeves, back to front: each a little lower and to one side, so their tops step down
    for k, im in enumerate(SLEEVE_IMS):
        if k == len(SLEEVE_IMS) - 1:
            # the record rises out from behind the front sleeve, turning
            e = ease(m)
            ang = -360 * m * 1.4
            rec = RECORD.rotate(ang, resample=Image.BICUBIC)
            ry = front_top - 196 + 40 - 150 * e
            canvas.paste(rec, (int((x0 + 50) * S), int(ry * S)), rec)
        sx_k = x0 + 30 + k * 10
        sy_k = front_top - 236 + 70 + k * 16
        canvas.paste(im, (int(sx_k * S), int(sy_k * S)), im)
        box(d, sx_k, sy_k, sx_k + 236, sy_k + 4, (255, 255, 255, 30))          # the sleeve's top edge catching light
    # the crate's front: wooden slats
    for k in range(3):
        y0 = front_top + k * 50
        box(d, x0, y0, x1, y0 + 46, mix((138, 90, 51), (96, 60, 32), k / 3), r=3)
        box(d, x0, y0 + 46, x1, y0 + 50, (40, 24, 12))
    box(d, x0 + 6, front_top + 8, x0 + 20, SHELF - 8, (0, 0, 0, 50))
    box(d, x1 - 20, front_top + 8, x1 - 6, SHELF - 8, (0, 0, 0, 50))
    box(d, (x0 + x1) / 2 - 28, front_top + 20, (x0 + x1) / 2 + 28, front_top + 30, (30, 18, 10), r=5)  # the hand hole


def draw_book(d, it, sx, m):
    up = 74 * ease(m) if it["lift"] else 0
    x0, x1, y1 = sx, sx + it["w"], SHELF - up
    y0 = y1 - it["h"]
    box(d, x0, y0, x1, y1, it["body"], r=2)
    ink = (42, 37, 32) if it["light"] else (242, 234, 216)
    if it["bands"]:
        for yy in (y0 + 12, y1 - 16):
            box(d, x0 + 2, yy, x1 - 2, yy + 3, mix(ink, it["body"], 0.35))
    cx = (x0 + x1) / 2
    box(d, cx - 3, y0 + 34, cx + 3, y0 + 34 + it["h"] * 0.45, ink, r=3)      # the title
    box(d, cx - 2, y1 - 44, cx + 2, y1 - 28, mix(ink, it["body"], 0.4), r=2)  # the author
    shade(d, x0, y0, x1, y1)


GAMES = [(320, 58, (36, 64, 107), (232, 213, 166)), (290, 66, (176, 112, 42), (24, 24, 28)),
         (330, 50, (62, 90, 58), (242, 234, 216)), (270, 62, (122, 46, 46), (245, 180, 81))]  # bottom to top


def draw_games(d, it, sx, m):
    cx = sx + it["w"] / 2
    y = SHELF
    for k, (w, h, body, ink) in enumerate(GAMES):
        x0, x1 = cx - w / 2 + (k % 2) * 8, cx + w / 2 + (k % 2) * 8
        top = k == len(GAMES) - 1
        if top:
            lift = 30 * ease(m)
            box(d, x0 + 4, y - h * 0.4, x1 - 4, y, mix(body, (0, 0, 0), 0.45), r=2)   # the box's bottom
            box(d, x0 + 8, y - h * 0.4 - lift, x1 - 8, y - h * 0.4, (16, 14, 12))       # inside, once the lid's up
            yl = y - lift
            box(d, x0, yl - h, x1, yl, body, r=3)
            box(d, x0 + 16, yl - h * 0.62, x0 + 16 + w * 0.42, yl - h * 0.38, ink, r=4)   # the name on the lid's side
            d.ellipse(sc(x1 - 40, yl - h * 0.7, x1 - 16, yl - h * 0.3), fill=ink)
            box(d, x0, yl - h, x1, yl - h + 3, (255, 255, 255, 40))
        else:
            box(d, x0, y - h, x1, y, body, r=3)
            box(d, x0 + 16, y - h * 0.62, x0 + 16 + w * 0.42, y - h * 0.38, ink, r=4)
            d.ellipse(sc(x1 - 40, y - h * 0.7, x1 - 16, y - h * 0.3), fill=ink)
            box(d, x0, y - h, x1, y - h + 3, (255, 255, 255, 40))
        box(d, x0, y - 3, x1, y, (0, 0, 0, 60))
        y -= h


def background():
    bg = Image.new("RGBA", (W * S, H * S), (12, 10, 9, 255))
    glow = Image.new("L", (W * S, H * S), 0)
    ImageDraw.Draw(glow).ellipse(sc(W * 0.15, -H * 0.55, W * 0.85, H * 0.75), fill=60)
    glow = glow.filter(ImageFilter.GaussianBlur(80 * S))
    bg = Image.composite(Image.new("RGBA", bg.size, (70, 58, 40, 255)), bg, glow)
    return bg


def foreground():
    """The board, its shadow, and a vignette, drawn over everything."""
    fg = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg, "RGBA")
    box(d, 0, SHELF, W, SHELF + 12, (122, 79, 44))
    box(d, 0, SHELF + 12, W, SHELF + 40, (84, 52, 28))
    box(d, 0, SHELF, W, SHELF + 2, (160, 112, 70))
    for k in range(40):  # the shadow under the board
        box(d, 0, SHELF + 40 + k, W, SHELF + 41 + k, (0, 0, 0, int(150 * (1 - k / 40))))
    vig = Image.new("L", (W * S, H * S), 0)
    ImageDraw.Draw(vig).rectangle((0, 0, W * S, H * S), fill=150)
    ImageDraw.Draw(vig).ellipse(sc(-W * 0.1, -H * 0.2, W * 1.1, H * 1.15), fill=0)
    vig = vig.filter(ImageFilter.GaussianBlur(70 * S))
    fg.alpha_composite(Image.composite(Image.new("RGBA", fg.size, (0, 0, 0, 255)), Image.new("RGBA", fg.size, (0, 0, 0, 0)), vig))
    return fg


BG, FG = background(), foreground()
DRAW = {"case": draw_case, "book": draw_book}

frames = Frames(WORK, "library")
total = int(SECONDS * FPS)
for f in range(total):
    off = PERIOD * f / total
    # drawn straight onto the opaque frame, so the see-through shading and shadows blend (on a transparent layer
    # Pillow replaces pixels instead)
    canvas = BG.convert("RGB")
    d = ImageDraw.Draw(canvas, "RGBA")
    for it in items:
        for rep in (-1, 0, 1):
            sx = it["x"] - off + rep * PERIOD
            if sx > W or sx + it["w"] < 0:
                continue
            # its moment: strongest as its middle crosses the middle of the frame
            m = max(0.0, 1 - abs(sx + it["w"] / 2 - W / 2) / 230)
            box(d, sx + 2, SHELF - 6, sx + it["w"] - 2, SHELF, (0, 0, 0, 90))  # where it stands
            if it["kind"] in DRAW:
                DRAW[it["kind"]](d, it, sx, m)
            elif it["kind"] == "crate":
                draw_crate(canvas, d, it, sx, m)
            else:
                draw_games(d, it, sx, m)
    canvas.paste(FG, (0, 0), FG)
    frames.add(canvas.resize((W, H), Image.LANCZOS))
frames.encode(crf=30, poster_at=1.0)
