import { useState } from 'react';
import { Loader2, X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useJules } from '@/contexts/JulesContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  onClose: () => void;
}

export function NewSessionDialog({ onClose }: Props) {
  const { createSession, selectSession, sources } = useJules();
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [requireApproval, setRequireApproval] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedSourceObj = sources.find((s) => s.name === selectedSource);
  const branches = selectedSourceObj?.githubRepo?.branches || [];

  const handleCreate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const sourceCtx =
        selectedSource && selectedBranch
          ? { source: selectedSource, branch: selectedBranch }
          : undefined;
      const session = await createSession(prompt.trim(), title.trim() || undefined, sourceCtx, requireApproval);
      selectSession(session.id);
      toast.success('Session created successfully');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl shadow-black/50 animate-fade-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-display font-semibold text-foreground">New Session</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Start a new Jules coding task</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Prompt */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Task prompt <span className="text-red-400">*</span>
            </label>
            <Textarea
              placeholder="Describe what you want Jules to do…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="text-sm bg-background/50 border-border/60 focus:border-indigo-500/60 resize-none"
              autoFocus
            />
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Title (optional)</label>
            <Input
              placeholder="Short descriptive title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 text-sm bg-background/50 border-border/60 focus:border-indigo-500/60"
            />
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-indigo-400 transition-colors"
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showAdvanced && 'rotate-180')} />
            Advanced options
          </button>

          {showAdvanced && (
            <div className="space-y-3 pt-1 border-t border-border/50">
              {/* Source repository */}
              {sources.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Repository</label>
                  <select
                    value={selectedSource}
                    onChange={(e) => {
                      setSelectedSource(e.target.value);
                      setSelectedBranch('');
                    }}
                    className="w-full h-8 px-2 text-sm rounded-md bg-background/50 border border-border/60 text-foreground focus:outline-none focus:border-indigo-500/60"
                  >
                    <option value="">No repository (repoless)</option>
                    {sources.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.githubRepo ? `${s.githubRepo.owner}/${s.githubRepo.repo}` : s.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Branch */}
              {selectedSource && branches.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Branch</label>
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="w-full h-8 px-2 text-sm rounded-md bg-background/50 border border-border/60 text-foreground focus:outline-none focus:border-indigo-500/60"
                  >
                    <option value="">Select branch…</option>
                    {branches.map((b) => (
                      <option key={b.displayName} value={b.displayName}>
                        {b.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Require plan approval */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireApproval}
                  onChange={(e) => setRequireApproval(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-indigo-500"
                />
                <span className="text-xs text-muted-foreground">Require plan approval before execution</span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={loading || !prompt.trim()}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white border-0"
          >
            {loading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                Creating…
              </>
            ) : (
              'Create Session'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
