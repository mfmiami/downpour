#!/usr/bin/env python3
"""Chrome native messaging host for Downpour (macOS).

Handles file saves and optional yt-dlp / URL downloads into ~/Downloads.
Install with: ./install-native-host.sh
"""

from __future__ import annotations

import base64
import json
import os
import re
import struct
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

HOST_VERSION = "1.0.8"
DOWNLOADS = Path.home() / "Downloads"
SCRIPT_DIR = Path(__file__).resolve().parent
SUPPORT_DIR = Path.home() / "Library" / "Application Support" / "Downpour"
SUPPORT_YTDLP = SUPPORT_DIR / "yt-dlp.py"
LOG_PATH = SUPPORT_DIR / "native-host.log"
JOBS_DIR = SUPPORT_DIR / "jobs"


def resolve_ytdlp_script() -> Path:
    for candidate in (SUPPORT_YTDLP, SCRIPT_DIR / "yt-dlp.py"):
        if candidate.exists():
            return candidate
    return SUPPORT_YTDLP


def resolve_ffmpeg_dir() -> str | None:
    for directory in (SUPPORT_DIR / "ffmpeg", SCRIPT_DIR / "ffmpeg"):
        binary = directory / "ffmpeg"
        if binary.is_file() and os.access(binary, os.X_OK):
            return str(directory)

    search_dirs: list[Path] = []
    for part in os.environ.get("PATH", "").split(os.pathsep):
        if part:
            search_dirs.append(Path(part))
    search_dirs.extend([
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
        Path("/usr/bin"),
    ])
    seen: set[str] = set()
    for directory in search_dirs:
        key = str(directory)
        if key in seen:
            continue
        seen.add(key)
        binary = directory / "ffmpeg"
        if binary.is_file() and os.access(binary, os.X_OK):
            return key
    return None


AUDIO_ONLY_EXTENSIONS = {".m4a", ".aac", ".opus", ".mp3", ".oga", ".wav", ".flac"}


def log_error(message: str) -> None:
    try:
        SUPPORT_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(message.rstrip() + "\n")
    except Exception:
        pass

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


def url_job_path(token: str) -> Path:
    return JOBS_DIR / f"url-{token}.json"


def read_url_job(token: str) -> dict[str, Any] | None:
    path = url_job_path(token)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_url_job(state: dict[str, Any]) -> None:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    url_job_path(state["token"]).write_text(
        json.dumps(state, ensure_ascii=False),
        encoding="utf-8",
    )


def url_status_payload(state: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": True,
        "state": state.get("state", "running"),
        "progress": state.get("progress", 0),
        "message": state.get("message", "downloading…"),
    }
    if state.get("path"):
        payload["path"] = state["path"]
    if state.get("error"):
        payload["error"] = state["error"]
    return payload


def run_url_download_worker(token: str) -> None:
    state = read_url_job(token)
    if not state:
        return
    url = state.get("url") or ""
    referer = state.get("referer") or "https://www.erome.com/"
    dest = Path(state.get("dest") or "")
    if not url or not dest:
        state["state"] = "error"
        state["error"] = "Invalid download job"
        state["message"] = state["error"]
        write_url_job(state)
        return
    try:
        req = Request(
            url,
            headers={
                "Referer": referer,
                "Origin": "https://www.erome.com" if "erome.com" in referer else referer,
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            },
        )
        with urlopen(req, timeout=3600) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            received = 0
            chunk_size = 1024 * 256
            state["state"] = "saving"
            with dest.open("wb") as fh:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    fh.write(chunk)
                    received += len(chunk)
                    if total > 0:
                        state["progress"] = min(98, int(received * 100 / total))
                        state["message"] = f"downloading {state['progress']}%…"
                    else:
                        state["message"] = f"downloading {max(1, received // 1048576)} MB…"
                    write_url_job(state)
        state["state"] = "done"
        state["progress"] = 100
        state["message"] = "done"
        state["path"] = str(dest)
    except Exception as exc:
        state["state"] = "error"
        state["error"] = str(exc)
        state["message"] = state["error"]
        if dest.exists() and dest.stat().st_size == 0:
            try:
                dest.unlink()
            except Exception:
                pass
    write_url_job(state)


