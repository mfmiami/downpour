#!/usr/bin/env bash
# Copy shared extension source from repo root into chrome-extension/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/chrome-extension"

FILES=(
  background.js
  overlay.js
  content.js
  platforms.js
  popup.js
  popup.html
  instagram.js
  instagram-injected.js
  tiktok-extract.js
  tiktok-injected.js
  social-extract.js
  social-injected.js
  mux.min.js
)

echo "Syncing extension source → chrome-extension/"
mkdir -p "$DEST/icons"
for file in "${FILES[@]}"; do
  cp "$ROOT/$file" "$DEST/$file"
  echo "  ✓ $file"
done

if [[ -d "$ROOT/icons" ]]; then
  rsync -a --delete "$ROOT/icons/" "$DEST/icons/"
  echo "  ✓ icons/"
fi

ROOT_VER="$(python3 -c "import json; print(json.load(open('$ROOT/manifest.json'))['version'])")"
CHROME_VER="$(python3 -c "import json; print(json.load(open('$DEST/manifest.json'))['version'])")"

if [[ "$ROOT_VER" != "$CHROME_VER" ]]; then
  echo "WARNING: version mismatch — root manifest=$ROOT_VER, chrome-extension/manifest.json=$CHROME_VER" >&2
  echo "Update chrome-extension/manifest.json version to match." >&2
fi

echo "Done. Load chrome-extension/ as an unpacked extension in Chrome."