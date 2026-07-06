# Video Stream Downloader — Safari Web Extension

This Xcode project was generated from the Chrome (Manifest V3) extension in
`../videodownload` using Apple's `safari-web-extension-converter`. It contains
macOS and iOS app + extension targets that wrap the same web-extension code.

## Running it (macOS)

1. Open `Video Stream Downloader/Video Stream Downloader.xcodeproj` in Xcode.
2. Select the **Video Stream Downloader (macOS)** scheme and press **Run** (⌘R).
   The container app launches.
3. In Safari, enable the dev menu: **Settings → Advanced → "Show features for
   web developers"**.
4. **Settings → Developer → "Allow unsigned extensions"** (re-check after each
   Safari restart while developing without a paid signing identity).
5. **Settings → Extensions** → enable **Video Stream Downloader**, and grant it
   access to websites (this extension requests all sites for stream detection).

For distribution you need an Apple Developer signing identity; for local testing
the "Allow unsigned extensions" toggle is enough.

## What changed from the Chrome version

Safari Web Extensions do **not** implement the `chrome.downloads` API, which the
original used. The popup now saves files via an object-URL + anchor click
(`saveBlob`), and direct (non-stream) downloads are fetched into a Blob first so
cross-origin files actually save instead of opening in a tab (`downloadDirect`).
Unused `storage`/`downloads` permissions were removed and the SVG toolbar icon
was rasterized to PNGs (Safari renders PNG toolbar icons more reliably).

To re-sync after further edits to the source extension, re-run the converter
with `--force`, or edit the copied resources under
`Video Stream Downloader/Shared (Extension)/Resources/`.

## Compatibility notes / caveats

- `webRequest.onBeforeRequest` is observe-only here and is supported by Safari
  for stream URL detection.
- Encrypted streams (AES `#EXT-X-KEY`, DRM) remain unsupported, same as before.
- iOS targets are included but Safari-on-iOS extension behavior (especially
  background `webRequest` detection) is more limited than macOS.
