# Libron web fonts

The site uses the official Libron v0.25 webfont release for its primary serif
type. The four original WOFF2 styles are kept in `libron-v0.25/`. Their source
Regular font is pinned by SHA-256 in `scripts/build-personal-name-fonts.py`.

The two Kazon name files are modified, subsetted derivatives of that Regular
font. The existing build pipeline adds a centered en-dash contour directly to
the lowercase `z` outline, then subsets the font to the characters needed for
“Kazon Wilson.” The HTML still contains ordinary Unicode text, so selection,
clipboard content, search and assistive-technology names remain “Kazon” and
“Kazon Wilson.” The text and display variants use different bar thicknesses to
preserve the site's established optical treatment at their respective sizes.

Rebuild with:

```sh
uv run --with 'fonttools[woff]' python scripts/build-personal-name-fonts.py
uv run --with 'fonttools[woff]' python tests/fonts/test_personal_name_fonts.py
```

Libron's official release and license are available at
<https://github.com/nicoverbruggen/libron/releases/tag/v0.25>. The original
upstream copyright notices and complete SIL Open Font License 1.1 are included
in `OFL-Libron.txt`, retained in the original font metadata and copied with the
modified fonts. The derivatives use the distinct “Kazon Name” family names.
