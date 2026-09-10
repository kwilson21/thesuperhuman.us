#!/usr/bin/env bash
# Render the social card from scripts/og.html and its reviewed studio artwork.
# Usage: ./scripts/build-og.sh
# Override CHROME with a Chromium executable on other platforms.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTML="$REPO_ROOT/scripts/og.html"
OUT="$REPO_ROOT/public/og-image.png"
STUDIO="$REPO_ROOT/src/assets/site/studio-v1.webp"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at: $CHROME. Set CHROME and rerun." >&2
  exit 1
fi
for source in "$HTML" "$STUDIO"; do
  if [ ! -f "$source" ]; then
    echo "Missing required source: $source" >&2
    exit 1
  fi
done
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --hide-scrollbars --virtual-time-budget=8000 --window-size=1200,630 \
  --screenshot="$OUT" "file://$HTML"
echo "Rendered $OUT. Inspect the card before sharing."
