#!/usr/bin/env python3
"""Chrome native messaging host for Downpour (macOS).

Handles file saves and optional yt-dlp / URL downloads into ~/Downloads.
Install with: ./install-native-host.sh
"""

from __future__ import annotations

import base64
import json
import os
import struct
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

HOST_VERSION = "1.0.0"
DOWNLOADS = Path.home() / "Downloads"
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
SUPPORT_YTDLP = Path.home() / "Library" / "Application Support" / "Downpour" / "yt-dlp.py"


def resolve_ytdlp_script() -> Path:
    for candidate in (SUPPORT_YTDLP, REPO_ROOT / "yt-dlp.py", SCRIPT_DIR / "yt-dlp.py"):
        if candidate.exists():
            return candidate
    return REPO_ROOT / "yt-dlp.py"

KNOWN_EXTENSIONS = {
    "mp4", "webm", "mov", "mkv", "m4v", "m4a",
    "jpg", "jpeg", "png", "webp", "gif", "heic",
}


def read_message() -> dict[str, Any] | None:
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len:
        return None
    length = struct.unpack("<I", raw_len)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def write_message(payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def sanitize(name: str, default_ext: str = "mp4") -> str:
    cleaned = "".join("_" if c in '/\\:*?"<>|' else c for c in name).strip()
    if not cleaned:
        cleaned = f"download.{default_ext}"
    lower = cleaned.lower()
    if not any(lower.endswith(f".{ext}") for ext in KNOWN_EXTENSIONS):
        cleaned += f".{default_ext}"
    return cleaned


def unique_path(directory: Path, filename: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    base = Path(filename).stem
    ext = Path(filename).suffix or ".mp4"
    candidate = directory / f"{base}{ext}"
    i = 1
    while candidate.exists():
        candidate = directory / f"{base} ({i}){ext}"
        i += 1
    return candidate


def save_to_downloads(data: dict[str, Any]) -> dict[str, Any]:
    b64 = data.get("data") or ""
    if not b64:
        return {"error": "No file data provided"}
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return {"error": "Could not decode file data"}
    filename = sanitize(data.get("filename") or "video.mp4")
    dest = unique_path(DOWNLOADS, filename)
    dest.write_bytes(raw)
    return {"ok": True, "path": str(dest), "bytes": len(raw)}


class DownloadJob:
    def __init__(self, token: str, url: str, filename: str, referer: str) -> None:
        self.token = token
        self.url = url
        self.filename = filename
        self.referer = referer
        self.state = "running"
        self.progress = 0
        self.message = "downloading…"
        self.path: str | None = None
        self.error: str | None = None
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        try:
            req = Request(
                self.url,
                headers={
                    "Referer": self.referer,
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                },
            )
            dest = unique_path(DOWNLOADS, self.filename)
            with urlopen(req, timeout=3600) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                received = 0
                chunk_size = 1024 * 256
                self.state = "saving"
                with dest.open("wb") as fh:
                    while True:
                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break
                        fh.write(chunk)
                        received += len(chunk)
                        if total > 0:
                            self.progress = min(98, int(received * 100 / total))
                            self.message = f"downloading {self.progress}%…"
                        else:
                            self.message = f"downloading {max(1, received // 1048576)} MB…"
            self.state = "done"
            self.progress = 100
            self.message = "done"
            self.path = str(dest)
        except Exception as exc:
            self.state = "error"
            self.error = str(exc)
            self.message = self.error

    def status(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": True,
            "state": self.state,
            "progress": self.progress,
            "message": self.message,
        }
        if self.path:
            payload["path"] = self.path
        if self.error:
            payload["error"] = self.error
        return payload


class YoutubeJob:
    def __init__(self, token: str, url: str, filename: str, quality: str) -> None:
        self.token = token
        self.url = url
        self.filename = filename
        self.quality = quality
        self.state = "running"
        self.progress = 0
        self.message = "starting yt-dlp…"
        self.path: str | None = None
        self.error: str | None = None
        self._proc: subprocess.Popen[str] | None = None
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _yt_dlp_cmd(self) -> tuple[list[str], str]:
        ytdlp = resolve_ytdlp_script()
        output_base = unique_path(DOWNLOADS, self.filename).with_suffix("").as_posix()
        cmd = [sys.executable, "-u", str(ytdlp), "--no-playlist", "--newline", "-o", output_base + ".%(ext)s"]
        if self.quality == "best":
            cmd.extend(["-f", "bestvideo+bestaudio/best"])
        else:
            cmd.extend(["-f", "bv*[height<=720]+ba/b[height<=720]/best[height<=720]"])
        cmd.append(self.url)
        return cmd, output_base

    def _run(self) -> None:
        ytdlp = resolve_ytdlp_script()
        if not ytdlp.exists():
            self.state = "error"
            self.error = f"yt-dlp.py not found (looked in {ytdlp})"
            self.message = self.error
            return
        cmd, output_base = self._yt_dlp_cmd()
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            assert self._proc.stdout is not None
            for line in self._proc.stdout:
                self.message = line.strip()[:120] or self.message
                if "[download]" in line and "%" in line:
                    try:
                        pct = int(line.split("%", 1)[0].rsplit(" ", 1)[-1])
                        self.progress = max(0, min(99, pct))
                    except ValueError:
                        pass
            code = self._proc.wait()
            if code != 0:
                self.state = "error"
                self.error = self.message or f"yt-dlp exited {code}"
                return
            matches = list(DOWNLOADS.glob(Path(output_base).name + ".*"))
            if not matches:
                matches = sorted(DOWNLOADS.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
            if matches:
                self.path = str(matches[0])
            self.state = "done"
            self.progress = 100
            self.message = "done"
        except Exception as exc:
            self.state = "error"
            self.error = str(exc)
            self.message = self.error

    def abort(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
        self.state = "cancelled"
        self.message = "cancelled"

    def status(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": True,
            "state": self.state,
            "progress": self.progress,
            "message": self.message,
        }
        if self.path:
            payload["path"] = self.path
        if self.error:
            payload["error"] = self.error
        return payload


DOWNLOAD_JOBS: dict[str, DownloadJob] = {}
YOUTUBE_JOBS: dict[str, YoutubeJob] = {}
TEMP_FILES: dict[str, Path] = {}


def download_url_begin(data: dict[str, Any]) -> dict[str, Any]:
    url = data.get("url") or ""
    if not url:
        return {"error": "No URL provided"}
    token = str(uuid.uuid4())
    filename = sanitize(data.get("filename") or "video.mp4")
    referer = data.get("referer") or "https://www.erome.com/"
    DOWNLOAD_JOBS[token] = DownloadJob(token, url, filename, referer)
    return {"ok": True, "token": token}


def download_url_status(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    job = DOWNLOAD_JOBS.get(token)
    if not job:
        return {"error": "Unknown download job"}
    payload = job.status()
    if payload.get("state") in ("done", "error", "cancelled"):
        DOWNLOAD_JOBS.pop(token, None)
    return payload


def youtube_begin(data: dict[str, Any]) -> dict[str, Any]:
    url = data.get("url") or ""
    if not url:
        return {"error": "No YouTube URL provided"}
    token = str(uuid.uuid4())
    filename = sanitize(data.get("filename") or "video.mp4")
    quality = "best" if data.get("quality") == "best" else "normal"
    YOUTUBE_JOBS[token] = YoutubeJob(token, url, filename, quality)
    return {"ok": True, "token": token}


def youtube_status(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    job = YOUTUBE_JOBS.get(token)
    if not job:
        return {"error": "Unknown YouTube download job"}
    payload = job.status()
    if payload.get("state") in ("done", "error", "cancelled"):
        YOUTUBE_JOBS.pop(token, None)
    return payload


def youtube_abort(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    job = YOUTUBE_JOBS.get(token)
    if job:
        job.abort()
        YOUTUBE_JOBS.pop(token, None)
    return {"ok": True}


def save_begin(data: dict[str, Any]) -> dict[str, Any]:
    token = str(uuid.uuid4())
    path = DOWNLOADS / f".downpour-{token}.part"
    path.touch()
    TEMP_FILES[token] = path
    return {"ok": True, "token": token}


def save_chunk(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    path = TEMP_FILES.get(token)
    if not path:
        return {"error": "Temp file missing"}
    b64 = data.get("data") or ""
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return {"error": "Could not decode chunk data"}
    with path.open("ab") as fh:
        fh.write(raw)
    return {"ok": True}


def save_end(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    path = TEMP_FILES.pop(token, None)
    if not path or not path.exists():
        return {"error": "Temp file missing"}
    filename = sanitize(data.get("filename") or "video.mp4")
    dest = unique_path(DOWNLOADS, filename)
    path.replace(dest)
    return {"ok": True, "path": str(dest)}


def save_abort(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    path = TEMP_FILES.pop(token, None)
    if path and path.exists():
        path.unlink()
    return {"ok": True}


def handle(message: dict[str, Any]) -> dict[str, Any]:
    msg_type = message.get("type")
    if msg_type == "saveToDownloads":
        return save_to_downloads(message)
    if msg_type == "saveBegin":
        return save_begin(message)
    if msg_type == "saveChunk":
        return save_chunk(message)
    if msg_type == "saveEnd":
        return save_end(message)
    if msg_type == "saveAbort":
        return save_abort(message)
    if msg_type == "downloadUrlBegin":
        return download_url_begin(message)
    if msg_type == "downloadUrlStatus":
        return download_url_status(message)
    if msg_type == "downloadUrlAbort":
        token = message.get("token") or ""
        DOWNLOAD_JOBS.pop(token, None)
        return {"ok": True}
    if msg_type == "youtubeBegin":
        return youtube_begin(message)
    if msg_type == "youtubeStatus":
        return youtube_status(message)
    if msg_type == "youtubeAbort":
        return youtube_abort(message)
    return {"echo": message, "hostVersion": HOST_VERSION}


def main() -> None:
    while True:
        message = read_message()
        if message is None:
            break
        write_message(handle(message))


if __name__ == "__main__":
    main()