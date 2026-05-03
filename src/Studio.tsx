import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Film, Link, Clock, AtSign, Download, Loader2, AlertCircle,
  CheckCircle2, X, Play, Square, ChevronRight, ChevronLeft, Power, ChevronDown, ChevronUp,
  Zap, Trash2, CheckSquare, MinusSquare, Info, BookOpen, Scissors, CornerRightDown
} from 'lucide-react';

interface Thumbnail { file: string; timestamp: number; label: string; }
interface VideoData {
  index: number; url: string; credit?: string | null;
  status: 'queued' | 'downloading' | 'extracting' | 'done' | 'error';
  thumbnails: Thumbnail[]; duration?: number; error?: string;
}

function cleanUrl(raw: string): string {
  return raw.split('|')[0].trim();
}

function parseUrlLine(line: string): { url: string; credit: string | null } {
  const m = line.trim().match(/^(.+?)\s+(@\S+)\s*$/);
  if (m) return { url: cleanUrl(m[1]), credit: m[2] };
  return { url: cleanUrl(line), credit: null };
}

function parseDurationSecs(val: string): number {
  val = val.trim().toLowerCase();
  const colonMatch = val.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    const [, a, b, c] = colonMatch;
    return c !== undefined ? parseInt(a) * 3600 + parseInt(b) * 60 + parseInt(c) : parseInt(a) * 60 + parseInt(b);
  }
  const combMatch = val.match(/^(?:(\d+)\s*m(?:in)?)?(?:\s*(\d+)\s*s(?:ec)?)?$/);
  if (combMatch && (combMatch[1] || combMatch[2])) {
    return (parseInt(combMatch[1] || '0') * 60) + parseInt(combMatch[2] || '0');
  }
  const minMatch = val.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?$/);
  if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);
  const secMatch = val.match(/^(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/);
  if (secMatch) return Math.round(parseFloat(secMatch[1]));
  const n = parseInt(val, 10);
  return isNaN(n) || n < 1 ? 30 : n;
}

const PAGE_SIZE = 4;

