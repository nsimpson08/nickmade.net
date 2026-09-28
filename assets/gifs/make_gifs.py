import math, random, sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
W, H = 480, 300
BG = (0, 0, 0)
DIM = (38, 38, 42)
FG = (232, 230, 225)
MINT = (126, 224, 181)
VIOLET = (167, 139, 250)
AMBER = (245, 180, 81)
PINK = (255, 126, 182)
SKY = (124, 196, 255)
MONO = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 17)


def save(frames, name, ms):
    pal = [f.convert("P", palette=Image.ADAPTIVE, colors=32) for f in frames]
    pal[0].save(f"{OUT}/{name}.gif", save_all=True, append_images=pal[1:],
                duration=ms, loop=0, optimize=True, disposal=2)


def tri(t, period):
    p = (t % period) / period
    return 1 - abs(2 * p - 1)


# --- Extras: coding, then a golf shot, then a best-of list, looping ---
def star(d, cx, cy, r, fill):
    pts = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        rr = r if k % 2 == 0 else r * 0.45
        pts.append((cx + rr * math.cos(a), cy - rr * math.sin(a)))
    d.polygon(pts, fill=fill)


def fade(frames, n=5):
    """Fade the last n frames to black so scenes hand off smoothly"""
    for k in range(n):
        i = len(frames) - n + k
        frames[i] = Image.blend(frames[i], Image.new("RGB", (W, H), BG), (k + 1) / (n + 1))


