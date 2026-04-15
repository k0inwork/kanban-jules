import { db, KBEntry } from '../../services/db';
import { externalSources } from './external-kb';
import { RequestContext } from '../../core/types';

export async function microDream(taskId: string, context: RequestContext): Promise<string> {
  // Gather raw entries for this task
  let entries = await db.kbLog.where('active').equals(1).toArray();
  entries = entries.filter(e => e.tags.includes(taskId) && e.abstraction <= 2);

  if (entries.length < 3) {
    // Not enough to consolidate — just record executor outcome
    return `Micro-dream: only ${entries.length} raw entries for task ${taskId}, skipping consolidation.`;
  }

  // LLM call to summarize
  const texts = entries.map(e => `[${e.category}] ${e.text}`).join('\n');
  const prompt = `Summarize these ${entries.length} observations into 1-2 sentences. Focus on: what worked, what failed, what to do differently.\n\n${texts}`;

  const summary = await context.llmCall(prompt);

  // Union of all tags
  const allTags = [...new Set(entries.flatMap(e => e.tags))];

  // Append consolidated entry
  await db.kbLog.add({
    timestamp: Date.now(),
    text: summary,
    category: 'dream',
    abstraction: 5,
    layer: ['L0', 'L1'],
    tags: allTags,
    source: 'dream:micro',
    supersedes: entries.map(e => e.id!),
    active: true,
    project: entries[0]?.project || 'target'
  });

  // Deactivate raw entries
  await db.kbLog.bulkPut(
    entries.map(e => ({ ...e, active: false }))
  );

  return `Micro-dream: consolidated ${entries.length} entries for task ${taskId}.`;
}

export async function sessionDream(context: RequestContext): Promise<string> {
  // Phase 1: Gather
  let entries = await db.kbLog.where('active').equals(1).toArray();
  entries = entries.filter(e =>
    e.source === 'execution' || e.source === 'dream:micro'
  );

  const docs = await db.kbDocs.where('active').equals(1).toArray();
  const tasks = await db.tasks.toArray();

  if (entries.length === 0) {
    return 'Session-dream: no active entries to consolidate.';
  }

  // Phase 2: Pattern recognition via LLM
  const groupedTexts = entries.slice(0, 40).map(e => `[${e.category}|${e.source}] ${e.text}`).join('\n');
  const boardSummary = `${tasks.length} tasks: ${tasks.filter(t => t.workflowStatus === 'EXECUTING').length} executing, ${tasks.filter(t => t.workflowStatus === 'DONE').length} done`;

  const prompt = `Analyze these ${entries.length} active observations. Board: ${boardSummary}. Docs available: ${docs.length}.\n\nObservations:\n${groupedTexts}\n\nOutput JSON: { "patterns": [{ "text": "...", "tags": [] }], "failures": [{ "text": "...", "tags": [] }], "strategies": [{ "text": "...", "tags": [] }], "docGaps": [{ "text": "...", "tags": [] }] }`;

  const response = await context.llmCall(prompt, true);

  let parsed: { patterns: any[]; failures: any[]; strategies: any[]; docGaps: any[] };
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
  } catch {
    parsed = { patterns: [], failures: [], strategies: [], docGaps: [] };
  }

  // Phase 3: Consolidate — append pattern entries
  const allNew: KBEntry[] = [];

  for (const p of (parsed.patterns || [])) {
    allNew.push({
      timestamp: Date.now(), text: p.text, category: 'pattern',
      abstraction: 7, layer: ['L0'], tags: p.tags || [],
      source: 'dream:session', active: true, project: 'target'
    });
  }
  for (const f of (parsed.failures || [])) {
    allNew.push({
      timestamp: Date.now(), text: f.text, category: 'error',
      abstraction: 7, layer: ['L0'], tags: f.tags || [],
      source: 'dream:session', active: true, project: 'target'
    });
  }
  for (const s of (parsed.strategies || [])) {
    allNew.push({
      timestamp: Date.now(), text: s.text, category: 'decision',
      abstraction: 7, layer: ['L0', 'L1'], tags: s.tags || [],
      source: 'dream:session', active: true, project: 'target'
    });
  }

  // Phase 4: Flag doc gaps
  for (const g of (parsed.docGaps || [])) {
    allNew.push({
      timestamp: Date.now(), text: `GAP: ${g.text}`, category: 'observation',
      abstraction: 3, layer: ['L0'], tags: ['gap', ...(g.tags || [])],
      source: 'dream:session', active: true, project: 'target'
    });
  }

  if (allNew.length > 0) {
    await db.kbLog.bulkAdd(allNew);
  }

  // Phase 5: External enrichment (stubs — no-op in Phase 0)
  for (const source of externalSources) {
    if (source.available()) {
      // Future: query external sources for gap resolution
    }
  }

  return `Session-dream: ${allNew.length} insights from ${entries.length} entries.`;
}

export async function deepDream(context: RequestContext): Promise<string> {
  const entries = await db.kbLog.where('active').equals(1).toArray();
  const docs = await db.kbDocs.where('active').equals(1).toArray();
  const tasks = await db.tasks.toArray();
  const configs = await db.projectConfigs.toArray();
  const constitution = configs[0]?.constitution || '(none)';

  // Call 1: Project consolidation
  const entryTexts = entries.slice(0, 60).map(e => `[${e.category}|a${e.abstraction}] ${e.text}`).join('\n');
  const prompt = `Full project consolidation.\n\nConstitution: ${constitution.substring(0, 500)}\nBoard: ${tasks.length} tasks\nEntries (${entries.length}): ${entryTexts}\nDocs (${docs.length}): ${docs.map(d => d.title).join(', ')}\n\nWhat do we know? What works? What doesn't? What to change? Output 3-5 strategic insights.`;

  const consolidation = await context.llmCall(prompt);

  // Append strategic insights
  await db.kbLog.add({
    timestamp: Date.now(), text: consolidation, category: 'dream',
    abstraction: 9, layer: ['L0'], tags: ['deep-dream'],
    source: 'dream:deep', active: true, project: 'target'
  });

  // Call 2: Gap resolution via external (stubs — no-op Phase 0)
  for (const source of externalSources) {
    if (source.available()) {
      // Future: resolve gaps
    }
  }

  // Call 3: Constitution review — propose amendments
  const amendmentPrompt = `Given these outcomes:\n${entryTexts}\n\nShould any constitution rules change? Propose amendments with rationale. If none needed, say "No amendments needed."`;
  const amendmentResponse = await context.llmCall(amendmentPrompt);

  if (!amendmentResponse.includes('No amendments needed')) {
    await db.kbLog.add({
      timestamp: Date.now(), text: amendmentResponse, category: 'constitution',
      abstraction: 8, layer: ['L0'], tags: ['constitution-amendment'],
      source: 'dream:deep', active: true, project: 'self'
    });
  }

  // Call 4: Pruning — deactivate raw entries older than 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const prunable = entries.filter(e =>
    e.abstraction <= 2 && e.timestamp < sevenDaysAgo && e.source === 'execution'
  );
  if (prunable.length > 0) {
    await db.kbLog.bulkPut(
      prunable.map(e => ({ ...e, active: false }))
    );
  }

  return `Deep-dream: ${consolidation.length} chars strategic insight, ${prunable.length} entries pruned.`;
}
