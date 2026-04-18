import { db, KBEntry } from '../../services/db';
import { externalSources } from './external-kb';
import { RequestContext } from '../../core/types';
import { eventBus } from '../../core/event-bus';
import { KBHandler } from '../knowledge-kb/Handler';

export async function microDream(taskId: string, context: RequestContext): Promise<string> {
  // Idempotency guard: skip consolidation if already ran for this task
  const existingConsolidation = await db.kbLog
    .filter(e => e.active && e.source === 'dream:micro' && e.category === 'insight' && e.tags.includes(taskId))
    .count();
  if (existingConsolidation > 0) {
    return `Micro-dream: already consolidated for task ${taskId}, skipping.`;
  }

  // Gather raw entries for this task
  let entries = await db.kbLog.filter(e => e.active).toArray();
  entries = entries.filter(e => e.tags.includes(taskId) && e.abstraction <= 2);

  // Phase 1d: Decision verification — classify + verify harvested decisions
  const verifiedCount = await verifyDecisions(taskId, context);

  if (entries.length < 3) {
    // Not enough to consolidate — just record executor outcome
    return `Micro-dream: only ${entries.length} raw entries for task ${taskId}, skipping consolidation. Verified ${verifiedCount} decisions.`;
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
    category: 'insight',
    abstraction: 5,
    layer: ['L0', 'L1'],
    tags: [...allTags, 'consolidation'],
    source: 'dream:micro',
    supersedes: entries.map(e => e.id!),
    active: true,
    project: entries[0]?.project || 'target'
  });

  // Deactivate raw entries
  await db.kbLog.bulkPut(
    entries.map(e => ({ ...e, active: false }))
  );

  // Step 6: Record executor outcome entry (proposal §5.3)
  const errorCount = entries.filter(e => e.category === 'error').length;
  const successCount = entries.filter(e => e.category !== 'error').length;
  await db.kbLog.add({
    timestamp: Date.now(),
    text: `Task ${taskId}: ${entries.length} entries processed (${successCount} success, ${errorCount} errors). ${errorCount > 0 ? 'Errors detected — follow-up recommended.' : 'Clean execution.'}`,
    category: 'observation',
    abstraction: 3,
    layer: ['L1'],
    tags: [...allTags, 'executor-outcome'],
    source: 'dream:micro',
    active: true,
    project: entries[0]?.project || 'target',
  });

  return `Micro-dream: consolidated ${entries.length} entries, verified ${verifiedCount} decisions for task ${taskId}.`;
}

/**
 * Phase 1d: Verify + classify decision entries harvested for this task.
 * Reads unverified decisions (source: 'dream:micro', no 'verified' tag),
 * asks LLM to confirm classification + find missed decisions.
 * Returns number of decisions verified.
 */
async function verifyDecisions(taskId: string, context: RequestContext): Promise<number> {
  // Find harvested decisions for this task that haven't been verified yet
  const harvested = await db.kbLog
    .filter(e => e.active && e.category === 'decision' && e.source === 'dream:micro' && e.tags.includes(taskId) && !e.tags.includes('verified'))
    .toArray();

  if (harvested.length === 0) return 0;

  const decisionTexts = harvested.map(e =>
    `[id:${e.id}] ${e.text} (tags: ${e.tags.filter(t => t !== taskId).join(', ') || 'none'})`
  ).join('\n');

  const prompt = `Verify these ${harvested.length} extracted decisions for task ${taskId}.
For each decision:
1. Confirm the classification tag is correct (architectural, api, dependency, pattern, local, infra, security)
2. If the tag is wrong, provide the correct one
3. If any decisions were missed (obvious from context), add them

Decisions:
${decisionTexts}

Output JSON array:
[{
  "id": <entry_id>,
  "action": "confirm" | "reclassify",
  "tags": ["correct_classification"],
  "confidence": "high" | "medium"
}]

If no changes needed, output: []

Output ONLY the JSON array.`;

  try {
    const response = await context.llmCall(prompt, true);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return 0;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return 0;

    let verified = 0;
    for (const item of parsed) {
      if (!item.id) continue;
      const entry = await db.kbLog.get(item.id);
      if (!entry) continue;

      const updates: Partial<KBEntry> = { tags: [...entry.tags] };
      // Add verified tag
      if (!updates.tags!.includes('verified')) {
        updates.tags!.push('verified');
      }

      // Reclassify if action is reclassify and tags provided
      if (item.action === 'reclassify' && Array.isArray(item.tags) && item.tags.length > 0) {
        // Remove old classification tags, keep non-classification ones
        const classifications = ['architectural', 'api', 'dependency', 'pattern', 'local', 'infra', 'security'];
        updates.tags = entry.tags.filter(t => !classifications.includes(t));
        updates.tags.push(...item.tags);
        if (!updates.tags.includes('verified')) updates.tags.push('verified');
      }

      await db.kbLog.update(item.id, updates);
      verified++;
    }

    return verified;
  } catch {
    return 0;
  }
}

