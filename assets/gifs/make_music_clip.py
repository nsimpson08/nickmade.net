#!/usr/bin/env python3
"""The home page's Music tile: music.mp4 + .jpg. An original scene after Neutral Milk Hotel's In the Aeroplane Over the
Sea (Nick's pick): an old hand-tinted seaside postcard, waves rolling in, a wind-up gramophone on the sand playing to the
beat (its horn swelling, sound rippling out, notes rising), a biplane towing a banner of sheet music, the title
handwritten along the bottom. Inspired by, not copied from, the album's cover. Paper grain,
a soft flicker and a pink stamp (the Music page's color). Everything repeats every 8 s, so the loop has no seam.

    python3 make_music_clip.py <work folder>    # needs Pillow and ffmpeg
"""
import math, os, random, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from cliplib import W, H, FPS, Frames, ease, font, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
T = 8.0
PAPER = (232, 219, 193)
INK = (74, 52, 38)
PINK = (255, 126, 182)
# the picture on the postcard
PX0, PY0, PX1, PY1 = 46, 40, W - 46, H - 104
HORIZON = PY0 + int((PY1 - PY0) * 0.56)


def lerp(c0, c1, u):
    return tuple(int(a + (b - a) * u) for a, b in zip(c0, c1))


def sky(d, s):
    for y in range(PY0 * s, HORIZON * s):
        u = (y - PY0 * s) / ((HORIZON - PY0) * s)
        d.line((PX0 * s, y, PX1 * s, y), fill=lerp((150, 176, 170), (238, 196, 160), u ** 1.3))  # hand-tinted teal to peach


def clouds(d, s, t):
    r = random.Random(7)
    for _ in range(7):
        cx = PX0 + r.random() * (PX1 - PX0)
        cy = PY0 + 30 + r.random() * (HORIZON - PY0 - 90)
        drift = 14 * math.sin(2 * math.pi * t / T + cx)  # a gentle sway that comes back by the loop
        for k in range(6):
            ox, oy, rr = (k - 2.5) * 22 + r.uniform(-8, 8), r.uniform(-10, 6), r.uniform(16, 30)
            x = cx + ox + drift
            d.ellipse(((x - rr) * s, (cy + oy - rr * 0.6) * s, (x + rr) * s, (cy + oy + rr * 0.6) * s), fill=(246, 230, 210))


def sea(d, s, t):
    for y in range(HORIZON * s, PY1 * s):
        u = (y - HORIZON * s) / ((PY1 - HORIZON) * s)
        d.line((PX0 * s, y, PX1 * s, y), fill=lerp((96, 128, 128), (60, 88, 92), u))
    # wave lines: more and bigger toward us, all moving with the loop
    for i in range(16):
        u = (i + 1) / 17
        y0 = HORIZON + (PY1 - 70 - HORIZON) * u ** 1.6
        amp, wl = 1 + 5 * u, 50 + 160 * u
        ph = 2 * math.pi * (t / T) * (1 + i % 3)
        pts = [(x * s, (y0 + amp * math.sin(x / wl * 2 * math.pi + ph + i)) * s) for x in range(PX0, PX1 + 8, 8)]
        d.line(pts, fill=lerp((150, 180, 176), (226, 230, 214), u), width=max(1, int((0.6 + 1.6 * u) * s)))
    # the beach and a wave rolling up it
    beach = PY1 - 52
    roll = (t / T) * 2 * math.pi
    pts = [(PX0 * s, PY1 * s)]
    for x in range(PX0, PX1 + 8, 8):
        pts.append((x * s, (beach - 6 * math.sin(roll) + 7 * math.sin(x / 140 + roll * 2)) * s))
    pts.append((PX1 * s, PY1 * s))
    d.polygon(pts, fill=(236, 214, 170))
    foam = [(x * s, (beach - 6 * math.sin(roll) + 7 * math.sin(x / 140 + roll * 2) - 2) * s) for x in range(PX0, PX1 + 8, 8)]
    d.line(foam, fill=(250, 246, 232), width=int(3 * s))
    # two small figures on the sand, looking out to sea
    for fx, h in ((330, 34), (350, 30)):
        y = beach + 32
        d.ellipse(((fx - 3.5) * s, (y - h - 9) * s, (fx + 3.5) * s, (y - h - 2) * s), fill=INK)                       # head
        d.polygon([((fx - 6) * s, (y - h) * s), ((fx + 6) * s, (y - h) * s), ((fx + 5) * s, (y - h * 0.45) * s),
                   ((fx - 5) * s, (y - h * 0.45) * s)], fill=INK)                                                       # shoulders, coat
        for lx in (-3, 2):
            d.line(((fx + lx) * s, (y - h * 0.45) * s, (fx + lx) * s, y * s), fill=INK, width=int(2.2 * s))       # legs
    d.line(((336) * s, (beach + 32 - 18) * s, (344) * s, (beach + 32 - 16) * s), fill=INK, width=int(1.6 * s))  # holding hands


