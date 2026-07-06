#!/usr/bin/env bash
# Build installer DMG and publish to GitHub Releases.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c "import json; print(json.load(open('$ROOT/manifest.json'))['version'])")"
TAG="v${VERSION}"
DMG="$ROOT/releases/Downpour-${VERSION}.dmg"

"$ROOT/scripts/build-installer.sh"

if ! command -v gh >/dev/null 2>&1; then
  echo ""
  echo "Built $DMG"
  echo "Install GitHub CLI (brew install gh) to upload automatically."
  exit 0
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$DMG" --clobber
  echo "Uploaded to existing release $TAG"
else
  gh release create "$TAG" "$DMG" \
    --title "Downpour ${VERSION}" \
    --notes "macOS Safari extension installer. Open the DMG and double-click Install Downpour.command."
  echo "Created release $TAG"
fi