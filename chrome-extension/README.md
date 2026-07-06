# Downpour — Chrome Extension

Chrome port of the Downpour video downloader. Shares the same content scripts, overlay, and popup as [`../safari-extension/`](../safari-extension/).

## Quick start (unpacked)

1. Sync shared source from `safari-extension/`:

   ```bash
   ./scripts/sync-chrome.sh
   ```

2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select this `chrome-extension/` folder
5. Pin **Downpour** and allow it on the sites you use

## What works out of the box

| Feature | Chrome (no native host) | With native host |
|---------|-------------------------|------------------|
| Generic / erome direct video | ✓ via page fetch + `chrome.downloads` | ✓ |
| Instagram / TikTok / X overlay | ✓ | ✓ |
| Popup stream / direct downloads | ✓ | ✓ |
| YouTube yt-dlp (720p / best) | ✗ | ✓ |
| Large chunked saves | ✓ via `chrome.downloads` | ✓ |

**Erome:** uses the in-page fetch path (album Referer) instead of the Safari native downloader.

**Saves:** files go to your browser Downloads folder via the Chrome Downloads API.

## Optional: native host (YouTube + yt-dlp)

For YouTube and other yt-dlp jobs, install the native messaging helper (macOS):

```bash
# Load the extension first, copy its ID from chrome://extensions
./native-host/install-native-host.sh YOUR_EXTENSION_ID
```

Requires Python 3 and `yt-dlp.py` at the repo root (same script bundled in the Safari app).

## Development

After editing shared files in `safari-extension/` (`background.js`, `overlay.js`, etc.):

```bash
./scripts/sync-chrome.sh
```

Then click **Reload** on `chrome://extensions`.

Chrome-only files (do not overwrite when syncing):

- `manifest.json`
- `background-entry.js`
- `chrome-platform.js`
- `native-host/`

## Platform differences

| Safari | Chrome |
|--------|--------|
| Native app writes to `~/Downloads` | `chrome.downloads` API |
| Erome via `URLSession` + Referer | Page-context fetch + downloads API |
| yt-dlp via host app | yt-dlp via optional native host |
| DMG installer | Load unpacked / Web Store |

Shared logic lives in `safari-extension/`; `chrome-platform.js` sets `globalThis.__downpour*` hooks before `background.js` loads.