def poll_url_job(token: str) -> dict[str, Any]:
    state = read_url_job(token)
    if not state:
        return {"error": "Unknown download job"}

    current_state = state.get("state", "running")
    if current_state in ("done", "error", "cancelled"):
        return url_status_payload(state)

    pid = int(state.get("pid") or 0)
    if pid_alive(pid):
        return url_status_payload(state)

    dest = Path(state.get("dest") or "")
    if dest.exists() and dest.stat().st_size > 32768:
        state["state"] = "done"
        state["progress"] = 100
        state["message"] = "done"
        state["path"] = str(dest)
        write_url_job(state)
        return url_status_payload(state)

    state["state"] = "error"
    state["error"] = state.get("error") or state.get("message") or "download exited unexpectedly"
    state["message"] = state["error"]
    write_url_job(state)
    return url_status_payload(state)


def youtube_job_path(token: str) -> Path:
    return JOBS_DIR / f"{token}.json"


def youtube_log_path(token: str) -> Path:
    return JOBS_DIR / f"{token}.log"


def read_youtube_job(token: str) -> dict[str, Any] | None:
    path = youtube_job_path(token)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_youtube_job(state: dict[str, Any]) -> None:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    youtube_job_path(state["token"]).write_text(
        json.dumps(state, ensure_ascii=False),
        encoding="utf-8",
    )


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def parse_ytdlp_line(line: str) -> tuple[str, int | None]:
    message = line.strip()[:120] or ""
    progress = None
    if "[download]" in line and "%" in line:
        try:
            pct = float(line.split("%", 1)[0].rsplit(" ", 1)[-1])
            progress = max(0, min(99, int(pct)))
        except ValueError:
            pass
    return message, progress


def sync_youtube_job_from_log(state: dict[str, Any]) -> dict[str, Any]:
    log_path = youtube_log_path(state["token"])
    if not log_path.exists():
        return state
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return state
    for line in reversed(lines):
        message, progress = parse_ytdlp_line(line)
        if message:
            state["message"] = message
        if progress is not None:
            state["progress"] = progress
            break
        if message and state.get("progress", 0) == 0:
            break
    return state


def youtube_output_candidates(output_base: str) -> list[Path]:
    base_name = Path(output_base).name
    return [
        p for p in DOWNLOADS.glob(base_name + ".*")
        if p.is_file()
        and not p.name.endswith(".part")
        and not re.search(r"\.f\d+\.", p.name)
        and p.suffix.lower() not in AUDIO_ONLY_EXTENSIONS
    ]


def pick_youtube_output(matches: list[Path]) -> Path | None:
    if not matches:
        return None
    ext_rank = {".mp4": 3, ".mkv": 2, ".webm": 1}

    def rank(path: Path) -> tuple[int, float]:
        return (ext_rank.get(path.suffix.lower(), 0), path.stat().st_mtime)

    return max(matches, key=rank)


def find_youtube_output(output_base: str) -> Path | None:
    return pick_youtube_output(youtube_output_candidates(output_base))


def youtube_status_payload(state: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": True,
        "state": state.get("state", "running"),
        "progress": state.get("progress", 0),
        "message": state.get("message", "starting yt-dlp…"),
    }
    if state.get("path"):
        payload["path"] = state["path"]
    if state.get("error"):
        payload["error"] = state["error"]
    return payload


def is_social_media_url(url: str) -> bool:
    lower = url.lower()
    return any(
        host in lower
        for host in ("tiktok.com", "instagram.com", "twitter.com", "x.com")
    )


def build_yt_dlp_cmd(url: str, filename: str, quality: str) -> tuple[list[str], str]:
    ytdlp = resolve_ytdlp_script()
    output_base = unique_path(DOWNLOADS, filename).with_suffix("").as_posix()
    cmd = [
        sys.executable, "-u", str(ytdlp),
        "--no-playlist", "--newline",
        "-o", output_base + ".%(ext)s",
    ]
    if is_social_media_url(url):
        cmd.extend([
            "--cookies-from-browser", "chrome",
            "--impersonate", "chrome-133:macos-15",
            "--retries", "3",
            "--fragment-retries", "3",
        ])
    ffmpeg_dir = resolve_ffmpeg_dir()
    if ffmpeg_dir:
        cmd.extend(["--ffmpeg-location", ffmpeg_dir])
    if quality == "best":
        cmd.extend([
            "-f", "bv*+ba/b",
            "--merge-output-format", "mp4",
            "-S", "ext:mp4:m4a",
        ])
    else:
        cmd.extend([
            "-f",
            "b[height<=720][ext=mp4][vcodec!=none][acodec!=none]/"
            "b[height<=720][ext=mp4]/b[height<=720]/b[ext=mp4]/"
            "bv*[height<=720]+ba/b[height<=720]/best[height<=720]",
            "--merge-output-format", "mp4",
        ])
    cmd.append(url)
    return cmd, output_base


