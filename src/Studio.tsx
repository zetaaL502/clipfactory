import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Film, Link, Clock, AtSign, Download, Loader2, AlertCircle,
  CheckCircle2, X, Play, Square, ChevronRight, Power, ChevronDown, ChevronUp, Zap
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

    const check = () => {
      if (v.currentTime >= thumb.timestamp + clipDuration) {
        v.pause(); onStop();
      }
    };
    v.addEventListener('timeupdate', check);
    return () => v.removeEventListener('timeupdate', check);
  }, [playing, thumb.timestamp, clipDuration, onStop]);

  useEffect(() => {
    if (!playing) { const v = videoRef.current; if (v) { v.pause(); v.currentTime = thumb.timestamp; } }
  }, [playing, thumb.timestamp]);

  return (
    <div className={`relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer
      ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-zinc-700 hover:border-zinc-500'}
      ${playing ? 'border-emerald-500 ring-2 ring-emerald-500/20' : ''}`}
    >
      {/* Duration badge at top */}
      <div className={`absolute top-0 inset-x-0 z-10 text-center py-1 text-[11px] font-bold
        ${playing ? 'bg-emerald-600/90 text-white' : selected ? 'bg-blue-600/80 text-white' : 'bg-black/60 text-zinc-200'}`}>
        {readableDuration(clipDuration)} clip
      </div>

      {/* Video element (always rendered, src only when playing to avoid preloading all) */}
      {playing && (
        <video
          ref={videoRef}
          src={`/api/picker/video/${jobId}/${videoIndex}`}
          className="w-full aspect-video object-cover bg-black"
          playsInline
          onEnded={onStop}
        />
      )}

      {/* Thumbnail image (shown when not playing) */}
      {!playing && (
        <img
          src={`/api/picker/thumb/${jobId}/${videoIndex}/${thumb.file}`}
          alt={`from ${thumb.label}`}
          className="w-full aspect-video object-cover"
          loading="lazy"
        />
      )}

      {/* Overlay: click center to play/stop */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        onClick={playing ? onStop : onPlay}
      >
        {playing ? (
          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <Square className="w-4 h-4 text-white fill-white" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          </div>
        )}
      </div>

      {/* Checkbox selector (top-left, stops propagation so it doesn't trigger play) */}
      <div className="absolute top-6 left-2 z-20" onClick={e => { e.stopPropagation(); onToggle(); }}>
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all cursor-pointer
          ${selected ? 'bg-blue-500 border-blue-400' : 'bg-black/60 border-zinc-500 hover:border-white'}`}>
          {selected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
        </div>
      </div>

      {/* Timestamp label at bottom */}
      <div className={`absolute bottom-0 inset-x-0 py-1 text-center text-[10px] font-mono
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
  const [thumbVisible, setThumbVisible] = useState<Record<number, number>>({});
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
    setPickerStatus(null);
    setIsLoading(true);
    setSelections(new Set());
    setThumbVisible({});
    setVideos([]);
    setJobId(null);
    setPlayingKey(null);
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
    const text = feed.trim();
    if (!text) return;
    setIsBatchRunning(true); setBatchStatus(null);
    try {
      await fetch('/api/feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) });
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

  const handlePlay = useCallback((vi: number, ts: number) => {
    setPlayingKey(selKey(vi, ts));
  }, []);

  const handleStop = useCallback(() => {
    setPlayingKey(null);
  }, []);

  const addMore = (vi: number) => setThumbVisible(p => ({ ...p, [vi]: (p[vi] || PAGE_SIZE) + PAGE_SIZE }));

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
      setPickerStatus({ type: 'success', msg: `${sels.length} clip(s) downloaded!` });
      onClipsUpdated?.();
    } catch (e: any) {
      setPickerStatus({ type: 'error', msg: e.message || 'Download failed.' });
    } finally { setIsExtracting(false); }
  };

  const clipDur = parseInt(duration) || 30;

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
            <select
              value={duration}
              onChange={e => setDuration(e.target.value)}
              className="w-32 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-200"
            >
              <option value="15">15 sec</option>
              <option value="30">30 sec</option>
              <option value="60">1 min</option>
              <option value="120">2 min</option>
              <option value="300">5 min</option>
              <option value="600">10 min</option>
            </select>
          </div>

          <div className="space-y-1.5 flex-1 min-w-44">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              <AtSign className="w-3.5 h-3.5" /> Credit Watermark <span className="normal-case font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={credit}
              onChange={e => setCredit(e.target.value)}
              placeholder="@yourchannel"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          <button
            onClick={handleBrowse}
            disabled={isLoading || !urls.trim()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-6 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/20 active:scale-95"
          >
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
          <button
            onClick={() => setShowBatch(b => !b)}
            className="flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-wider"
          >
            <Zap className="w-3.5 h-3.5" />
            Batch Run Mode
            {showBatch ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <AnimatePresence>
            {showBatch && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-4 space-y-3">
                  <p className="text-xs text-zinc-500">
                    Paste lines in format: <span className="font-mono text-zinc-400">URL | duration | start_time | @credit</span> — clips save directly to the server.
                    No timestamp = whole video gets chunked. Add <span className="font-mono text-zinc-400">+</span> after timestamp to chunk from that point to end.
                  </p>
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 font-mono text-xs space-y-1 text-zinc-400">
                    <p><span className="text-zinc-600"># one clip at 2:30</span></p>
                    <p>https://youtube.com/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">30sec</span> <span className="text-zinc-600">|</span> <span className="text-blue-400">2:30</span> <span className="text-zinc-600">|</span> <span className="text-amber-400">@BBC</span></p>
                    <p className="pt-1"><span className="text-zinc-600"># chunk from 3:30 to end (add + after time)</span></p>
                    <p>https://youtube.com/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">30sec</span> <span className="text-zinc-600">|</span> <span className="text-blue-400">3:30+</span></p>
                    <p className="pt-1"><span className="text-zinc-600"># chunk entire video</span></p>
                    <p>https://archive.org/... <span className="text-zinc-600">|</span> <span className="text-emerald-400">2min</span> <span className="text-zinc-600">|</span> <span className="text-amber-400">@CNN</span></p>
                  </div>
                  <textarea
                    value={feed}
                    onChange={e => setFeed(e.target.value)}
                    placeholder="URL | duration | start_time (optional) | @credit (optional)"
                    rows={6}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none resize-none text-zinc-200 placeholder:text-zinc-600"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleBatchRun}
                      disabled={isBatchRunning || !feed.trim()}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-5 py-2 rounded-xl font-semibold transition-all shadow-lg shadow-emerald-500/20 active:scale-95 text-sm"
                    >
                      {isBatchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                      {isBatchRunning ? 'Running…' : 'Run Pipeline'}
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white tracking-tight">Browse & Select Clips</h3>
              <p className="text-xs text-zinc-500">Click a thumbnail to preview · click checkbox to select</p>
            </div>
            {videos.map(video => {
              const visCount = thumbVisible[video.index] || PAGE_SIZE;
              const visible = video.thumbnails.slice(0, visCount);
              const hasMore = visCount < video.thumbnails.length;

              return (
                <motion.div
                  key={video.index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
                >
                  <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800">
                    <Film className="w-4 h-4 text-zinc-500 shrink-0" />
                    <span className="text-sm text-zinc-300 font-mono truncate flex-1" title={video.url}>{shortUrl(video.url)}</span>
                    {statusBadge(video.status)}
                    {video.duration && (
                      <span className="text-xs text-zinc-600 shrink-0">
                        {Math.floor(video.duration / 60)}:{String(Math.round(video.duration % 60)).padStart(2, '0')} total
                      </span>
                    )}
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
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-4 gap-3">
                        {visible.map(thumb => {
                          const k = `${video.index}:${thumb.timestamp}`;
                          return (
                            <ThumbCard
                              key={k}
                              thumb={thumb}
                              videoIndex={video.index}
                              jobId={jobId}
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
                          {visible.length} of {video.thumbnails.length} shown
                          {video.status !== 'done' && ' — still extracting…'}
                        </span>
                        {hasMore && (
                          <button
                            onClick={() => addMore(video.index)}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all"
                          >
                            <ChevronRight className="w-3.5 h-3.5" /> Add 4
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
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="sticky bottom-4 z-20"
          >
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl px-6 py-4 shadow-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold text-white">{selections.size}</div>
                <div>
                  <p className="text-sm font-semibold text-white">{selections.size} clip{selections.size !== 1 ? 's' : ''} selected</p>
                  <p className="text-xs text-zinc-500">{readableDuration(clipDur)} each{credit ? ` · @${credit.replace(/^@/, '')}` : ''} · no audio</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setSelections(new Set())} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all">
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
                <button
                  onClick={downloadZip}
                  disabled={isExtracting}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-5 py-2 rounded-xl font-semibold transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                >
                  {isExtracting ? <><Loader2 className="w-4 h-4 animate-spin" /> Cutting clips…</> : <><Download className="w-4 h-4" /> Download ZIP</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
