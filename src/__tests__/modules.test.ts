/**
 * Tests for knowledge-kb, process-dream, process-reflection modules.
 * Uses fake-indexeddb (vitest setup) and mock LLM calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db, KBEntry } from '../services/db';
import { applyRules } from '../modules/process-reflection/rules';
import { ReflectionHandler } from '../modules/process-reflection/Handler';
import { DreamHandler } from '../modules/process-dream/Handler';
import { KBHandler } from '../modules/knowledge-kb/Handler';
import { scanRepo } from '../modules/knowledge-kb/RepoScanner';
import { FixedKBSource } from '../modules/process-dream/external-kb';

// Helper: build a KBEntry
let nextId = 1;
function makeEntry(overrides: Partial<KBEntry> & { text: string }): KBEntry {
  return {
    id: nextId++,
    timestamp: Date.now(),
    category: 'error',
    abstraction: 2,
    layer: ['L0'],
    tags: [],
    source: 'execution',
    active: true,
    project: 'target',
    ...overrides,
  };
}

// Helper: fake RequestContext
function mockContext(llmResponse: string = 'mock response'): any {
  return {
    taskId: 'test-task',
    repoUrl: '',
    repoBranch: 'main',
    llmCall: vi.fn().mockResolvedValue(llmResponse),
    moduleConfig: {},
  };
}

// Helper: context returning responses in sequence
function trackingContext(responses: string[]): any {
  let callIdx = 0;
  return {
    taskId: 'test-task',
    repoUrl: '',
    repoBranch: 'main',
    llmCall: vi.fn().mockImplementation(() => {
      const resp = responses[callIdx] || responses[responses.length - 1];
      callIdx++;
      return Promise.resolve(resp);
    }),
    moduleConfig: {},
  };
}

beforeEach(async () => {
  nextId = 1;
  // Clear all tables
  await db.kbLog.clear();
  await db.kbDocs.clear();
  await db.tasks.clear();
  await db.projectConfigs.clear();
  await db.messages.clear();
});

// ─── Reflection Rules ───────────────────────────────────────────
describe('applyRules', () => {
  it('Rule 1: SAME-ERROR DIFFERENT-TASK — fires when ≥3 similar errors across ≥2 tasks', () => {
    const errors = [
      makeEntry({ text: 'Failed to parse JSON response from API endpoint', tags: ['task-1'] }),
      makeEntry({ text: 'Failed to parse JSON response from API endpoint', tags: ['task-2'] }),
      makeEntry({ text: 'Failed to parse JSON response from API endpoint', tags: ['task-3'] }),
    ];
    const results = applyRules(errors, errors);
    const match = results.find(r => r.ruleName === 'SAME-ERROR DIFFERENT-TASK');
    expect(match).toBeDefined();
    expect(match!.match).toBe(true);
    expect(match!.entryIds).toHaveLength(3);
    expect(match!.createSelfTask).toBe(true);
    expect(match!.taskTitle).toContain('[self] Fix recurring error');
  });

  it('Rule 1: does NOT fire when errors are from only 1 task', () => {
    const errors = [
      makeEntry({ text: 'Same error here', tags: ['task-1'] }),
      makeEntry({ text: 'Same error here', tags: ['task-1'] }),
      makeEntry({ text: 'Same error here', tags: ['task-1'] }),
    ];
    const results = applyRules(errors, errors);
    expect(results.find(r => r.ruleName === 'SAME-ERROR DIFFERENT-TASK')).toBeUndefined();
  });

  it('Rule 1: does NOT fire when < 3 occurrences', () => {
    const errors = [
      makeEntry({ text: 'Rare error', tags: ['task-1'] }),
      makeEntry({ text: 'Rare error', tags: ['task-2'] }),
    ];
    const results = applyRules(errors, errors);
    expect(results.find(r => r.ruleName === 'SAME-ERROR DIFFERENT-TASK')).toBeUndefined();
  });

  it('Rule 2: CONSTITUTION-VIOLATION — fires when ≥2 errors tagged constitution', () => {
    const errors = [
      makeEntry({ text: 'Constitution rule X prevented action', tags: ['constitution'], project: 'target' }),
      makeEntry({ text: 'Constitution rule Y also failed', tags: ['constitution'], project: 'target' }),
    ];
    const results = applyRules(errors, errors);
    const match = results.find(r => r.ruleName === 'CONSTITUTION-VIOLATION');
    expect(match).toBeDefined();
    expect(match!.entryIds).toHaveLength(2);
    expect(match!.createSelfTask).toBe(true);
  });

  it('Rule 2: ignores self-project constitution errors', () => {
    const errors = [
      makeEntry({ text: 'Error', tags: ['constitution'], project: 'self' }),
      makeEntry({ text: 'Error2', tags: ['constitution'], project: 'self' }),
    ];
    const results = applyRules(errors, errors);
    expect(results.find(r => r.ruleName === 'CONSTITUTION-VIOLATION')).toBeUndefined();
  });

  it('Rule 3: RECURRING-PROTOCOL-FAILURE — fires when executor has ≥3 failures', () => {
    const errors = [
      makeEntry({ text: 'Step 1 failed', tags: ['executor-local'] }),
      makeEntry({ text: 'Step 2 failed', tags: ['executor-local'] }),
      makeEntry({ text: 'Step 3 failed', tags: ['executor-local'] }),
    ];
    const results = applyRules(errors, errors);
    const match = results.find(r => r.ruleName === 'RECURRING-PROTOCOL-FAILURE');
    expect(match).toBeDefined();
    expect(match!.diagnosis).toContain('executor-local');
    expect(match!.taskTitle).toContain('Fix protocol generation');
  });

  it('Rule 4: USER-CORRECTION — fires when user correction overlaps with error tags', () => {
    const errors = [
      makeEntry({ text: 'Build failed', tags: ['task-5', 'build'] }),
    ];
    const allEntries = [
      ...errors,
      makeEntry({ text: 'User override', category: 'correction', source: 'user', tags: ['task-5'] }),
    ];
    const results = applyRules(errors, allEntries);
    const match = results.find(r => r.ruleName === 'USER-CORRECTION');
    expect(match).toBeDefined();
    expect(match!.createSelfTask).toBe(false);
  });

  it('Rule 5: KNOWN-GAP — tags errors matching knowledge gaps', () => {
    const errors = [
      makeEntry({ text: 'Missing config', tags: ['config', 'task-1'] }),
    ];
    const allEntries = [
      ...errors,
      makeEntry({ text: 'GAP: no config docs', category: 'observation', tags: ['gap', 'config'] }),
    ];
    const results = applyRules(errors, allEntries);
    const match = results.find(r => r.ruleName === 'KNOWN-GAP');
    expect(match).toBeDefined();
    expect(match!.createSelfTask).toBe(false);
  });

  it('returns empty array when no rules match', () => {
    const errors = [
      makeEntry({ text: 'Unique error A', tags: ['task-1'] }),
      makeEntry({ text: 'Unique error B', tags: ['task-2'] }),
    ];
    const results = applyRules(errors, errors);
    expect(results).toHaveLength(0);
  });

  it('Rule 3: does NOT fire when < 3 executor failures', () => {
    const errors = [
      makeEntry({ text: 'Fail 1', tags: ['executor-local'] }),
      makeEntry({ text: 'Fail 2', tags: ['executor-local'] }),
    ];
    const results = applyRules(errors, errors);
    expect(results.find(r => r.ruleName === 'RECURRING-PROTOCOL-FAILURE')).toBeUndefined();
  });

  it('Rule 4: does NOT fire when correction has no overlapping tags with errors', () => {
    const errors = [
      makeEntry({ text: 'Build failed', tags: ['task-5', 'build'] }),
    ];
    const allEntries = [
      ...errors,
      makeEntry({ text: 'User override', category: 'correction', source: 'user', tags: ['task-99'] }),
    ];
    const results = applyRules(errors, allEntries);
    expect(results.find(r => r.ruleName === 'USER-CORRECTION')).toBeUndefined();
  });

  it('Rule 5: does NOT fire when no gap tags match error tags', () => {
    const errors = [
      makeEntry({ text: 'Missing config', tags: ['config', 'task-1'] }),
    ];
    const allEntries = [
      ...errors,
      makeEntry({ text: 'GAP: no API docs', category: 'observation', tags: ['gap', 'api'] }),
    ];
    const results = applyRules(errors, allEntries);
    expect(results.find(r => r.ruleName === 'KNOWN-GAP')).toBeUndefined();
  });

  it('applyRules respects custom threshold parameter', () => {
    const errors = [
      makeEntry({ text: 'Rare error X', tags: ['task-1'] }),
      makeEntry({ text: 'Rare error X', tags: ['task-2'] }),
    ];
    // Default threshold=3: no match
    expect(applyRules(errors, errors).find(r => r.ruleName === 'SAME-ERROR DIFFERENT-TASK')).toBeUndefined();
    // threshold=2: matches
    const results = applyRules(errors, errors, 2);
    expect(results.find(r => r.ruleName === 'SAME-ERROR DIFFERENT-TASK')).toBeDefined();
  });

  it('multiple rules can fire simultaneously', () => {
    const errors = [
      makeEntry({ text: 'Failed to parse JSON', tags: ['task-1', 'executor-local'] }),
      makeEntry({ text: 'Failed to parse JSON', tags: ['task-2', 'executor-local'] }),
      makeEntry({ text: 'Failed to parse JSON', tags: ['task-3', 'executor-local'] }),
    ];
    const results = applyRules(errors, errors);
    const ruleNames = results.map(r => r.ruleName);
    expect(ruleNames).toContain('SAME-ERROR DIFFERENT-TASK');
    expect(ruleNames).toContain('RECURRING-PROTOCOL-FAILURE');
  });

  it('Rule 1 + Rule 5 on same entries: KNOWN-GAP does not overwrite Rule 1 project change', async () => {
    // Seed 3 same errors across 3 tasks + a gap observation sharing a tag
    await db.kbLog.add(makeEntry({ text: 'Config error X', tags: ['task-1', 'config'], category: 'error', source: 'execution', project: 'target' }));
    await db.kbLog.add(makeEntry({ text: 'Config error X', tags: ['task-2', 'config'], category: 'error', source: 'execution', project: 'target' }));
    await db.kbLog.add(makeEntry({ text: 'Config error X', tags: ['task-3', 'config'], category: 'error', source: 'execution', project: 'target' }));
    // Gap shares 'config' tag with errors
    await db.kbLog.add(makeEntry({ text: 'GAP: no config docs', category: 'observation', tags: ['gap', 'config'], source: 'execution', project: 'target' }));

    const ctx = mockContext();
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], ctx);

    // Rule 1 should have reclassified errors to self
    expect(result.reclassified).toBe(3);

    // KNOWN-GAP should have also tagged them gap-confirmed
    const errors = await db.kbLog.filter(e => e.category === 'error' && e.source === 'execution').toArray();
    expect(errors.every(e => e.project === 'self')).toBe(true);
    expect(errors.every(e => e.tags.includes('gap-confirmed'))).toBe(true);
  });

  it('Rule 1 + Rule 3 + Rule 5 on same entries: all mutations coexist', async () => {
    // 3 same errors across 3 tasks, all from same executor, sharing tag with gap
    await db.kbLog.add(makeEntry({ text: 'Build step failed', tags: ['task-1', 'executor-local', 'build'], category: 'error', source: 'execution', project: 'target' }));
    await db.kbLog.add(makeEntry({ text: 'Build step failed', tags: ['task-2', 'executor-local', 'build'], category: 'error', source: 'execution', project: 'target' }));
    await db.kbLog.add(makeEntry({ text: 'Build step failed', tags: ['task-3', 'executor-local', 'build'], category: 'error', source: 'execution', project: 'target' }));
    await db.kbLog.add(makeEntry({ text: 'GAP: no build docs', category: 'observation', tags: ['gap', 'build'], source: 'execution', project: 'target' }));

    const ctx = mockContext();
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], ctx);

    // All 3 errors reclassified to self
    expect(result.reclassified).toBe(3);

    const errors = await db.kbLog.filter(e => e.category === 'error' && e.source === 'execution').toArray();
    // project='self' from Rule 1
    expect(errors.every(e => e.project === 'self')).toBe(true);
    // gap-confirmed tag from Rule 5
    expect(errors.every(e => e.tags.includes('gap-confirmed'))).toBe(true);
    // Self-task created (Rule 1 or Rule 3)
    const tasks = await db.tasks.toArray();
    expect(tasks.filter(t => t.project === 'self').length).toBeGreaterThan(0);
  });
});

// ─── Reflection Handler ─────────────────────────────────────────
describe('ReflectionHandler', () => {
  async function seedErrors(entries: Partial<KBEntry>[]) {
    for (const e of entries) {
      await db.kbLog.add(makeEntry(e as any));
    }
  }

  it('reclassify returns 0 when no matching errors', async () => {
    await seedErrors([
      { text: 'Not an error', category: 'observation', source: 'execution', project: 'target', active: true },
    ]);
    const ctx = mockContext();
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], ctx);
    expect(result.reclassified).toBe(0);
  });

  it('reclassify skips inactive entries', async () => {
    await seedErrors([
      { text: 'Old error', category: 'error', source: 'execution', project: 'target', active: false },
      { text: 'Another old', category: 'error', source: 'execution', project: 'target', active: false },
      { text: 'Third old', category: 'error', source: 'execution', project: 'target', active: false },
    ]);
    const ctx = mockContext();
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], ctx);
    expect(result.reclassified).toBe(0);
  });

  it('reclassify changes project to "self" for matched rules', async () => {
    // Seed 3 same errors across different tasks to trigger SAME-ERROR DIFFERENT-TASK
    await seedErrors([
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-1'] },
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-2'] },
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-3'] },
    ]);
    const ctx = mockContext();
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], ctx);
    expect(result.reclassified).toBe(3);
    expect(result.results.length).toBeGreaterThan(0);

    // Verify DB entries were reclassified
    const selfEntries = await db.kbLog.filter(e => e.active).toArray();
    const reclassified = selfEntries.filter(e => e.project === 'self' && e.category === 'error');
    expect(reclassified).toHaveLength(3);
  });

  it('reclassify appends a reflection entry to KB log', async () => {
    await seedErrors([
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-1'] },
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-2'] },
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-3'] },
    ]);
    const ctx = mockContext();
    await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], ctx);

    const entries = await db.kbLog.toArray();
    const reflection = entries.find(e => e.category === 'correction' && e.source === 'dream:session');
    expect(reflection).toBeDefined();
    expect(reflection!.project).toBe('self');
    expect(reflection!.tags).toContain('reflection');
  });

  it('reclassify creates self-task when rule requests it', async () => {
    await seedErrors([
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-1'] },
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-2'] },
      { text: 'Failed to parse JSON response', category: 'error', source: 'execution', project: 'target', tags: ['task-3'] },
    ]);
    const ctx = mockContext();
    await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], ctx);

    const tasks = await db.tasks.toArray();
    const selfTasks = tasks.filter(t => t.project === 'self');
    expect(selfTasks.length).toBeGreaterThan(0);
    expect(selfTasks[0].title).toContain('[self]');
  });

  it('reclassify: KNOWN-GAP tags entries but does not reclassify to self', async () => {
    // Seed 1 error + 1 gap observation sharing a tag
    await seedErrors([
      { text: 'Config error', category: 'error', source: 'execution', project: 'target', tags: ['config', 'task-1'] },
    ]);
    await db.kbLog.add(makeEntry({
      text: 'GAP: no config docs', category: 'observation', tags: ['gap', 'config'],
      source: 'execution', project: 'target',
    }));

    const ctx = mockContext();
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{}], ctx);

    // Should return 0 reclassified (KNOWN-GAP doesn't reclassify)
    expect(result.reclassified).toBe(0);

    // Error should still be project='target', but tagged gap-confirmed
    const errors = await db.kbLog.filter(e => e.category === 'error').toArray();
    expect(errors).toHaveLength(1);
    expect(errors[0].project).toBe('target');
    expect(errors[0].tags).toContain('gap-confirmed');
  });

  it('reclassify with entryIds filters to specific entries', async () => {
    await seedErrors([
      { text: 'Error A', category: 'error', source: 'execution', project: 'target', tags: ['task-1'] },
      { text: 'Error B', category: 'error', source: 'execution', project: 'target', tags: ['task-2'] },
      { text: 'Error C', category: 'error', source: 'execution', project: 'target', tags: ['task-3'] },
    ]);
    // Only pass id 1 (won't trigger any rule — too few)
    const ctx = mockContext();
    const result = await ReflectionHandler.handleRequest('process-reflection.reclassify', [{ entryIds: [1] }], ctx);
    expect(result.reclassified).toBe(0);
  });

  it('throws for unknown tool name', async () => {
    const ctx = mockContext();
    await expect(ReflectionHandler.handleRequest('bogus', [], ctx)).rejects.toThrow('Unknown tool');
  });
});

// ─── Dream Handler ──────────────────────────────────────────────
describe('DreamHandler', () => {
  it('throws for unknown tool name', async () => {
    const ctx = mockContext();
    await expect(DreamHandler.handleRequest('bogus', [], ctx)).rejects.toThrow('Unknown tool');
  });

  it('dispatches microDream correctly', async () => {
    // Seed 3+ entries for the same task tag
    for (let i = 0; i < 4; i++) {
      await db.kbLog.add(makeEntry({
        text: `Raw observation ${i}`,
        category: 'observation',
        abstraction: 1,
        tags: ['task-42'],
        source: 'execution',
        project: 'target',
      }));
    }
    const ctx = mockContext('Consolidated: observations show pattern X');
    const result = await DreamHandler.handleRequest('process-dream.microDream', [{ taskId: 'task-42' }], ctx);
    expect(result).toContain('Micro-dream');

    // Should have added a dream entry and deactivated originals
    const active = await db.kbLog.filter(e => e.active).toArray();
    const dreams = active.filter(e => e.source === 'dream:micro' && e.category === 'insight');
    expect(dreams).toHaveLength(1);
    expect(dreams[0].abstraction).toBe(5);

    // Should also have executor outcome entry
    const outcomes = active.filter(e => e.source === 'dream:micro' && e.tags.includes('executor-outcome'));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].text).toContain('task-42');
    expect(outcomes[0].abstraction).toBe(3);
  });

  it('microDream sets supersedes to original entry ids', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await db.kbLog.add(makeEntry({
        text: `Raw ${i}`, category: 'observation', abstraction: 1,
        tags: ['task-55'], source: 'execution', project: 'target',
      }));
      ids.push(id);
    }
    const ctx = mockContext('Consolidated observation');
    await DreamHandler.handleRequest('process-dream.microDream', [{ taskId: 'task-55' }], ctx);

    const dreams = await db.kbLog.filter(e => e.source === 'dream:micro' && e.category === 'insight').toArray();
    expect(dreams).toHaveLength(1);
    expect(dreams[0].supersedes).toEqual(ids);
  });

  it('microDream merges tags from all entries (union)', async () => {
    await db.kbLog.add(makeEntry({
      text: 'Obs 1', category: 'observation', abstraction: 1,
      tags: ['task-77', 'react'], source: 'execution',
    }));
    await db.kbLog.add(makeEntry({
      text: 'Obs 2', category: 'observation', abstraction: 1,
      tags: ['task-77', 'api'], source: 'execution',
    }));
    await db.kbLog.add(makeEntry({
      text: 'Obs 3', category: 'observation', abstraction: 1,
      tags: ['task-77', 'react', 'backend'], source: 'execution',
    }));
    const ctx = mockContext('Consolidated');
    await DreamHandler.handleRequest('process-dream.microDream', [{ taskId: 'task-77' }], ctx);

    const dreams = await db.kbLog.filter(e => e.source === 'dream:micro' && e.category === 'insight').toArray();
    expect(dreams).toHaveLength(1);
    expect(dreams[0].tags.sort()).toEqual(['api', 'backend', 'consolidation', 'react', 'task-77'].sort());
  });

  it('microDream executor outcome records error count', async () => {
    // 2 observations + 1 error
    await db.kbLog.add(makeEntry({
      text: 'Obs', category: 'observation', abstraction: 1,
      tags: ['task-88'], source: 'execution',
    }));
    await db.kbLog.add(makeEntry({
      text: 'Obs 2', category: 'observation', abstraction: 1,
      tags: ['task-88'], source: 'execution',
    }));
    await db.kbLog.add(makeEntry({
      text: 'Error', category: 'error', abstraction: 1,
      tags: ['task-88'], source: 'execution',
    }));
    const ctx = mockContext('Consolidated');
    await DreamHandler.handleRequest('process-dream.microDream', [{ taskId: 'task-88' }], ctx);

    const outcomes = await db.kbLog.filter(e => e.tags.includes('executor-outcome') && e.active).toArray();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].text).toContain('2 success');
    expect(outcomes[0].text).toContain('1 errors');
  });

  it('microDream skips when < 3 entries', async () => {
    await db.kbLog.add(makeEntry({
      text: 'Only one entry',
      category: 'observation',
      abstraction: 1,
      tags: ['task-99'],
      source: 'execution',
    }));
    const ctx = mockContext();
    const result = await DreamHandler.handleRequest('process-dream.microDream', [{ taskId: 'task-99' }], ctx);
    expect(result).toContain('only 1 raw entries');
    expect(ctx.llmCall).not.toHaveBeenCalled();
  });

  it('sessionDream recognizes patterns from active entries', async () => {
    // Seed execution + micro-dream entries
    for (let i = 0; i < 5; i++) {
      await db.kbLog.add(makeEntry({
        text: `Execution observation ${i}`,
        category: 'observation',
        abstraction: 2,
        tags: ['task-1'],
        source: 'execution',
      }));
    }
    await db.kbLog.add(makeEntry({
      text: 'Micro dream summary',
      category: 'insight',
      abstraction: 5,
      tags: ['task-1'],
      source: 'dream:micro',
    }));

    const mockJson = JSON.stringify({
      patterns: [{ text: 'Pattern: recurring parsing issues', tags: ['parsing'] }],
      failures: [{ text: 'Failure: API timeouts', tags: ['api'] }],
      strategies: [{ text: 'Strategy: add retry logic', tags: ['reliability'] }],
      docGaps: [{ text: 'Gap: no API docs', tags: ['docs'] }],
    });
    const ctx = mockContext(mockJson);

    const result = await DreamHandler.handleRequest('process-dream.sessionDream', [], ctx);
    // sessionDream now returns { dream, reflection } via Handler
    expect(result.dream).toContain('Session-dream');
    expect(ctx.llmCall).toHaveBeenCalled();

    // Check new entries were added
    const entries = await db.kbLog.toArray();
    const patterns = entries.filter(e => e.category === 'insight' && e.source === 'dream:session');
    expect(patterns).toHaveLength(1);

    const errors = entries.filter(e => e.category === 'error' && e.source === 'dream:session');
    expect(errors).toHaveLength(1);

    const decisions = entries.filter(e => e.category === 'decision' && e.source === 'dream:session');
    expect(decisions).toHaveLength(1);

    const gaps = entries.filter(e => e.tags.includes('gap') && e.source === 'dream:session');
    expect(gaps).toHaveLength(1);
  });

  it('sessionDream returns early when no active entries', async () => {
    const ctx = mockContext();
    const result = await DreamHandler.handleRequest('process-dream.sessionDream', [], ctx);
    expect(result.dream).toContain('no active entries');
    expect(ctx.llmCall).not.toHaveBeenCalled();
  });

  it('sessionDream handles malformed LLM JSON gracefully', async () => {
    for (let i = 0; i < 3; i++) {
      await db.kbLog.add(makeEntry({
        text: `Obs ${i}`,
        category: 'observation',
        source: 'execution',
      }));
    }
    const ctx = mockContext('not valid json at all');
    const result = await DreamHandler.handleRequest('process-dream.sessionDream', [], ctx);
    expect(result.dream).toContain('Session-dream');
    // Should complete without throwing
  });

  it('sessionDream deactivates superseded entries (execution + micro-dream inputs)', async () => {
    // Seed execution and micro-dream entries
    for (let i = 0; i < 3; i++) {
      await db.kbLog.add(makeEntry({
        text: `Execution obs ${i}`, category: 'observation', abstraction: 2,
        source: 'execution', tags: ['task-1'],
      }));
    }
    await db.kbLog.add(makeEntry({
      text: 'Micro summary', category: 'insight', abstraction: 5,
      source: 'dream:micro', tags: ['task-1'],
    }));

    const mockJson = JSON.stringify({
      patterns: [{ text: 'Some pattern', tags: ['test'] }],
      failures: [], strategies: [], docGaps: [],
    });
    const ctx = mockContext(mockJson);
    await DreamHandler.handleRequest('process-dream.sessionDream', [], ctx);

    // Original observation entries should be deactivated
    const all = await db.kbLog.toArray();
    const execObs = all.filter(e => e.source === 'execution' && e.category === 'observation');
    expect(execObs.every(e => !e.active)).toBe(true);

    // Micro-dream entries should be deactivated
    const micro = all.filter(e => e.source === 'dream:micro');
    expect(micro.every(e => !e.active)).toBe(true);

    // Session-dream insights should be active
    const session = all.filter(e => e.source === 'dream:session');
    expect(session.length).toBeGreaterThan(0);
    expect(session.every(e => e.active)).toBe(true);
  });

  it('sessionDream does NOT deactivate error entries', async () => {
    // Errors must survive for process-reflection to analyze
    await db.kbLog.add(makeEntry({
      text: 'An error', category: 'error', abstraction: 2,
      source: 'execution', tags: ['task-1'],
    }));
    await db.kbLog.add(makeEntry({
      text: 'Observation', category: 'observation', abstraction: 2,
      source: 'execution', tags: ['task-1'],
    }));

    const mockJson = JSON.stringify({
      patterns: [], failures: [], strategies: [], docGaps: [],
    });
    const ctx = mockContext(mockJson);
    await DreamHandler.handleRequest('process-dream.sessionDream', [], ctx);

    const all = await db.kbLog.toArray();
    const errors = all.filter(e => e.category === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every(e => e.active)).toBe(true);
  });

  it('deepDream adds strategic insight and prunes old raw entries', async () => {
    const sevenDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    // Old raw entries (should be pruned)
    for (let i = 0; i < 3; i++) {
      await db.kbLog.add(makeEntry({
        text: `Old raw ${i}`,
        category: 'observation',
        abstraction: 1,
        source: 'execution',
        timestamp: sevenDaysAgo,
      }));
    }
    // Recent entry (should survive)
    await db.kbLog.add(makeEntry({
      text: 'Recent entry',
      category: 'observation',
      abstraction: 3,
      source: 'execution',
      timestamp: Date.now(),
    }));
    // High-abstraction entry (should survive even if old)
    await db.kbLog.add(makeEntry({
      text: 'Strategic insight',
      category: 'insight',
      abstraction: 8,
      source: 'dream:deep',
      timestamp: sevenDaysAgo,
    }));

    const ctx = trackingContext([
      'Strategic insight: focus on reliability',
      'No amendments needed',
    ]);
    const result = await DreamHandler.handleRequest('process-dream.deepDream', [], ctx);
    expect(result).toContain('Deep-dream');

    // Verify strategic insight was added
    const entries = await db.kbLog.toArray();
    const deepDreams = entries.filter(e => e.source === 'dream:deep' && e.category === 'insight');
    expect(deepDreams.length).toBeGreaterThan(0);

    // Verify old raw entries were deactivated
    const active = await db.kbLog.filter(e => e.active).toArray();
    const oldRaw = active.filter(e => e.abstraction <= 2 && e.timestamp < Date.now() - 7 * 24 * 60 * 60 * 1000 && e.source === 'execution');
    expect(oldRaw).toHaveLength(0);
  });

  it('deepDream proposes constitution amendments when LLM suggests them', async () => {
    await db.kbLog.add(makeEntry({ text: 'Some entry', category: 'observation', source: 'execution' }));
    const ctx = trackingContext([
      'Strategic insight',
      'Constitutional amendment: change rule X',
    ]);

    await DreamHandler.handleRequest('process-dream.deepDream', [], ctx);

    const entries = await db.kbLog.toArray();
    const amendment = entries.find(e => e.category === 'decision' && e.tags.includes('constitution-amendment'));
    expect(amendment).toBeDefined();
    expect(amendment!.project).toBe('self');

    // Should also create an AgentMessage for user approval
    const messages = await db.messages.toArray();
    const proposal = messages.find(m => m.type === 'proposal' && m.sender === 'dream:deep');
    expect(proposal).toBeDefined();
    expect(proposal!.content).toContain('amendment');
    expect(proposal!.status).toBe('unread');
    expect(proposal!.proposedTask).toBeDefined();
  });

  it('deepDream skips amendment when LLM says none needed', async () => {
    await db.kbLog.add(makeEntry({ text: 'Some entry', category: 'observation', source: 'execution' }));
    const ctx = trackingContext([
      'Strategic insight',
      'No amendments needed',
    ]);

    await DreamHandler.handleRequest('process-dream.deepDream', [], ctx);

    const entries = await db.kbLog.toArray();
    const amendment = entries.find(e => e.category === 'decision' && e.tags.includes('constitution-amendment'));
    expect(amendment).toBeUndefined();

    // No proposal message should be created
    const messages = await db.messages.toArray();
    expect(messages.filter(m => m.type === 'proposal')).toHaveLength(0);
  });

  it('deepDream constitution amendment — approved via user:reply', async () => {
    // Seed a project config with existing constitution
    await db.projectConfigs.add({ id: 'default', constitution: 'Existing rules', updatedAt: Date.now() });
    await db.kbLog.add(makeEntry({ text: 'Some entry', category: 'observation', source: 'execution' }));
    const ctx = trackingContext([
      'Strategic insight',
      'New rule: always write tests first',
    ]);

    await DreamHandler.handleRequest('process-dream.deepDream', [], ctx);

    // Find the proposal message
    const messages = await db.messages.toArray();
    const proposal = messages.find(m => m.type === 'proposal' && m.sender === 'dream:deep');
    expect(proposal).toBeDefined();
    expect(proposal!.status).toBe('unread');

    // Simulate user approval via event bus
    const { eventBus } = await import('../../src/core/event-bus');
    eventBus.emit('user:reply', {
      taskId: 'test-task',
      content: 'approved',
      messageId: proposal!.id,
    });
    // Allow async handler to run
    await new Promise(r => setTimeout(r, 10));

    // Constitution should be updated
    const config = await db.projectConfigs.get('default');
    expect(config!.constitution).toContain('New rule: always write tests first');
    expect(config!.constitution).toContain('Existing rules');

    // Message should be marked read
    const updated = await db.messages.get(proposal!.id!);
    expect(updated!.status).toBe('read');
  });

  it('deepDream constitution amendment — rejected via user:reply', async () => {
    await db.projectConfigs.add({ id: 'default', constitution: 'Existing rules', updatedAt: Date.now() });
    await db.kbLog.add(makeEntry({ text: 'Some entry', category: 'observation', source: 'execution' }));
    const ctx = trackingContext([
      'Strategic insight',
      'Bad amendment: delete all tests',
    ]);

    await DreamHandler.handleRequest('process-dream.deepDream', [], ctx);

    const messages = await db.messages.toArray();
    const proposal = messages.find(m => m.type === 'proposal' && m.sender === 'dream:deep');

    // Simulate user rejection
    const { eventBus } = await import('../../src/core/event-bus');
    eventBus.emit('user:reply', {
      taskId: 'test-task',
      content: 'no, rejected',
      messageId: proposal!.id,
    });
    await new Promise(r => setTimeout(r, 10));

    // Constitution should NOT be updated
    const config = await db.projectConfigs.get('default');
    expect(config!.constitution).toBe('Existing rules');

    // Message should still be marked read
    const updated = await db.messages.get(proposal!.id!);
    expect(updated!.status).toBe('read');
  });
});

// ─── KB Handler ─────────────────────────────────────────────────
describe('KBHandler', () => {
  it('throws for unknown tool name', async () => {
    const ctx = mockContext();
    await expect(KBHandler.handleRequest('bogus', [], ctx)).rejects.toThrow('Unknown tool');
  });

  it('recordEntry creates a KB log entry', async () => {
    const ctx = mockContext();
    const id = await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Test observation',
      category: 'observation',
      abstraction: 3,
      layer: ['L0'],
      tags: ['test'],
      source: 'execution',
    }], ctx);
    expect(id).toBeGreaterThan(0);

    const entry = await db.kbLog.get(id);
    expect(entry).toBeDefined();
    expect(entry!.text).toBe('Test observation');
    expect(entry!.active).toBe(true);
    expect(entry!.project).toBe('target');
  });

  it('recordEntry respects project param', async () => {
    const ctx = mockContext();
    const id = await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Self note',
      category: 'decision',
      abstraction: 5,
      layer: ['L0'],
      tags: [],
      source: 'user',
      project: 'self',
    }], ctx);
    const entry = await db.kbLog.get(id);
    expect(entry!.project).toBe('self');
  });

  it('queryLog filters by category', async () => {
    await db.kbLog.add(makeEntry({ text: 'Error 1', category: 'error' }));
    await db.kbLog.add(makeEntry({ text: 'Pattern 1', category: 'insight' }));
    await db.kbLog.add(makeEntry({ text: 'Error 2', category: 'error' }));

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryLog', [{ category: 'error' }], ctx);
    expect(results).toHaveLength(2);
    expect(results.every((e: KBEntry) => e.category === 'error')).toBe(true);
  });

  it('queryLog filters by active status', async () => {
    await db.kbLog.add(makeEntry({ text: 'Active', active: true }));
    await db.kbLog.add(makeEntry({ text: 'Inactive', active: false }));

    const ctx = mockContext();
    const active = await KBHandler.handleRequest('knowledge-kb.queryLog', [{ active: true }], ctx);
    expect(active).toHaveLength(1);
    expect(active[0].text).toBe('Active');

    const inactive = await KBHandler.handleRequest('knowledge-kb.queryLog', [{ active: false }], ctx);
    expect(inactive).toHaveLength(1);
    expect(inactive[0].text).toBe('Inactive');
  });

  it('queryLog filters by tags (any match)', async () => {
    await db.kbLog.add(makeEntry({ text: 'A', tags: ['react', 'frontend'] }));
    await db.kbLog.add(makeEntry({ text: 'B', tags: ['backend', 'api'] }));
    await db.kbLog.add(makeEntry({ text: 'C', tags: ['react', 'backend'] }));

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryLog', [{ tags: ['react'] }], ctx);
    expect(results).toHaveLength(2);
  });

  it('queryLog filters by project', async () => {
    await db.kbLog.add(makeEntry({ text: 'Target entry', project: 'target' }));
    await db.kbLog.add(makeEntry({ text: 'Self entry', project: 'self' }));

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryLog', [{ project: 'self' }], ctx);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Self entry');
  });

  it('queryLog filters by source', async () => {
    await db.kbLog.add(makeEntry({ text: 'Exec', source: 'execution' }));
    await db.kbLog.add(makeEntry({ text: 'Dream', source: 'dream:micro' }));

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryLog', [{ source: 'dream:micro' }], ctx);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Dream');
  });

  it('queryLog filters by layer', async () => {
    await db.kbLog.add(makeEntry({ text: 'L0 only', layer: ['L0'] }));
    await db.kbLog.add(makeEntry({ text: 'L0+L1', layer: ['L0', 'L1'] }));
    await db.kbLog.add(makeEntry({ text: 'L2', layer: ['L2'] }));

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryLog', [{ layer: 'L1' }], ctx);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('L0+L1');
  });

  it('queryLog respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await db.kbLog.add(makeEntry({ text: `Entry ${i}` }));
    }
    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryLog', [{ limit: 3 }], ctx);
    expect(results).toHaveLength(3);
  });

  it('queryLog sorts by abstraction desc then timestamp desc', async () => {
    await db.kbLog.add(makeEntry({ text: 'Low', abstraction: 1, timestamp: 100 }));
    await db.kbLog.add(makeEntry({ text: 'High', abstraction: 9, timestamp: 50 }));
    await db.kbLog.add(makeEntry({ text: 'Mid', abstraction: 5, timestamp: 200 }));

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryLog', [{}], ctx);
    expect(results[0].text).toBe('High');
    expect(results[1].text).toBe('Mid');
    expect(results[2].text).toBe('Low');
  });

  it('updateEntries modifies existing entries', async () => {
    const id = await db.kbLog.add(makeEntry({ text: 'Original', tags: ['old'] }));
    const ctx = mockContext();
    await KBHandler.handleRequest('knowledge-kb.updateEntries', [{ ids: [id], changes: { text: 'Updated', tags: ['new'] } }], ctx);
    const entry = await db.kbLog.get(id);
    expect(entry!.text).toBe('Updated');
    expect(entry!.tags).toEqual(['new']);
  });

  it('saveDocument creates new doc', async () => {
    const ctx = mockContext();
    const id = await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
      title: 'Architecture Guide',
      type: 'design',
      content: '## Overview\n...',
      summary: 'System architecture overview',
      tags: ['architecture'],
      layer: ['L0', 'L1'],
      source: 'upload',
    }], ctx);
    expect(id).toBeGreaterThan(0);

    const doc = await db.kbDocs.get(id);
    expect(doc!.title).toBe('Architecture Guide');
    expect(doc!.version).toBe(1);
  });

  it('saveDocument upserts existing doc by title+project', async () => {
    const ctx = mockContext();
    const id1 = await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
      title: 'API Reference',
      type: 'reference',
      content: 'v1 content',
      summary: 'API docs v1',
      tags: ['api'],
      layer: ['L3'],
      source: 'repo-scan',
    }], ctx);

    const id2 = await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
      title: 'API Reference',
      type: 'reference',
      content: 'v2 content',
      summary: 'API docs v2',
      tags: ['api'],
      layer: ['L3'],
      source: 'repo-scan',
    }], ctx);

    expect(id2).toBe(id1); // Same ID = updated

    const doc = await db.kbDocs.get(id1);
    expect(doc!.content).toBe('v2 content');
    expect(doc!.version).toBe(2);
  });

  it('saveDocument treats different projects as different docs', async () => {
    const ctx = mockContext();
    const id1 = await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
      title: 'Guide',
      type: 'readme',
      content: 'Target guide',
      summary: 'For target',
      tags: [],
      layer: ['L0'],
      source: 'upload',
      project: 'target',
    }], ctx);

    const id2 = await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
      title: 'Guide',
      type: 'readme',
      content: 'Self guide',
      summary: 'For self',
      tags: [],
      layer: ['L0'],
      source: 'upload',
      project: 'self',
    }], ctx);

    expect(id2).not.toBe(id1); // Different IDs = different docs
  });

  it('queryDocs filters by type, project, and tags', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Spec A', type: 'spec', content: '',
      summary: 'Spec', tags: ['api'], layer: ['L0'], source: 'upload',
      active: true, version: 1, project: 'target',
    });
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Design B', type: 'design', content: '',
      summary: 'Design', tags: ['ui'], layer: ['L0'], source: 'upload',
      active: true, version: 1, project: 'target',
    });
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Self Spec', type: 'spec', content: '',
      summary: 'Self', tags: ['internal'], layer: ['L0'], source: 'upload',
      active: true, version: 1, project: 'self',
    });

    const ctx = mockContext();

    const specs = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ type: 'spec' }], ctx);
    expect(specs).toHaveLength(2);

    const targetSpecs = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ type: 'spec', project: 'target' }], ctx);
    expect(targetSpecs).toHaveLength(1);
    expect(targetSpecs[0].title).toBe('Spec A');

    const tagged = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ tags: ['ui'] }], ctx);
    expect(tagged).toHaveLength(1);
  });

  it('queryDocs filters by source', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Uploaded', type: 'spec', content: '',
      summary: '', tags: [], layer: ['L0'], source: 'upload',
      active: true, version: 1, project: 'target',
    });
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Scanned', type: 'spec', content: '',
      summary: '', tags: [], layer: ['L0'], source: 'repo-scan',
      active: true, version: 1, project: 'target',
    });

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ source: 'repo-scan' }], ctx);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Scanned');
  });

  it('queryDocs filters by layer', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'L0 Doc', type: 'spec', content: '',
      summary: '', tags: [], layer: ['L0'], source: 'upload',
      active: true, version: 1, project: 'target',
    });
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'L1 Doc', type: 'spec', content: '',
      summary: '', tags: [], layer: ['L1'], source: 'upload',
      active: true, version: 1, project: 'target',
    });
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'L0+L1 Doc', type: 'spec', content: '',
      summary: '', tags: [], layer: ['L0', 'L1'], source: 'upload',
      active: true, version: 1, project: 'target',
    });

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ layer: 'L1' }], ctx);
    expect(results).toHaveLength(2);
    expect(results.map((r: any) => r.title).sort()).toEqual(['L0+L1 Doc', 'L1 Doc']);
  });

  it('queryDocs respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await db.kbDocs.add({
        timestamp: Date.now() + i, title: `Doc ${i}`, type: 'spec', content: '',
        summary: '', tags: [], layer: ['L0'], source: 'upload',
        active: true, version: 1, project: 'target',
      });
    }

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ limit: 2 }], ctx);
    expect(results).toHaveLength(2);
  });

  it('queryDocs excludes inactive docs', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Active', type: 'spec', content: '',
      summary: '', tags: [], layer: ['L0'], source: 'upload',
      active: true, version: 1, project: 'target',
    });
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Inactive', type: 'spec', content: '',
      summary: '', tags: [], layer: ['L0'], source: 'upload',
      active: false, version: 1, project: 'target',
    });

    const ctx = mockContext();
    const results = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{}], ctx);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Active');
  });

  it('queryDocs full-text search matches title, summary, and content', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'React Patterns', type: 'spec',
      content: 'Use hooks for state management', summary: 'Common React patterns',
      tags: [], layer: ['L0'], source: 'upload', active: true, version: 1, project: 'target',
    });
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Database Design', type: 'reference',
      content: 'Normalization and indexing strategies', summary: 'SQL best practices',
      tags: [], layer: ['L0'], source: 'upload', active: true, version: 1, project: 'target',
    });

    const ctx = mockContext();
    // Search by title keyword
    const byTitle = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ search: 'React' }], ctx);
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0].title).toBe('React Patterns');

    // Search by content keyword
    const byContent = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ search: 'hooks' }], ctx);
    expect(byContent).toHaveLength(1);
    expect(byContent[0].title).toBe('React Patterns');

    // Search by summary keyword
    const bySummary = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ search: 'SQL' }], ctx);
    expect(bySummary).toHaveLength(1);
    expect(bySummary[0].title).toBe('Database Design');

    // Search that matches nothing
    const noMatch = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{ search: 'webpack' }], ctx);
    expect(noMatch).toHaveLength(0);
  });

  it('updateDocument — updates fields and increments version', async () => {
    const id = await db.kbDocs.add({
      timestamp: Date.now(), title: 'Old Title', type: 'spec', content: 'old',
      summary: 'old summary', tags: ['a'], layer: ['L0'], source: 'upload',
      active: true, version: 1, project: 'target',
    });

    const ctx = mockContext();
    await KBHandler.handleRequest('knowledge-kb.updateDocument', [{
      id, changes: { title: 'New Title', content: 'new content', tags: ['a', 'b'] }
    }], ctx);

    const doc = await db.kbDocs.get(id);
    expect(doc!.title).toBe('New Title');
    expect(doc!.content).toBe('new content');
    expect(doc!.tags).toEqual(['a', 'b']);
    expect(doc!.version).toBe(2);
  });

  it('updateDocument — throws on missing id', async () => {
    const ctx = mockContext();
    await expect(
      KBHandler.handleRequest('knowledge-kb.updateDocument', [{ id: 9999, changes: { title: 'x' } }], ctx)
    ).rejects.toThrow('Document 9999 not found');
  });

  it('deleteDocument — soft-deletes (active=false)', async () => {
    const id = await db.kbDocs.add({
      timestamp: Date.now(), title: 'To Delete', type: 'reference', content: '',
      summary: '', tags: [], layer: ['L0'], source: 'upload',
      active: true, version: 1, project: 'target',
    });

    const ctx = mockContext();
    await KBHandler.handleRequest('knowledge-kb.deleteDocument', [{ id }], ctx);

    const doc = await db.kbDocs.get(id);
    expect(doc!.active).toBe(false);

    // queryDocs should not return it
    const results = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{}], ctx);
    expect(results.find((d: any) => d.id === id)).toBeUndefined();
  });
});

// ─── KB Writer Convenience Functions ───────────────────────────
describe('KBHandler convenience writers', () => {
  it('recordExecution — creates entry with correct defaults', async () => {
    const id = await KBHandler.recordExecution('Built feature X', ['task-1']);
    expect(id).toBeGreaterThan(0);
    const entries = await db.kbLog.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('observation');
    expect(entries[0].abstraction).toBe(1);
    expect(entries[0].layer).toEqual(['L1']);
    expect(entries[0].source).toBe('execution');
    expect(entries[0].tags).toEqual(['task-1', 'execution']);
    expect(entries[0].project).toBe('target');
    expect(entries[0].active).toBe(true);
  });

  it('recordExecution — respects explicit project', async () => {
    await KBHandler.recordExecution('Self-healing ran', ['self'], 'self');
    const entries = await db.kbLog.toArray();
    expect(entries[0].project).toBe('self');
  });

  it('recordObservation — creates entry with correct defaults', async () => {
    await KBHandler.recordObservation('Pattern detected in logs', ['logs']);
    const entries = await db.kbLog.toArray();
    expect(entries[0].category).toBe('observation');
    expect(entries[0].abstraction).toBe(2);
    expect(entries[0].layer).toEqual(['L0']);
    expect(entries[0].source).toBe('observation');
  });

  it('recordDecision — creates entry with correct defaults', async () => {
    await KBHandler.recordDecision('Switched to batch processing', ['perf']);
    const entries = await db.kbLog.toArray();
    expect(entries[0].category).toBe('decision');
    expect(entries[0].abstraction).toBe(4);
    expect(entries[0].layer).toEqual(['L0', 'L1']);
    expect(entries[0].source).toBe('decision');
  });

  it('recordError — creates entry with correct defaults', async () => {
    await KBHandler.recordError('API rate limit exceeded', ['api']);
    const entries = await db.kbLog.toArray();
    expect(entries[0].category).toBe('error');
    expect(entries[0].abstraction).toBe(2);
    expect(entries[0].layer).toEqual(['L0', 'L1']);
    expect(entries[0].source).toBe('execution');
  });
});

// ─── Repo Scanner ───────────────────────────────────────────────
describe('scanRepo', () => {
  it('detects tech stack from file extensions', async () => {
    const files = [
      { path: 'src/index.ts' },
      { path: 'src/App.tsx' },
      { path: 'src/style.css' },
    ];
    const result = await scanRepo(files);
    expect(result.entries).toBe(1);
    const entries = await db.kbLog.toArray();
    expect(entries[0].text).toContain('typescript');
    expect(entries[0].text).toContain('react');
    expect(entries[0].tags).toContain('tech-stack');
    expect(entries[0].source).toBe('repo-scan');
  });

  it('creates docs from README', async () => {
    const files = [
      { path: 'README.md', content: '# My Project\n\nA great project.' },
    ];
    const result = await scanRepo(files);
    expect(result.docs).toBe(1);
    const docs = await db.kbDocs.toArray();
    expect(docs[0].title).toBe('README.md');
    expect(docs[0].type).toBe('readme');
    expect(docs[0].source).toBe('repo-scan');
    expect(docs[0].tags).toContain('project-overview');
  });

  it('parses package.json for tech detection', async () => {
    const files = [
      { path: 'package.json', content: JSON.stringify({ dependencies: { react: '^18', dexie: '^4' }, devDependencies: { typescript: '^5' } }) },
    ];
    await scanRepo(files);
    const entries = await db.kbLog.toArray();
    expect(entries[0].text).toContain('react');
    expect(entries[0].text).toContain('dexie');
    expect(entries[0].text).toContain('typescript');
  });

  it('deduplicates — does not re-create existing docs', async () => {
    const files = [
      { path: 'README.md', content: '# V1' },
    ];
    await scanRepo(files);
    await scanRepo(files);
    const docs = await db.kbDocs.toArray();
    expect(docs).toHaveLength(1);
  });

  it('deduplicates — does not re-create tech stack observation', async () => {
    const files = [{ path: 'src/app.ts' }];
    await scanRepo(files);
    await scanRepo(files);
    const entries = await db.kbLog.filter(e => e.source === 'repo-scan').toArray();
    expect(entries).toHaveLength(1);
  });

  it('returns empty when no recognizable files', async () => {
    const files = [{ path: 'data.bin' }];
    const result = await scanRepo(files);
    expect(result.docs).toBe(0);
    expect(result.entries).toBe(0);
  });
});

// ─── FixedKBSource ───────────────────────────────────────────────
describe('FixedKBSource', () => {
  it('available() returns true', () => {
    const src = new FixedKBSource({});
    expect(src.available()).toBe(true);
  });

  it('returns matching knowledge by keyword', async () => {
    const src = new FixedKBSource({
      react: 'React is a UI library by Meta',
      typescript: 'TypeScript adds static types to JavaScript',
    });
    const result = await src.query('How do I use react?', '');
    expect(result).toContain('React is a UI library by Meta');
  });

  it('returns default response when no keywords match', async () => {
    const src = new FixedKBSource({ react: 'React info' });
    const result = await src.query('Tell me about python', '');
    expect(result).toBe('No relevant knowledge found.');
  });

  it('returns multiple matches joined by newline', async () => {
    const src = new FixedKBSource({
      react: 'React is a UI library',
      hooks: 'Hooks let you use state in function components',
    });
    const result = await src.query('react hooks', '');
    expect(result).toContain('React is a UI library');
    expect(result).toContain('Hooks let you use state');
    expect(result.split('\n').length).toBe(2);
  });

  it('matches against context as well as prompt', async () => {
    const src = new FixedKBSource({ api: 'REST API best practices' });
    const result = await src.query('what should I do?', 'working with api endpoints');
    expect(result).toContain('REST API best practices');
  });
});

// ─── Doc RAG: content validation + projector chunking ──────────
describe('Doc RAG: markdown validation + projector chunking', () => {
  const ctx = {} as any;

  it('saveDocument rejects empty content', async () => {
    await expect(
      KBHandler.handleRequest('knowledge-kb.saveDocument', [{
        title: 'Empty', type: 'spec', content: '', summary: 'x',
        tags: [], layer: ['L0'], source: 'test'
      }], ctx)
    ).rejects.toThrow('content is required');
  });

  it('saveDocument rejects missing content', async () => {
    await expect(
      KBHandler.handleRequest('knowledge-kb.saveDocument', [{
        title: 'No Content', type: 'spec', summary: 'x',
        tags: [], layer: ['L0'], source: 'test'
      }], ctx)
    ).rejects.toThrow('content is required');
  });

  it('saveDocument accepts markdown with headers', async () => {
    const id = await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
      title: 'Has Headers', type: 'spec',
      content: '# Title\n\n## Section\n\nSome text here',
      summary: 'doc with headers', tags: [], layer: ['L0', 'L1', 'L2', 'L3'], source: 'test'
    }], ctx);
    expect(id).toBeTypeOf('number');
  });

  it('saveDocument accepts markdown with paragraphs (no headers)', async () => {
    const id = await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
      title: 'Para Only', type: 'reference',
      content: 'First paragraph.\n\nSecond paragraph.',
      summary: 'doc with paragraphs', tags: [], layer: ['L0', 'L1', 'L2', 'L3'], source: 'test'
    }], ctx);
    expect(id).toBeTypeOf('number');
  });
});

import { ProjectorHandler } from '../modules/knowledge-projector/Handler';

describe('Projector: doc chunking in RAG', () => {
  it('chunks doc by h2 headers and returns matching section', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Architecture Guide', type: 'spec',
      content: '# Architecture\n\nSystem overview.\n\n## Frontend\n\nReact with TypeScript components.\n\n## Backend\n\nNode.js with Express API.',
      summary: 'Architecture guide', tags: ['architecture'],
      layer: ['L0', 'L1', 'L2', 'L3'], source: 'test', active: true, version: 1, project: 'target'
    });

    const result = await ProjectorHandler.project({
      layer: 'L3', project: 'target',
      taskDescription: 'frontend React components'
    });

    expect(result).toContain('Frontend');
    expect(result).toContain('React');
  });

  it('h2 chunks inherit h1 parent as section prefix', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Ops Manual', type: 'reference',
      content: '# Deployment\n\nDeploy info.\n\n## Staging\n\nStaging deploy steps.\n\n## Production\n\nProd deploy steps.',
      summary: 'Ops manual', tags: ['ops'],
      layer: ['L0', 'L1', 'L2', 'L3'], source: 'test', active: true, version: 1, project: 'target'
    });

    const result = await ProjectorHandler.project({
      layer: 'L3', project: 'target',
      taskDescription: 'staging deployment'
    });

    // h2 "Staging" should be labeled as "Deployment > Staging"
    expect(result).toContain('Deployment > Staging');
  });

  it('chunks doc by paragraphs when no headers exist', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Notes', type: 'report',
      content: 'Authentication uses JWT tokens for stateless sessions.\n\nDatabase migrations are managed by Drizzle ORM toolkit.',
      summary: 'Various notes', tags: ['notes'],
      layer: ['L0', 'L1', 'L2', 'L3'], source: 'test', active: true, version: 1, project: 'target'
    });

    const result = await ProjectorHandler.project({
      layer: 'L3', project: 'target',
      taskDescription: 'JWT authentication tokens'
    });

    expect(result).toContain('JWT');
  });

  it('tag boost ranks tagged chunks higher', async () => {
    await db.kbDocs.add({
      timestamp: Date.now(), title: 'Guide', type: 'spec',
      content: '## Auth\n\nLogin flow with OAuth.\n\n## UI\n\nButton styles and colors.',
      summary: 'Guide', tags: ['auth'],
      layer: ['L0', 'L1', 'L2', 'L3'], source: 'test', active: true, version: 1, project: 'target'
    });

    const result = await ProjectorHandler.project({
      layer: 'L3', project: 'target',
      taskDescription: 'implement login',
      tags: ['auth'],
      focus: ['auth', 'oauth']
    });

    expect(result).toContain('Auth');
  });
});
