# Downpour — Chrome Extension

Chromium port of Downpour. Shared UI and detection live in [`../safari-extension/`](../safari-extension/); Chrome-specific wiring is in `chrome-platform.js`, `background-entry.js`, and `native-host/`.

**Works on:** macOS, Windows, and Linux Chrome/Chromium (extension UI). **Full downloads** need the native helper on each OS.

---

## Quick install

### Extension only

```bash
cd downpour
./scripts/sync-chrome.sh
```

1. Open **`chrome://extensions`**
2. Enable **Developer mode**
3. **Load unpacked** → select this **`chrome-extension/`** folder
4. Pin **Downpour**

Or on macOS, run **`scripts/install-chrome-extension.sh`** (copies the extension to `~/Library/Application Support/Downpour/chrome-extension/` and opens Finder).

### Extension + native helper (recommended)

The native helper is **required** for:

- YouTube (yt-dlp)
- Tube sites (XVideos, Spankbang, etc.) via **This page**
- Reliable **Direct** / **HLS** CDN links (native HTTP download with Referer)
- Large files (streamed save without loading the whole video into the extension)

#### macOS

```bash
./scripts/bootstrap-chrome-ffmpeg.sh          # once; ffmpeg not stored in git
./native-host/install-native-host.sh YOUR_EXTENSION_ID
```

Find **YOUR_EXTENSION_ID** on `chrome://extensions` (32 characters).

Install puts files in:

- `~/Library/Application Support/Downpour/` — yt-dlp, ffmpeg, native host
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.dtek.downpour.json`

**Quit Chrome completely**, then reopen.

#### Windows

Prerequisites:

- [Python 3](https://www.python.org/downloads/) on PATH
- Optional: `winget install Gyan.FFmpeg` (or place `ffmpeg.exe` in `%APPDATA%\Downpour\ffmpeg\`)

```powershell
cd downpour
.\native-host\install-native-host.ps1 -ExtensionId YOUR_EXTENSION_ID
```

Install puts files in:

- `%APPDATA%\Downpour\`
- Registry: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.dtek.downpour`

**Quit Chrome completely**, then reopen.

#### Linux

`downpour_host.py` supports Linux paths; no automated installer yet. Manually install:

1. Copy `native-host/downpour_host.py` and repo-root `yt-dlp.py` to `~/.config/downpour/`
2. Create `~/.config/google-chrome/NativeMessagingHosts/com.dtek.downpour.json` from `com.dtek.downpour.json` (set `path` to `python3 …/downpour_host.py`, set your extension ID in `allowed_origins`)

---

## Using Downpour

1. Open a page with a video and **play it** briefly
2. Click the Downpour toolbar icon
3. Choose:
   - **This page** — yt-dlp extracts from the page URL (needs native helper)
   - **Direct** / **HLS** — download a captured CDN URL (needs native helper for large/restricted files on Chrome)
4. Or hover the video and click the **Save** overlay button

**Popup developer log:** expand **Show developer log** at the bottom of the popup for job messages (`starting yt-dlp…`, `downloading 42%…`, errors).

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| No **This page** card | Play the video; reload the extension |
| `starting yt-dlp…` then error | Site may not be supported by yt-dlp — try **Direct** / **HLS** instead |
| `downloading via page…` forever | Update to latest version; install native helper; try **Direct** link |
| `native messaging host not found` | Re-run install script with correct extension ID; quit Chrome fully |
| YouTube audio only | Run `bootstrap-chrome-ffmpeg.sh` or install system ffmpeg |
| Works in Safari, not Chrome | Install native helper — Chrome does not use the Safari app |

Verify the helper:

```bash
# macOS — after install
python3 ~/Library/Application\ Support/Downpour/native-host/downpour_host.py
# (will wait for stdin; Ctrl+C to exit — means Python can run the host)
```

On `chrome://extensions`, reload Downpour after any native-host reinstall.

---

## Feature matrix

| Feature | Extension only | + Native helper |
|---------|----------------|-----------------|
| Instagram / TikTok / X overlay | ✓ | ✓ |
| Generic site overlay | ✓ | ✓ |
| Popup lists detected URLs | ✓ | ✓ |
| Small direct saves | ✓ (`chrome.downloads`) | ✓ |
| Tube **This page** (yt-dlp) | ✗ | ✓ |
| YouTube 720p / Best | ✗ | ✓ |
| Large CDN / cross-origin direct | Unreliable | ✓ |
| HLS via yt-dlp | ✗ | ✓ |

---

## Development

Edit shared files in `safari-extension/`, then:

```bash
./scripts/sync-chrome.sh
```

Reload on `chrome://extensions`.

**Do not overwrite when syncing** (Chrome-only):

- `manifest.json`
- `background-entry.js`
- `chrome-platform.js`
- `native-host/`

`background-entry.js` loads: `platforms.js` → `chrome-platform.js` → `mux.min.js` → `background.js`.

### Native host layout

| File | Role |
|------|------|
| `downpour_host.py` | Native messaging: save files, yt-dlp jobs, URL downloads |
| `com.dtek.downpour.json` | Manifest template |
| `install-native-host.sh` | macOS installer |
| `install-native-host.ps1` | Windows installer |

Host version is in `HOST_VERSION` inside `downpour_host.py`.

---

## Platform notes

| | Safari app | Chrome |
|--|------------|--------|
| Saves | Native app → `~/Downloads` | Native helper or `chrome.downloads` |
| yt-dlp | Bundled in app | `yt-dlp.py` + native host |
| Cookies for yt-dlp | Safari | Chrome (`--cookies-from-browser chrome`) |
| Installer | DMG | Git clone + load unpacked |