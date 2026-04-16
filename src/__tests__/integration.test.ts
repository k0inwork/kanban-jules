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
import { ProjectorHandler } from '../modules/knowledge-projector/Handler';
import { scanRepo } from '../modules/knowledge-kb/RepoScanner';
import { eventBus } from '../core/event-bus';
import { agentContext } from '../services/AgentContext';
import { Orchestrator } from '../core/orchestrator';
import { composeProgrammerPrompt } from '../core/prompt';
import { registry } from '../core/registry';
import { Task } from '../types';

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
  await db.messages.clear();
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

    // Step 3: Session-dream extracts the pattern AND triggers reflection internally
    const sessionJson = JSON.stringify({
      patterns: [{ text: 'API parsing failures across multiple tasks', tags: ['api', 'parsing'] }],
      failures: [{ text: 'JSON parse error recurring in 3 tasks', tags: ['api'] }],
      strategies: [{ text: 'Add JSON validation wrapper', tags: ['reliability'] }],
      docGaps: [{ text: 'No error handling docs', tags: ['docs'] }],
    });
    const sessionResult = await DreamHandler.handleRequest('process-dream.sessionDream', [], mockContext(sessionJson));
    expect(sessionResult.dream).toContain('Session-dream');
    // Reflection runs automatically — verify it reclassified
    expect(sessionResult.reflection.reclassified).toBe(3);

    // Step 4: Verify final state
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
    const microDreams = afterMicro.filter(e => e.source === 'dream:micro' && e.category === 'dream');
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

    // === Phase 3: Session-dream discovers the TS pattern AND triggers reflection ===
    const sessionJson = JSON.stringify({
      patterns: [{ text: 'TypeScript module resolution failing', tags: ['typescript'] }],
      failures: [{ text: 'Module resolution error in 3 tasks', tags: ['typescript'] }],
      strategies: [{ text: 'Add tsconfig paths configuration', tags: ['typescript', 'config'] }],
      docGaps: [{ text: 'No project setup guide', tags: ['docs'] }],
    });
    const sessionResult = await DreamHandler.handleRequest(
      'process-dream.sessionDream', [], mockContext(sessionJson)
    );
    // Reflection runs automatically inside sessionDream
    expect(sessionResult.reflection.reclassified).toBe(3); // task-C, D, E TS errors → self (task-B error deactivated by microDream)

    // === Verify final KB state ===

    // 1. Original raw observations deactivated by microDream
    const rawActive = await db.kbLog.filter(e =>
      e.source === 'execution' && e.abstraction === 1 && e.active
    ).toArray();
    expect(rawActive).toHaveLength(0);

    // 2. Micro-dreams were deactivated by sessionDream (observations + micro-dreams superseded)
    const microDreams = await db.kbLog.filter(e =>
      e.source === 'dream:micro' && e.category === 'dream'
    ).toArray();
    expect(microDreams).toHaveLength(2);
    expect(microDreams.every(e => !e.active)).toBe(true);

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
      category: 'dream',
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

    // Amendment proposed in kb_log
    const amendment = active.find(e => e.category === 'constitution');
    expect(amendment).toBeDefined();
    expect(amendment!.project).toBe('self');

    // Amendment also proposed as AgentMessage for user approval
    const messages = await db.messages.toArray();
    const proposal = messages.find(m => m.type === 'proposal' && m.sender === 'dream:deep');
    expect(proposal).toBeDefined();
    expect(proposal!.proposedTask).toBeDefined();
  });
});

