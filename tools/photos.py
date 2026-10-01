#!/usr/bin/env python3
"""Prepare photos for the Photography page.

Drop your files (JPEG, PNG, HEIC, TIFF) into a section folder, photography/originals/<film|pixel|cats>/
(the sections are listed in photography/config.js), then run:

    python3 tools/photos.py

For each photo this writes:
  photography/full/<name>.jpg      full resolution, with EXIF/GPS/XMP metadata (and phones' hidden extra images) removed
  photography/sizes/<name>-<w>.jpg smaller copies the page loads first (800, 1600, 2400, 3600 wide)
and regenerates photography/photos.js, newest first by capture date, each photo tagged with its section.

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
    """Drop EXIF/XMP (APP1), IPTC (APP13), maker data (APP3-APP15 except APP14), MPF and comments from a JPEG, and
    anything after the image's end marker; keep the ICC color profile (the APP2 segments that aren't MPF).
    Then add back a fresh EXIF block with only the artist and copyright notice (add_copyright).
    Phones (iPhone, Pixel) append extra images after the main one (depth maps, HDR gain maps, Motion Photo
    video), each able to carry its own EXIF and GPS; cutting at the end marker drops them all."""
    out = bytearray(data[:2])
    i = 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        if marker == 0xDA:
            break
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        seg = data[i + 4:i + 2 + length]
        # (APP14 "Adobe", 0xEE, stays: it says how to decode the colors and holds nothing personal)
        drop = (marker in (0xE1, 0xED, 0xFE) or (0xE3 <= marker <= 0xEF and marker != 0xEE)
                or (marker == 0xE2 and (seg[:4] == b"MPF\x00" or seg[:4] == b"urn:")))  # urn: = Ultra HDR gain map info
        if not drop:
            out += data[i:i + 2 + length]
        i += 2 + length
    # The scan data escapes 0xFF bytes (FF 00) and its restart markers are FF D0-D7, so the first FF D9 is the end
    end = data.find(b"\xff\xd9", i)
    out += data[i:end + 2] if end >= 0 else data[i:]
    return add_copyright(bytes(out))


# The only metadata the site's copies carry: who made the photo and the copyright notice (EXIF Artist + Copyright).
ARTIST = "Nick Simpson"
COPYRIGHT = "Copyright Nick Simpson. All rights reserved."


def add_copyright(jpeg):
    """Insert a minimal EXIF block (APP1) holding only ARTIST and COPYRIGHT, after the JFIF header if there is one."""
    def ascii_value(s):
        return s.encode("ascii") + b"\x00"
    values = [(0x013B, ascii_value(ARTIST)), (0x8298, ascii_value(COPYRIGHT))]  # tags must be in ascending order
    ifd_size = 2 + 12 * len(values) + 4
    data_at = 8 + ifd_size
    entries, blob = b"", b""
    for tag, v in values:
        entries += struct.pack(">HHI", tag, 2, len(v)) + struct.pack(">I", data_at + len(blob))
        blob += v + (b"\x00" if len(v) % 2 else b"")  # keep offsets even
    tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + struct.pack(">H", len(values)) + entries + b"\x00\x00\x00\x00" + blob
    payload = b"Exif\x00\x00" + tiff
    seg = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
    at = 2
    if jpeg[2:4] == b"\xff\xe0":  # keep JFIF (APP0) first
        at = 4 + struct.unpack(">H", jpeg[4:6])[0]
    return jpeg[:at] + seg + jpeg[at:]


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


def read_config():
    """The section folders (in page order) and fullUrl from photography/config.js."""
    with open(os.path.join(ROOT, "config.js")) as f:
        text = f.read()
    folders = re.findall(r'folder:\s*"([^"]+)"', text)
    if not folders:
        sys.exit("No sections in photography/config.js (each needs folder: \"name\").")
    full_url = (re.search(r'fullUrl:\s*"([^"]*)"', text) or [None, ""])[1]
    return folders, full_url


# ---- Full-resolution copies on Cloudflare R2 (they're too big for GitHub Pages' 1 GB limit) ----

BUCKET = "nickmade-photos"
WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "worker")  # where wrangler is installed


def wrangler(*args):
    return subprocess.run(["npx", "wrangler", *args], cwd=WORKER, capture_output=True, text=True)


def sync_r2(photos):
    """Upload new or changed full-size copies to R2 and delete ones no longer on the page.
    photography/.uploaded.json remembers what's there (by file size and time), so reruns skip it."""
    from concurrent.futures import ThreadPoolExecutor
    path = os.path.join(ROOT, ".uploaded.json")
    try:
        with open(path) as f:
            uploaded = json.load(f)
    except (OSError, ValueError):
        uploaded = {}

    def stamp(name):
        st = os.stat(os.path.join(FULL, name))
        return "%d-%d" % (st.st_size, st.st_mtime)

    names = [p["key"] for p in photos]
    todo = [n for n in names if uploaded.get(n) != stamp(n)]
    gone = [n for n in uploaded if n not in names]

    def put(name):
        r = wrangler("r2", "object", "put", BUCKET + "/" + name, "--file", os.path.join(FULL, name),
                     "--content-type", "image/jpeg", "--cache-control", "public, max-age=86400")
        return name, r.returncode == 0, (r.stderr or r.stdout).strip().splitlines()[-1:]

    failed = []
    if todo:
        print("\nUploading %d full-size photo(s) to R2..." % len(todo))
        with ThreadPoolExecutor(4) as pool:
            for name, ok, err in pool.map(put, todo):
                if ok:
                    uploaded[name] = stamp(name)
                    with open(path, "w") as f:  # saved as it goes, so an interrupted run resumes
                        json.dump(uploaded, f, indent=2)
                    print("  uploaded", name)
                else:
                    failed.append(name)
                    print("  FAILED", name, *err)
    for name in gone:
        r = wrangler("r2", "object", "delete", BUCKET + "/" + name)
        if r.returncode == 0:
            uploaded.pop(name)
            print("  removed from R2", name)
    with open(path, "w") as f:
        json.dump(uploaded, f, indent=2)
    if failed:
        print("\n%d upload(s) failed; their full-resolution links won't work until you run this again." % len(failed))
        return 1
    print("R2 is up to date (%d photos)." % len(uploaded))
    return 0


