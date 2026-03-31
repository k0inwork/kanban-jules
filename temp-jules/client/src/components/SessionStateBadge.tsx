import { type SessionState } from '@/lib/julesApi';
import { cn } from '@/lib/utils';

const STATE_CONFIG: Record<SessionState, { label: string; className: string; dot?: string }> = {
  QUEUED: { label: 'Queued', className: 'status-queued', dot: 'bg-yellow-400' },
  PLANNING: { label: 'Planning', className: 'status-planning', dot: 'bg-blue-400' },
  AWAITING_PLAN_APPROVAL: { label: 'Awaiting Approval', className: 'status-awaiting-approval', dot: 'bg-orange-400' },
  AWAITING_USER_FEEDBACK: { label: 'Needs Feedback', className: 'status-awaiting-feedback', dot: 'bg-purple-400' },
  IN_PROGRESS: { label: 'In Progress', className: 'status-in-progress', dot: 'bg-indigo-400' },
  PAUSED: { label: 'Paused', className: 'status-paused', dot: 'bg-gray-400' },
  COMPLETED: { label: 'Completed', className: 'status-completed', dot: 'bg-emerald-400' },
  FAILED: { label: 'Failed', className: 'status-failed', dot: 'bg-red-400' },
};

const ACTIVE_STATES = new Set(['QUEUED', 'PLANNING', 'IN_PROGRESS']);

interface Props {
  state: SessionState;
  size?: 'sm' | 'md';
}

export function SessionStateBadge({ state, size = 'md' }: Props) {
  const config = STATE_CONFIG[state] || { label: state, className: 'status-paused', dot: 'bg-gray-400' };
  const isActive = ACTIVE_STATES.has(state);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-mono-code font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        config.className,
      )}
    >
      <span
        className={cn(
          'rounded-full flex-shrink-0',
          size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2',
          config.dot,
          isActive && 'animate-pulse',
        )}
      />
      {config.label}
    </span>
  );
}
