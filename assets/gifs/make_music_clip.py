#!/usr/bin/env python3
"""The home page's Music tile: music.mp4 + .jpg. Now playing, three songs Nick picked (fixed here: the tile doesn't
follow his listening; re-run and push to change them): for each, the
album sleeve with its vinyl sliding out and spinning (the cover as its label), the title and artist, a progress bar
and a pink spectrum visualizer pulsing to the beat, over a blurred glow of the cover. 3 s a song, crossfading, 9 s.

    python3 make_music_clip.py <work folder>    # needs Pillow and ffmpeg; downloads the 640px covers from Spotify
"""
import math, os, sys, urllib.request
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter
from cliplib import W, H, FPS, Frames, ease, font, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
SONGS = [  # title, artist, length (s), where it starts in the tile (s), cover (Nick's picks, 2026-10-09)
    ("Special Thing", "Gilligan Moss", 297, 92, "https://i.scdn.co/image/ab67616d0000b273ccec99c8fdfd266be336d3ee"),
    ("Just Slow Down", "Thing", 169, 48, "https://i.scdn.co/image/ab67616d0000b273179042e39357ea8b1a5407e5"),
    ("Rouge.", "St-Amour, cezanne", 104, 31, "https://i.scdn.co/image/ab67616d0000b2731c881ffcef2c7bec23070496"),
]
SONG = 3.0      # seconds each
FADE = 8        # frames of crossfade between songs (and back to the first)
BPM = 120
PINK, VIOLET = (255, 126, 182), (167, 139, 250)
SLEEVE = (60, 140, 320)       # x, y, size
REC_R = 150                   # the record's radius


def cover(url, name):
    path = os.path.join(WORK, name)
    if not os.path.exists(path):
        urllib.request.urlretrieve(url, path)
    return Image.open(path).convert("RGB")


def rounded(im, r):
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=r, fill=255)
    out = im.convert("RGBA")
    out.putalpha(m)
    return out