def main():
    folders, full_url = read_config()
    for d in [FULL, SIZES] + [os.path.join(ORIGINALS, s) for s in folders]:
        os.makedirs(d, exist_ok=True)

    # Every photo has to be in a section folder, so it's clear where it goes
    loose = sorted(n for n in os.listdir(ORIGINALS) if os.path.splitext(n)[1].lower() in EXTS)
    unknown = sorted(n for n in os.listdir(ORIGINALS)
                     if os.path.isdir(os.path.join(ORIGINALS, n)) and n not in folders and not n.startswith("."))
    if loose or unknown:
        if loose:
            print("These are loose in photography/originals/; move each into a section folder (%s):\n  %s"
                  % (", ".join(folders), "\n  ".join(loose)))
        if unknown:
            print("These folders aren't sections in photography/config.js: %s" % ", ".join(unknown))
        print("Nothing changed.")
        return 1

    manifest_path = os.path.join(ROOT, ".manifest.json")
    try:
        with open(manifest_path) as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        manifest = {}

    # "<folder>/<file name>", section by section
    names = [s + "/" + n for s in folders for n in sorted(os.listdir(os.path.join(ORIGINALS, s)))
             if os.path.splitext(n)[1].lower() in EXTS]
    if not names:
        print("No photos yet. Put them in photography/originals/<%s>/ and run again." % "|".join(folders))

    photos, used = [], set()
    for name in names:
        section, file_name = name.split("/", 1)
        src = os.path.join(ORIGINALS, name)
        base = slug(file_name)
        while base in used:
            base += "-2"
        used.add(base)
        full = os.path.join(FULL, base + ".jpg")
        mtime = os.path.getmtime(src)
        entry = manifest.get(name)

        # (a changed base: a same-named photo in another section now has this name, so it moves to "-2")
        if not entry or entry.get("mtime") != mtime or entry.get("base") != base or not os.path.exists(full):
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
            "section": section,
            # full resolution: on R2 when config.js has a fullUrl, else in photography/full/
            "src": (full_url.rstrip("/") + "/" if full_url else "full/") + entry["base"] + ".jpg",
            "key": entry["base"] + ".jpg",
            "w": entry["w"],
            "h": entry["h"],
            "bytes": entry["bytes"],
            "date": entry["date"],
            "sizes": entry["sizes"],
        })

    # Remove outputs for photos that were deleted from originals/
    keep = {p["key"] for p in photos}
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
        f.write("window.PHOTOS = " + json.dumps([{k: v for k, v in p.items() if k != "key"} for p in photos],
                                                indent=2) + ";\n")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    total = sum(p["bytes"] for p in photos)
    print("\n%d photo(s), %.1f MB full resolution. photography/photos.js updated." % (len(photos), total / 1e6))
    if full_url:
        return sync_r2(photos)
    big = [p["src"] for p in photos if p["bytes"] > 50e6]
    if big:
        print("Warning: over 50 MB (GitHub warns at 50 MB, rejects over 100 MB):", ", ".join(big))


if __name__ == "__main__":
    sys.exit(main())
