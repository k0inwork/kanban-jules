import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw, Plus } from 'lucide-react';
import { julesApi, Source } from '../lib/julesApi';
import { cn } from '../lib/utils';

import { registry } from '../core/registry';
import { HostConfig, ModuleManifest } from '../core/types';

import { useSettings } from '../contexts/SettingsContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ 
  isOpen, onClose
}: SettingsModalProps) {
  const { settings: initialSettings, saveSettings } = useSettings();
  
  const [endpoint, setEndpoint] = useState(initialSettings.julesEndpoint);
  const [repoUrl, setRepoUrl] = useState(initialSettings.repoUrl);
  const [branch, setBranch] = useState(initialSettings.repoBranch);
  const [sourceName, setSourceName] = useState(initialSettings.julesSourceName);
  const [sourceId, setSourceId] = useState(initialSettings.julesSourceId);
  
  const [apiProvider, setApiProvider] = useState(initialSettings.apiProvider);
  const [geminiModel, setGeminiModel] = useState(initialSettings.geminiModel);
  const [openaiName, setOpenaiName] = useState(initialSettings.openaiName);
  const [openaiUrl, setOpenaiUrl] = useState(initialSettings.openaiUrl);
  const [openaiKey, setOpenaiKey] = useState(initialSettings.openaiKey);
  const [openaiModel, setOpenaiModel] = useState(initialSettings.openaiModel);
  const [openaiProviders, setOpenaiProviders] = useState<any[]>(initialSettings.openaiProviders || []);
  const [geminiApiKey, setGeminiApiKey] = useState(initialSettings.geminiApiKey);
  const [githubToken, setGithubToken] = useState(initialSettings.githubToken);
  const [moduleConfigs, setModuleConfigs] = useState<Record<string, any>>(initialSettings.moduleConfigs);
  
  const [activeTab, setActiveTab] = useState<'general' | 'modules'>('general');
  const [sources, setSources] = useState<Source[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [error, setError] = useState('');

  const julesApiKey = moduleConfigs['executor-jules']?.julesApiKey;

  useEffect(() => {
    if (isOpen) {
      setEndpoint(initialSettings.julesEndpoint);
      setRepoUrl(initialSettings.repoUrl);
      setBranch(initialSettings.repoBranch);
      setSourceName(initialSettings.julesSourceName);
      setSourceId(initialSettings.julesSourceId);
      setApiProvider(initialSettings.apiProvider);
      setGeminiModel(initialSettings.geminiModel);
      setOpenaiName(initialSettings.openaiName);
      setOpenaiUrl(initialSettings.openaiUrl);
      setOpenaiKey(initialSettings.openaiKey);
      setOpenaiModel(initialSettings.openaiModel);
      setOpenaiProviders(initialSettings.openaiProviders || []);
      setGeminiApiKey(initialSettings.geminiApiKey);
      setGithubToken(initialSettings.githubToken);
      setModuleConfigs(initialSettings.moduleConfigs);
    }
  }, [isOpen, initialSettings]);

  useEffect(() => {
    if (isOpen && julesApiKey) {
      fetchSources();
    }
  }, [isOpen, julesApiKey]);

  const fetchSources = async () => {
    if (!julesApiKey) return;
    setIsLoadingSources(true);
    setError('');
    try {
      const res = await julesApi.listSources(julesApiKey);
      setSources(res.sources || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sources');
      console.error(err);
    } finally {
      setIsLoadingSources(false);
    }
  };

  const handleModuleConfigChange = (moduleId: string, fieldKey: string, value: any) => {
    setModuleConfigs(prev => ({
      ...prev,
      [moduleId]: {
        ...(prev[moduleId] || {}),
        [fieldKey]: value
      }
    }));
  };

  if (!isOpen) return null;

  const hasChanges = 
    endpoint !== initialSettings.julesEndpoint ||
    repoUrl !== initialSettings.repoUrl ||
    branch !== initialSettings.repoBranch ||
    sourceName !== initialSettings.julesSourceName ||
    sourceId !== initialSettings.julesSourceId ||
    apiProvider !== initialSettings.apiProvider ||
    geminiModel !== initialSettings.geminiModel ||
    openaiName !== initialSettings.openaiName ||
    openaiUrl !== initialSettings.openaiUrl ||
    openaiKey !== initialSettings.openaiKey ||
    openaiModel !== initialSettings.openaiModel ||
    geminiApiKey !== initialSettings.geminiApiKey ||
    githubToken !== initialSettings.githubToken ||
    JSON.stringify(openaiProviders) !== JSON.stringify(initialSettings.openaiProviders || []) ||
    JSON.stringify(moduleConfigs) !== JSON.stringify(initialSettings.moduleConfigs);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSettings({
      julesEndpoint: endpoint,
      repoUrl,
      repoBranch: branch,
      julesSourceName: sourceName,
      julesSourceId: sourceId,
      apiProvider,
      geminiModel,
      openaiName,
      openaiUrl,
      openaiKey,
      openaiModel,
      openaiProviders,
      geminiApiKey,
      githubToken,
      moduleConfigs
    } as any);
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
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setActiveTab('general')}
              className={cn(
                "text-sm font-semibold font-mono transition-colors",
                activeTab === 'general' ? "text-blue-400" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              General Settings
            </button>
            <button 
              onClick={() => setActiveTab('modules')}
              className={cn(
                "text-sm font-semibold font-mono transition-colors",
                activeTab === 'modules' ? "text-blue-400" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              Modules
            </button>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {activeTab === 'general' ? (
          <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
            <div className="space-y-4 pb-4 border-b border-neutral-800">
              <h3 className="text-sm font-medium text-neutral-300">LLM Configuration</h3>
              
              <div>
                <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">API Provider</label>
                <div className="flex flex-col space-y-2">
                  <select
                    value={apiProvider}
                    onChange={(e) => setApiProvider(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  >
                    <option value="gemini">Gemini</option>
                    <optgroup label="OpenAI Compatible">
                      {openaiProviders.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                      <option value="openai-legacy">{openaiName || 'Legacy OpenAI'}</option>
                    </optgroup>
                  </select>
                </div>
              </div>

              {apiProvider === 'gemini' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Gemini API Key</label>
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      placeholder="AIza..."
                    />
                  </div>
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
                </div>
              ) : apiProvider === 'openai-legacy' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Provider Name</label>
                    <input
                      type="text"
                      value={openaiName}
                      onChange={(e) => setOpenaiName(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      placeholder="e.g. My OpenAI"
                    />
                  </div>
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
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const provider = openaiProviders.find(p => p.id === apiProvider);
                    if (!provider) return <div className="text-xs text-red-400">Provider not found</div>;
                    return (
                      <>
                        <div>
                          <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Provider Name</label>
                          <input
                            type="text"
                            value={provider.name}
                            onChange={(e) => {
                              const newProviders = openaiProviders.map(p => p.id === provider.id ? { ...p, name: e.target.value } : p);
                              setOpenaiProviders(newProviders);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Base URL</label>
                          <input
                            type="text"
                            value={provider.baseUrl}
                            onChange={(e) => {
                              const newProviders = openaiProviders.map(p => p.id === provider.id ? { ...p, baseUrl: e.target.value } : p);
                              setOpenaiProviders(newProviders);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">API Key</label>
                          <input
                            type="password"
                            value={provider.apiKey}
                            onChange={(e) => {
                              const newProviders = openaiProviders.map(p => p.id === provider.id ? { ...p, apiKey: e.target.value } : p);
                              setOpenaiProviders(newProviders);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Model Name</label>
                          <input
                            type="text"
                            value={provider.model}
                            onChange={(e) => {
                              const newProviders = openaiProviders.map(p => p.id === provider.id ? { ...p, model: e.target.value } : p);
                              setOpenaiProviders(newProviders);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              const newProviders = openaiProviders.filter(p => p.id !== provider.id);
                              setOpenaiProviders(newProviders);
                              setApiProvider('gemini');
                            }}
                            className="text-[10px] text-red-400 hover:text-red-300 underline"
                          >
                            Remove Provider
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = `provider-${Date.now()}`;
                    const newProvider = {
                      id,
                      name: `Custom Provider ${openaiProviders.length + 1}`,
                      baseUrl: 'https://api.openai.com/v1',
                      apiKey: '',
                      model: 'gpt-4o'
                    };
                    setOpenaiProviders([...openaiProviders, newProvider]);
                    setApiProvider(id);
                  }}
                  className="w-full py-2 border border-dashed border-neutral-700 rounded-md text-xs text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-all flex items-center justify-center"
                >
                  <Plus className="w-3 h-3 mr-2" />
                  Add OpenAI Compatible Provider
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-neutral-300">Target Repository</h3>
                <button 
                  type="button" 
                  onClick={fetchSources} 
                  disabled={!julesApiKey || isLoadingSources}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${isLoadingSources ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              
              {error && <div className="text-xs text-red-400 bg-red-400/10 p-2 rounded">{error}</div>}

              <div>
                <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">GitHub Token (Required for Writes & Workflows)</label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  placeholder="ghp_..."
                />
                <p className="text-[10px] text-neutral-500 mt-1">Personal Access Token with 'repo' and 'workflow' scopes.</p>
              </div>

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
                  <option key="default-source" value="">Select a source...</option>
                  {isLoadingSources && <option key="loading-sources" value="" disabled>Loading sources...</option>}
                  {sources.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.githubRepo ? `${s.githubRepo.owner}/${s.githubRepo.repo}` : s.name}
                    </option>
                  ))}
                </select>
                {sources.length === 0 && !isLoadingSources && julesApiKey && (
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
                  <option key="default-branch" value="">Select a branch...</option>
                  {branches.map(b => (
                    <option key={b.displayName} value={b.displayName}>
                      {b.displayName}
                    </option>
                  ))}
                  {!selectedSource && branch && (
                    <option key="manual-branch" value={branch}>{branch}</option>
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
                disabled={!hasChanges}
                className={cn(
                  "flex items-center px-4 py-2 text-sm font-medium rounded-md transition-all duration-200",
                  hasChanges 
                    ? "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20" 
                    : "bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700"
                )}
              >
                <Save className="w-4 h-4 mr-2" />
                {hasChanges ? "Save Changes" : "No Changes"}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-4 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Registered Modules</h3>
              <div className="flex items-center space-x-2">
                <input 
                  type="text" 
                  placeholder="Module URL (Coming Soon)" 
                  disabled
                  className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-1 text-[10px] text-neutral-500 w-32 cursor-not-allowed"
                />
                <button disabled className="p-1 text-neutral-600 cursor-not-allowed">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
              {registry.getAll().map(module => (
                <div key={module.id} className={cn(
                  "bg-neutral-950 border rounded-lg p-3 transition-colors",
                  module.enabled !== false ? "border-neutral-800 hover:border-neutral-700" : "border-neutral-900 opacity-60"
                )}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          registry.setEnabled(module.id, module.enabled === false);
                          // Force re-render
                          setActiveTab('general');
                          setTimeout(() => setActiveTab('modules'), 0);
                        }}
                        className={cn(
                          "w-8 h-4 rounded-full transition-colors relative",
                          module.enabled !== false ? "bg-blue-600" : "bg-neutral-700"
                        )}
                      >
                        <div className={cn(
                          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                          module.enabled !== false ? "left-4.5" : "left-0.5"
                        )} />
                      </button>
                      <span className="text-xs font-bold text-neutral-100">{module.name}</span>
                      <span className="text-[10px] font-mono text-neutral-500">v{module.version}</span>
                    </div>
                    <span className={cn(
                      "text-[9px] font-mono px-1.5 py-0.5 rounded border",
                      module.type === 'executor' ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                      module.type === 'knowledge' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                      module.type === 'channel' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                      "bg-neutral-500/10 text-neutral-400 border-neutral-500/20"
                    )}>
                      {module.type.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mb-3 leading-relaxed">
                    {module.description}
                  </p>
                  
                  <div className="space-y-4">
                    {module.permissions && module.permissions.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">Permissions</div>
                        <div className="flex flex-wrap gap-1">
                          {module.permissions.map(p => (
                            <span key={p} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {module.configFields && module.configFields.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">Configuration</div>
                        <div className="space-y-3">
                          {module.configFields.map(field => (
                            <div key={field.key}>
                              <label className="block text-[9px] font-mono text-neutral-400 mb-1 uppercase">
                                {field.label || field.key}
                              </label>
                              {field.type === 'boolean' ? (
                                <button
                                  type="button"
                                  onClick={() => handleModuleConfigChange(module.id, field.key, !moduleConfigs[module.id]?.[field.key])}
                                  className={cn(
                                    "w-8 h-4 rounded-full transition-colors relative",
                                    moduleConfigs[module.id]?.[field.key] ? "bg-blue-600" : "bg-neutral-700"
                                  )}
                                >
                                  <div className={cn(
                                    "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                                    moduleConfigs[module.id]?.[field.key] ? "left-4.5" : "left-0.5"
                                  )} />
                                </button>
                              ) : field.type === 'select' ? (
                                <select
                                  value={moduleConfigs[module.id]?.[field.key] ?? field.default ?? ''}
                                  onChange={(e) => handleModuleConfigChange(module.id, field.key, e.target.value)}
                                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[10px] text-neutral-100 focus:outline-none focus:border-blue-500"
                                >
                                  <option key="default-select" value="">Select...</option>
                                  {field.options?.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={field.secret ? 'password' : (field.type === 'number' ? 'number' : 'text')}
                                  value={moduleConfigs[module.id]?.[field.key] ?? field.default ?? ''}
                                  onChange={(e) => handleModuleConfigChange(module.id, field.key, field.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[10px] text-neutral-100 focus:outline-none focus:border-blue-500"
                                  placeholder={field.description}
                                />
                              )}
                              {field.description && (
                                <p className="text-[9px] text-neutral-500 mt-0.5">{field.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">Available Tools</div>
                      <div className="grid grid-cols-1 gap-1.5">
                        {module.tools.map(tool => (
                          <div key={tool.name} className="flex flex-col p-1.5 bg-neutral-900 rounded border border-neutral-800/50">
                            <div className="text-[10px] font-mono text-blue-400 font-bold">{tool.name.split('.').pop()}</div>
                            <div className="text-[9px] text-neutral-500 italic">{tool.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-4 pt-4 border-t border-neutral-800 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium bg-neutral-800 text-neutral-100 rounded-md hover:bg-neutral-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
