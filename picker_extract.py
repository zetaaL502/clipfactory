"""
Single clip extractor for the Picker tool.
Usage: python3 picker_extract.py <url> <timestamp> <duration> <output_path> [credit]
"""
import sys
import asyncio
import os
sys.path.insert(0, os.path.dirname(__file__))
from clip_factory import download_4k_clip

async def main():
    url = sys.argv[1]
    timestamp = int(sys.argv[2])
    duration = int(sys.argv[3])
    output_path = sys.argv[4]
    credit = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    success = await download_4k_clip(url, timestamp, duration, output_path, credit=credit, no_audio=True)
    sys.exit(0 if success else 1)

asyncio.run(main())