export async function sessionDream(context: RequestContext): Promise<string> {
  // Idempotency guard: skip if session dream already ran (has active session-level insights)
  const existingSessionInsights = await db.kbLog
    .filter(e => e.active && e.source === 'dream:session' && e.category === 'insight')
    .count();
  if (existingSessionInsights > 0) {
    return 'Session-dream: already ran this session, skipping.';
  }

  // Phase 1: Gather — only raw observations + decisions, not consolidation output
  let entries = await db.kbLog.filter(e => e.active).toArray();
  entries = entries.filter(e =>
    e.source === 'execution' || (e.source === 'dream:micro' && e.category !== 'insight')
  );

  const docs = await db.kbDocs.filter(d => d.active).toArray();
  const tasks = await db.tasks.toArray();

  if (entries.length === 0) {
    return 'Session-dream: no active entries to consolidate.';
  }

  // Phase 2: Pattern recognition via LLM
  const groupedTexts = entries.slice(0, 40).map(e => `[${e.category}|${e.source}] ${e.text}`).join('\n');
  const boardSummary = `${tasks.length} tasks: ${tasks.filter(t => t.workflowStatus === 'IN_PROGRESS').length} in progress, ${tasks.filter(t => t.workflowStatus === 'DONE').length} done`;

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
      timestamp: Date.now(), text: p.text, category: 'insight',
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
      abstraction: 7, layer: ['L0', 'L1'], tags: [...(s.tags || []), 'strategy'],
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

  // Phase 1f: Conflict detection — must run BEFORE Phase 4b deactivation
  const conflictsEscalated = await detectConflicts(context);

  // Phase 4b: Deactivate superseded entries (observations + micro-dreams only).
  // Errors are NOT deactivated here — they must survive for process-reflection
  // to analyze and potentially reclassify. Once reflection runs (Phase 3 in the
  // full proposal), errors that get reclassified move to project='self'.
  const superseded = entries.filter(e =>
    e.id && e.category !== 'error' && e.category !== 'decision'
  );
  if (superseded.length > 0) {
    await db.kbLog.bulkPut(
      superseded.map(e => ({ ...e, active: false }))
    );
  }

  // Phase 5: External enrichment (stubs — no-op in Phase 0)
  for (const source of externalSources) {
    if (source.available()) {
      // Future: query external sources for gap resolution
    }
  }

  return `Session-dream: ${allNew.length} insights from ${entries.length} entries. ${conflictsEscalated} conflicts escalated.`;
}

/**
 * Phase 1f: Compare verified decisions across tasks for contradictions.
 * Only flags ESCALATE-severity conflicts (direct contradictions on same scope).
 * Creates escalation AgentMessages for user resolution.
 * Returns number of conflicts escalated.
 */
