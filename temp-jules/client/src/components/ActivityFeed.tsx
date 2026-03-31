import { useEffect, useRef } from 'react';
import { Loader2, AlertCircle, Bot, User, Settings, CheckCheck, XCircle, Zap, FileCode2, Terminal, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useJules } from '@/contexts/JulesContext';
import { formatTimestamp } from '@/lib/dateUtils';
import type { Activity, PlanStep } from '@/lib/julesApi';
import { cn } from '@/lib/utils';
import { Streamdown } from 'streamdown';

function PlanSteps({ steps }: { steps: PlanStep[] }) {
  return (
    <div className="mt-2 space-y-1.5">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-start gap-2">
          <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-[9px] font-mono-code text-indigo-400 font-bold">{i + 1}</span>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">{step.title}</p>
            {step.description && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{step.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffViewer({ patch }: { patch: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!patch) return null;
  const lines = patch.split('\n');
  const preview = lines.slice(0, 8);

  return (
    <div className="mt-2 rounded-md overflow-hidden border border-border/50">
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-background/60 cursor-pointer hover:bg-background/80 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[10px] font-mono-code text-muted-foreground">git diff</span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        )}
      </div>
      <pre className="text-[10px] font-mono-code overflow-x-auto p-3 bg-background/30 leading-relaxed">
        {(expanded ? lines : preview).map((line, i) => (
          <div
            key={i}
            className={cn(
              line.startsWith('+') && !line.startsWith('+++') && 'text-emerald-400',
              line.startsWith('-') && !line.startsWith('---') && 'text-red-400',
              line.startsWith('@@') && 'text-indigo-400',
              !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('@@') && 'text-muted-foreground',
            )}
          >
            {line}
          </div>
        ))}
        {!expanded && lines.length > 8 && (
          <div className="text-muted-foreground/50 mt-1">… {lines.length - 8} more lines</div>
        )}
      </pre>
    </div>
  );
}

function ActivityItem({ activity, isLast }: { activity: Activity; isLast: boolean }) {
  const getIcon = () => {
    if (activity.planGenerated) return <FileCode2 className="w-3.5 h-3.5 text-blue-400" />;
    if (activity.planApproved) return <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />;
    if (activity.userMessaged) return <User className="w-3.5 h-3.5 text-indigo-400" />;
    if (activity.agentMessaged) return <Bot className="w-3.5 h-3.5 text-purple-400" />;
    if (activity.progressUpdated) return <Zap className="w-3.5 h-3.5 text-yellow-400" />;
    if (activity.sessionCompleted) return <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />;
    if (activity.sessionFailed) return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    if (activity.originator === 'system') return <Settings className="w-3.5 h-3.5 text-muted-foreground" />;
    return <Bot className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const getBgColor = () => {
    if (activity.userMessaged) return 'bg-indigo-500/15 border-indigo-500/20';
    if (activity.agentMessaged) return 'bg-purple-500/10 border-purple-500/20';
    if (activity.planGenerated) return 'bg-blue-500/10 border-blue-500/20';
    if (activity.sessionCompleted) return 'bg-emerald-500/10 border-emerald-500/20';
    if (activity.sessionFailed) return 'bg-red-500/10 border-red-500/20';
    return 'bg-white/3 border-white/6';
  };

  const renderContent = () => {
    if (activity.userMessaged) {
      return (
        <div className="text-sm text-foreground leading-relaxed">
          {activity.userMessaged.userMessage}
        </div>
      );
    }

    if (activity.agentMessaged) {
      return (
        <div className="text-sm text-foreground/90 leading-relaxed prose prose-invert prose-sm max-w-none">
          <Streamdown>{activity.agentMessaged.agentMessage}</Streamdown>
        </div>
      );
    }

    if (activity.planGenerated) {
      const { plan } = activity.planGenerated;
      return (
        <div>
          <p className="text-sm font-medium text-blue-300">Plan generated — {plan.steps.length} steps</p>
          <PlanSteps steps={plan.steps} />
        </div>
      );
    }

    if (activity.planApproved) {
      return <p className="text-sm text-emerald-300">Plan approved — execution started</p>;
    }

    if (activity.progressUpdated) {
      return (
        <div>
          <p className="text-sm font-medium text-yellow-300">{activity.progressUpdated.title}</p>
          {activity.progressUpdated.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{activity.progressUpdated.description}</p>
          )}
        </div>
      );
    }

    if (activity.sessionCompleted) {
      return <p className="text-sm text-emerald-300 font-medium">Session completed successfully</p>;
    }

    if (activity.sessionFailed) {
      return (
        <div>
          <p className="text-sm text-red-300 font-medium">Session failed</p>
          {activity.sessionFailed.reason && (
            <p className="text-xs text-red-400/80 mt-0.5">{activity.sessionFailed.reason}</p>
          )}
        </div>
      );
    }

    return (
      <p className="text-sm text-muted-foreground">
        {activity.description || 'Activity'}
      </p>
    );
  };

  return (
    <div className="relative flex gap-3 animate-fade-slide-up">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border/40" />
      )}

      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center z-10">
        {getIcon()}
      </div>

      {/* Content */}
      <div className={cn('flex-1 min-w-0 rounded-lg border p-3 mb-3', getBgColor())}>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-mono-code text-muted-foreground uppercase tracking-wide">
            {activity.originator}
          </span>
          <span className="text-[10px] font-mono-code text-muted-foreground flex-shrink-0">
            {formatTimestamp(activity.createTime)}
          </span>
        </div>

        {renderContent()}

        {/* Artifacts */}
        {activity.artifacts?.map((artifact, i) => (
          <div key={i} className="mt-2">
            {artifact.changeSet && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FileCode2 className="w-3 h-3 text-indigo-400" />
                  <span className="text-[10px] font-mono-code text-indigo-400">
                    {artifact.changeSet.gitPatch.suggestedCommitMessage || 'Code changes'}
                  </span>
                </div>
                <DiffViewer patch={artifact.changeSet.gitPatch.unidiffPatch} />
              </div>
            )}
            {artifact.bashOutput && (
              <div className="mt-2 rounded-md overflow-hidden border border-border/50">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-background/60">
                  <Terminal className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] font-mono-code text-muted-foreground">
                    $ {artifact.bashOutput.command}
                  </span>
                  <span
                    className={cn(
                      'ml-auto text-[10px] font-mono-code',
                      artifact.bashOutput.exitCode === 0 ? 'text-emerald-400' : 'text-red-400',
                    )}
                  >
                    exit {artifact.bashOutput.exitCode}
                  </span>
                </div>
                <pre className="text-[10px] font-mono-code p-3 bg-background/30 text-muted-foreground overflow-x-auto max-h-32 leading-relaxed">
                  {artifact.bashOutput.output}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityFeed() {
  const { activities, activitiesLoading, activitiesError, selectedSession } = useJules();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activities.length]);

  if (activitiesLoading && activities.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (activitiesError) {
    return (
      <div className="flex flex-col items-center gap-2 h-full justify-center">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <p className="text-xs text-red-400">{activitiesError}</p>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 h-full justify-center text-center px-6">
        <div className="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
          <Bot className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground mb-1">
            {selectedSession?.state === 'QUEUED' ? 'Session queued' : 'No activity yet'}
          </p>
          <p className="text-xs text-muted-foreground">
            {selectedSession?.state === 'QUEUED'
              ? 'Jules will start working on this task shortly…'
              : 'Activities will appear here as Jules works on your task'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {activities.map((activity, i) => (
        <ActivityItem key={activity.id} activity={activity} isLast={i === activities.length - 1} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
