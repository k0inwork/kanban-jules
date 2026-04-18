/**
 * Tests for task branching model: BranchEvaluator, PushQueue, GitFs task dirs.
 * Uses fake-indexeddb (vitest setup) and mock LLM calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateBranch } from '../services/BranchEvaluator';
import { db } from '../services/db';
import { Task } from '../types';

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '',
    workflowStatus: 'TODO',
    agentState: 'IDLE',
    createdAt: Date.now(),
    ...overrides,
  };
}

// ─── BranchEvaluator ────────────────────────────────────────────────

describe('BranchEvaluator', () => {
  it('disqualifies simple tasks with no protocol', () => {
    const task = makeTask({ id: '1', title: 'Fix typo in README' });
    const result = evaluateBranch(task);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('simple task');
  });

  it('qualifies when protocol has >= 3 steps', () => {
    const task = makeTask({
      id: '2',
      title: 'Small change',
      protocol: {
        steps: [
          { id: 1, title: 'A', description: '', executor: 'local', status: 'pending' },
          { id: 2, title: 'B', description: '', executor: 'local', status: 'pending' },
          { id: 3, title: 'C', description: '', executor: 'local', status: 'pending' },
        ],
      },
    });
    const result = evaluateBranch(task);
    expect(result.qualifies).toBe(true);
    expect(result.reason).toContain('3 steps');
  });

  it('disqualifies when protocol has < 3 steps', () => {
    const task = makeTask({
      id: '3',
      title: 'Small change',
      protocol: {
        steps: [
          { id: 1, title: 'A', description: '', executor: 'local', status: 'pending' },
          { id: 2, title: 'B', description: '', executor: 'local', status: 'pending' },
        ],
      },
    });
    const result = evaluateBranch(task);
    expect(result.qualifies).toBe(false);
  });

  it('qualifies on scope keyword in title', () => {
    const task = makeTask({ id: '4', title: 'Implement dark mode' });
    const result = evaluateBranch(task);
    expect(result.qualifies).toBe(true);
    expect(result.reason).toContain('implement');
  });

  it('qualifies on scope keyword in description', () => {
    const task = makeTask({ id: '5', title: 'Change button color', description: 'Refactor the color system' });
    const result = evaluateBranch(task);
    expect(result.qualifies).toBe(true);
    expect(result.reason).toContain('refactor');
  });

  it('qualifies when explicitly flagged as architectural', () => {
    const task = makeTask({
      id: '6',
      title: 'Fix config',
      agentContext: { architectural: true },
    });
    const result = evaluateBranch(task);
    expect(result.qualifies).toBe(true);
    expect(result.reason).toContain('architectural');
  });

  it('is case-insensitive for keywords', () => {
    const task = makeTask({ id: '7', title: 'REWRITE the auth module' });
    const result = evaluateBranch(task);
    expect(result.qualifies).toBe(true);
    expect(result.reason).toContain('rewrite');
  });
});

// ─── GitFs.taskDir ──────────────────────────────────────────────────

describe('GitFs.taskDir', () => {
  it('produces a short-id task directory', async () => {
    const { GitFs } = await import('../services/GitFs');
    const dir = GitFs.taskDir('github.com/owner/repo', '550e8400-e29b-41d4-a716-446655440000');
    expect(dir).toBe('/owner/repo--550e8400');
  });

  it('handles short IDs without truncation', async () => {
    const { GitFs } = await import('../services/GitFs');
    const dir = GitFs.taskDir('github.com/owner/repo', 'abc');
    expect(dir).toBe('/owner/repo--abc');
  });
});

// ─── PushQueue ──────────────────────────────────────────────────────

describe('PushQueue', () => {
  beforeEach(async () => {
    // Clear push queue between tests
    await db.pushQueue.clear();
  });

  it('enqueues a pending push item', async () => {
    const { pushQueue } = await import('../services/PushQueue');
    const id = await pushQueue.enqueue({
      dir: '/owner/repo--550e8400',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      token: 'fake-token',
      taskId: 'task-1',
    });
    expect(id).toBeGreaterThan(0);

    const pending = await pushQueue.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].branch).toBe('main');
    expect(pending[0].status).toBe('pending');
  });

  it('counts pending items', async () => {
    const { pushQueue } = await import('../services/PushQueue');
    await pushQueue.enqueue({
      dir: '/a',
      branch: 'main',
      repoUrl: 'https://github.com/o/r',
      token: 'tok',
    });
    await pushQueue.enqueue({
      dir: '/b',
      branch: 'main',
      repoUrl: 'https://github.com/o/r',
      token: 'tok',
    });
    const count = await pushQueue.pendingCount();
    expect(count).toBe(2);
  });

  it('removes an item by id', async () => {
    const { pushQueue } = await import('../services/PushQueue');
    const id = await pushQueue.enqueue({
      dir: '/a',
      branch: 'main',
      repoUrl: 'https://github.com/o/r',
      token: 'tok',
    });
    await pushQueue.remove(id);
    const pending = await pushQueue.getPending();
    expect(pending).toHaveLength(0);
  });
});

// ─── Task DB fields ─────────────────────────────────────────────────

describe('Task branch fields in DB', () => {
  beforeEach(async () => {
    await db.tasks.clear();
  });

  it('persists branchName and branchDir on task', async () => {
    const task = makeTask({
      id: 'branch-task-1',
      title: 'Implement feature X',
      branchName: 'task/branch-t',
      branchDir: '/owner/repo--branch-',
    });
    await db.tasks.add(task);

    const stored = await db.tasks.get('branch-task-1');
    expect(stored?.branchName).toBe('task/branch-t');
    expect(stored?.branchDir).toBe('/owner/repo--branch-');
  });
});
