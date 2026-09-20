#!/usr/bin/env python3
"""Build the two scoped fonts used for Kazon's visible name treatment."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from fontTools import subset
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


SOURCE_COMMIT = "cfcb4f7af0e52c25e8df2a2431814c8e5fe2e155"
FONT_CASES = (
    {
        "source": "fonts/static/ttf/Newsreader16pt-Regular.ttf",
        "sha256": "0636887c9f72f77ce188f0b31029be58e65adae5a47e6d2887ad5020c2c75036",
        "family": "Kazon Name Text",
        "output": "kazon-name-text.woff2",
    },
    {
        "source": "fonts/static/ttf/Newsreader72pt-Regular.ttf",
        "sha256": "fda3ed5d7dc98387a94eed6a9f1384c9d5929ff1ad6d4851e223ffe119fe95c0",
        "family": "Kazon Name Display",
        "output": "kazon-name-display.woff2",
    },
)
NAME_CHARACTERS = "Kazon Wils"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_mark(font: TTFont) -> None:
    glyph_set = font.getGlyphSet()
    z_glyph = font["glyf"]["z"]
    dash_glyph = font["glyf"]["endash"]
    z_center = (z_glyph.xMin + z_glyph.xMax) / 2
    dash_center = (dash_glyph.xMin + dash_glyph.xMax) / 2
    scale = 0.5
    gap = 96
    translate_x = z_center - dash_center * scale
    translate_y = z_glyph.yMax + gap - dash_glyph.yMin * scale

    pen = TTGlyphPen(glyph_set)
    glyph_set["z"].draw(pen)
    transformed_pen = TransformPen(
        pen,
        (scale, 0, 0, scale, translate_x, translate_y),
    )
    glyph_set["endash"].draw(transformed_pen)
    font["glyf"]["z"] = pen.glyph()


def rename_font(font: TTFont, family: str) -> None:
    postscript_name = family.replace(" ", "") + "-Regular"
    replacements = {
        1: family,
        2: "Regular",
        3: f"{family} Regular {SOURCE_COMMIT[:12]}",
        4: family,
        6: postscript_name,
        16: family,
        17: "Regular",
    }
    for record in font["name"].names:
        replacement = replacements.get(record.nameID)
        if replacement is not None:
            record.string = replacement.encode(record.getEncoding())


def subset_for_name(font: TTFont) -> None:
    options = subset.Options()
    options.glyph_names = True
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
    options.name_languages = [0x409]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes={ord(character) for character in NAME_CHARACTERS})
    subsetter.subset(font)


def build(source_root: Path, output_root: Path) -> None:
    output_root.mkdir(parents=True, exist_ok=True)
    for case in FONT_CASES:
        source_path = source_root / case["source"]
        actual_hash = sha256(source_path)
        if actual_hash != case["sha256"]:
            raise SystemExit(
                f"Unexpected source font hash for {source_path}: {actual_hash}"
            )

        font = TTFont(source_path, recalcBBoxes=True, recalcTimestamp=False)
        add_mark(font)
        rename_font(font, case["family"])
        subset_for_name(font)
        font.flavor = "woff2"
        font.save(output_root / case["output"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "source_root",
        type=Path,
        help=f"Newsreader source checkout at commit {SOURCE_COMMIT}",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("public/fonts"),
    )
    args = parser.parse_args()
    build(args.source_root, args.output_root)


if __name__ == "__main__":
    main()
