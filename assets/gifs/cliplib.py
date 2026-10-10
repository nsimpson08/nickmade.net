"""Shared bits for the home page's tile videos (make_*_clip.py): 960x600 frames at 30 fps, drawn with Pillow,
encoded to <name>.mp4 (H.264, muted, looping) plus <name>.jpg, the poster shown before it plays."""
import os, shutil, subprocess, urllib.request
from PIL import Image, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
W, H, FPS = 960, 600, 30
FONTS = {  # the site's fonts (Google Fonts, OFL), plus a handwriting one for Music's postcard
    "Unbounded.ttf": "https://github.com/google/fonts/raw/main/ofl/unbounded/Unbounded%5Bwght%5D.ttf",
    "SpaceGrotesk.ttf": "https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf",
    "HomemadeApple.ttf": "https://github.com/google/fonts/raw/main/apache/homemadeapple/HomemadeApple-Regular.ttf",
}


def workdir(path):
    os.makedirs(path, exist_ok=True)
    for name, url in FONTS.items():
        if not os.path.exists(os.path.join(path, name)):
            urllib.request.urlretrieve(url, os.path.join(path, name))
    return path


_fonts = {}
def font(work, name, size, weight=None):
    key = (name, size, weight)
    if key not in _fonts:
        f = ImageFont.truetype(os.path.join(work, name), int(size))
        if weight is not None:
            f.set_variation_by_axes([weight])
        _fonts[key] = f
    return _fonts[key]


def ease(u):
    u = min(max(u, 0), 1)
    return u * u * (3 - 2 * u)


class Frames:
    """Collects frames as numbered PNGs, then encodes them."""
    def __init__(self, work, name):
        self.dir = os.path.join(work, name + "-frames")
        self.name = name
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(self.dir)
        self.n = 0

    def add(self, im):
        im.convert("RGB").save(os.path.join(self.dir, "%04d.png" % self.n))
        self.n += 1

    def encode(self, crf, poster_at):
        out = os.path.join(HERE, self.name + ".mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-framerate", str(FPS), "-i", os.path.join(self.dir, "%04d.png"), "-c:v", "libx264",
                        "-profile:v", "high", "-preset", "veryslow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                        "-an", "-y", out], check=True)
        Image.open(os.path.join(self.dir, "%04d.png" % int(poster_at * FPS))).convert("RGB").save(
            os.path.join(HERE, self.name + ".jpg"), quality=82, optimize=True)
        print("%s.mp4: %d frames, %.1f s, %d KB" % (self.name, self.n, self.n / FPS, os.path.getsize(out) // 1024))
