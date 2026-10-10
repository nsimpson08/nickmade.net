#!/usr/bin/env python3
"""The home page's Play tile: play.mp4 + .jpg. Three games, 4 seconds each (Nick asked for even time): Nick's Office (the room's own 320x200 canvas, scaled
3x with hard pixel edges: The Dude, the cat, the SNES and the VW bus say their lines, the room turns, night falls),
then each of the other games from their Play page clips (play/wall/: Nick's Nine's tee shot, Rapture's
title), crossfading, and back round to the start.

    node record_play.js <work folder> && python3 make_play_clip.py <work folder>    # Pillow, ffmpeg
"""
import os, shutil, subprocess, sys
from PIL import Image
from cliplib import ROOT, W, H, FPS, Frames, ease, workdir

WORK = workdir(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "clip-work"))
CLIPS = [("nicks-nine", 3.3, 4.0), ("rapture", 0.2, 4.0)]  # (play/wall/<name>.mp4, start s, length s): 4 s each, like the Office
FADE = 7  # frames of crossfade


def clip(name, start, length):
    d = os.path.join(WORK, "play-" + name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    # 16:10 from the middle of the 16:9 clip
    subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-i", os.path.join(ROOT, "play", "wall", name + ".mp4"), "-t", str(length),
                    "-vf", "fps=%d,crop=ih*16/10:ih,scale=%d:%d:flags=lanczos" % (FPS, W, H), os.path.join(d, "%03d.png")], check=True)
    return [Image.open(os.path.join(d, f)).convert("RGB") for f in sorted(os.listdir(d))]


def main():
    raw = os.path.join(WORK, "play-raw")
    office = [Image.open(os.path.join(raw, f)).convert("RGB").resize((W, H), Image.NEAREST) for f in sorted(os.listdir(raw)) if f.endswith(".png")]
    parts = [office] + [clip(*c) for c in CLIPS]
    out = []
    for part in parts:
        if out:  # crossfade the last frames of what's there into this part's first
            for k in range(FADE):
                u = ease((k + 1) / (FADE + 1))
                out[len(out) - FADE + k] = Image.blend(out[len(out) - FADE + k], part[0], u)
        out += part
    for k in range(FADE):  # and back into the Office at the end, so the loop has no seam
        u = ease((k + 1) / (FADE + 1))
        out[len(out) - FADE + k] = Image.blend(out[len(out) - FADE + k], out[0], u)
    frames = Frames(WORK, "play")
    for im in out:
        frames.add(im)
    frames.encode(crf=30, poster_at=0.9)  # the Office, The Dude saying his line


if __name__ == "__main__":
    main()
