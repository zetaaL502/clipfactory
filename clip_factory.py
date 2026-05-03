import os
import asyncio
import json
import logging
import random
import re
import shutil
from datetime import datetime
from yt_dlp import YoutubeDL

try:
    import imageio_ffmpeg
    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG_PATH = shutil.which("ffmpeg")

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
    """Parse duration string: '8s', '8sec', '2min', '2m', '1min30sec', '90' → seconds."""
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
    raise ValueError(f"Cannot parse duration: '{s}' — use e.g. 8, 8s, 2min, 1min30s")

def hms_to_seconds(hms):
    """Convert HH:MM:SS or MM:SS or plain seconds string to total seconds."""
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

def _cookies_args():
    """Return ['--cookies', 'cookies.txt'] if the file exists, else []."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cookies.txt')
    return ['--cookies', p] if os.path.exists(p) else []


def _yt_dlp_js_args():
    """Return extra yt-dlp JS runtime args if a local node.js is installed."""
    args = []
    if shutil.which("node"):
        args += ["--js-runtimes", "node", "--remote-components", "ejs:github"]
    return args


async def get_video_duration_url(url):
    """Get total video duration in seconds via yt-dlp --dump-json."""
    ytdlp_path = shutil.which("yt-dlp") or "yt-dlp"
    try:
        proc = await asyncio.create_subprocess_exec(
            ytdlp_path,
            "--dump-json", "--no-playlist", "--no-warnings",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "--extractor-args", "youtube:player_client=android,web",
            *_yt_dlp_js_args(),
            *_cookies_args(),
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


async def _get_video_stream_urls(url):
    """Try stream URL extraction with yt-dlp format fallbacks."""
    ytdlp_path = shutil.which("yt-dlp") or "yt-dlp"
    format_candidates = ["bestvideo+bestaudio/best", "best"]
    last_err = ""
    for fmt in format_candidates:
        proc = await asyncio.create_subprocess_exec(
            ytdlp_path,
            "-f", fmt,
            "--get-url", "--no-warnings", "--no-playlist",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "--extractor-args", "youtube:player_client=android,web",
            *_yt_dlp_js_args(),
            *_cookies_args(),
            url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        last_err = stderr.decode().strip()
        if proc.returncode == 0:
            urls = [u.strip() for u in stdout.decode().strip().splitlines() if u.strip()]
            if urls:
                return urls
        await log_msg("WARNING", f"yt-dlp format {fmt} failed for {url}: {last_err.splitlines()[-1] if last_err else 'no stderr'}")

    raise Exception(f"yt-dlp failed to get URL for {url}. last stderr: {last_err}")

def _find_font():
    """Return a usable font path for ffmpeg drawtext, cross-platform."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


