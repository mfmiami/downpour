# Downpour

Save videos and images from the web with a Safari extension — hover overlay on Instagram, TikTok, X, and generic sites, plus a popup for YouTube and detected streams.

## Repository layout

| Path | Purpose |
|------|---------|
| `/` | Extension source (Manifest V3 JS) — edit here |
| `safari-app/` | macOS Safari wrapper (Xcode project, synced before publish) |
| `sync-to-safari.sh` | Copy extension JS → live Xcode `Resources/` |
| `scripts/publish-sync.sh` | Refresh `safari-app/` from your local Xcode project |
| `scripts/bootstrap-mac-deps.sh` | Install bundled Python + ffmpeg after clone |

During day-to-day development you may keep the Xcode project at  
`../VideoStreamDownloader-Safari/` (sibling folder). Run `sync-to-safari.sh` after editing extension files.

## Build (macOS)

```bash
# 1. Sync extension source into your Xcode project
./sync-to-safari.sh

# 2. Build (expects sibling VideoStreamDownloader-Safari, or use safari-app/)
../VideoStreamDownloader-Safari/build-macos.sh
```

After cloning from GitHub:

```bash
./scripts/bootstrap-mac-deps.sh   # once — restores python/ffmpeg
open safari-app/Video\ Stream\ Downloader/Video\ Stream\ Downloader.xcodeproj
```

## Tests

```bash
node test/run-tests.mjs
```

## Publish to GitHub (first time)

1. **Create an empty repo** on [github.com/new](https://github.com/new)  
   - Name: `downpour` (or your choice)  
   - Private recommended (video downloader + cookie access)  
   - Do **not** add README, .gitignore, or license (we have them locally)

2. **Sync the Safari wrapper into this repo** (excludes large binaries):

   ```bash
   ./scripts/publish-sync.sh
   ```

3. **Commit and push** (replace `YOUR_USER` and repo name):

   ```bash
   git add -A
   git status   # review — python/ffmpeg should not appear
   git commit -m "Initial commit: Downpour v2.12.3"
   git branch -M main
   git remote add origin git@github.com:YOUR_USER/downpour.git
   git push -u origin main
   ```

   HTTPS alternative:

   ```bash
   git remote add origin https://github.com/YOUR_USER/downpour.git
   git push -u origin main
   ```

4. **GitHub auth** — if push asks for credentials:
   - SSH: add your public key in GitHub → Settings → SSH keys, use `git@github.com:...` remote
   - HTTPS: use a [Personal Access Token](https://github.com/settings/tokens) as the password

## Legal note

Only download content you have the right to save. Social downloads may read Safari cookies via yt-dlp. Not affiliated with YouTube, TikTok, Instagram, or X.