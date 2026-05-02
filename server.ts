import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '5000');
  const CLIPS_DIR = 'clips';
  const CONFIG_FILE = 'config.json';
  const FEED_FILE = 'feed.txt';
  const LOG_FILE = 'pipeline.log';
  const DIST_DIR = 'dist';

  app.use(express.json());

  // Clear log on every server start so refresh = fresh slate
  fs.writeFileSync(LOG_FILE, '');

  // API Routes
  app.get('/api/pipeline-status', (req, res) => {
    if (!fs.existsSync(LOG_FILE)) {
      return res.json({ content: '' });
    }
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    res.json({ content });
  });

  app.post('/api/clear-log', (req, res) => {
    fs.writeFileSync(LOG_FILE, '');
    res.json({ status: 'ok' });
  });

  app.get('/api/clips', (req, res) => {
    if (!fs.existsSync(CLIPS_DIR)) {
      return res.json({ files: [] });
    }
    const files = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.mp4'));
    res.json({ files: files.sort() });
  });

  app.get('/api/feed', (req, res) => {
    if (!fs.existsSync(FEED_FILE)) {
      return res.json({ content: '' });
    }
    const content = fs.readFileSync(FEED_FILE, 'utf-8');
    res.json({ content });
  });

  app.post('/api/feed', (req, res) => {
    fs.writeFileSync(FEED_FILE, req.body.content || '');
    res.json({ status: 'ok' });
  });

  app.get('/api/settings', (req, res) => {
    if (!fs.existsSync(CONFIG_FILE)) {
      return res.json({ GOOGLE_API_KEY: '' });
    }
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    try {
      res.json(JSON.parse(content));
    } catch {
      res.json({ GOOGLE_API_KEY: '' });
    }
  });

  app.post('/api/settings', (req, res) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body));
    res.json({ status: 'ok' });
  });

  app.post('/api/run', (req, res) => {
    // Actually run the python script in the background
    const process = spawn('python3', [
      '-c', 
      `
import asyncio
import clip_factory

async def main():
    with open('feed.txt', 'r') as f:
        feed_text = f.read()
    
    api_key = ''
    try:
        import json
        with open('config.json', 'r') as f:
            config = json.loads(f.read())
            api_key = config.get('GOOGLE_API_KEY', '')
    except: pass
    
    await clip_factory.run_factory(feed_text, api_key)

asyncio.run(main())
      `
    ]);

    process.stdout.on('data', (data) => console.log(data.toString()));
    process.stderr.on('data', (data) => console.error(data.toString()));

    res.json({ status: 'started' });
  });

  app.post('/api/download-zip', (req, res) => {
    const files = req.body.files || [];
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=selected_clips.zip');
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    
    for (const file of files) {
      const filePath = path.join(CLIPS_DIR, file);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file });
      }
    }
    
    archive.finalize();
  });

  app.post('/api/delete-clips', (req, res) => {
    const files = req.body.files || [];
    for (const file of files) {
      const filePath = path.join(CLIPS_DIR, file);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error(`Error deleting ${file}: ${e}`);
        }
      }
    }
    res.json({ status: 'ok' });
  });

  app.get('/api/download-all', (req, res) => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=all_clips.zip');
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    
    if (fs.existsSync(CLIPS_DIR)) {
      const files = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.mp4'));
      for (const file of files) {
        archive.file(path.join(CLIPS_DIR, file), { name: file });
      }
    }
    
    archive.finalize();
  });

  if (!fs.existsSync(CLIPS_DIR)) {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
  }

  app.use('/clips', express.static(CLIPS_DIR, {
      setHeaders: (res, p) => {
          if (p.endsWith('.mp4')) {
              res.setHeader('Content-Type', 'video/mp4');
          }
      }
  }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
