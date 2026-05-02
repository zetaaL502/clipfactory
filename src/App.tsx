import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, 
  FileText, 
  Settings, 
  Video, 
  Download, 
  Terminal, 
  CheckCircle2, 
  AlertCircle,
  RefreshCcw,
  Save,
  Info,
  Power,
  Trash2,
  X,
  Clock,
  MousePointer
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Picker from './Picker';

function ClipCard({ clip, index, selected, onToggle }: {
  clip: string;
  index: number;
  selected: boolean;
  onToggle: () => void;
  [key: string]: unknown;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const clipName = clip.replace(/\.mp4$/, '').replace(/_/g, ' ').trim();
  const posterUrl = `/api/thumbnail/${clip}`;

  const handlePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.controls = true;
    v.play().catch(() => {});
    setPlaying(true);
  }, []);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    v.controls = false;
    v.muted = true;
    setPlaying(false);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (playing) return;
    videoRef.current?.play().catch(() => {});
  }, [playing]);

  const handleMouseLeave = useCallback(() => {
    if (playing) return;
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  }, [playing]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.04 }}
      className={`group relative bg-zinc-900 border ${selected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-zinc-800'} rounded-2xl overflow-hidden hover:border-zinc-700 transition-all shadow-xl`}
    >
      {!playing && (
        <div className="absolute top-3 left-3 z-20" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-600 cursor-pointer"
          />
        </div>
      )}

      <div className="aspect-video bg-zinc-950 relative group/video">
        <video
          ref={videoRef}
          src={`/clips/${clip}`}
          poster={posterUrl}
          className="w-full h-full object-cover"
          playsInline
          muted
          preload="none"
          onEnded={() => {
            const v = videoRef.current;
            if (v) { v.controls = false; v.muted = true; v.currentTime = 0; }
            setPlaying(false);
          }}
        />

        {!playing && (
          <div
            className="absolute inset-0 cursor-pointer flex items-center justify-center"
            onClick={handlePlay}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center opacity-0 group-hover/video:opacity-100 transition-opacity duration-150">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
          </div>
        )}

        {playing && (
          <button
            onClick={handleClose}
            className="absolute top-2 right-2 z-20 p-1 bg-black/60 hover:bg-black/80 rounded-full text-white transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-white truncate font-mono" title={clipName}>{clipName}</p>
        </div>
        <a
          href={`/clips/${clip}`}
          download={clip}
          className="shrink-0 p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-all"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    </motion.div>
  );
}

