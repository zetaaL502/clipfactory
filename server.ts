import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Auto-cleanup: delete files/dirs older than maxAgeMs ──────────────
function cleanupOldEntries(dir: string, maxAgeMs: number) {
  if (!fs.existsSync(dir)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true });
        console.log(`[cleanup] deleted old entry: ${full}`);
      }
    } catch {}
  }
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '5000');
  const CLIPS_DIR = 'clips';
  const CONFIG_FILE = 'config.json';
  const FEED_FILE = 'feed.txt';
  const LOG_FILE = 'pipeline.log';
  const DIST_DIR = 'dist';
  const PICKER_DIR = 'picker_jobs';
  const THUMBNAILS_DIR = 'thumbnails';
  const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

  app.use(express.json());

  // Clear log on every server start so refresh = fresh slate
  fs.writeFileSync(LOG_FILE, '');

  // Run cleanup now and then every hour
  setTimeout(() => {
    cleanupOldEntries(PICKER_DIR, MAX_AGE_MS);
    cleanupOldEntries(CLIPS_DIR, MAX_AGE_MS);
  }, 5000);
  setInterval(() => {
    cleanupOldEntries(PICKER_DIR, MAX_AGE_MS);
    cleanupOldEntries(CLIPS_DIR, MAX_AGE_MS);
  }, 60 * 60 * 1000);

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

  // Generate a thumbnail from any clip on demand, cache as .jpg alongside the .mp4
  app.get('/api/thumbnail/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    if (!filename.endsWith('.mp4')) return res.status(400).send('bad file');
    const videoPath = path.join(CLIPS_DIR, filename);
    if (!fs.existsSync(videoPath)) return res.status(404).send('not found');

    const thumbPath = path.join(CLIPS_DIR, filename.replace('.mp4', '.jpg'));
    const sendThumb = () => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.sendFile(path.resolve(thumbPath));
    };

    if (fs.existsSync(thumbPath)) return sendThumb();

    // Extract frame at 1 s — seek AFTER -i for accuracy, use -update 1 for single image
    const ff = spawn('ffmpeg', [
      '-i', videoPath,
      '-ss', '1',
      '-vframes', '1', '-q:v', '3',
      '-vf', 'scale=640:-1',
      '-update', '1',
      thumbPath,
    ]);
    ff.on('close', (code: number) => {
      if (code === 0 && fs.existsSync(thumbPath)) return sendThumb();
      res.status(500).send('thumb failed');
    });
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

  const COOKIES_FILE = 'cookies.txt';
  const cookieAuthMatcher = /(^|\s)(SAPISID|APISID|SID|HSID|SSID|__Secure-3PSID|__Secure-3PAPISID|__Secure-1PSIDTS|__Secure-3PSIDTS)(\s|$)/i;
  const cookieFileValid = (content: string) => {
    return cookieAuthMatcher.test(content) || /\.google\.com/i.test(content) || /accounts\.google\.com/i.test(content);
  };

  app.get('/api/cookies', (req, res) => {
    if (!fs.existsSync(COOKIES_FILE)) {
      return res.json({ exists: false, content: '', valid: false });
    }
    const content = fs.readFileSync(COOKIES_FILE, 'utf-8');
    res.json({ exists: true, content, valid: cookieFileValid(content) });
  });

  app.post('/api/cookies', (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) {
      if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
      return res.json({ status: 'cleared', valid: false });
    }
    const trimmed = content.trim() + '\n';
    fs.writeFileSync(COOKIES_FILE, trimmed, 'utf-8');
    res.json({ status: 'saved', valid: cookieFileValid(trimmed) });
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
    const process = spawn('python3', [
      '-c',
      `
import asyncio
import clip_factory

async def main():
    with open('feed.txt', 'r') as f:
        feed_text = f.read()
    await clip_factory.run_factory(feed_text)

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
    archive.on('error', (err) => { console.error('[zip] archive error:', err); if (!res.headersSent) res.status(500).end(); });
    archive.pipe(res);
    for (const file of files) {
      const filePath = path.join(CLIPS_DIR, path.basename(file));
      if (fs.existsSync(filePath)) archive.file(filePath, { name: path.basename(file) });
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
    archive.on('error', (err) => { console.error('[zip] archive error:', err); if (!res.headersSent) res.status(500).end(); });
    archive.pipe(res);
    if (fs.existsSync(CLIPS_DIR)) {
      const files = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.mp4'));
      for (const file of files) archive.file(path.join(CLIPS_DIR, file), { name: file });
    }
    archive.finalize();
  });

  if (!fs.existsSync(CLIPS_DIR)) {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PICKER_DIR)) {
    fs.mkdirSync(PICKER_DIR, { recursive: true });
  }
  if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  }

  app.use('/thumbnails', express.static(path.resolve(THUMBNAILS_DIR)));

  // ── Picker Routes ─────────────────────────────────────────────────
  app.post('/api/picker/start', (req, res) => {
    const { urls, urlCredits, duration, credit } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'No URLs provided' });
    }
    const jobId = randomUUID();
    const jobDir = path.join(PICKER_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'urls.json'), JSON.stringify({ urls, urlCredits: urlCredits || [], duration, credit }));

    const proc = spawn('python3', ['picker.py', jobDir]);
    proc.stdout.on('data', d => console.log('[picker]', d.toString()));
    proc.stderr.on('data', d => console.error('[picker]', d.toString()));

    res.json({ jobId });
  });

  app.get('/api/picker/job/:jobId', (req, res) => {
    const jobDir = path.join(PICKER_DIR, path.basename(req.params.jobId));
    const statusPath = path.join(jobDir, 'status.json');
    if (!fs.existsSync(statusPath)) return res.status(404).json({ error: 'Job not found' });

    const jobStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    const videos = [];

    for (let i = 0; i < jobStatus.total; i++) {
      const videoDir = path.join(jobDir, String(i));
      const videoStatusPath = path.join(videoDir, 'status.json');
      if (!fs.existsSync(videoStatusPath)) {
        videos.push({ index: i, status: 'queued', thumbnails: [] });
        continue;
      }
      const videoStatus = JSON.parse(fs.readFileSync(videoStatusPath, 'utf-8'));

      // Use thumbnails array from status.json when available (accurate timestamps).
      // Fall back to directory scan during active extraction (thumbnails written incrementally).
      const thumbDir = path.join(videoDir, 'thumbs');
      let thumbnails: { file: string; timestamp: number; label: string }[] = [];
      if (videoStatus.thumbnails && videoStatus.thumbnails.length > 0) {
        thumbnails = videoStatus.thumbnails;
      } else if (fs.existsSync(thumbDir)) {
        const files = fs.readdirSync(thumbDir).filter(f => f.endsWith('.jpg')).sort();
        const startOffset: number = videoStatus.thumbStartOffset ?? 30;
        const interval: number = videoStatus.thumbInterval ?? 30;
        thumbnails = files.map((f, idx) => {
          const ts = startOffset + idx * interval;
          const m = Math.floor(ts / 60), s = ts % 60;
          return { file: f, timestamp: ts, label: `${m}:${s.toString().padStart(2, '0')}` };
        });
      }

      videos.push({ ...videoStatus, index: i, thumbnails });
    }

    res.json({ ...jobStatus, videos });
  });

  // Serve the downloaded preview video for inline playback
  app.get('/api/picker/video/:jobId/:videoIndex', (req, res) => {
    const { jobId, videoIndex } = req.params;
    const videoPath = path.join(
      PICKER_DIR,
      path.basename(jobId),
      path.basename(videoIndex),
      'video.mp4'
    );
    if (!fs.existsSync(videoPath)) return res.status(404).send('not found');
    const stat = fs.statSync(videoPath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(videoPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
      fs.createReadStream(videoPath).pipe(res);
    }
  });

  app.get('/api/picker/thumb/:jobId/:videoIndex/:filename', (req, res) => {
    const { jobId, videoIndex, filename } = req.params;
    const thumbPath = path.join(
      PICKER_DIR,
      path.basename(jobId),
      path.basename(videoIndex),
      'thumbs',
      path.basename(filename)
    );
    if (!fs.existsSync(thumbPath)) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.resolve(thumbPath));
  });

  // Progress store: progressId -> state
  const extractJobs = new Map<string, { current: number; total: number; done: boolean; error?: string; zipPath?: string }>();

  app.post('/api/picker/extract-zip', (req, res) => {
    const { jobId, selections, duration, credit, creditSize } = req.body;
    if (!jobId || !Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const progressId = randomUUID();
    extractJobs.set(progressId, { current: 0, total: selections.length, done: false });
    res.json({ progressId });

    // Run extraction in background
    (async () => {
      try {
        const jobDir = path.join(PICKER_DIR, path.basename(jobId));
        const clipsDir = path.join(jobDir, 'clips');
        fs.mkdirSync(clipsDir, { recursive: true });
        const extractedPaths: { filePath: string; name: string }[] = [];
        const padLen = String(selections.length).length;

        for (let i = 0; i < selections.length; i++) {
          extractJobs.set(progressId, { current: i, total: selections.length, done: false });
          const sel = selections[i];
          const clipDuration = (sel.duration && sel.duration > 0) ? sel.duration : (duration || 10);
          const seqNum = String(i + 1).padStart(padLen, '0');
          const clipName = `clip_${seqNum}_v${sel.videoIndex}_t${sel.timestamp}.mp4`;
          const clipPath = path.join(clipsDir, clipName);
          const localVideo = path.join(jobDir, String(sel.videoIndex), 'video.mp4');

          // Always use Python script for clip extraction (handles FFmpeg path correctly)
          let sourceArg = localVideo;
          if (!fs.existsSync(localVideo)) {
            const videoStatusPath = path.join(jobDir, String(sel.videoIndex), 'status.json');
            if (!fs.existsSync(videoStatusPath)) continue;
            let videoStatus: Record<string, unknown>;
            try { videoStatus = JSON.parse(fs.readFileSync(videoStatusPath, 'utf-8')); } catch { continue; }
            const url = videoStatus.url as string | undefined;
            if (!url) continue;
            sourceArg = url;
          }

          await new Promise<void>(resolve => {
            const python = process.platform === 'win32' ? 'python' : 'python3';
            const creditArg = (credit as string) || '';
            const fontSizeArg = String(creditSize || 11);
            const proc = spawn(python, ['picker_extract.py', sourceArg, String(sel.timestamp), String(clipDuration), clipPath, creditArg, fontSizeArg]);
            proc.stdout.on('data', (d: Buffer) => console.log('[extract]', d.toString()));
              proc.stderr.on('data', (d: Buffer) => console.error('[extract]', d.toString()));
              proc.on('close', () => resolve());
              proc.on('error', () => resolve());
            });

          if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 100) extractedPaths.push({ filePath: clipPath, name: clipName });
        }

        if (extractedPaths.length === 0) {
          extractJobs.set(progressId, { current: selections.length, total: selections.length, done: true, error: 'No clips were extracted. Make sure thumbnails finished loading.' });
          return;
        }

        // Copy extracted clips to main CLIPS_DIR
        if (!fs.existsSync(CLIPS_DIR)) {
          fs.mkdirSync(CLIPS_DIR, { recursive: true });
        }
        for (const c of extractedPaths) {
          const destPath = path.join(CLIPS_DIR, c.name);
          try {
            fs.copyFileSync(c.filePath, destPath);
            console.log(`[extract] Saved clip to library: ${c.name}`);
          } catch (e) {
            console.error(`[extract] Failed to save clip ${c.name}: ${e}`);
          }
        }

        // Write ZIP to a temp file
        const zipPath = path.join(jobDir, 'clips.zip');
        await new Promise<void>((resolve, reject) => {
          const out = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 6 } });
          archive.on('error', reject);
          out.on('close', resolve);
          archive.pipe(out);
          for (const c of extractedPaths) archive.file(c.filePath, { name: c.name });
          archive.finalize();
        });
        extractJobs.set(progressId, { current: selections.length, total: selections.length, done: true, zipPath });
      } catch (err) {
        console.error('[extract-zip] error:', err);
        extractJobs.set(progressId, { current: 0, total: selections.length, done: true, error: 'Extraction failed.' });
      }
    })();
  });

  app.get('/api/picker/extract-progress/:id', (req, res) => {
    const job = extractJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
  });

  app.get('/api/picker/extract-download/:id', (req, res) => {
    const job = extractJobs.get(req.params.id);
    if (!job || !job.done || !job.zipPath || !fs.existsSync(job.zipPath)) return res.status(404).json({ error: 'Not ready' });
    const zipPath = job.zipPath;
    extractJobs.delete(req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=picker_clips.zip');
    const stream = fs.createReadStream(zipPath);
    stream.pipe(res);
    stream.on('close', () => { try { fs.rmSync(path.dirname(zipPath), { recursive: true, force: true }); } catch {} });
  });
  // ── End Picker Routes ──────────────────────────────────────────────

  // Serve raw picker job video for preview
  app.get('/picker-video/:jobId/:videoIndex', (req, res) => {
    const jobId = path.basename(req.params.jobId);
    const videoIndex = path.basename(req.params.videoIndex);
    const videoPath = path.join(PICKER_DIR, jobId, videoIndex, 'video.mp4');
    if (!fs.existsSync(videoPath)) return res.status(404).send('not found');
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(videoPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
      fs.createReadStream(videoPath).pipe(res);
    }
  });

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
      server: {
        middlewareMode: true,
        hmr: process.env.REPLIT_DEV_DOMAIN ? {
          host: process.env.REPLIT_DEV_DOMAIN,
          clientPort: 443,
          protocol: 'wss',
        } : true,
      },
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

process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err);
});

startServer().catch(err => {
  console.error('[server] startup failed:', err);
  process.exit(1);
});
