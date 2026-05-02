import os
import asyncio
import json
import logging
import re
import subprocess
from datetime import datetime
import google.generativeai as genai
from yt_dlp import YoutubeDL

# Configuration
TEMP_DIR = "temp_processing"
CLIPS_DIR = "clips"
LOG_FILE = "pipeline.log"
MODEL_NAME = "gemini-2.0-flash"  # Updated model

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

async def execute_fallback(output_path, duration, is_4k=True):
    size = "3840x2160" if is_4k else "256x144"
    await log_msg("WARNING", f"Generating silent black fallback for {output_path} (Source blocked/unreachable)")
    
    ffmpeg_cmd = "ffmpeg"
    
    # Just a pure black screen, no audio, very small file size
    cmd = [
        ffmpeg_cmd, "-y",
        "-f", "lavfi", "-i", f"color=c=black:s={size}:d={duration}:r=30",
        "-c:v", "libx264",
        "-t", str(duration),
        "-pix_fmt", "yuv420p", # Standard pixel format for maximum compatibility
        "-an",
        output_path
    ]
    process = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await process.wait()
    return process.returncode == 0

async def download_low_res(url, output_path):
    """Download tiny version for AI analysis quickly"""
    ydl_opts = {
        'format': 'best[height<=360]/worst',
        'outtmpl': output_path,
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        # LOCAL RUN FIX: Use browser cookies to skip 403 Forbidden blocks
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return os.path.exists(output_path)
    except Exception as e:
        await log_msg("ERROR", f"Low-res download failed for {url}: {str(e)}")
        return False

async def download_4k_clip(url, start_time, duration, output_path):
    """Get direct stream URL via yt-dlp, then let ffmpeg seek+cut precisely."""
    import shutil
    ffmpeg_path = shutil.which("ffmpeg") or "ffmpeg"

    try:
        # Step 1: resolve direct streamable URL(s) — fast, no download
        proc = await asyncio.create_subprocess_exec(
            "yt-dlp",
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

        # Step 2: build ffmpeg command — seek BEFORE -i for speed, then cut
        if len(urls) >= 2:
            # Separate video + audio streams
            video_url, audio_url = urls[0], urls[1]
            cmd = [
                ffmpeg_path, "-y",
                "-ss", str(int(start_time)), "-i", video_url,
                "-ss", str(int(start_time)), "-i", audio_url,
                "-t", str(duration),
                "-map", "0:v:0", "-map", "1:a:0",
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
        import shutil
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

def spread_timestamps(total_duration, clip_duration, count=3):
    """Generate evenly-spread timestamps across the video."""
    if not total_duration or total_duration <= clip_duration * count:
        step = max(clip_duration + 5, 15)
        return [i * step for i in range(count)]
    usable = total_duration - clip_duration
    step = usable / (count - 1) if count > 1 else usable
    return [round(i * step) for i in range(count)]

def enforce_min_gap(timestamps, min_gap, total_duration=None):
    """Ensure timestamps are at least min_gap seconds apart. Fill gaps if needed."""
    timestamps = sorted(set(int(t) for t in timestamps))
    result = [timestamps[0]]
    for ts in timestamps[1:]:
        if ts - result[-1] >= min_gap:
            result.append(ts)
    # If we still don't have 3, pad by adding gaps after the last one
    while len(result) < 3:
        candidate = result[-1] + min_gap
        if total_duration and candidate + min_gap > total_duration:
            candidate = max(0, result[0] - min_gap)
        result.append(int(candidate))
    return sorted(result[:3])

async def analyze_video(api_key, video_path, prompt, clip_duration=10):
    """Use Gemini 1.5 Flash to find 3 visually distinct scenes matching the prompt."""
    total_duration = await get_video_duration(video_path)
    min_gap = max(clip_duration + 5, 20)  # clips must be at least this far apart

    if not api_key:
        await log_msg("WARNING", f"No Gemini API key set — spreading timestamps evenly across video. Add your key in Settings for AI scene detection.")
        return spread_timestamps(total_duration, clip_duration)

    try:
        import google.generativeai as genai
        if not hasattr(genai, "upload_file"):
            await log_msg("ERROR", "google-generativeai SDK is outdated — run: pip install -U google-generativeai")
            return spread_timestamps(total_duration, clip_duration)

        genai.configure(api_key=api_key)

        dur_hint = f" The video is {int(total_duration)} seconds long." if total_duration else ""
        system_instruction = (
            "You are a professional video editor specializing in content-aware scene detection. "
            f"Find exactly 3 timestamps (in seconds) in the video where the visual content clearly shows: '{prompt}'."
            f"{dur_hint} "
            "Rules you MUST follow: "
            f"(1) Each timestamp must show DIFFERENT footage — never the same scene twice. "
            f"(2) Timestamps must be at least {min_gap} seconds apart from each other. "
            "(3) Spread them across the full length of the video — pick from the beginning, middle, and end where possible. "
            "(4) Only include timestamps where the prompt content is actually visible on screen. "
            "Reply with ONLY 3 integer numbers in seconds, separated by commas. No other text."
        )
        model = genai.GenerativeModel(MODEL_NAME, system_instruction=system_instruction)

        await log_msg("INFO", f"Uploading video to Gemini for '{prompt}' analysis...")
        myfile = genai.upload_file(video_path)

        while myfile.state.name == "PROCESSING":
            await asyncio.sleep(2)
            myfile = genai.get_file(myfile.name)

        response = model.generate_content(
            [myfile, f"Find 3 timestamps where this is clearly visible: {prompt}"],
            generation_config={"candidate_count": 1, "temperature": 0.2}
        )
        text = response.text.strip()
        await log_msg("INFO", f"Gemini returned timestamps for '{prompt}': {text}")

        raw = [float(v) for v in re.findall(r"(\d+(?:\.\d+)?)", text)]

        try: genai.delete_file(myfile.name)
        except: pass

        if len(raw) >= 3:
            timestamps = enforce_min_gap(raw[:6], min_gap, total_duration)
            return timestamps
        elif len(raw) > 0:
            # Not enough timestamps — spread the ones we got
            await log_msg("WARNING", f"Gemini returned fewer than 3 timestamps — filling gaps automatically.")
            return enforce_min_gap(raw + spread_timestamps(total_duration, clip_duration), min_gap, total_duration)
        else:
            await log_msg("WARNING", f"Gemini returned no usable timestamps — spreading evenly.")
            return spread_timestamps(total_duration, clip_duration)

    except Exception as e:
        await log_msg("ERROR", f"Gemini analysis failed: {str(e)}")
        return spread_timestamps(total_duration, clip_duration)


async def process_url_line(api_key, line_num, url, duration, prompts):
    """
    Process one feed line — one URL with one or more keywords.
    Downloads the low-res preview ONCE, then for each keyword:
      1. Asks Gemini to find 3 timestamps where that keyword is visible
      2. Extracts those 3 clips from the high-quality source
    Keywords are handled one-by-one so YouTube isn't hammered simultaneously.
    """
    label = f"Line {line_num}"
    await log_msg("INFO", f"=== [{label}] Starting: {url} | {duration}s | keywords: {', '.join(prompts)} ===")

    # --- Step 1: Download low-res preview ONCE for this URL ---
    temp_file = os.path.join(TEMP_DIR, f"preview_s{line_num}.mp4")
    await log_msg("INFO", f"[{label}] Downloading low-res preview for AI analysis...")
    low_res_ok = await download_low_res(url, temp_file)
    if not low_res_ok:
        await log_msg("WARNING", f"[{label}] Low-res preview failed — will spread timestamps evenly (no AI analysis).")

    # --- Step 2: For each keyword, analyze + extract independently ---
    for keyword_num, prompt in enumerate(prompts, start=1):
        klabel = f"Line {line_num} / Keyword {keyword_num} '{prompt}'"
        await log_msg("INFO", f"--- [{klabel}] Finding scenes ---")

        # Gemini analysis uses the shared preview
        if os.path.exists(temp_file):
            timestamps = await analyze_video(api_key, temp_file, prompt, clip_duration=duration)
        else:
            timestamps = spread_timestamps(None, duration)

        await log_msg("INFO", f"[{klabel}] Using timestamps: {timestamps}")

        # Extract 3 clips at those timestamps — sequentially to avoid rate-limiting
        sanitized = sanitize_filename(prompt)
        succeeded = 0
        for i, ts in enumerate(timestamps):
            out = os.path.join(CLIPS_DIR, f"{sanitized}_s{line_num}_k{keyword_num}_part_{i+1}.mp4")
            await log_msg("INFO", f"[{klabel}] Extracting clip {i+1}/3 at {ts}s → {out}")
            ok = await download_4k_clip(url, ts, duration, out)
            if ok:
                succeeded += 1
            else:
                await log_msg("WARNING", f"[{klabel}] Clip {i+1} failed — skipping.")

        if succeeded == 0:
            await log_msg("ERROR", f"[{klabel}] All extractions failed. Source may be geo-blocked — try Internet Archive.")
        else:
            await log_msg("INFO", f"[{klabel}] Done: {succeeded}/3 clips saved.")

    # --- Step 3: Clean up shared preview ---
    if os.path.exists(temp_file):
        os.remove(temp_file)

    await log_msg("INFO", f"=== [{label}] Finished ===")


async def run_factory(feed_text, api_key):
    setup_logger()
    await log_msg("INFO", f"--- Pipeline Started at {datetime.now()} ---")

    lines = [l.strip() for l in feed_text.strip().split('\n') if l.strip()]

    for line_num, line in enumerate(lines, start=1):
        # Format: URL | DURATION | keyword1, keyword2, keyword3
        parts = [p.strip() for p in line.split('|')]
        if len(parts) < 3:
            await log_msg("WARNING", f"Skipping malformed line {line_num}: '{line}'")
            continue
        url, dur_str = parts[0], parts[1]
        prompts = [p.strip() for p in parts[2].split(',') if p.strip()]
        try:
            duration = int(dur_str)
        except ValueError:
            await log_msg("ERROR", f"Invalid duration '{dur_str}' on line {line_num} — skipping.")
            continue
        if not prompts:
            await log_msg("WARNING", f"No keywords on line {line_num} — skipping.")
            continue

        await process_url_line(api_key, line_num, url, duration, prompts)

    await log_msg("INFO", "--- Batch processing complete ---")
    await log_msg("INFO", f"--- Pipeline Finished at {datetime.now()} ---")

if __name__ == "__main__":
    # Example usage
    # asyncio.run(run_factory("https://www.youtube.com/watch?v=... | 8 | people fighting", "YOUR_KEY"))
    pass
