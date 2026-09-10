#!/usr/bin/env bash
# Render the shared services page from a running local preview.
# BASE_URL=http://127.0.0.1:4321 ./scripts/build-services-pdf.sh [--audio] [--upload]
# --upload retains the existing software PDF delivery key; audio is render-only.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:4321}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SHEET_PATH="/services"
UPLOAD=false
AUDIO=false
for argument in "$@"; do
  case "$argument" in
    --audio) AUDIO=true; SHEET_PATH="/audio/services" ;;
    --upload) UPLOAD=true ;;
    *) echo "Unknown argument: $argument. Use --audio or --upload." >&2; exit 1 ;;
  esac
done
if "$AUDIO" && "$UPLOAD"; then
  echo "Audio is render-only. It has no PDF delivery key; do not overwrite the software overview." >&2
  exit 1
fi
if "$AUDIO"; then OUT="${OUT:-/tmp/audio-services-overview.pdf}"; else OUT="${OUT:-/tmp/services-overview.pdf}"; fi
if [ ! -x "$CHROME" ]; then echo "Chrome not found at: $CHROME. Set CHROME and rerun." >&2; exit 1; fi
URL="${BASE_URL%/}$SHEET_PATH"
# Fail before rendering an error page or uploading an old PDF.
curl --fail --silent --show-error "$URL" --output /dev/null
PDF_DIR="$(mktemp -d /tmp/website-services-XXXXXXXX)"
TEMP_PDF="$PDF_DIR/overview.pdf"
trap 'rm -f "$TEMP_PDF"; rmdir "$PDF_DIR"' EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="$TEMP_PDF" "$URL"
if [ ! -s "$TEMP_PDF" ] || [ "$(file -b --mime-type "$TEMP_PDF")" != "application/pdf" ]; then
  echo "Chrome did not produce a PDF. Nothing uploaded." >&2; exit 1
fi
mv "$TEMP_PDF" "$OUT"
echo "Rendered $OUT. Inspect the one-page layout before sharing."
if "$UPLOAD"; then
  cd "$REPO_ROOT"
  npx wrangler kv key put --binding=RESUME_STORE --remote doc:services-overview --path "$OUT"
fi
