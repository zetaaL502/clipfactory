import os
import json
import asyncio
import zipfile
import shutil
from typing import List
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import aiofiles
from clip_factory import run_factory

app = FastAPI()

# Paths
CLIPS_DIR = "clips"
CONFIG_FILE = "config.json"
FEED_FILE = "feed.txt"
LOG_FILE = "pipeline.log"
DIST_DIR = "dist"

# Models
class Settings(BaseModel):
    GOOGLE_API_KEY: str

class Feed(BaseModel):
    content: str

class ZipRequest(BaseModel):
    files: List[str]

# API Routes
@app.get("/api/pipeline-status")
async def get_status():
    if not os.path.exists(LOG_FILE):
        return {"content": "No logs yet. Start the pipeline."}
    async with aiofiles.open(LOG_FILE, mode='r') as f:
        content = await f.read()
    return {"content": content}

@app.get("/api/clips")
async def list_clips():
    if not os.path.exists(CLIPS_DIR):
        return {"files": []}
    files = [f for f in os.listdir(CLIPS_DIR) if f.endswith(".mp4")]
    return {"files": sorted(files)}

@app.get("/api/feed")
async def get_feed():
    if not os.path.exists(FEED_FILE):
        return {"content": ""}
    async with aiofiles.open(FEED_FILE, mode='r') as f:
        content = await f.read()
    return {"content": content}

@app.post("/api/feed")
async def save_feed(feed: Feed):
    async with aiofiles.open(FEED_FILE, mode='w') as f:
        await f.write(feed.content)
    return {"status": "ok"}

@app.get("/api/settings")
async def get_settings():
    if not os.path.exists(CONFIG_FILE):
        return {"GOOGLE_API_KEY": ""}
    async with aiofiles.open(CONFIG_FILE, mode='r') as f:
        content = await f.read()
    return json.loads(content)

@app.post("/api/settings")
async def save_settings(settings: Settings):
    async with aiofiles.open(CONFIG_FILE, mode='w') as f:
        await f.write(json.dumps(settings.dict()))
    return {"status": "ok"}

@app.post("/api/run")
async def run_pipeline(background_tasks: BackgroundTasks):
    # Load requirements
    try:
        async with aiofiles.open(FEED_FILE, mode='r') as f:
            feed_text = await f.read()
        async with aiofiles.open(CONFIG_FILE, mode='r') as f:
            config = json.loads(await f.read())
            api_key = config.get("GOOGLE_API_KEY")
            
        background_tasks.add_task(run_factory, feed_text, api_key)
        return {"status": "started"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/download-zip")
async def download_zip(req: ZipRequest):
    zip_path = "selected_clips.zip"
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        for file in req.files:
            file_path = os.path.join(CLIPS_DIR, file)
            if os.path.exists(file_path):
                zipf.write(file_path, arcname=file)
    
    return FileResponse(zip_path, media_type='application/zip', filename="selected_clips.zip")

@app.post("/api/delete-clips")
async def delete_clips(req: ZipRequest):
    for file in req.files:
        file_path = os.path.join(CLIPS_DIR, file)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Error deleting {file}: {e}")
    return {"status": "ok"}

@app.get("/api/download-all")
async def download_all():
    zip_path = "all_clips.zip"
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        for file in os.listdir(CLIPS_DIR):
            if file.endswith(".mp4"):
                zipf.write(os.path.join(CLIPS_DIR, file), arcname=file)
    
    return FileResponse(zip_path, media_type='application/zip', filename="all_clips.zip")

# Serve static files from clips for preview
if os.path.exists(CLIPS_DIR):
    app.mount("/clips", StaticFiles(directory=CLIPS_DIR), name="clips_static")

# Serve Frontend
if os.path.exists(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # If it's an API route, it would have been caught above
        # If it's a static file that exists, maybe it should be served, but StaticFiles handles /assets
        # Fallback to index.html for SPA routing
        index_path = os.path.join(DIST_DIR, "index.html")
        return FileResponse(index_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3001)
