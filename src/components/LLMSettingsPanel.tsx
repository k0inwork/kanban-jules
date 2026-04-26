import React, { useState, useEffect } from 'react';
import { Download, Cpu, Globe, Wifi, WifiOff, Loader2, CheckCircle2, XCircle, Trash2, BarChart3 } from 'lucide-react';
import { cn } from '../lib/utils';
import { webllmRuntime, AVAILABLE_MODELS, WebLLMStatus } from '../core/webllm-runtime';
import { llmRouter } from '../core/llm-router';
import { getShadowStats } from '../core/paw-shadow';

export default function LLMSettingsPanel() {
  const [webllmStatus, setWebllmStatus] = useState<WebLLMStatus>(webllmRuntime.status);
  const [webllmProgress, setWebllmProgress] = useState(webllmRuntime.progress);
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  const [stats, setStats] = useState(llmRouter.getStats());
  const [shadowStats, setShadowStats] = useState<Record<string, { total: number; agreementRate: number }>>({});
  const [webgpuAvailable] = useState(
    typeof navigator !== 'undefined' && 'gpu' in navigator
  );

  useEffect(() => {
    const unsub = webllmRuntime.onStatusChange((status, progress) => {
      setWebllmStatus(status);
      setWebllmProgress(progress);
    });
    return unsub;
  }, []);

  // Refresh stats periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(llmRouter.getStats());
      loadShadowStats();
    }, 5000);
    loadShadowStats();
    return () => clearInterval(interval);
  }, []);

  const loadShadowStats = async () => {
    const programs = ['signal-noise', 'dynamic-call'];
    const results: Record<string, { total: number; agreementRate: number }> = {};
    for (const p of programs) {
      try {
        const s = await getShadowStats(p);
        if (s.total > 0) results[p] = { total: s.total, agreementRate: s.agreementRate };
      } catch {}
    }
    setShadowStats(results);
  };

  const handleLoadModel = async () => {
    await webllmRuntime.loadModel(selectedModel);
  };

  const handleUnloadModel = async () => {
    await webllmRuntime.unload();
  };

  const statusIcon = (status: WebLLMStatus) => {
    switch (status) {
      case 'ready': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />;
      case 'downloading':
      case 'loading': return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      default: return <WifiOff className="w-4 h-4 text-neutral-600" />;
    }
  };

  const statusLabel = (status: WebLLMStatus) => {
    switch (status) {
      case 'ready': return 'Ready';
      case 'error': return 'Error';
      case 'downloading': return `Downloading (${webllmProgress}%)`;
      case 'loading': return 'Loading...';
      default: return 'Not loaded';
    }
  };

  return (
    <div className="p-4 space-y-5 overflow-y-auto custom-scrollbar">
      {/* Tier Status Overview */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-neutral-300 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          LLM Tier Status
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <TierCard
            icon={<Cpu className="w-3.5 h-3.5" />}
            name="Static"
            subtitle="PAW"
            status={stats.static > 0 ? 'active' : 'standby'}
            calls={stats.static}
          />
          <TierCard
            icon={<Globe className="w-3.5 h-3.5" />}
            name="Dynamic"
            subtitle="WebLLM"
            status={webllmRuntime.ready ? 'active' : 'standby'}
            calls={stats.dynamic}
          />
          <TierCard
            icon={<Wifi className="w-3.5 h-3.5" />}
            name="Global"
            subtitle="API"
            status="active"
            calls={stats.global}
          />
        </div>
        {stats.escalated > 0 && (
          <p className="text-[10px] text-yellow-500">
            {stats.escalated} calls escalated to higher tier (missing runtime)
          </p>
        )}
      </div>

      {/* WebLLM Section */}
      <div className="space-y-3 border-t border-neutral-800 pt-4">
        <h3 className="text-sm font-medium text-neutral-300 flex items-center gap-2">
          <Globe className="w-4 h-4" />
          WebLLM (Local Inference)
        </h3>

        {!webgpuAvailable ? (
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-xs text-yellow-400">WebGPU is not available in this browser. WebLLM requires Chrome 113+ or Edge 113+.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {statusIcon(webllmStatus)}
                  <span className="text-xs font-medium text-neutral-200">{statusLabel(webllmStatus)}</span>
                </div>
                {webllmRuntime.modelId && (
                  <span className="text-[9px] font-mono text-neutral-500">{webllmRuntime.modelId}</span>
                )}
              </div>

              {(webllmStatus === 'downloading' || webllmStatus === 'loading') && (
                <div className="w-full bg-neutral-800 rounded-full h-1.5 mt-2">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${webllmProgress}%` }}
                  />
                </div>
              )}

              {webllmRuntime.errorMessage && (
                <p className="text-[10px] text-red-400 mt-2">{webllmRuntime.errorMessage}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={webllmStatus === 'downloading' || webllmStatus === 'loading'}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-xs text-neutral-100 focus:outline-none focus:border-blue-500"
              >
                {AVAILABLE_MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.size})</option>
                ))}
              </select>

              {webllmRuntime.ready ? (
                <button
                  onClick={handleUnloadModel}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-medium bg-red-600/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-600/30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Unload
                </button>
              ) : (
                <button
                  onClick={handleLoadModel}
                  disabled={webllmStatus === 'downloading' || webllmStatus === 'loading'}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-3.5 h-3.5" />
                  {webllmStatus === 'unavailable' ? 'Download & Load' : 'Loading...'}
                </button>
              )}
            </div>

            <p className="text-[10px] text-neutral-500">
              Models are cached in the browser. After initial download, subsequent loads take ~3s.
            </p>
          </div>
        )}
      </div>

      {/* Shadow Mode Stats */}
      <div className="space-y-3 border-t border-neutral-800 pt-4">
        <h3 className="text-sm font-medium text-neutral-300">Shadow Mode (PAW vs API)</h3>
        <p className="text-[10px] text-neutral-500">
          When a local tier is active, the API is also called in the background to compare accuracy.
        </p>
        {Object.keys(shadowStats).length === 0 ? (
          <p className="text-[10px] text-neutral-600">No shadow data yet. Will appear once local runtimes are active.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(shadowStats).map(([programId, s]) => (
              <div key={programId} className="flex items-center justify-between p-2 bg-neutral-950 border border-neutral-800 rounded">
                <span className="text-[10px] font-mono text-neutral-300">{programId}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-neutral-500">{s.total} samples</span>
                  <span className={cn(
                    "text-[10px] font-medium",
                    s.agreementRate >= 0.95 ? "text-emerald-400" :
                    s.agreementRate >= 0.8 ? "text-yellow-400" :
                    "text-red-400"
                  )}>
                    {(s.agreementRate * 100).toFixed(0)}% agree
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PAW Programs */}
      <div className="space-y-3 border-t border-neutral-800 pt-4">
        <h3 className="text-sm font-medium text-neutral-300 flex items-center gap-2">
          <Cpu className="w-4 h-4" />
          PAW Programs (Static Tier)
        </h3>
        <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
          <div className="text-[10px] font-mono text-neutral-400 mb-1">signal-noise</div>
          <div className="text-[10px] text-neutral-500">Classifies Jules agent messages as SIGNAL or NOISE. Not yet compiled.</div>
        </div>
      </div>
    </div>
  );
}

function TierCard({ icon, name, subtitle, status, calls }: {
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  status: 'active' | 'standby';
  calls: number;
}) {
  return (
    <div className={cn(
      "p-2.5 rounded-lg border text-center",
      status === 'active'
        ? "bg-neutral-950 border-neutral-700"
        : "bg-neutral-950 border-neutral-850 opacity-50"
    )}>
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs font-medium text-neutral-200">{name}</span>
      </div>
      <div className="text-[9px] text-neutral-500">{subtitle}</div>
      <div className={cn(
        "text-[10px] font-mono mt-1",
        status === 'active' ? "text-blue-400" : "text-neutral-600"
      )}>
        {calls} calls
      </div>
    </div>
  );
}
