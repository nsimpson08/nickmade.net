#!/usr/bin/env python3
"""The home page's Movies tile: movies.mp4 + .jpg. An original scene after Nick's favorite film, There Will Be Blood:
an oil derrick burning at night in the desert, a column of fire and black smoke, embers, and a man in a hat watching
from the dark. Drawn, not footage. Letterboxed 2.39:1 with film grain and a flicker, the title in the bottom bar.
Every particle repeats on an 8-second cycle, so the loop has no seam.

    python3 make_movies_clip.py <work folder>    # needs Pillow and ffmpeg
"""
import math, os, random, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from cliplib import W, H, FPS, Frames, ease, font, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
T = 8.0                      # loop length (s)
BAR = 99                     # letterbox bars: 960 x 402 picture, 2.39:1
TOP, BOT = BAR, H - BAR
HORIZON = TOP + 300
DX, DBASE = 600, HORIZON + 6  # the derrick's center and foot
DH = 165                      # its height
AMBER = (245, 180, 81)


def particles(n, life, spawn, vel, size, seed):
    r = random.Random(seed)
    return [dict(b=r.random() * T, life=life * (0.6 + 0.8 * r.random()), x=spawn(r), vx=vel[0] * (r.random() - 0.5), vy=vel[1] * (0.6 + 0.8 * r.random()),
                 s=size * (0.6 + 0.8 * r.random()), ph=r.random() * 6.28, w=0.6 + r.random()) for _ in range(n)]


FIRE = particles(1200, 1.4, lambda r: (DX + (r.random() - 0.5) * 40, DBASE - DH + 4 + r.random() * 26), (56, -135), 18, 1)
LICKS = particles(420, 0.9, lambda r: (DX + (r.random() - 0.5) * 90 * (1 - r.random() * 0.6), DBASE - DH * r.random() ** 0.6), (30, -70), 13, 2)
SMOKE = particles(130, 7.0, lambda r: (DX + (r.random() - 0.5) * 50, DBASE - DH - 60 - r.random() * 50), (30, -20), 44, 3)
EMBERS = particles(140, 3.0, lambda r: (DX + (r.random() - 0.5) * 60, DBASE - DH), (90, -70), 2.2, 4)


def ages(ps, t):
    for p in ps:
        a = (t - p["b"]) % T
        if a < p["life"]:
            yield p, a, a / p["life"]


def fire_color(u):
    stops = [(0, (255, 248, 210)), (0.18, (255, 205, 90)), (0.45, (250, 120, 30)), (0.75, (170, 40, 10)), (1, (40, 8, 2))]
    for (u0, c0), (u1, c1) in zip(stops, stops[1:]):
        if u <= u1:
            k = (u - u0) / (u1 - u0)
            return tuple(int(a + (b - a) * k) for a, b in zip(c0, c1))
    return stops[-1][1]


def derrick(d, s, burn):
    """The wooden derrick, its legs narrowing to the crown block; edge-lit orange by the fire."""
    x, y, h = DX * s, DBASE * s, DH * s
    b0, b1 = 64 * s, 13 * s
    dark, lit = (10, 7, 5), (int(120 * burn), int(48 * burn), int(10 * burn))
    for side in (-1, 1):
        d.line((x + side * b0, y, x + side * b1, y - h), fill=dark, width=int(5 * s))
        d.line((x + side * b0 + side * 2 * s, y, x + side * b1 + side * 2 * s, y - h), fill=lit, width=int(1.5 * s))
    levels = 9
    for i in range(levels):
        u0, u1 = i / levels, (i + 1) / levels
        w0, w1 = b0 + (b1 - b0) * u0, b0 + (b1 - b0) * u1
        y0, y1 = y - h * u0, y - h * u1
        d.line((x - w1, y1, x + w1, y1), fill=dark, width=int(3 * s))
        d.line((x - w0, y0, x + w1, y1), fill=dark, width=int(2 * s))
        d.line((x + w0, y0, x - w1, y1), fill=dark, width=int(2 * s))
    d.rectangle((x - 18 * s, y - h - 10 * s, x + 18 * s, y - h), fill=dark)  # crown
    d.polygon([(x - 90 * s, y), (x - 70 * s, y - 14 * s), (x - 40 * s, y - 14 * s), (x - 30 * s, y)], fill=dark)  # engine house


