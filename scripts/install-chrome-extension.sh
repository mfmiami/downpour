#!/usr/bin/env bash
# Install the Downpour Chrome extension (unpacked) and optional native host.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_EXT="${1:-$SCRIPT_DIR/chrome-extension}"
SUPPORT_DIR="$HOME/Library/Application Support/Downpour"
DEST_EXT="$SUPPORT_DIR/chrome-extension"
YTDLP_DEST="$SUPPORT_DIR/yt-dlp.py"

if [[ ! -d "$SOURCE_EXT" || ! -f "$SOURCE_EXT/manifest.json" ]]; then
  echo "ERROR: chrome-extension folder not found at $SOURCE_EXT" >&2
  exit 1
fi

VERSION="$(python3 -c "import json; print(json.load(open('$SOURCE_EXT/manifest.json'))['version'])" 2>/dev/null || echo "unknown")"
echo "Installing Downpour (Chrome) $VERSION..."
echo "  From: $SOURCE_EXT"
echo "  To:   $DEST_EXT"

mkdir -p "$SUPPORT_DIR"
rsync -a --delete "$SOURCE_EXT/" "$DEST_EXT/"

for ytdlp_candidate in \
  "$SCRIPT_DIR/yt-dlp.py" \
  "$(dirname "$SCRIPT_DIR")/yt-dlp.py"; do
  if [[ -f "$ytdlp_candidate" ]]; then
    cp "$ytdlp_candidate" "$YTDLP_DEST"
    echo "  ✓ yt-dlp helper → $YTDLP_DEST"
    break
  fi
done

echo "Opening Chrome extensions page..."
if [[ -d "/Applications/Google Chrome.app" ]]; then
  open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || true
elif [[ -d "/Applications/Chromium.app" ]]; then
  open -a "Chromium" "chrome://extensions/" 2>/dev/null || true
else
  open "chrome://extensions/" 2>/dev/null || true
fi

open -R "$DEST_EXT"

osascript <<APPLESCRIPT
display dialog "Downpour for Chrome is ready.

1. In Chrome, turn on Developer mode (top right)
2. Click Load unpacked
3. Select this folder (Finder just opened it):
   ${DEST_EXT}

After loading, copy the extension ID from chrome://extensions if you want YouTube downloads." buttons {"OK"} default button "OK" with title "Chrome Extension Ready" with icon note
APPLESCRIPT

OFFER_NATIVE=$(osascript <<'APPLESCRIPT'
display dialog "Install the optional native helper for YouTube (yt-dlp) downloads in Chrome?" buttons {"Skip", "Install"} default button "Install" with title "YouTube Helper" with icon note
if button returned of result is "Install" then
  return "yes"
end if
return "no"
APPLESCRIPT
)

if [[ "$OFFER_NATIVE" == "yes" ]]; then
  EXT_ID=$(osascript <<'APPLESCRIPT'
display dialog "Paste your Chrome extension ID from chrome://extensions:" default answer "" buttons {"Cancel", "Continue"} default button "Continue" with title "Extension ID"
if button returned of result is "Cancel" then return ""
return text returned of result
APPLESCRIPT
)
  EXT_ID="$(echo "$EXT_ID" | tr -d '[:space:]')"
  if [[ -n "$EXT_ID" ]]; then
    NATIVE_INSTALLER="$DEST_EXT/native-host/install-native-host.sh"
    if [[ -x "$NATIVE_INSTALLER" ]]; then
      bash "$NATIVE_INSTALLER" "$EXT_ID"
      osascript -e 'display dialog "Native helper installed. Quit Chrome completely and reopen it." buttons {"OK"} default button "OK" with title "YouTube Helper Installed" with icon note'
    else
      echo "WARNING: native host installer not found at $NATIVE_INSTALLER" >&2
    fi
  fi
fi

echo "Chrome install done."
echo "Extension folder: $DEST_EXT"