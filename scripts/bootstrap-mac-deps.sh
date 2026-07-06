#!/usr/bin/env bash
# Restore bundled Python + ffmpeg required for yt-dlp merges (not stored in git).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE_SRC="${SAFARI_SRC:-$ROOT/../Downpour-Safari}"
REPO_DEST="$ROOT/safari-app/Downpour/Shared (App)/Resources"

pick_source() {
  if [[ -d "$LIVE_SRC/Downpour/Shared (App)/Resources/python" ]]; then
    echo "$LIVE_SRC/Downpour/Shared (App)/Resources"
    return
  fi
  echo "ERROR: No python bundle found. Copy Resources/python and Resources/ffmpeg from a working Downpour.app build into:" >&2
  echo "  $REPO_DEST" >&2
  exit 1
}

SRC_RES="$(pick_source)"

for dir in python ffmpeg; do
  if [[ ! -d "$SRC_RES/$dir" ]]; then
    echo "ERROR: missing $SRC_RES/$dir" >&2
    exit 1
  fi
  echo "Copying $dir → $REPO_DEST/"
  mkdir -p "$REPO_DEST"
  rsync -a "$SRC_RES/$dir/" "$REPO_DEST/$dir/"
done

echo "Bootstrap complete."