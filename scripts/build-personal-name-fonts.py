#!/usr/bin/env python3
"""Build font-native Libron variants for Kazon's visible name treatment."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from fontTools import subset
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "public/fonts/libron-v0.25/Libron-Regular.woff2"
SOURCE_SHA256 = "b25eda95d6b81c4977217314a088f446448a07126738511e8930a8d3372a5253"
FONT_CASES = (
    {
        "family": "Kazon Name Text",
        "output": "kazon-name-text.woff2",
        "mark_scale_y": 0.3609,
    },
    {
        "family": "Kazon Name Display",
        "output": "kazon-name-display.woff2",
        "mark_scale_y": 0.2556,
    },
)
NAME_CHARACTERS = "Kazon Wils"
MARK_SCALE_X = 0.5256
MARK_GAP = 96


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_mark(font: TTFont, scale_y: float) -> None:
    glyph_set = font.getGlyphSet()
    z_glyph = font["glyf"]["z"]
    dash_glyph = font["glyf"]["endash"]
    z_center = (z_glyph.xMin + z_glyph.xMax) / 2
    dash_center = (dash_glyph.xMin + dash_glyph.xMax) / 2
    # Libron's en dash is thicker than the former Newsreader source. Keep the
    # same centered, font-native construction while matching the existing
    # text and display mark thicknesses.
    translate_x = z_center - dash_center * MARK_SCALE_X
    translate_y = z_glyph.yMax + MARK_GAP - dash_glyph.yMin * scale_y

    pen = TTGlyphPen(glyph_set)
    glyph_set["z"].draw(pen)
    transformed_pen = TransformPen(
        pen,
        (MARK_SCALE_X, 0, 0, scale_y, translate_x, translate_y),
    )
    glyph_set["endash"].draw(transformed_pen)
    font["glyf"]["z"] = pen.glyph()


def rename_font(font: TTFont, family: str) -> None:
    postscript_name = family.replace(" ", "") + "-Regular"
    replacements = {
        1: family,
        2: "Regular",
        3: f"{family} Regular {SOURCE_SHA256[:12]}",
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


def build(output_root: Path) -> None:
    output_root.mkdir(parents=True, exist_ok=True)
    actual_hash = sha256(SOURCE_PATH)
    if actual_hash != SOURCE_SHA256:
        raise SystemExit(
            f"Unexpected Libron v0.25 source font hash for {SOURCE_PATH}: {actual_hash}"
        )

    for case in FONT_CASES:
        font = TTFont(SOURCE_PATH, recalcBBoxes=True, recalcTimestamp=False)
        add_mark(font, case["mark_scale_y"])
        rename_font(font, case["family"])
        subset_for_name(font)
        font.flavor = "woff2"
        font.save(output_root / case["output"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-root",
        type=Path,
        default=ROOT / "public/fonts",
    )
    args = parser.parse_args()
    build(args.output_root)


if __name__ == "__main__":
    main()