def gulls(d, s, t):
    r = random.Random(3)
    for _ in range(5):
        x0, y0, sp, ph = r.uniform(PX0, PX1), r.uniform(PY0 + 30, HORIZON - 60), r.choice((1, 2)), r.random()
        x = PX0 + (x0 - PX0 + (t / T) * sp * (PX1 - PX0)) % (PX1 - PX0)
        y = y0 + 6 * math.sin(2 * math.pi * (t / T * 3 + ph))
        flap = 4 + 3 * math.sin(2 * math.pi * (t / T * 12 + ph))
        d.line([((x - 9) * s, (y - flap) * s), (x * s, y * s), ((x + 9) * s, (y - flap) * s)], fill=INK, width=int(1.6 * s), joint="curve")


def plane(d, s, x, y, tilt):
    """A little biplane, side on, flying right."""
    def P(pts):
        c, si = math.cos(tilt), math.sin(tilt)
        return [((x + a * c - b * si) * s, (y + a * si + b * c) * s) for a, b in pts]
    body, wing = (110, 70, 52), (178, 82, 70)
    d.polygon(P([(-46, -2), (30, -6), (40, -2), (40, 4), (30, 7), (-46, 3)]), fill=body)            # fuselage
    d.polygon(P([(-48, -14), (-38, -3), (-46, -2)]), fill=wing)                                    # tail fin
    d.polygon(P([(-8, -20), (22, -20), (24, -17), (-8, -17)]), fill=wing)                          # upper wing
    d.polygon(P([(-6, 5), (22, 5), (24, 8), (-6, 8)]), fill=wing)                                  # lower wing
    for a in (-2, 18):
        d.line(P([(a, -17), (a, 5)]), fill=INK, width=int(1.2 * s))                                  # struts
    d.ellipse(P([(4, -9), (12, -1)]), fill=(240, 220, 190))                                         # pilot
    blade = 10 * math.sin(time_now[0] * 60)
    d.line(P([(42, -blade), (42, blade)]), fill=INK, width=int(2 * s))                              # propeller


time_now = [0.0]


BPM = 120  # 16 beats a loop


def beat(t):
    """1 on each beat, falling away quickly."""
    return math.exp(-((t * BPM / 60) % 1) * 6)


def note(d, s, x, y, size, c, kind):
    """A note: kind 0 a quarter, 1 an eighth, 2 two beamed eighths."""
    r = 4.6 * size
    heads = [(x, y)] if kind < 2 else [(x - 7 * size, y + 2 * size), (x + 7 * size, y)]
    for hx, hy in heads:
        d.ellipse(((hx - r) * s, (hy - r * 0.78) * s, (hx + r) * s, (hy + r * 0.78) * s), fill=c)
        d.line(((hx + r - 1) * s, hy * s, (hx + r - 1) * s, (hy - 17 * size) * s), fill=c, width=max(2, int(1.7 * size * s)))
    if kind == 1:
        d.line(((x + r - 1) * s, (y - 17 * size) * s, (x + r + 7 * size) * s, (y - 11 * size) * s), fill=c, width=max(2, int(1.7 * size * s)))
    if kind == 2:
        (ax, ay), (bx, by) = heads
        d.line(((ax + r - 1) * s, (ay - 17 * size) * s, (bx + r - 1) * s, (by - 17 * size) * s), fill=c, width=max(3, int(3 * size * s)))


GX, GY = PX1 - 200, PY1 - 14   # the gramophone's foot on the sand
MOUTH = (GX - 56, GY - 142)    # its horn's mouth


