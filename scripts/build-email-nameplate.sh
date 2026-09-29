#!/usr/bin/env bash
# Render the email signature nameplate from scripts/email-nameplate.html.
# Usage: ./scripts/build-email-nameplate.sh
# Override CHROME with a Chromium executable on other platforms.
# Sent emails reference /email/nameplate.png forever, so keep that path stable.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTML="$REPO_ROOT/scripts/email-nameplate.html"
FONT="$REPO_ROOT/public/fonts/kazon-name-text.woff2"
ICON="$REPO_ROOT/public/favicon.svg"
OUT="$REPO_ROOT/public/email/nameplate.png"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at: $CHROME. Set CHROME and rerun." >&2
  exit 1
fi
for source in "$HTML" "$FONT" "$ICON"; do
  if [ ! -f "$source" ]; then
    echo "Missing required source: $source" >&2
    exit 1
  fi
done
mkdir -p "$REPO_ROOT/public/email"
# --allow-file-access-from-files: Chrome blocks @font-face loads on file:// without it,
#   and the name would silently render in a fallback font without the bar over the z.
# --default-background-color=00000000: keeps the rounded corners transparent.
# The 190x43 window at device scale factor 3 gives a 570x129 image for sharp text.
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --hide-scrollbars --allow-file-access-from-files \
  --default-background-color=00000000 --force-device-scale-factor=3 \
  --window-size=190,43 --virtual-time-budget=4000 \
  --screenshot="$OUT" "file://$HTML"
# Fail loudly if the render is not exactly 3x the 190x43 plate.
OUT="$OUT" node --input-type=module -e '
import sharp from "sharp";
const { width, height } = await sharp(process.env.OUT).metadata();
if (width !== 570 || height !== 129) {
  console.error(`Nameplate is ${width}x${height}, expected 570x129: ${process.env.OUT}`);
  process.exit(1);
}
'
echo "Rendered $OUT. Inspect the nameplate before sharing."
