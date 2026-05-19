#!/usr/bin/env bash
# Render public/services.html to a one-page PDF and (optionally) upload it
# to Cloudflare KV under RESUME_STORE → doc:services-overview.
#
# Usage:
#   ./scripts/build-services-pdf.sh           # render only, output: /tmp/services-overview.pdf
#   ./scripts/build-services-pdf.sh --upload  # render + upload to remote KV
#
# The PDF artifact is never committed to the repo; the HTML in public/
# is the source of truth and is regenerated on demand from this script.
#
# Requires Google Chrome at the default macOS location. Override with CHROME=...

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTML="$REPO_ROOT/public/services.html"
OUT="${OUT:-/tmp/services-overview.pdf}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
KV_KEY="doc:services-overview"

if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at: $CHROME" >&2
  echo "Set CHROME=/path/to/chrome and rerun." >&2
  exit 1
fi

if [ ! -f "$HTML" ]; then
  echo "Missing source: $HTML" >&2
  exit 1
fi

echo "Rendering $HTML -> $OUT (US Letter)…"
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --hide-scrollbars \
  --no-pdf-header-footer \
  --virtual-time-budget=8000 \
  --print-to-pdf="$OUT" \
  "file://$HTML"

echo "Done. $(file "$OUT")"

if [ "${1:-}" = "--upload" ]; then
  echo "Uploading $OUT -> RESUME_STORE/$KV_KEY (remote)…"
  npx wrangler kv key put --binding=RESUME_STORE --remote "$KV_KEY" --path "$OUT"
  echo "Uploaded."
fi
