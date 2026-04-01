import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw } from 'lucide-react';
import { julesApi, Source } from '../lib/julesApi';
import { cn } from '../lib/utils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    endpoint: string, 
    apiKey: string, 
    repoUrl: string, 
    branch: string, 
    sourceName: string, 
    sourceId: string,
    apiProvider: string,
    geminiModel: string,
    openaiUrl: string,
    openaiKey: string,
    openaiModel: string
  ) => void;
  initialEndpoint: string;
  initialApiKey: string;
  initialRepoUrl: string;
  initialBranch: string;
  initialSourceName: string;
  initialSourceId: string;
  initialApiProvider: string;
  initialGeminiModel: string;
  initialOpenaiUrl: string;
  initialOpenaiKey: string;
  initialOpenaiModel: string;
}

export default function SettingsModal({ 
  isOpen, onClose, onSave, 
  initialEndpoint, initialApiKey, initialRepoUrl, initialBranch, initialSourceName, initialSourceId,
  initialApiProvider, initialGeminiModel, initialOpenaiUrl, initialOpenaiKey, initialOpenaiModel
}: SettingsModalProps) {
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl);
  const [branch, setBranch] = useState(initialBranch);
  const [sourceName, setSourceName] = useState(initialSourceName);
  const [sourceId, setSourceId] = useState(initialSourceId);
  
  const [apiProvider, setApiProvider] = useState(initialApiProvider);
  const [geminiModel, setGeminiModel] = useState(initialGeminiModel);
  const [openaiUrl, setOpenaiUrl] = useState(initialOpenaiUrl);
  const [openaiKey, setOpenaiKey] = useState(initialOpenaiKey);
  const [openaiModel, setOpenaiModel] = useState(initialOpenaiModel);
  
  const [sources, setSources] = useState<Source[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setEndpoint(initialEndpoint);
      setApiKey(initialApiKey);
      setRepoUrl(initialRepoUrl);
      setBranch(initialBranch);
      setSourceName(initialSourceName);
      setSourceId(initialSourceId);
      setApiProvider(initialApiProvider);
      setGeminiModel(initialGeminiModel);
      setOpenaiUrl(initialOpenaiUrl);
      setOpenaiKey(initialOpenaiKey);
      setOpenaiModel(initialOpenaiModel);
    }
  }, [
    isOpen, initialEndpoint, initialApiKey, initialRepoUrl, initialBranch, initialSourceName, initialSourceId,
    initialApiProvider, initialGeminiModel, initialOpenaiUrl, initialOpenaiKey, initialOpenaiModel
  ]);

  useEffect(() => {
    if (isOpen && apiKey) {
      fetchSources();
    }
  }, [isOpen, apiKey]);

  const fetchSources = async () => {
    if (!apiKey) return;
    setIsLoadingSources(true);
    setError('');
    try {
      const res = await julesApi.listSources(apiKey);
      setSources(res.sources || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sources');
      console.error(err);
    } finally {
      setIsLoadingSources(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(
      endpoint, apiKey, repoUrl, branch, sourceName, sourceId,
      apiProvider, geminiModel, openaiUrl, openaiKey, openaiModel
    );
    onClose();
  };

  const selectedSource = sources.find(s => 
    s.name === sourceName || 
    s.name === repoUrl || 
    (s.githubRepo && `${s.githubRepo.owner}/${s.githubRepo.repo}` === repoUrl)
  );
  const branches = selectedSource?.githubRepo?.branches || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 shrink-0">
          <h2 className="text-lg font-semibold text-neutral-100 font-mono">Jules API Settings</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
          <div className="space-y-4 pb-4 border-b border-neutral-800">
            <h3 className="text-sm font-medium text-neutral-300">LLM Configuration</h3>
            
            <div>
              <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">API Provider</label>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setApiProvider('gemini')}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium rounded-md border transition-all",
                    apiProvider === 'gemini' 
                      ? "bg-blue-600 border-blue-500 text-white" 
                      : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700"
                  )}
                >
                  Gemini
                </button>
                <button
                  type="button"
                  onClick={() => setApiProvider('openai')}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium rounded-md border transition-all",
                    apiProvider === 'openai' 
                      ? "bg-blue-600 border-blue-500 text-white" 
                      : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700"
                  )}
                >
                  OpenAI Compatible
                </button>
              </div>
            </div>

            {apiProvider === 'gemini' ? (
              <div>
                <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Gemini Model</label>
                <select
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                >
                  <option value="gemini-3.1-flash-preview">Gemini 3.1 Flash</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                  <option value="gemini-3-flash-preview">Gemini 3.0 Flash</option>
                </select>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Base URL</label>
                  <input
                    type="text"
                    value={openaiUrl}
                    onChange={(e) => setOpenaiUrl(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">API Key</label>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    placeholder="sk-..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Model Name</label>
                  <input
                    type="text"
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    placeholder="gpt-4o"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 pb-4 border-b border-neutral-800">
            <h3 className="text-sm font-medium text-neutral-300">Jules API Configuration</h3>
            <div>
              <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Jules API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                placeholder="AIzaSy..."
              />
              <p className="text-[10px] text-neutral-500 mt-1">Your Google Jules API key.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-neutral-300">Target Repository</h3>
              <button 
                type="button" 
                onClick={fetchSources} 
                disabled={!apiKey || isLoadingSources}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 mr-1 ${isLoadingSources ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
            
            {error && <div className="text-xs text-red-400 bg-red-400/10 p-2 rounded">{error}</div>}

            <div>
              <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Source (Repository)</label>
              <div className="mb-2 p-2 bg-neutral-950 border border-neutral-800 rounded text-xs font-mono text-blue-400 truncate">
                {sourceName || repoUrl || 'No source selected'}
              </div>
              <select
                value={sourceId || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const selected = sources.find(s => s.id === val);
                  if (selected) {
                    setSourceName(selected.name);
                    setSourceId(selected.id);
                    const repoIdentifier = selected.githubRepo ? `${selected.githubRepo.owner}/${selected.githubRepo.repo}` : selected.name;
                    setRepoUrl(repoIdentifier);
                    if (selected.githubRepo?.defaultBranch?.displayName) {
                      setBranch(selected.githubRepo.defaultBranch.displayName);
                    } else {
                      setBranch('');
                    }
                  } else {
                    setSourceName('');
                    setSourceId('');
                    setRepoUrl(val);
                  }
                }}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                disabled={isLoadingSources}
              >
                <option value="">Select a source...</option>
                {isLoadingSources && <option value="" disabled>Loading sources...</option>}
                {sources.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.githubRepo ? `${s.githubRepo.owner}/${s.githubRepo.repo}` : s.name}
                  </option>
                ))}
              </select>
              {sources.length === 0 && !isLoadingSources && apiKey && (
                <p className="text-[10px] text-yellow-500 mt-1">No sources found. Click refresh.</p>
              )}
            </div>
            
            <div>
              <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Branch</label>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                disabled={!repoUrl || (branches.length === 0 && !isLoadingSources)}
              >
                <option value="">Select a branch...</option>
                {branches.map(b => (
                  <option key={b.displayName} value={b.displayName}>
                    {b.displayName}
                  </option>
                ))}
                {!selectedSource && branch && (
                  <option value={branch}>{branch}</option>
                )}
              </select>
            </div>
          </div>
          
          <div className="pt-4 flex justify-end space-x-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-500 transition-colors"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
