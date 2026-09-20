# Personal name fonts

`kazon-name-text.woff2` and `kazon-name-display.woff2` are scoped derivatives
of Newsreader Regular. They retain ordinary Unicode text while adding one
font-native contour above the lowercase `z`.

Source: https://github.com/productiontype/Newsreader

Pinned source commit: `cfcb4f7af0e52c25e8df2a2431814c8e5fe2e155`

Rebuild from a checkout at that commit:

```sh
uv run --with 'fonttools[woff]' python scripts/build-personal-name-fonts.py /path/to/Newsreader
uv run --with 'fonttools[woff]' python tests/fonts/test_personal_name_fonts.py
```

The derivatives use distinct family names and remain licensed under the SIL
Open Font License 1.1. See `OFL-Newsreader.txt`.
