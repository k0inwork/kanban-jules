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

beforeEach(async () => {
  nextId = 1;
  // Clear all tables
  await db.kbLog.clear();
  await db.kbDocs.clear();
  await db.tasks.clear();
  await db.projectConfigs.clear();
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
    const dreams = active.filter(e => e.source === 'dream:micro');
    expect(dreams).toHaveLength(1);
    expect(dreams[0].abstraction).toBe(5);
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
      category: 'dream',
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
    expect(result).toContain('Session-dream');
    expect(ctx.llmCall).toHaveBeenCalled();

    // Check new entries were added
    const entries = await db.kbLog.toArray();
    const patterns = entries.filter(e => e.category === 'pattern' && e.source === 'dream:session');
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
    expect(result).toContain('no active entries');
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
    expect(result).toContain('Session-dream');
    // Should complete without throwing
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
      category: 'dream',
      abstraction: 8,
      source: 'dream:deep',
      timestamp: sevenDaysAgo,
    }));

    const ctx = mockContext('Strategic insight: focus on reliability');
    const result = await DreamHandler.handleRequest('process-dream.deepDream', [], ctx);
    expect(result).toContain('Deep-dream');

    // Verify strategic insight was added
    const entries = await db.kbLog.toArray();
    const deepDreams = entries.filter(e => e.source === 'dream:deep' && e.category === 'dream');
    expect(deepDreams.length).toBeGreaterThan(0);

    // Verify old raw entries were deactivated
    const active = await db.kbLog.filter(e => e.active).toArray();
    const oldRaw = active.filter(e => e.abstraction <= 2 && e.timestamp < Date.now() - 7 * 24 * 60 * 60 * 1000 && e.source === 'execution');
    expect(oldRaw).toHaveLength(0);
  });

  it('deepDream proposes constitution amendments when LLM suggests them', async () => {
    await db.kbLog.add(makeEntry({ text: 'Some entry', category: 'observation', source: 'execution' }));
    const ctx = mockContext('Constitutional amendment: change rule X');

    await DreamHandler.handleRequest('process-dream.deepDream', [], ctx);

    const entries = await db.kbLog.toArray();
    const amendment = entries.find(e => e.category === 'constitution' && e.tags.includes('constitution-amendment'));
    expect(amendment).toBeDefined();
    expect(amendment!.project).toBe('self');
  });

  it('deepDream skips amendment when LLM says none needed', async () => {
    await db.kbLog.add(makeEntry({ text: 'Some entry', category: 'observation', source: 'execution' }));
    const ctx = mockContext('No amendments needed');

    await DreamHandler.handleRequest('process-dream.deepDream', [], ctx);

    const entries = await db.kbLog.toArray();
    const amendment = entries.find(e => e.category === 'constitution' && e.tags.includes('constitution-amendment'));
    expect(amendment).toBeUndefined();
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
    await db.kbLog.add(makeEntry({ text: 'Pattern 1', category: 'pattern' }));
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
});
