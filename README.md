# Downpour

Save videos from the web — hover overlays on Instagram, TikTok, X, and generic sites, plus a popup for detected streams and page downloads.

| Platform | Install |
|----------|---------|
| **macOS Safari** | [`releases/Downpour.dmg`](releases/Downpour.dmg) or [GitHub Releases](https://github.com/mfmiami/downpour/releases) |
| **Chrome / Chromium** | Load unpacked from this repo (see below) |

**Current version:** `2.12.45` (see `safari-extension/manifest.json`)

---

## macOS — Safari (recommended)

1. Open **`releases/Downpour.dmg`** (or download from [GitHub Releases](https://github.com/mfmiami/downpour/releases))
2. Double-click **`Install Downpour.command`**
3. Choose **Safari**, **Chrome**, or **Both**
4. **Safari:** **Settings → Extensions** → enable **Downpour**
5. **Chrome:** follow the prompts (`chrome://extensions` → Developer mode → **Load unpacked**)

If macOS blocks the app: right-click **Downpour.app → Open → Open** once, then quit and reopen Safari.

---

## Chrome / Chromium — manual install

The extension JS runs on **macOS, Windows, and Linux** Chrome. **Tube-site downloads, YouTube, and reliable large CDN saves** need the optional **native helper** (Python + yt-dlp).

### 1. Get the extension

```bash
git clone https://github.com/mfmiami/downpour.git
cd downpour
./scripts/sync-chrome.sh
```

In Chrome: **`chrome://extensions`** → turn on **Developer mode** → **Load unpacked** → select the **`chrome-extension/`** folder.

Copy the **extension ID** from that page (32-character string). You need it for the native helper.

### 2. Install the native helper (required for most video sites on Chrome)

The helper saves files to your **Downloads** folder and runs **yt-dlp** with your **Chrome cookies**.

#### macOS

```bash
./scripts/bootstrap-chrome-ffmpeg.sh    # optional; ~63MB ffmpeg (not in git)
./chrome-extension/native-host/install-native-host.sh YOUR_EXTENSION_ID
```

Requires **Python 3** (`python3` on PATH). If ffmpeg bootstrap fails: `brew install ffmpeg`.

**Quit Chrome completely** and reopen.

#### Windows

1. Install **Python 3** from [python.org](https://www.python.org/downloads/) (check **Add python.exe to PATH**)
2. Optional: `winget install Gyan.FFmpeg` (for HLS / best-quality merges)
3. In PowerShell, from the repo root:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\chrome-extension\native-host\install-native-host.ps1 -ExtensionId YOUR_EXTENSION_ID
```

**Quit Chrome completely** and reopen.

#### Linux

Native host Python code supports Linux paths, but there is no installer script yet. Register `com.dtek.downpour.json` under:

`~/.config/google-chrome/NativeMessagingHosts/`

Point `path` at `python3 /path/to/downpour_host.py`. Copy `yt-dlp.py` from the repo root to `~/.config/downpour/yt-dlp.py`.

### 3. Use it

| Site type | What to click |
|-----------|----------------|
| **Tube / generic video pages** | Popup → **This page** (yt-dlp), or a **Direct** / **HLS** link if yt-dlp does not support the site |
| **YouTube** | Popup → **Download** (Normal 720p / Best) |
| **TikTok / X / Instagram** | Hover **Save** on the video |
| **Other sites** | Hover **Save** on the video, or pick a detected URL in the popup |

Open the popup **developer log** (bottom of popup) if a download fails — paste the error when reporting issues.

### What works without the native helper

| Feature | Without helper | With helper |
|---------|----------------|-------------|
| Overlay on social / generic sites | ✓ | ✓ |
| Small direct downloads | ✓ (browser Downloads API) | ✓ |
| Tube sites, YouTube, large CDN files | ✗ | ✓ |
| yt-dlp page downloads | ✗ | ✓ |

---

## After cloning (developers)

```bash
./scripts/bootstrap-mac-deps.sh     # Safari Xcode build (python + ffmpeg)
./scripts/bootstrap-chrome-ffmpeg.sh # Chrome native host ffmpeg (macOS binary)
node test/run-tests.mjs
```

### Edit shared extension code

Work in **`safari-extension/`**, then sync:

```bash
./scripts/sync-safari.sh   # → ../Downpour-Safari (if present)
./scripts/sync-chrome.sh   # → chrome-extension/
```

Reload the extension in Chrome or rebuild the Safari app.

### Build Safari DMG

```bash
./scripts/build-installer.sh
```

---

## Repository layout

| Path | Purpose |
|------|---------|
| `safari-extension/` | Shared extension source (MV3 JS) |
| `chrome-extension/` | Chrome port + `native-host/` |
| `safari-app/` | macOS Xcode project |
| `releases/` | Installer DMG |
| `scripts/` | Sync, build, install scripts |
| `yt-dlp.py` | Bundled yt-dlp (copied into native helper on install) |

More detail: [`chrome-extension/README.md`](chrome-extension/README.md)

---

## Legal note

Only download content you have the right to save. Social and tube downloads may read **browser cookies** via yt-dlp. Downpour is not affiliated with YouTube, TikTok, Instagram, or X.