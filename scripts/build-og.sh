#!/usr/bin/env bash
# Regenerate public/og-image.png from scripts/og.html.
#
# Usage: ./scripts/build-og.sh
#
# Renders the HTML in scripts/og.html (1200x630) via headless Chrome and
# writes the result to public/og-image.png. Edit scripts/og.html to
# change the layout, then re-run.
#
# Requires Google Chrome installed at the default macOS location. On
# Linux, swap CHROME for `chromium` or `google-chrome`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTML="$REPO_ROOT/scripts/og.html"
OUT="$REPO_ROOT/public/og-image.png"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at: $CHROME" >&2
  echo "Set CHROME=/path/to/chrome and rerun." >&2
  exit 1
fi

echo "Rendering $HTML → $OUT (1200x630)…"
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --hide-scrollbars \
  --virtual-time-budget=8000 \
  --window-size=1200,630 \
  --screenshot="$OUT" \
  "file://$HTML"

echo "Done. $(file "$OUT")"
