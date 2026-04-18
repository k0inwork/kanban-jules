import { Task } from '../types';

const SCOPE_KEYWORDS = ['implement', 'refactor', 'migrate', 'add', 'rewrite', 'replace', 'restructure', 'architect'];
const MIN_STEPS_FOR_BRANCH = 3;

export interface BranchEvaluation {
  qualifies: boolean;
  reason: string;
}

/**
 * BranchEvaluator — decides whether a task should get an isolated branch.
 *
 * Branch condition (any of):
 *   - Protocol has >= MIN_STEPS_FOR_BRANCH steps
 *   - Title/description contains scope keywords
 *   - Task is explicitly flagged as architectural
 *
 * Direct commit (no branch):
 *   - Typo fixes, config changes, single-file edits, test-only changes
 */
export function evaluateBranch(task: Task): BranchEvaluation {
  // Explicit flag
  if (task.agentContext?.architectural) {
    return { qualifies: true, reason: 'explicitly flagged as architectural' };
  }

  // Protocol step count
  const steps = task.protocol?.steps?.length ?? 0;
  if (steps >= MIN_STEPS_FOR_BRANCH) {
    return { qualifies: true, reason: `protocol has ${steps} steps (>= ${MIN_STEPS_FOR_BRANCH})` };
  }

  // Scope keywords in title or description
  const text = `${task.title} ${task.description}`.toLowerCase();
  const matchedKeyword = SCOPE_KEYWORDS.find(kw => text.includes(kw));
  if (matchedKeyword) {
    return { qualifies: true, reason: `matches scope keyword: "${matchedKeyword}"` };
  }

  return { qualifies: false, reason: 'simple task — direct commit' };
}
