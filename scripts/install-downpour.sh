#!/usr/bin/env bash
# Interactive Downpour installer — Safari app, Chrome extension, or both.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SAFARI_INSTALLER="$SCRIPT_DIR/install-safari.sh"
CHROME_INSTALLER="$SCRIPT_DIR/install-chrome-extension.sh"
SOURCE_APP="${1:-}"

pick_targets() {
  if [[ -n "${INSTALL_TARGETS:-}" ]]; then
    echo "$INSTALL_TARGETS"
    return
  fi
  if [[ -n "$SOURCE_APP" && "${INTERACTIVE:-1}" == "0" ]]; then
    echo "safari"
    return
  fi

  local choice
  choice="$(osascript <<'APPLESCRIPT' 2>/dev/null || true
set options to {"Safari app (Downpour.app)", "Chrome extension (unpacked)", "Both Safari and Chrome"}
set picked to choose from list options with title "Downpour Installer" with prompt "What would you like to install?" default items {"Both Safari and Chrome"} OK button name "Continue" Cancel button name "Quit"
if picked is false then return "cancel"
return item 1 of picked
APPLESCRIPT
)"

  if [[ -z "$choice" || "$choice" == "cancel" ]]; then
    echo "cancel"
    return
  fi

  case "$choice" in
    *Safari*) echo "safari" ;;
    *Chrome*) echo "chrome" ;;
    *Both*) echo "both" ;;
    *) echo "both" ;;
  esac
}

TARGETS="$(pick_targets)"
if [[ "$TARGETS" == "cancel" ]]; then
  echo "Install cancelled."
  exit 0
fi

echo ""
echo "Downpour installer"
echo "=================="

if [[ "$TARGETS" == "safari" || "$TARGETS" == "both" ]]; then
  bash "$SAFARI_INSTALLER" "$SOURCE_APP"
  echo ""
fi

if [[ "$TARGETS" == "chrome" || "$TARGETS" == "both" ]]; then
  bash "$CHROME_INSTALLER"
  echo ""
fi

echo "All selected installs finished."