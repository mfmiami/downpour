# Downpour — macOS App (Safari)

Host app and Safari web extension wrapper for [Downpour](../). **macOS only.**

The **web extension JavaScript** lives in [`../safari-extension/`](../safari-extension/). This folder holds the Xcode project, Swift native bridge, and bundled yt-dlp runtime.

## Develop

1. Edit JS in `../safari-extension/`
2. Sync into the live Xcode tree:

   ```bash
   ../scripts/sync-safari.sh
   ```

3. Build:

   ```bash
   ../Downpour-Safari/build-macos.sh
   # or from this folder:
   ./build-macos.sh
   ```

## Installer

```bash
../scripts/build-installer.sh
```

Output: `../releases/Downpour-<version>.dmg`