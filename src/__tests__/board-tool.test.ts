import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Task } from '../types';

// ── mock db before importing BoardTool ──
const tasksMap = new Map<string, Task>();
let nextId = 1;

vi.mock('../services/db', () => ({
  db: {
    tasks: {
      get: vi.fn((id: string) => Promise.resolve(tasksMap.get(id) || undefined)),
      toArray: vi.fn(() => Promise.resolve(Array.from(tasksMap.values()))),
      add: vi.fn((task: Task) => { tasksMap.set(task.id, task); return Promise.resolve(task.id); }),
      update: vi.fn((id: string, updates: Partial<Task>) => {
        const t = tasksMap.get(id);
        if (t) Object.assign(t, updates);
        return Promise.resolve();
      }),
      orderBy: vi.fn(() => ({
        toArray: vi.fn(() => Promise.resolve(Array.from(tasksMap.values()))),
      })),
    },
  },
}));

import { BoardTool } from '../modules/knowledge-board/BoardTool';
import { RequestContext } from '../core/types';

const ctx: RequestContext = {
  taskId: '',
  repoUrl: '',
  repoBranch: '',
  llmCall: vi.fn(),
  moduleConfig: {},
};

function addTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  const task: Task = {
    description: '',
    workflowStatus: 'TODO',
    agentState: 'IDLE',
    createdAt: Date.now() + nextId++,
    moduleLogs: {},
    ...overrides,
  };
  tasksMap.set(task.id, task);
  return task;
}

beforeEach(() => {
  tasksMap.clear();
  nextId = 1;
});

// ── listTasks ──

describe('board.listTasks', () => {
  it('returns "No tasks found" when board is empty', async () => {
    const result = await BoardTool.handleRequest('knowledge-board.listTasks', [{}], ctx);
    expect(result).toBe('No tasks found.');
  });

  it('lists all tasks in compact format', async () => {
    addTask({ id: 't1', title: 'Fix login bug', workflowStatus: 'IN_PROGRESS' });
    addTask({ id: 't2', title: 'Add dark mode', workflowStatus: 'TODO' });

    const result = await BoardTool.handleRequest('knowledge-board.listTasks', [{}], ctx);
    expect(result).toContain('t1');
    expect(result).toContain('Fix login bug');
    expect(result).toContain('IN_PROGRESS');
    expect(result).toContain('t2');
    expect(result).toContain('Add dark mode');
    expect(result).toContain('TODO');
  });

  it('filters by status', async () => {
    addTask({ id: 't1', title: 'Fix login bug', workflowStatus: 'IN_PROGRESS' });
    addTask({ id: 't2', title: 'Add dark mode', workflowStatus: 'TODO' });

    const result = await BoardTool.handleRequest('knowledge-board.listTasks', [{ status: 'IN_PROGRESS' }], ctx);
    expect(result).toContain('t1');
    expect(result).not.toContain('t2');
  });

  it('filters by project', async () => {
    addTask({ id: 't1', title: 'Self task', project: 'self' });
    addTask({ id: 't2', title: 'Target task', project: 'target' });

    const result = await BoardTool.handleRequest('knowledge-board.listTasks', [{ project: 'self' }], ctx);
    expect(result).toContain('Self task');
    expect(result).not.toContain('Target task');
  });
});

// ── getTask ──

describe('board.getTask', () => {
  it('returns full task JSON by ID', async () => {
    addTask({ id: 'abc123', title: 'My task', description: 'Do things' });

    const result = await BoardTool.handleRequest('knowledge-board.getTask', [{ task: 'abc123' }], ctx);
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('abc123');
    expect(parsed.title).toBe('My task');
    expect(parsed.description).toBe('Do things');
  });

  it('looks up by title substring (case insensitive)', async () => {
    addTask({ id: 'x1', title: 'Implement OAuth2 Flow' });

    const result = await BoardTool.handleRequest('knowledge-board.getTask', [{ task: 'oauth' }], ctx);
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('x1');
  });

  it('throws on not found', async () => {
    await expect(
      BoardTool.handleRequest('knowledge-board.getTask', [{ task: 'nonexistent' }], ctx)
    ).rejects.toThrow('Task not found');
  });
});

// ── createTask ──

describe('board.createTask', () => {
  it('creates a task with title only', async () => {
    const result = await BoardTool.handleRequest('knowledge-board.createTask', [{ title: 'New feature' }], ctx);
    expect(result).toContain('New feature');
    expect(result).toMatch(/Created task/);

    // Verify it was added to db
    const all = Array.from(tasksMap.values());
    expect(all.length).toBe(1);
    expect(all[0].title).toBe('New feature');
    expect(all[0].workflowStatus).toBe('TODO');
  });

  it('creates a task with description and project', async () => {
    await BoardTool.handleRequest('knowledge-board.createTask', [{
      title: 'Self improvement',
      description: 'Make the system better',
      project: 'self',
    }], ctx);

    const task = Array.from(tasksMap.values())[0];
    expect(task.description).toBe('Make the system better');
    expect(task.project).toBe('self');
  });

  it('throws if title is missing', async () => {
    await expect(
      BoardTool.handleRequest('knowledge-board.createTask', [], ctx)
    ).rejects.toThrow('title is required');
  });
});

// ── updateTask ──

describe('board.updateTask', () => {
  it('updates whitelisted fields by ID', async () => {
    addTask({ id: 't1', title: 'Old title', description: 'Old desc' });

    const result = await BoardTool.handleRequest('knowledge-board.updateTask', [{
      task: 't1',
      updates: { title: 'New title', workflowStatus: 'DONE' },
    }], ctx);
    expect(result).toContain('Updated task t1');
    expect(result).toContain('title');
    expect(result).toContain('workflowStatus');

    const updated = tasksMap.get('t1')!;
    expect(updated.title).toBe('New title');
    expect(updated.workflowStatus).toBe('DONE');
  });

  it('updates by title substring', async () => {
    addTask({ id: 't1', title: 'Unique task name' });

    const result = await BoardTool.handleRequest('knowledge-board.updateTask', [{
      task: 'unique task',
      updates: { description: 'Updated via name lookup' },
    }], ctx);
    expect(result).toContain('Updated task t1');

    expect(tasksMap.get('t1')!.description).toBe('Updated via name lookup');
  });

  it('ignores non-whitelisted fields', async () => {
    addTask({ id: 't1', title: 'Secure task' });

    const result = await BoardTool.handleRequest('knowledge-board.updateTask', [{
      task: 't1',
      updates: { id: 'hacked', createdAt: 0 },
    }], ctx);
    expect(result).toBe('No valid fields to update.');
    expect(tasksMap.get('t1')!.id).toBe('t1');
  });

  it('throws if task not found', async () => {
    await expect(
      BoardTool.handleRequest('knowledge-board.updateTask', [{
        task: 'ghost',
        updates: { title: 'x' },
      }], ctx)
    ).rejects.toThrow('Task not found');
  });
});