def extras():
    frames = []

    # 1) coding: a terminal types a command and the checks come in
    cmd = "nickmade new --idea"
    checks = ["  [ok] sketching", "  [ok] caffeinating", "  [ok] shipping"]
    steps = [(i, 0) for i in range(len(cmd) + 1)] + [(len(cmd), k) for k in (1, 1, 1, 1, 2, 2, 2, 2, 3)] + [(len(cmd), 3)] * 12
    for n, (chars, shown) in enumerate(steps):
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((40, 40, W - 40, H - 40), 14, fill=(12, 12, 14), outline=DIM, width=2)
        for k, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
            d.ellipse((60 + k * 20, 58, 71 + k * 20, 69), fill=c)
        y = 96
        d.text((64, y), "$ ", font=MONO, fill=MINT)
        d.text((84, y), cmd[:chars], font=MONO, fill=FG)
        cx = 84 + d.textlength(cmd[:chars], font=MONO)
        for k in range(shown):
            y += 30
            d.text((64, y), checks[k][:6], font=MONO, fill=MINT)
            d.text((64 + d.textlength(checks[k][:6], font=MONO), y), checks[k][6:], font=MONO, fill=FG)
            cx = 64 + d.textlength(checks[k], font=MONO) + 6
        if chars < len(cmd) or (n // 4) % 2 == 0:
            d.rectangle((cx + 2, y + 2, cx + 11, y + 20), fill=MINT)
        frames.append(im)
    fade(frames)

    # 2) golf: backswing, strike, the ball arcs onto the green and drops in the cup
    ground = 232
    gx, bx0, hole = 92, 118, 392
    N = 60
    strike, land, cup = 16, 42, 48
    for t in range(N):
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        d.rectangle((0, ground, W, H), fill=(14, 30, 22))
        d.ellipse((hole - 70, ground - 6, hole + 70, ground + 10), fill=(22, 52, 36))  # the green
        d.line((0, ground, W, ground), fill=(40, 82, 58), width=2)
        # flag, waving
        d.line((hole, ground - 84, hole, ground), fill=FG, width=2)
        wave = 5 * math.sin(2 * math.pi * t / 20)
        d.polygon([(hole, ground - 84), (hole + 34, ground - 76 + wave * 0.4), (hole, ground - 64)], fill=MINT)
        d.ellipse((hole - 7, ground - 2, hole + 7, ground + 4), fill=BG)  # cup
        # golfer: head, body, legs, arms and club rotating around the shoulders
        sx, sy = gx, ground - 58
        d.ellipse((sx - 9, sy - 26, sx + 9, sy - 8), fill=FG)
        d.line((sx, sy - 8, sx, sy + 24), fill=FG, width=4)
        d.line((sx, sy + 24, sx - 10, ground), fill=FG, width=4)
        d.line((sx, sy + 24, sx + 10, ground), fill=FG, width=4)
        if t < 11:  # backswing: club from resting behind the ball up over the shoulder
            a = -60 - (t / 10) * 200
        elif t <= strike:  # fast downswing
            a = -260 + ((t - 10) / (strike - 10)) * 200
        elif t < 24:  # follow-through, finishing high toward the flag
            a = -60 + ((t - strike) / 8) * 115
        else:
            a = 55
        r = math.radians(a)
        hx, hy = sx + 30 * math.cos(r), sy + 2 - 30 * math.sin(r)  # hands
        d.line((sx, sy, hx, hy), fill=FG, width=3)
        cx2, cy2 = sx + 66 * math.cos(r), sy + 2 - 66 * math.sin(r)  # clubhead
        d.line((hx, hy, cx2, cy2), fill=(150, 148, 144), width=3)
        d.rectangle((cx2 - 4, cy2 - 3, cx2 + 4, cy2 + 3), fill=(150, 148, 144))
        # the ball
        def flight(u):  # u 0..1 along the arc
            return bx0 + (hole - 18 - bx0) * u, ground - 5 - 150 * 4 * u * (1 - u)
        if t <= strike:
            ball = (bx0, ground - 5)
        elif t <= land:
            u = (t - strike) / (land - strike)
            for k in range(1, 7):  # dotted trail
                uu = max(0.0, u - k * 0.05)
                tx, ty = flight(uu)
                c = tuple(int(v * (0.55 - k * 0.07)) for v in MINT)
                d.ellipse((tx - 2, ty - 2, tx + 2, ty + 2), fill=c)
            ball = flight(u)
        elif t <= cup:  # roll into the cup
            u = (t - land) / (cup - land)
            ball = (hole - 18 + 18 * u, ground - 5)
        else:
            ball = None
        if ball:
            d.ellipse((ball[0] - 5, ball[1] - 5, ball[0] + 5, ball[1] + 5), fill=(250, 250, 248))
        if cup < t < cup + 8:  # little burst from the cup
            k = t - cup
            for j in range(6):
                ang = math.pi * (0.15 + 0.7 * j / 5)
                rr = 8 + k * 4
                px, py = hole + rr * math.cos(ang), ground - 4 - rr * math.sin(ang)
                d.ellipse((px - 2, py - 2, px + 2, py + 2), fill=MINT)
        frames.append(im)
    fade(frames)

    # 3) a best-of list: ranked rows slide in, then the stars pop
    widths = [210, 170, 190, 140, 160]
    stars = [5, 5, 4, 4, 3]
    N = 56
    for t in range(N):
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((64, 30, W - 64, H - 30), 14, fill=(12, 12, 14), outline=DIM, width=2)
        d.text((88, 48), "BEST OF", font=MONO, fill=MINT)
        d.line((88, 72, 88 + d.textlength("BEST OF", font=MONO), 72), fill=MINT, width=2)
        for i in range(5):
            start = 4 + i * 4
            if t < start:
                continue
            e = min(1.0, (t - start) / 6)
            e = 1 - (1 - e) ** 3
            off = int((1 - e) * 120)
            y = 90 + i * 32
            d.text((88 + off, y), "%02d" % (i + 1), font=MONO, fill=MINT)
            d.rounded_rectangle((122 + off, y + 5, 122 + off + widths[i] * 0.9, y + 15), 4, fill=(62, 62, 66) if i else FG)
            for k in range(stars[i]):  # stars pop in after the rows land
                pop = t - (26 + i * 3 + k)
                if pop >= 0:
                    sc = min(1.0, 0.4 + pop * 0.3)
                    star(d, 338 + k * 14 + off, y + 10, 6 * sc, AMBER if i == 0 else (150, 148, 144))
        frames.append(im)
    fade(frames)

    save(frames, "extras", 60)


# --- Games: a pong rally that loops ---
def games():
    N = 64
    frames = []
    px = 3  # chunky pixel grid
    def snap(v): return int(v) // px * px
    for t in range(N):
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        for yy in range(12, H - 12, 18):
            d.rectangle((W // 2 - 3, yy, W // 2 + 2, yy + 8), fill=DIM)
        bx = 42 + tri(t, N) * (W - 42 - 42 - 12)
        by = 20 + tri(t + 5, N // 2) * (H - 40 - 12)
        # paddles ease toward the ball on their side
        ly = 20 + tri(t + 5 - 2, N // 2) * (H - 40 - 12) - 24
        ry = 20 + tri(t + 5 + 2, N // 2) * (H - 40 - 12) - 24
        ly = min(max(ly, 12), H - 72)
        ry = min(max(ry, 12), H - 72)
        d.rectangle((snap(24), snap(ly), snap(24) + 11, snap(ly) + 59), fill=FG)
        d.rectangle((snap(W - 36), snap(ry), snap(W - 36) + 11, snap(ry) + 59), fill=FG)
        # ball with a short fading trail
        for k, a in ((3, 0.18), (2, 0.35), (1, 0.6)):
            tx = 42 + tri(t - k, N) * (W - 42 - 42 - 12)
            ty = 20 + tri(t + 5 - k, N // 2) * (H - 40 - 12)
            c = tuple(int(v * a) for v in VIOLET)
            d.rectangle((snap(tx), snap(ty), snap(tx) + 11, snap(ty) + 11), fill=c)
        d.rectangle((snap(bx), snap(by), snap(bx) + 11, snap(by) + 11), fill=VIOLET)
        frames.append(im)
    save(frames, "games", 45)


# --- Movies: a film strip drifting past ---
def movies():
    FW = 132  # one film frame width
    N = 96
    top, bot = 50, H - 50
    random.seed(7)
    scenes = []
    for i in range(6):
        scenes.append(i)
    frames = []
    for t in range(N):
        off = t * 3 * FW / N
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        d.rectangle((0, top, W, bot), fill=(16, 14, 12))
        for i in range(-1, (W + 3 * FW) // FW + 2):
            x = i * FW - off
            # sprocket holes
            for s in range(4):
                hx = x + 10 + s * 32
                d.rounded_rectangle((hx, top + 8, hx + 16, top + 20), 3, fill=BG)
                d.rounded_rectangle((hx, bot - 20, hx + 16, bot - 8), 3, fill=BG)
            fx0, fy0, fx1, fy1 = x + 8, top + 32, x + FW - 8, bot - 32
            sc = i % 3
            # tiny scenes: sunset, moon, spotlight
            if sc == 0:
                d.rectangle((fx0, fy0, fx1, fy1), fill=(58, 30, 20))
                cx = (fx0 + fx1) / 2
                d.ellipse((cx - 22, fy1 - 44, cx + 22, fy1), fill=AMBER)
                d.rectangle((fx0, fy1 - 22, fx1, fy1), fill=(28, 16, 12))
            elif sc == 1:
                d.rectangle((fx0, fy0, fx1, fy1), fill=(14, 18, 34))
                d.ellipse((fx1 - 46, fy0 + 14, fx1 - 20, fy0 + 40), fill=FG)
                d.ellipse((fx1 - 40, fy0 + 10, fx1 - 14, fy0 + 36), fill=(14, 18, 34))
                for sx, sy in ((18, 30), (40, 70), (62, 22), (30, 110)):
                    d.rectangle((fx0 + sx, fy0 + sy, fx0 + sx + 2, fy0 + sy + 2), fill=FG)
            else:
                d.rectangle((fx0, fy0, fx1, fy1), fill=(26, 22, 18))
                cx = (fx0 + fx1) / 2
                d.polygon([(cx - 8, fy0), (cx + 8, fy0), (cx + 40, fy1), (cx - 40, fy1)], fill=(92, 70, 38))
                d.ellipse((cx - 10, fy1 - 46, cx + 10, fy1 - 26), fill=AMBER)
                d.rectangle((cx - 12, fy1 - 26, cx + 12, fy1), fill=AMBER)
        # projector flicker
        if t % 11 == 0:
            veil = Image.new("RGB", (W, H), (255, 240, 210))
            im = Image.blend(im, veil, 0.06)
        frames.append(im)
    save(frames, "movies", 60)


# --- Music: a spinning record with an equalizer ---
def music():
    N = 48
    frames = []
    cx, cy, R = 170, 150, 110
    bars = 7
    for t in range(N):
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        d.ellipse((cx - R, cy - R, cx + R, cy + R), fill=(14, 14, 16), outline=DIM, width=2)
        # sheen that rotates with the record
        a = t * 360 / N
        for off in (0, 180):
            d.pieslice((cx - R + 6, cy - R + 6, cx + R - 6, cy + R - 6), a + off, a + off + 22, fill=(34, 32, 38))
        for r in range(R - 12, 44, -9):
            d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(26, 26, 30), width=1)
        d.ellipse((cx - 40, cy - 40, cx + 40, cy + 40), fill=PINK)
        ra = math.radians(a)
        dx, dy = cx + 24 * math.cos(ra), cy + 24 * math.sin(ra)
        d.ellipse((dx - 4, dy - 4, dx + 4, dy + 4), fill=(120, 50, 90))
        d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=BG)
        # tonearm
        d.ellipse((cx + R - 6, cy - R - 2, cx + R + 14, cy - R + 18), fill=DIM)
        d.line((cx + R + 4, cy - R + 8, cx + 70, cy + 40), fill=(120, 118, 114), width=5)
        d.rectangle((cx + 60, cy + 34, cx + 76, cy + 48), fill=FG)
        # equalizer: each bar is a sum of sines that loops every N frames
        for b in range(bars):
            h = 0.5 + 0.3 * math.sin(2 * math.pi * (t / N * 2 + b * 0.37)) \
                + 0.2 * math.sin(2 * math.pi * (t / N * 3 + b * 0.91))
            h = max(0.1, min(1.0, h))
            bx = 330 + b * 18
            top = 230 - int(h * 150) // 6 * 6
            for yy in range(top, 230, 6):
                d.rectangle((bx, yy, bx + 11, yy + 3), fill=PINK if yy > top else FG)
        frames.append(im)
    save(frames, "music", 60)


# --- Photography: a viewfinder that focuses and fires ---
def photography():
    N = 60
    frames = []
    for t in range(N):
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        # the scene drifts slowly: sky, sun, two ridges
        drift = 16 * math.sin(2 * math.pi * t / N)
        d.rectangle((0, 0, W, H), fill=(10, 16, 26))
        d.ellipse((300 - drift, 70, 350 - drift, 120), fill=(255, 214, 150))
        d.polygon([(0, 230), (120 - drift, 150), (260 - drift, 220), (W, 190), (W, H), (0, H)], fill=(24, 40, 58))
        d.polygon([(0, 260), (170 - drift, 200), (330 - drift, 250), (W, 230), (W, H), (0, H)], fill=(14, 24, 36))
        # focus: brackets start loose and snap tight
        f = min(1.0, t / 28)
        ease = 1 - (1 - f) ** 3
        gap = int(70 - 40 * ease)
        col = SKY if t >= 28 else FG
        cx, cy = W // 2, H // 2
        L = 18
        for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            x = cx + sx * gap * 1.6
            y = cy + sy * gap
            d.line((x, y, x - sx * L, y), fill=col, width=3)
            d.line((x, y, x, y - sy * L), fill=col, width=3)
        # viewfinder frame and readout
        d.rectangle((24, 24, W - 24, H - 24), outline=(70, 80, 92), width=2)
        d.text((40, H - 50), "1/250  f/2.8  ISO 200", font=MONO, fill=(150, 160, 170))
        d.ellipse((W - 58, 38, W - 44, 52), fill=(255, 80, 80) if (t // 6) % 2 == 0 else (90, 30, 30))
        # shutter: close, flash, reopen
        if 34 <= t < 44:
            k = t - 34
            closed = 1 - abs(k - 4.5) / 4.5
            bar = int(H / 2 * max(0.0, min(1.0, closed * 1.3)))
            d.rectangle((0, 0, W, bar), fill=BG)
            d.rectangle((0, H - bar, W, H), fill=BG)
            if k in (4, 5):
                im = Image.blend(im, Image.new("RGB", (W, H), (235, 245, 255)), 0.55)
        frames.append(im)
    save(frames, "photography", 60)


# python3 make_gifs.py <out folder> [names...]  (no names = all of them)
ALL = {"extras": extras, "games": games, "movies": movies, "music": music, "photography": photography}
for name in sys.argv[2:] or ALL:
    ALL[name]()
