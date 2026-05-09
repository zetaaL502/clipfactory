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
from pathlib import Path
from yt_dlp import YoutubeDL

try:
    import imageio_ffmpeg
    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
    FFPROBE_PATH = None  # ffprobe not included in imageio_ffmpeg
except ImportError:
    FFMPEG_PATH = shutil.which("ffmpeg")
    FFPROBE_PATH = shutil.which("ffprobe")


def write_status(path, data):
    with open(path, 'w') as f:
        json.dump(data, f)

def thumbnail_public_path(job_dir, video_index, filename):
    base = Path(__file__).resolve().parent / "thumbnails"
    target = base / Path(job_dir).name / str(video_index)
    target.mkdir(parents=True, exist_ok=True)
    return str(target / filename)

async def get_duration(video_path):
    ffprobe = FFPROBE_PATH or "ffprobe"
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

async def process_video(job_dir, video_index, url, clip_duration=30, credit=None):
    video_dir = os.path.join(job_dir, str(video_index))
    os.makedirs(video_dir, exist_ok=True)
    thumb_dir = os.path.join(video_dir, "thumbs")
    os.makedirs(thumb_dir, exist_ok=True)
    status_path = os.path.join(video_dir, "status.json")
    ffmpeg = FFMPEG_PATH or "ffmpeg"

    video_path = os.path.join(video_dir, 'video.mp4')

    # If video.mp4 already exists (uploaded by user), skip download entirely.
    if os.path.exists(video_path) and os.path.getsize(video_path) > 1000:
        write_status(status_path, {"status": "extracting", "url": url, "thumbnails": []})
    else:
        # ── Download via yt-dlp ──────────────────────────────────────────────
        write_status(status_path, {"status": "downloading", "url": url, "thumbnails": []})

        # ios/mweb bypass n-challenge but don't accept cookies → try without cookies first.
        # Format 18 (360p muxed mp4) is a universal YouTube fallback — no challenge, no tokens.
        cookies_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cookies.txt')
        has_cookies = os.path.exists(cookies_file)
        # (extractor_args or None, use_cookies, format)
        attempts = [
            ({'youtube': {'player_client': ['ios']}},  False,       'best'),
            ({'youtube': {'player_client': ['mweb']}}, False,       'best'),
            (None,                                      False,       '18'),
            (None,                                      has_cookies, 'best'),
        ]
        last_err = None
        for ext_args, use_cookies, fmt in attempts:
            ydl_opts = {
                'format': fmt,
                'outtmpl': os.path.join(video_dir, 'video.%(ext)s'),
                'noplaylist': True,
                'quiet': False,
                'no_warnings': False,
                'retries': 3,
                'fragment_retries': 3,
                'socket_timeout': 30,
            }
            if ext_args:
                ydl_opts['extractor_args'] = ext_args
            if use_cookies:
                ydl_opts['cookiefile'] = cookies_file
            try:
                with YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
                last_err = None
                break
            except Exception as e:
                last_err = e
                for f in glob.glob(os.path.join(video_dir, 'video.*')):
                    try: os.remove(f)
                    except Exception: pass

        if last_err is not None:
            write_status(status_path, {"status": "error", "url": url, "error": str(last_err), "thumbnails": []})
            return

        # Find the downloaded file (yt-dlp uses %(ext)s so the extension varies)
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
                    os.rename(found, video_path)
            else:
                if not (os.path.exists(video_path) and os.path.getsize(video_path) > 1000):
                    write_status(status_path, {
                        "status": "error", "url": url,
                        "error": "Download failed or file is empty.", "thumbnails": []
                    })
                    return

    # ── Final validation ─────────────────────────────────────────────────────
    if not os.path.exists(video_path) or os.path.getsize(video_path) < 1000:
        write_status(status_path, {
            "status": "error", "url": url,
            "error": "Download failed or file is empty.", "thumbnails": []
        })
        return

    # ── Thumbnail extraction ─────────────────────────────────────────────────
    duration = await get_duration(video_path)
    write_status(status_path, {"status": "extracting", "url": url, "duration": duration, "credit": credit, "thumbnails": []})

    # Use clip_duration as the thumbnail interval so each thumb represents one clip.
    # Floor at 1s to avoid divide-by-zero.
    THUMB_INTERVAL = max(clip_duration, 1)

    # For short videos (< 2 clip-lengths), start at 0 so we capture all content.
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
        public_path = thumbnail_public_path(job_dir, video_index, thumb)
        source_path = os.path.join(thumb_dir, thumb)
        if os.path.exists(source_path):
            shutil.copy2(source_path, public_path)
        thumb_data.append({"file": f"{Path(job_dir).name}/{video_index}/{thumb}", "timestamp": ts, "label": f"{m}:{s:02d}"})

    write_status(status_path, {
        "status": "done",
        "url": url,
        "credit": credit,
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

    urls = [u.split('|')[0].strip() for u in data["urls"]]
    url_credits = data.get("urlCredits", [])
    clip_duration = int(data.get("duration", 30))

    write_status(os.path.join(job_dir, "status.json"), {"status": "running", "total": len(urls)})

    tasks = [
        process_video(job_dir, i, url, clip_duration, credit=url_credits[i] if i < len(url_credits) else None)
        for i, url in enumerate(urls)
    ]
    await asyncio.gather(*tasks)

    write_status(os.path.join(job_dir, "status.json"), {"status": "done", "total": len(urls)})

if __name__ == "__main__":
    asyncio.run(main())
