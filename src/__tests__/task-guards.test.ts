import { describe, it, expect } from 'vitest';
import { sanitizeTaskUpdates, TASK_UPDATABLE_FIELDS } from '../core/task-guards';

describe('sanitizeTaskUpdates', () => {
  it('allows all whitelisted fields through', () => {
    const updates = {
      title: 'New Title',
      description: 'desc',
      workflowStatus: 'IN_PROGRESS',
      agentState: 'EXECUTING',
      agentContext: { key: 'val' },
      project: 'target',
      protocol: { steps: [] },
      analysis: 'text',
    };
    const result = sanitizeTaskUpdates(updates);
    expect(Object.keys(result)).toHaveLength(8);
    expect(result.title).toBe('New Title');
  });

  it('strips non-whitelisted fields', () => {
    const updates = {
      title: 'ok',
      id: 'hacked',
      createdAt: 999,
      branchName: 'evil',
      branchDir: '/etc',
    };
    const result = sanitizeTaskUpdates(updates);
    expect(Object.keys(result)).toHaveLength(1);
    expect(result.title).toBe('ok');
    expect(result.id).toBeUndefined();
  });

  it('returns empty object when no fields match', () => {
    const result = sanitizeTaskUpdates({ id: 'x', createdAt: 1 });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('TASK_UPDATABLE_FIELDS', () => {
  it('does not include id or createdAt', () => {
    expect((TASK_UPDATABLE_FIELDS as string[]).includes('id')).toBe(false);
    expect((TASK_UPDATABLE_FIELDS as string[]).includes('createdAt')).toBe(false);
  });

  it('does not include branchName or branchDir', () => {
    expect((TASK_UPDATABLE_FIELDS as string[]).includes('branchName')).toBe(false);
    expect((TASK_UPDATABLE_FIELDS as string[]).includes('branchDir')).toBe(false);
  });
});
