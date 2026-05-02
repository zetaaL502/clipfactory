# Clip Factory V2

## Overview

A unified web app for batch-extracting video clips from YouTube and other sources. Uses yt-dlp to fetch stream URLs and FFmpeg to cut clips at precise timestamps. No AI involved.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS (TypeScript)
- **Server**: Express.js (`server.ts`) — serves the React frontend and API routes
- **Backend Pipeline**: Python (`clip_factory.py`) — video downloading (yt-dlp) + clip extraction (FFmpeg)
- **Port**: 5000 (unified — Express serves both API and Vite middleware)

## UI Layout (Single Page Studio)

Everything is on one scrolling page — no separate tabs for different features.

### Top: Input Panel
- URL textarea (one per line — YouTube, Vimeo, archive.org, anything yt-dlp supports)
- Duration dropdown + Credit watermark field
- **Browse & Pick** button → loads thumbnails for all URLs visually
- **Batch Run Mode** expander → reveals feed-format textarea + Run Pipeline button

### Middle: Thumbnail Grid (after Browse & Pick)
- One card per video, showing thumbnails spaced by clip duration
- Click thumbnail = select/deselect that clip
- Hover thumbnail = play button appears → inline preview modal
- "Add 4" button to load more thumbnails
- Sticky download bar when clips are selected → Download ZIP

### Bottom: Saved Clips
- Shows clips saved to server by Batch Run
- Inline video playback, per-clip download, bulk ZIP download, delete

### Overlays (slide-in panels)
- **Logs** button → slide-over showing pipeline.log in real time
- **Settings** button → slide-over with format guide and notes

## Key Files

- `server.ts` — Express server with API routes (clip factory + picker) and Vite dev middleware
- `clip_factory.py` — Python pipeline: yt-dlp URL fetch → FFmpeg clip extraction
- `picker.py` — Picker backend: downloads videos concurrently, extracts thumbnails every N seconds
- `picker_extract.py` — Single clip extractor used by the Picker download flow
- `src/App.tsx` — Main React layout shell (header, saved clips, log/settings panels)
- `src/Studio.tsx` — Unified studio component (URL input + thumbnail picker + batch mode)
- `vite.config.ts` — Vite config (port 5000, allowedHosts: true for Replit proxy)
- `requirements.txt` — Python dependencies (yt-dlp)
- `feed.txt` — Persisted batch feed input
- `clips/` — Output directory for generated .mp4 clips
- `picker_jobs/` — Temporary job directories for picker thumbnails and preview videos

## Batch Feed Format

```
URL | duration | start_time | @credit

# One clip at exact timestamp
https://youtube.com/... | 30sec | 2:30 | @BBC

# Chunk from timestamp to end (add + after time)
https://youtube.com/... | 30sec | 3:30+

# Chunk entire video from beginning
https://archive.org/... | 2min | @CNN

# Duration formats: 8sec, 2min, 1min30sec, or plain 90
# Time formats: 1:30  or  0:04:22  or  90
```

## Credit Watermark

Add `@handle` in any field to burn text into the bottom-left corner of every clip using FFmpeg drawtext filter.

## Development

Run: `npm run dev`
This starts the Express server which embeds Vite as middleware in dev mode.