def poll_youtube_job(token: str) -> dict[str, Any]:
    state = read_youtube_job(token)
    if not state:
        return {"error": "Unknown YouTube download job"}

    current_state = state.get("state", "running")
    if current_state in ("done", "error", "cancelled"):
        return youtube_status_payload(state)

    state = sync_youtube_job_from_log(state)
    pid = int(state.get("pid") or 0)
    output_base = state.get("output_base") or ""

    if pid_alive(pid):
        write_youtube_job(state)
        return youtube_status_payload(state)

    fragments = youtube_output_candidates(output_base) if output_base else []
    if output_base and not fragments:
        temp_frags = [
            p for p in DOWNLOADS.glob(Path(output_base).name + ".*")
            if p.is_file() and re.search(r"\.f\d+\.", p.name)
        ]
        if temp_frags:
            state["message"] = state.get("message") or "merging…"
            write_youtube_job(state)
            return youtube_status_payload(state)

    output = pick_youtube_output(fragments) if fragments else None
    if output:
        state["state"] = "done"
        state["progress"] = 100
        state["message"] = "done"
        state["path"] = str(output)
        write_youtube_job(state)
        return youtube_status_payload(state)

    if output_base:
        audio_only = [
            p for p in DOWNLOADS.glob(Path(output_base).name + ".*")
            if p.is_file()
            and not p.name.endswith(".part")
            and not re.search(r"\.f\d+\.", p.name)
            and p.suffix.lower() in AUDIO_ONLY_EXTENSIONS
        ]
        if audio_only:
            state["state"] = "error"
            state["error"] = (
                "Downloaded audio only — video merge needs ffmpeg. "
                "Install with: brew install ffmpeg"
            )
            state["message"] = state["error"]
            write_youtube_job(state)
            return youtube_status_payload(state)

    log_path = youtube_log_path(token)
    log_tail = ""
    if log_path.exists():
        try:
            log_tail = log_path.read_text(encoding="utf-8", errors="replace")[-2000:]
        except Exception:
            pass

    if re_error := _ytdlp_log_error(log_tail):
        state["state"] = "error"
        state["error"] = re_error
        state["message"] = re_error
    else:
        state["state"] = "error"
        state["error"] = state.get("message") or "yt-dlp exited unexpectedly"
        state["message"] = state["error"]

    write_youtube_job(state)
    return youtube_status_payload(state)


def _ytdlp_log_error(log_tail: str) -> str | None:
    if not log_tail:
        return None
    for line in reversed(log_tail.splitlines()):
        stripped = line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        if "error:" in lower or "traceback" in lower:
            return stripped[:200]
    return None


PART_FILE_RE = re.compile(r"^\.downpour-[0-9a-f-]+\.part$", re.I)
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def resolve_part_path(token: str) -> Path | None:
    """Resolve a chunked-save token to a temp .part file under Downloads.

    Chrome native messaging starts a fresh host process per message, so temp
    paths must be recovered from the token (full path or UUID), not memory.
    """
    if not token:
        return None
    downloads = DOWNLOADS.resolve()
    if UUID_RE.match(token):
        candidate = (downloads / f".downpour-{token}.part").resolve()
    else:
        try:
            candidate = Path(token).resolve()
        except Exception:
            return None
    try:
        candidate.relative_to(downloads)
    except ValueError:
        return None
    if not PART_FILE_RE.match(candidate.name):
        return None
    return candidate


