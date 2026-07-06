#!/usr/bin/env bash
# Build Downpour.app and package a drag-and-drop DMG with a one-click installer.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASES="$ROOT/releases"
STAGING="$RELEASES/.staging"
SAFARI_BUILD="${SAFARI_BUILD:-$ROOT/../Downpour-Safari/build-macos.sh}"
VERSION="$(python3 -c "import json; print(json.load(open('$ROOT/manifest.json'))['version'])")"
DMG_NAME="Downpour-${VERSION}.dmg"
DMG_PATH="$RELEASES/$DMG_NAME"
LATEST_LINK="$RELEASES/Downpour.dmg"

find_built_app() {
  find ~/Library/Developer/Xcode/DerivedData -path '*/Build/Products/Release/Downpour.app' -maxdepth 6 2>/dev/null | head -1
}

resolve_app() {
  if [[ -n "${INSTALLER_APP:-}" && -d "$INSTALLER_APP" ]]; then
    echo "$INSTALLER_APP"
    return
  fi
  if [[ -d "/Applications/Downpour.app" ]]; then
    echo "/Applications/Downpour.app"
    return
  fi
  find_built_app
}

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  if [[ ! -x "$SAFARI_BUILD" ]]; then
    echo "ERROR: build script not found at $SAFARI_BUILD" >&2
    echo "Set SAFARI_BUILD or run from a machine with the Xcode project." >&2
    exit 1
  fi
  echo "Building Downpour $VERSION..."
  "$SAFARI_BUILD"
fi

APP="$(resolve_app)"
if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "ERROR: Downpour.app not found. Build first or set INSTALLER_APP=/path/to/Downpour.app" >&2
  exit 1
fi

echo "Packaging: $APP"

rm -rf "$STAGING"
mkdir -p "$STAGING" "$RELEASES"

APP_NAME="Downpour.app"

echo "Copying app (this may take a moment)..."
ditto "$APP" "$STAGING/$APP_NAME"

ln -sf /Applications "$STAGING/Applications"
cp "$ROOT/scripts/install-downpour.sh" "$STAGING/"
chmod +x "$STAGING/install-downpour.sh"

cat > "$STAGING/Install Downpour.command" <<'EOF'
#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/install-downpour.sh" "$DIR/Downpour.app"
echo ""
read -r -p "Press Return to close..."
EOF
chmod +x "$STAGING/Install Downpour.command"

cat > "$STAGING/INSTALL.txt" <<EOF
Downpour ${VERSION} — macOS Safari Extension
============================================

Quick install
-------------
Double-click "Install Downpour.command" and follow the prompts.

Manual install
--------------
1. Drag Downpour.app onto the Applications folder alias.
2. Open Downpour from Applications once.
3. Safari → Settings → Extensions → enable Downpour.

First launch
------------
macOS may warn that Downpour is from an unidentified developer.
Right-click Downpour.app → Open → Open to approve it once.

Privacy
-------
Only download content you have the right to save. Social downloads may read
Safari cookies via yt-dlp. Downpour is not affiliated with YouTube, TikTok,
Instagram, or X.
EOF

rm -f "$DMG_PATH" "$LATEST_LINK"

echo "Creating disk image..."
hdiutil create \
  -volname "Downpour ${VERSION}" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

ln -sf "$DMG_NAME" "$LATEST_LINK"
rm -rf "$STAGING"

echo ""
echo "Installer ready:"
echo "  $DMG_PATH"
echo "  $LATEST_LINK  → latest"
du -sh "$DMG_PATH"
echo ""
echo "Upload to GitHub Releases:"
echo "  gh release upload v${VERSION} \"$DMG_PATH\" --clobber"