#!/usr/bin/env bash
# Copy safari-extension source into the live Xcode project and verify versions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/safari-extension"
DESTS=(
  "$ROOT/safari-app/Downpour/Shared (Extension)/Resources"
)
if [[ -d "$ROOT/../Downpour-Safari/Downpour/Shared (Extension)/Resources" ]]; then
  DESTS+=("$(cd "$ROOT/../Downpour-Safari/Downpour/Shared (Extension)/Resources" && pwd)")
fi
PBXPROJS=(
  "$ROOT/safari-app/Downpour/Downpour.xcodeproj/project.pbxproj"
)
if [[ -f "$ROOT/../Downpour-Safari/Downpour/Downpour.xcodeproj/project.pbxproj" ]]; then
  PBXPROJS+=("$ROOT/../Downpour-Safari/Downpour/Downpour.xcodeproj/project.pbxproj")
fi

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

echo "Syncing safari-extension → Safari Xcode Resources"
for dest in "${DESTS[@]}"; do
  echo "  → $dest"
  for file in "${FILES[@]}"; do
    cp "$SRC/$file" "$dest/$file"
  done
  if [[ -d "$SRC/icons" ]]; then
    rsync -a --delete "$SRC/icons/" "$dest/icons/"
  fi
done
for file in "${FILES[@]}"; do
  echo "  ✓ $file"
done
if [[ -d "$SRC/icons" ]]; then
  echo "  ✓ icons/"
fi

MANIFEST_VER="$(python3 -c "import json; print(json.load(open('$SRC/manifest.json'))['version'])")"
for pbx in "${PBXPROJS[@]}"; do
  XCODE_VER="$(grep -m1 'MARKETING_VERSION' "$pbx" | sed 's/.*= *//;s/;//;s/^[[:space:]]*//')"
  if [[ "$MANIFEST_VER" != "$XCODE_VER" ]]; then
    echo "ERROR: version mismatch — safari-extension/manifest.json=$MANIFEST_VER, $(basename "$(dirname "$pbx")") MARKETING_VERSION=$XCODE_VER" >&2
    exit 1
  fi
done

echo "Version check passed: $MANIFEST_VER"
echo "Done."