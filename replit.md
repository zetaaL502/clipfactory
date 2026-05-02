# Clip Factory V2

## Overview

A web app for batch-extracting video clips from YouTube and other sources. Uses yt-dlp to fetch stream URLs and FFmpeg to cut clips at precise timestamps. No AI involved.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS (TypeScript)
- **Server**: Express.js (`server.ts`) — serves the React frontend and API routes
- **Backend Pipeline**: Python (`clip_factory.py`) — video downloading (yt-dlp) + clip extraction (FFmpeg)
- **Port**: 5000 (unified — Express serves both API and Vite middleware)

## How It Works

### Feed Tab (Batch Mode)
1. User enters feed entries in format: `URL | duration_seconds | start_time | @credit (optional)`
2. Clicks "Run Pipeline" → Express spawns a Python process
3. Python uses yt-dlp to get the direct stream URL, then FFmpeg seeks to `start_time` and cuts the clip
4. If a `@credit` field is provided it is burned into the bottom-left corner via FFmpeg drawtext filter
5. Clips appear in the "Clips" tab for preview, download (ZIP), or deletion

### Picker Tab (Visual Mode)
1. Paste URLs + set duration
2. Backend downloads each video and extracts thumbnails every 30 seconds (concurrent)
3. User clicks thumbnails to select moments
4. Selected clips are cut and downloaded as a ZIP

## Key Files

- `server.ts` — Express server with API routes (clip factory + picker) and Vite dev middleware
- `clip_factory.py` — Python pipeline: yt-dlp URL fetch → FFmpeg clip extraction
- `picker.py` — Picker backend: downloads videos concurrently, extracts thumbnails every 30s
- `picker_extract.py` — Single clip extractor used by the Picker download flow
- `src/App.tsx` — Main React UI with tabs: Feed, Picker, Logs, Clips, Settings, Guide
- `src/Picker.tsx` — Manual Clip Picker React component
- `vite.config.ts` — Vite config (port 5000, allowedHosts: true for Replit proxy)
- `requirements.txt` — Python dependencies (yt-dlp, fastapi, uvicorn, aiofiles)
- `feed.txt` — Persisted feed input
- `clips/` — Output directory for generated .mp4 clips
- `picker_jobs/` — Temporary job directories for picker thumbnails and clips

## Feed Format

```
URL | duration_seconds | start_time | @credit

# start_time accepts: MM:SS, HH:MM:SS, or plain seconds
https://archive.org/... | 10 | 1:30 | @mychannel
https://youtube.com/... | 8  | 0:04:22
https://youtube.com/... | 15 | 90
```

## Development

Run: `npm run dev`
This starts the Express server which embeds Vite as middleware in dev mode.

## Deployment

- Target: autoscale
- Build: `npm run build`
- Run: `node server.ts`
- The server detects `NODE_ENV=production` and serves the built `dist/` folder