def record(art, angle, size):
    """A vinyl, size px across: grooves, a sheen that stays put, and the cover as its label, turned by angle."""
    S = 2
    n = size * S
    rec = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(rec)
    d.ellipse((0, 0, n - 1, n - 1), fill=(14, 14, 16, 255))
    for k in range(18):  # grooves
        r = n / 2 * (0.96 - k * 0.032)
        c = 26 + (k % 3) * 5
        d.ellipse((n / 2 - r, n / 2 - r, n / 2 + r, n / 2 + r), outline=(c, c, c + 2, 255), width=S)
    sheen = Image.new("L", (n, n), 0)
    sd = ImageDraw.Draw(sheen)
    for a0 in (-60, 120):  # light catching the grooves from the top left and the bottom right
        sd.pieslice((0, 0, n - 1, n - 1), a0, a0 + 34, fill=40)
    sheen = sheen.filter(ImageFilter.GaussianBlur(n / 30))
    rec = Image.composite(Image.new("RGBA", (n, n), (255, 255, 255, 255)), rec, ImageChops.multiply(sheen, rec.getchannel("A")))
    lab = int(n * 0.36)
    label = art.resize((lab, lab), Image.LANCZOS).rotate(-angle, resample=Image.BICUBIC)
    m = Image.new("L", (lab, lab), 0)
    ImageDraw.Draw(m).ellipse((0, 0, lab - 1, lab - 1), fill=255)
    rec.paste(label, ((n - lab) // 2, (n - lab) // 2), m)
    hole = n * 0.018
    ImageDraw.Draw(rec).ellipse((n / 2 - hole, n / 2 - hole, n / 2 + hole, n / 2 + hole), fill=(10, 10, 12, 255))
    return rec.resize((size, size), Image.LANCZOS)


def beat(t):
    return math.exp(-((t * BPM / 60) % 1) * 5)


def spectrum(d, x0, y0, w, h, t, seed):
    """Bars that jump on the beat, the low end harder, each with its own wobble."""
    n = 30
    bw = w / n
    for i in range(n):
        u = i / (n - 1)
        level = (0.35 + 0.65 * beat(t) * (1 - u * 0.6)) * (0.55 + 0.45 * math.sin(t * (5 + i % 7) + i * 1.7 + seed)) \
            + 0.18 * math.sin(t * 11 + i * 0.9 + seed) ** 2
        level = min(1, max(0.06, level * (1 - 0.35 * u)))
        bh = h * level
        c = tuple(int(a + (b - a) * u) for a, b in zip(PINK, VIOLET))
        d.rounded_rectangle((x0 + i * bw + bw * 0.18, y0 + h - bh, x0 + (i + 1) * bw - bw * 0.18, y0 + h), radius=bw * 0.3, fill=c)


def scene(k, t):
    """Song k, t seconds into its 3."""
    title, artist, length, at, url = SONGS[k]
    art = cover(url, "music-cover-%d.jpg" % k)
    # the backdrop: the cover, huge, blurred and dimmed
    bg = art.resize((W, W), Image.LANCZOS).crop((0, (W - H) // 2, W, (W - H) // 2 + H)).filter(ImageFilter.GaussianBlur(46))
    bg = ImageEnhance.Brightness(ImageEnhance.Color(bg).enhance(1.4)).enhance(0.36)
    im = bg.convert("RGBA")
    sx, sy, ss = SLEEVE
    # the record slides out from behind the sleeve, spins, and slides back before the next song
    out = ease(t / 0.6) * (1 - ease((t - (SONG - 0.55)) / 0.5))
    cx, cy = sx + ss / 2 + 150 * out, sy + ss / 2
    rec = record(art, (t + k) * 0.55 * 360, REC_R * 2)
    im.alpha_composite(rec, (int(cx - REC_R), int(cy - REC_R)))
    # the sleeve, with a soft shadow
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((sx + 6, sy + 16, sx + ss + 6, sy + ss + 16), radius=14, fill=(0, 0, 0, 170))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))
    im.alpha_composite(rounded(art.resize((ss, ss), Image.LANCZOS), 8), (sx, sy))
    # the words, the progress and the spectrum, on the right
    S = 2
    lay = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    tx = 594
    for i in range(3):  # "now playing" with three little bars going
        bh = 5 + 9 * abs(math.sin(t * 7 + i * 1.3))
        d.rounded_rectangle(((tx + i * 6) * S, (150 - bh) * S, (tx + i * 6 + 3.5) * S, 150 * S), radius=S, fill=PINK)
    d.text(((tx + 26) * S, 150 * S), "NOW PLAYING", font=font(WORK, "SpaceGrotesk.ttf", 15 * S, 700), fill=PINK, anchor="ls")
    size = 30
    while size > 18 and d.textlength(title, font=font(WORK, "Unbounded.ttf", size * S, 700)) > (W - tx - 28) * S:
        size -= 1  # a long title shrinks to fit
    d.text((tx * S, (178 + (30 - size) * 0.6) * S), title, font=font(WORK, "Unbounded.ttf", size * S, 700), fill=(246, 244, 240))
    d.text((tx * S, 228 * S), artist, font=font(WORK, "SpaceGrotesk.ttf", 21 * S, 500), fill=(205, 200, 196))
    pos = at + t
    bx, by, bw = tx, 290, 320
    d.rounded_rectangle((bx * S, by * S, (bx + bw) * S, (by + 5) * S), radius=3 * S, fill=(255, 255, 255, 60))
    d.rounded_rectangle((bx * S, by * S, (bx + bw * pos / length) * S, (by + 5) * S), radius=3 * S, fill=PINK)
    px = bx + bw * pos / length
    d.ellipse(((px - 7) * S, (by - 4.5) * S, (px + 7) * S, (by + 9.5) * S), fill=(255, 255, 255))
    small = font(WORK, "SpaceGrotesk.ttf", 15 * S, 500)
    d.text((bx * S, (by + 16) * S), "%d:%02d" % divmod(int(pos), 60), font=small, fill=(190, 186, 182))
    d.text(((bx + bw) * S, (by + 16) * S), "%d:%02d" % divmod(length, 60), font=small, fill=(190, 186, 182), anchor="ra")
    spectrum(d, tx * S, 352 * S, 320 * S, 110 * S, t + k * 0.37, k)
    im.alpha_composite(lay.resize((W, H), Image.LANCZOS))
    return im.convert("RGB")


def main():
    out = []
    for k in range(len(SONGS)):
        part = [scene(k, i / FPS) for i in range(int(SONG * FPS))]
        if out:
            for j in range(FADE):
                u = ease((j + 1) / (FADE + 1))
                out[len(out) - FADE + j] = Image.blend(out[len(out) - FADE + j], part[0], u)
        out += part
    for j in range(FADE):  # back into the first song, so the loop has no seam
        u = ease((j + 1) / (FADE + 1))
        out[len(out) - FADE + j] = Image.blend(out[len(out) - FADE + j], out[0], u)
    frames = Frames(WORK, "music")
    for im in out:
        frames.add(im)
    frames.encode(crf=30, poster_at=1.5)


if __name__ == "__main__":
    main()
