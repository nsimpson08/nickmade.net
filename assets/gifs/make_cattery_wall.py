#!/usr/bin/env python3
"""The Cattery's Play page clip: play/wall/cats.mp4 + cats.jpg (poster) + cats-1..5.jpg (stills for the poster wall).
Re-recorded 2026-10-15 for 1.6 (Nick: "yes re-record"; the old one was the Oct 7 test room, 640x360 at 12 fps, before
fights, storms and sunbeams). Three parts of the whole room in daylight, crossfading, about 15 s, looping:
  a fight (two rivals: the stare-down, lunges, the brawl cloud), a thunderstorm (the cats run and hide), a sunbeam
  full of napping cats (a minute in).

    node record_cattery.js <work> 240 none 0 wall-fight
    node record_cattery.js <work> 210 storm 0 wall-storm
    node record_cattery.js <work> 150 sunbeam 70 wall-sun
    python3 make_cattery_wall.py <work>        # Pillow, ffmpeg
(record_cattery.js needs the local Worker on :8787 with rival cats in its room.)
"""
import os, shutil, subprocess, sys
from PIL import Image
from cliplib import ROOT, ease

WORK = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work")
OUT = os.path.join(ROOT, "play", "wall")
W, H, FPS = 960, 540, 30
BOX = (7, 14, 1070, 852)  # the whole room (its bounds on the 1084 x 870 canvas)
BG = (59, 79, 107)  # the Cattery page's background (#3b4f6b), at the sides
PARTS = [("wall-fight", 30, 180), ("wall-storm", 0, 165), ("wall-sun", 0, 120)]  # (folder, first frame, how many)
FADE = 8
STILLS = [("wall-fight", 70), ("wall-fight", 150), ("wall-storm", 0), ("wall-storm", 120), ("wall-sun", 60)]  # cats-1..5


def frame(folder, n):
    im = Image.open(os.path.join(WORK, folder, "%04d.png" % n)).convert("RGBA").crop(BOX)
    h = H
    w = round(im.width * h / im.height)
    im = im.resize((w, h), Image.LANCZOS)
    out = Image.new("RGBA", (W, H), BG + (255,))
    out.alpha_composite(im, ((W - w) // 2, 0))
    return out.convert("RGB")


def main():
    clips = [[frame(f, a + i) for i in range(n)] for f, a, n in PARTS]
    out = []
    for part in clips:
        if out:
            for k in range(FADE):
                u = ease((k + 1) / (FADE + 1))
                out[len(out) - FADE + k] = Image.blend(out[len(out) - FADE + k], part[0], u)
        out += part
    for k in range(FADE):  # back into the start, so the loop has no seam
        u = ease((k + 1) / (FADE + 1))
        out[len(out) - FADE + k] = Image.blend(out[len(out) - FADE + k], out[0], u)
    d = os.path.join(WORK, "wall-cats-frames")
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    for i, im in enumerate(out):
        im.save(os.path.join(d, "%04d.png" % i))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", os.path.join(d, "%04d.png"), "-c:v", "libx264", "-profile:v", "high",
                    "-preset", "veryslow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", os.path.join(OUT, "cats.mp4")], check=True)
    out[45].save(os.path.join(OUT, "cats.jpg"), quality=86)  # the poster: the fight under way
    for i, (f, n) in enumerate(STILLS):
        frame(f, n).resize((640, 360), Image.LANCZOS).save(os.path.join(OUT, "cats-%d.jpg" % (i + 1)), quality=86)
    print("cats.mp4: %d frames, %.1f s, %d KB" % (len(out), len(out) / FPS, os.path.getsize(os.path.join(OUT, "cats.mp4")) // 1024))


if __name__ == "__main__":
    main()
