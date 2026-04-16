# Knowledge, Dream & Reflection Systems

## Overview

The agent platform has three interconnected knowledge management systems that form a self-improving loop:

1. **knowledge-kb** — The memory store (read/write observations, patterns, documents)
2. **process-dream** — The consolidation engine (summarizes raw observations into insights)
3. **process-reflection** — The self-correction engine (detects agent-level failures and reclassifies them)

```
Execution → knowledge-kb (records raw observations)
                  ↓
          process-dream (consolidates into patterns)
                  ↓
          process-reflection (detects self-caused failures)
                  ↓
          knowledge-kb (stores corrections + self-tasks)
```

---

## knowledge-kb — The Memory Store

### What it does

CRUD operations on two IndexedDB tables:

- **kbLog** — timestamped entries (observations, errors, patterns, decisions, dreams, corrections)
- **kbDocs** — structured documents (specs, designs, API references, readmes)

### Tools

| Tool | Purpose |
|---|---|
| `knowledge-kb.recordEntry` | Add a KB log entry |
| `knowledge-kb.queryLog` | Query entries by category, source, layer, tags, active status, abstraction level |
| `knowledge-kb.updateEntries` | Bulk-update entries by ID |
| `knowledge-kb.saveDocument` | Create or upsert a document (matched by title + project) |
| `knowledge-kb.queryDocs` | Query documents by type, project, tags, layer |

### KB Entry structure

```typescript
{
  text: string,           // The observation or insight
  category: string,       // error | pattern | decision | observation | dream | correction | ...
  abstraction: number,    // 0=raw event → 5=synthesized → 9=strategic
  layer: string[],        // Which agent layers this is relevant to ['L0','L1','L2','L3']
  tags: string[],         // Freeform tags for retrieval (task-123, executor-local, constitution, gap)
  source: string,         // execution | dream:micro | dream:session | dream:deep | user
  active: boolean,        // Soft delete — deactivated entries are hidden from queries
  project: 'target'|'self' // 'target' = about the user's project, 'self' = about the agent itself
}
```

### Abstraction levels

| Level | Meaning | Example |
|---|---|---|
| 0-2 | Raw execution events | "Build failed: syntax error on line 42" |
| 3-5 | Synthesized observations | "React components frequently miss useEffect cleanup" |
| 6-7 | Patterns & decisions | "Always use try/catch around fetch calls" |
| 8-9 | Strategic insights | "Project needs migration from REST to tRPC" |

### Project duality

- **target** — Knowledge about the user's project (their codebase, their bugs, their patterns)
- **self** — Knowledge about the agent itself (its own failures, protocol issues, constitution)

This separation is critical: when the agent fails, `process-reflection` moves errors from `target` to `self`, acknowledging "this is MY problem, not the user's."

---

## process-dream — The Consolidation Engine

### What it does

Periodically summarizes raw observations into higher-abstraction insights. Named after "dreaming" in cognitive science — the brain consolidates memories during sleep.

### Three dream levels

#### 1. Micro-dream (post-task)

- **When**: After a task completes
- **Input**: Raw entries (abstraction ≤ 2) tagged with the task ID
- **Requires**: ≥ 3 entries (otherwise skips)
- **Action**: LLM summarizes into 1-2 sentences → creates an abstraction-5 entry → deactivates the raw originals
- **Example**: 4 raw "parsing failed" entries → "JSON parsing consistently fails on API responses — likely malformed responses"

#### 2. Session-dream (idle)

- **When**: When the agent is idle between tasks
- **Input**: Active execution + micro-dream entries (up to 40)
- **Action**: LLM analyzes for patterns, failures, strategies, and documentation gaps
- **Output**: Creates 4 types of entries:
  - `pattern` — Recurring behaviors
  - `error` — Failure clusters
  - `decision` — Suggested strategies
  - `observation` (tagged `gap`) — Missing documentation
- **Example**: Notices "executor-local fails 3x on test tasks" → creates a pattern entry

#### 3. Deep-dream (daily)

- **When**: Once per day (or on demand)
- **Input**: All active entries + all docs + task board state + constitution
- **Action**: 3-phase process:
  1. **Strategic consolidation** — LLM produces 3-5 strategic insights (abstraction 9)
  2. **Constitution review** — LLM proposes amendments if rules are causing failures
  3. **Pruning** — Deactivates raw execution entries older than 7 days (preserves high-abstraction)
