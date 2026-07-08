#!/usr/bin/env bash
# Copy shared extension source from safari-extension/ into chrome-extension/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/safari-extension"
DEST="$ROOT/chrome-extension"

FILES=(
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

echo "Syncing safari-extension → chrome-extension/"
mkdir -p "$DEST/icons"
for file in "${FILES[@]}"; do
  cp "$SRC/$file" "$DEST/$file"
  echo "  ✓ $file"
done

if [[ -d "$SRC/icons" ]]; then
  rsync -a --delete "$SRC/icons/" "$DEST/icons/"
  echo "  ✓ icons/"
fi

SAFARI_VER="$(python3 -c "import json; print(json.load(open('$SRC/manifest.json'))['version'])")"
CHROME_VER="$(python3 -c "import json; print(json.load(open('$DEST/manifest.json'))['version'])")"

if [[ "$SAFARI_VER" != "$CHROME_VER" ]]; then
  echo "Syncing chrome-extension/manifest.json version: $CHROME_VER → $SAFARI_VER"
  python3 - "$DEST/manifest.json" "$SAFARI_VER" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as fh:
    data = json.load(fh)
data["version"] = version
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY
fi

echo "Done. Load chrome-extension/ as an unpacked extension in Chrome."