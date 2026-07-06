# Downpour

Save videos and images from the web with a Safari extension — hover overlays on Instagram, TikTok, X, and generic sites, plus a popup for YouTube and detected streams.

**Current version:** 2.12.3

## Install (macOS)

### From a release DMG

1. Open `Downpour-<version>.dmg`
2. Double-click **`Install Downpour.command`**
3. In Safari, go to **Settings → Extensions** and turn on **Downpour**
4. Allow the extension on the sites you use

Manual alternative: drag **Downpour.app** onto the **Applications** folder, open it once, then enable it in Safari.

**First launch:** macOS may block unsigned builds. Right-click **Downpour.app → Open → Open** to approve it once.

### After installing

- Quit and reopen Safari if the extension does not appear
- Open **Downpour** from Applications when social downloads need the bundled yt-dlp helper

## Features

- Hover **Save** button on social feeds (Instagram, TikTok, X) and generic video pages
- Popup lists detected streams and starts YouTube downloads
- Parallel downloads with per-video progress
- Instagram image posts save with the correct file extension

## Development

### Repository layout

| Path | Purpose |
|------|---------|
| `/` | Extension source (Manifest V3 JS) — edit here |
| `safari-app/` | macOS Safari wrapper (Xcode project, synced before publish) |
| `sync-to-safari.sh` | Copy extension JS → live Xcode `Resources/` |
| `scripts/publish-sync.sh` | Refresh `safari-app/` from your local Xcode project |
| `scripts/bootstrap-mac-deps.sh` | Restore bundled Python + ffmpeg after clone |
| `scripts/build-installer.sh` | Build app and package a distributable `.dmg` |
| `scripts/install-downpour.sh` | One-click install logic (used inside the DMG) |

Day-to-day development can use a sibling Xcode project at `../VideoStreamDownloader-Safari/`. Run `sync-to-safari.sh` after editing extension files.

### Build from source

```bash
# 1. Sync extension source into your Xcode project
./sync-to-safari.sh

# 2. Build Release (expects sibling VideoStreamDownloader-Safari)
../VideoStreamDownloader-Safari/build-macos.sh
```

After cloning from GitHub:

```bash
./scripts/bootstrap-mac-deps.sh   # once — restores python/ffmpeg
open safari-app/Video\ Stream\ Downloader/Video\ Stream\ Downloader.xcodeproj
```

Install a local build to `/Applications`:

```bash
INSTALLER_APP="$(find ~/Library/Developer/Xcode/DerivedData -path '*/Release/Downpour.app' | head -1)" \
  ./scripts/install-downpour.sh
```

### Tests

```bash
node test/run-tests.mjs
```

### Build installer DMG

```bash
./scripts/build-installer.sh
```

Output: `dist/Downpour-<version>.dmg` (~150 MB installed, ~80 MB compressed).

Skip the Xcode rebuild when you already have a built app:

```bash
SKIP_BUILD=1 INSTALLER_APP=/Applications/Downpour.app ./scripts/build-installer.sh
```

For wider distribution, sign and notarize the app in Xcode before packaging.

### Publish to GitHub

Before committing changes that touch the Safari wrapper:

```bash
./scripts/publish-sync.sh
git add -A
git status   # python/ffmpeg should not appear
git commit -m "Your message"
git push
```

## Legal note

Only download content you have the right to save. Social downloads may read Safari cookies via yt-dlp. Downpour is not affiliated with YouTube, TikTok, Instagram, or X.