function shortUrl(url: string | undefined) {
  if (!url) return '—';
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
  const colonMatch = val.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    const [, a, b, c] = colonMatch;
    return c !== undefined ? parseInt(a) * 3600 + parseInt(b) * 60 + parseInt(c) : parseInt(a) * 60 + parseInt(b);
  }
  const minMatch = val.match(/^(\d+(?:\.\d+)?)\s*(?:min(?:utes?)?|m)$/);
  if (minMatch) return Math.floor(parseFloat(minMatch[1]) * 60);
  const secMatch = val.match(/^(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)$/);
  if (secMatch) return Math.floor(parseFloat(secMatch[1]));
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
  thumb, videoIndex, jobId, clipDurationSecs,
  selectionIndex, onSelect,
  durationVal, onDurationChange,
  playing, onPlay, onStop,
}: {
  key?: React.Key | null;
  thumb: Thumbnail; videoIndex: number; jobId: string; clipDurationSecs: number;
  selectionIndex: number | null;
  onSelect: () => void;
  durationVal: string;
  onDurationChange: (v: string) => void;
  playing: boolean; onPlay: () => void; onStop: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSelected = selectionIndex !== null;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    v.currentTime = thumb.timestamp;
    v.play().catch(() => {});
    const check = () => { if (v.currentTime >= thumb.timestamp + clipDurationSecs) { v.pause(); onStop(); } };
    v.addEventListener('timeupdate', check);
    return () => v.removeEventListener('timeupdate', check);
  }, [playing, thumb.timestamp, clipDurationSecs, onStop]);

  useEffect(() => {
    if (!playing) { const v = videoRef.current; if (v) { v.pause(); v.currentTime = thumb.timestamp; } }
  }, [playing, thumb.timestamp]);

  return (
    <div className={`relative rounded-xl overflow-hidden border-2 transition-all select-none flex flex-col
      ${playing
        ? 'border-emerald-500 ring-2 ring-emerald-500/20'
        : isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/30'
          : 'border-zinc-700 hover:border-zinc-500'}`}
    >
      {/* Selection order badge — top-left */}
      {isSelected && (
        <div className="absolute top-1.5 left-1.5 z-20 w-5 h-5 rounded-full bg-blue-600 border border-blue-400 flex items-center justify-center text-[9px] font-bold text-white shadow">
          {selectionIndex + 1}
        </div>
      )}

      {/* Thumbnail / video */}
      <div className="relative">
        {playing ? (
          <video ref={videoRef} src={`/api/picker/video/${jobId}/${videoIndex}`}
            className="w-full aspect-video object-cover bg-black" playsInline onEnded={onStop} />
        ) : (
          <img src={`/api/picker/thumb/${jobId}/${videoIndex}/${thumb.file}`}
            alt={`from ${thumb.label}`} className="w-full aspect-video object-cover" loading="lazy" />
        )}

        {/* Play/stop overlay */}
        <div className="absolute inset-0 flex items-center justify-center" onClick={playing ? onStop : onPlay}>
          <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            {playing
              ? <Square className="w-4 h-4 text-white fill-white" />
              : <Play className="w-4 h-4 text-white fill-white ml-0.5" />}
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className={`flex items-center gap-1 px-2 py-1.5 ${isSelected ? 'bg-blue-900/40' : 'bg-zinc-900'}`}>
        {/* Timestamp */}
        <span className="text-[10px] font-mono text-zinc-500 shrink-0">{thumb.label}</span>

        {/* Per-clip duration input */}
        <input
          type="text"
          value={durationVal}
          onChange={e => onDurationChange(e.target.value)}
          onClick={e => e.stopPropagation()}
          list="duration-suggestions"
          placeholder={shortDur(clipDurationSecs)}
          title="Clip duration (overrides global)"
          className={`w-0 flex-1 min-w-0 bg-transparent border-b text-[10px] font-mono text-center outline-none transition-colors placeholder:text-zinc-600
            ${isSelected
              ? 'border-blue-500/60 text-blue-200 placeholder:text-blue-400/50'
              : 'border-zinc-700 text-zinc-300 focus:border-zinc-500'}`}
        />

        {/* SELECT / DESELECT button */}
        <button
          onClick={e => { e.stopPropagation(); onSelect(); }}
          className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded transition-all active:scale-95
            ${isSelected
              ? 'bg-blue-600 hover:bg-red-600/80 text-white'
              : 'bg-zinc-700 hover:bg-blue-600 text-zinc-300 hover:text-white'}`}
          title={isSelected ? 'Deselect' : 'Add to download queue'}
        >
          {isSelected ? '✓ SEL' : 'SELECT'}
        </button>
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
  const [thumbSeekVal, setThumbSeekVal] = useState<Record<number, string>>({});
  const [thumbSeekErr, setThumbSeekErr] = useState<Record<number, boolean>>({});

  // Ordered selection: array of keys in the order the user clicked SELECT
  const [selectionOrder, setSelectionOrder] = useState<string[]>([]);
  // Per-thumbnail duration overrides: key -> raw string (empty = use global)
  const [thumbDurations, setThumbDurations] = useState<Record<string, string>>({});

  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [pickerStatus, setPickerStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived set for O(1) lookup
  const selectedSet = new Set(selectionOrder);

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
    const rawLines = urls.trim().split('\n').map(u => u.trim()).filter(Boolean);
    if (!rawLines.length) return;
    const parsed = rawLines.map(parseUrlLine);
    const urlList = parsed.map(p => p.url);
    const urlCredits = parsed.map(p => p.credit);
    setPickerStatus(null); setIsLoading(true);
    setSelectionOrder([]); setThumbDurations({});
    setThumbStart({}); setThumbSeekVal({}); setThumbSeekErr({});
    setVideos([]); setJobId(null); setPlayingKey(null);
    try {
      const res = await fetch('/api/picker/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList, urlCredits, duration: parseDurationSecs(duration), credit: credit || null })
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
    setSelectionOrder(prev => {
      if (prev.includes(k)) return prev.filter(x => x !== k);
      return [...prev, k];
    });
  }, []);

  const handlePlay = useCallback((vi: number, ts: number) => setPlayingKey(selKey(vi, ts)), []);
  const handleStop = useCallback(() => setPlayingKey(null), []);

  const applySeek = (vi: number, thumbs: Thumbnail[], raw: string) => {
    const secs = parseSeekTime(raw);
    if (secs === null) { setThumbSeekErr(p => ({ ...p, [vi]: true })); return; }
    setThumbSeekErr(p => ({ ...p, [vi]: false }));
    const idx = thumbs.findIndex(t => t.timestamp >= secs);
    const startIdx = idx === -1 ? Math.max(0, thumbs.length - 1) : idx;
    setThumbStart(p => ({ ...p, [vi]: startIdx }));
  };

  const prevPage = (vi: number) => {
    setThumbStart(p => ({ ...p, [vi]: Math.max(0, (p[vi] || 0) - PAGE_SIZE) }));
  };
  const nextPage = (vi: number, total: number) => {
    setThumbStart(p => ({ ...p, [vi]: Math.min(total - PAGE_SIZE, (p[vi] || 0) + PAGE_SIZE) }));
  };

  // Bulk select helpers
  const allKeys = videos.flatMap(v => v.thumbnails.map(t => selKey(v.index, t.timestamp)));
  const selectAll = () => setSelectionOrder(prev => {
    const existing = new Set(prev);
    const toAdd = allKeys.filter(k => !existing.has(k));
    return [...prev, ...toAdd];
  });
  const deselectAll = () => setSelectionOrder([]);
  const selectSegment = (video: VideoData, start: number, count: number) => {
    const keys = video.thumbnails.slice(start, start + count).map(t => selKey(video.index, t.timestamp));
    setSelectionOrder(prev => {
      const existing = new Set(prev);
      const toAdd = keys.filter(k => !existing.has(k));
      return [...prev, ...toAdd];
    });
  };
  const clearSegment = (video: VideoData) => {
    const keys = new Set(video.thumbnails.map(t => selKey(video.index, t.timestamp)));
    setSelectionOrder(prev => prev.filter(k => !keys.has(k)));
  };

  const globalDurSecs = parseDurationSecs(duration);

  const downloadZip = async () => {
    if (!jobId || selectionOrder.length === 0) return;
    setIsExtracting(true); setPickerStatus(null);
    try {
      const sels = selectionOrder.map((k: string) => {
        const [vi, ts] = k.split(':').map(Number);
        const rawDur = thumbDurations[k] || '';
        const clipDuration = rawDur.trim() ? parseDurationSecs(rawDur) : globalDurSecs;
        return { videoIndex: vi, timestamp: ts, duration: clipDuration };
      });
      const res = await fetch('/api/picker/extract-zip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, selections: sels, duration: globalDurSecs, credit: credit || null })
      });
      if (!res.ok) throw new Error('Extraction failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'clips.zip'; a.click();
      URL.revokeObjectURL(url);
      setPickerStatus({ type: 'success', msg: `${sels.length} clip(s) downloaded! Numbered in selection order.` });
      setSelectionOrder([]);
      setThumbDurations({});
      onClipsUpdated?.();
    } catch (e: any) {
      setPickerStatus({ type: 'error', msg: e.message || 'Download failed.' });
    } finally { setIsExtracting(false); }
  };

  const segmentSelected = (video: VideoData) =>
    video.thumbnails.filter(t => selectedSet.has(selKey(video.index, t.timestamp))).length;

  return (
    <div className="space-y-6">

      {/* ── Input Panel ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Link className="w-4 h-4 text-zinc-500" /> Video URLs
          </label>
          <p className="text-xs text-zinc-500 leading-relaxed">
            One URL per line. Optionally add <span className="font-mono text-zinc-400">@credit</span> after a URL (separated by a space) to burn a watermark on that video's clips. If no <span className="font-mono text-zinc-400">@credit</span> is on the line, the Default Credit below is used instead.
          </p>
          <textarea
            value={urls}
            onChange={e => setUrls(e.target.value)}
            placeholder={"https://archive.org/details/soviet-war-film @HistoryChannel\nhttps://archive.org/details/some-other-film @BBC\nhttps://vimeo.com/123456789"}
            rows={4}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none resize-none text-zinc-200 placeholder:text-zinc-600"
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5" /> Clip Duration <span className="normal-case font-normal text-zinc-600">(global default)</span>
            </label>
            <input
              type="text"
              list="duration-suggestions"
              value={duration}
              onChange={e => setDuration(e.target.value)}
              placeholder="e.g. 30s, 2min, 1:30"
              className="w-40 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-200 placeholder:text-zinc-600"
            />
            <datalist id="duration-suggestions">
              <option value="5" label="5 sec" />
              <option value="8" label="8 sec" />
              <option value="10" label="10 sec" />
              <option value="15" label="15 sec" />
              <option value="20" label="20 sec" />
              <option value="30" label="30 sec" />
              <option value="45" label="45 sec" />
              <option value="1min" label="1 min" />
              <option value="1m30s" label="1 min 30 sec" />
              <option value="2min" label="2 min" />
              <option value="2m30s" label="2 min 30 sec" />
              <option value="3min" label="3 min" />
              <option value="4min" label="4 min" />
              <option value="5min" label="5 min" />
              <option value="7min" label="7 min" />
              <option value="10min" label="10 min" />
              <option value="15min" label="15 min" />
              <option value="20min" label="20 min" />
              <option value="30min" label="30 min" />
              <option value="45min" label="45 min" />
              <option value="1:00:00" label="1 hour" />
            </datalist>
          </div>

          <div className="space-y-1.5 flex-1 min-w-44">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              <AtSign className="w-3.5 h-3.5" /> Default Credit <span className="normal-case font-normal">(fallback if URL has none)</span>
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

                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3">
                    <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-blue-200 space-y-2">
                      <p className="font-semibold text-blue-300">What is Batch Run?</p>
                      <p>Paste one instruction per line into the editor below and hit <strong>Run Pipeline</strong>. Each line tells FFmpeg exactly what to cut — no manual picking needed. All output clips are saved to the <strong>Saved Clips</strong> section.</p>
                      <p className="font-semibold text-blue-300 pt-0.5">Each line uses comma <span className="font-mono bg-blue-500/20 px-1 rounded">URL , field , field , @credit</span> format. Five modes:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 font-mono text-[11px]">
                        <p><span className="text-emerald-400">30s</span> <span className="text-zinc-500">,</span> <span className="text-blue-300">2:30</span> <span className="text-zinc-500">→</span> <span className="text-zinc-400">single clip at 2:30</span></p>
                        <p><span className="text-emerald-400">2min</span> <span className="text-zinc-500">→</span> <span className="text-zinc-400">chunk entire video</span></p>
                        <p><span className="text-emerald-400">30s</span> <span className="text-zinc-500">,</span> <span className="text-blue-300">2:30-4:00</span> <span className="text-zinc-500">→</span> <span className="text-zinc-400">chunk a range only</span></p>
                        <p><span className="text-purple-400">best:5</span> <span className="text-zinc-500">→</span> <span className="text-zinc-400">5 evenly spaced clips</span></p>
                        <p><span className="text-emerald-400">30s</span> <span className="text-zinc-500">,</span> <span className="text-purple-400">random:5</span> <span className="text-zinc-500">→</span> <span className="text-zinc-400">5 random clips</span></p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" /> Full Line Format Reference
                    </p>

                    {/* Color key */}
                    <div className="flex flex-wrap gap-3 text-[11px] font-mono px-1">
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-400 inline-block" /><span className="text-zinc-400">URL</span></span>
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /><span className="text-zinc-400">duration</span><span className="text-zinc-600 font-sans">(8s, 30s, 2min)</span></span>
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /><span className="text-zinc-400">timestamp / range</span><span className="text-zinc-600 font-sans">(2:30 or 2:30-4:00)</span></span>
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /><span className="text-zinc-400">mode</span><span className="text-zinc-600 font-sans">(best:N or random:N)</span></span>
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /><span className="text-zinc-400">@credit</span><span className="text-zinc-600 font-sans">(optional, any position after URL)</span></span>
                    </div>

                    <div className="bg-black rounded-xl border border-zinc-800 overflow-hidden font-mono text-xs">

                      {/* Header row */}
                      <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/80 border-b border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider">
                        <span>Mode</span><span className="ml-auto">Syntax — each field separated by comma</span>
                      </div>

                      {/* Mode rows */}
                      <div className="divide-y divide-zinc-900">

                        <div className="grid grid-cols-[90px_1fr] gap-3 px-4 py-2.5 hover:bg-zinc-900/40">
                          <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-wider self-start pt-0.5">Single clip</span>
                          <div className="space-y-0.5">
                            <p><span className="text-zinc-500">URL</span> <span className="text-zinc-700">,</span> <span className="text-emerald-400">30s</span> <span className="text-zinc-700">,</span> <span className="text-blue-400">2:30</span> <span className="text-zinc-700">,</span> <span className="text-amber-400">@BBC</span></p>
                            <p className="text-zinc-600 text-[10px]">Cut exactly 30 seconds starting at 2:30. @BBC burned into corner.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] gap-3 px-4 py-2.5 hover:bg-zinc-900/40">
                          <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-wider self-start pt-0.5">Chunk video</span>
                          <div className="space-y-0.5">
                            <p><span className="text-zinc-500">URL</span> <span className="text-zinc-700">,</span> <span className="text-emerald-400">2min</span> <span className="text-zinc-700">,</span> <span className="text-amber-400">@CNN</span></p>
                            <p className="text-zinc-600 text-[10px]">Split entire video into 2-minute chunks from start to finish.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] gap-3 px-4 py-2.5 hover:bg-zinc-900/40">
                          <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-wider self-start pt-0.5">Range chunk</span>
                          <div className="space-y-0.5">
                            <p><span className="text-zinc-500">URL</span> <span className="text-zinc-700">,</span> <span className="text-emerald-400">30s</span> <span className="text-zinc-700">,</span> <span className="text-blue-400">2:30-4:00</span> <span className="text-zinc-700">,</span> <span className="text-amber-400">@BBC</span></p>
                            <p className="text-zinc-600 text-[10px]">Chunk only the 2:30–4:00 window into 30s pieces. Rest of video ignored.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] gap-3 px-4 py-2.5 hover:bg-zinc-900/40">
                          <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-wider self-start pt-0.5">Best N</span>
                          <div className="space-y-1">
                            <p><span className="text-zinc-500">URL</span> <span className="text-zinc-700">,</span> <span className="text-purple-400">best:5</span> <span className="text-zinc-700">,</span> <span className="text-amber-400">@credit</span></p>
                            <p><span className="text-zinc-500">URL</span> <span className="text-zinc-700">,</span> <span className="text-emerald-400">30s</span> <span className="text-zinc-700">,</span> <span className="text-purple-400">best:5</span></p>
                            <p className="text-zinc-600 text-[10px]">Divide video into 5 equal intervals, cut one clip at each interval. Without a duration the clip length equals the interval. With a duration (e.g. 30s) each clip is fixed at that length.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] gap-3 px-4 py-2.5 hover:bg-zinc-900/40">
                          <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-wider self-start pt-0.5">Random N</span>
                          <div className="space-y-0.5">
                            <p><span className="text-zinc-500">URL</span> <span className="text-zinc-700">,</span> <span className="text-emerald-400">30s</span> <span className="text-zinc-700">,</span> <span className="text-purple-400">random:5</span> <span className="text-zinc-700">,</span> <span className="text-amber-400">@credit</span></p>
                            <p className="text-zinc-600 text-[10px]">Pick 5 random start times across the full video, cut 30s from each.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] gap-3 px-4 py-2.5 hover:bg-zinc-900/40">
                          <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-wider self-start pt-0.5">Chunk tail</span>
                          <div className="space-y-0.5">
                            <p><span className="text-zinc-500">URL</span> <span className="text-zinc-700">,</span> <span className="text-emerald-400">30s</span> <span className="text-zinc-700">,</span> <span className="text-blue-400">3:30<span className="text-amber-300">+</span></span></p>
                            <p className="text-zinc-600 text-[10px]">Chunk from 3:30 all the way to the end of the video. The <span className="text-amber-300">+</span> means "to end".</p>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                      <p className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">Duration formats</p>
                      <div className="text-[11px] font-mono text-zinc-400 space-y-0.5">
                        <p><span className="text-emerald-400">8s</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">15s</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">30s</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">45s</span></p>
                        <p><span className="text-emerald-400">1min</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">2min</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">5min</span></p>
                        <p><span className="text-emerald-400">1min30s</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">90</span> <span className="text-zinc-600">(plain sec)</span></p>
                        <p><span className="text-emerald-400">8sec</span> <span className="text-zinc-600">·</span> <span className="text-emerald-400">2m</span> <span className="text-zinc-600">also work</span></p>
                      </div>
                    </div>
                    <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                      <p className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">Timestamp formats</p>
                      <div className="text-[11px] font-mono text-zinc-400 space-y-0.5">
                        <p><span className="text-blue-400">1:30</span> <span className="text-zinc-600">= 1 min 30 sec (MM:SS)</span></p>
                        <p><span className="text-blue-400">0:04:22</span> <span className="text-zinc-600">= HH:MM:SS</span></p>
                        <p><span className="text-blue-400">90</span> <span className="text-zinc-600">= 90 seconds flat</span></p>
                        <p><span className="text-blue-400">2:30-4:00</span> <span className="text-zinc-600">= range (same format)</span></p>
                      </div>
                    </div>
                    <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                      <p className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">Rules</p>
                      <div className="text-[11px] text-zinc-400 space-y-0.5">
                        <p>Fields split on <span className="font-mono text-zinc-300">,</span> — no other delimiter.</p>
                        <p><span className="font-mono text-amber-400">@credit</span> is always optional and can appear anywhere after the URL.</p>
                        <p>Lines starting with <span className="font-mono text-zinc-500">#</span> are ignored (comments).</p>
                        <p>No AI, no Gemini — only yt-dlp + FFmpeg.</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex gap-3">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-200 space-y-1">
                      <p><strong>YouTube on cloud servers:</strong> YouTube often blocks automated downloads from cloud/VPS IPs. Use <span className="text-white">Internet Archive (archive.org)</span>, Vimeo, or other sources for reliable results. For YouTube, run the app locally on your computer.</p>
                      <p><strong>After download:</strong> The clips are saved in Saved Clips below. Temp files auto-delete from server after 24 hours.</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        <Scissors className="w-3.5 h-3.5" /> Your Batch Lines
                        <span className="normal-case font-normal text-zinc-600">— one instruction per line, comma-delimited</span>
                      </label>
                      {feed.trim() && (
                        <span className="text-[11px] text-zinc-600 font-mono">
                          {feed.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length} line{feed.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <textarea value={feed} onChange={e => setFeed(e.target.value)}
                      placeholder={"# Single clip at 2:30\nhttps://archive.org/... , 30s , 2:30 , @BBC\n\n# Chunk entire video into 2min pieces\nhttps://archive.org/... , 2min , @CNN\n\n# Chunk only between 2:30 and 4:00\nhttps://archive.org/... , 30s , 2:30-4:00\n\n# 5 evenly spaced clips\nhttps://archive.org/... , best:5 , @credit\n\n# 5 random 30s clips\nhttps://archive.org/... , 30s , random:5"}
                      rows={9}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none resize-none text-zinc-200 placeholder:text-zinc-600" />
                  </div>

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
                <span className="text-xs text-zinc-600">Click thumbnail = preview &nbsp;·&nbsp; SELECT = add to queue</span>
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
              const visible = video.thumbnails.slice(start, start + PAGE_SIZE);
              const hasPrev = start > 0;
              const hasNext = start + PAGE_SIZE < video.thumbnails.length;
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
                    {video.credit && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">{video.credit}</span>
                    )}
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
                          }} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Per-segment controls */}
                    <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-zinc-800">
                      <button onClick={() => selectSegment(video, start, PAGE_SIZE)}
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
                          const k = selKey(video.index, thumb.timestamp);
                          const selIdx = selectionOrder.indexOf(k);
                          const rawDur = thumbDurations[k] || '';
                          const effectiveDurSecs = rawDur.trim() ? parseDurationSecs(rawDur) : globalDurSecs;
                          return (
                            <ThumbCard key={k} thumb={thumb} videoIndex={video.index} jobId={jobId}
                              clipDurationSecs={effectiveDurSecs}
                              selectionIndex={selIdx === -1 ? null : selIdx}
                              onSelect={() => toggleSel(video.index, thumb.timestamp)}
                              durationVal={rawDur}
                              onDurationChange={v => setThumbDurations(p => ({ ...p, [k]: v }))}
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

                      {/* Pagination */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-600">
                          {start > 0 && <span className="text-blue-400/70 mr-1.5">↳ from {video.thumbnails[start]?.label}</span>}
                          Showing {start + 1}–{start + visible.length} of {video.thumbnails.length}
                          {video.status !== 'done' && ' — still extracting…'}
                        </span>
                        <div className="flex items-center gap-2">
                          {hasPrev && (
                            <button onClick={() => prevPage(video.index)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all">
                              <ChevronLeft className="w-3.5 h-3.5" /> Prev 4
                            </button>
                          )}
                          {hasNext && (
                            <button onClick={() => nextPage(video.index, video.thumbnails.length)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all">
                              Next 4 <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
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
        {selectionOrder.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="sticky bottom-4 z-20">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl px-6 py-4 shadow-2xl flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-blue-500/20">{selectionOrder.length}</div>
                <div>
                  <p className="text-sm font-semibold text-white">{selectionOrder.length} clip{selectionOrder.length !== 1 ? 's' : ''} in queue</p>
                  <p className="text-xs text-zinc-500">
                    Numbered 001–{String(selectionOrder.length).padStart(3, '0')} in selection order · ZIP download
                    {credit ? ` · @${credit.replace(/^@/, '')}` : ''}
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