async function detectConflicts(context: RequestContext): Promise<number> {
  // Gather verified active decisions that are NOT already pending conflict resolution
  const decisions = await db.kbLog
    .filter(e => e.active && e.category === 'decision' && e.tags.includes('verified') && !e.tags.includes('conflict-pending'))
    .toArray();

  if (decisions.length < 2) return 0;

  const decisionTexts = decisions.map(d =>
    `[id:${d.id}] ${d.text} (abs:${d.abstraction}, src:${d.source}, tags: ${d.tags.filter(t => t !== 'verified').join(', ') || 'none'})`
  ).join('\n');

  const prompt = `Compare these ${decisions.length} verified decisions across tasks.
Find ONLY direct contradictions: same concern, same scope, different choices.
Similar but compatible approaches are NOT conflicts.

Decisions:
${decisionTexts}

For each conflict found, output:
[{
  "id1": <entry_id>,
  "id2": <entry_id>,
  "concern": "what the conflict is about",
  "d1_choice": "summary of first decision",
  "d2_choice": "summary of second decision",
  "severity": "ESCALATE",
  "suggestion": "merged rule that covers both"
}]

Severity filter rules:
- ESCALATE: two decisions directly contradict on the SAME scope
- NOT a conflict: same approach reached independently (confirmation)
- NOT a conflict: different patterns for different contexts
- NOT a conflict: one decision extends another

If no conflicts, output: []

Output ONLY the JSON array.`;

  try {
    const response = await context.llmCall(prompt, true);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return 0;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return 0;

    const escalateConflicts = parsed.filter((c: any) => c.severity === 'ESCALATE');
    if (escalateConflicts.length === 0) return 0;

    let autoResolved = 0;
    let escalated = 0;

    for (const conflict of escalateConflicts) {
      const d1 = decisions.find(d => d.id === conflict.id1);
      const d2 = decisions.find(d => d.id === conflict.id2);
      if (!d1 || !d2) continue;

      // Tag both decisions as conflict-pending to prevent re-escalation
      await db.kbLog.update(d1.id, { tags: [...d1.tags, 'conflict-pending'] });
      await db.kbLog.update(d2.id, { tags: [...d2.tags, 'conflict-pending'] });

      const conflictType = await classifyConflict(d1, d2);

      if (conflictType === 'constitutional-override') {
        await resolveConstitutional(d1, d2);
        autoResolved++;
      } else if (conflictType === 'guiding') {
        await resolveGuiding(d1, d2);
        autoResolved++;
      } else {
        // Self-correcting or doubtful — escalate to user
        const msgId = await createEscalationMessage(d1, d2, conflict, conflictType);
        registerConflictResolutionHandler(msgId, d1.id, d2.id, conflict.suggestion, conflictType);
        escalated++;
      }
    }

    return escalated;
  } catch {
    return 0;
  }
}

// ─── Evidence Scoring ──────────────────────────────────────────────

const PROVENANCE_SCORES: Record<string, number> = {
  user: 5,
  execution: 4,
  'dream:micro': 3,
  'dream:session': 2,
  'dream:deep': 1,
};

function evidenceScore(entry: KBEntry): number {
  let score = 0;

  // Source provenance
  score += PROVENANCE_SCORES[entry.source] ?? 0;

  // Duration standing (days, capped at 5)
  const daysStanding = (Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24);
  score += Math.min(Math.floor(daysStanding), 5);

  // Verification
  if (entry.tags.includes('verified')) score += 3;

  // Conflict survivor
  if (entry.tags.includes('conflict-resolved')) score += 2;

  // Supersession breadth
  if (entry.supersedes) score += Math.min(Math.floor(entry.supersedes.length / 2), 3);

  // Constitutional — absolute authority
  if (entry.tags.includes('constitution')) score += 10;

  return score;
}

async function corroborationScore(entry: KBEntry): Promise<number> {
  const executionEntries = await db.kbLog
    .filter(e => e.active && e.source === 'execution' && e.timestamp > entry.timestamp)
    .toArray();

  const overlapping = executionEntries.filter(e =>
    e.tags.some(t => entry.tags.includes(t))
  );

  return Math.min(overlapping.length, 5);
}

async function fullEvidenceScore(entry: KBEntry): Promise<number> {
  return evidenceScore(entry) + await corroborationScore(entry);
}

// ─── Conflict Classification ───────────────────────────────────────

type ConflictType = 'constitutional-override' | 'constitutional-amendment' | 'guiding' | 'self-correcting' | 'doubtful';

async function classifyConflict(d1: KBEntry, d2: KBEntry): Promise<ConflictType> {
  const d1Const = d1.tags.includes('constitution');
  const d2Const = d2.tags.includes('constitution');

  if (d1Const && d2Const) return 'constitutional-amendment';
  if (d1Const || d2Const) return 'constitutional-override';

  const score1 = await fullEvidenceScore(d1);
  const score2 = await fullEvidenceScore(d2);

  const lower = d1.abstraction >= d2.abstraction ? d2 : d1;
  const higherScore = d1.abstraction >= d2.abstraction ? score1 : score2;
  const lowerScore = d1.abstraction >= d2.abstraction ? score2 : score1;

  const absGap = Math.abs(d1.abstraction - d2.abstraction);

  // Same level — always doubtful
  if (absGap === 0) return 'doubtful';

  // Cross-level with strong lower evidence — self-correcting
  const lowerHasExecution = lower.source === 'execution' || lower.source === 'user';
  const lowerCorroboration = await corroborationScore(lower);

  if (lowerScore >= higherScore && (lowerHasExecution || lowerCorroboration >= 3)) {
    return 'self-correcting';
  }

  // Cross-level with weak lower evidence — guiding
  if (absGap >= 2 && (higherScore - lowerScore) >= 4 && lowerCorroboration < 2) {
    return 'guiding';
  }

  // Default to user judgment
  return 'doubtful';
}

