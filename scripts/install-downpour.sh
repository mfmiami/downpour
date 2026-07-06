#!/usr/bin/env bash
# Install Downpour.app to /Applications and register the Safari web extension.
set -euo pipefail

APP_NAME="Downpour.app"
INSTALL_DIR="/Applications"
EXTENSION_APPEX="Downpour Extension.appex"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_APP="${1:-}"

if [[ -z "$SOURCE_APP" ]]; then
  for candidate in \
    "$SCRIPT_DIR/$APP_NAME" \
    "$SCRIPT_DIR/../$APP_NAME" \
    "$(dirname "$SCRIPT_DIR")/$APP_NAME"; do
    if [[ -d "$candidate" ]]; then
      SOURCE_APP="$candidate"
      break
    fi
  done
fi

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "ERROR: $APP_NAME not found." >&2
  echo "Pass the path to Downpour.app, or run this from the installer disk image." >&2
  exit 1
fi

SOURCE_APP="$(cd "$(dirname "$SOURCE_APP")" && pwd)/$(basename "$SOURCE_APP")"
DEST="$INSTALL_DIR/$APP_NAME"
APPEX="$DEST/Contents/PlugIns/$EXTENSION_APPEX"
VERSION="$(defaults read "$SOURCE_APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "unknown")"

echo "Installing Downpour $VERSION..."
echo "  From: $SOURCE_APP"
echo "  To:   $DEST"

install_app() {
  if [[ -w "$INSTALL_DIR" ]]; then
    rsync -a --delete "$SOURCE_APP/" "$DEST/"
  else
    echo "Administrator password required to install to Applications."
    sudo rsync -a --delete "$SOURCE_APP/" "$DEST/"
  fi
}

if [[ -d "$DEST" ]]; then
  echo "Replacing existing installation."
fi
install_app

if [[ ! -d "$APPEX" ]]; then
  echo "ERROR: Safari extension not found at $APPEX" >&2
  exit 1
fi

echo "Registering Safari extension..."
pluginkit -a "$APPEX" 2>/dev/null || true

echo "Opening Downpour..."
open "$DEST"

osascript <<'APPLESCRIPT'
display dialog "Downpour is installed.

Next steps:
1. Open Safari → Settings → Extensions
2. Turn on \"Downpour\"
3. Allow the extension on the sites you use

If Downpour does not appear, quit Safari completely and open it again." buttons {"OK"} default button "OK" with title "Downpour Installed" with icon note
APPLESCRIPT

echo "Done."