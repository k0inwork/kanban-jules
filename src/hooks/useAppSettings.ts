import { useState, useEffect } from 'react';
import { AutonomyMode } from '../types';
import { HostConfig } from '../core/types';

export function useAppSettings() {
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>(() => (localStorage.getItem('autonomyMode') as AutonomyMode) || 'assisted');
  
  // Jules Settings
  const [julesEndpoint, setJulesEndpoint] = useState(() => localStorage.getItem('julesEndpoint') || '/api/mcp/execute');
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repoUrl') || '');
  const [repoBranch, setRepoBranch] = useState(() => localStorage.getItem('repoBranch') || 'main');
  const [julesSourceName, setJulesSourceName] = useState(() => localStorage.getItem('julesSourceName') || '');
  const [julesSourceId, setJulesSourceId] = useState(() => localStorage.getItem('julesSourceId') || '');
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('geminiApiKey') || process.env.GEMINI_API_KEY || '');
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('githubToken') || import.meta.env.VITE_GITHUB_TOKEN || '');

  // LLM Settings
  const [apiProvider, setApiProvider] = useState(() => localStorage.getItem('apiProvider') || 'gemini');
  const [geminiModel, setGeminiModel] = useState(() => localStorage.getItem('geminiModel') || 'gemini-3-flash-preview');
  const [openaiUrl, setOpenaiUrl] = useState(() => localStorage.getItem('openaiUrl') || 'https://api.openai.com/v1');
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('openaiKey') || '');
  const [openaiModel, setOpenaiModel] = useState(() => localStorage.getItem('openaiModel') || 'gpt-4o');
  const [moduleConfigs, setModuleConfigs] = useState<Record<string, any>>(() => {
    const saved = localStorage.getItem('moduleConfigs');
    return saved ? JSON.parse(saved) : {};
  });

  const saveSettings = (config: HostConfig) => {
    setJulesEndpoint(config.julesEndpoint);
    setRepoUrl(config.repoUrl);
    setRepoBranch(config.repoBranch);
    setJulesSourceName(config.julesSourceName);
    setJulesSourceId(config.julesSourceId);
    setApiProvider(config.apiProvider);
    setGeminiApiKey(config.geminiApiKey);
    setGeminiModel(config.geminiModel);
    setGithubToken(config.githubToken);
    setOpenaiUrl(config.openaiUrl);
    setOpenaiKey(config.openaiKey);
    setOpenaiModel(config.openaiModel);
    setModuleConfigs(config.moduleConfigs);

    localStorage.setItem('julesEndpoint', config.julesEndpoint);
    localStorage.setItem('repoUrl', config.repoUrl);
    localStorage.setItem('repoBranch', config.repoBranch);
    localStorage.setItem('julesSourceName', config.julesSourceName);
    localStorage.setItem('julesSourceId', config.julesSourceId);
    localStorage.setItem('apiProvider', config.apiProvider);
    localStorage.setItem('geminiApiKey', config.geminiApiKey);
    localStorage.setItem('geminiModel', config.geminiModel);
    localStorage.setItem('githubToken', config.githubToken);
    localStorage.setItem('openaiUrl', config.openaiUrl);
    localStorage.setItem('openaiKey', config.openaiKey);
    localStorage.setItem('openaiModel', config.openaiModel);
    localStorage.setItem('moduleConfigs', JSON.stringify(config.moduleConfigs));
  };

  const updateAutonomyMode = (mode: AutonomyMode) => {
    setAutonomyMode(mode);
    localStorage.setItem('autonomyMode', mode);
  };

  const hostConfig: HostConfig = {
    julesEndpoint,
    repoUrl,
    repoBranch,
    julesSourceName,
    julesSourceId,
    geminiApiKey,
    geminiModel,
    githubToken,
    apiProvider,
    openaiUrl,
    openaiKey,
    openaiModel,
    moduleConfigs
  };

  return {
    autonomyMode,
    updateAutonomyMode,
    hostConfig,
    saveSettings,
    settings: {
      julesEndpoint,
      repoUrl,
      repoBranch,
      julesSourceName,
      julesSourceId,
      geminiApiKey,
      githubToken,
      apiProvider,
      geminiModel,
      openaiUrl,
      openaiKey,
      openaiModel,
      moduleConfigs
    }
  };
}