export default function App() {
  const [feed, setFeed] = useState('');
  const [logs, setLogs] = useState('');
  const [clips, setClips] = useState<string[]>([]);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<'feed' | 'logs' | 'clips' | 'settings' | 'help' | 'picker'>('feed');
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  // Group clips by line/URL number encoded as _s{N}_ in the filename
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

  const fetchLogsAndClips = async () => {
    try {
      const [logsRes, clipsRes] = await Promise.all([
        fetch('/api/pipeline-status'),
        fetch('/api/clips')
      ]);
      
      if (!logsRes.ok || !clipsRes.ok) return;

      const logsText = await logsRes.text();
      const clipsText = await clipsRes.text();

      try {
        const logsData = JSON.parse(logsText);
        const clipsData = JSON.parse(clipsText);

        if (logsData.content !== undefined) setLogs(logsData.content);
        if (clipsData.files) setClips(clipsData.files);
      } catch (e) {
        // Not JSON
      }
    } catch (err) {
      console.error("Failed to fetch logs/clips", err);
    }
  };

  const fetchInitialData = async () => {
    try {
      const feedRes = await fetch('/api/feed');
      if (!feedRes.ok) return;
      const feedText = await feedRes.text();
      try {
        const feedData = JSON.parse(feedText);
        if (feedData.content !== undefined) setFeed(feedData.content);
      } catch (e) {}
    } catch (err) {
      console.error("Failed to fetch initial config", err);
    }
  };

  useEffect(() => {
    fetchInitialData();
    fetchLogsAndClips();
    const interval = setInterval(fetchLogsAndClips, 3000); // Poll every 3s
    return () => clearInterval(interval);
  }, []);

  const saveFeed = async () => {
    setIsSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: feed })
      });
      if (res.ok) {
        setStatus({ type: 'success', message: 'Feed updated successfully!' });
      } else {
        setStatus({ type: 'error', message: 'Failed to update feed.' });
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Error saving feed.' });
    } finally {
      setIsSaving(false);
    }
  };


  const runPipeline = async () => {
    setIsRunning(true);
    setStatus(null);
    try {
      // Auto-save feed before running
      await fetch('/api/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: feed })
      });

      const res = await fetch('/api/run', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setStatus({ type: 'success', message: 'Pipeline started!' });
        setActiveTab('logs');
      } else {
        setStatus({ type: 'error', message: data.error || 'Failed to start pipeline.' });
        setIsRunning(false);
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Error starting pipeline.' });
      setIsRunning(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedClips.size === 0) return;

    setIsDeleting(true);
    try {
      const res = await fetch('/api/delete-clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: Array.from(selectedClips) })
      });
      if (res.ok) {
        setSelectedClips(new Set());
        fetchLogsAndClips();
        setStatus({ type: 'success', message: 'Clips deleted successfully.' });
      }
    } catch (err) {
      console.error("Failed to delete clips", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const downloadSelected = async () => {
    if (selectedClips.size === 0) return;
    try {
      const res = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: Array.from(selectedClips) })
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "selected_clips.zip";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to create ZIP.' });
    }
  };

  const toggleSelectAll = () => {
    if (selectedClips.size === clips.length) {
      setSelectedClips(new Set());
    } else {
      setSelectedClips(new Set(clips));
    }
  };

  const toggleClip = (clip: string) => {
    const next = new Set(selectedClips);
    if (next.has(clip)) next.delete(clip);
    else next.add(clip);
    setSelectedClips(next);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-sans selection:bg-blue-500/30">
      {/* Top Navigation */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Video className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-emerald-400">Clip Factory ⚡️ V2</h1>
          </div>
          <div className="flex items-center gap-1 bg-zinc-800 p-1 rounded-xl overflow-x-auto custom-scrollbar">
            {[
              { id: 'feed', icon: FileText, label: 'Feed' },
              { id: 'picker', icon: MousePointer, label: 'Picker' },
              { id: 'logs', icon: Terminal, label: 'Logs' },
              { id: 'clips', icon: CheckCircle2, label: 'Clips' },
              { id: 'settings', icon: Settings, label: 'Settings' },
              { id: 'help', icon: Info, label: 'Guide' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id as any); setStatus(null); }}
                className={`
                  flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all
                  ${activeTab === tab.id 
                    ? 'bg-zinc-700 text-white shadow-sm' 
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}
                `}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'feed' && (
            <motion.div
              key="feed"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Input Stream</h2>
                  <p className="text-zinc-400 text-sm mt-1">Define your video sources, clip duration, and exact start timestamp. One line per clip.</p>
                </div>
                <div className="flex items-center gap-3">
                  {status && (
                    <motion.div 
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex items-center gap-2 text-sm font-medium ${status.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}
                    >
                      {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      {status.message}
                    </motion.div>
                  )}
                  <button
                    onClick={saveFeed}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white px-5 py-2 rounded-xl transition-all shadow-lg active:scale-95 font-medium border border-zinc-700"
                  >
                    {isSaving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                  </button>
                  <button
                    onClick={runPipeline}
                    disabled={isRunning}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 font-medium"
                  >
                    {isRunning ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                    Run Pipeline
                  </button>
                </div>
              </div>

              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
                <textarea
                  value={feed}
                  onChange={(e) => setFeed(e.target.value)}
                  placeholder="URL | duration | start_time | @credit (optional)"
                  className="relative w-full h-[60vh] bg-zinc-900 border border-zinc-800 rounded-xl p-6 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all resize-none shadow-inner"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4">
                <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl">
                  <h3 className="text-zinc-300 font-semibold text-sm mb-2">Video URL</h3>
                  <p className="text-zinc-500 text-xs">YouTube, Internet Archive, and thousands of other sites.</p>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl">
                  <h3 className="text-zinc-300 font-semibold text-sm mb-2">Duration</h3>
                  <p className="text-zinc-500 text-xs">Clip length in seconds (e.g., <span className="text-zinc-400 font-mono">8</span>, <span className="text-zinc-400 font-mono">15</span>).</p>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl">
                  <h3 className="text-zinc-300 font-semibold text-sm mb-2">Start Time</h3>
                  <p className="text-zinc-500 text-xs">Where to cut from — e.g. <span className="text-zinc-400 font-mono">1:30</span> or <span className="text-zinc-400 font-mono">0:04:22</span> or plain seconds like <span className="text-zinc-400 font-mono">90</span>.</p>
                </div>
                <div className="bg-zinc-900/50 border border-blue-500/20 p-4 rounded-xl">
                  <h3 className="text-zinc-300 font-semibold text-sm mb-2">Credit <span className="text-zinc-600 font-normal">(optional)</span></h3>
                  <p className="text-zinc-500 text-xs">Text burned into the bottom-left corner — e.g. <span className="text-zinc-400 font-mono">@yourchannel</span></p>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'picker' && (
            <motion.div
              key="picker"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <Picker />
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-3xl space-y-8"
            >
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">System Settings</h2>
                <p className="text-zinc-400 text-sm mt-1">Core preferences and format reference.</p>
              </div>

              <div className="space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl flex flex-col gap-4">
                  <div>
                    <h3 className="text-md font-semibold text-zinc-200">Feed Format</h3>
                    <p className="text-sm text-zinc-500 mb-4">
                      One clip per line. Paste your URL, how long you want the clip, and where to start cutting. Credit is optional.
                    </p>
                  </div>
                  <pre className="bg-black p-4 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">
{`URL | duration_seconds | start_time | @credit

# Examples:
https://archive.org/... | 10 | 1:30 | @mychannel
https://youtube.com/...  | 8  | 0:04:22
https://youtube.com/...  | 15 | 90`}
                  </pre>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl">
                  <h3 className="text-md font-semibold text-zinc-200 mb-2">Start Time Formats</h3>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-zinc-800 rounded-xl p-3 text-center">
                      <p className="font-mono text-blue-300 text-base">1:30</p>
                      <p className="text-zinc-500 text-xs mt-1">MM:SS</p>
                    </div>
                    <div className="bg-zinc-800 rounded-xl p-3 text-center">
                      <p className="font-mono text-blue-300 text-base">0:04:22</p>
                      <p className="text-zinc-500 text-xs mt-1">HH:MM:SS</p>
                    </div>
                    <div className="bg-zinc-800 rounded-xl p-3 text-center">
                      <p className="font-mono text-blue-300 text-base">90</p>
                      <p className="text-zinc-500 text-xs mt-1">Plain seconds</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Execution Logs</h2>
                  <p className="text-zinc-400 text-sm mt-1">Real-time terminal output from the processing pipeline.</p>
                </div>
                <button
                  onClick={async () => {
                    await fetch('/api/clear-log', { method: 'POST' });
                    setLogs('');
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors text-xs font-medium"
                  title="Clear logs"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Clear
                </button>
              </div>

              <div className="bg-black border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/50" />
                    <div className="w-3 h-3 rounded-full bg-amber-500/50" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500/50" />
                  </div>
                  <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest font-bold">pipeline.log</span>
                </div>
                <div className="p-6 h-[70vh] overflow-auto font-mono text-xs text-zinc-400 leading-relaxed custom-scrollbar">
                  {logs ? logs.split('\n').map((line, i) => (
                    <div key={i} className="hover:bg-zinc-900 px-2 -mx-2 rounded transition-colors group">
                      <span className="text-zinc-700 mr-4 select-none group-hover:text-zinc-600">{(i + 1).toString().padStart(3, '0')}</span>
                      {line}
                    </div>
                  )) : (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-3">
                      <Terminal className="w-8 h-8 opacity-20" />
                      <p>No activity recorded yet.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'clips' && (
            <motion.div
              key="clips"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Generated Clips</h2>
                  <p className="text-zinc-400 text-sm mt-1">Finished 4K extractions (3 per scene, no audio).</p>
                </div>
                <div className="flex items-center gap-3">
                  {clips.length > 0 && (
                    <>
                      <button
                        onClick={toggleSelectAll}
                        className="text-xs font-medium text-zinc-500 hover:text-white transition-colors mr-2"
                      >
                        {selectedClips.size === clips.length ? 'Deselect All' : 'Select All'}
                      </button>
                      
                      {selectedClips.size > 0 && (
                        <button
                          onClick={deleteSelected}
                          disabled={isDeleting}
                          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white border border-emerald-500 px-4 py-2 rounded-xl transition-all active:scale-95 text-xs font-bold shadow-lg shadow-emerald-900/20"
                        >
                          <Trash2 className="w-4 h-4" />
                          DELETE ({selectedClips.size})
                        </button>
                      )}

                      <button
                        onClick={downloadSelected}
                        disabled={selectedClips.size === 0}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 font-medium"
                      >
                        <Download className="w-4 h-4" />
                        Download Selected ({selectedClips.size})
                      </button>
                      <a
                        href="/api/download-all"
                        download="clips.zip"
                        className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-5 py-2 rounded-xl transition-all border border-zinc-700 shadow-lg active:scale-95 font-medium"
                      >
                        <Download className="w-4 h-4" />
                        Download All
                      </a>
                    </>
                  )}
                </div>
              </div>

              {clips.length > 0 ? (
                <div className="space-y-12">
                  {Object.entries(groupedClips).sort((a,b) => {
                    const ia = parseInt(a[0]);
                    const ib = parseInt(b[0]);
                    if (isNaN(ia) || isNaN(ib)) return a[0].localeCompare(b[0]);
                    return ia - ib;
                  }).map(([index, groupClips]: [string, string[]]) => (
                    <div key={index} className="space-y-6">
                      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-purple-600 w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-lg shadow-purple-900/20">
                            {index !== 'unknown' ? index : '?'}
                          </div>
                          <div>
                            <h3 className="text-white font-bold text-lg tracking-tight">
                              Segment {index !== 'unknown' ? index : 'Uncategorized'}
                            </h3>
                            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">{groupClips.length} Clips Extracted</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {groupClips.sort().map((clip, i) => (
                          <ClipCard
                            key={clip}
                            clip={clip}
                            index={i}
                            selected={selectedClips.has(clip)}
                            onToggle={() => toggleClip(clip)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-20 flex flex-col items-center justify-center bg-zinc-900/50 border-2 border-dashed border-zinc-800 rounded-3xl gap-4">
                  <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center">
                    <Video className="w-8 h-8 text-zinc-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-semibold">No clips extracted yet</p>
                    <p className="text-zinc-500 text-sm">Processed clips will appear here automatically.</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'help' && (
            <motion.div
              key="help"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-3xl space-y-8"
            >
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">System Guide</h2>
                <p className="text-zinc-400 text-sm mt-1">Everything you need to know to run Clip Factory.</p>
              </div>

              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-400">Two ways to extract clips</h3>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-blue-500/10 p-2 rounded-lg text-blue-400 font-bold text-xs">1</div>
                    <div>
                      <p className="text-white font-medium">Feed Tab — Batch Mode</p>
                      <p className="text-zinc-400 text-sm mt-1">
                        Paste one line per clip in the format <code className="text-zinc-300 font-mono">URL | duration | start_time | @credit</code>.
                        Hit <strong>Run Pipeline</strong> and all clips are cut and saved to the Clips tab automatically.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="bg-blue-500/10 p-2 rounded-lg text-blue-400 font-bold text-xs">2</div>
                    <div>
                      <p className="text-white font-medium">Picker Tab — Visual Mode</p>
                      <p className="text-zinc-400 text-sm mt-1">
                        Paste URLs, set a clip duration, and browse auto-generated thumbnails (one every 30 seconds).
                        Click the frames you want, then hit <strong>Download as ZIP</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-400">Feed format</h3>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl">
                  <pre className="bg-black p-4 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">
{`URL | duration_seconds | start_time | @credit

https://archive.org/... | 10 | 1:30 | @mychannel
https://youtube.com/...  | 8  | 0:04:22
https://youtube.com/...  | 15 | 90`}
                  </pre>
                  <p className="text-zinc-500 text-xs mt-3">Start time accepts <code className="text-zinc-400">MM:SS</code>, <code className="text-zinc-400">HH:MM:SS</code>, or plain seconds.</p>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-400">Notes</h3>
                <div className="space-y-3">
                  <div className="bg-orange-500/10 border border-orange-500/20 p-5 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-orange-300 leading-relaxed">
                      <strong>YouTube on cloud IPs:</strong> YouTube often blocks automated downloads from cloud servers.
                      Sites like <strong>Internet Archive</strong> work reliably. For YouTube, run the project locally.
                    </p>
                  </div>
                  <div className="bg-blue-500/10 border border-blue-500/20 p-5 rounded-xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-100 leading-relaxed">
                      <strong>Credit watermark:</strong> Add <code className="text-blue-300">@handle</code> as the 4th field to burn text into the bottom-left corner of every clip using FFmpeg drawtext.
                    </p>
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-xl flex items-start gap-3">
                    <Clock className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-emerald-100 leading-relaxed">
                      <strong>How extraction works:</strong> yt-dlp fetches the direct stream URL, then FFmpeg seeks to your timestamp and cuts the clip — no full video download required.
                    </p>
                  </div>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>

    </div>
  );
}

