import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../services/db';
import { eventBus } from '../../../core/event-bus';
import { watchdogDream } from '../dream-levels';

const mockContext = {
  taskId: 'test-task',
  repoUrl: '',
  repoBranch: '',
  githubToken: '',
  llmCall: async () => '',
  moduleConfig: {},
} as any;

describe('watchdogDream', () => {
  const sentMessages: any[] = [];

  beforeEach(async () => {
    await db.kbLog.clear();
    await db.tasks.clear();
    sentMessages.length = 0;
    (eventBus as any).listeners = {};

    // Capture AgentBus.send() messages
    eventBus.on('agent:message' as any, (msg: any) => {
      sentMessages.push(msg);
    });
  });

  async function addTask(id: string, workflowStatus: string) {
    await db.tasks.add({
      id,
      title: `Task ${id}`,
      description: 'test task',
      workflowStatus,
      agentState: 'IDLE',
      createdAt: Date.now(),
    } as any);
  }

  async function addFinding(text: string, opts: {
    category?: string;
    source?: string;
    tags?: string[];
    abstraction?: number;
  } = {}) {
    await db.kbLog.add({
      timestamp: Date.now(),
      text,
      category: opts.category || 'error',
      abstraction: opts.abstraction ?? 5,
      layer: ['L0'],
      tags: opts.tags || [],
      source: opts.source || 'dream:session',
      active: true,
      projectId: 'test-project-id',
    });
  }

  it('no running tasks → no action', async () => {
    await addFinding('bash-exec fails', { tags: ['task-1'], category: 'error' });
    const result = await watchdogDream(mockContext);
    expect(result).toContain('no running tasks');
    expect(sentMessages).toHaveLength(0);
  });

  it('no actionable findings → no action', async () => {
    await addTask('task-1', 'IN_PROGRESS');
    // No findings in KB
    const result = await watchdogDream(mockContext);
    expect(result).toContain('no actionable findings');
    expect(sentMessages).toHaveLength(0);
  });

  it('findings exist but no matching tasks → no action', async () => {
    await addTask('task-1', 'IN_PROGRESS');
    await addFinding('bash-exec fails', { tags: ['task-999'], category: 'error' });
    const result = await watchdogDream(mockContext);
    expect(result).toContain('none match running tasks');
    expect(sentMessages).toHaveLength(0);
  });

  it('error finding matching running task → intervention sent to orchestrator', async () => {
    await addTask('task-42', 'IN_PROGRESS');
    await addFinding('bash-exec fails on task-42', {
      category: 'error',
      tags: ['task-42'],
      source: 'dream:session',
    });

    const result = await watchdogDream(mockContext);
    expect(result).toContain('intervention');

    expect(sentMessages).toHaveLength(1);
    const msg = sentMessages[0];
    expect(msg.from).toBe('watchdog');
    expect(msg.to).toBe('orchestrator');
    expect(msg.type).toBe('intervention');
    expect(msg.payload.taskIds).toContain('task-42');
    expect(msg.payload.action).toBe('pause');
    expect(msg.payload.reason).toContain('bash-exec fails');
  });

  it('gap finding matching running task → alert sent to process-agent', async () => {
    await addTask('task-7', 'IN_PROGRESS');
    await addFinding('Missing config documentation', {
      category: 'observation',
      tags: ['task-7', 'gap'],
      source: 'dream:deep',
    });

    const result = await watchdogDream(mockContext);
    expect(result).toContain('alert');

    expect(sentMessages).toHaveLength(1);
    const msg = sentMessages[0];
    expect(msg.from).toBe('watchdog');
    expect(msg.to).toBe('process-agent');
    expect(msg.type).toBe('alert');
    expect(msg.payload.taskIds).toContain('task-7');
  });

  it('multiple findings match same task → multiple messages', async () => {
    await addTask('task-1', 'IN_PROGRESS');
    await addFinding('Error pattern A', {
      category: 'error',
      tags: ['task-1'],
      source: 'dream:session',
    });
    await addFinding('Knowledge gap detected', {
      category: 'observation',
      tags: ['task-1', 'gap'],
      source: 'dream:deep',
    });

    const result = await watchdogDream(mockContext);
    expect(result).toContain('2 actions taken');
    expect(sentMessages).toHaveLength(2);
  });

  it('ignores non-dream/reflection sources', async () => {
    await addTask('task-1', 'IN_PROGRESS');
    await addFinding('Execution error', {
      category: 'error',
      tags: ['task-1'],
      source: 'execution',
    });

    const result = await watchdogDream(mockContext);
    expect(result).toContain('no actionable findings');
    expect(sentMessages).toHaveLength(0);
  });

  it('ignores old findings (older than 30 min)', async () => {
    await addTask('task-1', 'IN_PROGRESS');
    await db.kbLog.add({
      timestamp: Date.now() - 60 * 60 * 1000, // 1 hour ago
      text: 'Old error',
      category: 'error',
      abstraction: 5,
      layer: ['L0'],
      tags: ['task-1'],
      source: 'dream:session',
      active: true,
      projectId: 'test-project-id',
    });

    const result = await watchdogDream(mockContext);
    expect(result).toContain('no actionable findings');
    expect(sentMessages).toHaveLength(0);
  });

  it('conflict tag triggers intervention', async () => {
    await addTask('task-5', 'IN_PROGRESS');
    await addFinding('Conflict between two modules', {
      category: 'observation',
      tags: ['task-5', 'conflict'],
      source: 'dream:session',
    });

    const result = await watchdogDream(mockContext);
    expect(result).toContain('intervention');
    expect(sentMessages[0].to).toBe('orchestrator');
  });

  it('DONE tasks are not matched', async () => {
    await addTask('task-done', 'DONE');
    await addFinding('Error on done task', {
      category: 'error',
      tags: ['task-done'],
      source: 'dream:session',
    });

    const result = await watchdogDream(mockContext);
    expect(result).toContain('no running tasks');
    expect(sentMessages).toHaveLength(0);
  });
});
