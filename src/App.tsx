import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play, Settings, Video, Download, Terminal, CheckCircle2,
  AlertCircle, RefreshCcw, Info, Trash2, X, Clock, ChevronDown
} from 'lucide-react';
import Studio from './Studio';

function ClipCard({ clip, index, selected, onToggle }: {
  key?: React.Key | null; clip: string; index: number; selected: boolean; onToggle: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const clipName = clip.replace(/\.mp4$/, '').replace(/_/g, ' ').trim();

  const handlePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    v.muted = false; v.controls = true; v.play().catch(() => {}); setPlaying(true);
  }, []);
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current; if (!v) return;
    v.pause(); v.currentTime = 0; v.controls = false; v.muted = true; setPlaying(false);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.03 }}
      className={`group relative bg-zinc-900 border ${selected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-zinc-800 hover:border-zinc-700'} rounded-2xl overflow-hidden transition-all`}
    >
      {!playing && (
        <div className="absolute top-3 left-3 z-20" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onToggle}
            className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-600 cursor-pointer" />
        </div>
      )}
      <div className="aspect-video bg-zinc-950 relative">
        <video ref={videoRef} src={`/clips/${clip}`} poster={`/api/thumbnail/${clip}`}
          className="w-full h-full object-cover" playsInline muted preload="none"
          onEnded={() => { const v = videoRef.current; if (v) { v.controls = false; v.muted = true; v.currentTime = 0; } setPlaying(false); }}
        />
        {!playing && (
          <div className="absolute inset-0 cursor-pointer flex items-center justify-center group/v" onClick={handlePlay}>
            <div className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center opacity-0 group-hover/v:opacity-100 transition-opacity">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
          </div>
        )}
        {playing && (
          <button onClick={handleClose} className="absolute top-2 right-2 z-20 p-1 bg-black/60 hover:bg-black/80 rounded-full text-white transition-all">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="p-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-white truncate font-mono flex-1" title={clipName}>{clipName}</p>
        <a href={`/clips/${clip}`} download={clip} className="shrink-0 p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-all">
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    </motion.div>
  );
}