// ─── Resolution Audit Entry ────────────────────────────────────────

async function writeResolutionEntry(
  type: ConflictType,
  method: string,
  d1: KBEntry,
  d2: KBEntry,
  winnerId: number | undefined,
): Promise<void> {
  const d1Score = await fullEvidenceScore(d1);
  const d2Score = await fullEvidenceScore(d2);
  const d1Corroboration = await corroborationScore(d1);
  const d2Corroboration = await corroborationScore(d2);

  const d1Days = Math.floor((Date.now() - d1.timestamp) / (1000 * 60 * 60 * 24));
  const d2Days = Math.floor((Date.now() - d2.timestamp) / (1000 * 60 * 60 * 24));

  const prefix = method === 'auto' ? '[AUTO' : '[USER';
  const winnerLabel = winnerId === d1.id ? 'D1' : winnerId === d2.id ? 'D2' : 'MERGED';

  const text = [
    `${prefix}:${type}]`,
    `D1 (#${d1.id}): "${d1.text}" (abs ${d1.abstraction}, evidence ${d1Score})`,
    `  src=${d1.source} | standing=${d1Days}d | ${d1.tags.includes('verified') ? 'verified' : 'unverified'} | supersedes ${d1.supersedes?.length ?? 0} | corroboration ${d1Corroboration}`,
    `D2 (#${d2.id}): "${d2.text}" (abs ${d2.abstraction}, evidence ${d2Score})`,
    `  src=${d2.source} | standing=${d2Days}d | ${d2.tags.includes('verified') ? 'verified' : 'unverified'} | supersedes ${d2.supersedes?.length ?? 0} | corroboration ${d2Corroboration}`,
    `\u2192 ${winnerLabel}.`,
  ].join('\n');

  const cascadeLayers = [...new Set([...d1.layer, ...d2.layer])];

  await db.kbLog.add({
    timestamp: Date.now(),
    text,
    category: 'resolution',
    abstraction: Math.max(d1.abstraction, d2.abstraction) + 1,
    layer: cascadeLayers,
    tags: [
      'conflict-resolved',
      `type:${type}`,
      `method:${method}`,
      ...(winnerId ? [`winner:${winnerId}`] : []),
    ],
    source: 'conflict-resolution',
    supersedes: [d1.id!, d2.id!].filter(Boolean),
    active: true,
    project: d1.project || 'target',
  });
}

// ─── Auto-Resolvers ────────────────────────────────────────────────

async function resolveConstitutional(d1: KBEntry, d2: KBEntry): Promise<void> {
  const winner = d1.tags.includes('constitution') ? d1 : d2;
  const loser = winner === d1 ? d2 : d1;
  const loserId = loser.id!;

  await db.kbLog.update(loserId, { active: false });
  await db.kbLog.update(winner.id!, {
    tags: winner.tags.filter(t => t !== 'conflict-pending').concat('conflict-resolved'),
  });

  await writeResolutionEntry('constitutional-override', 'auto', d1, d2, winner.id);
}

async function resolveGuiding(d1: KBEntry, d2: KBEntry): Promise<void> {
  const higher = d1.abstraction >= d2.abstraction ? d1 : d2;
  const lower = d1.abstraction >= d2.abstraction ? d2 : d1;

  await db.kbLog.update(lower.id!, { active: false });
  await db.kbLog.update(higher.id!, {
    tags: higher.tags.filter(t => t !== 'conflict-pending').concat('conflict-resolved'),
  });

  await writeResolutionEntry('guiding', 'auto', d1, d2, higher.id);
}

// ─── User Escalation ───────────────────────────────────────────────

