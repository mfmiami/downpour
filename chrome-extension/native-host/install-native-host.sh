#!/usr/bin/env bash
# Install the Downpour Chrome native messaging host on macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_HOST="$SCRIPT_DIR/downpour_host.py"
TEMPLATE="$SCRIPT_DIR/com.dtek.downpour.json"
CHROME_EXT_ID="${1:-}"
SUPPORT_DIR="$HOME/Library/Application Support/Downpour"
HOST_DIR="$SUPPORT_DIR/native-host"
HOST_PY="$HOST_DIR/downpour_host.py"
YTDLP_DEST="$SUPPORT_DIR/yt-dlp.py"

if [[ ! -f "$SOURCE_HOST" ]]; then
  echo "ERROR: downpour_host.py not found" >&2
  exit 1
fi

if [[ -z "$CHROME_EXT_ID" ]]; then
  echo "Usage: $0 <chrome-extension-id>"
  echo ""
  echo "Find the extension ID on chrome://extensions (Developer mode on)."
  echo "Example: $0 abcdefghijklmnopqrstuvwxyzabcd"
  exit 1
fi

mkdir -p "$HOST_DIR"
cp "$SOURCE_HOST" "$HOST_PY"
chmod +x "$HOST_PY"

for ytdlp_candidate in \
  "$SUPPORT_DIR/yt-dlp.py" \
  "$SCRIPT_DIR/../yt-dlp.py" \
  "$(dirname "$SCRIPT_DIR")/../yt-dlp.py" \
  "$SCRIPT_DIR/yt-dlp.py"; do
  if [[ -f "$ytdlp_candidate" ]]; then
    if [[ "$ytdlp_candidate" -ef "$YTDLP_DEST" ]]; then
      echo "  ✓ yt-dlp helper already at $YTDLP_DEST"
    else
      cp "$ytdlp_candidate" "$YTDLP_DEST"
      echo "  ✓ yt-dlp helper → $YTDLP_DEST"
    fi
    break
  fi
done

LAUNCHER="$HOST_DIR/run-downpour-host.sh"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"
exec "$(command -v python3)" "$HOST_PY"
EOF
chmod +x "$LAUNCHER"

MANIFEST="$(mktemp)"
sed \
  -e "s|HOST_PATH|$LAUNCHER|g" \
  -e "s|EXTENSION_ID|$CHROME_EXT_ID|g" \
  "$TEMPLATE" > "$MANIFEST"

TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$TARGET_DIR"
cp "$MANIFEST" "$TARGET_DIR/com.dtek.downpour.json"
rm -f "$MANIFEST"

echo "Installed native host:"
echo "  $TARGET_DIR/com.dtek.downpour.json"
echo "  host:   $HOST_PY"
echo "  runner: $LAUNCHER"
echo ""
echo "Quit Chrome completely and reopen it."