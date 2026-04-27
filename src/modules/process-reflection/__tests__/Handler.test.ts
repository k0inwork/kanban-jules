import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, SELF_PROJECT_ID } from '../../../services/db';
import { ReflectionHandler } from '../Handler';

const mockContext = {
  taskId: '',
  repoUrl: '',
  repoBranch: '',
  githubToken: '',
  llmCall: async () => '',
  moduleConfig: {},
} as any;

async function addError(text: string, opts: { tags?: string[]; projectId?: string } = {}) {
  await db.kbLog.add({
    timestamp: Date.now(),
    text,
    category: 'error',
    abstraction: 2,
    layer: ['L3'],
    tags: opts.tags || [],
    source: 'execution',
    active: true,
    projectId: opts.projectId || 'test-project-id',
  } as any);
}

async function addObservation(text: string, opts: { tags?: string[] } = {}) {
  await db.kbLog.add({
    timestamp: Date.now(),
    text,
    category: 'observation',
    abstraction: 3,
    layer: ['L0'],
    tags: opts.tags || [],
    source: 'dream:session',
    active: true,
    projectId: SELF_PROJECT_ID,
  } as any);
}

describe('ReflectionHandler.reclassify', () => {
  beforeEach(async () => {
    await db.kbLog.clear();
    await db.messages.clear();
    await db.tasks.clear();
  });

  it('returns empty when no errors exist', async () => {
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], mockContext);
    expect(result.reclassified).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('ignores errors already on self-project', async () => {
    await addError('self-error', { projectId: SELF_PROJECT_ID });
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], mockContext);
    expect(result.reclassified).toBe(0);
  });

  it('ignores non-execution-source entries', async () => {
    await db.kbLog.add({
      timestamp: Date.now(),
      text: 'dream error',
      category: 'error',
      abstraction: 2,
      layer: ['L0'],
      tags: [],
      source: 'dream:deep',
      active: true,
      projectId: 'test-project-id',
    } as any);

    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], mockContext);
    expect(result.reclassified).toBe(0);
  });

  describe('recurring error → mail → task flow', () => {
    const errorText = 'bash-exec timeout on long-running process that exceeds the default 30s limit';

    it('sends a mail (not a task) on first recurring error match', async () => {
      // Add 3 same errors across 2 tasks (threshold=3)
      await addError(errorText, { tags: ['task-1'] });
      await addError(errorText, { tags: ['task-2'] });
      await addError(errorText, { tags: ['task-3'] });

      const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], mockContext);
      expect(result.reclassified).toBe(3);

      // Check: mail was sent
      const mails = await db.messages.toArray();
      expect(mails.length).toBeGreaterThanOrEqual(1);
      const alertMail = mails.find(m => m.type === 'alert' && m.sender === 'reflection');
      expect(alertMail).toBeDefined();
      expect(alertMail!.projectId).toBe(SELF_PROJECT_ID);
      expect(alertMail!.status).toBe('unread');
      expect(alertMail!.content).toContain('SAME-ERROR');

      // Check: NO task created yet (only 1 mail for this pattern)
      const tasks = await db.tasks.toArray();
      const selfTasks = tasks.filter(t => t.projectId === SELF_PROJECT_ID);
      expect(selfTasks.length).toBe(0);
    });

    it('creates a self-task when 3 mails accumulate for same pattern', async () => {
      // Run reclassify 3 times, adding fresh errors each time
      for (let run = 0; run < 3; run++) {
        await addError(errorText, { tags: [`task-r${run}-1`] });
        await addError(errorText, { tags: [`task-r${run}-2`] });
        await addError(errorText, { tags: [`task-r${run}-3`] });
        await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], mockContext);
      }

      // Check: self-task was created
      const tasks = await db.tasks.toArray();
      const selfTasks = tasks.filter(t => t.projectId === SELF_PROJECT_ID);
      expect(selfTasks.length).toBeGreaterThanOrEqual(1);
      expect(selfTasks[0].title).toContain('[self]');

      // Check: mails were marked as read
      const unreadMails = await db.messages.filter(m => m.status === 'unread' && m.sender === 'reflection').count();
      expect(unreadMails).toBe(0);
    });

    it('does not create task for different error patterns with <3 mails each', async () => {
      // Pattern A — 2 occurrences
      await addError('pattern-alpha error in module X', { tags: ['task-1'] });
      await addError('pattern-alpha error in module X', { tags: ['task-2'] });

      // Pattern B — 2 occurrences (not enough)
      await addError('pattern-beta failure in module Y', { tags: ['task-1'] });
      await addError('pattern-beta failure in module Y', { tags: ['task-2'] });

      await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], mockContext);

      const tasks = await db.tasks.toArray();
      expect(tasks.length).toBe(0);

      const mails = await db.messages.filter(m => m.sender === 'reflection').count();
      expect(mails).toBe(0); // threshold=3 errors not met, so no rules match
    });
  });

  describe('KNOWN-GAP rule', () => {
    it('tags error as gap-confirmed without reclassifying or sending mail', async () => {
      // Add a gap observation
      await addObservation('Missing docs for auth', { tags: ['gap', 'auth'] });

      // Add an error matching the gap
      await addError('auth module crashed', { tags: ['auth', 'task-1'] });

      const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], mockContext);
      // KNOWN-GAP doesn't reclassify
      expect(result.reclassified).toBe(0);

      // Error should be tagged gap-confirmed
      const entries = await db.kbLog.filter(e => e.active && e.category === 'error').toArray();
      const tagged = entries.find(e => e.tags.includes('gap-confirmed'));
      expect(tagged).toBeDefined();

      // No mail sent
      const mails = await db.messages.toArray();
      expect(mails.filter(m => m.sender === 'reflection')).toHaveLength(0);
    });
  });

  describe('CONSTITUTION-VIOLATION rule', () => {
    it('sends mail for constitution-tagged errors', async () => {
      await addError('Failed to follow artifact rule', { tags: ['constitution', 'task-1'] });
      await addError('Failed to follow artifact rule', { tags: ['constitution', 'task-2'] });

      const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], mockContext);
      expect(result.reclassified).toBe(2);

      const mails = await db.messages.filter(m => m.sender === 'reflection').toArray();
      expect(mails.length).toBeGreaterThanOrEqual(1);
      expect(mails[0].content).toContain('CONSTITUTION');
    });
  });

  it('filters by entryIds when provided', async () => {
    await addError('error A', { tags: ['task-1'] });
    const entry2 = await db.kbLog.add({
      timestamp: Date.now(),
      text: 'error B',
      category: 'error',
      abstraction: 2,
      layer: ['L3'],
      tags: ['task-2'],
      source: 'execution',
      active: true,
      projectId: 'test-project-id',
    } as any);
    await addError('error B', { tags: ['task-3'] });

    // Only reclassify entry2 and the third one (same text)
    const result = await ReflectionHandler.handleRequest(
      'process-reflection.reclassify',
      [{ entryIds: [entry2 as any] }],
      mockContext,
    );

    // Only entry2 considered, but alone it doesn't meet threshold=3
    expect(result.reclassified).toBe(0);
  });

  it('throws on unknown tool', async () => {
    await expect(
      ReflectionHandler.handleRequest('process-reflection.unknown', [], mockContext)
    ).rejects.toThrow('Unknown tool');
  });
});
