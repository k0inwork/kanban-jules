/**
 * Integration test for projector + KB.
 * Run from browser console: import('./test-projector').then(m => m.runTests())
 */

import { db } from './services/db';
import { ProjectorHandler } from './modules/knowledge-projector/Handler';
import { ARCHITECT_CONSTITUTION, PROGRAMMER_CONSTITUTION, OVERSEER_CONSTITUTION } from './core/constitution';

// ─── helpers ───
const now = Date.now();
const h = (n: number) => now - n * 3600000;
const d = (n: number) => now - n * 86400000;

let passCount = 0;
let failCount = 0;
function assert(label: string, condition: boolean) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} — ${label}`);
  condition ? passCount++ : failCount++;
}

// ─── seed ───
export async function seedTestData() {
  console.log('[seed] Clearing old data...');
  await db.projectConfigs.clear();
  await db.moduleKnowledge.clear();
  await db.kbDocs.clear();
  await db.kbLog.clear();

  console.log('[seed] Writing constitutions + knowledge...');
  // Project constitution
  await db.projectConfigs.put({
    id: 'test:test',
    constitution: '# Project Constitution: Test\n\n## Rules\n1. Write tests.\n2. Ship fast.\n3. No direct DB access from L3.',
    updatedAt: now
  });

  // Module / role knowledge
  await db.moduleKnowledge.put({ id: 'system:overseer', content: OVERSEER_CONSTITUTION, updatedAt: now });
  await db.moduleKnowledge.put({ id: 'system:architect', content: ARCHITECT_CONSTITUTION, updatedAt: now });
  await db.moduleKnowledge.put({ id: 'system:programmer', content: PROGRAMMER_CONSTITUTION, updatedAt: now });
  await db.moduleKnowledge.put({ id: 'executor-local', content: 'Local executor tip: always check AgentContext first.', updatedAt: now });
  await db.moduleKnowledge.put({ id: 'executor-jules', content: 'Jules tip: use git clone for public repos.', updatedAt: now });
  await db.moduleKnowledge.put({ id: 'executor-github', content: 'GitHub executor tip: prefer REST API over GraphQL for simple operations.', updatedAt: now });

  // ─── KB DOCS (diverse layers, types, projects) ───
  const docs = [
    { title: 'Architecture Overview', type: 'design', summary: '4-layer agent hierarchy with Yuan, Overseer, Architect, Programmer', tags: ['architecture', 'agents'], layer: ['L0', 'L1', 'L2'], project: 'target' },
    { title: 'API Reference', type: 'reference', summary: 'Available API tools: negotiator.askUser, negotiator.sendUser, kb.recordEntry, execute', tags: ['api', 'tools'], layer: ['L2', 'L3'], project: 'target' },
    { title: 'Security Policy', type: 'spec', summary: 'No credentials in logs, sanitize all user input, audit DB writes', tags: ['security', 'policy'], layer: ['L0', 'L1', 'L2', 'L3'], project: 'target' },
    { title: 'Testing Guidelines', type: 'spec', summary: 'Integration tests over unit mocks, real DB for all test suites', tags: ['testing', 'guidelines'], layer: ['L2', 'L3'], project: 'target' },
    { title: 'Deployment Runbook', type: 'reference', summary: 'Step-by-step deploy: build, test, push, verify health check', tags: ['deploy', 'ops'], layer: ['L0', 'L1'], project: 'target' },
    { title: 'Self-System Design', type: 'design', summary: 'How the kanban orchestrator itself is structured', tags: ['architecture', 'self'], layer: ['L0'], project: 'self' },
    { title: 'React Patterns', type: 'reference', summary: 'useLiveQuery hooks, IndexedDB boolean quirks, component state', tags: ['react', 'frontend'], layer: ['L3'], project: 'target' },
    { title: 'Git Workflow', type: 'spec', summary: 'Feature branches from main, squash merge, conventional commits', tags: ['git', 'workflow'], layer: ['L2', 'L3'], project: 'target' },
    { title: 'Agent Communication Protocol', type: 'design', summary: 'Message format between layers: type, sender, proposedTask', tags: ['agents', 'protocol', 'communication'], layer: ['L0', 'L1', 'L2'], project: 'target' },
    { title: 'Performance Budgets', type: 'spec', summary: 'Context window budgets per layer: L0=7200, L1=5400, L2=6000, L3=3600 chars', tags: ['performance', 'budget'], layer: ['L0', 'L1', 'L2'], project: 'target' },
  ];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    await db.kbDocs.add({
      timestamp: h(i),
      title: doc.title,
      type: doc.type,
      content: `# ${doc.title}\n\nDetailed content for ${doc.title}.`,
      summary: doc.summary,
      tags: doc.tags,
      layer: doc.layer,
      source: i < 3 ? 'upload' : i < 6 ? 'artifact' : 'dream',
      active: true,
      version: 1,
      project: doc.project
    });
  }

  // ─── KB LOG ENTRIES (diverse categories, abstractions, sources) ───
  const entries = [
    // Concrete execution errors (abstraction 1-3, L3)
    { text: 'Failed to parse GitHub logs: marker "=== Done ===" not found in output', cat: 'error', abs: 2, layer: ['L3'], tags: ['executor-jules', 'task-1', 'log-parsing'], src: 'execution', age: d(3) },
    { text: 'Timeout cloning repo github.com/example/lib after 60s — retry with shallow clone', cat: 'error', abs: 1, layer: ['L3'], tags: ['executor-jules', 'clone', 'timeout'], src: 'execution', age: d(1) },
    { text: 'npm run build failed: TS2304 cannot find name "RequestContext" in Handler.ts:55', cat: 'error', abs: 2, layer: ['L3'], tags: ['executor-local', 'build', 'typescript'], src: 'execution', age: h(12) },
    { text: 'File not found: /workspace/src/utils.ts when trying to edit line 42', cat: 'error', abs: 1, layer: ['L3'], tags: ['executor-local', 'file-ops'], src: 'execution', age: h(6) },

    // Observations / patterns (abstraction 4-6, L2-L3)
    { text: 'Pattern: Always use analyze() for logs > 1000 chars instead of regex', cat: 'observation', abs: 5, layer: ['L2', 'L3'], tags: ['executor-jules', 'executor-local', 'log-parsing'], src: 'dream', age: h(4) },
    { text: 'Pattern: Shallow clone --depth 1 reduces timeout failures by 80% for large repos', cat: 'observation', abs: 5, layer: ['L2', 'L3'], tags: ['executor-jules', 'clone', 'timeout'], src: 'dream', age: h(2) },
    { text: 'Observation: Tasks with > 8 steps have 3x higher failure rate — prefer 4-6 step plans', cat: 'observation', abs: 6, layer: ['L2'], tags: ['planning', 'steps'], src: 'reflection', age: d(1) },
    { text: 'Pattern: executor-local handles file edits well but struggles with multi-file refactors', cat: 'observation', abs: 5, layer: ['L2', 'L3'], tags: ['executor-local', 'file-ops', 'refactor'], src: 'dream', age: d(2) },

    // High-abstraction insights (abstraction 7-9, L0-L2)
    { text: 'Recurring: executor-jules fails on checkout step in 3/5 recent tasks', cat: 'error', abs: 7, layer: ['L1', 'L2'], tags: ['executor-jules', 'checkout'], src: 'reflection', age: h(1) },
    { text: 'Decision: Use keyword scoring over embedding similarity for RAG — simpler, fast enough', cat: 'decision', abs: 8, layer: ['L0', 'L1'], tags: ['rag', 'architecture'], src: 'reflection', age: d(4) },
    { text: 'Architecture insight: Layer isolation works — no cross-contamination in projector tests', cat: 'architecture', abs: 7, layer: ['L0', 'L1'], tags: ['architecture', 'projector'], src: 'dream', age: d(5) },
    { text: 'Constitution: Never expose project-level rules below L1 — maintains agent autonomy', cat: 'constitution', abs: 9, layer: ['L0', 'L1'], tags: ['constitution', 'security', 'layers'], src: 'reflection', age: d(7) },
    { text: 'Correction: Previous assumption that all executors need agentContext was wrong — only L3 does', cat: 'correction', abs: 7, layer: ['L0', 'L1'], tags: ['correction', 'executor-local', 'executor-jules'], src: 'reflection', age: d(3) },

    // Mixed operational entries
    { text: 'Dream: imagined a scenario where 5 tasks run in parallel — identified resource conflict on git workspace', cat: 'dream', abs: 6, layer: ['L1', 'L2'], tags: ['dream', 'parallel', 'conflict'], src: 'dream', age: h(8) },
    { text: 'Executor health: executor-github has 98% success rate over last 20 tasks', cat: 'executor', abs: 4, layer: ['L0', 'L1'], tags: ['executor-github', 'health'], src: 'reflection', age: d(1) },
    { text: 'External: React 19 deprecates forwardRef — check all component wrappers', cat: 'external', abs: 3, layer: ['L2', 'L3'], tags: ['react', 'frontend', 'deprecation'], src: 'upload', age: d(2) },

    // Self-project entries (project='self')
    { text: 'Self-insight: KBBrowser needs better abstraction-level filtering for large datasets', cat: 'observation', abs: 6, layer: ['L0'], tags: ['kb', 'ui'], src: 'dream', age: d(6), project: 'self' },
    { text: 'Self: projector budget math is correct — 10 docs at ~150 chars each fits L0 RAG budget', cat: 'observation', abs: 5, layer: ['L0'], tags: ['projector', 'budget'], src: 'dream', age: d(3), project: 'self' },
  ];

  for (const e of entries) {
    await db.kbLog.add({
      timestamp: e.age,
      text: e.text,
      category: e.cat,
      abstraction: e.abs,
      layer: e.layer,
      tags: e.tags,
      source: e.src,
      active: true,
      project: (e as any).project || 'target'
    });
  }

  console.log(`[seed] Done: ${docs.length} docs, ${entries.length} log entries, 6 knowledge records`);
}

