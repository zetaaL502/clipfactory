import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings, Video, Download, Terminal, CheckCircle2,
  AlertCircle, RefreshCcw, Info, Trash2, X, Clock, Scissors, Play
} from 'lucide-react';
import Studio from './Studio';

class ErrorBoundary extends (React.Component as any) {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const error: Error | null = this.state.error;
    if (error) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
          <div className="max-w-xl w-full bg-zinc-900 border border-red-500/30 rounded-2xl p-8 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Something went wrong</h2>
            </div>
            <pre className="text-xs text-zinc-400 bg-zinc-950 rounded-xl p-4 overflow-auto max-h-48 whitespace-pre-wrap">
              {error.message}{'\n\n'}{error.stack}
            </pre>
            <button onClick={() => window.location.reload()}
              className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
              <RefreshCcw className="w-4 h-4" /> Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ClipCard({ clip, index, selected, onToggle }: {
  key?: React.Key | null; clip: string; index: number; selected: boolean; onToggle: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const clipName = clip.replace(/\.mp4$/, '').replace(/_/g, ' ').trim();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.03 }}
      className={`group relative bg-zinc-900 border rounded-xl overflow-hidden transition-all
        ${selected ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-zinc-800 hover:border-zinc-700'}`}
    >
      <div className="aspect-video bg-zinc-950 relative">
        <video ref={videoRef} src={`/clips/${clip}`} poster={`/api/thumbnail/${clip}`}
          className="w-full h-full object-cover" playsInline preload="metadata"
          controls={playing}
          onPlay={() => setPlaying(true)}
          onEnded={() => setPlaying(false)}
        />
        {!playing && (
          <button
            onClick={e => { e.stopPropagation(); videoRef.current?.play(); }}
            className="absolute inset-0 w-full h-full flex items-center justify-center bg-transparent">
            <Play className="w-10 h-10 text-white fill-white drop-shadow-lg" />
          </button>
        )}
      </div>
      <div className="px-3 py-2 flex items-center gap-2">
        <input type="checkbox" checked={selected} onChange={onToggle}
          onClick={e => e.stopPropagation()}
          className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600 cursor-pointer shrink-0" />
        <p className="text-xs text-white truncate font-mono flex-1" title={clipName}>{clipName}</p>
        <a href={`/clips/${clip}`} download={clip} onClick={e => e.stopPropagation()}
          className="shrink-0 p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-600 hover:text-white transition-all">
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    </motion.div>
  );
}

