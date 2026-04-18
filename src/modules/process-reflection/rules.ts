import { KBEntry } from '../../services/db';

export interface RuleResult {
  match: boolean;
  entryIds: number[];
  ruleName: string;
  diagnosis: string;
  createSelfTask: boolean;
  taskTitle?: string;
  taskDescription?: string;
}

export function applyRules(
  errors: KBEntry[],
  allEntries: KBEntry[],
  threshold: number = 3
): RuleResult[] {
  const results: RuleResult[] = [];

  // Rule 1: SAME-ERROR DIFFERENT-TASK
  // ≥threshold errors with similar text across ≥2 different tasks
  const byNormalizedText = new Map<string, KBEntry[]>();
  for (const e of errors) {
    // Simple normalization: first 60 chars, lowercase, trim
    const key = e.text.toLowerCase().substring(0, 60).replace(/\s+/g, ' ').trim();
    const group = byNormalizedText.get(key) || [];
    group.push(e);
    byNormalizedText.set(key, group);
  }

  for (const [key, group] of byNormalizedText) {
    const taskIds = new Set(group.flatMap(e => e.tags.filter(t => t.startsWith('task-'))));
    if (group.length >= threshold && taskIds.size >= 2) {
      results.push({
        match: true,
        entryIds: group.map(e => e.id!),
        ruleName: 'SAME-ERROR DIFFERENT-TASK',
        diagnosis: `"${key}..." occurred ${group.length} times across ${taskIds.size} tasks`,
        createSelfTask: true,
        taskTitle: `[self] Fix recurring error: ${key.substring(0, 40)}...`,
        taskDescription: `Error "${key}..." recurred ${group.length} times across ${taskIds.size} tasks. This indicates an agent-level issue, not a task-specific one.`
      });
    }
  }

  // Rule 2: CONSTITUTION-VIOLATION
  // Errors that occurred while following a constitution rule
  const constitutionErrors = errors.filter(e =>
    e.tags.some(t => t === 'constitution') && e.project === 'target'
  );
  if (constitutionErrors.length >= 2) {
    results.push({
      match: true,
      entryIds: constitutionErrors.map(e => e.id!),
      ruleName: 'CONSTITUTION-VIOLATION',
      diagnosis: `${constitutionErrors.length} failures linked to constitution rules`,
      createSelfTask: true,
      taskTitle: `[self] Review constitution rules causing failures`,
      taskDescription: `${constitutionErrors.length} errors occurred while following constitution rules. Rules may need amendment.`
    });
  }

  // Rule 3: RECURRING-PROTOCOL-FAILURE
  // Same executor fails at same step type ≥threshold times
  const byExecutor = new Map<string, KBEntry[]>();
  for (const e of errors) {
    const executorTag = e.tags.find(t => t.startsWith('executor-'));
    if (executorTag) {
      const group = byExecutor.get(executorTag) || [];
      group.push(e);
      byExecutor.set(executorTag, group);
    }
  }

  for (const [executor, group] of byExecutor) {
    if (group.length >= threshold) {
      results.push({
        match: true,
        entryIds: group.map(e => e.id!),
        ruleName: 'RECURRING-PROTOCOL-FAILURE',
        diagnosis: `${executor} failed ${group.length} times — protocol generation may be broken`,
        createSelfTask: true,
        taskTitle: `[self] Fix protocol generation for ${executor}`,
        taskDescription: `${executor} has ${group.length} failures. Protocol generation may produce failing patterns for this executor.`
      });
    }
  }

  // Rule 4: USER-CORRECTION
  // Errors on tasks where user overrode a decision
  const userCorrections = allEntries.filter(e =>
    e.category === 'correction' && e.source === 'user'
  );
  for (const correction of userCorrections) {
    const relatedErrors = errors.filter(e =>
      e.tags.some(t => correction.tags.includes(t))
    );
    if (relatedErrors.length > 0) {
      results.push({
        match: true,
        entryIds: relatedErrors.map(e => e.id!),
        ruleName: 'USER-CORRECTION',
        diagnosis: `User corrected decision on task with ${relatedErrors.length} errors`,
        createSelfTask: false
      });
    }
  }

  // Rule 5: KNOWN-GAP
  // Error matches a flagged knowledge gap — don't reclassify, tag as gap-confirmed
  const gapFlags = allEntries.filter(e =>
    e.tags.includes('gap') && e.category === 'observation'
  );
  for (const error of errors) {
    const matchesGap = gapFlags.some(g =>
      g.tags.some(gt => error.tags.includes(gt) && gt !== 'gap')
    );
    if (matchesGap) {
      results.push({
        match: true,
        entryIds: [error.id!],
        ruleName: 'KNOWN-GAP',
        diagnosis: `Error matches known knowledge gap — not reclassified`,
        createSelfTask: false
      });
    }
  }

  return results;
}
