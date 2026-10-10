#!/usr/bin/env python3
"""The home page's Movies tile: movies.mp4 + .jpg. Three original drawn scenes after three of Nick's favorites, cut
through black, each letterboxed 2.39:1 with film grain and a vignette (no titles):
  There Will Be Blood: an oil derrick burning at night in the desert, fire, black smoke, embers, a man in a hat
  Everything Everywhere All at Once: two rocks with googly eyes on a canyon ledge, the everything bagel turning above
  The Big Lebowski: a ball down the lane under the 70s neon stars, and a strike
Drawn, not footage (the films are someone else's). 3 s a scene, 9 s a loop.

    python3 make_movies_clip.py <work folder>    # needs Pillow and ffmpeg
"""
import math, os, random, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from cliplib import W, H, FPS, Frames, ease, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
T = 8.0                      # loop length (s)
BAR = 99                     # letterbox bars: 960 x 402 picture, 2.39:1
TOP, BOT = BAR, H - BAR
HORIZON = TOP + 300
DX, DBASE = 600, HORIZON + 6  # the derrick's center and foot
DH = 165                      # its height


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


def blood(t):
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
    return im.resize((W, H), Image.LANCZOS)


def finish(im):
    """Film: grain, a vignette and the letterbox bars."""
    grain = Image.effect_noise((W, H), 28).convert("RGB")
    im = ImageChops.add(im, ImageChops.multiply(grain, Image.new("RGB", (W, H), (60, 60, 60))), scale=1, offset=-12)
    vig = Image.new("L", (W // 8, H // 8), 0)
    ImageDraw.Draw(vig).ellipse((-W // 16, -H // 16 + 4, W // 8 + W // 16, H // 8 + H // 16 - 4), fill=255)
    im = Image.composite(im, Image.new("RGB", (W, H), (0, 0, 0)), vig.filter(ImageFilter.GaussianBlur(10)).resize((W, H), Image.BILINEAR).point(lambda v: 90 + v * 165 // 255))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, TOP), fill=(0, 0, 0))
    d.rectangle((0, BOT, W, H), fill=(0, 0, 0))
    return im


# ---------- Everything Everywhere All at Once: the two rocks with googly eyes on a canyon ledge, the everything
# bagel turning in the sky behind them ----------

def googly(d, s, cx, cy, r, t, kick):
    """A googly eye: the pupil rolls to the bottom and jiggles after each kick (time since the last nudge)."""
    d.ellipse(((cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s), fill=(245, 245, 240), outline=(30, 30, 34), width=int(1.5 * s))
    wob = math.exp(-kick * 3.2) * math.sin(kick * 22)
    ang = math.pi / 2 + 0.9 * wob
    pr = r * 0.52
    px, py = cx + (r - pr - 1.5) * math.cos(ang), cy + (r - pr - 1.5) * math.sin(ang)
    d.ellipse(((px - pr) * s, (py - pr) * s, (px + pr) * s, (py + pr) * s), fill=(14, 14, 16))
    d.ellipse(((cx - r * 0.55) * s, (cy - r * 0.62) * s, (cx - r * 0.2) * s, (cy - r * 0.3) * s), fill=(255, 255, 255))


def everything(t):
    S = 2
    im = Image.new("RGB", (W * S, H * S))
    d = ImageDraw.Draw(im)
    for y in range(TOP * S, BOT * S):  # dusk: violet up top to a peach glow at the horizon
        u = (y - TOP * S) / ((BOT - TOP) * S)
        d.line((0, y, W * S, y), fill=(int(40 + 190 * u ** 1.4), int(26 + 120 * u ** 1.8), int(70 + 40 * u)))
    # the bagel: a black ring, seeds turning on it, the multiverse swirling in the hole
    bx, by, rr = 650, TOP + 112, 92
    spin = t * 0.9
    for k in range(48, 0, -1):
        u = k / 48
        hue = (u * 3 + spin * 0.6) % 1
        c = tuple(int(150 + 105 * math.sin(2 * math.pi * (hue + o))) for o in (0, 1 / 3, 2 / 3))
        rad = rr * 0.42 * u
        a0 = math.degrees(spin * 3 + u * 9)
        d.arc(((bx - rad) * S, (by - rad) * S, (bx + rad) * S, (by + rad) * S), a0, a0 + 250, fill=c, width=int(3 * S))
    d.ellipse(((bx - rr) * S, (by - rr) * S, (bx + rr) * S, (by + rr) * S), outline=(12, 10, 14), width=int(rr * 0.58 * S))
    r = random.Random(42)
    for _ in range(120):
        a = r.random() * 2 * math.pi + spin * 0.25
        dist = rr * (0.74 + 0.22 * r.random())
        sx, sy = bx + dist * math.cos(a), by + dist * math.sin(a)
        c = r.choice([(236, 226, 200), (255, 255, 255), (230, 200, 120), (40, 40, 44)])
        d.ellipse(((sx - 2.2) * S, (sy - 1.3) * S, (sx + 2.2) * S, (sy + 1.3) * S), fill=c)
    # mesas, layered back to front
    for depth, (base, col) in enumerate([(BOT - 118, (120, 74, 92)), (BOT - 92, (150, 82, 70)), (BOT - 68, (96, 52, 52))]):
        rr2 = random.Random(depth)
        pts = [(0, BOT * S)]
        x = 0
        while x < W + 60:
            hgt = base - rr2.uniform(10, 70) * (1 if rr2.random() > 0.4 else 0.3)
            w = rr2.uniform(60, 160)
            pts += [(x * S, hgt * S), ((x + w) * S, hgt * S)]
            x += w + rr2.uniform(10, 40)
        pts.append((W * S, BOT * S))
        d.polygon(pts, fill=col)
    # the ledge and the two rocks
    d.polygon([(0, (BOT - 54) * S), (430 * S, (BOT - 64) * S), (520 * S, BOT * S), (0, BOT * S)], fill=(58, 40, 40))
    for (cx, cy, rx, ry), eyes in (((150, BOT - 100, 64, 52), [(-20, -14, 13), (16, -18, 14)]), ((300, BOT - 92, 48, 40), [(-12, -10, 10), (14, -12, 11)])):
        d.ellipse(((cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S), fill=(122, 116, 112))
        d.ellipse(((cx - rx * 0.7) * S, (cy - ry * 0.8) * S, (cx + rx * 0.2) * S, (cy - ry * 0.1) * S), fill=(140, 134, 128))
        for ex, ey, er in eyes:
            googly(d, S, cx + ex, cy + ey, er, t, (t + cx * 0.003) % 1.4)
    return im.resize((W, H), Image.LANCZOS)


# ---------- The Big Lebowski: a ball down the lane under the 70s neon stars, a strike ----------

_pin = {}
def pin(im, s, x, y, h, ang):
    """A bowling pin, its base at (x, y), h tall, turned by ang (radians): drawn once upright, then rotated."""
    if h not in _pin:
        w, H2 = int(h * 0.4 * s) + 4, int(h * s) + 4
        sp = Image.new("RGBA", (w, H2), (0, 0, 0, 0))
        d = ImageDraw.Draw(sp)
        cx, white, red = w / 2, (246, 244, 238, 255), (200, 30, 40, 255)
        d.ellipse((cx - h * 0.19 * s, H2 - 2 - h * 0.4 * s, cx + h * 0.19 * s, H2 - 2), fill=white)                       # belly
        d.polygon([(cx - h * 0.09 * s, H2 - h * 0.4 * s), (cx + h * 0.09 * s, H2 - h * 0.4 * s), (cx + h * 0.07 * s, H2 - h * 0.74 * s), (cx - h * 0.07 * s, H2 - h * 0.74 * s)], fill=white)
        d.ellipse((cx - h * 0.11 * s, 2, cx + h * 0.11 * s, 2 + h * 0.34 * s), fill=white)                               # head
        for yy in (0.62, 0.68):
            d.line((cx - h * 0.085 * s, H2 - h * yy * s, cx + h * 0.085 * s, H2 - h * yy * s), fill=red, width=max(1, int(h * 0.045 * s)))
        _pin[h] = sp
    sp = _pin[h].rotate(math.degrees(-ang), resample=Image.BICUBIC, expand=True)
    im.paste(sp, (int(x * s - sp.width / 2), int(y * s - sp.height + _pin[h].height * 0.1)), sp)


def lebowski(t):
    S = 2
    im = Image.new("RGB", (W * S, H * S), (8, 6, 14))
    d = ImageDraw.Draw(im)
    vx, vy = W / 2, TOP + 150   # where the lane meets the pins
    # the masking panel above the pins: black with neon stars and zigzags
    d.rectangle((0, TOP * S, W * S, (vy - 26) * S), fill=(10, 8, 22))
    rs = random.Random(9)
    for k in range(14):
        sx, sy, sr = rs.uniform(30, W - 30), rs.uniform(TOP + 12, vy - 40), rs.uniform(6, 14)
        c = rs.choice([(255, 90, 200), (90, 230, 255), (255, 220, 90)])
        glow = 0.55 + 0.45 * math.sin(t * 5 + k)
        c = tuple(int(v * glow) for v in c)
        for a in range(4):
            ang = a * math.pi / 4
            d.line(((sx - sr * math.cos(ang)) * S, (sy - sr * math.sin(ang)) * S, (sx + sr * math.cos(ang)) * S, (sy + sr * math.sin(ang)) * S), fill=c, width=int(2 * S))
    zig = [(x * S, (vy - 30 + (8 if (x // 24) % 2 else 0)) * S) for x in range(0, W + 24, 24)]
    d.line(zig, fill=(255, 90, 200), width=int(3 * S))
    # the lane in perspective: maple boards, gutters, the arrows
    for y in range(int(vy) * S, BOT * S):
        u = (y / S - vy) / (BOT - vy)
        half = 62 + 340 * u
        d.line(((vx - half) * S, y, (vx + half) * S, y), fill=(int(176 + 40 * u), int(120 + 30 * u), int(66 + 20 * u)))
        g = 22 + 60 * u
        d.line(((vx - half - g) * S, y, (vx - half) * S, y), fill=(26, 22, 30))
        d.line(((vx + half) * S, y, (vx + half + g) * S, y), fill=(26, 22, 30))
    for k in range(-6, 7):
        d.line((vx * S + k * 6 * S, vy * S, vx * S + k * 60 * S, BOT * S), fill=(150, 98, 52), width=S)
    for k in (-2, -1, 0, 1, 2):
        ay = vy + (BOT - vy) * 0.62
        ax = vx + k * 42
        d.polygon([(ax * S, (ay - 14) * S), ((ax - 6) * S, ay * S), ((ax + 6) * S, ay * S)], fill=(110, 60, 30))
    # the ball, from the foul line to the pins, then the strike
    roll = 1.7
    pins = [(0, 0), (-1, 1), (1, 1), (-2, 2), (0, 2), (2, 2), (-3, 3), (-1, 3), (1, 3), (3, 3)]
    hit = max(0, t - roll)
    for i, (px, row) in enumerate(sorted(pins, key=lambda p: -p[1])):
        x0, y0 = vx + px * 15, vy - row * 9 + 6
        if hit > 0:
            rr = random.Random(i)
            vxp, vyp, spinp = rr.uniform(-160, 160), rr.uniform(-210, -90), rr.uniform(-9, 9)
            x0 += vxp * hit
            y0 += vyp * hit + 260 * hit * hit
            ang = spinp * hit
        else:
            ang = 0
        pin(im, S, x0, y0, 46, ang)
    if t < roll + 0.05:
        u = ease(min(t / roll, 1)) ** 0.8
        y = BOT - 40 - (BOT - 40 - vy - 6) * u
        rad = 46 - 38 * u
        x = vx + 30 * math.sin(u * 2.4) * (1 - u)
        d.ellipse(((x - rad) * S, (y - rad) * S, (x + rad) * S, (y + rad) * S), fill=(22, 30, 70))
        a = t * 14
        for k in range(3):  # the swirl and the finger holes turning
            hx, hy = x + rad * 0.45 * math.cos(a + k * 0.5), y + rad * 0.45 * math.sin(a + k * 0.5) * 0.6
            d.ellipse(((hx - rad * 0.09) * S, (hy - rad * 0.09) * S, (hx + rad * 0.09) * S, (hy + rad * 0.09) * S), fill=(6, 8, 18))
        d.ellipse(((x - rad * 0.6) * S, (y - rad * 0.8) * S, (x - rad * 0.1) * S, (y - rad * 0.45) * S), fill=(80, 100, 170))
    if 0 < hit < 0.5:  # the flash of the strike
        f = 1 - hit / 0.5
        fl = Image.new("RGB", (W // 4, H // 4))
        ImageDraw.Draw(fl).ellipse(((vx - 90) / 4, (vy - 50) / 4, (vx + 90) / 4, (vy + 40) / 4), fill=(int(255 * f), int(230 * f), int(160 * f)))
        im = ImageChops.add(im, fl.filter(ImageFilter.GaussianBlur(6)).resize(im.size, Image.BILINEAR))
    return im.resize((W, H), Image.LANCZOS)


# three scenes, each SCENE seconds, cutting through black
SCENES = [lambda t: blood(t + 3.0), everything, lebowski]  # (the fire is already going at 3 s)
SCENE = 3.0
DIP = 0.22  # seconds to black and back at each cut


def main():
    frames = Frames(WORK, "movies")
    for n in range(int(SCENE * len(SCENES) * FPS)):
        t = n / FPS
        k, local = int(t // SCENE), t % SCENE
        im = finish(SCENES[k](local))
        dark = max(1 - ease(local / DIP), ease((local - (SCENE - DIP)) / DIP))
        if dark > 0:
            im = Image.blend(im, Image.new("RGB", im.size, (0, 0, 0)), dark)
        frames.add(im)
    frames.encode(crf=30, poster_at=SCENE * 2 + 0.9)


if __name__ == "__main__":
    main()
