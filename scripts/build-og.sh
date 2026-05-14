#!/usr/bin/env bash
# Regenerate public/og-image.png from scripts/og.html.
#
# Usage: ./scripts/build-og.sh
#
# Two-stage build:
#   1. Re-inline scripts/logo.png + src/assets/headshot.jpg into
#      scripts/og.html as base64 data URIs (so the template renders in
#      any browser without file:// cross-directory blocks).
#   2. Render the HTML via headless Chrome at 1200x630 and write the
#      result to public/og-image.png.
#
# To update the OG image: edit scripts/og.html (layout/copy) or replace
# scripts/logo.png / src/assets/headshot.jpg, then re-run this script.
#
# Requires Google Chrome installed at the default macOS location. On
# Linux, set CHROME=/path/to/chromium first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTML="$REPO_ROOT/scripts/og.html"
OUT="$REPO_ROOT/public/og-image.png"
LOGO="$REPO_ROOT/scripts/logo.png"
HEADSHOT="$REPO_ROOT/src/assets/headshot.jpg"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at: $CHROME" >&2
  echo "Set CHROME=/path/to/chrome and rerun." >&2
  exit 1
fi

for f in "$HTML" "$LOGO" "$HEADSHOT"; do
  if [ ! -f "$f" ]; then
    echo "Missing required source: $f" >&2
    exit 1
  fi
done

echo "Refreshing data URIs in $HTML from source assets…"
node - "$HTML" "$LOGO" "$HEADSHOT" <<'NODE'
const fs = require("fs");
const [, , htmlPath, logoPath, headshotPath] = process.argv;
let html = fs.readFileSync(htmlPath, "utf-8");
const logo = fs.readFileSync(logoPath).toString("base64");
const headshot = fs.readFileSync(headshotPath).toString("base64");

// Replace either a relative path or an existing data URI on the
// <img data-asset="logo"> and <img data-asset="headshot"> elements.
function replaceSrc(html, attr, dataUri) {
  const re = new RegExp(
    `(<img\\s+[^>]*\\bdata-asset="${attr}"[^>]*\\bsrc=")[^"]*(")`,
    "g",
  );
  return html.replace(re, `$1${dataUri}$2`);
}

html = replaceSrc(html, "logo", `data:image/png;base64,${logo}`);
html = replaceSrc(html, "headshot", `data:image/jpeg;base64,${headshot}`);

fs.writeFileSync(htmlPath, html);
NODE

echo "Rendering $HTML → $OUT (1200x630)…"
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --hide-scrollbars \
  --virtual-time-budget=8000 \
  --window-size=1200,630 \
  --screenshot="$OUT" \
  "file://$HTML"

echo "Done. $(file "$OUT")"
