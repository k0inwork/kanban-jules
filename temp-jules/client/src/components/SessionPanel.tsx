import { useState } from 'react';
import {
  Send,
  CheckCheck,
  Trash2,
  RefreshCw,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Clock,
  Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SessionStateBadge } from './SessionStateBadge';
import { ActivityFeed } from './ActivityFeed';
import { useJules } from '@/contexts/JulesContext';
import { formatDateTime, formatDistanceToNow } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { NewSessionDialog } from './NewSessionDialog';

function SessionHeader({ onNewSession }: { onNewSession: () => void }) {
  const { sessions, selectedSession, selectSession, deleteSession, refreshSessions, refreshActivities } = useJules();
  const [deleting, setDeleting] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  const handleDelete = async () => {
    if (!selectedSession) return;
    if (!confirm(`Delete session "${selectedSession.title || selectedSession.id}"?`)) return;
    setDeleting(true);
    try {
      await deleteSession(selectedSession.id);
      toast.success('Session deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete session');
    } finally {
      setDeleting(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([refreshSessions(), refreshActivities()]);
  };

  return (
    <div className="flex-shrink-0 border-b border-border">
      {/* Main header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 max-w-xl">
            <Select value={selectedSession?.id || ''} onValueChange={(val) => selectSession(val)}>
              <SelectTrigger className="w-full bg-background border-border h-auto py-2 px-3 text-left">
                {selectedSession ? (
                  <div className="flex flex-col gap-0.5 overflow-hidden w-full text-left">
                     <div className="flex items-center justify-between gap-2 w-full">
                       <span className="font-display font-semibold text-sm text-foreground truncate block">
                         {selectedSession.title || selectedSession.prompt?.slice(0, 50) || 'Untitled Session'}
                       </span>
                       <SessionStateBadge state={selectedSession.state} size="sm" />
                     </div>
                     {selectedSession.prompt && (
                       <p className="text-[11px] text-muted-foreground line-clamp-1 w-[90%] block">
                         {selectedSession.prompt}
                       </p>
                     )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Select a Session</span>
                )}
              </SelectTrigger>
              <SelectContent className="max-w-[400px] max-h-[60vh]">
                {sessions.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">No sessions available</div>
                ) : (
                  sessions.map(session => (
                    <SelectItem key={session.id} value={session.id} className="py-2 cursor-pointer w-[380px]">
                      <div className="flex flex-col gap-1 w-full text-left pr-2">
                        <div className="flex items-start justify-between gap-2 w-full">
                          <span className="text-sm font-medium leading-tight truncate block max-w-[200px]">
                            {session.title || session.prompt?.slice(0, 50) || 'Untitled session'}
                          </span>
                          <SessionStateBadge state={session.state} size="sm" />
                        </div>
                        {session.prompt && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 block">
                            {session.prompt}
                          </p>
                        )}
                        <span className="text-[10px] text-muted-foreground mt-0.5 block">
                          Updated {formatDistanceToNow(session.updateTime)}
                        </span>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
            onClick={onNewSession}
            title="New session"
          >
            <Plus className="w-4 h-4" />
          </Button>

          {selectedSession && (
            <>
              <div className="w-px h-4 bg-border mx-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleRefresh}
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>

              {selectedSession.url && (
                <a href={selectedSession.url} target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-indigo-400"
                    title="Open in Jules"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </a>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-red-400"
                onClick={handleDelete}
                disabled={deleting}
                title="Delete session"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setShowMeta((v) => !v)}
                title="Session details"
              >
                {showMeta ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Metadata panel */}
      {selectedSession && showMeta && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border/50 pt-3 animate-fade-slide-up">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Session ID</span>
            <p className="text-xs font-mono-code text-foreground mt-0.5">{selectedSession.id}</p>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">State</span>
            <p className="text-xs font-mono-code text-foreground mt-0.5">{selectedSession.state}</p>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" /> Created
            </span>
            <p className="text-xs text-foreground mt-0.5">{formatDateTime(selectedSession.createTime)}</p>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" /> Updated
            </span>
            <p className="text-xs text-foreground mt-0.5">{formatDateTime(selectedSession.updateTime)}</p>
          </div>
          {selectedSession.outputs?.map((output, i) =>
            output.pullRequest ? (
              <div key={i} className="col-span-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <GitBranch className="w-2.5 h-2.5" /> Pull Request
                </span>
                <a
                  href={output.pullRequest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 mt-0.5 flex items-center gap-1"
                >
                  {output.pullRequest.title}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function ApprovePlanBanner() {
  const { selectedSession, approvePlan } = useJules();
  const [loading, setLoading] = useState(false);

  if (selectedSession?.state !== 'AWAITING_PLAN_APPROVAL') return null;

  const handleApprove = async () => {
    setLoading(true);
    try {
      await approvePlan(selectedSession.id);
      toast.success('Plan approved — Jules is now executing');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve plan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-shrink-0 mx-4 my-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3 flex items-center justify-between gap-3 animate-fade-slide-up">
      <div>
        <p className="text-sm font-medium text-orange-300">Plan ready for approval</p>
        <p className="text-xs text-orange-400/70 mt-0.5">Review the plan above and approve to start execution</p>
      </div>
      <Button
        size="sm"
        onClick={handleApprove}
        disabled={loading}
        className="flex-shrink-0 bg-orange-600 hover:bg-orange-500 text-white border-0 text-xs"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <>
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
            Approve Plan
          </>
        )}
      </Button>
    </div>
  );
}

function ChatInput() {
  const { selectedSession, sendMessage, refreshActivities } = useJules();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const canSend =
    selectedSession &&
    (selectedSession.state === 'AWAITING_USER_FEEDBACK' ||
      selectedSession.state === 'IN_PROGRESS' ||
      selectedSession.state === 'PLANNING');

  const handleSend = async () => {
    if (!message.trim() || !selectedSession) return;
    setSending(true);
    const text = message.trim();
    setMessage('');
    try {
      await sendMessage(selectedSession.id, text);
      setTimeout(refreshActivities, 800);
      toast.success('Message sent');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
      setMessage(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!selectedSession) return null;

  return (
    <div className="flex-shrink-0 border-t border-border p-3">
      {!canSend && (
        <p className="text-[11px] text-muted-foreground text-center mb-2">
          {selectedSession.state === 'COMPLETED' && 'Session completed — start a new session to continue'}
          {selectedSession.state === 'FAILED' && 'Session failed — start a new session to retry'}
          {selectedSession.state === 'QUEUED' && 'Session is queued — Jules will start shortly'}
          {selectedSession.state === 'PAUSED' && 'Session is paused'}
          {selectedSession.state === 'AWAITING_PLAN_APPROVAL' && 'Approve the plan above to continue'}
        </p>
      )}
      <div
        className={cn(
          'flex items-end gap-2 rounded-lg border p-2 transition-colors',
          canSend
            ? 'border-border/60 focus-within:border-indigo-500/50 bg-background/40'
            : 'border-border/30 bg-background/20 opacity-60',
        )}
      >
        <Textarea
          placeholder={
            canSend
              ? selectedSession.state === 'AWAITING_USER_FEEDBACK'
                ? 'Jules is waiting for your input…'
                : 'Send a message to Jules… (Enter to send, Shift+Enter for newline)'
              : 'Messaging not available in this state'
          }
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!canSend || sending}
          rows={2}
          className={cn(
            'flex-1 text-sm border-0 bg-transparent p-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0',
            'placeholder:text-muted-foreground/50',
          )}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!canSend || !message.trim() || sending}
          className={cn(
            'h-8 w-8 flex-shrink-0 rounded-md transition-all',
            canSend && message.trim()
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-right">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}

export function SessionPanel() {
  const { selectedSession } = useJules();
  const [showNewDialog, setShowNewDialog] = useState(false);

  return (
    <div className="flex flex-col h-full relative">
      <SessionHeader onNewSession={() => setShowNewDialog(true)} />

      {!selectedSession ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8 relative overflow-hidden">
          {/* Background image */}
          <div
            className="absolute inset-0 opacity-10"
            style={{ backgroundImage: `url(https://d2xsxph8kpxj0f.cloudfront.net/310519663407833786/MFMhWFNQMseonLXydqJJZ2/jules-hero-bg-RZJ6HaqpCGCMgi4Qijokm7.webp)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          />
          <div className="relative z-10 flex flex-col items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, oklch(0.62 0.22 264 / 15%), oklch(0.65 0.18 162 / 10%))',
                border: '1px solid oklch(0.62 0.22 264 / 20%)',
              }}
            >
              <span className="font-display font-bold text-2xl text-indigo-400">J</span>
            </div>
            <div>
              <h3 className="font-display font-semibold text-foreground mb-1">No Session Selected</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Choose a session from the dropdown above or create a new one to begin.
              </p>
            </div>
            <Button
              onClick={() => setShowNewDialog(true)}
              className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-white border-0"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Session
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ApprovePlanBanner />
          <div className="flex-1 overflow-y-auto">
            <ActivityFeed />
          </div>
          <ChatInput />
        </>
      )}

      {showNewDialog && <NewSessionDialog onClose={() => setShowNewDialog(false)} />}
    </div>
  );
}
