import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Film, Link, Clock, AtSign, Download, Loader2, AlertCircle,
  CheckCircle2, X, Play, Square, ChevronRight, Power, ChevronDown, ChevronUp,
  Zap, Trash2, CheckSquare, MinusSquare, Info, BookOpen, Scissors, CornerRightDown
} from 'lucide-react';

interface Thumbnail { file: string; timestamp: number; label: string; }
interface VideoData {
  index: number; url: string;
  status: 'queued' | 'downloading' | 'extracting' | 'done' | 'error';
  thumbnails: Thumbnail[]; duration?: number; error?: string;
}

const PAGE_SIZE = 4;

function shortUrl(url: string) {
  try { const u = new URL(url); return u.hostname + u.pathname.slice(0, 36) + (u.pathname.length > 36 ? '…' : ''); }
  catch { return url.slice(0, 55) + (url.length > 55 ? '…' : ''); }
}

function readableDuration(secs: number) {
  if (secs < 60) return `${secs} sec`;
  if (secs % 60 === 0) return `${secs / 60} min`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function shortDur(secs: number) {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function parseSeekTime(val: string): number | null {
  val = val.trim().toLowerCase();
  // HH:MM:SS or MM:SS
  const colonMatch = val.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    const [, a, b, c] = colonMatch;
    return c !== undefined ? parseInt(a) * 3600 + parseInt(b) * 60 + parseInt(c) : parseInt(a) * 60 + parseInt(b);
  }
  // 8min / 8m / 8 minutes
  const minMatch = val.match(/^(\d+(?:\.\d+)?)\s*(?:min(?:utes?)?|m)$/);
  if (minMatch) return Math.floor(parseFloat(minMatch[1]) * 60);
  // 90s / 90sec
  const secMatch = val.match(/^(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)$/);
  if (secMatch) return Math.floor(parseFloat(secMatch[1]));
  // plain integer = seconds
  const num = parseInt(val, 10);
  if (!isNaN(num) && String(num) === val) return num;
  return null;
}

function statusBadge(status: VideoData['status']) {
  const map: Record<string, { label: string; cls: string }> = {
    queued:      { label: 'Queued',      cls: 'bg-zinc-700 text-zinc-300' },
    downloading: { label: 'Downloading', cls: 'bg-blue-500/20 text-blue-300 animate-pulse' },
    extracting:  { label: 'Extracting',  cls: 'bg-amber-500/20 text-amber-300 animate-pulse' },
    done:        { label: 'Ready',       cls: 'bg-emerald-500/20 text-emerald-300' },
    error:       { label: 'Error',       cls: 'bg-red-500/20 text-red-300' },
  };
  const s = map[status] || map.queued;
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${s.cls}`}>{s.label}</span>;
}

function ThumbCard({
  thumb, videoIndex, jobId, clipDuration,
  selected, onToggle, playing, onPlay, onStop
}: {
  thumb: Thumbnail; videoIndex: number; jobId: string; clipDuration: number;
  selected: boolean; onToggle: () => void;
  playing: boolean; onPlay: () => void; onStop: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    v.currentTime = thumb.timestamp;
    v.play().catch(() => {});
    const check = () => { if (v.currentTime >= thumb.timestamp + clipDuration) { v.pause(); onStop(); } };
    v.addEventListener('timeupdate', check);
    return () => v.removeEventListener('timeupdate', check);
  }, [playing, thumb.timestamp, clipDuration, onStop]);

  useEffect(() => {
    if (!playing) { const v = videoRef.current; if (v) { v.pause(); v.currentTime = thumb.timestamp; } }
  }, [playing, thumb.timestamp]);

  return (
    <div className={`relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer select-none
      ${playing ? 'border-emerald-500 ring-2 ring-emerald-500/20' : selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-zinc-700 hover:border-zinc-500'}`}
    >
      {/* Duration badge — compact, top-right corner only */}
      <div className={`absolute top-1 right-1 z-10 px-1.5 py-0 rounded text-[9px] font-bold leading-5
        ${playing ? 'bg-emerald-600/90 text-white' : selected ? 'bg-blue-600/80 text-white' : 'bg-black/70 text-zinc-300'}`}>
        {shortDur(clipDuration)}
      </div>

      {playing ? (
        <video ref={videoRef} src={`/api/picker/video/${jobId}/${videoIndex}`}
          className="w-full aspect-video object-cover bg-black" playsInline onEnded={onStop} />
      ) : (
        <img src={`/api/picker/thumb/${jobId}/${videoIndex}/${thumb.file}`}
          alt={`from ${thumb.label}`} className="w-full aspect-video object-cover" loading="lazy" />
      )}

      {/* Click center to play/stop */}
      <div className="absolute inset-0 flex items-center justify-center" onClick={playing ? onStop : onPlay}>
        <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          {playing
            ? <Square className="w-4 h-4 text-white fill-white" />
            : <Play className="w-4 h-4 text-white fill-white ml-0.5" />}
        </div>
      </div>

      {/* Checkbox top-left */}
      <div className="absolute top-6 left-2 z-20" onClick={e => { e.stopPropagation(); onToggle(); }}>
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all cursor-pointer
          ${selected ? 'bg-blue-500 border-blue-400' : 'bg-black/60 border-zinc-500 hover:border-white'}`}>
          {selected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
        </div>
      </div>

      {/* Timestamp bottom */}
      <div className={`absolute bottom-0 inset-x-0 py-0.5 text-center text-[10px] font-mono
        ${selected ? 'bg-blue-600/70 text-white' : 'bg-black/60 text-zinc-400'}`}>
        from {thumb.label}
      </div>
    </div>
  );
}

export default function Studio({ onClipsUpdated }: { onClipsUpdated?: () => void }) {
  const [urls, setUrls] = useState('');
  const [duration, setDuration] = useState('30');
  const [credit, setCredit] = useState('');

  const [showBatch, setShowBatch] = useState(false);
  const [feed, setFeed] = useState('');
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchStatus, setBatchStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [thumbStart, setThumbStart] = useState<Record<number, number>>({});
  const [thumbCount, setThumbCount] = useState<Record<number, number>>({});
  const [thumbSeekVal, setThumbSeekVal] = useState<Record<number, string>>({});
  const [thumbSeekErr, setThumbSeekErr] = useState<Record<number, boolean>>({});
  const [selections, setSelections] = useState<Set<string>>(new Set());
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [pickerStatus, setPickerStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/feed').then(r => r.json()).then(d => { if (d.content) setFeed(d.content); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!jobId || !isLoading) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/picker/job/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setVideos(data.videos || []);
        if (data.status === 'done') { setIsLoading(false); clearInterval(pollRef.current!); }
      } catch {}
    }, 2000);
    return () => clearInterval(pollRef.current!);
  }, [jobId, isLoading]);

  const handleBrowse = async () => {
    const urlList = urls.trim().split('\n').map(u => u.trim()).filter(Boolean);
    if (!urlList.length) return;
    setPickerStatus(null); setIsLoading(true);
    setSelections(new Set()); setThumbStart({}); setThumbCount({}); setThumbSeekVal({}); setThumbSeekErr({});
    setVideos([]); setJobId(null); setPlayingKey(null);
    try {
      const res = await fetch('/api/picker/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList, duration: parseInt(duration) || 30, credit: credit || null })
      });
      const data = await res.json();
      setJobId(data.jobId);
    } catch {
      setIsLoading(false);
      setPickerStatus({ type: 'error', msg: 'Failed to start job.' });
    }
  };

  const handleBatchRun = async () => {
    if (!feed.trim()) return;
    setIsBatchRunning(true); setBatchStatus(null);
    try {
      await fetch('/api/feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: feed }) });
      const res = await fetch('/api/run', { method: 'POST' });
      if (res.ok) { setBatchStatus({ type: 'success', msg: 'Pipeline started — check Logs for progress.' }); onClipsUpdated?.(); }
      else setBatchStatus({ type: 'error', msg: 'Failed to start pipeline.' });
    } catch { setBatchStatus({ type: 'error', msg: 'Error starting pipeline.' }); }
    finally { setIsBatchRunning(false); }
  };

  const selKey = (vi: number, ts: number) => `${vi}:${ts}`;
  const toggleSel = useCallback((vi: number, ts: number) => {
    const k = selKey(vi, ts);
    setSelections(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }, []);
  const handlePlay = useCallback((vi: number, ts: number) => setPlayingKey(selKey(vi, ts)), []);
  const handleStop = useCallback(() => setPlayingKey(null), []);
  const addMore = (vi: number) => setThumbCount(p => ({ ...p, [vi]: (p[vi] || PAGE_SIZE) + PAGE_SIZE }));

  const applySeek = (vi: number, thumbs: Thumbnail[], raw: string) => {
    const secs = parseSeekTime(raw);
    if (secs === null) { setThumbSeekErr(p => ({ ...p, [vi]: true })); return; }
    setThumbSeekErr(p => ({ ...p, [vi]: false }));
    // find first thumb index at or after secs
    const idx = thumbs.findIndex(t => t.timestamp >= secs);
    const startIdx = idx === -1 ? Math.max(0, thumbs.length - 1) : idx;
    setThumbStart(p => ({ ...p, [vi]: startIdx }));
    setThumbCount(p => ({ ...p, [vi]: PAGE_SIZE }));
  };

  // Select / deselect helpers
  const allKeys = videos.flatMap(v => v.thumbnails.map(t => selKey(v.index, t.timestamp)));
  const selectAll = () => setSelections(new Set(allKeys));
  const deselectAll = () => setSelections(new Set());
  const selectSegment = (video: VideoData, start: number, count: number) => {
    const keys = video.thumbnails.slice(start, start + count).map(t => selKey(video.index, t.timestamp));
    setSelections(prev => { const n = new Set(prev); keys.forEach(k => n.add(k)); return n; });
  };
  const clearSegment = (video: VideoData) => {
    const keys = new Set(video.thumbnails.map(t => selKey(video.index, t.timestamp)));
    setSelections(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
  };

  const downloadZip = async () => {
    if (!jobId || selections.size === 0) return;
    setIsExtracting(true); setPickerStatus(null);
    try {
      const sels = Array.from(selections).map(k => { const [vi, ts] = k.split(':').map(Number); return { videoIndex: vi, timestamp: ts }; });
      const res = await fetch('/api/picker/extract-zip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, selections: sels, duration: parseInt(duration) || 30, credit: credit || null })
      });
      if (!res.ok) throw new Error('Extraction failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'clips.zip'; a.click();
      URL.revokeObjectURL(url);
      setPickerStatus({ type: 'success', msg: `${sels.length} clip(s) downloaded! Temp files will auto-delete from server.` });
      setSelections(new Set());
      onClipsUpdated?.();
    } catch (e: any) {
      setPickerStatus({ type: 'error', msg: e.message || 'Download failed.' });
    } finally { setIsExtracting(false); }
  };

  const clipDur = parseInt(duration) || 30;
  const segmentSelected = (video: VideoData) => video.thumbnails.filter(t => selections.has(selKey(video.index, t.timestamp))).length;

  return (
    <div className="space-y-6">

      {/* ── Input Panel ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Link className="w-4 h-4 text-zinc-500" /> Video URLs
            <span className="text-zinc-600 font-normal text-xs">(one per line — YouTube, Vimeo, archive.org, anything yt-dlp supports)</span>
          </label>
          <textarea
            value={urls}
            onChange={e => setUrls(e.target.value)}
            placeholder={"https://www.youtube.com/watch?v=...\nhttps://archive.org/details/...\nhttps://vimeo.com/..."}
            rows={4}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none resize-none text-zinc-200 placeholder:text-zinc-600"
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5" /> Clip Duration
            </label>
            <select value={duration} onChange={e => setDuration(e.target.value)}
              className="w-32 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-200">
              <option value="8">8 sec</option>
              <option value="15">15 sec</option>
              <option value="30">30 sec</option>
              <option value="45">45 sec</option>
              <option value="60">1 min</option>
              <option value="90">1 min 30s</option>
              <option value="120">2 min</option>
              <option value="180">3 min</option>
              <option value="300">5 min</option>
              <option value="600">10 min</option>
            </select>
          </div>

          <div className="space-y-1.5 flex-1 min-w-44">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              <AtSign className="w-3.5 h-3.5" /> Credit Watermark <span className="normal-case font-normal">(optional)</span>
            </label>
            <input type="text" value={credit} onChange={e => setCredit(e.target.value)}
              placeholder="@yourchannel"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-200 placeholder:text-zinc-600" />
          </div>

          <button onClick={handleBrowse} disabled={isLoading || !urls.trim()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-6 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/20 active:scale-95">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
            {isLoading ? 'Loading…' : 'Browse & Pick'}
          </button>
        </div>

        {pickerStatus && (
          <div className={`flex items-center gap-2 text-sm ${pickerStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
            {pickerStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {pickerStatus.msg}
          </div>
        )}

        {/* ── Batch Mode Expander ── */}
        <div className="border-t border-zinc-800 pt-4">
          <button onClick={() => setShowBatch(b => !b)}
            className="flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5" />
            Batch Run Mode — save clips directly to server
            {showBatch ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <AnimatePresence>
            {showBatch && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="pt-5 space-y-5">

                  {/* What is this */}
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3">
                    <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-blue-200 space-y-1">
                      <p className="font-semibold text-blue-300">What does Batch Run do?</p>
                      <p>Paste one line per clip. Hit Run. All clips are extracted in order and saved to the <strong>Saved Clips</strong> section below — no manual picking needed. Great for when you already know the exact timestamps you want.</p>
                    </div>
                  </div>

                  {/* Format reference */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" /> Line Format
                    </p>
                    <div className="bg-black rounded-xl p-4 font-mono text-xs space-y-2 border border-zinc-800">
                      <p className="text-zinc-500">URL <span className="text-zinc-700">|</span> duration <span className="text-zinc-700">|</span> start_time <span className="text-zinc-700">|</span> @credit</p>
                      <div className="border-t border-zinc-900 pt-2 space-y-1.5">
                        <p className="text-zinc-600"># ── ONE CLIP at a specific moment ──</p>
                        <p>https://archive.org/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">30sec</span> <span className="text-zinc-600">|</span> <span className="text-blue-400">2:30</span> <span className="text-zinc-600">|</span> <span className="text-amber-400">@BBC</span></p>

                        <p className="text-zinc-600 pt-1"># ── CHUNK from a timestamp to the end (add + after time) ──</p>
                        <p>https://youtube.com/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">30sec</span> <span className="text-zinc-600">|</span> <span className="text-blue-400">3:30+</span></p>

                        <p className="text-zinc-600 pt-1"># ── CHUNK entire video from the start ──</p>
                        <p>https://archive.org/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">2min</span> <span className="text-zinc-600">|</span> <span className="text-amber-400">@CNN</span></p>

                        <p className="text-zinc-600 pt-1"># ── Multiple clips, same video ──</p>
                        <p>https://archive.org/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">15sec</span> <span className="text-zinc-600">|</span> <span className="text-blue-400">0:45</span></p>
                        <p>https://archive.org/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">15sec</span> <span className="text-zinc-600">|</span> <span className="text-blue-400">1:20</span></p>
                        <p>https://archive.org/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">15sec</span> <span className="text-zinc-600">|</span> <span className="text-blue-400">4:05</span></p>
                      </div>
                    </div>
                  </div>

                  {/* Options reference */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                      <p className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">Duration</p>
                      <div className="text-[11px] font-mono text-zinc-400 space-y-0.5">
                        <p><span className="text-emerald-400">8sec</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">15sec</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">30sec</span></p>
                        <p><span className="text-emerald-400">1min</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">2min</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">5min</span></p>
                        <p><span className="text-emerald-400">1min30sec</span> <span className="text-zinc-600">· plain</span> <span className="text-emerald-400">90</span></p>
                      </div>
                    </div>
                    <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                      <p className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">Start Time</p>
                      <div className="text-[11px] font-mono text-zinc-400 space-y-0.5">
                        <p><span className="text-blue-400">1:30</span> <span className="text-zinc-600">= MM:SS</span></p>
                        <p><span className="text-blue-400">0:04:22</span> <span className="text-zinc-600">= HH:MM:SS</span></p>
                        <p><span className="text-blue-400">90</span> <span className="text-zinc-600">= plain seconds</span></p>
                        <p><span className="text-blue-400">3:30<span className="text-amber-300">+</span></span> <span className="text-zinc-600">= chunk from 3:30 to end</span></p>
                        <p className="text-zinc-600">omit = chunk whole video</p>
                      </div>
                    </div>
                    <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                      <p className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">@Credit</p>
                      <div className="text-[11px] text-zinc-400 space-y-0.5">
                        <p>Burned into bottom-left corner of every clip.</p>
                        <p>Works in <span className="text-zinc-300">any field position</span> — just add it anywhere in the line.</p>
                        <p className="font-mono"><span className="text-amber-400">@BBC</span> <span className="text-zinc-600">·</span> <span className="text-amber-400">@CNN</span> <span className="text-zinc-600">·</span> <span className="text-amber-400">@mychannel</span></p>
                      </div>
                    </div>
                  </div>

                  {/* Tips */}
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex gap-3">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-200 space-y-1">
                      <p><strong>YouTube on cloud servers:</strong> YouTube often blocks automated downloads from cloud/VPS IPs. Use <span className="text-white">Internet Archive (archive.org)</span>, Vimeo, or other sources for reliable results. For YouTube, run the app locally on your computer.</p>
                      <p><strong>After download:</strong> The clips are saved in Saved Clips below. Temp files auto-delete from server after 24 hours.</p>
                    </div>
                  </div>

                  <textarea value={feed} onChange={e => setFeed(e.target.value)}
                    placeholder={"https://archive.org/... | 30sec | 2:30 | @BBC\nhttps://archive.org/... | 1min | 5:00+\nhttps://archive.org/... | 15sec | 0:45"}
                    rows={7}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none resize-none text-zinc-200 placeholder:text-zinc-600" />

                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={handleBatchRun} disabled={isBatchRunning || !feed.trim()}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-emerald-500/20 active:scale-95 text-sm">
                      {isBatchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                      {isBatchRunning ? 'Running…' : 'Run Pipeline'}
                    </button>
                    <button onClick={() => { setFeed(''); setBatchStatus(null); }}
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-zinc-800">
                      <Trash2 className="w-3.5 h-3.5" /> Clear
                    </button>
                    {batchStatus && (
                      <span className={`text-sm flex items-center gap-1.5 ${batchStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {batchStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        {batchStatus.msg}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Thumbnail Grid ── */}
      <AnimatePresence>
        {videos.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">

            {/* Global controls */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="text-lg font-bold text-white tracking-tight">Browse & Select Clips</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-600">Click thumbnail = preview &nbsp;·&nbsp; Click checkbox = select</span>
                <div className="h-4 border-l border-zinc-700" />
                <button onClick={selectAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all">
                  <CheckSquare className="w-3.5 h-3.5" /> Select All
                </button>
                <button onClick={deselectAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all">
                  <MinusSquare className="w-3.5 h-3.5" /> Deselect All
                </button>
              </div>
            </div>

            {videos.map(video => {
              const start = thumbStart[video.index] || 0;
              const count = thumbCount[video.index] || PAGE_SIZE;
              const visible = video.thumbnails.slice(start, start + count);
              const hasMore = start + count < video.thumbnails.length;
              const segSel = segmentSelected(video);
              const seekVal = thumbSeekVal[video.index] || '';
              const seekErr = thumbSeekErr[video.index] || false;

              return (
                <motion.div key={video.index} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

                  {/* Video header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 flex-wrap">
                    <Film className="w-4 h-4 text-zinc-500 shrink-0" />
                    <span className="text-sm text-zinc-300 font-mono truncate flex-1 min-w-0" title={video.url}>{shortUrl(video.url)}</span>
                    {statusBadge(video.status)}
                    {video.duration && (
                      <span className="text-xs text-zinc-600 shrink-0">
                        {Math.floor(video.duration / 60)}:{String(Math.round(video.duration % 60)).padStart(2, '0')} total
                      </span>
                    )}

                    {/* Seek-to-time input */}
                    <div className="flex items-center gap-1 shrink-0" title="Jump to a specific time in the video">
                      <div className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors
                        ${seekErr ? 'border-red-500/60 bg-red-500/10' : 'border-zinc-700 bg-zinc-800 focus-within:border-blue-500/60'}`}>
                        <CornerRightDown className="w-3 h-3 text-zinc-500 shrink-0" />
                        <input
                          type="text"
                          value={seekVal}
                          onChange={e => { setThumbSeekVal(p => ({ ...p, [video.index]: e.target.value })); setThumbSeekErr(p => ({ ...p, [video.index]: false })); }}
                          onKeyDown={e => { if (e.key === 'Enter') applySeek(video.index, video.thumbnails, seekVal); }}
                          onBlur={() => { if (seekVal.trim()) applySeek(video.index, video.thumbnails, seekVal); }}
                          placeholder="jump to… 8:00"
                          className="w-24 bg-transparent text-[11px] font-mono text-zinc-300 placeholder:text-zinc-600 outline-none"
                        />
                        {seekVal.trim() && (
                          <button onClick={() => {
                            setThumbSeekVal(p => ({ ...p, [video.index]: '' }));
                            setThumbSeekErr(p => ({ ...p, [video.index]: false }));
                            setThumbStart(p => ({ ...p, [video.index]: 0 }));
                            setThumbCount(p => ({ ...p, [video.index]: PAGE_SIZE }));
                          }} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Per-segment controls */}
                    <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-zinc-800">
                      <button onClick={() => selectSegment(video, start, count)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-zinc-800 hover:bg-blue-600/30 text-zinc-400 hover:text-blue-300 transition-all"
                        title="Select all visible thumbnails in this video">
                        <CheckSquare className="w-3 h-3" /> Select {visible.length}
                      </button>
                      <button onClick={() => clearSegment(video)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all
                          ${segSel > 0 ? 'bg-red-600/20 hover:bg-red-600/30 text-red-400 hover:text-red-300' : 'bg-zinc-800 text-zinc-600 cursor-default'}`}
                        disabled={segSel === 0}
                        title="Clear all selections in this video">
                        <Trash2 className="w-3 h-3" /> Clear {segSel > 0 ? `(${segSel})` : ''}
                      </button>
                    </div>
                  </div>

                  {video.status === 'error' && (
                    <div className="p-5 flex items-center gap-3 text-sm text-red-400">
                      <AlertCircle className="w-4 h-4 shrink-0" />{video.error || 'Download failed.'}
                    </div>
                  )}
                  {(video.status === 'downloading' || (video.status === 'extracting' && video.thumbnails.length === 0)) && (
                    <div className="p-8 flex flex-col items-center gap-3 text-zinc-500">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-sm">{video.status === 'downloading' ? 'Downloading video…' : 'Extracting thumbnails…'}</span>
                    </div>
                  )}

                  {video.thumbnails.length > 0 && jobId && (
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-4 gap-3">
                        {visible.map(thumb => {
                          const k = `${video.index}:${thumb.timestamp}`;
                          return (
                            <ThumbCard key={k} thumb={thumb} videoIndex={video.index} jobId={jobId}
                              clipDuration={clipDur}
                              selected={selections.has(k)}
                              onToggle={() => toggleSel(video.index, thumb.timestamp)}
                              playing={playingKey === k}
                              onPlay={() => handlePlay(video.index, thumb.timestamp)}
                              onStop={handleStop}
                            />
                          );
                        })}
                        {Array.from({ length: Math.max(0, PAGE_SIZE - visible.length) }).map((_, i) => (
                          <div key={`e-${i}`} className="rounded-xl border-2 border-zinc-800 border-dashed aspect-video bg-zinc-950/50" />
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-600">
                          {start > 0 && <span className="text-blue-400/70 mr-1.5">↳ from {video.thumbnails[start]?.label}</span>}
                          Showing {start + 1}–{start + visible.length} of {video.thumbnails.length}
                          {video.status !== 'done' && ' — still extracting…'}
                        </span>
                        {hasMore && (
                          <button onClick={() => addMore(video.index)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all">
                            <ChevronRight className="w-3.5 h-3.5" /> Show 4 more
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Download Bar ── */}
      <AnimatePresence>
        {selections.size > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="sticky bottom-4 z-20">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl px-6 py-4 shadow-2xl flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-blue-500/20">{selections.size}</div>
                <div>
                  <p className="text-sm font-semibold text-white">{selections.size} clip{selections.size !== 1 ? 's' : ''} selected</p>
                  <p className="text-xs text-zinc-500">
                    {readableDuration(clipDur)} each{credit ? ` · @${credit.replace(/^@/, '')}` : ''} · no audio · ZIP download
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={deselectAll} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all font-medium">
                  <X className="w-3.5 h-3.5" /> Clear all
                </button>
                <button onClick={downloadZip} disabled={isExtracting}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-emerald-500/20 active:scale-95">
                  {isExtracting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Cutting clips…</>
                    : <><Scissors className="w-4 h-4" /> Cut &amp; Download ZIP</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
