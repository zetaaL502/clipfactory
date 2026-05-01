import React, { useState, useEffect } from 'react';
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
  Power
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [feed, setFeed] = useState('');
  const [logs, setLogs] = useState('');
  const [clips, setClips] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [activeTab, setActiveTab] = useState<'feed' | 'logs' | 'clips' | 'settings' | 'help'>('feed');
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

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
      const [feedRes, settingsRes] = await Promise.all([
        fetch('/api/feed'),
        fetch('/api/settings')
      ]);

      if (!feedRes.ok || !settingsRes.ok) return;

      const feedText = await feedRes.text();
      const settingsText = await settingsRes.text();

      try {
        const feedData = JSON.parse(feedText);
        const settingsData = JSON.parse(settingsText);

        if (feedData.content !== undefined) setFeed(feedData.content);
        if (settingsData.GOOGLE_API_KEY) setApiKey(settingsData.GOOGLE_API_KEY);
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

  const saveSettings = async () => {
    setIsSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ GOOGLE_API_KEY: apiKey })
      });
      if (res.ok) {
        setStatus({ type: 'success', message: 'Settings saved!' });
      } else {
        setStatus({ type: 'error', message: 'Failed to save settings.' });
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Error saving settings.' });
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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-sans selection:bg-blue-500/30">
      {/* Top Navigation */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Video className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Clip Factory</h1>
          </div>
          <div className="flex items-center gap-1 bg-zinc-800 p-1 rounded-xl overflow-x-auto custom-scrollbar">
            {[
              { id: 'feed', icon: FileText, label: 'Feed' },
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
                  <p className="text-zinc-400 text-sm mt-1">Define your YouTube sources, clip durations, and visual prompts.</p>
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
                  placeholder="URL | duration | prompt"
                  className="relative w-full h-[60vh] bg-zinc-900 border border-zinc-800 rounded-xl p-6 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all resize-none shadow-inner"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl">
                  <h3 className="text-zinc-300 font-semibold text-sm mb-2">Video URLs</h3>
                  <p className="text-zinc-500 text-xs">Standard YouTube links (watch?v=...) are supported.</p>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl">
                  <h3 className="text-zinc-300 font-semibold text-sm mb-2">Duration</h3>
                  <p className="text-zinc-500 text-xs">Target duration in seconds (e.g., 8, 12).</p>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl">
                  <h3 className="text-zinc-300 font-semibold text-sm mb-2">Visual Prompt</h3>
                  <p className="text-zinc-500 text-xs text-balance">Describe the specific moment you want Gemini to find.</p>
                </div>
              </div>
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">System Settings</h2>
                  <p className="text-zinc-400 text-sm mt-1">Configure API keys and core preferences.</p>
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
                    onClick={saveSettings}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 font-medium"
                  >
                    {isSaving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Config
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl flex flex-col gap-4">
                  <div>
                    <h3 className="text-md font-semibold text-zinc-200">Google Gemini API Key</h3>
                    <p className="text-sm text-zinc-500 mb-4">
                      Required for file uploads and video analysis using Gemini 1.5 Flash.
                      If you're using AI Studio, you may have one configured in environment variables natively, but
                      providing it here ensures the background script can use it.
                    </p>
                  </div>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                  />
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
                  onClick={fetchLogsAndClips}
                  className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
                >
                  <RefreshCcw className="w-5 h-5" />
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Generated Clips</h2>
                  <p className="text-zinc-400 text-sm mt-1">Finished 4K extractions ready for use.</p>
                </div>
                {clips.length > 0 && (
                  <a
                    href="/api/download-all"
                    download="clips.zip"
                    className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-5 py-2 rounded-xl transition-all border border-zinc-700 shadow-lg active:scale-95 font-medium"
                  >
                    <Download className="w-4 h-4" />
                    Download All (ZIP)
                  </a>
                )}
              </div>

              {clips.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {clips.map((clip, i) => (
                    <motion.div
                      key={clip}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className="group bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-blue-500/50 transition-all shadow-xl"
                    >
                      <div className="aspect-video bg-zinc-800 flex items-center justify-center relative">
                        <Video className="w-12 h-12 text-zinc-700 group-hover:scale-110 group-hover:text-blue-500/50 transition-all duration-500" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                           <a href={`/clips/${clip}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-white text-black text-xs font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-transform">
                             <Play className="w-3 h-3 fill-current" />
                             PREVIEW
                           </a>
                        </div>
                      </div>
                      <div className="p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate" title={clip}>{clip}</p>
                          <p className="text-[10px] text-zinc-500 font-mono mt-1 uppercase">MP4 • 4K ULTRA HD</p>
                        </div>
                        <a href={`/clips/${clip}`} download={clip} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-all">
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    </motion.div>
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
                <p className="text-zinc-400 text-sm mt-1">Everything you need to know to run the Clip Factory.</p>
              </div>

              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-400">1. Installation</h3>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl">
                  <p className="text-sm text-zinc-300 leading-relaxed mb-4">
                    Before running the script, ensure you have Node.js and FFMPEG installed on your machine.
                    The platform automatically handles dependencies when you run the project.
                  </p>
                  <pre className="bg-black p-4 rounded-xl text-xs font-mono text-emerald-500 overflow-x-auto">
                    npm install
                  </pre>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-400">2. Configuration</h3>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl">
                  <p className="text-sm text-zinc-300 leading-relaxed mb-4">
                    Set your Gemini API key as an environment variable to authenticate the file uploads and analysis.
                  </p>
                  <pre className="bg-black p-4 rounded-xl text-xs font-mono text-zinc-400 overflow-x-auto">
                    # Linux/macOS
                    export GOOGLE_API_KEY="your-api-key-here"

                    # Windows (Command Prompt)
                    set GOOGLE_API_KEY="your-api-key-here"
                  </pre>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-400">3. Execution</h3>
                <div className="bg-orange-500/10 border border-orange-500/20 p-5 rounded-xl mb-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-orange-300 leading-relaxed">
                    <strong>Note for Preview / Cloud:</strong> YouTube actively blocks automated requests from cloud IPs (like this preview). 
                    When running in this preview, the pipeline will fallback to generating blank mock videos to demonstrate the flow.
                    To process real YouTube videos, <strong className="text-white">export the project and run it locally</strong>.
                  </p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl">
                  <p className="text-sm text-zinc-300 leading-relaxed mb-4">
                    Run the factory from the root directory of this project. It will read <code className="text-blue-400">feed.txt</code> and begin the pipeline.
                  </p>
                  <pre className="bg-black p-4 rounded-xl text-xs font-mono text-blue-500 overflow-x-auto">
                    npx tsx clip_factory.ts
                  </pre>
                </div>
              </section>

              <div className="bg-blue-600/10 border border-blue-500/20 p-6 rounded-2xl flex gap-4 items-start">
                <Info className="w-6 h-6 text-blue-400 shrink-0" />
                <div className="text-sm text-blue-200">
                  <p className="font-bold mb-1">How it works:</p>
                  <p className="opacity-80">
                    The script downloads a tiny 144p version of the video to minimize upload time. 
                    Gemini 1.5 Flash then scans the video for your visual prompt. Once a timestamp is found, 
                    only that specific segment is downloaded in 4K resolution using native yt-dlp slicing.
                  </p>
                </div>
              </div>
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