async function createEscalationMessage(
  d1: KBEntry,
  d2: KBEntry,
  conflict: any,
  conflictType: ConflictType,
): Promise<number> {
  const d1Score = await fullEvidenceScore(d1);
  const d2Score = await fullEvidenceScore(d2);
  const d1Corroboration = await corroborationScore(d1);
  const d2Corroboration = await corroborationScore(d2);

  const isSelfCorrecting = conflictType === 'self-correcting';
  const recommendation = isSelfCorrecting
    ? `\n\n\u26a0 Recommendation: Adopt the entry with stronger evidence (higher evidence score).`
    : '';

  const evidenceBreakdown = [
    `D${d1.id} (abs ${d1.abstraction}, evidence ${d1Score}): ${conflict.d1_choice}`,
    `  src=${d1.source} | corroboration=${d1Corroboration} | ${d1.tags.includes('verified') ? 'verified' : 'unverified'}`,
    `D${d2.id} (abs ${d2.abstraction}, evidence ${d2Score}): ${conflict.d2_choice}`,
    `  src=${d2.source} | corroboration=${d2Corroboration} | ${d2.tags.includes('verified') ? 'verified' : 'unverified'}`,
  ].join('\n');

  const typeLabel = isSelfCorrecting ? 'Self-correcting insight vs. strategic assumption'
    : 'Conflicting approaches';

  // Create conflict KB entry (preserving existing behavior)
  await db.kbLog.add({
    timestamp: Date.now(),
    text: `CONFLICT: ${conflict.concern} \u2014 D${d1.id} vs D${d2.id}`,
    category: 'decision',
    abstraction: 7,
    layer: ['L0', 'L1'],
    tags: ['conflict', ...(d1.tags.filter(t => t !== 'verified' && t !== 'conflict-pending')), ...(d2.tags.filter(t => t !== 'verified' && t !== 'conflict-pending'))],
    source: 'dream:session',
    active: true,
    project: 'target',
  });

  return db.messages.add({
    sender: 'dream:session',
    type: 'alert',
    content: `CONFLICT DETECTED: ${typeLabel}\n\n${evidenceBreakdown}\n\nConcern: ${conflict.concern}\n\nOptions:\n(a) Choose D${d1.id}\n(b) Choose D${d2.id}\n(c) Both are right \u2014 describe the merged rule\n\nSuggested: (c) ${conflict.suggestion}${recommendation}`,
    category: 'SIGNAL',
    status: 'unread',
    timestamp: Date.now(),
    proposedTask: {
      title: `[decision] Resolve: ${conflict.concern}`,
      description: `D${d1.id}: ${conflict.d1_choice}\nD${d2.id}: ${conflict.d2_choice}\n\nSuggested resolution: ${conflict.suggestion}`,
    },
  });
}

/**
 * Register a one-shot user:reply handler for conflict resolution.
 * On user response:
 *   (a) → deactivate d2, mark d1 conflict-resolved
 *   (b) → deactivate d1, mark d2 conflict-resolved
 *   (c) → merge: deactivate both, create new merged decision entry
 * Any response marks the message as read and writes a resolution audit entry.
 */
