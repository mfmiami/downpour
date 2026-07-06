# Downpour — macOS Safari Extension

Host app and Safari web extension for [Downpour](../videodownload). **macOS only.**

## Build & run

```bash
open Downpour/Downpour.xcodeproj
```

Select the **Downpour** scheme and press **Run** (⌘R), then enable the extension in **Safari → Settings → Extensions**.

## Extension source

Edit JavaScript in the sibling `videodownload/` repo, then sync:

```bash
../videodownload/sync-to-safari.sh
```

## Release build

```bash
./build-macos.sh
```

Package an installer DMG from the extension repo:

```bash
../videodownload/scripts/build-installer.sh
```