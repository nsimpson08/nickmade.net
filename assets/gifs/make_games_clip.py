#!/usr/bin/env python3
"""The home page's Games tile: games.mp4 + games.jpg (its poster), real Xbox gameplay instead of a drawn GIF.

    python3 make_games_clip.py <work folder>    # needs Pillow (a venv: pip install pillow) and ffmpeg

Footage: Nick's own Gears of War: Reloaded clips, recorded on his Series X on 2026-09-14 and listed by OpenXBL
(GET /v2/dvr/gameclips, the same key as the Worker: worker/.dev.vars OPENXBL_API_KEY). Their download links expire
after a day, so this asks OpenXBL for fresh ones, then has ffmpeg copy just the few seconds it uses straight from
Xbox's servers (a whole clip is ~225 MB and slow). Five shots cut fast, each punching in with a white flash, then the
Games page's achievement toast (site.css .xa-toast) slides in with his real rare achievement: Soldier, 50G, all acts
on Hardcore (6.37% of players; Xbox calls under 10% rare). Fonts: the site's Unbounded and Space Grotesk, downloaded
from Google Fonts into the work folder. 960x600 (the tile shows 480x300), 30 fps, ~8.6 s, H.264 CRF 33 (~590 KB).
"""
import json, os, shutil, subprocess, sys, urllib.request
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WORK = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "games-clip-work")
W, H, FPS, CRF = 960, 600, 30, 33
CLIPS = {"fight": "62ca12a1-e775-4e0d-b456-67a05a950cde", "mines": "7aa6f37c-6b85-4b73-b669-60198169da8b"}
# segments copied from the clips: name -> (clip, start s, length s). Copying starts at the keyframe before `start`,
# so the shot times below are counted from the start of each segment file, not the clip.
SEGMENTS = {"a": ("fight", 9, 9), "b": ("fight", 21, 8), "c": ("fight", 58, 13), "d": ("mines", 60, 12), "e": ("mines", 86, 9)}
# the cut: (segment, start s, length s): a wall blown apart through the scope, firing from cover, a Boomer looming,
# a firefight at the window, a Lancer burst that ends in a grenade's flash (just before the death screen)
SHOTS = [("a", 3.2, 1.5), ("c", 3.3, 1.5), ("e", 4.5, 1.7), ("b", 4.2, 1.5), ("d", 4.3, 2.45)]
FONTS = {"Unbounded.ttf": "https://github.com/google/fonts/raw/main/ofl/unbounded/Unbounded%5Bwght%5D.ttf",
         "SpaceGrotesk.ttf": "https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf"}

GREEN, GREEN_HI = (16, 124, 16), (69, 209, 69)
FG, MUTED = (236, 235, 231), (185, 183, 177)


def fetch():
    os.makedirs(WORK, exist_ok=True)
    for name, url in FONTS.items():
        if not os.path.exists(os.path.join(WORK, name)):
            urllib.request.urlretrieve(url, os.path.join(WORK, name))
    if all(os.path.exists(os.path.join(WORK, s + ".mp4")) for s in SEGMENTS):
        return
    key = next(l.split("=", 1)[1].strip().strip('"') for l in open(os.path.join(ROOT, "worker", ".dev.vars")) if l.startswith("OPENXBL_API_KEY="))
    req = urllib.request.Request("https://xbl.io/api/v2/dvr/gameclips", headers={"X-Authorization": key, "Accept": "application/json"})
    clips = {c["gameClipId"]: c["gameClipUris"][0]["uri"] for c in json.load(urllib.request.urlopen(req, timeout=60))["content"]["gameClips"]}
    for seg, (clip, start, length) in SEGMENTS.items():
        subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-i", clips[CLIPS[clip]], "-t", str(length), "-c", "copy", "-an", "-y",
                        os.path.join(WORK, seg + ".mp4")], check=True)


def font(name, size, weight):
    f = ImageFont.truetype(os.path.join(WORK, name), size)
    f.set_variation_by_axes([weight])
    return f


def ease(u): u = min(max(u, 0), 1); return u * u * (3 - 2 * u)
def back(u): u = min(max(u, 0), 1); return 1 + 2.9 * (u - 1) ** 3 + 1.9 * (u - 1) ** 2  # overshoot, for the badge pop