export default function App() {
  const [clips, setClips] = useState<string[]>([]);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const groupedClips = React.useMemo(() => {
    const groups: Record<string, string[]> = {};
    clips.forEach(clip => {
      const m = clip.match(/_s(\d+)_/);
      const key = m ? m[1] : 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(clip);
    });
    return groups;
  }, [clips]);

  const fetchData = async () => {
    try {
      const [lr, cr] = await Promise.all([fetch('/api/pipeline-status'), fetch('/api/clips')]);
      if (lr.ok) { const d = await lr.json(); if (d.content !== undefined) setLogs(d.content); }
      if (cr.ok) { const d = await cr.json(); if (d.files) setClips(d.files); }
    } catch {}
  };

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 3000); return () => clearInterval(t); }, []);
  useEffect(() => { if (showLogs) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs, showLogs]);

  const toggleClip = (clip: string) => {
    setSelectedClips(prev => { const n = new Set(prev); n.has(clip) ? n.delete(clip) : n.add(clip); return n; });
  };

  const deleteSelected = async () => {
    if (!selectedClips.size) return;
    setIsDeleting(true);
    try {
      await fetch('/api/delete-clips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: Array.from(selectedClips) }) });
      setSelectedClips(new Set()); fetchData();
    } finally { setIsDeleting(false); }
  };

  const downloadSelected = async () => {
    if (!selectedClips.size) return;
    try {
      const res = await fetch('/api/download-zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: Array.from(selectedClips) }) });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'clips.zip'; a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-sans selection:bg-blue-500/30">

      {/* ── Header ── */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Video className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white leading-none">Clip Factory <span className="text-blue-400">⚡ V2</span></h1>
              <p className="text-[11px] text-zinc-500 mt-0.5">Extract · Preview · Download</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLogs(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
            >
              <Terminal className="w-4 h-4" /> Logs
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
            >
              <Settings className="w-4 h-4" /> Settings
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-12">

        {/* Studio section */}
        <Studio onClipsUpdated={fetchData} />

        {/* ── Saved Clips ── */}
        <section className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4 border-t border-zinc-800 pt-8">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Saved Clips</h2>
              <p className="text-zinc-500 text-sm mt-0.5">{clips.length > 0 ? `${clips.length} clip${clips.length !== 1 ? 's' : ''} on server` : 'Clips from Batch Run appear here'}</p>
            </div>
            {clips.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => setSelectedClips(selectedClips.size === clips.length ? new Set() : new Set(clips))}
                  className="text-xs font-medium text-zinc-500 hover:text-white transition-colors">
                  {selectedClips.size === clips.length ? 'Deselect All' : 'Select All'}
                </button>
                {selectedClips.size > 0 && (
                  <button onClick={deleteSelected} disabled={isDeleting}
                    className="flex items-center gap-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95">
                    <Trash2 className="w-3.5 h-3.5" />
                    {isDeleting ? 'Deleting…' : `Delete (${selectedClips.size})`}
                  </button>
                )}
                {selectedClips.size > 0 && (
                  <button onClick={downloadSelected}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-lg shadow-blue-500/20 active:scale-95">
                    <Download className="w-3.5 h-3.5" /> Download ({selectedClips.size})
                  </button>
                )}
                <a href="/api/download-all" download="clips.zip"
                  className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95">
                  <Download className="w-3.5 h-3.5" /> Download All
                </a>
              </div>
            )}
          </div>

          {clips.length > 0 ? (
            <div className="space-y-10">
              {Object.entries(groupedClips).sort((a, b) => {
                const ia = parseInt(a[0]), ib = parseInt(b[0]);
                return (isNaN(ia) || isNaN(ib)) ? a[0].localeCompare(b[0]) : ia - ib;
              }).map(([key, groupClips]: [string, string[]]) => (
                <div key={key} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-purple-600/20 border border-purple-500/20 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-purple-300 text-sm">
                      {key !== 'other' ? key : '?'}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">Segment {key !== 'other' ? key : 'Misc'}</h3>
                      <p className="text-zinc-600 text-xs">{groupClips.length} clip{groupClips.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {groupClips.sort().map((clip, i) => (
                      <ClipCard key={clip} clip={clip} index={i} selected={selectedClips.has(clip)} onToggle={() => toggleClip(clip)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-16 flex flex-col items-center justify-center bg-zinc-900/30 border-2 border-dashed border-zinc-800 rounded-3xl gap-3">
              <Video className="w-10 h-10 text-zinc-700" />
              <p className="text-zinc-500 text-sm text-center">
                No server clips yet.<br />
                <span className="text-zinc-600">Use Browse & Pick to download a ZIP, or Batch Run to save clips here.</span>
              </p>
            </div>
          )}
        </section>
      </main>

      {/* ── Logs Panel ── */}
      <AnimatePresence>
        {showLogs && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40" onClick={() => setShowLogs(false)} />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-2xl z-50 bg-zinc-900 border-l border-zinc-800 flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-zinc-400" />
                  <h3 className="font-semibold text-white">Pipeline Logs</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={async () => { await fetch('/api/clear-log', { method: 'POST' }); setLogs(''); }}
                    className="text-xs text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-all flex items-center gap-1.5">
                    <RefreshCcw className="w-3.5 h-3.5" /> Clear
                  </button>
                  <button onClick={() => setShowLogs(false)} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-5 font-mono text-xs text-zinc-400 leading-relaxed">
                {logs ? logs.split('\n').map((line, i) => (
                  <div key={i} className="hover:bg-zinc-800/50 px-2 -mx-2 rounded py-0.5">
                    <span className="text-zinc-700 mr-3 select-none">{String(i + 1).padStart(3, '0')}</span>
                    <span className={line.includes(' ERROR') ? 'text-red-400' : line.includes(' WARNING') ? 'text-amber-400' : line.includes(' INFO') ? 'text-zinc-300' : ''}>{line}</span>
                  </div>
                )) : (
                  <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
                    <Terminal className="w-8 h-8 opacity-20" />
                    <p>No logs yet. Run the pipeline to see output.</p>
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Settings Panel ── */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40" onClick={() => setShowSettings(false)} />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-xl z-50 bg-zinc-900 border-l border-zinc-800 flex flex-col shadow-2xl overflow-y-auto"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-zinc-400" />
                  <h3 className="font-semibold text-white">Settings & Guide</h3>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                {/* How it works */}
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">How it works</h4>
                  <div className="space-y-3">
                    {[
                      { icon: '🎬', title: 'Browse & Pick', desc: 'Paste URLs → thumbnails load → click the frames you want → Download ZIP. Great for picking exact moments visually.' },
                      { icon: '⚡', title: 'Batch Run', desc: 'Expand "Batch Run Mode" and use feed format. Clips are saved to the server and appear in Saved Clips below.' },
                      { icon: '👁', title: 'Preview', desc: 'Hover any thumbnail and click the play button to watch the clip inline before selecting it.' },
                    ].map(item => (
                      <div key={item.title} className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex gap-3">
                        <span className="text-xl">{item.icon}</span>
                        <div>
                          <p className="text-sm font-semibold text-white">{item.title}</p>
                          <p className="text-xs text-zinc-400 mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Batch format */}
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">Batch Format</h4>
                  <pre className="bg-black rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">{`URL | duration | start_time | @credit

# One clip at 2:30
https://youtube.com/... | 30sec | 2:30 | @BBC

# Chunk from 3:30 to end (add +)
https://youtube.com/... | 30sec | 3:30+

# Chunk entire video
https://archive.org/... | 2min | @CNN

# Duration formats: 8sec, 2min, 1min30sec, 90
# Time formats: 1:30 or 0:04:22 or 90`}</pre>
                </div>

                {/* Notes */}
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">Notes</h4>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300">YouTube blocks automated downloads on cloud IPs. Use Internet Archive or run locally for YouTube.</p>
                  </div>
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3">
                    <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-200">yt-dlp fetches stream URLs directly — no full video download needed. FFmpeg cuts only the segment you want.</p>
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex gap-3">
                    <Clock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-200">Credit watermark is burned into the bottom-left of every clip using FFmpeg drawtext.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style>{`
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>
    </div>
  );
}
