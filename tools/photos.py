#!/usr/bin/env python3
"""Prepare photos for the Photography page.

Drop your files (JPEG, PNG, HEIC, TIFF) into photography/originals/, then run:

    python3 tools/photos.py

For each photo this writes:
  photography/full/<name>.jpg      full resolution, with EXIF/GPS/XMP metadata removed
  photography/sizes/<name>-<w>.jpg smaller copies the page loads first (800, 1600, 2400, 3600 wide)
and regenerates photography/photos.js, newest first by capture date.

photography/originals/ is never published (it's in .gitignore). Uses macOS's built-in `sips`;
nothing to install. Already-processed photos are skipped unless the original changed.
"""
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
from datetime import datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "photography")
ORIGINALS = os.path.join(ROOT, "originals")
FULL = os.path.join(ROOT, "full")
SIZES = os.path.join(ROOT, "sizes")
WIDTHS = [800, 1600, 2400, 3600]
EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".tif", ".tiff"}


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", os.path.splitext(name)[0].lower()).strip("-")
    return s or "photo"


def sips(*args):
    subprocess.run(["sips", *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def dims(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                         check=True, capture_output=True, text=True).stdout
    w = int(re.search(r"pixelWidth: (\d+)", out).group(1))
    h = int(re.search(r"pixelHeight: (\d+)", out).group(1))
    return w, h


# ---- Minimal EXIF reading (orientation and capture date) ----

def read_exif(data):
    """Return (orientation, 'YYYY:MM:DD HH:MM:SS' or None) from JPEG bytes."""
    i = 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        if marker in (0xD9, 0xDA):
            break
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        seg = data[i + 4:i + 2 + length]
        if marker == 0xE1 and seg[:6] == b"Exif\x00\x00":
            return parse_tiff(seg[6:])
        i += 2 + length
    return 1, None


def parse_tiff(t):
    try:
        e = "<" if t[:2] == b"II" else ">"
        def u16(o): return struct.unpack(e + "H", t[o:o + 2])[0]
        def u32(o): return struct.unpack(e + "I", t[o:o + 4])[0]
        def entries(off):
            for k in range(u16(off)):
                p = off + 2 + k * 12
                yield u16(p), u16(p + 2), u32(p + 4), p + 8
        orientation, date, exif_ifd = 1, None, None
        for tag, typ, count, vp in entries(u32(4)):
            if tag == 0x0112:
                orientation = u16(vp)
            elif tag == 0x8769:
                exif_ifd = u32(vp)
        if exif_ifd:
            for tag, typ, count, vp in entries(exif_ifd):
                if tag == 0x9003 and count >= 19:
                    date = t[u32(vp):u32(vp) + 19].decode("ascii", "ignore")
        return orientation, date
    except Exception:
        return 1, None


def strip_metadata(data):
    """Drop EXIF/XMP (APP1), IPTC (APP13) and comments from a JPEG; keep the ICC color profile."""
    out = bytearray(data[:2])
    i = 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        if marker == 0xDA:
            break
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker not in (0xE1, 0xED, 0xFE):
            out += data[i:i + 2 + length]
        i += 2 + length
    out += data[i:]
    return bytes(out)


# sips rotation (clockwise degrees) and flip for each EXIF orientation value
ORIENT = {2: (0, "horizontal"), 3: (180, None), 4: (0, "vertical"),
          5: (90, "horizontal"), 6: (90, None), 7: (270, "horizontal"), 8: (270, None)}


def make_full(src, dest):
    """Write a browser-viewable, upright, metadata-free full-resolution JPEG. Returns capture date."""
    ext = os.path.splitext(src)[1].lower()
    with tempfile.TemporaryDirectory() as tmp:
        work = src
        if ext not in (".jpg", ".jpeg"):
            work = os.path.join(tmp, "converted.jpg")
            sips("-s", "format", "jpeg", "-s", "formatOptions", "best", src, "--out", work)
        with open(work, "rb") as f:
            data = f.read()
        # sips keeps EXIF when converting, so HEIC/TIFF orientation and dates come through too
        orientation, date = read_exif(data)
        if orientation in ORIENT:
            deg, flip = ORIENT[orientation]
            rotated = os.path.join(tmp, "rotated.jpg")
            args = []
            if flip:
                args += ["-f", flip]
            if deg:
                args += ["-r", str(deg)]
            sips(*args, "-s", "formatOptions", "best", work, "--out", rotated)
            with open(rotated, "rb") as f:
                data = f.read()
        with open(dest, "wb") as f:
            f.write(strip_metadata(data))
    return date


def main():
    for d in (ORIGINALS, FULL, SIZES):
        os.makedirs(d, exist_ok=True)

    manifest_path = os.path.join(ROOT, ".manifest.json")
    try:
        with open(manifest_path) as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        manifest = {}

    names = sorted(n for n in os.listdir(ORIGINALS) if os.path.splitext(n)[1].lower() in EXTS)
    if not names:
        print("No photos in photography/originals/. Add some and run again.")

    photos, used = [], set()
    for name in names:
        src = os.path.join(ORIGINALS, name)
        base = slug(name)
        while base in used:
            base += "-2"
        used.add(base)
        full = os.path.join(FULL, base + ".jpg")
        mtime = os.path.getmtime(src)
        entry = manifest.get(name)

        if not entry or entry.get("mtime") != mtime or not os.path.exists(full):
            print("Processing", name)
            date = make_full(src, full)
            if date:
                try:
                    date = datetime.strptime(date, "%Y:%m:%d %H:%M:%S").isoformat()
                except ValueError:
                    date = None
            w, h = dims(full)
            sizes = []
            for width in WIDTHS:
                if width >= w:
                    break
                out = os.path.join(SIZES, "%s-%d.jpg" % (base, width))
                sips("--resampleWidth", str(width), "-s", "formatOptions", "82", full, "--out", out)
                with open(out, "rb") as f:
                    stripped = strip_metadata(f.read())
                with open(out, "wb") as f:
                    f.write(stripped)
                sizes.append({"w": width, "src": "sizes/%s-%d.jpg" % (base, width)})
            entry = {
                "mtime": mtime,
                "base": base,
                "w": w,
                "h": h,
                "bytes": os.path.getsize(full),
                "date": date or datetime.fromtimestamp(mtime).isoformat(),
                "sizes": sizes,
            }
            manifest[name] = entry
        else:
            print("Up to date", name)

        photos.append({
            "src": "full/%s.jpg" % entry["base"],
            "w": entry["w"],
            "h": entry["h"],
            "bytes": entry["bytes"],
            "date": entry["date"],
            "sizes": entry["sizes"],
        })

    # Remove outputs for photos that were deleted from originals/
    keep = {os.path.basename(p["src"]) for p in photos}
    keep_sizes = {os.path.basename(s["src"]) for p in photos for s in p["sizes"]}
    for f in os.listdir(FULL):
        if f.endswith(".jpg") and f not in keep:
            os.remove(os.path.join(FULL, f))
            print("Removed", "full/" + f)
    for f in os.listdir(SIZES):
        if f.endswith(".jpg") and f not in keep_sizes:
            os.remove(os.path.join(SIZES, f))
    manifest = {n: e for n, e in manifest.items() if n in names}

    photos.sort(key=lambda p: p["date"], reverse=True)
    with open(os.path.join(ROOT, "photos.js"), "w") as f:
        f.write("// Generated by tools/photos.py. Don't edit by hand; re-run the script instead.\n")
        f.write("window.PHOTOS = " + json.dumps(photos, indent=2) + ";\n")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    total = sum(p["bytes"] for p in photos)
    print("\n%d photo(s), %.1f MB full resolution. photography/photos.js updated." % (len(photos), total / 1e6))
    big = [p["src"] for p in photos if p["bytes"] > 50e6]
    if big:
        print("Warning: over 50 MB (GitHub warns at 50 MB, rejects over 100 MB):", ", ".join(big))


if __name__ == "__main__":
    sys.exit(main())