def gramophone(d, s, t):
    """A wind-up gramophone on the sand: the record turning, the brass horn swelling on the beat."""
    b = beat(t)
    d.rectangle(((GX - 46) * s, (GY - 34) * s, (GX + 46) * s, GY * s), fill=(122, 74, 44))           # the box
    d.rectangle(((GX - 46) * s, (GY - 34) * s, (GX + 46) * s, (GY - 30) * s), fill=(150, 96, 58))
    d.line(((GX + 46) * s, (GY - 18) * s, (GX + 58) * s, (GY - 18) * s), fill=INK, width=int(2.5 * s))  # crank
    d.line(((GX + 58) * s, (GY - 18) * s, (GX + 58) * s, (GY - 8) * s), fill=INK, width=int(2.5 * s))
    d.ellipse(((GX - 40) * s, (GY - 44) * s, (GX + 40) * s, (GY - 28) * s), fill=(24, 20, 20))         # the record
    a = t * 2 * math.pi * 33.3 / 60 * 2
    for k in range(3):
        d.arc(((GX - 34 + k * 8) * s, (GY - 42 + k * 2) * s, (GX + 34 - k * 8) * s, (GY - 30 - k * 2) * s), 0, 360, fill=(60, 52, 52), width=s)
    d.ellipse(((GX - 9) * s, (GY - 39) * s, (GX + 9) * s, (GY - 33) * s), fill=PINK)                 # its label
    hx, hy = GX + 9 * math.cos(a), GY - 36 + 3 * math.sin(a)
    d.ellipse(((hx - 2) * s, (hy - 1.2) * s, (hx + 2) * s, (hy + 1.2) * s), fill=(255, 240, 248))  # a mark going round
    # the horn: a neck from the back of the box, flaring up and to the left, swelling on the beat
    sw = 1 + 0.07 * b
    neck = [(GX + 20, GY - 40), (GX + 4, GY - 80), (GX - 22, GY - 108)]
    d.line([(x * s, y * s) for x, y in neck], fill=(150, 112, 40), width=int(7 * s), joint="curve")
    mx, my = MOUTH
    bell = [(GX - 22, GY - 108), (mx - 34 * sw, my - 26 * sw), (mx + 30 * sw, my + 30 * sw)]
    d.polygon([(x * s, y * s) for x, y in bell], fill=(196, 150, 56))
    d.ellipse(((mx - 40 * sw) * s, (my - 34 * sw) * s, (mx + 36 * sw) * s, (my + 38 * sw) * s), fill=(214, 170, 70), outline=(150, 112, 40), width=int(2 * s))
    d.ellipse(((mx - 22 * sw) * s, (my - 16 * sw) * s, (mx + 16 * sw) * s, (my + 20 * sw) * s), fill=(110, 76, 30))
    d.line(((GX + 20) * s, (GY - 40) * s, (GX - 4) * s, (GY - 37) * s), fill=INK, width=int(2 * s))  # tonearm


def sound(d, s, t):
    """Sound coming out of the horn: arcs that ripple out on each beat, and notes rising and drifting off."""
    mx, my = MOUTH
    ph = (t * BPM / 60) % 1
    for k in range(3):
        u = (ph + k / 3) % 1
        r = 46 + 70 * u
        d.arc(((mx - r) * s, (my - r) * s, (mx + r) * s, (my + r) * s), 195, 285, fill=lerp(PINK, (238, 214, 196), u), width=max(1, int((3 - 2 * u) * s)))
    for k in range(9):
        L = 4.0  # each note's trip, a half loop
        age = (t + k * L / 9) % L
        u = age / L
        x = mx - 30 - age * 58 + 12 * math.sin(age * 2.6 + k)
        y = my - 30 - age * 40 - 10 * math.sin(age * 1.7 + k)
        if x < PX0 + 16 or y < PY0 + 14:
            continue
        size = (1.0 + 0.25 * beat(t)) * (1.1 - 0.3 * u)
        note(d, s, x, y, size, lerp(PINK if k % 2 else INK, (236, 214, 190), u ** 1.5), k % 3)


def banner(d, s, t, px, py):
    """The plane's banner: a strip of sheet music on a tow line, rippling."""
    x1, x0 = px - 60, px - 300
    d.line(((px - 46) * s, py * s, x1 * s, (py + 2) * s), fill=INK, width=int(1.2 * s))
    top, h = py - 12, 30
    for x in range(int(x0), int(x1), 2):
        wv = 4 * math.sin(x / 26 - t * 9) * (x1 - x) / (x1 - x0)
        d.line((x * s, (top + wv) * s, x * s, (top + h + wv) * s), fill=(246, 236, 218), width=int(2 * s))
        for k in range(5):  # the staff
            yy = top + 5 + k * 5 + wv
            d.point([(x * s, yy * s), ((x + 1) * s, yy * s)], fill=(120, 96, 80))
    for k, nx in enumerate(range(int(x0) + 26, int(x1) - 10, 30)):
        wv = 4 * math.sin(nx / 26 - t * 9) * (x1 - nx) / (x1 - x0)
        note(d, s, nx, top + 18 - (k * 7 % 12) + wv, 0.75, PINK if k % 2 else INK, k % 3)


