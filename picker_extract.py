"""
Single clip extractor for the Picker tool.
Usage: python3 picker_extract.py <local_video_path> <timestamp> <duration> <output_path>
       python3 picker_extract.py <url> <timestamp> <duration> <output_path> [credit]  (legacy fallback)
"""
import sys
import asyncio
import os
import shutil
import subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def find_ffmpeg():
    """Find ffmpeg binary, checking PATH and common Windows install locations."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    candidates = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "ffmpeg", "bin", "ffmpeg.exe"),
        os.path.join(os.environ.get("USERPROFILE", ""), "ffmpeg", "bin", "ffmpeg.exe"),
        os.path.join(os.environ.get("USERPROFILE", ""), "scoop", "shims", "ffmpeg.exe"),
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return "ffmpeg"


def find_font():
    """Find a font file for drawtext, cross-platform."""
    candidates = [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def cut_local_video(local_path, timestamp, duration, output_path, credit=None, font_size=11):
    """Cut a clip from a local video file using ffmpeg. Returns True on success."""
    ffmpeg = find_ffmpeg()
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    vf_filter = ""
    if credit:
        font = find_font()
        escaped = credit.replace("'", "\\'").replace(":", "\\:")
        if font:
            vf_filter = f"drawtext=fontfile='{font}':text='{escaped}':fontsize={font_size}:fontcolor=white:borderw=1:bordercolor=black:x=8:y=h-th-8"
        else:
            vf_filter = f"drawtext=text='{escaped}':fontsize={font_size}:fontcolor=white:borderw=1:bordercolor=black:x=8:y=h-th-8"

    cmd = [
        ffmpeg, "-y",
        "-ss", str(int(timestamp)),
        "-i", local_path,
        "-t", str(int(duration)),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-an",
        "-movflags", "+faststart",
    ]
    if vf_filter:
        cmd += ["-vf", vf_filter]
    cmd += [output_path]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=300)
        if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 100:
            return True
        print(f"[picker_extract] ffmpeg error: {result.stderr.decode()[-300:]}", file=sys.stderr)
        return False
    except FileNotFoundError:
        print(f"[picker_extract] ffmpeg not found. Tried: {ffmpeg}\nInstall ffmpeg and add it to PATH.", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[picker_extract] ffmpeg failed: {e}", file=sys.stderr)
        return False


async def main():
    if len(sys.argv) < 5:
        print("Usage: picker_extract.py <local_video_or_url> <timestamp> <duration> <output_path> [credit] [font_size]", file=sys.stderr)
        sys.exit(1)

    source = sys.argv[1]
    timestamp = int(sys.argv[2])
    duration = int(sys.argv[3])
    output_path = sys.argv[4]
    credit = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None
    font_size = int(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else 11

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # If source is a local file, cut directly — no network needed
    if os.path.isfile(source):
        success = cut_local_video(source, timestamp, duration, output_path, credit=credit, font_size=font_size)
        sys.exit(0 if success else 1)

    # Otherwise treat as URL and download+cut
    from clip_factory import download_4k_clip
    success = await download_4k_clip(source, timestamp, duration, output_path, credit=credit, no_audio=True, font_size=font_size)
    sys.exit(0 if success else 1)


asyncio.run(main())
