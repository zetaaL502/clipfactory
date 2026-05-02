import os
import asyncio
import json
import logging
import re
import shutil
from datetime import datetime
from yt_dlp import YoutubeDL

TEMP_DIR = "temp_processing"
CLIPS_DIR = "clips"
LOG_FILE = "pipeline.log"

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

def parse_duration(s):
    """Parse duration: '8sec', '2min', '1min30sec', '90', '8s', '2m' → seconds."""
    s = s.strip().lower()
    try:
        return int(float(s))
    except ValueError:
        pass
    total = 0
    min_match = re.search(r'(\d+)\s*m(?:in)?', s)
    sec_match = re.search(r'(\d+)\s*s(?:ec)?', s)
    if min_match:
        total += int(min_match.group(1)) * 60
    if sec_match:
        total += int(sec_match.group(1))
    if total > 0:
        return total
    raise ValueError(f"Cannot parse duration: '{s}' — use e.g. 8, 8sec, 2min, 1min30sec")

def hms_to_seconds(hms):
    """Convert HH:MM:SS or MM:SS or plain seconds to total seconds."""
    hms = hms.strip()
    if ':' not in hms:
        return int(float(hms))
    parts = [int(p) for p in hms.split(':')]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    elif len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return int(parts[0])

def escape_drawtext(text):
    text = text.replace('\\', '\\\\')
    text = text.replace("'", "\\'")
    text = text.replace(':', '\\:')
    return text

async def get_video_duration_url(url):
    """Get total video duration in seconds via yt-dlp --dump-json."""
    ytdlp_path = shutil.which("yt-dlp") or "yt-dlp"
    try:
        proc = await asyncio.create_subprocess_exec(
            ytdlp_path,
            "--dump-json", "--no-playlist", "--no-warnings",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        data = json.loads(stdout.decode().strip())
        return float(data.get('duration', 0))
    except Exception as e:
        await log_msg("WARNING", f"Could not get video duration: {e}")
        return 0.0

async def download_4k_clip(url, start_time, duration, output_path, credit=None):
    """Fetch stream URL via yt-dlp then cut with FFmpeg. Optionally burn credit watermark."""
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

        FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

        # Build drawtext filter string (empty string = no watermark)
        drawtext_filter = ""
        if credit:
            escaped = escape_drawtext(credit)
            drawtext_filter = (
                f"drawtext=fontfile='{FONT_PATH}':text='{escaped}'"
                f":fontsize=18:fontcolor=white:borderw=2:bordercolor=black"
                f":box=1:boxcolor=black@0.4:boxborderw=4"
                f":x=10:y=h-th-14"
            )

        if len(urls) >= 2:
            video_url, audio_url = urls[0], urls[1]
            cmd = [
                ffmpeg_path, "-y",
                "-ss", str(int(start_time)), "-i", video_url,
                "-ss", str(int(start_time)), "-i", audio_url,
                "-t", str(duration),
            ]
            if drawtext_filter:
                # Use filter_complex for two-stream case so mapping is explicit
                cmd += [
                    "-filter_complex", f"[0:v]{drawtext_filter}[vout]",
                    "-map", "[vout]", "-map", "1:a:0",
                ]
            else:
                cmd += ["-map", "0:v:0", "-map", "1:a:0"]
            cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output_path]
        else:
            video_url = urls[0]
            cmd = [ffmpeg_path, "-y", "-ss", str(int(start_time)), "-i", video_url, "-t", str(duration)]
            if drawtext_filter:
                cmd += ["-vf", drawtext_filter]
            cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output_path]

        ffproc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _, ff_err = await ffproc.communicate()
        ff_err_str = ff_err.decode()

        # Always log last 200 chars of stderr so we can see drawtext errors etc.
        if ff_err_str.strip():
            tail = ff_err_str.strip().splitlines()[-3:]
            await log_msg("DEBUG", f"FFmpeg tail: {' | '.join(tail)}")

        if os.path.exists(output_path) and os.path.getsize(output_path) > 10000:
            return True
        else:
            await log_msg("WARNING", f"FFmpeg produced empty file: {ff_err_str[-400:]}")
            if os.path.exists(output_path):
                os.remove(output_path)
            return False

    except Exception as e:
        await log_msg("ERROR", f"Clip extraction failed for {url} at {start_time}s: {e}")
        if os.path.exists(output_path):
            os.remove(output_path)
        return False


