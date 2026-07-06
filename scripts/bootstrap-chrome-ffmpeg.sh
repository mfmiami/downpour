#!/usr/bin/env bash
# Copy bundled ffmpeg into chrome-extension/native-host/ffmpeg/ (not stored in git).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/chrome-extension/native-host/ffmpeg"

pick_source() {
  for candidate in \
    "$ROOT/dist/staging/Downpour.app/Contents/Resources/ffmpeg/ffmpeg" \
    "$ROOT/safari-app/Downpour/Shared (App)/Resources/ffmpeg/ffmpeg" \
    "$ROOT/safari-app/Downpour/Shared (Extension)/Resources/ffmpeg/ffmpeg"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
  echo "ERROR: No ffmpeg binary found. Build or copy the Safari app bundle first, or install ffmpeg:" >&2
  echo "  brew install ffmpeg" >&2
  echo "Then re-run this script, or point FFMPEG_SRC at a binary:" >&2
  echo "  FFMPEG_SRC=/path/to/ffmpeg $0" >&2
  exit 1
}

SRC="${FFMPEG_SRC:-$(pick_source)}"
mkdir -p "$DEST"
cp "$SRC" "$DEST/ffmpeg"
chmod +x "$DEST/ffmpeg"
echo "Installed $(file -b "$DEST/ffmpeg")"
echo "  → $DEST/ffmpeg"