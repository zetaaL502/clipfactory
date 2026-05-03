import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Film, Link, Clock, AtSign, Download, Loader2, AlertCircle,
  CheckCircle2, X, Play, Square, ChevronRight, ChevronLeft,
  Power, ChevronDown, Zap, Trash2, CheckSquare, MinusSquare,
  Scissors, CornerRightDown
} from 'lucide-react';

interface Thumbnail { file: string; timestamp: number; label: string; }
interface VideoData {
  index: number; url: string; credit?: string | null;
  status: 'queued' | 'downloading' | 'extracting' | 'done' | 'error';
  thumbnails: Thumbnail[]; duration?: number; error?: string;
}

function cleanUrl(raw: string): string { return raw.split('|')[0].trim(); }

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
  if (combMatch && (combMatch[1] || combMatch[2])) return (parseInt(combMatch[1] || '0') * 60) + parseInt(combMatch[2] || '0');
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
    queued:      { label: 'Queued',      cls: 'bg-zinc-700/60 text-zinc-400' },
    downloading: { label: 'Downloading', cls: 'bg-blue-500/20 text-blue-300 animate-pulse' },
    extracting:  { label: 'Extracting',  cls: 'bg-amber-500/20 text-amber-300 animate-pulse' },
    done:        { label: 'Ready',       cls: 'bg-emerald-500/20 text-emerald-400' },
    error:       { label: 'Error',       cls: 'bg-red-500/20 text-red-400' },
  };
  const s = map[status] || map.queued;
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${s.cls}`}>{s.label}</span>;
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
  const effectiveDurSecs = durationVal.trim() ? parseDurationSecs(durationVal) : clipDurationSecs;
  const durLabel = shortDur(effectiveDurSecs);
  const hasCustomDur = durationVal.trim().length > 0;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    v.currentTime = thumb.timestamp;
    v.play().catch(() => {});
    const check = () => { if (v.currentTime >= thumb.timestamp + effectiveDurSecs) { v.pause(); onStop(); } };
    v.addEventListener('timeupdate', check);
    return () => v.removeEventListener('timeupdate', check);
  }, [playing, thumb.timestamp, effectiveDurSecs, onStop]);

  useEffect(() => {
    if (!playing) { const v = videoRef.current; if (v) { v.pause(); v.currentTime = thumb.timestamp; } }
  }, [playing, thumb.timestamp]);

  return (
    <div
      onClick={onSelect}
      className={`relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all select-none flex flex-col
        ${playing
          ? 'border-emerald-500 ring-2 ring-emerald-500/20'
          : isSelected
            ? 'border-blue-500 ring-2 ring-blue-500/30'
            : 'border-zinc-800 hover:border-zinc-600'}`}
    >
      {/* Top-left: order badge */}
      {isSelected && (
        <div className="absolute top-1.5 left-1.5 z-30 w-5 h-5 rounded-full bg-blue-600 border border-blue-400/60 flex items-center justify-center text-[9px] font-bold text-white">
          {selectionIndex + 1}
        </div>
      )}

      {/* Top-right: live duration badge */}
      <div className={`absolute top-1.5 right-1.5 z-30 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded shadow
        ${hasCustomDur ? 'bg-blue-600 text-white' : 'bg-black/70 text-zinc-300'}`}>
        {durLabel}
      </div>

      {/* Thumbnail / video */}
      <div className="relative" onClick={e => e.stopPropagation()}>
        {playing ? (
          <video ref={videoRef} src={`/api/picker/video/${jobId}/${videoIndex}`}
            className="w-full aspect-video object-cover bg-black" playsInline onEnded={onStop} />
        ) : (
          <img src={`/api/picker/thumb/${jobId}/${videoIndex}/${thumb.file}`}
            alt={`at ${thumb.label}`} className="w-full aspect-video object-cover" loading="lazy" />
        )}
        {isSelected && !playing && <div className="absolute inset-0 bg-blue-500/15 pointer-events-none" />}
        <div className="absolute inset-0 flex items-center justify-center" onClick={playing ? onStop : onPlay}>
          <div className="w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            {playing
              ? <Square className="w-3.5 h-3.5 text-white fill-white" />
              : <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className={`flex items-center gap-1.5 px-2 py-1.5 transition-colors ${isSelected ? 'bg-blue-950/60' : 'bg-zinc-900'}`}>
        <span className="text-[10px] font-mono text-zinc-600 shrink-0">{thumb.label}</span>
        <input
          type="text"
          value={durationVal}
          onChange={e => onDurationChange(e.target.value)}
          onClick={e => e.stopPropagation()}
          list="duration-suggestions"
          placeholder={shortDur(clipDurationSecs)}
          className={`flex-1 min-w-0 text-[11px] font-mono text-center rounded px-1.5 py-0.5 outline-none border transition-colors
            ${hasCustomDur
              ? 'bg-blue-950 border-blue-500/60 text-blue-200 placeholder:text-blue-400/30'
              : 'bg-zinc-800 border-zinc-700 text-zinc-300 placeholder:text-zinc-600 focus:border-zinc-500'}`}
        />
        <span className={`shrink-0 text-[10px] font-bold w-4 text-center ${isSelected ? 'text-blue-400' : 'text-zinc-700'}`}>
          {isSelected ? '✓' : '·'}
        </span>
      </div>
    </div>
  );
}

export default function Studio({ onClipsUpdated }: { onClipsUpdated?: () => void }) {
  const [urls, setUrls] = useState('');
  const [duration, setDuration] = useState('30');
  const [credit, setCredit] = useState('');

  const [jobId, setJobId] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [thumbStart, setThumbStart] = useState<Record<number, number>>({});
  const [thumbSeekVal, setThumbSeekVal] = useState<Record<number, string>>({});
  const [thumbSeekErr, setThumbSeekErr] = useState<Record<number, boolean>>({});

  const [selectionOrder, setSelectionOrder] = useState<string[]>([]);
  const [thumbDurations, setThumbDurations] = useState<Record<string, string>>({});
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [pickerStatus, setPickerStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedSet = new Set(selectionOrder);

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

  const selKey = (vi: number, ts: number) => `${vi}:${ts}`;

  const toggleSel = useCallback((vi: number, ts: number) => {
    const k = selKey(vi, ts);
    setSelectionOrder(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
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

  const prevPage = (vi: number) => setThumbStart(p => ({ ...p, [vi]: Math.max(0, (p[vi] || 0) - PAGE_SIZE) }));
  const nextPage = (vi: number, total: number) => setThumbStart(p => ({ ...p, [vi]: Math.min(total - PAGE_SIZE, (p[vi] || 0) + PAGE_SIZE) }));

  const allKeys = videos.flatMap(v => v.thumbnails.map(t => selKey(v.index, t.timestamp)));
  const selectAll = () => setSelectionOrder(prev => { const ex = new Set(prev); return [...prev, ...allKeys.filter(k => !ex.has(k))]; });
  const deselectAll = () => setSelectionOrder([]);
  const selectSegment = (video: VideoData, start: number, count: number) => {
    const keys = video.thumbnails.slice(start, start + count).map(t => selKey(video.index, t.timestamp));
    setSelectionOrder(prev => { const ex = new Set(prev); return [...prev, ...keys.filter(k => !ex.has(k))]; });
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
      setPickerStatus({ type: 'success', msg: `${sels.length} clip${sels.length !== 1 ? 's' : ''} downloaded.` });
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
    <div className="space-y-5">
      {/* ── Input Card ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold text-white">
              <Link className="w-3.5 h-3.5 text-zinc-500" /> Video URLs
            </label>
            <textarea
              value={urls}
              onChange={e => setUrls(e.target.value)}
              placeholder={"https://archive.org/details/my-film @HistoryChannel\nhttps://archive.org/details/other-film @BBC\nhttps://vimeo.com/123456789"}
              rows={3}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 font-mono text-sm focus:ring-1 focus:ring-blue-500/60 outline-none resize-none text-zinc-200 placeholder:text-zinc-700"
            />
            <p className="text-xs text-zinc-600">One box for everything. Plain links = Browse & Pick. Comma lines = Batch Run.</p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Clock className="w-3 h-3" /> Duration <span className="text-zinc-700">(global default)</span>
              </label>
              <input
                type="text"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="4 = 4s, 1m, 2m30s, 1:30"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500/60 text-zinc-200 placeholder:text-zinc-600"
              />
              <p className="text-[11px] text-zinc-600">Type what you mean. <span className="font-mono text-zinc-500">4</span> means 4s, <span className="font-mono text-zinc-500">1m</span> means 1 minute.</p>
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <AtSign className="w-3 h-3" /> Default Credit
              </label>
              <input type="text" value={credit} onChange={e => setCredit(e.target.value)}
                placeholder="@yourchannel"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500/60 text-zinc-200 placeholder:text-zinc-600" />
            </div>

            <button onClick={handleBrowse} disabled={isLoading || !urls.trim()}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-md shadow-blue-500/20 active:scale-95">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
              {isLoading ? 'Loading…' : 'Browse & Pick'}
            </button>
          </div>
        </div>

      </div>

      {/* ── Thumbnail Grid ── */}
      <AnimatePresence>
        {videos.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">

            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-base font-semibold text-white">Select Clips</h3>
              <div className="flex items-center gap-1.5">
                <button onClick={selectAll}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all">
                  <CheckSquare className="w-3 h-3" /> All
                </button>
                <button onClick={deselectAll}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all">
                  <MinusSquare className="w-3 h-3" /> None
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
                <motion.div key={video.index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

                  {/* Video header */}
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 flex-wrap">
                    <Film className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    <span className="text-xs text-zinc-400 font-mono truncate flex-1 min-w-0" title={video.url}>{shortUrl(video.url)}</span>
                    {video.credit && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">{video.credit}</span>
                    )}
                    {statusBadge(video.status)}
                    {video.duration && (
                      <span className="text-xs text-zinc-600 shrink-0 font-mono">
                        {Math.floor(video.duration / 60)}:{String(Math.round(video.duration % 60)).padStart(2, '0')}
                      </span>
                    )}

                    {/* Seek input */}
                    <div className={`flex items-center gap-1 rounded-lg border px-2 py-1 shrink-0 transition-colors
                      ${seekErr ? 'border-red-500/50 bg-red-500/8' : 'border-zinc-700 bg-zinc-800 focus-within:border-blue-500/50'}`}>
                      <CornerRightDown className="w-3 h-3 text-zinc-600 shrink-0" />
                      <input
                        type="text" value={seekVal}
                        onChange={e => { setThumbSeekVal(p => ({ ...p, [video.index]: e.target.value })); setThumbSeekErr(p => ({ ...p, [video.index]: false })); }}
                        onKeyDown={e => { if (e.key === 'Enter') applySeek(video.index, video.thumbnails, seekVal); }}
                        onBlur={() => { if (seekVal.trim()) applySeek(video.index, video.thumbnails, seekVal); }}
                        placeholder="jump to…"
                        className="w-20 bg-transparent text-[11px] font-mono text-zinc-300 placeholder:text-zinc-600 outline-none"
                      />
                      {seekVal.trim() && (
                        <button onClick={() => { setThumbSeekVal(p => ({ ...p, [video.index]: '' })); setThumbSeekErr(p => ({ ...p, [video.index]: false })); setThumbStart(p => ({ ...p, [video.index]: 0 })); }}
                          className="text-zinc-600 hover:text-zinc-400 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Segment controls */}
                    <div className="flex items-center gap-1 shrink-0 border-l border-zinc-800 pl-2">
                      <button onClick={() => selectSegment(video, start, PAGE_SIZE)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-zinc-800 hover:bg-blue-600/20 text-zinc-500 hover:text-blue-300 transition-all">
                        <CheckSquare className="w-3 h-3" /> {visible.length}
                      </button>
                      <button onClick={() => clearSegment(video)} disabled={segSel === 0}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-all
                          ${segSel > 0 ? 'bg-red-600/15 hover:bg-red-600/25 text-red-400' : 'bg-zinc-800 text-zinc-700 cursor-default'}`}>
                        <Trash2 className="w-3 h-3" /> {segSel > 0 ? segSel : ''}
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
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm">{video.status === 'downloading' ? 'Downloading…' : 'Extracting thumbnails…'}</span>
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
                          <div key={`e-${i}`} className="rounded-xl border-2 border-zinc-800 border-dashed aspect-video bg-zinc-950/30" />
                        ))}
                      </div>

                      {/* Pagination */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-600">
                          {start > 0 && <span className="text-blue-400/60 mr-1.5">from {video.thumbnails[start]?.label}</span>}
                          {start + 1}–{start + visible.length} / {video.thumbnails.length}
                          {video.status !== 'done' && ' · extracting…'}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {hasPrev && (
                            <button onClick={() => prevPage(video.index)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all">
                              <ChevronLeft className="w-3.5 h-3.5" /> Prev
                            </button>
                          )}
                          {hasNext && (
                            <button onClick={() => nextPage(video.index, video.thumbnails.length)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all">
                              Next <ChevronRight className="w-3.5 h-3.5" />
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

      {/* ── Sticky Download Bar ── */}
      <AnimatePresence>
        {selectionOrder.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="sticky bottom-4 z-20">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl px-5 py-3.5 shadow-2xl shadow-black/40 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-sm font-bold text-white">{selectionOrder.length}</div>
                <div>
                  <p className="text-sm font-semibold text-white">{selectionOrder.length} clip{selectionOrder.length !== 1 ? 's' : ''} selected</p>
                  <p className="text-xs text-zinc-500">
                    Numbered 001–{String(selectionOrder.length).padStart(3, '0')} · ZIP
                    {credit ? ` · @${credit.replace(/^@/, '')}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={deselectAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all">
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
                <button onClick={downloadZip} disabled={isExtracting}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-5 py-2 rounded-xl font-semibold text-sm transition-all shadow-md shadow-emerald-500/20 active:scale-95">
                  {isExtracting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Cutting…</>
                    : <><Download className="w-4 h-4" /> Download ZIP</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
