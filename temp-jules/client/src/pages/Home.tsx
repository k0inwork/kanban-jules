/**
 * Jules Chat — Main Layout
 * Design: Obsidian Dark Premium Dev Dashboard
 * Layout: Top API key bar + top Agent Chat / bottom Jules Sessions
 * Colors: Deep charcoal (#0f1117), indigo accent, emerald success
 * Fonts: Space Grotesk (headings), Inter (body), Fira Code (mono)
 */
import { useState } from 'react';
import { ApiKeyBar } from '@/components/ApiKeyBar';
import { SessionPanel } from '@/components/SessionPanel';
import { AgentChat } from '@/components/AgentChat';
import { LLMDebugPanel } from '@/components/LLMDebugPanel';
import { useJules } from '@/contexts/JulesContext';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Button } from '@/components/ui/button';
import { Braces, ChevronRight } from 'lucide-react';

export default function Home() {
  const { apiKey } = useJules();
  const [showDebug, setShowDebug] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden" style={{ backgroundImage: 'radial-gradient(ellipse at 20% 50%, oklch(0.62 0.22 264 / 4%) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, oklch(0.65 0.18 162 / 3%) 0%, transparent 50%)' }}>
      {/* Top bar: API key entry */}
      <ApiKeyBar />

      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">

        {/* Left pane: Agent Chat */}
        <Panel defaultSize={showDebug ? 30 : 40} minSize={25}>
          <div className="h-full flex flex-col bg-background border-r border-border">
            <AgentChat />
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-indigo-500/50 transition-colors" />

        {/* Middle pane: Session details */}
        <Panel defaultSize={showDebug ? 45 : 60} minSize={30}>
          <div className="h-full flex overflow-hidden relative">
            <main className="flex-1 overflow-hidden flex flex-col bg-background relative border-r border-border">
              <SessionPanel />
            </main>

            {/* Debug panel toggle button floating on the right edge of Session details */}
            {!showDebug && (
              <Button
                variant="outline"
                size="icon"
                className="absolute top-2 right-2 h-8 w-8 bg-background/80 backdrop-blur-sm border-border z-10 text-muted-foreground hover:text-indigo-400"
                onClick={() => setShowDebug(true)}
                title="Show LLM Debug Logs"
              >
                <Braces className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Panel>

        {/* Right pane: Debug Panel (collapsible) */}
        {showDebug && (
          <>
            <PanelResizeHandle className="w-1 bg-border hover:bg-indigo-500/50 transition-colors" />
            <Panel defaultSize={25} minSize={15} maxSize={40}>
              <div className="h-full relative bg-background">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8 z-10 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowDebug(false)}
                  title="Hide LLM Debug Logs"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <LLMDebugPanel />
              </div>
            </Panel>
          </>
        )}

      </PanelGroup>
    </div>
  );
}
