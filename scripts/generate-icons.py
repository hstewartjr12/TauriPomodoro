"""Regenerate FocusForge's app icons using only the Python standard library."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = (41, 75, 53)
FOREGROUND = (237, 244, 228)
SEGMENTS = [(32, 11, 32, 18), (32, 46, 32, 53), (11, 32, 18, 32),
            (46, 32, 53, 32), (17, 17, 22, 22), (42, 42, 47, 47),
            (17, 47, 22, 42), (42, 22, 47, 17)]


def segment_distance(x, y, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - ax - t * dx, y - ay - t * dy)


def chunk(name, content):
    return struct.pack(">I", len(content)) + name + content + struct.pack(">I", zlib.crc32(name + content))


def png(size, opaque=False):
    rows = bytearray()
    scale = 64 / size
    for py in range(size):
        rows.append(0)
        for px in range(size):
            x, y = (px + .5) * scale, (py + .5) * scale
            qx, qy = abs(x - 32) - 15, abs(y - 32) - 15
            rounded = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - 17
            alpha = max(0, min(1, .5 - rounded / scale))
            distance = abs(math.hypot(x - 32, y - 32) - 9)
            if 9 < x < 55 and 9 < y < 55:
                distance = min(distance, *(segment_distance(x, y, *segment) for segment in SEGMENTS))
            ink = max(0, min(1, .5 + (1.5 - distance) / scale))
            rows.extend(round(a + ink * (b - a)) for a, b in zip(BACKGROUND, FOREGROUND))
            if not opaque:
                rows.append(round(alpha * 255))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2 if opaque else 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    icons = ROOT / "src-tauri/icons"
    files = list(icons.glob("*.png")) + list((ROOT / "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset").glob("*.png"))
    cache = {}
    mobile_cache = {}
    for file in files:
        size = struct.unpack(">I", file.read_bytes()[16:20])[0]
        current = mobile_cache if file.parent.name == "AppIcon.appiconset" else cache
        if size not in current:
            current[size] = png(size, opaque=current is mobile_cache)
        file.write_bytes(current[size])
    sizes = {"icp4": 16, "icp5": 32, "icp6": 64, "ic07": 128, "ic08": 256, "ic09": 512, "ic10": 1024}
    body = b""
    for name, size in sizes.items():
        if size not in cache:
            cache[size] = png(size)
        payload = cache[size]
        body += name.encode() + struct.pack(">I", len(payload) + 8) + payload
    (icons / "icon.icns").write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)
    payload = cache[256]
    (icons / "icon.ico").write_bytes(struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(payload), 22) + payload)
    print(f"Generated {len(files)} PNGs, an ICNS, and an ICO from FocusForge's vector mark.")