function registerConflictResolutionHandler(
  msgId: number,
  d1Id: number,
  d2Id: number,
  suggestion: string,
  conflictType: ConflictType,
) {
  const handler = async (data: { taskId: string; content: string; messageId?: number }) => {
    if (data.messageId !== msgId) return;
    eventBus.off('user:reply', handler);

    const content = data.content.trim().toLowerCase();
    const d1 = await db.kbLog.get(d1Id);
    const d2 = await db.kbLog.get(d2Id);
    if (!d1 || !d2) return;

    // Union of both decisions' layers — resolutions must cascade to all levels involved
    const cascadeLayers = [...new Set([...d1.layer, ...d2.layer])];

    if (content.startsWith('(a)') || content.startsWith('a)') || /^(a|choose d1|first)/.test(content)) {
      // Choose D1: deactivate D2, resolve D1 with cascading layers
      await db.kbLog.update(d2Id, { active: false });
      await db.kbLog.update(d1Id, {
        layer: cascadeLayers,
        tags: d1.tags.filter(t => t !== 'conflict-pending').concat('conflict-resolved'),
      });
      await writeResolutionEntry(conflictType, 'user:pick-a', d1, d2, d1Id);
    } else if (content.startsWith('(b)') || content.startsWith('b)') || /^(b|choose d2|second)/.test(content)) {
      // Choose D2: deactivate D1, resolve D2 with cascading layers
      await db.kbLog.update(d1Id, { active: false });
      await db.kbLog.update(d2Id, {
        layer: cascadeLayers,
        tags: d2.tags.filter(t => t !== 'conflict-pending').concat('conflict-resolved'),
      });
      await writeResolutionEntry(conflictType, 'user:pick-b', d1, d2, d2Id);
    } else {
      // Option (c) or any other response: merge both into a new decision
      const mergedText = content.replace(/^\(c\)\s*/i, '').trim() || suggestion;
      const allTags = [...new Set([
        ...d1.tags.filter(t => !['conflict-pending', 'verified'].includes(t)),
        ...d2.tags.filter(t => !['conflict-pending', 'verified'].includes(t)),
        'conflict-resolved', 'verified',
      ])];

      await db.kbLog.bulkPut([
        { ...d1, active: false },
        { ...d2, active: false },
      ]);

      await db.kbLog.add({
        timestamp: Date.now(),
        text: `MERGED: ${mergedText}`,
        category: 'decision',
        abstraction: Math.max(d1.abstraction, d2.abstraction),
        layer: cascadeLayers,
        tags: allTags,
        source: 'dream:session',
        supersedes: [d1Id, d2Id],
        active: true,
        project: d1.project || 'target',
      });
      await writeResolutionEntry(conflictType, 'user:merge', d1, d2, undefined);
    }

    await db.messages.update(msgId, { status: 'read' });
  };
  eventBus.on('user:reply', handler);
}