// ─── Flow 7: Constitution amendment approval via user:reply ────
describe('Integration: deepDream amendment → user approval → constitution update', () => {
  it('proposed amendment is applied to constitution after user approves', async () => {
    // Seed constitution
    await db.projectConfigs.add({ id: 'default', constitution: 'Rule 1: always test before merge', updatedAt: Date.now() });

    // Seed some KB entries for deepDream to analyze
    await db.kbLog.add({
      timestamp: Date.now(),
      text: 'Repeated auth test failures',
      category: 'error',
      abstraction: 1,
      layer: ['L2'],
      tags: ['auth', 'testing'],
      source: 'execution',
      active: true,
      project: 'target',
    });

    // Deep-dream proposes an amendment
    const deepCtx = trackingContext([
      'Consolidation: auth tests keep failing due to missing mocks',
      'Amendment: always mock external services in auth tests',
    ]);
    await DreamHandler.handleRequest('process-dream.deepDream', [], deepCtx);

    // Verify proposal exists
    const messages = await db.messages.toArray();
    const proposal = messages.find(m => m.type === 'proposal' && m.sender === 'dream:deep');
    expect(proposal).toBeDefined();
    expect(proposal!.status).toBe('unread');

    // Constitution unchanged before approval
    const beforeApprove = await db.projectConfigs.get('default');
    expect(beforeApprove!.constitution).toBe('Rule 1: always test before merge');

    // User approves via event bus (same mechanism as UI)
    eventBus.emit('user:reply', {
      taskId: 'test-task',
      content: 'approved',
      messageId: proposal!.id,
    });
    // Allow async handler to settle
    await new Promise(r => setTimeout(r, 10));

    // Constitution now includes the amendment
    const afterApprove = await db.projectConfigs.get('default');
    expect(afterApprove!.constitution).toContain('always mock external services in auth tests');
    expect(afterApprove!.constitution).toContain('Rule 1: always test before merge');

    // Proposal message marked read
    const readProposal = await db.messages.get(proposal!.id!);
    expect(readProposal!.status).toBe('read');
  });

  it('proposed amendment is NOT applied when user rejects', async () => {
    await db.projectConfigs.add({ id: 'default', constitution: 'Original rules', updatedAt: Date.now() });
    await db.kbLog.add({
      timestamp: Date.now(),
      text: 'Some observation',
      category: 'observation',
      abstraction: 1,
      layer: ['L2'],
      tags: ['test'],
      source: 'execution',
      active: true,
      project: 'target',
    });

    const deepCtx = trackingContext([
      'Consolidation: system running smoothly',
      'Amendment: delete all tests to save time',
    ]);
    await DreamHandler.handleRequest('process-dream.deepDream', [], deepCtx);

    const messages = await db.messages.toArray();
    const proposal = messages.find(m => m.type === 'proposal' && m.sender === 'dream:deep');

    // User rejects
    eventBus.emit('user:reply', {
      taskId: 'test-task',
      content: 'no, bad idea',
      messageId: proposal!.id,
    });
    await new Promise(r => setTimeout(r, 10));

    // Constitution unchanged
    const config = await db.projectConfigs.get('default');
    expect(config!.constitution).toBe('Original rules');

    // Message still marked read
    const readProposal = await db.messages.get(proposal!.id!);
    expect(readProposal!.status).toBe('read');
  });
});