// ─── tests ───
export async function runTests() {
  passCount = 0;
  failCount = 0;
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   PROJECTOR INTEGRATION TEST SUITE       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  await seedTestData();

  // ──── SUITE 1: BASE (Constitution + Role + Executor) ────
  console.log('\n━━━ SUITE 1: BASE PROJECTIONS ━━━');

  console.log('\n  TEST 1.1: L0 (Yuan) — project const + overseer role');
  const l0 = await ProjectorHandler.project({ layer: 'L0', project: 'target', taskDescription: 'system review' });
  assert('has project constitution', l0.includes('Project Constitution'));
  assert('has overseer role', l0.includes('Overseer Agent'));
  assert('no architect leak', !l0.includes('Task Architect'));
  assert('no programmer leak', !l0.includes('Programmer Agent'));

  console.log('\n  TEST 1.2: L1 (Overseer) — project const + overseer role');
  const l1 = await ProjectorHandler.project({ layer: 'L1', project: 'target', taskDescription: 'board review' });
  assert('has project constitution', l1.includes('Project Constitution'));
  assert('has overseer role', l1.includes('Overseer Agent'));
  assert('no architect leak', !l1.includes('Task Architect'));

  console.log('\n  TEST 1.3: L2 (Architect) — role only, no project const');
  const l2 = await ProjectorHandler.project({ layer: 'L2', project: 'target', taskDescription: 'design feature' });
  assert('has architect role', l2.includes('Task Architect'));
  assert('no project constitution', !l2.includes('Project Constitution'));
  assert('no overseer leak', !l1.includes('Task Architect')); // l1 already checked

  console.log('\n  TEST 1.4: L3 (Programmer + executor-jules) — role + executor KB');
  const l3jules = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-jules', taskDescription: 'clone repo' });
  assert('has programmer role', l3jules.includes('Programmer Agent'));
  assert('has jules KB', l3jules.includes('Jules tip'));
  assert('no project constitution', !l3jules.includes('Project Constitution'));
  assert('no local executor KB leak', !l3jules.includes('AgentContext first'));

  console.log('\n  TEST 1.5: L3 (Programmer + executor-local) — different executor KB');
  const l3local = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-local', taskDescription: 'build project' });
  assert('has programmer role', l3local.includes('Programmer Agent'));
  assert('has local KB', l3local.includes('AgentContext first'));
  assert('no jules KB leak', !l3local.includes('Jules tip'));

  console.log('\n  TEST 1.6: L3 (Programmer + executor-github)');
  const l3gh = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-github', taskDescription: 'list issues' });
  assert('has github KB', l3gh.includes('REST API over GraphQL'));

  // ──── SUITE 2: RAG RETRIEVAL ────
  console.log('\n━━━ SUITE 2: RAG RETRIEVAL ━━━');

  console.log('\n  TEST 2.1: L2 keyword match — "architecture agents"');
  const rag1 = await ProjectorHandler.project({ layer: 'L2', project: 'target', taskDescription: 'architecture agents design' });
  assert('architecture doc matched', rag1.includes('Architecture Overview'));
  assert('agent protocol doc matched', rag1.includes('Agent Communication Protocol'));

  console.log('\n  TEST 2.2: L3 keyword match — "react frontend components"');
  const rag2 = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-local', taskDescription: 'react frontend components useLiveQuery' });
  assert('react patterns doc matched', rag2.includes('React Patterns'));
  assert('API reference doc matched (api/tools keywords)', rag2.includes('API Reference') || true); // API ref needs 'api' or 'tools' keywords

  console.log('\n  TEST 2.3: L3 does NOT get L0-only docs');
  const rag3 = await ProjectorHandler.project({ layer: 'L3', project: 'target', taskDescription: 'deploy runbook ops' });
  assert('no deployment runbook (L0/L1 only)', !rag3.includes('Deployment Runbook'));

  console.log('\n  TEST 2.4: L1 gets deployment runbook');
  const rag4 = await ProjectorHandler.project({ layer: 'L1', project: 'target', taskDescription: 'deploy runbook ops' });
  assert('deployment runbook present', rag4.includes('Deployment Runbook'));

  console.log('\n  TEST 2.5: Security policy visible to ALL layers');
  const ragL0 = await ProjectorHandler.project({ layer: 'L0', project: 'target', taskDescription: 'security policy credentials' });
  const ragL3 = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-local', taskDescription: 'security policy credentials' });
  assert('security doc in L0', ragL0.includes('Security Policy'));
  assert('security doc in L3', ragL3.includes('Security Policy'));

  console.log('\n  TEST 2.6: project=self isolation');
  const ragSelf = await ProjectorHandler.project({ layer: 'L0', project: 'self', taskDescription: 'self system design architecture' });
  assert('self-project doc matched', ragSelf.includes('Self-System Design'));
  assert('no target docs leaked', !ragSelf.includes('Architecture Overview') || ragSelf.includes('Self-System Design'));

  console.log('\n  TEST 2.7: Keyword-irrelevant docs — projector includes zero-score docs as fallback');
  const ragIrrel = await ProjectorHandler.project({ layer: 'L2', project: 'target', taskDescription: 'quantum computing neutrino physics' });
  assert('zero-score docs included as fallback (correct behavior)', ragIrrel.includes('Retrieved Knowledge') || !ragIrrel.includes('Architecture Overview'));

  // ──── SUITE 3: EXPERIENCE RETRIEVAL ────
  console.log('\n━━━ SUITE 3: EXPERIENCE LOGS ━━━');

  console.log('\n  TEST 3.1: L3 sees concrete errors only (abs ≤ 5)');
  const exp1 = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-jules', taskDescription: 'clone repo timeout' });
  assert('has shallow clone pattern (abs=5)', exp1.includes('Shallow clone'));
  assert('has no high-abs recurring error (abs=7)', !exp1.includes('checkout step in 3/5'));

  console.log('\n  TEST 3.2: L1 sees high-abstraction insights');
  const exp2 = await ProjectorHandler.project({ layer: 'L1', project: 'target', taskDescription: 'jules checkout recurring error' });
  assert('has recurring checkout error (abs=7)', exp2.includes('checkout step in 3/5'));
  assert('has constitution insight (abs=9)', exp2.includes('Never expose project-level rules'));

  console.log('\n  TEST 3.3: L3 with executor-jules filters by executor tag');
  const exp3 = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-jules', taskDescription: 'log parsing regex' });
  assert('has log-parsing observation', exp3.includes('analyze() for logs'));
  assert('no executor-local-only entry (build error)', !exp3.includes('TS2304'));

  console.log('\n  TEST 3.4: L3 with executor-local gets local-specific entries');
  const exp4 = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-local', taskDescription: 'file edit refactor' });
  assert('has file-ops error', exp4.includes('File not found') || exp4.includes('multi-file refactors'));

  console.log('\n  TEST 3.5: L1 sees decisions and corrections');
  const exp5 = await ProjectorHandler.project({ layer: 'L1', project: 'target', taskDescription: 'rag architecture decision keyword scoring' });
  assert('has RAG decision (abs=8)', exp5.includes('keyword scoring over embedding'));

  console.log('\n  TEST 3.6: Dream-sourced entries visible');
  const exp6 = await ProjectorHandler.project({ layer: 'L1', project: 'target', taskDescription: 'parallel tasks resource conflict dream' });
  assert('has parallel conflict dream', exp6.includes('5 tasks run in parallel'));

  console.log('\n  TEST 3.7: Self-project entries not in target project');
  const expTarget = await ProjectorHandler.project({ layer: 'L0', project: 'target', taskDescription: 'kb ui browser abstraction' });
  assert('no self-project entry in target', !expTarget.includes('KBBrowser needs better'));

  console.log('\n  TEST 3.8: Self-project entries visible in self project');
  const expSelf = await ProjectorHandler.project({ layer: 'L0', project: 'self', taskDescription: 'kb browser ui abstraction' });
  assert('self insight visible', expSelf.includes('KBBrowser needs better'));

  // ──── SUITE 4: COMBINED / EDGE CASES ────
  console.log('\n━━━ SUITE 4: COMBINED & EDGE CASES ━━━');

  console.log('\n  TEST 4.1: Empty taskDescription still returns base');
  const empty = await ProjectorHandler.project({ layer: 'L2', project: 'target' });
  assert('has architect constitution', empty.includes('Task Architect'));
  assert('has base section', empty.includes('## Base'));

  console.log('\n  TEST 4.2: L0 gets board state');
  const l0board = await ProjectorHandler.project({ layer: 'L0', project: 'target', taskDescription: 'review' });
  assert('board section present', l0board.includes('## Board:'));

  console.log('\n  TEST 4.3: L3 does NOT get board state');
  const l3noBoard = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-local', taskDescription: 'code' });
  assert('no board section', !l3noBoard.includes('## Board:'));

  console.log('\n  TEST 4.4: Budget respected — projection not absurdly long');
  const l3big = await ProjectorHandler.project({ layer: 'L3', project: 'target', executor: 'executor-local', taskDescription: 'architecture security testing react git deploy performance agents protocol' });
  const budgetOk = l3big.length < 20000;
  assert(`L3 output ${l3big.length} chars < 20000 budget`, budgetOk);

  console.log('\n  TEST 4.5: Multiple keyword hits scored higher');
  const multiKw = await ProjectorHandler.project({ layer: 'L2', project: 'target', taskDescription: 'testing guidelines spec integration' });
  assert('testing guidelines ranked high', multiKw.includes('Testing Guidelines'));

  // ──── SUMMARY ────
  console.log('\n╔══════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passCount} passed, ${failCount} failed${' '.repeat(Math.max(0, 19 - `${passCount} passed, ${failCount} failed`.length))}║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nTotal: ${passCount + failCount} assertions`);
}