def man(d, s, x, y, rim):
    """A man in a coat and a bowler hat, standing with his back to us, rim-lit on the fire's side."""
    p = lambda pts: [(x + a * s, y + b * s) for a, b in pts]
    body = (6, 5, 4)
    d.polygon(p([(-20, 0), (-24, -70), (-30, -118), (-22, -136), (22, -136), (30, -118), (24, -70), (20, 0)]), fill=body)  # coat
    d.polygon(p([(-14, 0), (-12, 40), (-4, 40), (-2, 0)]), fill=body)
    d.polygon(p([(2, 0), (4, 40), (12, 40), (14, 0)]), fill=body)
    d.ellipse(p([(-12, -166), (12, -136)]), fill=body)                 # head
    d.ellipse(p([(-21, -168), (21, -160)]), fill=body)                 # brim
    d.chord(p([(-12, -186), (12, -156)]), 180, 360, fill=body)        # crown of the hat
    d.line(p([(24, -132), (31, -116), (25, -70), (21, 0)]), fill=rim, width=int(2 * s))
    d.line(p([(12, -162), (12, -150)]), fill=rim, width=int(2 * s))


def scene(t):
    S = 2
    flick = 0.88 + 0.08 * math.sin(t * 2 * math.pi * 3 / T * 4) + 0.04 * math.sin(t * 2 * math.pi * 7 / T * 3 + 1)
    im = Image.new("RGB", (W * S, H * S), (0, 0, 0))
    d = ImageDraw.Draw(im)
    # sky: night blue up top, burning orange low down near the fire
    for y in range(TOP * S, HORIZON * S):
        u = (y - TOP * S) / ((HORIZON - TOP) * S)
        c = (int(6 + 70 * u ** 2.2 * flick), int(8 + 24 * u ** 2.4 * flick), int(16 + 4 * u))
        d.line((0, y, W * S, y), fill=c)
    # the glow around the fire
    glow = Image.new("RGB", (W // 4, H // 4), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(70, 0, -4):
        k = (1 - r / 70) ** 1.6 * flick
        gd.ellipse((DX / 4 - r * 2.0, (DBASE - DH * 1.25) / 4 - r * 1.3, DX / 4 + r * 2.0, (DBASE - DH * 1.25) / 4 + r * 1.3), fill=(int(190 * k), int(66 * k), int(12 * k)))
    im = ImageChops.add(im, glow.filter(ImageFilter.GaussianBlur(8)).resize(im.size, Image.BILINEAR))
    d = ImageDraw.Draw(im)
    # smoke: big dark billows rising and leaning right, lit underneath
    smoke = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(smoke)
    for p, a, u in ages(SMOKE, t):
        x = p["x"][0] + p["vx"] * a + 230 * u ** 1.4 + 14 * math.sin(p["ph"] + a)
        y = p["x"][1] + p["vy"] * a * (1 - 0.3 * u)
        r = p["s"] * (0.5 + 2.2 * u)
        al = int(235 * min(1, u * 6) * (1 - u) ** 0.6)
        lit = max(0, 1 - u * 3)
        sd.ellipse((x - r, y - r, x + r, y + r), fill=(int(14 + 60 * lit), int(10 + 22 * lit), 8, al))
    smoke = smoke.filter(ImageFilter.GaussianBlur(9)).resize(im.size, Image.BILINEAR)
    im = Image.alpha_composite(im.convert("RGBA"), smoke).convert("RGB")
    # ground: flat desert, lit orange toward the derrick
    d = ImageDraw.Draw(im)
    for y in range(HORIZON * S, BOT * S):
        u = (y - HORIZON * S) / ((BOT - HORIZON) * S)
        d.line((0, y, W * S, y), fill=(int(22 - 12 * u), int(13 - 7 * u), int(8 - 4 * u)))
    gl = Image.new("RGB", (W // 4, H // 4), (0, 0, 0))
    ImageDraw.Draw(gl).ellipse(((DX - 330) / 4, (HORIZON - 4) / 4, (DX + 330) / 4, (HORIZON + 90) / 4), fill=(int(120 * flick), int(46 * flick), 8))
    im = ImageChops.add(im, gl.filter(ImageFilter.GaussianBlur(10)).resize(im.size, Image.BILINEAR))
    d = ImageDraw.Draw(im)
    d.polygon([(0, HORIZON * S), (W * 0.18 * S, (HORIZON - 9) * S), (W * 0.33 * S, (HORIZON - 3) * S), (W * 0.33 * S, HORIZON * S)], fill=(9, 6, 5))  # low hills
    d.polygon([(W * 0.8 * S, HORIZON * S), (W * 0.9 * S, (HORIZON - 12) * S), (W * S, (HORIZON - 5) * S), (W * S, HORIZON * S)], fill=(9, 6, 5))
    derrick(d, S, flick)
    # fire: additive, so it blooms
    fire = Image.new("RGB", (W, H), (0, 0, 0))
    fd = ImageDraw.Draw(fire)
    for group, spread in ((LICKS, 0.6), (FIRE, 1.0)):
        for p, a, u in ages(group, t):
            x = p["x"][0] + p["vx"] * a * spread + 10 * math.sin(p["ph"] + a * 9 * p["w"]) * u
            y = p["x"][1] + p["vy"] * a * (1 + 0.6 * u)
            r = p["s"] * (1.1 - 0.7 * u) * spread
            c = fire_color(u)
            k = (1 - u) ** 0.5 * 0.42
            fd.ellipse((x - r * 0.75, y - r * 1.9, x + r * 0.75, y + r), fill=tuple(int(v * k) for v in c))  # flame-shaped: tall, narrow
    bloom = fire.filter(ImageFilter.GaussianBlur(14))
    fire = ImageChops.add(fire.filter(ImageFilter.GaussianBlur(2.2)), bloom)
    im = ImageChops.add(im, fire.resize(im.size, Image.BILINEAR))
    d = ImageDraw.Draw(im)
    for p, a, u in ages(EMBERS, t):
        x = p["x"][0] + p["vx"] * a + 26 * math.sin(p["ph"] + a * 3)
        y = p["x"][1] + p["vy"] * a + 12 * a * a
        if TOP < y < BOT:
            r = p["s"] * S * (1 - u * 0.6)
            k = (1 - u)
            if k < 0.4:
                continue  # a dying ember would show as a dark speck on the fire
            d.ellipse((x * S - r, y * S - r, x * S + r, y * S + r), fill=(255, int(150 + 80 * k), int(40 + 60 * k)))
    man(d, S, 230 * S, (HORIZON + 62) * S, (int(150 * flick), int(70 * flick), 20))
    im = im.resize((W, H), Image.LANCZOS)
    # film: grain, a vignette, the letterbox and the title
    grain = Image.effect_noise((W, H), 28).convert("RGB")
    im = ImageChops.add(im, ImageChops.multiply(grain, Image.new("RGB", (W, H), (60, 60, 60))), scale=1, offset=-12)
    vig = Image.new("L", (W // 8, H // 8), 0)
    ImageDraw.Draw(vig).ellipse((-W // 16, -H // 16 + 4, W // 8 + W // 16, H // 8 + H // 16 - 4), fill=255)
    im = Image.composite(im, Image.new("RGB", (W, H), (0, 0, 0)), vig.filter(ImageFilter.GaussianBlur(10)).resize((W, H), Image.BILINEAR).point(lambda v: 90 + v * 165 // 255))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, TOP), fill=(0, 0, 0))
    d.rectangle((0, BOT, W, H), fill=(0, 0, 0))
    f = font(WORK, "Unbounded.ttf", 19, 500)
    d.text((W // 2, BOT + 50), "T H E R E   W I L L   B E   B L O O D", font=f, fill=AMBER, anchor="mm")
    return im


def main():
    frames = Frames(WORK, "movies")
    for n in range(int(T * FPS)):
        frames.add(scene(n / FPS))
    frames.encode(crf=30, poster_at=3.0)


if __name__ == "__main__":
    main()
