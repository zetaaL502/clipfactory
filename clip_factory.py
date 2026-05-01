import asyncio
import json
import os
import re
import subprocess
import time
import logging
from pathlib import Path
import shutil
from typing import Optional, Tuple, List
from google import genai
from google.genai import types

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("pipeline.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Constants
CLIPS_DIR = Path("clips")
TEMP_DIR = Path("trashed_144p")
MAX_CONCURRENT_UPLOADS = 5
MAX_CONCURRENT_ANALYSIS = 5
GEMINI_RPM_LIMIT = 15
MODEL_NAME = "gemini-1.5-flash"

# Ensure directories exist
CLIPS_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

# Rate Limiter for Gemini API
class RateLimiter:
    def __init__(self, rpm):
        self.interval = 60.0 / rpm
        self.lock = asyncio.Lock()
        self.last_call = 0

    async def wait(self):
        async with self.lock:
            elapsed = time.time() - self.last_call
            if elapsed < self.interval:
                await asyncio.sleep(self.interval - elapsed)
            self.last_call = time.time()

gemini_rate_limiter = RateLimiter(GEMINI_RPM_LIMIT)
upload_semaphore = asyncio.Semaphore(MAX_CONCURRENT_UPLOADS)
analysis_semaphore = asyncio.Semaphore(MAX_CONCURRENT_ANALYSIS)

def sanitize_filename(text: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_]', '_', text).strip('_')

async def run_command(cmd: List[str], description: str) -> Tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    return process.returncode, stdout.decode().strip(), stderr.decode().strip()

async def download_low_res(url: str, output_path: Path) -> bool:
    """Download 144p version of the video."""
    cmd = [
        "yt-dlp",
        "-f", "worstvideo[height<=144]+worstaudio/worst[height<=144]",
        "--merge-output-format", "mp4",
        "-o", str(output_path),
        url
    ]
    retries = 3
    for i in range(retries):
        logger.info(f"Downloading 144p: {url} (Attempt {i+1})")
        code, out, err = await run_command(cmd, "yt-dlp low-res")
        if code == 0:
            return True
        logger.warning(f"Failed to download 144p for {url}: {err}")
        await asyncio.sleep(2 ** i)
    return False

async def download_4k_clip(url: str, start_time: float, duration: float, output_path: Path) -> bool:
    """Download the 4K segment using yt-dlp's section download."""
    # Add safety margin
    safe_start = max(0, start_time - 2)
    end_time = start_time + duration + 2
    
    # Format: *start-end
    section = f"*{safe_start}-{end_time}"
    
    cmd = [
        "yt-dlp",
        "--download-sections", section,
        "-f", "bestvideo[height<=2160]+bestaudio/best",
        "--merge-output-format", "mp4",
        "-o", str(output_path),
        url
    ]
    
    retries = 3
    for i in range(retries):
        logger.info(f"Downloading 4K clip: {url} at {safe_start}s (Attempt {i+1})")
        code, out, err = await run_command(cmd, "yt-dlp 4k trim")
        if code == 0:
            return True
        logger.warning(f"Failed to download 4K clip for {url}: {err}")
        await asyncio.sleep(2 ** i)
    return False

async def analyze_video(client: genai.Client, video_path: Path, prompt: str) -> Optional[float]:
    """Upload to Gemini File API and analyze for timestamp."""
    async with upload_semaphore:
        logger.info(f"Uploading {video_path.name} to Gemini...")
        file = await asyncio.to_thread(client.files.upload, path=str(video_path))
        
        # Wait for file to be ready
        while file.state.name == "PROCESSING":
            await asyncio.sleep(5)
            file = await asyncio.to_thread(client.files.get, name=file.name)
        
        if file.state.name != "ACTIVE":
            logger.error(f"File upload failed for {video_path.name}: {file.state.name}")
            try:
                await asyncio.to_thread(client.files.delete, name=file.name)
            except:
                pass
            return None

    async with analysis_semaphore:
        await gemini_rate_limiter.wait()
        logger.info(f"Analyzing {video_path.name} for prompt: {prompt}")
        
        system_prompt = (
            "You are a video analysis expert. Given a video and a visual prompt, "
            "identify the exact second (timestamp) where the action starts. "
            "Return ONLY the number in seconds, nothing else. If not found, return 'NOT_FOUND'."
        )
        
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=MODEL_NAME,
                contents=[
                    file,
                    f"Visual prompt: {prompt}"
                ],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt
                )
            )
            
            text = response.text.strip()
            logger.info(f"Gemini response for {video_path.name}: {text}")
            
            # Simple cleanup of response
            match = re.search(r'(\d+(\.\d+)?)', text)
            if match:
                return float(match.group(1))
            else:
                return None
        except Exception as e:
            logger.error(f"Error during Gemini analysis: {e}")
            return None
        finally:
            # Clean up file from Gemini
            try:
                if file:
                    await asyncio.to_thread(client.files.delete, name=file.name)
            except:
                pass

async def process_entry(client: genai.Client, index: int, url: str, duration: int, prompt: str):
    temp_file = TEMP_DIR / f"temp_{index}.mp4"
    sanitized = sanitize_filename(prompt)
    output_file = CLIPS_DIR / f"{sanitized}_{index}.mp4"
    
    print(f"Processing {index}: {prompt[:30]}...")
    
    try:
        # 1. Download 144p
        success = await download_low_res(url, temp_file)
        if not success:
            logger.error(f"Failed to download 144p for {url}")
            return

        # 2. Analyze with Gemini
        timestamp = await analyze_video(client, temp_file, prompt)
        
        # 3. Delete 144p
        if temp_file.exists():
            temp_file.unlink()
            
        if timestamp is None:
            logger.warning(f"No timestamp found for {url} with prompt '{prompt}'")
            return

        # 4. Download 4K clip
        print(f"Processing {index}: {prompt[:30]} found at {timestamp}s, trimming 4K...")
        success = await download_4k_clip(url, timestamp, duration, output_file)
        if success:
            logger.info(f"Successfully saved clip: {output_file}")
        else:
            logger.error(f"Failed to save 4K clip for {url}")

    except Exception as e:
        logger.error(f"Unexpected error processing {url}: {e}")

async def main():
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key and Path("config.json").exists():
        try:
            with open("config.json", "r") as f:
                config = json.load(f)
                api_key = config.get("GOOGLE_API_KEY")
        except Exception as e:
            logger.warning(f"Could not read config.json: {e}")

    if not api_key:
        print("Error: GOOGLE_API_KEY environment variable not set, and not found in config.json.")
        return

    client = genai.Client(api_key=api_key)
    
    if not Path("feed.txt").exists():
        print("Error: feed.txt not found.")
        return

    with open("feed.txt", "r") as f:
        lines = [line.strip() for line in f if line.strip()]

    tasks = []
    for i, line in enumerate(lines, 1):
        # parse URL | duration | prompt
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 3:
            logger.warning(f"Skipping malformed line: {line}")
            continue
            
        url, duration_str, prompt = parts[0], parts[1], parts[2]
        try:
            duration = int(duration_str)
        except ValueError:
            logger.warning(f"Invalid duration in line: {line}")
            continue
            
        tasks.append(process_entry(client, i, url, duration, prompt))

    # Run in batches of concurrency or just gather all (semaphores will handle limits)
    await asyncio.gather(*tasks)
    
    print("Batch processing complete. Check pipeline.log for details.")

if __name__ == "__main__":
    asyncio.run(main())
