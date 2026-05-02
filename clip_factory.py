import os
import asyncio
import json
import logging
import re
import shutil
import subprocess
from datetime import datetime
import google.generativeai as genai
from yt_dlp import YoutubeDL

# Configuration
TEMP_DIR = "temp_processing"
CLIPS_DIR = "clips"
LOG_FILE = "pipeline.log"
MODEL_NAME = "gemini-2.0-flash"

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
    """Convert HH:MM:SS or MM:SS to total seconds."""
    parts = hms.strip().split(':')
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

async def execute_fallback(output_path, duration, is_4k=True):
    size = "3840x2160" if is_4k else "256x144"
    await log_msg("WARNING", f"Generating silent black fallback for {output_path} (Source blocked/unreachable)")
    ffmpeg_cmd = shutil.which("ffmpeg") or "ffmpeg"
    cmd = [
        ffmpeg_cmd, "-y",
        "-f", "lavfi", "-i", f"color=c=black:s={size}:d={duration}:r=30",
        "-c:v", "libx264",
        "-t", str(duration),
        "-pix_fmt", "yuv420p",
        "-an",
        output_path
    ]
    process = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await process.wait()
    return process.returncode == 0

async def download_low_res(url, output_path):
    """Download tiny version for AI analysis quickly."""
    ydl_opts = {
        'format': 'best[height<=360]/worst',
        'outtmpl': output_path,
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return os.path.exists(output_path)
    except Exception as e:
        await log_msg("ERROR", f"Low-res download failed for {url}: {str(e)}")
        return False

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
        vf_parts = []
        if credit:
            escaped = escape_drawtext(credit)
            vf_parts.append(
                f"drawtext=text='{escaped}':fontsize=14:fontcolor=white"
                f":borderw=2:bordercolor=black:x=10:y=h-th-10"
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

async def get_video_duration(video_path):
    """Use ffprobe to get the total duration of a video in seconds."""
    try:
        ffprobe = shutil.which("ffprobe") or "ffprobe"
        process = await asyncio.create_subprocess_exec(
            ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", video_path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await process.communicate()
        data = json.loads(stdout)
        return float(data["format"]["duration"])
    except Exception:
        return None

def spread_timestamps(total_duration, clip_duration, count=1):
    """Generate evenly-spread fallback timestamps."""
    if not total_duration or total_duration <= clip_duration:
        return [0]
    usable = total_duration - clip_duration
    if count == 1:
        return [round(usable / 2)]
    step = usable / (count - 1)
    return [round(i * step) for i in range(count)]

async def analyze_video(api_key, video_path, prompt, clip_duration=10):
    """Use Gemini to find the single exact timestamp matching the prompt.
    Returns a list with one timestamp (in seconds).
    Retries up to 3 times on 429 rate-limit errors with 60s backoff."""
    total_duration = await get_video_duration(video_path)

    if not api_key:
        await log_msg("WARNING", "No Gemini API key set — using midpoint timestamp. Add your key in Settings for AI scene detection.")
        return spread_timestamps(total_duration, clip_duration)

    if not hasattr(genai, "upload_file"):
        await log_msg("ERROR", "google-generativeai SDK is outdated — run: pip install -U google-generativeai")
        return spread_timestamps(total_duration, clip_duration)

    genai.configure(api_key=api_key)

    await log_msg("INFO", f"Uploading video to Gemini for '{prompt}' analysis...")
    myfile = genai.upload_file(video_path)

    while myfile.state.name == "PROCESSING":
        await asyncio.sleep(2)
        myfile = genai.get_file(myfile.name)

    model = genai.GenerativeModel(MODEL_NAME)
    user_prompt = (
        f"Watch this video carefully. Find the EXACT moment where: {prompt}. "
        "Give me the precise start timestamp in HH:MM:SS format where this happens most clearly and obviously. "
        "Do not give me a similar scene or approximate moment — find EXACTLY what was described. "
        'Return ONLY this JSON: {"start": "HH:MM:SS"}'
    )

    MAX_RETRIES = 3
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = model.generate_content(
                [myfile, user_prompt],
                generation_config={"candidate_count": 1, "temperature": 0.1}
            )
            text = response.text.strip()
            await log_msg("INFO", f"Gemini response for '{prompt}': {text}")

            # Parse JSON response
            json_match = re.search(r'\{[^}]+\}', text)
            if json_match:
                data = json.loads(json_match.group())
                hms = data.get("start", "")
                if hms:
                    seconds = hms_to_seconds(hms)
                    await log_msg("INFO", f"Gemini found exact timestamp: {hms} ({seconds}s)")
                    try: genai.delete_file(myfile.name)
                    except: pass
                    return [seconds]

            await log_msg("WARNING", f"Could not parse Gemini JSON response — using midpoint.")
            try: genai.delete_file(myfile.name)
            except: pass
            return spread_timestamps(total_duration, clip_duration)

        except Exception as e:
            err_str = str(e)
            is_rate_limit = "429" in err_str or "rate" in err_str.lower() or "quota" in err_str.lower()

            if is_rate_limit and attempt < MAX_RETRIES:
                await log_msg("WARNING", f"Rate limit hit — waiting 60 seconds before retry (attempt {attempt}/{MAX_RETRIES})...")
                await asyncio.sleep(60)
            elif is_rate_limit and attempt == MAX_RETRIES:
                await log_msg("ERROR", f"Gemini rate limit exceeded after {MAX_RETRIES} retries for '{prompt}' — skipping AI analysis.")
                try: genai.delete_file(myfile.name)
                except: pass
                return spread_timestamps(total_duration, clip_duration)
            else:
                await log_msg("ERROR", f"Gemini analysis failed: {err_str}")
                try: genai.delete_file(myfile.name)
                except: pass
                return spread_timestamps(total_duration, clip_duration)

    return spread_timestamps(total_duration, clip_duration)


async def process_url_line(api_key, line_num, url, duration, prompts, credit=None):
    """
    Process one feed line — one URL with one or more keywords.
    Downloads the low-res preview ONCE, then for each keyword:
      1. Asks Gemini to find the exact timestamp where that keyword is visible
      2. Extracts that clip from the high-quality source
    If a credit string is provided, burns it into the bottom-left corner.
    """
    label = f"Line {line_num}"
    credit_info = f" | credit: {credit}" if credit else ""
    await log_msg("INFO", f"=== [{label}] Starting: {url} | {duration}s | keywords: {', '.join(prompts)}{credit_info} ===")

    # --- Step 1: Download low-res preview ONCE for this URL ---
    temp_file = os.path.join(TEMP_DIR, f"preview_s{line_num}.mp4")
    await log_msg("INFO", f"[{label}] Downloading low-res preview for AI analysis...")
    low_res_ok = await download_low_res(url, temp_file)
    if not low_res_ok:
        await log_msg("WARNING", f"[{label}] Low-res preview failed — will use midpoint timestamp (no AI analysis).")

    # --- Step 2: For each keyword, analyze + extract ---
    for keyword_num, prompt in enumerate(prompts, start=1):
        klabel = f"Line {line_num} / Keyword {keyword_num} '{prompt}'"
        await log_msg("INFO", f"--- [{klabel}] Finding exact scene ---")

        if os.path.exists(temp_file):
            timestamps = await analyze_video(api_key, temp_file, prompt, clip_duration=duration)
        else:
            timestamps = spread_timestamps(None, duration)

        await log_msg("INFO", f"[{klabel}] Using timestamp(s): {timestamps}")

        sanitized = sanitize_filename(prompt)
        succeeded = 0
        for i, ts in enumerate(timestamps):
            out = os.path.join(CLIPS_DIR, f"{sanitized}_s{line_num}_k{keyword_num}_part_{i+1}.mp4")
            credit_log = f" (with credit: {credit})" if credit else ""
            await log_msg("INFO", f"[{klabel}] Extracting clip at {ts}s → {out}{credit_log}")
            ok = await download_4k_clip(url, ts, duration, out, credit=credit)
            if ok:
                succeeded += 1
            else:
                await log_msg("WARNING", f"[{klabel}] Clip extraction failed — skipping.")

        if succeeded == 0:
            await log_msg("ERROR", f"[{klabel}] Extraction failed. Source may be geo-blocked — try Internet Archive.")
        else:
            await log_msg("INFO", f"[{klabel}] Done: {succeeded} clip(s) saved.")

    # --- Step 3: Clean up shared preview ---
    if os.path.exists(temp_file):
        os.remove(temp_file)

    await log_msg("INFO", f"=== [{label}] Finished ===")


async def run_factory(feed_text, api_key):
    setup_logger()
    await log_msg("INFO", f"--- Pipeline Started at {datetime.now()} ---")

    lines = [l.strip() for l in feed_text.strip().split('\n') if l.strip()]

    for line_num, line in enumerate(lines, start=1):
        # Format: URL | DURATION | keyword1, keyword2 | @credit (optional)
        parts = [p.strip() for p in line.split('|')]
        if len(parts) < 3:
            await log_msg("WARNING", f"Skipping malformed line {line_num}: '{line}'")
            continue

        url, dur_str = parts[0], parts[1]
        prompts = [p.strip() for p in parts[2].split(',') if p.strip()]
        credit = parts[3] if len(parts) >= 4 and parts[3] else None

        try:
            duration = int(dur_str)
        except ValueError:
            await log_msg("ERROR", f"Invalid duration '{dur_str}' on line {line_num} — skipping.")
            continue
        if not prompts:
            await log_msg("WARNING", f"No keywords on line {line_num} — skipping.")
            continue

        if line_num > 1:
            await log_msg("INFO", "Waiting 8 seconds before next video request...")
            await asyncio.sleep(8)

        await process_url_line(api_key, line_num, url, duration, prompts, credit=credit)

    await log_msg("INFO", "--- Batch processing complete ---")
    await log_msg("INFO", f"--- Pipeline Finished at {datetime.now()} ---")

if __name__ == "__main__":
    pass
