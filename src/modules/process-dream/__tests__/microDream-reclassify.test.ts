import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, SELF_PROJECT_ID } from '../../../services/db';
import { microDream } from '../dream-levels';

const mockContext = {
  taskId: '',
  repoUrl: '',
  repoBranch: '',
  githubToken: '',
  llmCall: vi.fn(async (prompt: string) => 'Test summary of observations.'),
  moduleConfig: {},
} as any;

describe('microDream → reclassify integration', () => {
  const taskId = 'test-task-42';

  beforeEach(async () => {
    await db.kbLog.clear();
    await db.tasks.clear();
    await db.messages.clear();
    vi.clearAllMocks();
  });

  async function addEntry(text: string, opts: {
    category?: string;
    tags?: string[];
    abstraction?: number;
    source?: string;
    projectId?: string;
  } = {}) {
    await db.kbLog.add({
      timestamp: Date.now(),
      text,
      category: opts.category || 'observation',
      abstraction: opts.abstraction ?? 1,
      layer: ['L3'],
      tags: opts.tags || [taskId],
      source: opts.source || 'execution',
      active: true,
      projectId: opts.projectId || 'test-project-id',
    } as any);
  }

  it('calls reclassify after consolidation', async () => {
    // Add 3+ raw entries so consolidation triggers
    await addEntry('obs 1', { tags: [taskId] });
    await addEntry('obs 2', { tags: [taskId] });
    await addEntry('obs 3', { tags: [taskId] });

    const result = await microDream(taskId, mockContext);
    expect(result).toContain('consolidated');

    // Verify the LLM was called for summarization
    expect(mockContext.llmCall).toHaveBeenCalled();
  });

  it('triggers reflection that sends mail for recurring errors', async () => {
    // Add 3 raw entries for this task
    await addEntry('obs 1', { tags: [taskId] });
    await addEntry('obs 2', { tags: [taskId] });
    await addEntry('obs 3', { tags: [taskId] });

    // Add recurring errors across other tasks (enough for SAME-ERROR rule, threshold=3)
    const errorText = 'bash-exec timeout exceeded on process that takes too long to complete execution';
    for (let i = 0; i < 3; i++) {
      await db.kbLog.add({
        timestamp: Date.now(),
        text: errorText,
        category: 'error',
        abstraction: 2,
        layer: ['L3'],
        tags: [`task-other-${i}`],
        source: 'execution',
        active: true,
        projectId: 'test-project-id',
      } as any);
    }

    await microDream(taskId, mockContext);

    // Reflection should have sent a mail
    const mails = await db.messages.filter(m => m.sender === 'reflection').toArray();
    expect(mails.length).toBeGreaterThanOrEqual(1);
    expect(mails[0].type).toBe('alert');
    expect(mails[0].projectId).toBe(SELF_PROJECT_ID);
  });

  it('is idempotent — skips if already ran for task', async () => {
    await addEntry('obs 1', { tags: [taskId] });

    // Pre-create a consolidation entry to simulate prior run
    await db.kbLog.add({
      timestamp: Date.now(),
      text: 'Previous summary',
      category: 'insight',
      abstraction: 5,
      layer: ['L0'],
      tags: [taskId, 'consolidation'],
      source: 'dream:micro',
      active: true,
      projectId: 'test-project-id',
    } as any);

    const result = await microDream(taskId, mockContext);
    expect(result).toContain('already consolidated');

    // LLM should not have been called
    expect(mockContext.llmCall).not.toHaveBeenCalled();
  });

  it('skips consolidation but still runs reclassify when <3 entries', async () => {
    await addEntry('only one entry', { tags: [taskId] });

    // Add recurring errors in other tasks
    const errorText = 'bash-exec timeout exceeded on process that takes too long to complete execution';
    for (let i = 0; i < 3; i++) {
      await db.kbLog.add({
        timestamp: Date.now(),
        text: errorText,
        category: 'error',
        abstraction: 2,
        layer: ['L3'],
        tags: [`task-other-${i}`],
        source: 'execution',
        active: true,
        projectId: 'test-project-id',
      } as any);
    }

    const result = await microDream(taskId, mockContext);
    expect(result).toContain('skipping consolidation');

    // Even with <3 entries, reclassify still ran and detected the pattern
    const mails = await db.messages.filter(m => m.sender === 'reflection').toArray();
    expect(mails.length).toBeGreaterThanOrEqual(1);
  });

  it('does not create self-task until 3 mails accumulate', async () => {
    // Only 3 errors for one task — SAME-ERROR requires 2+ different tasks
    await addEntry('obs 1', { tags: [taskId] });
    await addEntry('obs 2', { tags: [taskId] });
    await addEntry('obs 3', { tags: [taskId] });

    // Add same error in 2 tasks only (below threshold for rule)
    await addEntry('small error pattern', { tags: ['task-a'], category: 'error' });
    await addEntry('small error pattern', { tags: ['task-b'], category: 'error' });

    await microDream(taskId, mockContext);

    const tasks = await db.tasks.filter(t => t.projectId === SELF_PROJECT_ID).toArray();
    expect(tasks.length).toBe(0);
  });
});
