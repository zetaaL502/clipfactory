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
MODEL_NAME = "gemini-1.5-flash"  # Reliable for video analysis

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
    """Accurately trim the high-res version from source, NO AUDIO"""
    def get_ranges(info_dict, ydl):
        return [{'start_time': start_time, 'end_time': start_time + duration}]
        
    import shutil
    ffmpeg_path = shutil.which("ffmpeg") or "ffmpeg"
        
    ydl_opts = {
        'format': 'bestvideo[height<=2160]/best[height<=2160]',
        'download_ranges': get_ranges,
        'outtmpl': output_path,
        'merge_output_format': 'mp4',
        'noplaylist': True,
        'ffmpeg_location': ffmpeg_path,
        'quiet': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        # Check if file exists and has real content (min 10KB)
        if os.path.exists(output_path) and os.path.getsize(output_path) > 10000:
            return True
        else:
            await log_msg("WARNING", f"Download produced empty/corrupt file for {output_path} — skipping clip.")
            if os.path.exists(output_path):
                os.remove(output_path)
            return False
    except Exception as e:
        await log_msg("ERROR", f"4K Download failed for {url} at {start_time}s: {str(e)} — skipping clip.")
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


async def process_entry(api_key, line_num, keyword_num, url, duration, prompt):
    sanitized = sanitize_filename(prompt)
    temp_file = os.path.join(TEMP_DIR, f"temp_s{line_num}_k{keyword_num}.mp4")
    
    label = f"S{line_num}/K{keyword_num}"
    await log_msg("INFO", f"--- [{label}] Processing '{prompt}' ---")
    
    # 1. Download low-res preview for Gemini analysis
    low_res_ok = await download_low_res(url, temp_file)
    if not low_res_ok:
        await log_msg("WARNING", f"[{label}] Low-res preview unavailable — attempting direct extraction anyway.")
        
    # 2. Analyze (use temp file if it exists, else spread evenly)
    if os.path.exists(temp_file):
        timestamps = await analyze_video(api_key, temp_file, prompt, clip_duration=duration)
    else:
        timestamps = spread_timestamps(None, duration)
    
    # 3. Clean up temp preview
    if os.path.exists(temp_file):
        os.remove(temp_file)
        
    # 4. Extract clips — filename encodes segment (line) and keyword so UI can group by URL
    # Format: {prompt}_s{line_num}_k{keyword_num}_part_{n}.mp4
    succeeded = 0
    for i, ts in enumerate(timestamps):
        output_file = os.path.join(CLIPS_DIR, f"{sanitized}_s{line_num}_k{keyword_num}_part_{i+1}.mp4")
        await log_msg("INFO", f"[{label}] Extracting clip {i+1}/3 for '{prompt}' at {ts}s...")
        ok = await download_4k_clip(url, ts, duration, output_file)
        if ok:
            succeeded += 1
    
    if succeeded == 0:
        await log_msg("ERROR", f"[{label}] '{prompt}': all extractions failed — source may be geo-blocked. Try Internet Archive instead of YouTube.")
    else:
        await log_msg("INFO", f"[{label}] '{prompt}': {succeeded}/3 clips extracted successfully.")

async def run_factory(feed_text, api_key):
    setup_logger()
    await log_msg("INFO", f"--- Pipeline Started at {datetime.now()} ---")
        
    lines = [l.strip() for l in feed_text.strip().split('\n') if l.strip()]
    tasks = []
    
    for line_num, line in enumerate(lines, start=1):
        # Format: URL | DURATION | prompt1, prompt2, prompt3
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 3:
            url, dur = parts[0], parts[1]
            prompts_raw = parts[2]
            # Support comma-separated prompts — each gets its own 3 clips, grouped under same line
            prompts = [p.strip() for p in prompts_raw.split(',') if p.strip()]
            try:
                duration = int(dur)
                for keyword_num, prompt in enumerate(prompts, start=1):
                    tasks.append(process_entry(api_key, line_num, keyword_num, url, duration, prompt))
            except ValueError:
                await log_msg("ERROR", f"Invalid duration in line: {line}")
                
    if tasks:
        await asyncio.gather(*tasks)
        
    await log_msg("INFO", "--- Batch processing complete ---")
    await log_msg("INFO", f"--- Pipeline Finished at {datetime.now()} ---")

if __name__ == "__main__":
    # Example usage
    # asyncio.run(run_factory("https://www.youtube.com/watch?v=... | 8 | people fighting", "YOUR_KEY"))
    pass
