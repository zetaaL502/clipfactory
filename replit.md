# Clip Factory V2

## Overview

A web app for batch-extracting AI-curated video clips from YouTube and other sources. Uses Google Gemini to analyze videos and identify the best moments matching user-defined prompts, then downloads high-quality clips.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS (TypeScript)
- **Server**: Express.js (`server.ts`) — serves the React frontend and API routes
- **Backend Pipeline**: Python (`clip_factory.py`) — video downloading (yt-dlp) + AI analysis (Gemini 1.5 Flash) + clip extraction (ffmpeg via imageio-ffmpeg)
- **Port**: 5000 (unified — Express serves both API and Vite middleware)

## How It Works

1. User enters feed entries in format: `URL | duration_seconds | visual_prompt1, prompt2 | @credit (optional)`
2. Gemini API key is set as a Replit Secret (`GEMINI_API_KEY`)
3. Clicks "Run Pipeline" → Express spawns a Python process
4. Python downloads a low-res preview, uploads to Gemini which finds the **exact** timestamp (HH:MM:SS JSON response) for each prompt
5. FFmpeg cuts the clip at that timestamp; if a credit field is provided it is burned into the bottom-left corner via drawtext filter
6. Rate-limit protection: 8s delay between video requests; automatic 60s retry (up to 3×) on Gemini 429 errors
7. Clips appear in the "Clips" tab for preview, download (ZIP), or deletion

## Key Files

- `server.ts` — Express server with API routes and Vite dev middleware
- `vite.config.ts` — Vite config (port 5000, allowedHosts: true for Replit proxy)
- `src/App.tsx` — Main React UI with tabs: Feed, Logs, Clips, Settings, Guide
- `clip_factory.py` — Python pipeline: download → analyze → extract
- `requirements.txt` — Python dependencies (google-generativeai, yt-dlp, ffmpeg, fastapi, uvicorn)
- `feed.txt` — Persisted feed input
- `config.json` — Persisted settings (Google API key)
- `clips/` — Output directory for generated .mp4 clips

## Development

Run: `npm run dev`
This starts the Express server which embeds Vite as middleware in dev mode.

## Deployment

- Target: autoscale
- Build: `npm run build`
- Run: `node server.ts`
- The server detects `NODE_ENV=production` and serves the built `dist/` folder

## Environment Variables

- `GEMINI_API_KEY` — Google Gemini API key (can also be set via the Settings UI which saves to `config.json`)
