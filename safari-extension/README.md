# Downpour — Safari Web Extension

Canonical source for the Downpour web extension (Manifest V3). The macOS host app and Swift native bridge live in `../safari-app/` and `../../Downpour-Safari/`.

## Layout

| Path | Contents |
|------|----------|
| `manifest.json` | Extension manifest (version source of truth) |
| `background.js` | Service worker — downloads, job queue |
| `content.js` | Page bridge, tab fetch, video detection |
| `overlay.js` | In-page save button |
| `platforms.js` | URL detection and platform helpers |
| `popup.html` / `popup.js` | Toolbar popup |
| `instagram*.js`, `tiktok*.js`, `social*.js` | Social site extractors |
| `mux.min.js` | HLS transmux (loaded by background) |
| `icons/` | Extension icons |

## Sync to Xcode

After editing files here:

```bash
./scripts/sync-safari.sh
# or the back-compat wrapper:
./sync-to-safari.sh
```

Copies into `../Downpour-Safari/Downpour/Shared (Extension)/Resources/` and checks version against Xcode `MARKETING_VERSION`.

## Build & install

```bash
./scripts/sync-safari.sh
../Downpour-Safari/build-macos.sh
./scripts/install-downpour.sh
```

## Chrome port

Shared JS is synced to `../chrome-extension/`:

```bash
./scripts/sync-chrome.sh
```

Chrome-only files (`chrome-platform.js`, `background-entry.js`, `native-host/`) stay in `chrome-extension/`.

## Tests

```bash
node test/run-tests.mjs
```

Tests read `platforms.js` and `instagram.js` from this folder.