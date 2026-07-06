#!/usr/bin/env bash
# Copy safari-extension source into the live Xcode project and verify versions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/safari-extension"
DEST="$(cd "$ROOT/../Downpour-Safari/Downpour/Shared (Extension)/Resources" && pwd)"
PBXPROJ="$ROOT/../Downpour-Safari/Downpour/Downpour.xcodeproj/project.pbxproj"

FILES=(
  manifest.json
  background.js
  overlay.js
  content.js
  platforms.js
  extension-bridge.js
  page-inject.js
  popup.js
  popup.html
  instagram.js
  instagram-injected.js
  tiktok-extract.js
  tiktok-injected.js
  social-extract.js
  social-injected.js
  page-fetch-injected.js
  youtube-capture-injected.js
  youtube-player-bridge-injected.js
  tiktok-page-capture-injected.js
  social-page-capture-injected.js
  mux.min.js
)

echo "Syncing safari-extension → Downpour-Safari Resources"
for file in "${FILES[@]}"; do
  cp "$SRC/$file" "$DEST/$file"
  echo "  ✓ $file"
done

if [[ -d "$SRC/icons" ]]; then
  rsync -a --delete "$SRC/icons/" "$DEST/icons/"
  echo "  ✓ icons/"
fi

MANIFEST_VER="$(python3 -c "import json; print(json.load(open('$SRC/manifest.json'))['version'])")"
XCODE_VER="$(grep -m1 'MARKETING_VERSION' "$PBXPROJ" | sed 's/.*= *//;s/;//;s/^[[:space:]]*//')"

if [[ "$MANIFEST_VER" != "$XCODE_VER" ]]; then
  echo "ERROR: version mismatch — safari-extension/manifest.json=$MANIFEST_VER, Xcode MARKETING_VERSION=$XCODE_VER" >&2
  exit 1
fi

echo "Version check passed: $MANIFEST_VER"
echo "Done."