def download_url_begin(data: dict[str, Any]) -> dict[str, Any]:
    url = data.get("url") or ""
    if not url:
        return {"error": "No URL provided"}
    token = str(uuid.uuid4())
    filename = sanitize(data.get("filename") or "video.mp4")
    referer = data.get("referer") or "https://www.erome.com/"
    dest = unique_path(DOWNLOADS, filename)
    state = {
        "token": token,
        "url": url,
        "filename": filename,
        "referer": referer,
        "dest": str(dest),
        "state": "running",
        "progress": 0,
        "message": "downloading…",
    }
    write_url_job(state)
    host_py = Path(__file__).resolve()
    try:
        proc = subprocess.Popen(
            [sys.executable, str(host_py), "--download-url", token],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:
        return {"error": str(exc)}
    state["pid"] = proc.pid
    write_url_job(state)
    return {"ok": True, "token": token}


def download_url_status(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    if not token:
        return {"error": "No download token provided"}
    payload = poll_url_job(token)
    if payload.get("state") in ("done", "error", "cancelled"):
        try:
            url_job_path(token).unlink(missing_ok=True)
        except Exception:
            pass
    return payload


def youtube_begin(data: dict[str, Any]) -> dict[str, Any]:
    url = data.get("url") or ""
    if not url:
        return {"error": "No YouTube URL provided"}
    ytdlp = resolve_ytdlp_script()
    if not ytdlp.exists():
        return {"error": f"yt-dlp.py not found (looked in {ytdlp})"}

    token = str(uuid.uuid4())
    filename = sanitize(data.get("filename") or "video.mp4")
    quality = "best" if data.get("quality") == "best" else "normal"
    cmd, output_base = build_yt_dlp_cmd(url, filename, quality)
    log_path = youtube_log_path(token)

    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    log_fh = log_path.open("w", encoding="utf-8")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
    except Exception as exc:
        log_fh.close()
        return {"error": str(exc)}
    log_fh.close()

    state = {
        "token": token,
        "url": url,
        "filename": filename,
        "quality": quality,
        "output_base": output_base,
        "pid": proc.pid,
        "state": "running",
        "progress": 0,
        "message": "starting yt-dlp…",
    }
    write_youtube_job(state)
    return {"ok": True, "token": token}


def youtube_status(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    if not token:
        return {"error": "No download token provided"}
    payload = poll_youtube_job(token)
    if payload.get("state") in ("done", "error", "cancelled"):
        for path in (youtube_job_path(token), youtube_log_path(token)):
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass
    return payload


def youtube_abort(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    state = read_youtube_job(token)
    if state:
        pid = int(state.get("pid") or 0)
        if pid_alive(pid):
            try:
                os.kill(pid, 15)
            except OSError:
                pass
        state["state"] = "cancelled"
        state["message"] = "cancelled"
        write_youtube_job(state)
    for path in (youtube_job_path(token), youtube_log_path(token)):
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True}


def save_begin(data: dict[str, Any]) -> dict[str, Any]:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    path = DOWNLOADS / f".downpour-{uuid.uuid4()}.part"
    path.touch()
    return {"ok": True, "token": str(path)}


def save_chunk(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    path = resolve_part_path(token)
    if not path or not path.exists():
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
    path = resolve_part_path(token)
    if not path or not path.exists():
        return {"error": "Temp file missing"}
    filename = sanitize(data.get("filename") or "video.mp4")
    dest = unique_path(DOWNLOADS, filename)
    path.replace(dest)
    return {"ok": True, "path": str(dest)}


def save_abort(data: dict[str, Any]) -> dict[str, Any]:
    token = data.get("token") or ""
    path = resolve_part_path(token)
    if path and path.exists():
        path.unlink()
    return {"ok": True}


def handle(message: dict[str, Any]) -> dict[str, Any]:
    msg_type = message.get("type")
    if msg_type == "ping":
        ytdlp = resolve_ytdlp_script()
        ffmpeg_dir = resolve_ffmpeg_dir()
        return {
            "ok": True,
            "hostVersion": HOST_VERSION,
            "ytdlp": str(ytdlp),
            "ytdlpExists": ytdlp.exists(),
            "ffmpeg": str(Path(ffmpeg_dir) / "ffmpeg") if ffmpeg_dir else None,
            "ffmpegExists": ffmpeg_dir is not None,
        }
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
        state = read_url_job(token)
        if state:
            pid = int(state.get("pid") or 0)
            if pid_alive(pid):
                try:
                    os.kill(pid, 15)
                except OSError:
                    pass
            state["state"] = "cancelled"
            state["message"] = "cancelled"
            write_url_job(state)
        try:
            url_job_path(token).unlink(missing_ok=True)
        except Exception:
            pass
        return {"ok": True}
    if msg_type == "youtubeBegin":
        return youtube_begin(message)
    if msg_type == "youtubeStatus":
        return youtube_status(message)
    if msg_type == "youtubeAbort":
        return youtube_abort(message)
    return {"echo": message, "hostVersion": HOST_VERSION}


def main() -> None:
    try:
        while True:
            message = read_message()
            if message is None:
                break
            try:
                write_message(handle(message))
            except Exception as exc:
                log_error(f"handle error: {exc!r}")
                write_message({"ok": False, "error": str(exc)})
    except Exception as exc:
        log_error(f"host fatal: {exc!r}")
        raise


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--download-url":
        run_url_download_worker(sys.argv[2])
    else:
        main()