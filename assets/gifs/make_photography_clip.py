#!/usr/bin/env python3
"""The home page's Photography tile: photography.mp4 + .jpg, five of Nick's own Pixel photos through a camera
viewfinder. Each one: the focus box closes in and locks (sky blue), the photo pulls from soft to sharp, the shutter
blinks, and it drifts slowly while the round gallery thumbnail in the corner takes it. Photos from
photography/sizes/ (the 1600px copies tools/photos.py makes).

    python3 make_photography_clip.py <work folder>    # needs Pillow and ffmpeg
"""
import os, sys
from PIL import Image, ImageDraw, ImageFilter
from cliplib import ROOT, W, H, FPS, Frames, ease, font, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
PHOTOS = [  # (file in photography/sizes, focus point as a fraction of the frame)
    ("pxl-20260319-022615956-mp-2-1600.jpg", (0.42, 0.55)),  # palms against the sunset
    ("pxl-20260317-193444649-mp-2-1600.jpg", (0.55, 0.45)),  # surf and the pier town
    ("pxl-20231012-170159878-mp-2-1600.jpg", (0.38, 0.40)),  # covered bridge in the fall
    ("pxl-20260315-025942017-mp-2-1600.jpg", (0.60, 0.48)),  # the arcade
    ("pxl-20260320-020647127-mp-2-1600.jpg", (0.70, 0.35)),  # sunset over the water
]
SHOT = 1.75  # seconds per photo
SKY = (124, 196, 255)
WHITE = (255, 255, 255)


def cover(im, scale, focus):
    """im scaled to cover W x H times `scale`, cropped around `focus` (fractions)."""
    s = max(W / im.width, H / im.height) * scale
    big = im.resize((int(im.width * s) + 1, int(im.height * s) + 1), Image.LANCZOS)
    left = min(max(int(big.width * focus[0] - W / 2), 0), big.width - W)
    top = min(max(int(big.height * focus[1] - H / 2), 0), big.height - H)
    return big.crop((left, top, left + W, top + H))


def brackets(d, box, length, color, width):
    x0, y0, x1, y1 = box
    for (x, y, dx, dy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        d.line((x, y, x + dx * length, y), fill=color, width=width)
        d.line((x, y, x, y + dy * length), fill=color, width=width)


def overlay(t_in, n_shot, focus, thumb):
    S = 2
    lay = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    # rule-of-thirds grid and the frame corners
    for k in (1, 2):
        d.line((W * S * k / 3, 0, W * S * k / 3, H * S), fill=(255, 255, 255, 38), width=S)
        d.line((0, H * S * k / 3, W * S, H * S * k / 3), fill=(255, 255, 255, 38), width=S)
    m = 26 * S
    brackets(d, (m, m, W * S - m, H * S - m), 34 * S, (255, 255, 255, 200), 3 * S)
    # focus box: closes in on the focus point, then locks (sky blue, a little pulse)
    lock = ease(t_in / 0.45)
    size = (220 - 120 * lock) * S
    cx, cy = focus[0] * W * S, focus[1] * H * S
    locked = t_in > 0.45
    pulse = 1 + 0.08 * max(0, 1 - (t_in - 0.45) / 0.15) if locked else 1
    hs = size / 2 * pulse
    col = SKY + (255,) if locked else (255, 255, 255, 230)
    fade = 1 - ease((t_in - 1.0) / 0.3)
    if fade > 0:
        col = col[:3] + (int(col[3] * fade),)
        brackets(d, (cx - hs, cy - hs, cx + hs, cy + hs), 18 * S, col, 3 * S)
        if locked:
            d.ellipse((cx - 4 * S, cy - 4 * S, cx + 4 * S, cy + 4 * S), fill=col)
    # top: a recording-style readout; bottom: the shutter button and the gallery thumbnail
    f = font(WORK, "SpaceGrotesk.ttf", 19 * S, 600)
    d.text((m + 18 * S, m + 10 * S), "PIXEL", font=f, fill=(255, 255, 255, 230))
    d.text((W * S - m - 18 * S, m + 10 * S), "%02d / %02d" % (n_shot + 1, len(PHOTOS)), font=f, fill=(255, 255, 255, 200), anchor="ra")
    bx, by, br = W * S / 2, H * S - m - 44 * S, 30 * S
    press = 1 - 0.18 * max(0, 1 - abs(t_in - 0.55) / 0.08)
    d.ellipse((bx - br - 6 * S, by - br - 6 * S, bx + br + 6 * S, by + br + 6 * S), outline=(255, 255, 255, 230), width=3 * S)
    d.ellipse((bx - br * press, by - br * press, bx + br * press, by + br * press), fill=(255, 255, 255, 235))
    if thumb is not None:
        tr = 26 * S
        tx, ty = W * S - m - 70 * S, by
        th = thumb.resize((2 * tr, 2 * tr), Image.LANCZOS)
        mask = Image.new("L", th.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, 2 * tr - 1, 2 * tr - 1), fill=255)
        lay.paste(th, (int(tx - tr), int(ty - tr)), mask)
        d.ellipse((tx - tr, ty - tr, tx + tr, ty + tr), outline=(255, 255, 255, 220), width=2 * S)
    return lay.resize((W, H), Image.LANCZOS)


def main():
    frames = Frames(WORK, "photography")
    photos = [(Image.open(os.path.join(ROOT, "photography", "sizes", f)).convert("RGB"), focus) for f, focus in PHOTOS]
    thumb = cover(photos[-1][0], 1.0, photos[-1][1])  # the last photo, so the loop starts where it ended
    per = int(SHOT * FPS)
    for k, (im, focus) in enumerate(photos):
        for i in range(per):
            t = i / FPS
            # soft and slightly wide until focus locks, then sharp with a slow push in
            scale = 1.0 + 0.10 * (t / SHOT)
            frame = cover(im, scale + 0.03 * (1 - ease(t / 0.5)), focus)
            blur = 9 * (1 - ease((t - 0.15) / 0.35))
            if blur > 0.3:
                frame = frame.filter(ImageFilter.GaussianBlur(blur))
            frame = frame.convert("RGBA")
            if 0.52 <= t < 0.62:  # the shutter: a dark blink, then a flash
                frame = Image.blend(frame, Image.new("RGBA", frame.size, (0, 0, 0, 255)), 0.85 if t < 0.57 else 0)
                if t >= 0.57:
                    frame = Image.blend(frame, Image.new("RGBA", frame.size, (255, 255, 255, 255)), 0.35)
            if abs(t - 0.6) < 0.5 / FPS:
                thumb = cover(im, 1.0, focus)  # the gallery thumbnail takes the new photo
            frame.alpha_composite(overlay(t, k, focus, thumb))
            frames.add(frame)
    frames.encode(crf=34, poster_at=SHOT * 2 + 1.2)


if __name__ == "__main__":
    main()