- **Example**: "The project needs better error handling across all API routes. Constitution rule 'never use try/catch' should be amended."

---

## process-reflection — The Self-Correction Engine

### What it does

Detects when errors are the agent's fault (not the user's project) and reclassifies them from `project: 'target'` → `project: 'self'`.

### The 5 reflection rules

#### Rule 1: SAME-ERROR DIFFERENT-TASK

- **Trigger**: Same error text (normalized first 60 chars) appears ≥3 times across ≥2 different tasks
- **Logic**: If the same error happens on different tasks, it's not task-specific — it's an agent-level issue
- **Action**: Reclassify to `self`, create a self-task to fix it
- **Example**: "Failed to parse JSON" on task-1, task-4, task-7 → agent has a parsing bug

#### Rule 2: CONSTITUTION-VIOLATION

- **Trigger**: ≥2 errors tagged `constitution` on `target` project
- **Logic**: Constitution rules are causing failures — the rules themselves may be wrong
- **Action**: Reclassify to `self`, create a self-task to review constitution
- **Example**: Agent follows "never use async/await" rule but keeps failing → rule needs amendment

#### Rule 3: RECURRING-PROTOCOL-FAILURE

- **Trigger**: Same executor (e.g., `executor-local`) has ≥3 errors
- **Logic**: If one executor consistently fails, the protocol generation (step planning) is broken for it
- **Action**: Reclassify to `self`, create a self-task to fix protocol generation
- **Example**: `executor-local` fails 5 times → step plans are generating bad code

#### Rule 4: USER-CORRECTION

- **Trigger**: A user correction entry overlaps (shares tags) with error entries
- **Logic**: User overrode the agent's decision on a task that also had errors — agent made wrong choices
- **Action**: Reclassify to `self` (no self-task — user already corrected it)
- **Example**: User says "don't delete node_modules" on a task where build cleanup failed

#### Rule 5: KNOWN-GAP

- **Trigger**: An error shares tags with a `gap`-tagged observation
- **Logic**: This error was already flagged as a known knowledge gap — not the agent's fault
- **Action**: Tag as `gap-confirmed` — do NOT reclassify (it's a known limitation, not a bug)
- **Example**: Error about "missing config docs" matches existing gap "no API documentation"

### The reclassify flow

```
1. Gather: Load active error entries (category=error, project=target, source=execution)
2. Cross-reference: Load all active entries for rule matching
3. Apply rules: Run all 5 rules against the error set
4. Reclassify: Change project from 'target' → 'self' for matched entries
5. Log: Append a 'correction' entry documenting what was reclassified and why
6. Self-task: Create a TODO task (project=self) if the rule requests it
```

---

## How They Work Together

```
Day 1:
  Executor runs → records raw error entries (abstraction 1-2, project=target)
  ↓
  Micro-dream → summarizes per-task errors (abstraction 5)
  ↓
  Session-dream → notices patterns across tasks (abstraction 7)

Day 2:
  Reflection → detects "same error across 3 tasks" → reclassifies to self
  ↓
  Self-task created → "[self] Fix recurring JSON parsing error"
  ↓
  Deep-dream → strategic insight: "executor-local has systematic parsing issues"
  ↓
  Constitution review → proposes amendment to error handling rules

Day 3:
  Agent picks up self-task → fixes its own parsing bug
  ↓
  Future executions no longer produce that error
```

This creates a **self-healing loop**: the agent observes its own failures, consolidates them into patterns, recognizes when it's at fault, creates tasks to fix itself, and learns from the fixes.

---

## Test Coverage

42 tests in `src/__tests__/modules.test.ts`:

| Suite | Tests | Coverage |
|---|---|---|
| `applyRules` | 10 | All 5 rules (positive + negative cases), multi-rule firing, threshold boundaries |
| `ReflectionHandler` | 7 | Reclassify end-to-end: no-match, inactive, project change, reflection logging, self-task creation, entry filtering |
| `DreamHandler` | 8 | micro (consolidation + skip), session (pattern extraction + early return + malformed JSON), deep (pruning + amendments positive/negative) |
| `KBHandler` | 14 | recordEntry, queryLog (7 filter types + sort), updateEntries, saveDocument (create + upsert + project isolation), queryDocs |