// ─── Flow 8: Full Project Lifecycle — e-commerce checkout ─────────
describe('Integration: full project lifecycle — e-commerce checkout', () => {
  it('simulates project init → task execution → dream cycles → self-healing → constitution evolution', async () => {
    // ═══ Phase 1: Project Init ═══
    const files = [
      { path: 'README.md', content: '# E-Commerce Checkout\n\nPayment processing with Stripe and order confirmation via email.' },
      { path: 'package.json', content: JSON.stringify({
        dependencies: { react: '^18', dexie: '^4', stripe: '^12' },
        devDependencies: { typescript: '^5', vitest: '^1' },
      })},
      { path: 'src/checkout.ts' },
      { path: 'src/payment.tsx' },
    ];
    const scanResult = await scanRepo(files);
    expect(scanResult.docs).toBeGreaterThanOrEqual(1); // README doc created
    expect(scanResult.entries).toBe(1); // tech stack observation

    // Verify tech detection
    const scanEntries = await db.kbLog.filter(e => e.source === 'repo-scan').toArray();
    const techEntry = scanEntries.find(e => e.tags.includes('tech-stack'));
    expect(techEntry!.text).toContain('typescript');
    expect(techEntry!.text).toContain('react');
    expect(techEntry!.text).toContain('dexie');

    // Verify README doc
    const readmeDoc = await db.kbDocs.filter(d => d.type === 'readme').first();
    expect(readmeDoc!.title).toBe('README.md');
    expect(readmeDoc!.tags).toContain('project-overview');

    // ═══ Phase 2: Task Execution — 3 tasks ═══
    // Task pay-1: "Add payment API" — successful execution
    for (let i = 0; i < 3; i++) {
      await KBHandler.recordExecution(
        `Payment API step ${i}: ${i < 2 ? 'success' : 'connected to Stripe'}`,
        ['task-pay-1', 'payment'],
      );
    }
    await KBHandler.recordObservation('Stripe SDK initialized correctly', ['task-pay-1', 'payment']);

    // Task pay-2: "Retry payment API" — 3 timeout errors
    for (let i = 0; i < 3; i++) {
      await KBHandler.recordError(
        'Payment API timeout: stripe/v1/charges took >30s',
        ['task-pay-2', 'payment', 'timeout'],
      );
    }

    // Task email-1: "Add order confirmation" — 2 timeout errors + 1 success
    await KBHandler.recordError(
      'Payment API timeout: stripe/v1/charges took >30s',
      ['task-email-1', 'payment', 'timeout'],
    );
    await KBHandler.recordError(
      'Payment API timeout: stripe/v1/charges took >30s',
      ['task-email-1', 'payment', 'timeout'],
    );
    await KBHandler.recordExecution('Order confirmation email sent', ['task-email-1', 'email']);

    // Total: 10 execution entries + 1 scan observation = 11
    const phase2Entries = await db.kbLog.filter(e => e.active).toArray();
    expect(phase2Entries.length).toBe(11);

    // ═══ Phase 3: Micro-dreams ═══
    // Only micro-dream pay-1 (successful task). Error tasks left raw so sessionDream + reflection
    // can detect cross-task recurring patterns.
    const microPay1 = await DreamHandler.handleRequest(
      'process-dream.microDream', [{ taskId: 'task-pay-1' }],
      mockContext('Payment API integration working. Stripe SDK setup correct.'),
    );
    expect(microPay1).toContain('consolidated 4 entries');

    // Verify micro-dream consolidation at abstraction 5
    const microDreams = await db.kbLog.filter(e =>
      e.source === 'dream:micro' && e.category === 'dream' && e.active
    ).toArray();
    expect(microDreams).toHaveLength(1);
    expect(microDreams[0].abstraction).toBe(5);

    // Verify executor outcome recorded
    const executorOutcomes = await db.kbLog.filter(e =>
      e.source === 'dream:micro' && e.tags.includes('executor-outcome')
    ).toArray();
    expect(executorOutcomes).toHaveLength(1);
    expect(executorOutcomes[0].text).toContain('Clean execution');

    // Raw entries for pay-1 deactivated by microDream; pay-2/email-1 still active for sessionDream
    const rawActive = await db.kbLog.filter(e =>
      e.source === 'execution' && e.abstraction <= 2 && e.active
    ).toArray();
    expect(rawActive.length).toBeGreaterThan(0); // pay-2 + email-1 entries still raw

    // ═══ Phase 4: Session Dream + Reflection ═══
    const sessionJson = JSON.stringify({
      patterns: [
        { text: 'Payment API timeouts correlate with high latency periods', tags: ['payment', 'timeout', 'latency'] },
      ],
      failures: [
        { text: 'Stripe charges endpoint unreliable under load', tags: ['payment', 'stripe'] },
      ],
      strategies: [
        { text: 'Implement exponential backoff for payment API calls', tags: ['payment', 'reliability'] },
      ],
      docGaps: [
        { text: 'No retry policy documentation for external APIs', tags: ['docs', 'payment'] },
      ],
    });
    const sessionResult = await DreamHandler.handleRequest(
      'process-dream.sessionDream', [], mockContext(sessionJson)
    );
    expect(sessionResult.dream).toContain('Session-dream');
    // Reflection fires automatically — 5 timeout errors across 2 tasks
    expect(sessionResult.reflection.reclassified).toBe(5);

    // Verify session-dream insights at abstraction 7
    const sessionInsights = await db.kbLog.filter(e =>
      e.source === 'dream:session' && e.active
    ).toArray();
    expect(sessionInsights.length).toBeGreaterThanOrEqual(4); // pattern + failure + strategy + gap

    // Errors reclassified to self
    const timeoutErrors = await db.kbLog.filter(e =>
      e.text === 'Payment API timeout: stripe/v1/charges took >30s' && e.active
    ).toArray();
    expect(timeoutErrors.every(e => e.project === 'self')).toBe(true);

    // Self-task created
    const selfTasks = await db.tasks.filter(t => t.project === 'self').toArray();
    expect(selfTasks.length).toBeGreaterThan(0);

    // Gap flagged
    const gaps = await db.kbLog.filter(e =>
      e.tags.includes('gap') && e.source === 'dream:session'
    ).toArray();
    expect(gaps).toHaveLength(1);
    expect(gaps[0].text).toContain('retry policy');

    // ═══ Phase 5: Deep Dream + Constitution Amendment ═══
    await db.projectConfigs.add({
      id: 'default',
      constitution: 'Rule 1: all tasks must have tests\nRule 2: no direct external API calls from UI',
      updatedAt: Date.now(),
    });

    const deepCtx = trackingContext([
      'Consolidation: Payment timeouts causing cascading failures. Retry logic needed. Project uses Stripe for payments.',
      'Constitutional amendment: Add Rule 3 — all external API calls must implement exponential backoff with max 3 retries',
    ]);
    await DreamHandler.handleRequest('process-dream.deepDream', [], deepCtx);

    // Verify deep-dream strategic insight at abstraction 9
    const deepInsight = await db.kbLog.filter(e =>
      e.source === 'dream:deep' && e.category === 'dream'
    ).first();
    expect(deepInsight).toBeDefined();
    expect(deepInsight!.abstraction).toBe(9);

    // Amendment proposed in kb_log
    const amendment = await db.kbLog.filter(e =>
      e.category === 'constitution' && e.tags.includes('constitution-amendment')
    ).first();
    expect(amendment).toBeDefined();
    expect(amendment!.project).toBe('self');

    // Amendment proposed as AgentMessage
    const proposal = await db.messages.filter(m => m.type === 'proposal').first();
    expect(proposal).toBeDefined();
    expect(proposal!.sender).toBe('dream:deep');

    // Constitution NOT yet changed
    const beforeApprove = await db.projectConfigs.get('default');
    expect(beforeApprove!.constitution).not.toContain('exponential backoff');

    // User approves
    eventBus.emit('user:reply', {
      taskId: 'test-task',
      content: 'approved',
      messageId: proposal!.id,
    });
    await new Promise(r => setTimeout(r, 10));

    // Constitution NOW includes amendment
    const afterApprove = await db.projectConfigs.get('default');
    expect(afterApprove!.constitution).toContain('exponential backoff');
    expect(afterApprove!.constitution).toContain('Rule 1');

    // ═══ Phase 6: Full State Verification ═══
    // 6a: Abstraction chain exists: 7→9 (session-dream, deep-dream)
    // Note: micro-dream (abstraction 5) is correctly deactivated by sessionDream Phase 4b,
    // which deactivates all non-error superseded entries including dream:micro entries.
    const allActive = await db.kbLog.filter(e => e.active).toArray();
    const abstractions = [...new Set(allActive.map(e => e.abstraction))].sort();
    expect(abstractions).toContain(7);  // session-dream insights
    expect(abstractions).toContain(9);  // deep-dream strategic insight

    // 6b: Self-task exists with correct title
    const selfTask = await db.tasks.filter(t => t.project === 'self').first();
    expect(selfTask).toBeDefined();
    expect(selfTask!.title).toMatch(/\[self\].*payment api timeout/);

    // 6c: Projector returns self-knowledge (error patterns)
    const selfProjection = await ProjectorHandler.project({
      layer: 'L0', project: 'self',
    });
    expect(selfProjection).toContain('Experience');
    expect(selfProjection.length).toBeGreaterThan(0);

    // 6d: Projector returns target-knowledge (tech stack, README)
    const targetProjection = await ProjectorHandler.project({
      layer: 'L0', project: 'target', taskDescription: 'payment checkout stripe',
    });
    expect(targetProjection).toContain('E-Commerce Checkout'); // from README doc

    // 6e: KB has entries across multiple projects
    const projects = [...new Set(allActive.map(e => e.project))];
    expect(projects).toContain('self');
    expect(projects).toContain('target');

    // 6f: Repo scanner docs still intact
    const docs = await db.kbDocs.filter(d => d.active).toArray();
    const readmeDocs = docs.filter(d => d.type === 'readme');
    expect(readmeDocs).toHaveLength(1);
    expect(readmeDocs[0].source).toBe('repo-scan');
  });
});