def frame(t):
    time_now[0] = t
    S = 2
    im = Image.new("RGB", (W * S, H * S), PAPER)
    d = ImageDraw.Draw(im)
    sky(d, S)
    clouds(d, S, t)
    sea(d, S, t)
    gulls(d, S, t)
    # the plane crosses once a loop, off the picture at the start and the end
    u = (t % T) / T
    px = PX0 - 80 + (PX1 - PX0 + 80 + 380) * u   # far enough that the banner is off the picture at both ends
    py = PY0 + 92 + 16 * math.sin(u * 2 * math.pi) + 5 * math.sin(u * 2 * math.pi * 5)
    banner(d, S, t, px, py)
    plane(d, S, px, py, -0.05 * math.cos(u * 2 * math.pi))
    gramophone(d, S, t)
    sound(d, S, t)
    im = im.resize((W, H), Image.LANCZOS)
    # age it: sepia wash over the picture, then grain, a flicker and a soft vignette
    pic = im.crop((PX0, PY0, PX1, PY1))
    gray = pic.convert("L")
    sep = Image.merge("RGB", [gray.point(lambda v: min(255, int(v * 1.07))), gray.point(lambda v: int(v * 0.93)), gray.point(lambda v: int(v * 0.78))])
    pic = Image.blend(pic, sep, 0.35)
    flick = 1 + 0.025 * math.sin(t * 2 * math.pi * 11 / T * 2) * math.sin(t * 2 * math.pi * 3 / T)
    pic = pic.point(lambda v: min(255, int(v * flick)))
    vig = Image.new("L", (40, 30), 0)
    ImageDraw.Draw(vig).ellipse((-8, -6, 48, 36), fill=255)
    pic = Image.composite(pic, Image.new("RGB", pic.size, (120, 90, 60)), vig.filter(ImageFilter.GaussianBlur(5)).resize(pic.size, Image.BILINEAR).point(lambda v: 150 + v * 105 // 255))
    im = Image.new("RGB", (W, H), PAPER)  # clean paper around the picture (clouds drift past its edge)
    im.paste(pic, (PX0, PY0))
    d = ImageDraw.Draw(im)
    d.rectangle((PX0, PY0, PX1, PY1), outline=(196, 178, 146), width=2)
    # the caption, handwritten, and a pink stamp with a postmark
    d.text((PX0 + 6, PY1 + 50), "in the aeroplane over the sea", font=font(WORK, "HomemadeApple.ttf", 30), fill=INK, anchor="lm")
    sx, sy = PX1 - 70, PY1 + 50
    d.rectangle((sx - 34, sy - 38, sx + 34, sy + 38), fill=(250, 240, 228))
    d.rectangle((sx - 28, sy - 32, sx + 28, sy + 32), fill=PINK)
    for k in range(3):  # the postmark's wavy lines, then a record on the stamp
        d.arc((sx - 70 - k * 9, sy - 30 - k * 9, sx - 10 + k * 9, sy + 30 + k * 9), 120, 240, fill=(90, 70, 60), width=2)
    d.ellipse((sx - 21, sy - 21, sx + 21, sy + 21), fill=(26, 22, 24))
    for rr in (17, 13):
        d.ellipse((sx - rr, sy - rr, sx + rr, sy + rr), outline=(70, 60, 64), width=1)
    d.ellipse((sx - 7, sy - 7, sx + 7, sy + 7), fill=(255, 255, 255))
    d.ellipse((sx - 1.5, sy - 1.5, sx + 1.5, sy + 1.5), fill=(26, 22, 24))
    grain = Image.effect_noise((W, H), 22).convert("RGB")
    im = ImageChops.add(im, ImageChops.multiply(grain, Image.new("RGB", (W, H), (40, 34, 28))), scale=1, offset=-10)
    return im


def main():
    frames = Frames(WORK, "music")
    for n in range(int(T * FPS)):
        frames.add(frame(n / FPS))
    frames.encode(crf=30, poster_at=3.6)


if __name__ == "__main__":
    main()
