#!/usr/bin/env python3
"""Trim an explode sequence to one box, and lay it out as a contact sheet.

    ../backend/.venv/bin/python scripts/crop-explode.py

The frames come off the page the size of the whole chapter, mostly empty, and
the parts drift as the camera moves. Cropping each frame to its own contents
would make them jump; this takes the box that holds every frame's contents and
cuts them all to that, so the sequence plays as one move.
"""

import json
import pathlib
import sys

from PIL import Image

OUT = pathlib.Path(__file__).resolve().parents[2] / "docs" / "img" / "explode"
PAD = 48  # room around the parts, in captured pixels


def main() -> int:
    frames = sorted(OUT.glob("explode-*.png"))
    if not frames:
        print(f"no frames in {OUT}; run scripts/explode.mjs first", file=sys.stderr)
        return 1

    # The union of what every frame draws. The contact shadow fades to almost
    # nothing over most of the frame, so "not fully clear" would be the whole
    # picture: only count a pixel once the shadow is actually visible.
    box = None
    for path in frames:
        with Image.open(path) as im:
            here = im.convert("RGBA").getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
        if here is None:
            continue
        box = here if box is None else (min(box[0], here[0]), min(box[1], here[1]), max(box[2], here[2]), max(box[3], here[3]))
    if box is None:
        print("every frame is empty; the capture did not render", file=sys.stderr)
        return 1

    with Image.open(frames[0]) as im:
        w, h = im.size
    box = (max(0, box[0] - PAD), max(0, box[1] - PAD), min(w, box[2] + PAD), min(h, box[3] + PAD))

    thumbs = []
    for path in frames:
        with Image.open(path) as im:
            cut = im.convert("RGBA").crop(box)
        cut.save(path)
        thumbs.append(cut)
    print(f"cropped {len(frames)} frames to {cut.width}x{cut.height}")

    # One sheet of the whole move, to look at without opening every file.
    cols = 6
    rows = (len(thumbs) + cols - 1) // cols
    tw = 360
    th = round(tw * thumbs[0].height / thumbs[0].width)
    sheet = Image.new("RGB", (cols * tw, rows * th), (8, 9, 10))
    for i, t in enumerate(thumbs):
        small = t.resize((tw, th), Image.LANCZOS)
        sheet.paste(small, ((i % cols) * tw, (i // cols) * th), small)  # alpha as the mask
    sheet.save(OUT / "contact-sheet.jpg", quality=92)

    meta = OUT / "frames.json"
    if meta.exists():
        data = json.loads(meta.read_text())
        data["size"] = [cut.width, cut.height]
        data["background"] = "transparent"
        meta.write_text(json.dumps(data, indent=2))
    print(f"contact sheet: {OUT / 'contact-sheet.jpg'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
