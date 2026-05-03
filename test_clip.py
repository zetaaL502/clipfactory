import os
from yt_dlp import YoutubeDL
import imageio_ffmpeg

# Use the bundled FFmpeg
FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()

def _yt_dlp_js_opts():
    return {
        'cookies': 'cookies.txt',
        'js_code': '''
            function() {
                return {
                    'navigator': {
                        'userAgent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                };
            }
        ''',
        'extractor_args': {
            'youtube': {
                'player_client': ['android', 'web'],
                'player_skip': ['js', 'configs', 'webpage'],
            }
        }
    }

ydl_opts = {
    'format': 'bestvideo[height<=2160]/best[height<=2160]',
    'download_sections': [{
        'title': 'section',
        'parts': [{
            'start_time': 10,
            'end_time': 15
        }]
    }],
    'outtmpl': 'test2.mp4',
    'merge_output_format': 'mp4',
    'ffmpeg_location': FFMPEG_PATH,
}

# Add JS runtime options
ydl_opts.update(_yt_dlp_js_opts())

print(f"Using FFmpeg at: {FFMPEG_PATH}")
print("Testing YouTube download with cookies...")

try:
    with YoutubeDL(ydl_opts) as ydl:
        ydl.download(['https://www.youtube.com/watch?v=dQw4w9WgXcQ'])
    print("SUCCESS: YouTube download completed!")
except Exception as e:
    print(f"ERROR: {e}")