// ─── Flow 9: GlobalVars persistence across steps ──────────────
describe('Integration: agentContext persists across task steps', () => {
  it('context set in step 1 is available when step 2 prompt is composed', async () => {
    // Create a task with a 2-step protocol
    const taskId = 'test-gv-1';
    await db.tasks.add({
      id: taskId,
      title: 'Multi-step task',
      description: 'Test context persistence',
      workflowStatus: 'IN_PROGRESS',
      agentState: 'EXECUTING',
      createdAt: Date.now(),
      protocol: {
        steps: [
          { id: 1, title: 'Step 1', description: 'Set context', executor: 'executor-local', status: 'pending' },
          { id: 2, title: 'Step 2', description: 'Read context', executor: 'executor-local', status: 'pending' },
        ],
      },
    });

    // Simulate Step 1: orchestrator loads agentContext, sandbox sets values, then persists
    agentContext.clear();
    const task = (await db.tasks.get(taskId))!;
    // Orchestrator.runStep loads existing agentContext into the singleton
    if (task.agentContext) {
      for (const [k, v] of Object.entries(task.agentContext)) {
        agentContext.set(k, v);
      }
    }

    // Sandbox code sets context (simulating addToContext('discoveredApis', [...]))
    agentContext.set('discoveredApis', ['users', 'orders', 'payments']);
    agentContext.set('authToken', 'abc123');

    // After sandbox execution, orchestrator persists agentContext to DB
    await db.tasks.update(taskId, { agentContext: agentContext.getAll() });

    // Verify persistence
    const afterStep1 = (await db.tasks.get(taskId))!;
    expect(afterStep1.agentContext).toBeDefined();
    expect(afterStep1.agentContext!.discoveredApis).toEqual(['users', 'orders', 'payments']);
    expect(afterStep1.agentContext!.authToken).toBe('abc123');

    // Simulate Step 2: orchestrator loads the persisted context
    agentContext.clear();
    const taskStep2 = (await db.tasks.get(taskId))!;
    if (taskStep2.agentContext) {
      for (const [k, v] of Object.entries(taskStep2.agentContext)) {
        agentContext.set(k, v);
      }
    }

    // Verify the singleton has the data from step 1
    expect(agentContext.get('discoveredApis')).toEqual(['users', 'orders', 'payments']);
    expect(agentContext.get('authToken')).toBe('abc123');

    // Verify composeProgrammerPrompt includes the agentContext
    const modules = registry.getEnabled();
    const prompt = composeProgrammerPrompt(
      modules,
      taskStep2 as Task,
      taskStep2.protocol!.steps[1],
      '',
    );
    expect(prompt).toContain('discoveredApis');
    expect(prompt).toContain('users');
    expect(prompt).toContain('authToken');
  });

  it('context accumulates across 3 steps without loss', async () => {
    const taskId = 'test-gv-2';
    await db.tasks.add({
      id: taskId,
      title: '3-step accumulation',
      description: 'Each step adds context',
      workflowStatus: 'IN_PROGRESS',
      agentState: 'EXECUTING',
      createdAt: Date.now(),
      protocol: {
        steps: [
          { id: 1, title: 'Discover', description: 'Find APIs', executor: 'executor-local', status: 'pending' },
          { id: 2, title: 'Test', description: 'Test APIs', executor: 'executor-local', status: 'pending' },
          { id: 3, title: 'Integrate', description: 'Integrate APIs', executor: 'executor-local', status: 'pending' },
        ],
      },
    });

    // Step 1: discover APIs
    agentContext.clear();
    agentContext.set('apis', ['users', 'orders']);
    await db.tasks.update(taskId, { agentContext: agentContext.getAll() });

    // Step 2: load + add test results
    agentContext.clear();
    const step2Task = (await db.tasks.get(taskId))!;
    for (const [k, v] of Object.entries(step2Task.agentContext || {})) {
      agentContext.set(k, v);
    }
    agentContext.set('testResults', { users: 'pass', orders: 'pass' });
    await db.tasks.update(taskId, { agentContext: agentContext.getAll() });

    // Step 3: load + verify everything is there + add integration notes
    agentContext.clear();
    const step3Task = (await db.tasks.get(taskId))!;
    for (const [k, v] of Object.entries(step3Task.agentContext || {})) {
      agentContext.set(k, v);
    }

    // Step 3 sees data from both step 1 and step 2
    expect(agentContext.get('apis')).toEqual(['users', 'orders']);
    expect(agentContext.get('testResults')).toEqual({ users: 'pass', orders: 'pass' });

    agentContext.set('integrationDone', true);
    await db.tasks.update(taskId, { agentContext: agentContext.getAll() });

    // Final verification: all 3 keys present in DB
    const finalTask = (await db.tasks.get(taskId))!;
    expect(Object.keys(finalTask.agentContext!)).toHaveLength(3);
    expect(finalTask.agentContext!.integrationDone).toBe(true);
  });
});

