"""
Picker backend: downloads videos and extracts thumbnails every THUMB_INTERVAL seconds.
Usage: python3 picker.py <job_dir>
"""
import sys
import os
import json
import glob
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

async def ensure_mp4(ffmpeg, src_path, dst_path):
    """Convert any video to mp4 using copy first, re-encode if that fails."""
    proc = await asyncio.create_subprocess_exec(
        ffmpeg, "-y", "-i", src_path, "-c", "copy", dst_path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    await proc.communicate()
    if os.path.exists(dst_path) and os.path.getsize(dst_path) > 1000:
        return True
    # copy failed — try re-encode
    proc = await asyncio.create_subprocess_exec(
        ffmpeg, "-y", "-i", src_path, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", dst_path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    await proc.communicate()
    return os.path.exists(dst_path) and os.path.getsize(dst_path) > 1000

async def process_video(job_dir, video_index, url, clip_duration=30):
    video_dir = os.path.join(job_dir, str(video_index))
    os.makedirs(video_dir, exist_ok=True)
    thumb_dir = os.path.join(video_dir, "thumbs")
    os.makedirs(thumb_dir, exist_ok=True)
    status_path = os.path.join(video_dir, "status.json")
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"

    write_status(status_path, {"status": "downloading", "url": url, "thumbnails": []})

    # Download — prefer mp4 format so browser can play it inline
    # Falls back progressively: small mp4 → any mp4 → small anything → anything
    ydl_opts = {
        'format': (
            'best[height<=360][ext=mp4]'
            '/best[height<=480][ext=mp4]'
            '/best[ext=mp4]'
            '/best[height<=360]'
            '/best'
        ),
        'outtmpl': os.path.join(video_dir, 'video.%(ext)s'),
        'noplaylist': True,
        'quiet': False,
        'no_warnings': False,
        'user_agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/120.0.0.0 Safari/537.36'
        ),
        'retries': 5,
        'fragment_retries': 5,
        'socket_timeout': 30,
    }

    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        write_status(status_path, {"status": "error", "url": url, "error": str(e), "thumbnails": []})
        return

    # Find the downloaded file (yt-dlp uses %(ext)s so the extension varies)
    video_path = os.path.join(video_dir, 'video.mp4')
    if not os.path.exists(video_path) or os.path.getsize(video_path) < 1000:
        # Look for non-mp4 files yt-dlp may have created
        candidates = sorted(
            glob.glob(os.path.join(video_dir, 'video.*')),
            key=os.path.getsize, reverse=True
        )
        found = next(
            (c for c in candidates if os.path.getsize(c) > 1000 and not c.endswith('.mp4')),
            None
        )
        if found:
            print(f"[picker] Converting {found} → video.mp4", flush=True)
            ok = await ensure_mp4(ffmpeg, found, video_path)
            if ok:
                os.remove(found)
            else:
                # Use whatever we got as-is and rename
                os.rename(found, video_path)
        else:
            # Check for a partial mp4 from a previous attempt
            if not (os.path.exists(video_path) and os.path.getsize(video_path) > 1000):
                write_status(status_path, {
                    "status": "error", "url": url,
                    "error": "Download failed or file is empty.", "thumbnails": []
                })
                return

    if not os.path.exists(video_path) or os.path.getsize(video_path) < 1000:
        write_status(status_path, {
            "status": "error", "url": url,
            "error": "Download failed or file is empty.", "thumbnails": []
        })
        return

    duration = await get_duration(video_path)
    write_status(status_path, {"status": "extracting", "url": url, "duration": duration, "thumbnails": []})

    THUMB_INTERVAL = max(clip_duration, 10)

    # Start at THUMB_INTERVAL so first thumb isn't a black frame; if video is very short, start at 0
    start_offset = THUMB_INTERVAL if (duration and duration > THUMB_INTERVAL * 2) else 0

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

    # If no thumbs extracted, retry from 0
    thumbs = sorted([f for f in os.listdir(thumb_dir) if f.endswith('.jpg')])
    if not thumbs and start_offset > 0:
        cmd[3] = "0"
        start_offset = 0
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
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
        "thumbInterval": THUMB_INTERVAL,
        "thumbStartOffset": start_offset,
        "thumbnails": thumb_data,
    })

async def main():
    job_dir = sys.argv[1]

    urls_path = os.path.join(job_dir, "urls.json")
    with open(urls_path) as f:
        data = json.load(f)

    urls = data["urls"]
    clip_duration = int(data.get("duration", 30))

    write_status(os.path.join(job_dir, "status.json"), {"status": "running", "total": len(urls)})

    tasks = [process_video(job_dir, i, url, clip_duration) for i, url in enumerate(urls)]
    await asyncio.gather(*tasks)

    write_status(os.path.join(job_dir, "status.json"), {"status": "done", "total": len(urls)})

if __name__ == "__main__":
    asyncio.run(main())
