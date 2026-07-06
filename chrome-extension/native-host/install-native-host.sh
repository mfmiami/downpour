#!/usr/bin/env bash
# Install the Downpour Chrome native messaging host on macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PY="$SCRIPT_DIR/downpour_host.py"
TEMPLATE="$SCRIPT_DIR/com.dtek.downpour.json"
CHROME_EXT_ID="${1:-}"

if [[ ! -f "$HOST_PY" ]]; then
  echo "ERROR: downpour_host.py not found" >&2
  exit 1
fi

chmod +x "$HOST_PY"

if [[ -z "$CHROME_EXT_ID" ]]; then
  echo "Usage: $0 <chrome-extension-id>"
  echo ""
  echo "Find the extension ID on chrome://extensions (Developer mode on)."
  echo "Example: $0 abcdefghijklmnopqrstuvwxyzabcd"
  exit 1
fi

LAUNCHER="$SCRIPT_DIR/run-downpour-host.sh"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
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
echo "  launcher: $LAUNCHER"
echo ""
echo "Restart Chrome after loading the unpacked extension."