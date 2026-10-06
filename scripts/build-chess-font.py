#!/usr/bin/env python3
"""Build the tiny chess-label webfont with fontTools and Brotli installed.

Example:
  python3 scripts/build-chess-font.py \
    /usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc --font-index 2

Use the Simplified Chinese face of Noto Serif CJK, distributed under OFL 1.1.
The font's upstream copyright and license metadata remain in the subset.
"""

import argparse
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


GLYPHS = "车馬马相象仕士帅将炮兵卒五"
FAMILY = "Xiangqi Chess Glyphs"
POSTSCRIPT_NAME = "XiangqiChessGlyphs-Regular"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Noto Serif CJK source OTF or TTC")
    parser.add_argument("--font-index", type=int, default=2, help="SC face index in a TTC (default: 2)")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets/chess-glyphs.woff2",
    )
    args = parser.parse_args()

    font = TTFont(args.source, fontNumber=args.font_index, recalcTimestamp=False)
    missing = set(map(ord, GLYPHS)) - set(font.getBestCmap())
    if missing:
        parser.error(f"Source font is missing: {''.join(map(chr, sorted(missing)))}")

    options = subset.Options()
    options.layout_features = []
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.recalc_timestamp = False
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=GLYPHS)
    subsetter.subset(font)

    # Give the modified font its own identity, including localized name records.
    names = {
        1: FAMILY,
        2: "Regular",
        3: f"{POSTSCRIPT_NAME};chess-subset-1",
        4: f"{FAMILY} Regular",
        6: POSTSCRIPT_NAME,
        16: FAMILY,
        17: "Regular",
        18: f"{FAMILY} Regular",
        21: FAMILY,
        22: "Regular",
    }
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = [POSTSCRIPT_NAME]
        for top_dict in cff.topDictIndex:
            top_dict.FamilyName = FAMILY
            top_dict.FullName = f"{FAMILY} Regular"

    args.output.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(args.output)
    font.close()

    with TTFont(args.output) as result:
        assert set(map(ord, GLYPHS)) <= set(result.getBestCmap()), "Incomplete chess-label cmap"
    print(f"Built {args.output}: {args.output.stat().st_size} bytes; glyphs {GLYPHS}")


if __name__ == "__main__":
    main()