def trophy(d, cx, cy, s, fill):
    """The Games page's trophy icon (xbox-banner.js), drawn at size s."""
    u = s / 24
    d.rounded_rectangle((cx - 5 * u, cy - 9 * u, cx + 5 * u, cy + 1 * u), radius=4 * u, fill=fill)
    d.rectangle((cx - 5 * u, cy - 9 * u, cx + 5 * u, cy - 4 * u), fill=fill)
    for sx in (-1, 1):
        d.arc((cx + sx * 5 * u - 3.5 * u, cy - 8 * u, cx + sx * 5 * u + 3.5 * u, cy - 1 * u),
              start=270 if sx > 0 else 90, end=90 if sx > 0 else 270, fill=fill, width=max(2, int(2 * u)))
    d.rectangle((cx - 1 * u, cy + 1 * u, cx + 1 * u, cy + 6 * u), fill=fill)
    d.rectangle((cx - 4 * u, cy + 6 * u, cx + 4 * u, cy + 9 * u), fill=fill)


def toast(t):
    """The achievement toast at time t (s) as an RGBA layer, like .xa-toast: the badge pops in with a ring, the pill
    opens to the right, the text fades in, a shine sweeps across; at the end it all folds away. None when hidden."""
    T0, T_OUT = 1.6, 7.6
    if t < T0 or t > T_OUT + 0.6:
        return None
    S = 2  # drawn at 2x, then scaled down, for smooth edges
    big = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    x0, h, pad = 30 * S, 92 * S, 10 * S
    y0 = H * S - 30 * S - h
    badge = h - 2 * pad
    out = ease((t - T_OUT) / 0.5) if t > T_OUT else 0
    w = h + (480 * S - h) * ease((t - T0 - 0.25) / 0.45) * (1 - out)
    alpha = 1 - ease((t - T_OUT - 0.25) / 0.35) if t > T_OUT else 1
    pill_mask = Image.new("L", big.size, 0)
    ImageDraw.Draw(pill_mask).rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=h // 2, fill=255)
    if w > h + 2:
        shadow = Image.new("RGBA", big.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 12 * S, x0 + w, y0 + h + 12 * S), radius=h // 2, fill=(0, 0, 0, int(150 * alpha)))
        big.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18 * S)))
        grad = Image.new("RGBA", (1, h))
        for yy in range(h):
            v = int(29 - 12 * yy / h)
            grad.putpixel((0, yy), (v, v, v + 3, int(240 * alpha)))
        big.paste(grad.resize((int(w), h)), (x0, y0), pill_mask.crop((x0, y0, x0 + int(w), y0 + h)))
        d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=h // 2, outline=GREEN_HI + (int(200 * alpha),), width=2 * S)
        st = (t - T0 - 1.0) / 0.7
        if 0 < st < 1:
            shine = Image.new("RGBA", big.size, (0, 0, 0, 0))
            sx = x0 + (w + 200 * S) * st - 100 * S
            ImageDraw.Draw(shine).polygon([(sx, y0), (sx + 60 * S, y0), (sx + 20 * S, y0 + h), (sx - 40 * S, y0 + h)], fill=(255, 255, 255, 40))
            big.paste(Image.alpha_composite(big.copy(), shine.filter(ImageFilter.GaussianBlur(10 * S))), (0, 0), pill_mask)
        ta = ease((t - T0 - 0.6) / 0.3) * alpha * (1 - ease((t - T_OUT) / 0.2))
        if ta > 0:
            tx = x0 + pad + badge + 18 * S
            text = Image.new("RGBA", big.size, (0, 0, 0, 0))
            dt = ImageDraw.Draw(text)
            gy = y0 + 22 * S  # the rare-achievement gem
            dt.polygon([(tx + 6 * S, gy), (tx + 12 * S, gy + 7 * S), (tx + 6 * S, gy + 14 * S), (tx, gy + 7 * S)], fill=GREEN_HI)
            dt.text((tx + 20 * S, y0 + 16 * S), "Rare achievement unlocked", font=font("SpaceGrotesk.ttf", 21 * S, 500), fill=MUTED)
            name = font("Unbounded.ttf", 29 * S, 600)
            dt.text((tx, y0 + 44 * S), "Soldier", font=name, fill=FG)
            nx, cy, r = tx + dt.textlength("Soldier", font=name) + 18 * S, y0 + 63 * S, 12 * S
            dt.ellipse((nx, cy - r, nx + 2 * r, cy + r), outline=GREEN_HI, width=3 * S)
            dt.text((nx + r, cy), "G", font=font("SpaceGrotesk.ttf", 15 * S, 700), fill=GREEN_HI, anchor="mm")
            dt.text((nx + 2 * r + 8 * S, cy), "50", font=font("Unbounded.ttf", 25 * S, 600), fill=GREEN_HI, anchor="lm")
            a = text.getchannel("A").point(lambda v: int(v * ta))
            clipped = Image.new("L", big.size, 0)
            clipped.paste(a, (0, 0), pill_mask)
            text.putalpha(clipped)
            big.alpha_composite(text)
    bs = back((t - T0) / 0.35) * (1 - ease((t - T_OUT - 0.3) / 0.3))
    if bs > 0.01:
        cx, cy = x0 + pad + badge / 2, y0 + h / 2
        r = badge / 2 * bs
        for i in range(int(r), 0, -1):  # radial gradient, lighter toward the top left
            f = i / max(r, 1)
            off = (1 - f) * r * 0.3
            d.ellipse((cx - i - off, cy - i - off, cx + i - off, cy + i - off), fill=tuple(int(a + (b - a) * f) for a, b in zip((43, 181, 43), GREEN)) + (255,))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 30), width=S)
        trophy(d, cx, cy, 34 * S * bs, (255, 255, 255, 255))
        ring = (t - T0 - 0.15) / 0.6
        if 0 < ring < 1:
            rr = r + 26 * S * ease(ring)
            d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=GREEN_HI + (int(255 * (1 - ring)),), width=3 * S)
    return big.resize((W, H), Image.LANCZOS)


