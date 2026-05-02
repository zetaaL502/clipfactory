from yt_dlp import YoutubeDL
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
}
with YoutubeDL(ydl_opts) as ydl:
    ydl.download(['https://www.youtube.com/watch?v=dQw4w9WgXcQ'])
