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
MONO = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 17)


def save(frames, name, ms):
    pal = [f.convert("P", palette=Image.ADAPTIVE, colors=32) for f in frames]
    pal[0].save(f"{OUT}/{name}.gif", save_all=True, append_images=pal[1:],
                duration=ms, loop=0, optimize=True, disposal=2)


def tri(t, period):
    p = (t % period) / period
    return 1 - abs(2 * p - 1)


# --- Projects: a terminal that types itself ---
def projects():
    lines = [
        ("$ ", "nickmade new --idea"),
        ("", "  [ok] sketching"),
        ("", "  [ok] caffeinating"),
        ("", "  [ok] shipping"),
    ]
    frames = []
    typed = 0
    total = len(lines[0][1])
    steps = []
    for i in range(0, total + 1, 1):
        steps.append((i, 0))
    for extra in range(1, 4):
        steps += [(total, extra)] * 6
    steps += [(total, 3)] * 14
    for n, (chars, shown) in enumerate(steps):
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((40, 40, W - 40, H - 40), 14, fill=(12, 12, 14), outline=DIM, width=2)
        for k, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
            d.ellipse((60 + k * 20, 58, 71 + k * 20, 69), fill=c)
        y = 96
        d.text((64, y), "$ ", font=MONO, fill=MINT)
        d.text((84, y), lines[0][1][:chars], font=MONO, fill=FG)
        cx = 84 + d.textlength(lines[0][1][:chars], font=MONO)
        for k in range(1, shown + 1):
            y += 30
            txt = lines[k][1]
            d.text((64, y), txt[:6], font=MONO, fill=MINT)
            d.text((64 + d.textlength(txt[:6], font=MONO), y), txt[6:], font=MONO, fill=FG)
            cx = 64 + d.textlength(txt, font=MONO) + 6
        if shown == 3:
            y += 30
            d.text((64, y), "$ ", font=MONO, fill=MINT)
            cx = 84
        if (n // 4) % 2 == 0 or chars < total:
            d.rectangle((cx + 2, y + 2, cx + 11, y + 20), fill=MINT)
        frames.append(im)
    save(frames, "projects", 80)


# --- Video Games: a pong rally that loops ---
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


projects()
games()
movies()
music()
