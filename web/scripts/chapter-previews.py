#!/usr/bin/env python3
"""Turn each chapter's frames into something you can look at.

    ../backend/.venv/bin/python scripts/chapter-previews.py

For every chapter captured by scripts/chapters.mjs this writes:

    <chapter>/scene.gif     the composition playing, looping
    <chapter>/object.gif    the object alone, on its chapter's ground
    <chapter>/sheet.jpg     every frame at once

The object frames keep their alpha in the PNGs; a GIF cannot hold soft edges,
so the preview is laid over the ground the chapter really uses and the PNGs
stay the thing to animate from.
"""

import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2] / "docs" / "img" / "landing"
GROUND = {"dark": (8, 9, 10), "light": (245, 245, 247)}
WIDE = 900  # preview width; the PNGs stay full size


def load(paths: list[pathlib.Path]) -> list[Image.Image]:
    return [Image.open(p).convert("RGBA") for p in paths]


def on_ground(frames: list[Image.Image], theme: str) -> list[Image.Image]:
    """Alpha onto the chapter's own ground, so soft shadows read correctly."""
    out = []
    for f in frames:
        flat = Image.new("RGB", f.size, GROUND.get(theme, GROUND["dark"]))
        flat.paste(f, (0, 0), f)
        out.append(flat)
    return out


def scaled(frames: list[Image.Image], width: int) -> list[Image.Image]:
    h = round(width * frames[0].height / frames[0].width)
    return [f.resize((width, h), Image.LANCZOS) for f in frames]


def gif(frames: list[Image.Image], path: pathlib.Path) -> None:
    # Back and forth, so a loop of a scroll does not snap back to the start.
    loop = frames + frames[-2:0:-1]
    loop[0].save(path, save_all=True, append_images=loop[1:], duration=90, loop=0, optimize=True)


def sheet(frames: list[Image.Image], path: pathlib.Path, theme: str) -> None:
    cols = 4
    rows = (len(frames) + cols - 1) // cols
    tw = 460
    th = round(tw * frames[0].height / frames[0].width)
    canvas = Image.new("RGB", (cols * tw, rows * th), GROUND.get(theme, GROUND["dark"]))
    for i, f in enumerate(scaled(frames, tw)):
        canvas.paste(f, ((i % cols) * tw, (i // cols) * th))
    canvas.save(path, quality=90)


def main() -> int:
    meta = ROOT / "manifest.json"
    if not meta.exists():
        print(f"no manifest in {ROOT}; run scripts/chapters.mjs first", file=sys.stderr)
        return 1
    data = json.loads(meta.read_text())

    for chapter in data["chapters"]:
        d = ROOT / chapter["dir"]
        theme = chapter.get("theme", "dark")

        scenes = load(sorted(d.glob("scene-*.png")))
        if scenes:
            small = scaled(scenes, WIDE)
            gif([s.convert("RGB") for s in small], d / "scene.gif")
            sheet(scenes, d / "sheet.jpg", theme)

        objects = sorted(d.glob("object-*.png"))
        if objects:
            gif(scaled(on_ground(load(objects), theme), WIDE), d / "object.gif")

        print(f"  {chapter['label']}: {len(scenes)} frames{', object' if objects else ''}")

    print(f"\npreviews in {ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
