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

async def analyze_video(api_key, video_path, prompt):
    """Use Gemini 1.5 Flash to find 3 distinct scenes"""
    if not api_key:
        return [0, 10, 20]

    try:
        import google.generativeai as genai
        # Force a check for the correct version logic
        if not hasattr(genai, "upload_file"):
            await log_msg("ERROR", "!!! LOCAL SDK ERROR !!! Your 'google-generativeai' package is outdated. Run: pip install -U google-generativeai")
            return [2, 12, 22]

        genai.configure(api_key=api_key)
        system_instruction = (
            "You are a professional video editor. Identify 3 DISTINCT timestamps (start times in seconds) "
            f"in the video that match: '{prompt}'. Return ONLY 3 numbers separated by commas."
        )
        model = genai.GenerativeModel(MODEL_NAME, system_instruction=system_instruction)
        
        await log_msg("INFO", f"Uploading {video_path} to Gemini...")
        # Use the explicit function from the module
        myfile = genai.upload_file(video_path)
        
        while myfile.state.name == "PROCESSING":
            await asyncio.sleep(2)
            myfile = genai.get_file(myfile.name)
            
        response = model.generate_content([myfile, f"Prompt: {prompt}"], generation_config={"candidate_count": 1})
        text = response.text.strip()
        
        timestamps = []
        found = re.findall(r"(\d+(?:\.\d+)?)", text)
        for val in found:
            timestamps.append(float(val))
                
        try: genai.delete_file(myfile.name)
        except: pass
        
        if len(timestamps) >= 3:
            timestamps.sort()
            return timestamps[:3]
        return [0, 10, 20]
    except Exception as e:
        await log_msg("ERROR", f"Gemini analysis failed: {str(e)}")
        return [0, 10, 20]


async def process_entry(api_key, index, url, duration, prompt):
    sanitized = sanitize_filename(prompt)
    temp_file = os.path.join(TEMP_DIR, f"temp_{index}.mp4")
    
    await log_msg("INFO", f"--- Processing Entry {index}: {prompt} ---")
    
    # 1. Download low-res preview for Gemini analysis
    low_res_ok = await download_low_res(url, temp_file)
    if not low_res_ok:
        # Try a quick test 4K download to see if source is accessible at all
        await log_msg("WARNING", f"Low-res preview unavailable for entry {index} — attempting direct extraction anyway.")
        
    # 2. Analyze (use temp file if it exists, else use default timestamps)
    timestamps = await analyze_video(api_key, temp_file, prompt) if os.path.exists(temp_file) else [0, 10, 20]
    
    # 3. Clean up temp preview
    if os.path.exists(temp_file):
        os.remove(temp_file)
        
    # 4. Extract clips — only save ones that actually download successfully
    succeeded = 0
    for i, ts in enumerate(timestamps):
        output_file = os.path.join(CLIPS_DIR, f"{sanitized}_{index}_part_{i+1}.mp4")
        await log_msg("INFO", f"Extracting clip {i+1}/3 for '{prompt}' at {ts}s...")
        ok = await download_4k_clip(url, ts, duration, output_file)
        if ok:
            succeeded += 1
    
    if succeeded == 0:
        await log_msg("ERROR", f"Entry {index} ('{prompt}'): all clip extractions failed — source may be geo-blocked or unavailable on this server. Try Internet Archive links instead of YouTube.")
    else:
        await log_msg("INFO", f"Entry {index} ('{prompt}'): {succeeded}/3 clips extracted successfully.")

async def run_factory(feed_text, api_key):
    setup_logger()
    await log_msg("INFO", f"--- Pipeline Started at {datetime.now()} ---")
        
    lines = [l.strip() for l in feed_text.strip().split('\n') if l.strip()]
    tasks = []
    
    for i, line in enumerate(lines):
        # Format: URL | DURATION | PROMPT
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 3:
            url, dur, prompt = parts[0], parts[1], parts[2]
            try:
                duration = int(dur)
                tasks.append(process_entry(api_key, i+1, url, duration, prompt))
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