async def download_4k_clip(url, start_time, duration, output_path, credit=None, no_audio=False, font_size=11):
    """Fetch stream URL via yt-dlp then cut with FFmpeg. Optionally burn credit watermark."""
    ffmpeg_path = FFMPEG_PATH or "ffmpeg"

    try:
        urls = await _get_video_stream_urls(url)
        font_path = _find_font()

        drawtext_filter = ""
        if credit:
            escaped = escape_drawtext(credit)
            if font_path:
                drawtext_filter = (
                    f"drawtext=fontfile='{font_path}':text='{escaped}'"
                    f":fontsize={font_size}:fontcolor=white:borderw=1:bordercolor=black"
                    f":x=8:y=h-th-8"
                )
            else:
                drawtext_filter = (
                    f"drawtext=text='{escaped}'"
                    f":fontsize={font_size}:fontcolor=white:borderw=1:bordercolor=black"
                    f":x=8:y=h-th-8"
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
                cmd += ["-filter_complex", f"[0:v]{drawtext_filter}[vout]", "-map", "[vout]"]
            else:
                cmd += ["-map", "0:v:0"]
            if no_audio:
                cmd += ["-an"]
            else:
                cmd += ["-map", "1:a:0", "-c:a", "aac", "-b:a", "128k"]
            cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-movflags", "+faststart", output_path]
        else:
            video_url = urls[0]
            cmd = [ffmpeg_path, "-y", "-ss", str(int(start_time)), "-i", video_url, "-t", str(duration)]
            if drawtext_filter:
                cmd += ["-vf", drawtext_filter]
            if no_audio:
                cmd += ["-an"]
            else:
                cmd += ["-c:a", "aac", "-b:a", "128k"]
            cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-movflags", "+faststart", output_path]

        ffproc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _, ff_err = await ffproc.communicate()
        ff_err_str = ff_err.decode()

        if ffproc.returncode != 0:
            await log_msg("ERROR", f"FFmpeg exited with code {ffproc.returncode}")
        if ff_err_str.strip():
            tail = ff_err_str.strip().splitlines()[-5:]
            await log_msg("INFO", f"FFmpeg stderr: {' | '.join(tail)}")

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


# ── Processing modes ─────────────────────────────────────────────────────────

async def process_single(line_num, url, duration, start_time, credit=None):
    """Cut one clip at a specific start_time."""
    credit_info = f", credit: {credit}" if credit else ""
    await log_msg("INFO", f"=== [Line {line_num}] SINGLE: {url} , {duration}s from {start_time}s{credit_info} ===")
    out = os.path.join(CLIPS_DIR, f"clip_s{line_num}.mp4")
    ok = await download_4k_clip(url, start_time, duration, out, credit=credit)
    if ok:
        await log_msg("INFO", f"[Line {line_num}] Done → {out}")
    else:
        await log_msg("ERROR", f"[Line {line_num}] Failed. Try Internet Archive if YouTube is blocked.")
    await log_msg("INFO", f"=== [Line {line_num}] Finished ===")


async def process_chunked(line_num, url, duration, credit=None, start_offset=0, end_offset=None):
    """Cut video into equal-duration chunks from start_offset to end_offset (or video end)."""
    credit_info = f", credit: {credit}" if credit else ""
    range_info = f" {start_offset}s–{end_offset}s" if end_offset is not None else (f" from {start_offset}s" if start_offset else "")
    await log_msg("INFO", f"=== [Line {line_num}] CHUNK MODE: {url} , {duration}s chunks{range_info}{credit_info} ===")

    total = await get_video_duration_url(url)
    if not total:
        await log_msg("ERROR", f"[Line {line_num}] Could not get video duration — skipping chunk mode.")
        return

    effective_end = end_offset if end_offset is not None else total
    if effective_end > total:
        await log_msg("WARNING", f"[Line {line_num}] End offset {effective_end}s exceeds video length {total:.0f}s — clamping.")
        effective_end = total

    usable = effective_end - start_offset
    if usable <= 0:
        await log_msg("ERROR", f"[Line {line_num}] Start offset ({start_offset}s) is at or beyond end ({effective_end:.0f}s) — skipping.")
        return

    num_chunks = int(usable // duration)
    if num_chunks == 0:
        await log_msg("WARNING", f"[Line {line_num}] Range ({usable:.0f}s) shorter than chunk size ({duration}s) — cutting one clip.")
        num_chunks = 1

    await log_msg("INFO", f"[Line {line_num}] Cutting {num_chunks} chunk(s) of {duration}s")

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


async def process_best(line_num, url, n, clip_duration=None, credit=None):
    """Extract N evenly spaced clips. Clip duration defaults to total/N if not specified."""
    credit_info = f", credit: {credit}" if credit else ""
    await log_msg("INFO", f"=== [Line {line_num}] BEST:{n}: {url}{credit_info} ===")

    total = await get_video_duration_url(url)
    if not total:
        await log_msg("ERROR", f"[Line {line_num}] Could not get video duration for best:{n} — skipping.")
        return

    interval = total / n
    dur = clip_duration if clip_duration and clip_duration > 0 else max(1, int(interval))
    timestamps = [i * interval for i in range(n)]

    await log_msg("INFO", f"[Line {line_num}] Video {total:.0f}s, interval {interval:.1f}s, clip_duration {dur}s, {n} clips")

    succeeded = 0
    for i, ts in enumerate(timestamps):
        out = os.path.join(CLIPS_DIR, f"clip_s{line_num}_best{i+1:03d}.mp4")
        await log_msg("INFO", f"[Line {line_num}] Best clip {i+1}/{n} at {ts:.0f}s → {out}")
        ok = await download_4k_clip(url, ts, dur, out, credit=credit)
        if ok:
            succeeded += 1
        else:
            await log_msg("WARNING", f"[Line {line_num}] Best clip {i+1} failed — skipping.")

    await log_msg("INFO", f"=== [Line {line_num}] Done: {succeeded}/{n} best clips saved ===")


async def process_random(line_num, url, clip_duration, n, credit=None):
    """Extract N clips at random timestamps spread across the video."""
    credit_info = f", credit: {credit}" if credit else ""
    await log_msg("INFO", f"=== [Line {line_num}] RANDOM:{n}: {url} , {clip_duration}s each{credit_info} ===")

    total = await get_video_duration_url(url)
    if not total:
        await log_msg("ERROR", f"[Line {line_num}] Could not get video duration for random:{n} — skipping.")
        return

    max_start = max(0.0, total - clip_duration)
    timestamps = sorted(random.uniform(0, max_start) for _ in range(n))

    await log_msg("INFO", f"[Line {line_num}] Video {total:.0f}s, picking {n} random timestamps")

    succeeded = 0
    for i, ts in enumerate(timestamps):
        out = os.path.join(CLIPS_DIR, f"clip_s{line_num}_rand{i+1:03d}.mp4")
        await log_msg("INFO", f"[Line {line_num}] Random clip {i+1}/{n} at {ts:.0f}s → {out}")
        ok = await download_4k_clip(url, ts, clip_duration, out, credit=credit)
        if ok:
            succeeded += 1
        else:
            await log_msg("WARNING", f"[Line {line_num}] Random clip {i+1} failed — skipping.")

    await log_msg("INFO", f"=== [Line {line_num}] Done: {succeeded}/{n} random clips saved ===")


# ── Line parser ───────────────────────────────────────────────────────────────

def _is_time_range(s):
    """Return (start_secs, end_secs) if s matches 'start-end' time range, else None."""
    m = re.match(r'^([\d:]+)-([\d:]+)$', s.strip())
    if not m:
        return None
    try:
        a = hms_to_seconds(m.group(1))
        b = hms_to_seconds(m.group(2))
        return (a, b)
    except (ValueError, IndexError):
        return None


async def parse_and_dispatch(line_num, line):
    """
    Parse one comma-delimited line and dispatch to the correct processing mode.

    Supported formats (comma-delimited, @credit always optional and anywhere after URL):

      URL , 30s , 2:30 , @credit     → single clip at 2:30
      URL , 2min , @credit            → chunk entire video into 2min pieces
      URL , 30s , 2:30-4:00 , @credit → chunk only between 2:30 and 4:00
      URL , best:5 , @credit          → 5 evenly-spaced clips (duration = total/5)
      URL , 30s , best:5 , @credit    → 5 evenly-spaced clips of 30s each
      URL , 30s , random:5 , @credit  → 5 random 30s clips
      URL , 30s , 2:30+               → chunk from 2:30 to video end (legacy + syntax)
    """
    parts = [p.strip() for p in line.split(',')]
    if len(parts) < 2:
        await log_msg("WARNING", f"Skipping line {line_num}: '{line}' — need at least: URL , duration")
        return

    url = parts[0]
    if not url:
        await log_msg("WARNING", f"Skipping line {line_num}: empty URL")
        return

    # Separate @credit fields from value fields (everything after URL)
    credit = None
    value_fields = []
    for p in parts[1:]:
        if p.startswith('@'):
            credit = p
        elif p:
            value_fields.append(p)

    if not value_fields:
        await log_msg("WARNING", f"Skipping line {line_num}: no duration/mode field found")
        return

    field1 = value_fields[0]
    field2 = value_fields[1] if len(value_fields) > 1 else ''

    # ── Mode: best:N (no explicit duration) ──────────────────────────────────
    best_match = re.match(r'^best:(\d+)$', field1, re.IGNORECASE)
    if best_match:
        n = int(best_match.group(1))
        await process_best(line_num, url, n, clip_duration=None, credit=credit)
        return

    # ── Parse field1 as clip duration ────────────────────────────────────────
    try:
        duration = parse_duration(field1)
    except ValueError as e:
        await log_msg("ERROR", f"Line {line_num}: {e} — skipping.")
        return

    # No field2 → chunk entire video from start
    if not field2:
        await process_chunked(line_num, url, duration, credit=credit)
        return

    # ── Mode: best:N with explicit duration ──────────────────────────────────
    best_match2 = re.match(r'^best:(\d+)$', field2, re.IGNORECASE)
    if best_match2:
        n = int(best_match2.group(1))
        await process_best(line_num, url, n, clip_duration=duration, credit=credit)
        return

    # ── Mode: random:N ───────────────────────────────────────────────────────
    random_match = re.match(r'^random:(\d+)$', field2, re.IGNORECASE)
    if random_match:
        n = int(random_match.group(1))
        await process_random(line_num, url, duration, n, credit=credit)
        return

    # ── Mode: time range  2:30-4:00 ──────────────────────────────────────────
    time_range = _is_time_range(field2)
    if time_range is not None:
        start_s, end_s = time_range
        await process_chunked(line_num, url, duration, credit=credit,
                               start_offset=start_s, end_offset=end_s)
        return

    # ── Mode: single timestamp  2:30  or chunk-from-offset  2:30+ ────────────
    raw_ts = field2
    chunk_from_offset = False
    if raw_ts.endswith('+'):
        chunk_from_offset = True
        raw_ts = raw_ts[:-1]

    try:
        start_time = hms_to_seconds(raw_ts)
    except (ValueError, IndexError):
        await log_msg("WARNING", f"Line {line_num}: Could not parse '{field2}' as timestamp or mode — skipping.")
        return

    if chunk_from_offset:
        await process_chunked(line_num, url, duration, credit=credit, start_offset=start_time)
    else:
        await process_single(line_num, url, duration, start_time, credit=credit)


# ── Entry point ───────────────────────────────────────────────────────────────

async def run_factory(feed_text):
    setup_logger()
    await log_msg("INFO", f"--- Pipeline Started at {datetime.now()} ---")

    lines = [l.strip() for l in feed_text.strip().split('\n')
             if l.strip() and not l.strip().startswith('#')]

    for line_num, line in enumerate(lines, start=1):
        await parse_and_dispatch(line_num, line)

    await log_msg("INFO", "--- Batch processing complete ---")
    await log_msg("INFO", f"--- Pipeline Finished at {datetime.now()} ---")

if __name__ == "__main__":
    pass
