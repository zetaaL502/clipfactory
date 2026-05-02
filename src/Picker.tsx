import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Download, Loader2,
  AlertCircle, CheckCircle2, Film, Link, Clock, AtSign, X, RefreshCcw
} from 'lucide-react';

interface Thumbnail {
  file: string;
  timestamp: number;
  label: string;
}

interface VideoData {
  index: number;
  url: string;
  status: 'queued' | 'downloading' | 'extracting' | 'done' | 'error';
  thumbnails: Thumbnail[];
  duration?: number;
  error?: string;
}

const PAGE_SIZE = 4;

function statusBadge(status: VideoData['status']) {
  const map: Record<string, { label: string; className: string }> = {
    queued:      { label: 'Queued',      className: 'bg-zinc-700 text-zinc-300' },
    downloading: { label: 'Downloading', className: 'bg-blue-500/20 text-blue-300 animate-pulse' },
    extracting:  { label: 'Extracting',  className: 'bg-amber-500/20 text-amber-300 animate-pulse' },
    done:        { label: 'Ready',       className: 'bg-emerald-500/20 text-emerald-300' },
    error:       { label: 'Error',       className: 'bg-red-500/20 text-red-300' },
  };
  const s = map[status] || map.queued;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${s.className}`}>
      {s.label}
    </span>
  );
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 40) + (u.pathname.length > 40 ? '…' : '');
  } catch {
    return url.slice(0, 60) + (url.length > 60 ? '…' : '');
  }
}

export default function Picker() {
  const [urls, setUrls] = useState('');
  const [duration, setDuration] = useState('10');
  const [credit, setCredit] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [thumbPages, setThumbPages] = useState<Record<number, number>>({});
  const [selections, setSelections] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId || !isRunning) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/picker/job/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setVideos(data.videos || []);
        if (data.status === 'done') {
          setIsRunning(false);
          clearInterval(pollRef.current!);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(pollRef.current!);
  }, [jobId, isRunning]);

  const handleSubmit = async () => {
    const urlList = urls.trim().split('\n').map(u => u.trim()).filter(Boolean);
    if (!urlList.length) return;
    setStatus(null);
    setIsRunning(true);
    setSelections(new Set());
    setThumbPages({});
    setVideos([]);
    setJobId(null);
    try {
      const res = await fetch('/api/picker/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList, duration: parseInt(duration) || 10, credit: credit || null })
      });
      const data = await res.json();
      setJobId(data.jobId);
    } catch {
      setIsRunning(false);
      setStatus({ type: 'error', message: 'Failed to start job.' });
    }
  };

  const selKey = (videoIndex: number, timestamp: number) => `${videoIndex}:${timestamp}`;

  const toggleSelection = (videoIndex: number, timestamp: number) => {
    const key = selKey(videoIndex, timestamp);
    setSelections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isSelected = (videoIndex: number, timestamp: number) =>
    selections.has(selKey(videoIndex, timestamp));

  const goPage = (videoIndex: number, delta: number, max: number) => {
    setThumbPages(prev => {
      const cur = prev[videoIndex] || 0;
      const next = Math.max(0, Math.min(cur + delta, Math.ceil(max / PAGE_SIZE) - 1));
      return { ...prev, [videoIndex]: next };
    });
  };

  const downloadSelected = async () => {
    if (!jobId || selections.size === 0) return;
    setIsExtracting(true);
    setStatus(null);
    try {
      const sels = Array.from(selections).map(key => {
        const [vi, ts] = key.split(':').map(Number);
        return { videoIndex: vi, timestamp: ts };
      });
      const res = await fetch('/api/picker/extract-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, selections: sels, duration: parseInt(duration) || 10, credit: credit || null })
      });
      if (!res.ok) throw new Error('Extraction failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'picker_clips.zip';
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ type: 'success', message: `${sels.length} clip(s) downloaded!` });
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message || 'Download failed.' });
    } finally {
      setIsExtracting(false);
    }
  };

  const totalThumbs = videos.reduce((acc, v) => acc + v.thumbnails.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Manual Clip Picker</h2>
          <p className="text-zinc-400 text-sm mt-1">Paste video URLs, browse thumbnails, and download exactly the clips you want.</p>
        </div>
        {status && (
          <motion.div
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            className={`flex items-center gap-2 text-sm font-medium ${status.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {status.message}
          </motion.div>
        )}
      </div>

      {/* Input Form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
            <Link className="w-4 h-4 text-zinc-500" /> Video URLs <span className="text-zinc-600 font-normal">(one per line)</span>
          </label>
          <textarea
            value={urls}
            onChange={e => setUrls(e.target.value)}
            placeholder={"https://www.youtube.com/watch?v=...\nhttps://archive.org/details/...\nhttps://vimeo.com/..."}
            className="w-full h-32 bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none resize-none text-zinc-200"
          />
        </div>
        <div className="flex gap-4 flex-wrap">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <Clock className="w-3.5 h-3.5 text-zinc-500" /> Clip Duration (seconds)
            </label>
            <input
              type="number"
              min={1} max={120}
              value={duration}
              onChange={e => setDuration(e.target.value)}
              className="w-32 bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none text-zinc-200"
            />
          </div>
          <div className="space-y-1.5 flex-1 min-w-48">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <AtSign className="w-3.5 h-3.5 text-zinc-500" /> Credit Watermark <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={credit}
              onChange={e => setCredit(e.target.value)}
              placeholder="@yourchannel"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none text-zinc-200"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSubmit}
              disabled={isRunning || !urls.trim()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-medium transition-all shadow-lg shadow-blue-500/20 active:scale-95"
            >
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
              {isRunning ? 'Processing…' : 'Fetch Thumbnails'}
            </button>
          </div>
        </div>
      </div>

      {/* Video Results */}
      <AnimatePresence>
        {videos.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            {videos.map(video => {
              const page = thumbPages[video.index] || 0;
              const visible = video.thumbnails.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
              const totalPages = Math.ceil(video.thumbnails.length / PAGE_SIZE);

              return (
                <motion.div
                  key={video.index}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
                >
                  {/* Video Header */}
                  <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-900/80">
                    <Film className="w-4 h-4 text-zinc-500 shrink-0" />
                    <span className="text-sm text-zinc-300 font-mono truncate flex-1" title={video.url}>
                      {shortUrl(video.url)}
                    </span>
                    {statusBadge(video.status)}
                    {video.duration && (
                      <span className="text-xs text-zinc-600 shrink-0">
                        {Math.floor(video.duration / 60)}:{Math.round(video.duration % 60).toString().padStart(2, '0')} total
                      </span>
                    )}
                  </div>

                  {/* Error state */}
                  {video.status === 'error' && (
                    <div className="p-5 flex items-center gap-3 text-sm text-red-400">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {video.error || 'Download failed.'}
                    </div>
                  )}

                  {/* Loading state */}
                  {(video.status === 'downloading' || (video.status === 'extracting' && video.thumbnails.length === 0)) && (
                    <div className="p-8 flex flex-col items-center gap-3 text-zinc-500">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-sm">
                        {video.status === 'downloading' ? 'Downloading video…' : 'Extracting thumbnails…'}
                      </span>
                    </div>
                  )}

                  {/* Thumbnails */}
                  {video.thumbnails.length > 0 && (
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-4 gap-3">
                        {visible.map(thumb => {
                          const selected = isSelected(video.index, thumb.timestamp);
                          return (
                            <motion.button
                              key={thumb.file}
                              onClick={() => toggleSelection(video.index, thumb.timestamp)}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              className={`relative rounded-xl overflow-hidden border-2 transition-all group
                                ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-zinc-700 hover:border-zinc-500'}`}
                            >
                              <img
                                src={`/api/picker/thumb/${jobId}/${video.index}/${thumb.file}`}
                                alt={`t=${thumb.label}`}
                                className="w-full aspect-video object-cover"
                                loading="lazy"
                              />
                              {selected && (
                                <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                                  <CheckCircle2 className="w-6 h-6 text-blue-300 drop-shadow" />
                                </div>
                              )}
                              <div className={`absolute bottom-0 inset-x-0 py-1 text-center text-[11px] font-mono font-semibold
                                ${selected ? 'bg-blue-600/80 text-white' : 'bg-black/60 text-zinc-300'}`}>
                                {thumb.label}
                              </div>
                            </motion.button>
                          );
                        })}
                        {/* Placeholder slots */}
                        {Array.from({ length: PAGE_SIZE - visible.length }).map((_, i) => (
                          <div key={`empty-${i}`} className="rounded-xl border-2 border-zinc-800 border-dashed aspect-video bg-zinc-950/50" />
                        ))}
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => goPage(video.index, -1, video.thumbnails.length)}
                            disabled={page === 0}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" /> Previous 4
                          </button>
                          <span className="text-xs text-zinc-600">
                            {page + 1} / {totalPages} &nbsp;·&nbsp; {video.thumbnails.length} thumbnails
                          </span>
                          <button
                            onClick={() => goPage(video.index, +1, video.thumbnails.length)}
                            disabled={page >= totalPages - 1}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            Next 4 <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Download Bar */}
      <AnimatePresence>
        {selections.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="sticky bottom-4 z-20"
          >
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl px-6 py-4 shadow-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold text-white">
                  {selections.size}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{selections.size} clip{selections.size !== 1 ? 's' : ''} selected</p>
                  <p className="text-xs text-zinc-500">{duration}s each{credit ? ` · watermark: ${credit}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelections(new Set())}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
                >
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
                <button
                  onClick={downloadSelected}
                  disabled={isExtracting}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-5 py-2 rounded-xl font-medium transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                >
                  {isExtracting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Cutting clips…</>
                    : <><Download className="w-4 h-4" /> Download as ZIP</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {!isRunning && videos.length === 0 && !jobId && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-600 gap-4">
          <Film className="w-12 h-12 opacity-20" />
          <p className="text-sm">Paste video URLs above and click Fetch Thumbnails to get started.</p>
        </div>
      )}
    </div>
  );
}