// ─── Flow 10: Analyze forwarding across steps ──────────────────
describe('Integration: analyze() output forwarded to subsequent steps', () => {
  it('analysis from step 1 appears in step 2 prompt via task.analysis', async () => {
    const llmResponses = [
      'The API returns a paginated list with a cursor token.',
    ];
    let callIdx = 0;
    const mockLlm = vi.fn().mockImplementation(() => {
      const resp = llmResponses[callIdx] || llmResponses[llmResponses.length - 1];
      callIdx++;
      return Promise.resolve(resp);
    });

    const orc = new Orchestrator();
    orc.init({
      repoUrl: 'https://github.com/test/repo',
      repoBranch: 'main',
      moduleConfigs: {},
      llmCall: mockLlm,
    });

    const taskId = 'test-af-1';
    await db.tasks.add({
      id: taskId,
      title: 'Analyze logs then fix bug',
      description: 'First analyze error logs, then fix the bug',
      workflowStatus: 'IN_PROGRESS',
      agentState: 'EXECUTING',
      createdAt: Date.now(),
      protocol: {
        steps: [
          { id: 1, title: 'Analyze', description: 'Analyze error logs', executor: 'executor-local', status: 'pending' },
          { id: 2, title: 'Fix', description: 'Fix the bug', executor: 'executor-local', status: 'pending' },
        ],
      },
    });

    // Simulate host.analyze being called during step 1
    // This is what the orchestrator.moduleRequest does for 'host.analyze'
    agentContext.clear();
    const analysisResult = await (orc as any).moduleRequest(taskId, 'host.analyze', [
      'Error: Cannot read property "cursor" of undefined at fetchPage (api.js:42)',
    ]);

    expect(analysisResult).toBe('The API returns a paginated list with a cursor token.');
    expect(mockLlm).toHaveBeenCalled();

    // After execution, orchestrator saves accumulatedAnalysis to task.analysis
    const accumulatedAnalysis = (orc as any).context.accumulatedAnalysis;
    expect(accumulatedAnalysis).toHaveLength(1);
    expect(accumulatedAnalysis[0]).toContain('paginated list');

    // Simulate persisting to task.analysis (as executeInSandbox does)
    const taskAfterStep1 = (await db.tasks.get(taskId))!;
    const existingAnalysis = taskAfterStep1.analysis ? taskAfterStep1.analysis + '\n' : '';
    const newAnalysis = accumulatedAnalysis.join('\n');
    await db.tasks.update(taskId, {
      agentContext: agentContext.getAll(),
      analysis: (existingAnalysis + newAnalysis).trim(),
    });

    // Verify task.analysis is persisted
    const updated = (await db.tasks.get(taskId))!;
    expect(updated.analysis).toContain('paginated list');

    // Verify composeProgrammerPrompt includes the analysis for step 2
    const modules = registry.getEnabled();
    const step2Prompt = composeProgrammerPrompt(
      modules,
      updated as Task,
      updated.protocol!.steps[1],
      '',
    );
    expect(step2Prompt).toContain('paginated list');
    expect(step2Prompt).toContain('Accumulated Analysis Results');
  });

  it('multiple analyze() calls accumulate across steps', async () => {
    const orc = new Orchestrator();
    const responses = ['Analysis 1: auth uses JWT tokens', 'Analysis 2: rate limit is 100/min'];
    let callIdx = 0;
    orc.init({
      repoUrl: 'https://github.com/test/repo',
      repoBranch: 'main',
      moduleConfigs: {},
      llmCall: vi.fn().mockImplementation(() => {
        const resp = responses[callIdx] || responses[responses.length - 1];
        callIdx++;
        return Promise.resolve(resp);
      }),
    });

    const taskId = 'test-af-2';
    await db.tasks.add({
      id: taskId,
      title: 'Multi-analyze task',
      description: 'Multiple analyses',
      workflowStatus: 'IN_PROGRESS',
      agentState: 'EXECUTING',
      createdAt: Date.now(),
      protocol: {
        steps: [
          { id: 1, title: 'Auth analysis', description: 'Analyze auth', executor: 'executor-local', status: 'pending' },
          { id: 2, title: 'Rate limit analysis', description: 'Analyze rate limiting', executor: 'executor-local', status: 'pending' },
          { id: 3, title: 'Implement', description: 'Implement solution', executor: 'executor-local', status: 'pending' },
        ],
      },
    });

    // Step 1: analyze auth
    agentContext.clear();
    await (orc as any).moduleRequest(taskId, 'host.analyze', ['auth logs']);

    // Step 2: analyze rate limit (accumulatedAnalysis keeps growing)
    await (orc as any).moduleRequest(taskId, 'host.analyze', ['rate limit logs']);

    // Both analyses accumulated
    expect((orc as any).context.accumulatedAnalysis).toHaveLength(2);
    expect((orc as any).context.accumulatedAnalysis[0]).toContain('JWT');
    expect((orc as any).context.accumulatedAnalysis[1]).toContain('rate limit');

    // Persist
    await db.tasks.update(taskId, {
      analysis: (orc as any).context.accumulatedAnalysis.join('\n'),
    });

    // Verify step 3 prompt sees both analyses
    const updated = (await db.tasks.get(taskId))!;
    const modules = registry.getEnabled();
    const step3Prompt = composeProgrammerPrompt(
      modules,
      updated as Task,
      updated.protocol!.steps[2],
      '',
    );
    expect(step3Prompt).toContain('JWT');
    expect(step3Prompt).toContain('rate limit');
  });

  it('addToContext stores key-value pairs visible in later steps', async () => {
    const orc = new Orchestrator();
    orc.init({
      repoUrl: 'https://github.com/test/repo',
      repoBranch: 'main',
      moduleConfigs: {},
      llmCall: vi.fn().mockResolvedValue('unused'),
    });

    const taskId = 'test-af-3';
    await db.tasks.add({
      id: taskId,
      title: 'Context passthrough',
      description: 'Test addToContext persistence',
      workflowStatus: 'IN_PROGRESS',
      agentState: 'EXECUTING',
      createdAt: Date.now(),
      protocol: {
        steps: [
          { id: 1, title: 'Store', description: 'Store data', executor: 'executor-local', status: 'pending' },
          { id: 2, title: 'Retrieve', description: 'Retrieve data', executor: 'executor-local', status: 'pending' },
        ],
      },
    });

    // Step 1: addToContext with key-value
    agentContext.clear();
    await (orc as any).moduleRequest(taskId, 'host.addToContext', ['dbSchema', 'users(id, name), orders(id, user_id, total)']);

    // Persist
    await db.tasks.update(taskId, { agentContext: agentContext.getAll() });

    // Step 2: load and verify in prompt
    const updated = (await db.tasks.get(taskId))!;
    const modules = registry.getEnabled();
    const prompt = composeProgrammerPrompt(
      modules,
      updated as Task,
      updated.protocol!.steps[1],
      '',
    );
    expect(prompt).toContain('dbSchema');
    expect(prompt).toContain('users(id, name)');
  });
});