async def process_single(line_num, url, duration, start_time, credit=None):
    """Cut one clip at a specific start_time."""
    credit_info = f" | credit: {credit}" if credit else ""
    await log_msg("INFO", f"=== [Line {line_num}] {url} | {duration}s from {start_time}s{credit_info} ===")
    out = os.path.join(CLIPS_DIR, f"clip_s{line_num}.mp4")
    ok = await download_4k_clip(url, start_time, duration, out, credit=credit)
    if ok:
        await log_msg("INFO", f"[Line {line_num}] Done → {out}")
    else:
        await log_msg("ERROR", f"[Line {line_num}] Failed. Try Internet Archive if YouTube is blocked.")
    await log_msg("INFO", f"=== [Line {line_num}] Finished ===")


async def process_chunked(line_num, url, duration, credit=None, start_offset=0):
    """Cut video into equal-duration chunks from start_offset to the end."""
    credit_info = f" | credit: {credit}" if credit else ""
    offset_info = f" from {start_offset}s" if start_offset else ""
    await log_msg("INFO", f"=== [Line {line_num}] CHUNK MODE: {url} | {duration}s chunks{offset_info}{credit_info} ===")

    total = await get_video_duration_url(url)
    if not total:
        await log_msg("ERROR", f"[Line {line_num}] Could not get video duration — skipping chunk mode.")
        return

    usable = total - start_offset
    if usable <= 0:
        await log_msg("ERROR", f"[Line {line_num}] Start offset ({start_offset}s) is beyond video length ({total:.0f}s) — skipping.")
        return

    num_chunks = int(usable // duration)
    if num_chunks == 0:
        await log_msg("WARNING", f"[Line {line_num}] Remaining video ({usable:.0f}s) shorter than chunk size ({duration}s) — cutting one clip.")
        num_chunks = 1

    await log_msg("INFO", f"[Line {line_num}] Video is {total:.0f}s, starting at {start_offset}s → {num_chunks} chunk(s) of {duration}s")

    succeeded = 0
    for i in range(num_chunks):
        ts = start_offset + i * duration
        out = os.path.join(CLIPS_DIR, f"clip_s{line_num}_chunk{i+1:03d}.mp4")
        await log_msg("INFO", f"[Line {line_num}] Chunk {i+1}/{num_chunks} at {ts}s → {out}")
        ok = await download_4k_clip(url, ts, duration, out, credit=credit)
        if ok:
            succeeded += 1
        else:
            await log_msg("WARNING", f"[Line {line_num}] Chunk {i+1} failed — skipping.")

    await log_msg("INFO", f"=== [Line {line_num}] Done: {succeeded}/{num_chunks} chunks saved ===")


async def run_factory(feed_text):
    setup_logger()
    await log_msg("INFO", f"--- Pipeline Started at {datetime.now()} ---")

    lines = [l.strip() for l in feed_text.strip().split('\n') if l.strip() and not l.strip().startswith('#')]

    for line_num, line in enumerate(lines, start=1):
        parts = [p.strip() for p in line.split('|')]
        if len(parts) < 2:
            await log_msg("WARNING", f"Skipping line {line_num}: '{line}' — need at least URL | duration")
            continue

        url = parts[0]
        dur_str = parts[1]

        try:
            duration = parse_duration(dur_str)
        except ValueError as e:
            await log_msg("ERROR", f"Line {line_num}: {e} — skipping.")
            continue

        # Smart field detection for remaining parts
        # Field 3 can be: @credit  OR  timestamp  OR  timestamp+  (chunk from that point)
        # Field 4 can be: @credit (when field 3 was a timestamp)
        credit = None
        start_time = None
        chunk_from_offset = False   # True when timestamp ends with '+'

        remaining = [p for p in parts[2:] if p]
        for field in remaining:
            if field.startswith('@'):
                credit = field
            else:
                raw = field
                if raw.endswith('+'):
                    chunk_from_offset = True
                    raw = raw[:-1]
                try:
                    start_time = hms_to_seconds(raw)
                except (ValueError, IndexError):
                    await log_msg("WARNING", f"Line {line_num}: Could not parse '{field}' as timestamp — ignoring.")

        if start_time is not None and not chunk_from_offset:
            # Single clip at exact timestamp
            await process_single(line_num, url, duration, start_time, credit=credit)
        elif start_time is not None and chunk_from_offset:
            # Chunk from timestamp to end of video
            await process_chunked(line_num, url, duration, credit=credit, start_offset=start_time)
        else:
            # No timestamp → chunk entire video from beginning
            await process_chunked(line_num, url, duration, credit=credit)

    await log_msg("INFO", "--- Batch processing complete ---")
    await log_msg("INFO", f"--- Pipeline Finished at {datetime.now()} ---")

if __name__ == "__main__":
    pass
