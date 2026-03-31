import { ExternalLink } from 'lucide-react';
import { useJules } from '@/contexts/JulesContext';
import { SettingsModal } from './SettingsModal';

export function ApiKeyBar() {
  const { aiProvider, setAiProvider, geminiModel, setGeminiModel, zaiModel, setZaiModel } = useJules();

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur-sm" style={{ boxShadow: '0 1px 0 oklch(1 0 0 / 4%)' }}>
      {/* Logo / Brand */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
          <span className="text-indigo-400 font-display font-bold text-sm">J</span>
        </div>
        <span className="font-display font-semibold text-sm text-foreground hidden sm:block">Jules Chat</span>
      </div>

      <div className="w-px h-5 bg-border flex-shrink-0" />

      {/* Model Selection */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <select
          value={aiProvider}
          onChange={(e) => setAiProvider(e.target.value as 'gemini' | 'zai')}
          className="h-7 text-xs font-medium bg-background border-border/60 rounded-md px-2 focus:border-indigo-500/60 focus:ring-indigo-500/20"
        >
          <option value="gemini">Gemini</option>
          <option value="zai">z.ai</option>
        </select>

        {aiProvider === 'gemini' ? (
          <select
            value={geminiModel}
            onChange={(e) => setGeminiModel(e.target.value)}
            className="h-7 text-xs font-medium bg-background border-border/60 rounded-md px-2 focus:border-indigo-500/60 focus:ring-indigo-500/20"
          >
            <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
            <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
            <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
          </select>
        ) : (
          <select
            value={zaiModel}
            onChange={(e) => setZaiModel(e.target.value)}
            className="h-7 text-xs font-medium bg-background border-border/60 rounded-md px-2 focus:border-indigo-500/60 focus:ring-indigo-500/20"
          >
            <option value="glm-5">glm-5</option>
            <option value="glm-4.7">glm-4.7</option>
          </select>
        )}
      </div>

      <div className="w-px h-5 bg-border flex-shrink-0" />

      {/* Settings Modal */}
      <div className="flex items-center gap-2">
        <a
          href="https://jules.google.com/settings"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-indigo-400 transition-colors flex-shrink-0 hidden md:flex mr-2"
        >
          Get Jules key
          <ExternalLink className="w-3 h-3" />
        </a>
        <SettingsModal />
      </div>
    </div>
  );
}
