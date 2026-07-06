# Downpour

**macOS Safari extension** — save videos and images from the web with hover overlays on Instagram, TikTok, X, and generic sites, plus a popup for YouTube and detected streams.

**Current version:** 2.12.3

## Download & install

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

## Development

### Repository layout

| Path | Purpose |
|------|---------|
| `/` | Extension source (Manifest V3 JS) |
| `chrome-extension/` | Chrome port (load unpacked; see `chrome-extension/README.md`) |
| `releases/` | Installer DMG output (`Downpour.dmg`) |
| `safari-app/` | macOS Xcode project (synced before publish) |
| `sync-to-safari.sh` | Copy extension JS → Xcode `Resources/` |
| `scripts/sync-chrome.sh` | Copy extension JS → `chrome-extension/` |
| `scripts/build-installer.sh` | Build app and package the DMG |
| `scripts/install-downpour.sh` | One-click install (used inside the DMG) |
| `scripts/publish-sync.sh` | Refresh `safari-app/` from `../Downpour-Safari/` |
| `scripts/bootstrap-mac-deps.sh` | Restore bundled Python + ffmpeg after clone |
| `scripts/publish-release.sh` | Build DMG and upload to GitHub Releases |

Day-to-day development uses the sibling Xcode project at `../Downpour-Safari/`.

### Build from source

```bash
./sync-to-safari.sh
../Downpour-Safari/build-macos.sh
```

After cloning:

```bash
./scripts/bootstrap-mac-deps.sh
open safari-app/Downpour/Downpour.xcodeproj
```

### Build installer

```bash
./scripts/build-installer.sh
```

Creates `releases/Downpour-<version>.dmg` and `releases/Downpour.dmg`.

```bash
SKIP_BUILD=1 INSTALLER_APP=/Applications/Downpour.app ./scripts/build-installer.sh
```

Publish to GitHub Releases (requires [GitHub CLI](https://cli.github.com/)):

```bash
./scripts/publish-release.sh
```

### Tests

```bash
node test/run-tests.mjs
```

### Publish code changes

```bash
./scripts/publish-sync.sh
git add -A && git commit -m "..." && git push
```

## Legal note

Only download content you have the right to save. Social downloads may read Safari cookies via yt-dlp. Downpour is not affiliated with YouTube, TikTok, Instagram, or X.