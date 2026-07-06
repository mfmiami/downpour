# Downpour

**macOS Safari extension** — save videos and images from the web with hover overlays on Instagram, TikTok, X, and generic sites, plus a popup for YouTube and detected streams. A **Chrome port** is included for Chromium browsers.

**Current version:** see `safari-extension/manifest.json`

## Download & install (Safari)

| | |
|---|---|
| **Installer DMG** | [`releases/Downpour.dmg`](releases/Downpour.dmg) |
| **GitHub Releases** | [github.com/mfmiami/downpour/releases](https://github.com/mfmiami/downpour/releases) |

### Steps

1. Open **`releases/Downpour.dmg`** (or download from GitHub Releases)
2. Double-click **`Install Downpour.command`**
3. In Safari: **Settings → Extensions** → turn on **Downpour**
4. Allow the extension on the sites you use

**First launch:** if macOS blocks the app, right-click **Downpour.app → Open → Open** once.

**After installing:** quit and reopen Safari if the extension does not appear.

## Features

- Hover **Save** button on social feeds and generic video pages
- Popup lists detected streams and starts YouTube downloads
- Parallel downloads with per-video progress
- Instagram image posts save with the correct file extension

## Repository layout

| Path | Purpose |
|------|---------|
| `safari-extension/` | **Safari web extension** source (Manifest V3 JS) |
| `chrome-extension/` | **Chrome port** (load unpacked) |
| `safari-app/` | macOS Xcode project snapshot (git) |
| `releases/` | Installer DMG output |
| `scripts/` | Build, sync, and publish tooling |
| `test/` | Regression tests |
| `remux.js` | MP4 remux source of truth (inlined in `background.js`) |
| `yt-dlp.py` | Bundled yt-dlp wrapper for native downloads |

Day-to-day Xcode work uses the sibling project at `../Downpour-Safari/`.

## Development

### Edit extension JS

Work in **`safari-extension/`**, then sync:

```bash
./scripts/sync-safari.sh      # → ../Downpour-Safari Xcode Resources
./scripts/sync-chrome.sh        # → chrome-extension/
```

### Build Safari app

```bash
./scripts/sync-safari.sh
../Downpour-Safari/build-macos.sh
```

### Build installer DMG

```bash
./scripts/build-installer.sh
```

### Chrome (unpacked)

```bash
./scripts/sync-chrome.sh
# chrome://extensions → Load unpacked → chrome-extension/
```

See [`chrome-extension/README.md`](chrome-extension/README.md) for the optional native host.

### Tests

```bash
node test/run-tests.mjs
```

### After cloning

```bash
./scripts/bootstrap-mac-deps.sh
open safari-app/Downpour/Downpour.xcodeproj
```

## Legal note

Only download content you have the right to save. Social downloads may read browser cookies via yt-dlp. Downpour is not affiliated with YouTube, TikTok, Instagram, or X.