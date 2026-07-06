#!/usr/bin/env bash
# Mirror the local Xcode Safari wrapper into safari-app/ for git (excludes large deps).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SAFARI_SRC:-$ROOT/../VideoStreamDownloader-Safari}"
DEST="$ROOT/safari-app"

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: Safari project not found at $SRC" >&2
  echo "Set SAFARI_SRC to your VideoStreamDownloader-Safari path." >&2
  exit 1
fi

echo "Publishing sync: $SRC → $DEST"
rsync -a --delete \
  --exclude '.DS_Store' \
  --exclude 'DerivedData' \
  --exclude '*.xcuserstate' \
  --exclude 'xcuserdata' \
  --exclude 'Shared (App)/Resources/python' \
  --exclude 'Shared (App)/Resources/ffmpeg' \
  "$SRC/" "$DEST/"

echo "Done. Large deps (python/ffmpeg) are excluded — run scripts/bootstrap-mac-deps.sh after clone."