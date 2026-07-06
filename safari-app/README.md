# Downpour — Safari Web Extension

macOS host app and Safari web extension for [Downpour](../videodownload).

## Build & run

1. Open `Downpour/Downpour.xcodeproj` in Xcode.
2. Select the **Downpour (macOS)** scheme and press **Run** (⌘R).
3. Open **Safari → Settings → Extensions** and enable **Downpour**.
4. Grant the extension access on the sites you use.

## Extension source

Extension JavaScript is edited in the sibling `videodownload/` repo. After changes:

```bash
../videodownload/sync-to-safari.sh
```

That copies files into `Downpour/Shared (Extension)/Resources/`.

## Release build

```bash
./build-macos.sh
```