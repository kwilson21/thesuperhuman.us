#!/usr/bin/env bash
# Render the email signature nameplate from scripts/email-nameplate.html.
# Usage: ./scripts/build-email-nameplate.sh
# Override CHROME with a Chromium executable on other platforms.
# Sent emails reference /email/nameplate.png forever, so keep that path stable.
# The render goes to a temporary file and replaces the published PNG only after every check passes.
# The K mark comes from public/favicon.svg loaded as an image, which renders with a system serif,
# so rendering on a different OS can change the K.
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
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
RENDER="$WORK_DIR/nameplate.png"
# --default-background-color=00000000: keeps the rounded corners transparent.
# The 190x43 window at device scale factor 3 gives a 570x129 image for sharp text.
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --hide-scrollbars \
  --default-background-color=00000000 --force-device-scale-factor=3 \
  --window-size=190,43 --virtual-time-budget=4000 \
  --screenshot="$RENDER" "file://$HTML"
# Fail loudly if the render is not exactly 3x the 190x43 plate, or if its top-left corner is not
# transparent (the plate has rounded corners; email-nameplate.html paints the page red when the name
# font fails to load). Run from the repo root so sharp resolves from its node_modules.
cd "$REPO_ROOT"
RENDER="$RENDER" node --input-type=module -e '
import sharp from "sharp";
const { data, info } = await sharp(process.env.RENDER).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.width !== 570 || info.height !== 129) {
  console.error(`Nameplate is ${info.width}x${info.height}, expected 570x129.`);
  process.exit(1);
}
if (data[3] !== 0) {
  console.error(`Nameplate top-left pixel has alpha ${data[3]}, expected 0. The name font probably failed to load or the background is not transparent.`);
  process.exit(1);
}
'
mv "$RENDER" "$OUT"
echo "Rendered $OUT. Inspect the nameplate before sharing."
