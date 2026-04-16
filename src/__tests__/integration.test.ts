/**
 * Integration tests: full pipelines across knowledge-kb, process-dream, process-reflection.
 * These simulate real agent sessions — recording errors, dreaming, reflecting, and
 * verifying the KB state evolves correctly across modules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../services/db';
import { ReflectionHandler } from '../modules/process-reflection/Handler';
import { DreamHandler } from '../modules/process-dream/Handler';
import { KBHandler } from '../modules/knowledge-kb/Handler';

function mockContext(llmResponse: string = 'mock response'): any {
  return {
    taskId: 'test-task',
    repoUrl: '',
    repoBranch: 'main',
    llmCall: vi.fn().mockResolvedValue(llmResponse),
    moduleConfig: {},
  };
}

// Track LLM call count across a multi-step pipeline
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
  await db.kbLog.clear();
  await db.kbDocs.clear();
  await db.tasks.clear();
  await db.projectConfigs.clear();
});

// ─── Flow 1: Multi-task failure → self-healing pipeline ─────────
describe('Integration: multi-task failure triggers self-healing', () => {
  it('records errors across tasks, dreams, reflects, and creates self-task', async () => {
    // Step 1: Record execution errors across 3 tasks with same symptom
    const ctx = mockContext();
    for (const taskId of ['task-101', 'task-102', 'task-103']) {
      await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
        text: 'Failed to parse JSON response from API endpoint',
        category: 'error',
        abstraction: 1,
        layer: ['L2'],
        tags: [taskId, 'api'],
        source: 'execution',
        project: 'target',
      }], ctx);
    }

    // Step 2: Micro-dream each task (too few entries each — skipped)
    for (const taskId of ['task-101', 'task-102', 'task-103']) {
      const result = await DreamHandler.handleRequest(
        'process-dream.microDream', [{ taskId }], mockContext()
      );
      expect(result).toContain('only 1 raw entries');
    }

    // Step 3: Session-dream extracts the pattern
    const sessionJson = JSON.stringify({
      patterns: [{ text: 'API parsing failures across multiple tasks', tags: ['api', 'parsing'] }],
      failures: [{ text: 'JSON parse error recurring in 3 tasks', tags: ['api'] }],
      strategies: [{ text: 'Add JSON validation wrapper', tags: ['reliability'] }],
      docGaps: [{ text: 'No error handling docs', tags: ['docs'] }],
    });
    await DreamHandler.handleRequest('process-dream.sessionDream', [], mockContext(sessionJson));

    // Step 4: Reflection reclassifies cross-task errors
    const result = await ReflectionHandler.handleRequest(
      'process-reflection.reclassify', [{}], mockContext()
    );
    expect(result.reclassified).toBe(3);

    // Step 5: Verify final state
    // — Errors moved to self
    const allEntries = await db.kbLog.toArray();
    const originalErrors = allEntries.filter(e =>
      e.text === 'Failed to parse JSON response from API endpoint' && e.category === 'error'
    );
    expect(originalErrors.every(e => e.project === 'self')).toBe(true);

    // — Reflection entry logged
    const reflections = allEntries.filter(e => e.category === 'correction' && e.source === 'dream:session');
    expect(reflections.length).toBeGreaterThan(0);
    expect(reflections[0].project).toBe('self');

    // — Self-task created
    const tasks = await db.tasks.toArray();
    const selfTasks = tasks.filter(t => t.project === 'self');
    expect(selfTasks.length).toBeGreaterThan(0);
    expect(selfTasks[0].title).toContain('[self]');

    // — Session-dream insights preserved
    const patterns = allEntries.filter(e => e.category === 'pattern' && e.source === 'dream:session');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].tags).toContain('api');
  });
});

// ─── Flow 2: Dream propagation — abstraction climb ──────────────
describe('Integration: dream levels propagate correctly through KB', () => {
  it('raw entries → microDream → sessionDream with increasing abstraction', async () => {
    // Seed 4 raw observations per task across 2 tasks
    for (const taskId of ['task-200', 'task-201']) {
      for (let i = 0; i < 4; i++) {
        await db.kbLog.add({
          id: undefined as any,
          timestamp: Date.now() - (4 - i) * 1000,
          text: `Raw observation ${i} for ${taskId}`,
          category: 'observation',
          abstraction: 1,
          layer: ['L2'],
          tags: [taskId, 'testing'],
          source: 'execution',
          active: true,
          project: 'target',
        });
      }
    }

    // Micro-dream each task
    for (const taskId of ['task-200', 'task-201']) {
      await DreamHandler.handleRequest(
        'process-dream.microDream', [{ taskId }],
        mockContext(`Consolidated: testing patterns in ${taskId}`)
      );
    }

    // Verify micro-dreams created at abstraction 5, originals deactivated
    const afterMicro = await db.kbLog.filter(e => e.active).toArray();
    const microDreams = afterMicro.filter(e => e.source === 'dream:micro');
    expect(microDreams).toHaveLength(2);
    expect(microDreams.every(d => d.abstraction === 5)).toBe(true);

    // Raw entries should be deactivated
    const rawActive = afterMicro.filter(e => e.source === 'execution' && e.abstraction === 1);
    expect(rawActive).toHaveLength(0);

    // Session-dream over the micro-dream outputs
    const sessionJson = JSON.stringify({
      patterns: [{ text: 'Testing patterns consistent across tasks', tags: ['testing'] }],
      failures: [],
      strategies: [{ text: 'Standardize test setup', tags: ['testing'] }],
      docGaps: [],
    });
    await DreamHandler.handleRequest(
      'process-dream.sessionDream', [], mockContext(sessionJson)
    );

    // Verify session-dream created at abstraction 7
    const afterSession = await db.kbLog.filter(e => e.active).toArray();
    const sessionEntries = afterSession.filter(e => e.source === 'dream:session');
    expect(sessionEntries.length).toBeGreaterThanOrEqual(2); // pattern + strategy

    // Verify queryLog can retrieve the dream chain
    const ctx = mockContext();
    const dreamEntries = await KBHandler.handleRequest('knowledge-kb.queryLog', [{
      source: 'dream:session',
    }], ctx);
    expect(dreamEntries.length).toBeGreaterThanOrEqual(2);

    // Verify abstraction ordering — session > micro > raw
    const allActive = await db.kbLog.filter(e => e.active).toArray();
    const maxAbstraction = Math.max(...allActive.map(e => e.abstraction));
    expect(maxAbstraction).toBe(7); // session-dream level
  });
});

// ─── Flow 3: Constitution evolution via deep-dream ──────────────
describe('Integration: constitution evolves through deep-dream', () => {
  it('records constitution errors, deep-dreams, proposes amendment', async () => {
    // Seed constitution-tagged errors
    const ctx = mockContext();
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Constitution rule "no-external-calls" blocked retry logic',
      category: 'error',
      abstraction: 3,
      layer: ['L1'],
      tags: ['constitution', 'reliability', 'task-300'],
      source: 'execution',
    }], ctx);
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Constitution rule "no-external-calls" blocked failover',
      category: 'error',
      abstraction: 3,
      layer: ['L1'],
      tags: ['constitution', 'reliability', 'task-301'],
      source: 'execution',
    }], ctx);

    // Also record a normal entry so deepDream has content
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Task completed successfully',
      category: 'observation',
      abstraction: 2,
      layer: ['L2'],
      tags: ['task-300'],
      source: 'execution',
    }], ctx);

    // Deep-dream with amendment proposal
    const deepCtx = trackingContext([
      'Strategic insight: constitution rules are too restrictive for reliability',
      'Constitutional amendment: relax no-external-calls for retry scenarios',
    ]);
    await DreamHandler.handleRequest('process-dream.deepDream', [], deepCtx);

    // Verify amendment was recorded as self-knowledge
    const entries = await db.kbLog.toArray();
    const amendment = entries.find(e =>
      e.category === 'constitution' && e.tags.includes('constitution-amendment')
    );
    expect(amendment).toBeDefined();
    expect(amendment!.project).toBe('self');
    expect(amendment!.abstraction).toBe(8);

    // Now run reflection — should trigger CONSTITUTION-VIOLATION rule
    const result = await ReflectionHandler.handleRequest(
      'process-reflection.reclassify', [{}], mockContext()
    );
    expect(result.reclassified).toBe(2);

    // Verify self-task for constitution review
    const tasks = await db.tasks.toArray();
    const constTask = tasks.find(t => t.title?.includes('constitution'));
    expect(constTask).toBeDefined();
    expect(constTask!.project).toBe('self');
  });
});

// ─── Flow 4: Knowledge gap lifecycle ────────────────────────────
describe('Integration: knowledge gap detection and tagging', () => {
  it('flags gaps through session-dream, then reflection confirms them', async () => {
    // Record an error related to config
    await db.kbLog.add({
      timestamp: Date.now(),
      text: 'Missing environment variable DATABASE_URL',
      category: 'error',
      abstraction: 2,
      layer: ['L2'],
      tags: ['config', 'task-400'],
      source: 'execution',
      active: true,
      project: 'target',
    });

    // Session-dream flags a documentation gap
    const sessionJson = JSON.stringify({
      patterns: [],
      failures: [],
      strategies: [],
      docGaps: [{ text: 'No environment variable reference', tags: ['config', 'env'] }],
    });
    await DreamHandler.handleRequest(
      'process-dream.sessionDream', [], mockContext(sessionJson)
    );

    // Verify gap was recorded
    const gaps = await db.kbLog.filter(e => e.tags.includes('gap') && e.active).toArray();
    expect(gaps).toHaveLength(1);
    expect(gaps[0].tags).toContain('config');

    // Now record another config error
    await db.kbLog.add({
      timestamp: Date.now(),
      text: 'Missing environment variable REDIS_URL',
      category: 'error',
      abstraction: 2,
      layer: ['L2'],
      tags: ['config', 'task-401'],
      source: 'execution',
      active: true,
      project: 'target',
    });

    // Reflection should detect KNOWN-GAP and tag (not reclassify)
    const result = await ReflectionHandler.handleRequest(
      'process-reflection.reclassify', [{}], mockContext()
    );

    // KNOWN-GAP: errors stay on target project but get tagged
    expect(result.reclassified).toBe(0);

    const errors = await db.kbLog.filter(e =>
      e.category === 'error' && e.source === 'execution'
    ).toArray();
    const gapTagged = errors.filter(e => e.tags.includes('gap-confirmed'));
    expect(gapTagged.length).toBeGreaterThan(0);
    // All errors still on target project
    expect(gapTagged.every(e => e.project === 'target')).toBe(true);
  });
});

// ─── Flow 5: Full lifecycle — record → dream → reflect → verify ─
describe('Integration: full agent session lifecycle', () => {
  it('simulates a complete work session from recording to self-correction', async () => {
    const ctx = mockContext();

    // === Phase 1: Agent executes tasks, recording observations ===
    // Task A — 4 successful observations
    for (let i = 0; i < 4; i++) {
      await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
        text: `Task A step ${i} completed`,
        category: 'observation',
        abstraction: 1,
        layer: ['L2'],
        tags: ['task-A', 'build'],
        source: 'execution',
      }], ctx);
    }
    // Task B — 2 observations + 1 error
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Task B step 0 completed',
      category: 'observation', abstraction: 1, layer: ['L2'],
      tags: ['task-B', 'build'], source: 'execution',
    }], ctx);
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Task B step 1 completed',
      category: 'observation', abstraction: 1, layer: ['L2'],
      tags: ['task-B', 'build'], source: 'execution',
    }], ctx);
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Failed to resolve module TypeScript',
      category: 'error', abstraction: 2, layer: ['L2'],
      tags: ['task-B', 'typescript'], source: 'execution',
    }], ctx);
    // Task C — same error as B
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Failed to resolve module TypeScript',
      category: 'error', abstraction: 2, layer: ['L2'],
      tags: ['task-C', 'typescript'], source: 'execution',
    }], ctx);
    // Task D — same error again
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Failed to resolve module TypeScript',
      category: 'error', abstraction: 2, layer: ['L2'],
      tags: ['task-D', 'typescript'], source: 'execution',
    }], ctx);
    // Task E — same error (extra to survive microDream deactivation on task-B)
    await KBHandler.handleRequest('knowledge-kb.recordEntry', [{
      text: 'Failed to resolve module TypeScript',
      category: 'error', abstraction: 2, layer: ['L2'],
      tags: ['task-E', 'typescript'], source: 'execution',
    }], ctx);

    // === Phase 2: Post-task micro-dreams ===
    // Task A: enough entries for consolidation
    const microResultA = await DreamHandler.handleRequest(
      'process-dream.microDream', [{ taskId: 'task-A' }],
      mockContext('Build steps completed successfully for task A')
    );
    expect(microResultA).toContain('consolidated 4 entries');

    // Task B: enough entries (3)
    const microResultB = await DreamHandler.handleRequest(
      'process-dream.microDream', [{ taskId: 'task-B' }],
      mockContext('Mixed results: success with TypeScript error')
    );
    expect(microResultB).toContain('consolidated 3 entries');

    // === Phase 3: Session-dream discovers the TS pattern ===
    const sessionJson = JSON.stringify({
      patterns: [{ text: 'TypeScript module resolution failing', tags: ['typescript'] }],
      failures: [{ text: 'Module resolution error in 3 tasks', tags: ['typescript'] }],
      strategies: [{ text: 'Add tsconfig paths configuration', tags: ['typescript', 'config'] }],
      docGaps: [{ text: 'No project setup guide', tags: ['docs'] }],
    });
    await DreamHandler.handleRequest(
      'process-dream.sessionDream', [], mockContext(sessionJson)
    );

    // === Phase 4: Reflection reclassifies cross-task errors ===
    const reflectionResult = await ReflectionHandler.handleRequest(
      'process-reflection.reclassify', [{}], mockContext()
    );
    expect(reflectionResult.reclassified).toBe(3); // task-C, D, E TS errors → self (task-B error deactivated by microDream)

    // === Verify final KB state ===

    // 1. Original raw observations deactivated by microDream
    const rawActive = await db.kbLog.filter(e =>
      e.source === 'execution' && e.abstraction === 1 && e.active
    ).toArray();
    expect(rawActive).toHaveLength(0);

    // 2. Micro-dreams at abstraction 5
    const microDreams = await db.kbLog.filter(e =>
      e.source === 'dream:micro' && e.active
    ).toArray();
    expect(microDreams).toHaveLength(2);

    // 3. Session-dream insights at abstraction 7
    const sessionInsights = await db.kbLog.filter(e =>
      e.source === 'dream:session' && e.active
    ).toArray();
    expect(sessionInsights.length).toBeGreaterThanOrEqual(4); // pattern + failure + strategy + gap

    // 4. TS errors reclassified to self (only active ones)
    const tsErrors = await db.kbLog.filter(e =>
      e.text === 'Failed to resolve module TypeScript' && e.active
    ).toArray();
    expect(tsErrors.every(e => e.project === 'self')).toBe(true);

    // 5. Self-task created for the recurring error
    const selfTasks = await db.tasks.filter(t => t.project === 'self').toArray();
    expect(selfTasks.length).toBeGreaterThan(0);
    expect(selfTasks[0].title).toContain('typescript');

    // 6. Reflection correction logged
    const corrections = await db.kbLog.filter(e =>
      e.category === 'correction' && e.source === 'dream:session'
    ).toArray();
    expect(corrections.length).toBeGreaterThan(0);

    // 7. QueryLog can retrieve the full chain by source
    const ctx2 = mockContext();
    const dreamChain = await KBHandler.handleRequest('knowledge-kb.queryLog', [{
      source: 'dream:micro',
    }], ctx2);
    expect(dreamChain).toHaveLength(2);

    // 8. Gap flagged for documentation
    const gaps = await db.kbLog.filter(e =>
      e.tags.includes('gap') && e.source === 'dream:session'
    ).toArray();
    expect(gaps).toHaveLength(1);
    expect(gaps[0].text).toContain('project setup');
  });
});

// ─── Flow 6: Deep-dream pruning + amendment ─────────────────────
describe('Integration: deep-dream prunes old data and evolves constitution', () => {
  it('old raw entries pruned, high-abstraction preserved, amendment proposed', async () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    // Old raw entries (should be pruned)
    for (let i = 0; i < 5; i++) {
      await db.kbLog.add({
        timestamp: tenDaysAgo + i * 1000,
        text: `Old raw execution log ${i}`,
        category: 'observation',
        abstraction: 1,
        layer: ['L2'],
        tags: ['task-old', 'legacy'],
        source: 'execution',
        active: true,
        project: 'target',
      });
    }

    // Old high-abstraction entry (should survive)
    await db.kbLog.add({
      timestamp: tenDaysAgo,
      text: 'Key architectural decision: use event sourcing',
      category: 'decision',
      abstraction: 9,
      layer: ['L0'],
      tags: ['architecture', 'event-sourcing'],
      source: 'dream:session',
      active: true,
      project: 'target',
    });

    // Recent raw entry (should survive)
    await db.kbLog.add({
      timestamp: Date.now(),
      text: 'Recent execution log',
      category: 'observation',
      abstraction: 1,
      layer: ['L2'],
      tags: ['task-new'],
      source: 'execution',
      active: true,
      project: 'target',
    });

    // Deep-dream
    const deepCtx = trackingContext([
      'Consolidation: project uses event sourcing, legacy patterns being replaced',
      'Amendment: add rule to prefer event sourcing for new features',
    ]);
    await DreamHandler.handleRequest('process-dream.deepDream', [], deepCtx);

    // Verify pruning
    const active = await db.kbLog.filter(e => e.active).toArray();
    const oldRaw = active.filter(e =>
      e.abstraction <= 2 && e.timestamp < Date.now() - 7 * 24 * 60 * 60 * 1000 && e.source === 'execution'
    );
    expect(oldRaw).toHaveLength(0);

    // High-abstraction survived
    const arch = active.find(e => e.text.includes('event sourcing') && e.abstraction === 9);
    expect(arch).toBeDefined();
    expect(arch!.active).toBe(true);

    // Recent survived
    const recent = active.find(e => e.text === 'Recent execution log');
    expect(recent).toBeDefined();

    // Strategic insight added
    const deepInsight = active.find(e => e.source === 'dream:deep' && e.category === 'dream');
    expect(deepInsight).toBeDefined();
    expect(deepInsight!.abstraction).toBe(9);

    // Amendment proposed
    const amendment = active.find(e => e.category === 'constitution');
    expect(amendment).toBeDefined();
    expect(amendment!.project).toBe('self');
  });
});
