import type { Task } from '../types';

/**
 * Fields that sandbox/external code is allowed to update on a Task.
 * This is the single source of truth — BoardTool and boardVM.tasks both use this.
 */
export const TASK_UPDATABLE_FIELDS: (keyof Task)[] = [
  'title', 'description', 'workflowStatus', 'agentState',
  'agentContext', 'project', 'protocol', 'analysis',
  'forwardExecutorMessages', 'pendingExecutorPrompt', 'pendingExecutorId',
];

/**
 * Filter an updates object to only contain allowed fields.
 */
export function sanitizeTaskUpdates(updates: Record<string, any>): Record<string, any> {
  const safe: Record<string, any> = {};
  for (const key of Object.keys(updates)) {
    if ((TASK_UPDATABLE_FIELDS as string[]).includes(key)) {
      safe[key] = updates[key];
    }
  }
  return safe;
}