def main():
    fetch()
    frames = os.path.join(WORK, "frames")
    shutil.rmtree(frames, ignore_errors=True)
    os.makedirs(frames)
    n = 0
    for k, (seg, start, length) in enumerate(SHOTS):
        shot = os.path.join(WORK, "shot%d" % k)
        shutil.rmtree(shot, ignore_errors=True)
        os.makedirs(shot)
        # 16:10 from the middle of the 16:9 clip, a little brighter and punchier (Gears is dark), 6% oversized for the punch-in
        subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-i", os.path.join(WORK, seg + ".mp4"), "-t", str(length), "-vf",
                        "fps=%d,crop=1152:720,scale=%d:%d:flags=lanczos,eq=brightness=0.05:contrast=1.1:saturation=1.2:gamma=1.1" % (FPS, int(W * 1.06), int(H * 1.06)),
                        os.path.join(shot, "%03d.png")], check=True)
        for i, f in enumerate(sorted(os.listdir(shot))):
            im = Image.open(os.path.join(shot, f)).convert("RGB")
            z = 1 + 0.06 * (1 - ease(i / (FPS * 0.35)))  # every cut punches in and settles over a third of a second
            im = im.resize((int(W * z), int(H * z)), Image.LANCZOS)
            left, top = (im.width - W) // 2, (im.height - H) // 2
            im = im.crop((left, top, left + W, top + H)).convert("RGBA")
            if i < 2 and k > 0:  # a white flash on each cut (not into the first shot, where it loops)
                im = Image.blend(im, Image.new("RGBA", im.size, (255, 255, 255, 255)), 0.35 if i == 0 else 0.15)
            layer = toast(n / FPS)
            if layer:
                im.alpha_composite(layer)
            im.convert("RGB").save(os.path.join(frames, "%04d.png" % n))
            n += 1
    subprocess.run(["ffmpeg", "-v", "error", "-framerate", str(FPS), "-i", os.path.join(frames, "%04d.png"), "-c:v", "libx264", "-profile:v", "high",
                    "-preset", "veryslow", "-crf", str(CRF), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "-y", os.path.join(HERE, "games.mp4")], check=True)
    # the poster (before it plays): the Boomer, with the toast open
    Image.open(os.path.join(frames, "%04d.png" % int(4.2 * FPS))).convert("RGB").save(os.path.join(HERE, "games.jpg"), quality=82, optimize=True)
    print("games.mp4: %d frames, %.1f s, %d KB" % (n, n / FPS, os.path.getsize(os.path.join(HERE, "games.mp4")) // 1024))


if __name__ == "__main__":
    main()
