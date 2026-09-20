from pathlib import Path

from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[2]
FONT_CASES = (
    (ROOT / "public/fonts/kazon-name-text.woff2", "Kazon Name Text"),
    (ROOT / "public/fonts/kazon-name-display.woff2", "Kazon Name Display"),
)
REQUIRED_CHARACTERS = set("Kazon Wils")


def contour_bounds(font: TTFont, glyph_name: str) -> list[tuple[int, int, int, int]]:
    glyph = font["glyf"][glyph_name]
    coordinates, end_points, _ = glyph.getCoordinates(font["glyf"])
    bounds = []
    start = 0
    for end in end_points:
        contour = coordinates[start : end + 1]
        xs = [point[0] for point in contour]
        ys = [point[1] for point in contour]
        bounds.append((min(xs), min(ys), max(xs), max(ys)))
        start = end + 1
    return bounds


def test_font(path: Path, expected_family: str) -> None:
    assert path.exists(), f"missing generated font: {path}"
    font = TTFont(path)
    cmap = font.getBestCmap()
    assert REQUIRED_CHARACTERS <= {chr(codepoint) for codepoint in cmap}
    assert cmap[ord("z")] == "z"
    assert font["name"].getDebugName(1) == expected_family

    x_height = font["OS/2"].sxHeight
    contours = contour_bounds(font, "z")
    letter_contours = [bounds for bounds in contours if bounds[1] <= x_height]
    mark_contours = [bounds for bounds in contours if bounds[1] > x_height]
    assert len(mark_contours) == 1, f"expected one font-native mark in {path.name}"

    letter_left = min(bounds[0] for bounds in letter_contours)
    letter_right = max(bounds[2] for bounds in letter_contours)
    letter_top = max(bounds[3] for bounds in letter_contours)
    mark_left, mark_bottom, mark_right, mark_top = mark_contours[0]
    units_per_em = font["head"].unitsPerEm

    assert abs((mark_left + mark_right) - (letter_left + letter_right)) <= 8
    assert units_per_em * 0.16 <= mark_right - mark_left <= units_per_em * 0.25
    assert units_per_em * 0.015 <= mark_top - mark_bottom <= units_per_em * 0.03
    assert units_per_em * 0.035 <= mark_bottom - letter_top <= units_per_em * 0.065


for font_path, family_name in FONT_CASES:
    test_font(font_path, family_name)

print("personal name fonts: PASS")
