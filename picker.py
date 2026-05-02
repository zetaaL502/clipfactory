"""
Picker backend: downloads videos and extracts thumbnails every 30 seconds.
Usage: python3 picker.py <job_dir>
"""
import sys
import os
import json
import asyncio
import shutil
from yt_dlp import YoutubeDL

def write_status(path, data):
    with open(path, 'w') as f:
        json.dump(data, f)

async def get_duration(video_path):
    ffprobe = shutil.which("ffprobe") or "ffprobe"
    try:
        proc = await asyncio.create_subprocess_exec(
            ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", video_path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        return float(json.loads(stdout)["format"]["duration"])
    except Exception:
        return None

async def process_video(job_dir, video_index, url):
    video_dir = os.path.join(job_dir, str(video_index))
    os.makedirs(video_dir, exist_ok=True)
    thumb_dir = os.path.join(video_dir, "thumbs")
    os.makedirs(thumb_dir, exist_ok=True)
    status_path = os.path.join(video_dir, "status.json")

    write_status(status_path, {"status": "downloading", "url": url, "thumbnails": []})

    video_path = os.path.join(video_dir, "video.mp4")
    ydl_opts = {
        'format': 'worst[height<=360]/worst',
        'outtmpl': video_path,
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        write_status(status_path, {"status": "error", "url": url, "error": str(e), "thumbnails": []})
        return

    if not os.path.exists(video_path) or os.path.getsize(video_path) < 1000:
        write_status(status_path, {"status": "error", "url": url, "error": "Download failed or file is empty.", "thumbnails": []})
        return

    duration = await get_duration(video_path)
    write_status(status_path, {"status": "extracting", "url": url, "duration": duration, "thumbnails": []})

    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"

    THUMB_INTERVAL = 15  # one thumbnail every 15 seconds

    # Try starting at 15s; if video is shorter than 15s start from 0
    start_offset = THUMB_INTERVAL if (duration and duration > THUMB_INTERVAL) else 0
    cmd = [
        ffmpeg, "-y",
        "-ss", str(start_offset), "-i", video_path,
        "-vf", f"fps=1/{THUMB_INTERVAL},scale=320:-1",
        "-q:v", "3",
        os.path.join(thumb_dir, "thumb_%04d.jpg")
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    await proc.communicate()

    # If no thumbs extracted (very short video), try from 0
    thumbs = sorted([f for f in os.listdir(thumb_dir) if f.endswith('.jpg')])
    if not thumbs and start_offset > 0:
        cmd[3] = "0"
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await proc.communicate()
        thumbs = sorted([f for f in os.listdir(thumb_dir) if f.endswith('.jpg')])

    thumb_data = []
    for i, thumb in enumerate(thumbs):
        ts = start_offset + i * THUMB_INTERVAL
        m, s = divmod(ts, 60)
        thumb_data.append({"file": thumb, "timestamp": ts, "label": f"{m}:{s:02d}"})

    write_status(status_path, {
        "status": "done",
        "url": url,
        "duration": duration,
        "thumbnails": thumb_data
    })

async def main():
    job_dir = sys.argv[1]

    urls_path = os.path.join(job_dir, "urls.json")
    with open(urls_path) as f:
        data = json.load(f)

    urls = data["urls"]

    write_status(os.path.join(job_dir, "status.json"), {"status": "running", "total": len(urls)})

    tasks = [process_video(job_dir, i, url) for i, url in enumerate(urls)]
    await asyncio.gather(*tasks)

    write_status(os.path.join(job_dir, "status.json"), {"status": "done", "total": len(urls)})

if __name__ == "__main__":
    asyncio.run(main())