function App() {
  const [clips, setClips] = useState<string[]>([]);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cookieContent, setCookieContent] = useState('');
  const [cookiesExist, setCookiesExist] = useState(false);
  const [cookieSaveStatus, setCookieSaveStatus] = useState<'idle'|'saved'|'cleared'>('idle');
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
  useEffect(() => {
    if (showSettings) fetch('/api/cookies').then(r => r.json()).then(d => setCookiesExist(d.exists)).catch(() => {});
  }, [showSettings]);

  const saveCookies = async () => {
    const res = await fetch('/api/cookies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: cookieContent }) });
    const d = await res.json();
    setCookiesExist(d.status === 'saved');
    setCookieSaveStatus(d.status === 'saved' ? 'saved' : 'cleared');
    if (d.status !== 'saved') setCookieContent('');
    setTimeout(() => setCookieSaveStatus('idle'), 3000);
  };

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

      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Scissors className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white tracking-tight">Clip Factory <span className="text-blue-400">V2</span></span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowLogs(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all">
              <Terminal className="w-3.5 h-3.5" /> Logs
            </button>
            <button onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all">
              <Settings className="w-3.5 h-3.5" /> Settings
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-5 py-8 space-y-10">
        <Studio onClipsUpdated={fetchData} />

        {/* Saved Clips */}
        <section className="space-y-5 border-t border-zinc-800 pt-8">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Saved Clips</h2>
              <p className="text-zinc-500 text-sm">
                {clips.length > 0 ? `${clips.length} clip${clips.length !== 1 ? 's' : ''} on server` : 'Batch Run clips appear here'}
              </p>
            </div>
            {clips.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setSelectedClips(selectedClips.size === clips.length ? new Set() : new Set(clips))}
                  className="text-xs text-zinc-500 hover:text-white transition-colors px-2 py-1.5">
                  {selectedClips.size === clips.length ? 'Deselect All' : 'Select All'}
                </button>
                {selectedClips.size > 0 && (
                  <button onClick={deleteSelected} disabled={isDeleting}
                    className="flex items-center gap-1.5 bg-red-600/15 hover:bg-red-600/25 border border-red-500/25 text-red-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                    {isDeleting ? 'Deleting…' : `Delete (${selectedClips.size})`}
                  </button>
                )}
                {selectedClips.size > 0 && (
                  <button onClick={downloadSelected}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all">
                    <Download className="w-3.5 h-3.5" /> Download ({selectedClips.size})
                  </button>
                )}
                <a href="/api/download-all" download="clips.zip"
                  className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg text-xs font-medium transition-all">
                  <Download className="w-3.5 h-3.5" /> All
                </a>
              </div>
            )}
          </div>

          {clips.length > 0 ? (
            <div className="space-y-8">
              {Object.entries(groupedClips).sort((a, b) => {
                const ia = parseInt(a[0]), ib = parseInt(b[0]);
                return (isNaN(ia) || isNaN(ib)) ? a[0].localeCompare(b[0]) : ia - ib;
              }).map(([key, groupClips]: [string, string[]]) => (
                <div key={key} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Segment {key !== 'other' ? key : 'Misc'} · {groupClips.length} clip{groupClips.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {groupClips.sort().map((clip, i) => (
                      <ClipCard key={clip} clip={clip} index={i} selected={selectedClips.has(clip)} onToggle={() => toggleClip(clip)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-14 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-2xl gap-3">
              <Video className="w-8 h-8 text-zinc-700" />
              <p className="text-zinc-500 text-sm text-center leading-relaxed">
                No clips saved yet.<br />
                <span className="text-zinc-600 text-xs">Browse & Pick → ZIP download, or Batch Run → saves here.</span>
              </p>
            </div>
          )}
        </section>
      </main>

      {/* Logs Drawer */}
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
                  <h3 className="font-semibold text-white text-sm">Pipeline Logs</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={async () => { await fetch('/api/clear-log', { method: 'POST' }); setLogs(''); }}
                    className="text-xs text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-all flex items-center gap-1.5">
                    <RefreshCcw className="w-3 h-3" /> Clear
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
                    <p>No logs yet.</p>
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Drawer */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40" onClick={() => setShowSettings(false)} />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-lg z-50 bg-zinc-900 border-l border-zinc-800 flex flex-col shadow-2xl overflow-y-auto"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-zinc-400" />
                  <h3 className="font-semibold text-white text-sm">Settings & Guide</h3>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-6">

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">How it works</p>
                  {[
                    { icon: '🎬', title: 'Browse & Pick', desc: 'Paste URLs → thumbnails load → click the frames you want → Download ZIP.' },
                    { icon: '⚡', title: 'Batch Run', desc: 'Use the Batch Run section for fully automatic cutting. Clips save to the server.' },
                    { icon: '👁', title: 'Preview', desc: 'Hover any thumbnail and click the play button to preview the clip inline.' },
                  ].map(item => (
                    <div key={item.title} className="bg-zinc-800/40 border border-zinc-800 rounded-xl p-3 flex gap-3">
                      <span className="text-lg">{item.icon}</span>
                      <div>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <p className="text-xs text-zinc-400 mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Browse & Pick — URL Format</p>
                  <p className="text-xs text-zinc-400">One URL per line. Add <span className="font-mono text-zinc-300">@credit</span> after a URL to watermark that video's clips.</p>
                  <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">{`https://archive.org/details/my-film @HistoryChannel\nhttps://archive.org/details/other-film @BBC\nhttps://vimeo.com/123456789`}</pre>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Batch Run — Feed Format</p>
                  <p className="text-xs text-zinc-400">Fields separated by <span className="font-mono text-zinc-300">,</span> — five modes available.</p>
                  <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">{`# Single clip at 2:30\nhttps://archive.org/details/film , 30s , 2:30 , @BBC\n\n# Chunk entire video\nhttps://archive.org/details/film , 2min , @CNN\n\n# Chunk 2:30–4:00 only\nhttps://archive.org/details/film , 30s , 2:30-4:00\n\n# 5 evenly spaced clips\nhttps://archive.org/details/film , best:5 , @credit\n\n# 5 random 30s clips\nhttps://archive.org/details/film , 30s , random:5`}</pre>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">YouTube Cookies</p>
                    {cookiesExist && <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5">Active</span>}
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    YouTube blocks cloud downloads. Export cookies using the <span className="text-zinc-300">Get cookies.txt LOCALLY</span> browser extension and paste below.
                  </p>
                  <textarea
                    value={cookieContent}
                    onChange={e => setCookieContent(e.target.value)}
                    placeholder={"# Netscape HTTP Cookie File\n# Export from browser using 'Get cookies.txt LOCALLY'\n\n.youtube.com\tTRUE\t/\t..."}
                    rows={5}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-3 font-mono text-xs focus:ring-1 focus:ring-blue-500/50 outline-none resize-none text-zinc-300 placeholder:text-zinc-700"
                  />
                  <div className="flex items-center gap-3">
                    <button onClick={saveCookies}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-all">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {cookieContent.trim() ? 'Save Cookies' : 'Clear Cookies'}
                    </button>
                    {cookieSaveStatus !== 'idle' && (
                      <span className={`text-xs ${cookieSaveStatus === 'saved' ? 'text-emerald-400' : 'text-zinc-400'}`}>
                        {cookieSaveStatus === 'saved' ? 'Cookies saved.' : 'Cookies cleared.'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Notes</p>
                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3 flex gap-2.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300">YouTube blocks automated downloads on cloud IPs. Use cookies to work around this.</p>
                  </div>
                  <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl p-3 flex gap-2.5">
                    <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-200">yt-dlp fetches stream URLs directly — FFmpeg cuts only the segment you want.</p>
                  </div>
                  <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl p-3 flex gap-2.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-200">Credit watermark is burned into the bottom-left of every clip using FFmpeg drawtext.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style>{`
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>
    </div>
  );
}

export default function AppWithBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>;
}
