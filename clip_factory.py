import os
import asyncio
import json
import logging
import re
import shutil
import subprocess
from datetime import datetime
from yt_dlp import YoutubeDL

# Configuration
TEMP_DIR = "temp_processing"
CLIPS_DIR = "clips"
LOG_FILE = "pipeline.log"

# Ensure directories exist
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(CLIPS_DIR, exist_ok=True)

logger = logging.getLogger('clip_factory')
logger.setLevel(logging.INFO)

def setup_logger():
    logger.handlers.clear()
    fh = logging.FileHandler(LOG_FILE, mode='w')
    ch = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    fh.setFormatter(formatter)
    ch.setFormatter(formatter)
    logger.addHandler(fh)
    logger.addHandler(ch)

async def log_msg(level, message):
    if not logger.handlers:
        setup_logger()
    getattr(logger, level.lower())(message)

def sanitize_filename(name):
    return re.sub(r'[^a-zA-Z0-9]', '_', name).lower()[:50]

def hms_to_seconds(hms):
    """Convert HH:MM:SS or MM:SS or plain seconds to total seconds."""
    hms = hms.strip()
    if ':' not in hms:
        return int(float(hms))
    parts = hms.split(':')
    parts = [int(p) for p in parts]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    elif len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return int(parts[0])

def escape_drawtext(text):
    """Escape special characters for FFmpeg drawtext filter."""
    text = text.replace('\\', '\\\\')
    text = text.replace("'", "\\'")
    text = text.replace(':', '\\:')
    return text

async def download_4k_clip(url, start_time, duration, output_path, credit=None):
    """Get direct stream URL via yt-dlp, then let ffmpeg seek+cut precisely.
    Optionally burns a credit watermark into the bottom-left corner."""
    ffmpeg_path = shutil.which("ffmpeg") or "ffmpeg"
    ytdlp_path = shutil.which("yt-dlp") or "yt-dlp"

    try:
        proc = await asyncio.create_subprocess_exec(
            ytdlp_path,
            "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
            "--get-url", "--no-warnings", "--no-playlist",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        urls = [u.strip() for u in stdout.decode().strip().splitlines() if u.strip()]

        if not urls:
            raise Exception(f"yt-dlp returned no URL. stderr: {stderr.decode()[:300]}")

        # Build video filter chain — add drawtext if credit is provided
        FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        vf_parts = []
        if credit:
            escaped = escape_drawtext(credit)
            vf_parts.append(
                f"drawtext=fontfile='{FONT_PATH}':text='{escaped}'"
                f":fontsize=14:fontcolor=white:borderw=2:bordercolor=black"
                f":x=10:y=h-th-10"
            )
        vf = ",".join(vf_parts) if vf_parts else None

        if len(urls) >= 2:
            video_url, audio_url = urls[0], urls[1]
            cmd = [
                ffmpeg_path, "-y",
                "-ss", str(int(start_time)), "-i", video_url,
                "-ss", str(int(start_time)), "-i", audio_url,
                "-t", str(duration),
                "-map", "0:v:0", "-map", "1:a:0",
            ]
            if vf:
                cmd += ["-vf", vf]
            cmd += [
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                output_path,
            ]
        else:
            video_url = urls[0]
            cmd = [
                ffmpeg_path, "-y",
                "-ss", str(int(start_time)), "-i", video_url,
                "-t", str(duration),
            ]
            if vf:
                cmd += ["-vf", vf]
            cmd += [
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                output_path,
            ]

        ffproc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, ff_err = await ffproc.communicate()

        if os.path.exists(output_path) and os.path.getsize(output_path) > 10000:
            return True
        else:
            await log_msg("WARNING", f"ffmpeg produced empty/corrupt file for {output_path}. stderr: {ff_err.decode()[-300:]}")
            if os.path.exists(output_path):
                os.remove(output_path)
            return False

    except Exception as e:
        await log_msg("ERROR", f"Clip extraction failed for {url} at {start_time}s: {str(e)}")
        if os.path.exists(output_path):
            os.remove(output_path)
        return False


async def process_url_line(line_num, url, duration, start_time, credit=None):
    """
    Process one feed line — extract a single clip from url at start_time.
    Format: URL | duration | start_time | @credit (optional)
    """
    label = f"Line {line_num}"
    credit_info = f" | credit: {credit}" if credit else ""
    await log_msg("INFO", f"=== [{label}] Starting: {url} | {duration}s from {start_time}s{credit_info} ===")

    out = os.path.join(CLIPS_DIR, f"clip_s{line_num}.mp4")
    credit_log = f" (with credit: {credit})" if credit else ""
    await log_msg("INFO", f"[{label}] Extracting clip at {start_time}s → {out}{credit_log}")

    ok = await download_4k_clip(url, start_time, duration, out, credit=credit)
    if ok:
        await log_msg("INFO", f"[{label}] Done — saved to {out}")
    else:
        await log_msg("ERROR", f"[{label}] Extraction failed. Source may be geo-blocked — try Internet Archive.")

    await log_msg("INFO", f"=== [{label}] Finished ===")


async def run_factory(feed_text):
    setup_logger()
    await log_msg("INFO", f"--- Pipeline Started at {datetime.now()} ---")

    lines = [l.strip() for l in feed_text.strip().split('\n') if l.strip()]

    for line_num, line in enumerate(lines, start=1):
        # Format: URL | duration | start_time | @credit (optional)
        parts = [p.strip() for p in line.split('|')]
        if len(parts) < 3:
            await log_msg("WARNING", f"Skipping malformed line {line_num}: '{line}' — need URL | duration | start_time")
            continue

        url = parts[0]
        dur_str = parts[1]
        start_str = parts[2]
        credit = parts[3] if len(parts) >= 4 and parts[3] else None

        try:
            duration = int(dur_str)
        except ValueError:
            await log_msg("ERROR", f"Invalid duration '{dur_str}' on line {line_num} — skipping.")
            continue

        try:
            start_time = hms_to_seconds(start_str)
        except (ValueError, IndexError):
            await log_msg("ERROR", f"Invalid start time '{start_str}' on line {line_num} — use HH:MM:SS or seconds.")
            continue

        await process_url_line(line_num, url, duration, start_time, credit=credit)

    await log_msg("INFO", "--- Batch processing complete ---")
    await log_msg("INFO", f"--- Pipeline Finished at {datetime.now()} ---")

if __name__ == "__main__":
    pass
