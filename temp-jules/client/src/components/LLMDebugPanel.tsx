import { useState, useRef, useEffect } from 'react';
import { useJules } from '@/contexts/JulesContext';
import { Button } from '@/components/ui/button';
import { Trash2, ChevronDown, ChevronRight, Braces } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/dateUtils';

function JsonViewer({ data, isExpandedDefault = false }: { data: any, isExpandedDefault?: boolean }) {
  const [expanded, setExpanded] = useState(isExpandedDefault);

  const getPreview = (obj: any) => {
    try {
      const str = JSON.stringify(obj);
      if (str.length > 50) return str.substring(0, 50) + '...';
      return str;
    } catch {
      return '{...}';
    }
  };

  return (
    <div className="mt-1 border border-border/50 rounded-md overflow-hidden bg-background/50 text-xs">
      <div
        className="flex items-center gap-2 p-1.5 cursor-pointer hover:bg-background transition-colors text-muted-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
        {!expanded && <span className="font-mono-code truncate">{getPreview(data)}</span>}
      </div>
      {expanded && (
        <pre className="p-2 overflow-x-auto text-[10px] font-mono-code text-indigo-200 border-t border-border/50 whitespace-pre-wrap break-words">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function LLMDebugPanel() {
  const { llmPayloads, clearLlmPayloads } = useJules();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [llmPayloads.length]);

  return (
    <div className="flex flex-col h-full bg-background border-l border-border flex-shrink-0 relative">
      <div className="flex-shrink-0 border-b border-border p-3 flex items-center justify-between bg-card/50 h-14">
        <div className="flex items-center gap-2 text-foreground font-medium text-sm">
          <Braces className="w-4 h-4 text-indigo-400" />
          LLM Debug Payload Logs
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-red-400"
            onClick={clearLlmPayloads}
            title="Clear logs"
            disabled={llmPayloads.length === 0}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {llmPayloads.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground mt-10">
            No LLM interactions recorded yet.
          </div>
        ) : (
          llmPayloads.map((payload) => (
            <div key={payload.id} className="border border-border rounded-lg bg-card/30 overflow-hidden text-sm">
              <div className="bg-card/80 p-2 border-b border-border flex justify-between items-center text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-wider text-[10px] text-indigo-300">
                  {payload.provider}
                </span>
                <span>{formatDateTime(payload.timestamp.toISOString())}</span>
              </div>
              <div className="p-2 space-y-2">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Request</span>
                  <JsonViewer data={payload.request} />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Response</span>
                  <JsonViewer data={payload.response} />
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
