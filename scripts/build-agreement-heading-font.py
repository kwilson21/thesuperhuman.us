#!/usr/bin/env python3
"""Build the Libron TTF that signed agreement PDFs embed for their headings.

pdf-lib embeds TrueType, not WOFF2, so this decompresses the pinned Libron v0.25
Regular file without changing its glyphs, and writes the base64 copy the Worker
bundles (src/lib/agreement-pdf.ts). Libron's OFL text sits beside it.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import shutil
from pathlib import Path

from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
# The same pinned source as scripts/build-personal-name-fonts.py.
SOURCE_PATH = ROOT / "public/fonts/libron-v0.25/Libron-Regular.woff2"
SOURCE_SHA256 = "b25eda95d6b81c4977217314a088f446448a07126738511e8930a8d3372a5253"
LICENSE_PATH = ROOT / "public/fonts/OFL-Libron.txt"
# Every character of the PDF's fixed headings. Template headings ("1 Parties and
# scope", "Milestone 2") use letters and digits; a heading with a character the
# font lacks falls back to Inter in the PDF.
HEADING_CHARACTERS = (
    "Master Services Agreement Statement of Work Signing certificate "
    "Client signature Contractor signature Electronic consent and intent "
    "Documents Milestone "
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    " .,:;()&/-'’“”·–"
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(output_root: Path) -> None:
    actual = sha256(SOURCE_PATH)
    if actual != SOURCE_SHA256:
        raise SystemExit(f"Unexpected Libron v0.25 source font hash for {SOURCE_PATH}: {actual}")
    font = TTFont(SOURCE_PATH, recalcTimestamp=False)
    cmap = font.getBestCmap()
    missing = sorted({c for c in HEADING_CHARACTERS if ord(c) not in cmap})
    if missing:
        raise SystemExit(f"Libron lacks heading characters: {''.join(missing)!r}")
    if font["OS/2"].fsType & 0x2:
        raise SystemExit("Libron does not allow embedding.")
    font.flavor = None
    output_root.mkdir(parents=True, exist_ok=True)
    ttf = output_root / "Libron-400.ttf"
    font.save(ttf)
    (output_root / "Libron-400.base64").write_text(base64.b64encode(ttf.read_bytes()).decode("ascii") + "\n")
    shutil.copyfile(LICENSE_PATH, output_root / "Libron-OFL.txt")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", type=Path, default=ROOT / "src/assets/agreement-fonts")
    build(parser.parse_args().output_root)


if __name__ == "__main__":
    main()
