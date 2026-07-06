#!/usr/bin/env bash
# Release build for Downpour (macOS Safari extension).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/../videodownload"
XCODE_DIR="$ROOT/Downpour"

"$SRC/sync-to-safari.sh"

cd "$XCODE_DIR"
xcodebuild \
  -scheme Downpour \
  -configuration Release \
  -destination "platform=macOS" \
  -allowProvisioningUpdates \
  build

APP="$(find ~/Library/Developer/Xcode/DerivedData -path '*/Build/Products/Release/Downpour.app' -maxdepth 6 2>/dev/null | head -1)"
if [[ -z "$APP" ]]; then
  echo "ERROR: Downpour.app not found in DerivedData" >&2
  exit 1
fi

echo ""
echo "Built: $APP"