export async function deepDream(context: RequestContext): Promise<string> {
  const entries = await db.kbLog.filter(e => e.active).toArray();
  const docs = await db.kbDocs.filter(d => d.active).toArray();
  const tasks = await db.tasks.toArray();
  const configs = await db.projectConfigs.toArray();
  const constitution = configs[0]?.constitution || '(none)';

  // Call 1: Project consolidation
  const entryTexts = entries.slice(0, 60).map(e => `[${e.category}|a${e.abstraction}] ${e.text}`).join('\n');
  const prompt = `Full project consolidation.\n\nConstitution: ${constitution.substring(0, 500)}\nBoard: ${tasks.length} tasks\nEntries (${entries.length}): ${entryTexts}\nDocs (${docs.length}): ${docs.map(d => d.title).join(', ')}\n\nWhat do we know? What works? What doesn't? What to change? Output 3-5 strategic insights.`;

  const consolidation = await context.llmCall(prompt);

  // Append strategic insights
  await db.kbLog.add({
    timestamp: Date.now(), text: consolidation, category: 'insight',
    abstraction: 9, layer: ['L0'], tags: ['deep-dream', 'consolidation'],
    source: 'dream:deep', active: true, project: 'target'
  });

  // Call 2: Gap resolution via external sources
  const availableSources = externalSources.filter(s => s.available());
  if (availableSources.length > 0) {
    const gaps = entries.filter(e => e.tags.includes('gap'));
    for (const gap of gaps) {
      for (const source of availableSources) {
        try {
          const answer = await source.query(
            `Resolve this knowledge gap: ${gap.text}`,
            entryTexts
          );
          if (answer && !answer.startsWith('No relevant')) {
            await db.kbLog.add({
              timestamp: Date.now(),
              text: `GAP RESOLVED: ${gap.text} — ${answer}`,
              category: 'observation',
              abstraction: 4,
              layer: ['L0', 'L1'],
              tags: ['gap-resolved', ...gap.tags.filter(t => t !== 'gap')],
              source: `external:${source.constructor.name}`,
              active: true,
              project: gap.project || 'target',
            });
          }
        } catch {
          // External source failure should not block dream cycle
        }
      }
    }
  }

  // Call 3: Constitution review — propose amendments
  const amendmentPrompt = `Given these outcomes:\n${entryTexts}\n\nShould any constitution rules change? Propose amendments with rationale. If none needed, say "No amendments needed."`;
  const amendmentResponse = await context.llmCall(amendmentPrompt);

  if (!amendmentResponse.includes('No amendments needed')) {
    // Write to kb_log for self-knowledge
    await db.kbLog.add({
      timestamp: Date.now(), text: amendmentResponse, category: 'decision',
      abstraction: 8, layer: ['L0'], tags: ['constitution-amendment'],
      source: 'dream:deep', active: true, project: 'self'
    });
    // Also write as AgentMessage for user approval (proposal §5.3 Phase 4)
    const msgId = await db.messages.add({
      sender: 'dream:deep',
      type: 'proposal',
      content: amendmentResponse,
      category: 'SIGNAL',
      status: 'unread',
      timestamp: Date.now(),
      proposedTask: {
        title: '[self] Constitution amendment proposed',
        description: amendmentResponse,
      },
    });

    // Listen for user approval via user:reply event
    const handler = async (data: { taskId: string; content: string; messageId?: number }) => {
      if (data.messageId === msgId) {
        eventBus.off('user:reply', handler);
        const isApproved = /^(yes|approve|accept|ok|confirmed|approved)/i.test(data.content.trim());
        if (isApproved) {
          const config = await db.projectConfigs.toCollection().first();
          if (config) {
            await db.projectConfigs.update(config.id, {
              constitution: config.constitution + '\n' + amendmentResponse,
              updatedAt: Date.now(),
            });
          } else {
            await db.projectConfigs.add({
              id: 'default',
              constitution: amendmentResponse,
              updatedAt: Date.now(),
            });
          }
        }
        await db.messages.update(msgId, { status: 'read' });
      }
    };
    eventBus.on('user:reply', handler);
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

  // Phase 1h: Generate decision log document from full superseded graph
  const logResult = await generateDecisionLog();

  return `Deep-dream: ${consolidation.length} chars strategic insight, ${prunable.length} entries pruned. ${logResult}`;
}

/**
 * Phase 1h: Generate a decision-log document from the full superseded graph.
 * Groups active decisions by classification, traces superseded history,
 * and saves as a KB doc. Supersedes any previous decision-log doc.
 */
async function generateDecisionLog(): Promise<string> {
  // Gather all active decisions (verified)
  const decisions = await db.kbLog
    .filter(e => e.active && e.category === 'decision')
    .toArray();

  if (decisions.length === 0) return 'No decisions for log.';

  const classifications = ['architectural', 'api', 'dependency', 'pattern', 'local', 'infra', 'security'];

  // Build log content grouped by classification
  let content = `# Decision Log\n\nGenerated: ${new Date().toISOString()}\nActive decisions: ${decisions.length}\n\n`;

  for (const cls of classifications) {
    const group = decisions.filter(d => d.tags.includes(cls));
    if (group.length === 0) continue;

    content += `## ${cls.charAt(0).toUpperCase() + cls.slice(1)}\n\n`;
    for (const d of group) {
      content += `- **D${d.id}**: ${d.text}\n`;
      content += `  - Source: ${d.source} | Abstraction: ${d.abstraction} | Tags: ${d.tags.filter(t => t !== cls && t !== 'verified').join(', ') || 'none'}\n`;

      // Trace superseded history
      if (d.supersedes && d.supersedes.length > 0) {
        const ancestors = await KBHandler.traceDecisionChain(d.id);
        const history = ancestors.filter(a => a.id !== d.id);
        if (history.length > 0) {
          content += `  - Supersedes: ${history.map(a => `D${a.id} (${a.text.substring(0, 60)}${a.text.length > 60 ? '...' : ''})`).join(' → ')}\n`;
        }
      }
      content += '\n';
    }
  }

  // Also include unclassified decisions
  const unclassified = decisions.filter(d => !classifications.some(c => d.tags.includes(c)));
  if (unclassified.length > 0) {
    content += `## Uncategorized\n\n`;
    for (const d of unclassified) {
      content += `- **D${d.id}**: ${d.text}\n  Source: ${d.source}\n\n`;
    }
  }

  // Save as KB doc (upsert — replaces previous decision-log)
  const today = new Date().toISOString().split('T')[0];
  await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
    title: `Decision Log — ${today}`,
    type: 'decision-log',
    content,
    summary: `${decisions.length} active decisions across ${classifications.filter(c => decisions.some(d => d.tags.includes(c))).length} categories`,
    tags: ['decision-log', 'auto-generated'],
    layer: 'L0',
    source: 'dream:deep',
    project: 'target',
  }], {} as any);

  return `Decision log generated (${decisions.length} decisions).`;
}
