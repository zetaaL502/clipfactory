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

# Logger setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)

async def log_msg(level, message):
    getattr(logging, level.lower())(message)

def sanitize_filename(name):
    return re.sub(r'[^a-zA-Z0-9]', '_', name).lower()[:50]

async def execute_fallback(output_path, duration, is_4k=True):
    size = "3840x2160" if is_4k else "256x144"
    await log_msg("WARNING", f"Generating black screen fallback for {output_path} (Video unreachable)")
    
    # Generate clean black video with informational text, NO AUDIO
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=black:s={size}:d={duration}:r=30",
        "-vf", "drawtext=text='Video Processing Fallback':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2",
        "-an", # No audio
        "-c:v", "libx264",
        "-t", str(duration),
        output_path
    ]
    process = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await process.wait()
    return process.returncode == 0

async def download_low_res(url, output_path):
    """Download tiny version for AI analysis quickly"""
    ydl_opts = {
        'format': 'worstvideo[height<=144]',
        'outtemplate': output_path,
        'noplaylist': True,
        'quiet': True,
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return True
    except Exception as e:
        await log_msg("ERROR", f"Low-res download failed for {url}: {str(e)}")
        return False

async def download_4k_clip(url, start_time, duration, output_path):
    """Accurately trim the high-res version from source, NO AUDIO"""
    # Using download_sections for accuracy
    section = f"*{start_time}-{start_time + duration}"
    ydl_opts = {
        'format': 'bestvideo[height<=2160]', # Video only
        'download_sections': [{'title': 'section', 'parts': [{'start_time': start_time, 'end_time': start_time + duration}]}],
        'outtmpl': output_path,
        'merge_output_format': 'mp4',
        'noplaylist': True,
        'quiet': True,
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return True
    except Exception as e:
        await log_msg("ERROR", f"4K Download failed for {url} at {start_time}s: {str(e)}")
        # If it fails (e.g. YouTube blocking), try fallback
        return await execute_fallback(output_path, duration, True)

async def analyze_video(api_key, video_path, prompt):
    """Use Gemini 1.5 Flash to find 3 distinct scenes"""
    if not api_key:
        await log_msg("ERROR", "Missing Google API Key for analysis")
        return [0, 10, 20] # Default fallback

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(MODEL_NAME)
        
        # Upload file to Gemini
        file = genai.upload_file(path=video_path)
        
        while file.state.name == "PROCESSING":
            await asyncio.sleep(2)
            file = genai.get_file(file.name)
            
        system_instruction = (
            "You are a professional video editor. Identify 3 DISTINCT timestamps (start times in seconds) "
            f"in the video that best match the visual prompt: '{prompt}'. "
            "The scenes must be at least 15 seconds apart if the video is long enough. "
            "Return ONLY the numbers separated by commas (e.g., 12, 55, 120). No other text."
        )
        
        response = model.generate_content([file, prompt], generation_config={"candidate_count": 1}, system_instruction=system_instruction)
        text = response.text.strip()
        await log_msg("INFO", f"Gemini suggested timestamps: {text}")
        
        # Parse numbers
        timestamps = []
        for t in text.split(','):
            try:
                timestamps.append(float(t.strip()))
            except:
                continue
                
        # cleanup
        genai.delete_file(file.name)
        
        if timestamps:
            return timestamps[:3]
        return [0, 5, 10]
    except Exception as e:
        await log_msg("ERROR", f"Gemini analysis failed: {str(e)}")
        return [0, 5, 10]

async def process_entry(api_key, index, url, duration, prompt):
    sanitized = sanitize_filename(prompt)
    temp_file = os.path.join(TEMP_DIR, f"temp_{index}.mp4")
    
    await log_msg("INFO", f"--- Processing Entry {index}: {prompt} ---")
    
    # 1. Download preview
    success = await download_low_res(url, temp_file)
    if not success:
        await execute_fallback(temp_file, 30, False) # temporary fake for Gemini
        
    # 2. Analyze
    timestamps = await analyze_video(api_key, temp_file, prompt)
    
    # 3. Clean up temp preview
    if os.path.exists(temp_file):
        os.remove(temp_file)
        
    # 4. Extract 3 clips
    for i, ts in enumerate(timestamps):
        output_file = os.path.join(CLIPS_DIR, f"{sanitized}_{index}_part_{i+1}.mp4")
        await log_msg("INFO", f"Extracting clip {i+1}/3 for '{prompt}' at {ts}s...")
        await download_4k_clip(url, ts, duration, output_file)

async def run_factory(feed_text, api_key):
    # Setup log
    with open(LOG_FILE, "w") as f:
        f.write(f"--- Pipeline Started at {datetime.now()} ---\n")
        
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
    with open(LOG_FILE, "a") as f:
        f.write(f"\n--- Pipeline Finished at {datetime.now()} ---\n")

if __name__ == "__main__":
    # Example usage
    # asyncio.run(run_factory("https://www.youtube.com/watch?v=... | 8 | people fighting", "YOUR_KEY"))
    pass
