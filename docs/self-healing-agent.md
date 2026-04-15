# Self-Healing Agent: Yuan's N+1 Project Model

> Yuan always manages N+1 projects. Project 0 is itself. Self-healing is not a special mechanism — it's just Yuan creating tasks on its own project. Everything is module-based.

---

## 1. Core Model: Yuan Has Two Projects

```
┌─────────────────────────────────────────────┐
│                   YUAN                       │
│                                              │
│   Project 0 (self):   Fleet Agent itself     │
│   Project 1 (target): User's project         │
│   Project N:          More if configured      │
│                                              │
└─────────────────────────────────────────────┘
```

The agent is not special-casing itself. It is just another project it manages. Every mechanism — tasks, KB, dream, projections — works identically for all projects. The only difference is which project a piece of data belongs to.

### 1.1 What "Project 0" Means

| Aspect | Project 1 (target) | Project 0 (self) |
|--------|--------------------|--------------------|
| **Files** | User's repo | Agent's own source (`src/core/*`, `src/services/*`, `CONSTITUTION.md`) |
| **Errors** | Task failures, build breaks, test failures | Bad constitution rules, buggy orchestrator logic, wrong executor routing |
| **Knowledge** | Architecture, patterns, domain knowledge | Which rules work, which prompts fail, executor profiles |
| **Constitution** | User-defined project rules | Agent's own operating rules |
| **Tasks** | Features, fixes, refactors | Fix constitution, fix agent code, adjust config |

### 1.2 Schema Addition

One field on existing structures. No new tables.

```
kb_log:
  ... existing fields ...
  project: string   // 'self' | 'target' | project-id (default: 'target')

tasks:
  ... existing fields ...
  project: string   // 'self' | 'target' | project-id (default: 'target')
```

Default is always `'target'`. Everything assumes the error is the task's fault unless proven otherwise.

---

## 2. Module Architecture

### 2.1 Four New Modules

The self-healing + KB system decomposes into four modules following the existing Fleet module categories:

```
src/modules/
  ├── knowledge-kb/          # NEW — KB storage layer (kb_log + kb_docs)
  ├── knowledge-projector/   # NEW — Context propagation engine
  ├── process-dream/         # NEW — Dream engine + external KB stubs
  └── process-reflection/    # NEW — Reflectionist rules + self-task creation
```

### 2.2 Module Interaction Map

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌──────────────┐    writes     ┌──────────────────┐       │
│   │  orchestrator │─────────────►│ knowledge-kb     │       │
│   │  (existing)   │  records     │ (kb_log, kb_docs)│       │
│   └──────┬───────┘    errors     └────────┬─────────┘       │
│          │                                │                  │
│          │ calls project()                │ reads entries    │
│          ▼                                ▼                  │
│   ┌──────────────────┐          ┌──────────────────┐        │
│   │ knowledge-       │◄─────────│ process-dream    │        │
│   │ projector        │ reads KB │ (micro/session/  │        │
│   │ (layer context)  │          │  deep + external) │        │
│   └──────────────────┘          └────────┬─────────┘        │
│          │                               │                   │
│          │ feeds context                 │ reclassifies      │
│          ▼                               ▼                   │
│   ┌──────────────┐             ┌──────────────────┐         │
│   │ architect-   │             │ process-         │         │
│   │ codegen      │             │ reflection       │         │
│   │ (existing)   │             │ (rules + self-   │         │
│   └──────────────┘             │  task creation)  │         │
│                                └──────────────────┘         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 Data Flow Between Modules

```
Flow 1:  Orchestrator ──recordExecution()──► knowledge-kb
Flow 2:  Orchestrator ──project('L2')──────► knowledge-projector ──reads──► knowledge-kb
Flow 3:  Yuan ──project('L0')─────────────► knowledge-projector ──reads──► knowledge-kb
Flow 4:  Orchestrator ──task done──────────► process-dream ──microDream()
Flow 5:  Host ──board idle─────────────────► process-dream ──sessionDream()
Flow 6:  process-dream ──sessionDream()───► process-reflection ──reclassify()
Flow 7:  process-reflection ──self-task───► Board (createTask project='self')
Flow 8:  process-dream ──deepDream()──────► External KB stubs ──► knowledge-kb
```

---

## 3. Module: knowledge-kb

**Category**: Knowledge
**Role**: Central storage for all KB data. Own KB (tagged log) + Formal KB (documents).

### 3.1 Manifest

```json
{
  "id": "knowledge-kb",
  "name": "Knowledge Base",
  "version": "1.0.0",
  "type": "knowledge",
  "description": "Tagged append-only log (Own KB) and document store (Formal KB). Single source of truth for all learned and formal knowledge.",
  "tools": [
    {
      "name": "knowledge-kb.recordEntry",
      "description": "Append an entry to kb_log. Signature: KB.recordEntry({ text, category, abstraction, layer, tags, source, project? })",
      "parameters": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "category": { "type": "string" },
          "abstraction": { "type": "number" },
          "layer": { "type": "array", "items": { "type": "string" } },
          "tags": { "type": "array", "items": { "type": "string" } },
          "source": { "type": "string" },
          "project": { "type": "string", "default": "target" }
        }
      }
    },
    {
      "name": "knowledge-kb.queryLog",
      "description": "Query kb_log with filters. Signature: KB.queryLog({ project?, category?, layer?, tags?, source?, active?, limit? })",
      "parameters": {
        "type": "object",
        "properties": {
          "project": { "type": "string" },
          "category": { "type": "string" },
          "layer": { "type": "string" },
          "tags": { "type": "array", "items": { "type": "string" } },
          "source": { "type": "string" },
          "active": { "type": "boolean" },
          "limit": { "type": "number" }
        }
      }
    },
    {
      "name": "knowledge-kb.updateEntries",
      "description": "Bulk update kb_log entries. Used by dream for deactivation and by reflection for reclassification. Signature: KB.updateEntries({ ids, changes })",
      "parameters": {
        "type": "object",
        "properties": {
          "ids": { "type": "array", "items": { "type": "number" } },
          "changes": { "type": "object" }
        }
      }
    },
    {
      "name": "knowledge-kb.saveDocument",
      "description": "Save or update a document in kb_docs. Signature: KB.saveDocument({ title, type, content, summary, tags, layer, source, project? })",
      "parameters": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "type": { "type": "string" },
          "content": { "type": "string" },
          "summary": { "type": "string" },
          "tags": { "type": "array", "items": { "type": "string" } },
          "layer": { "type": "array", "items": { "type": "string" } },
          "source": { "type": "string" },
          "project": { "type": "string", "default": "target" }
        }
      }
    },
    {
      "name": "knowledge-kb.queryDocs",
      "description": "Query kb_docs with filters. Signature: KB.queryDocs({ project?, type?, tags?, layer?, active?, limit? })",
      "parameters": {
        "type": "object",
        "properties": {
          "project": { "type": "string" },
          "type": { "type": "string" },
          "tags": { "type": "array", "items": { "type": "string" } },
          "layer": { "type": "string" },
          "active": { "type": "boolean" },
          "limit": { "type": "number" }
        }
      }
    }
  ],
  "sandboxBindings": {
    "KB.record": "knowledge-kb.recordEntry",
    "KB.queryLog": "knowledge-kb.queryLog",
    "KB.saveDoc": "knowledge-kb.saveDocument",
    "KB.queryDocs": "knowledge-kb.queryDocs"
  },
  "permissions": ["storage"],
  "configFields": []
}
```

### 3.2 Handler

```
src/modules/knowledge-kb/
  manifest.json
  Handler.ts        (~60 LOC)

Handler methods:
  recordEntry(params)   → append to kb_log, return id
  queryLog(params)      → filter kb_log, return entries[]
  updateEntries(params) → bulk update (for dream deactivation, reflection reclassification)
  saveDocument(params)  → upsert kb_docs, return id
  queryDocs(params)     → filter kb_docs, return docs[]
```

### 3.3 Convenience Writers (used by orchestrator)

The handler exposes high-level recording helpers called by the orchestrator and Yuan. These are internal to the handler — not separate tools:

```typescript
// Internal helpers in Handler.ts (called via moduleRequest, not sandbox)

recordExecution(taskId, executor, success, details)  // after each step
recordObservation(text, category, tags, layer)        // by Yuan
recordDecision(text, rationale, tags)                 // by Yuan/Planner
recordError(taskId, executor, error, context)         // on failure
scanRepoForDocs()                                     // on project init
```

---

## 4. Module: knowledge-projector

**Category**: Knowledge
**Role**: Assembles the right context for each layer. Reads from knowledge-kb and produces token-budgeted projection strings.

### 4.1 Manifest

```json
{
  "id": "knowledge-projector",
  "name": "Context Projector",
  "version": "1.0.0",
  "type": "knowledge",
  "description": "Assembles layer-specific context projections from KB data. Distills upward for Yuan (L0), narrows downward for executors (L2). Token-budgeted.",
  "tools": [
    {
      "name": "knowledge-projector.project",
      "description": "Generate a context projection for a given layer and project. Signature: Projector.project({ layer, project?, taskId?, executor?, tags? })",
      "parameters": {
        "type": "object",
        "properties": {
          "layer": { "type": "string", "enum": ["L0", "L1", "L2"] },
          "project": { "type": "string", "default": "target" },
          "taskId": { "type": "string" },
          "executor": { "type": "string" },
          "tags": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["layer"]
      }
    }
  ],
  "sandboxBindings": {},
  "permissions": [],
  "configFields": []
}
```

### 4.2 Handler

```
src/modules/knowledge-projector/
  manifest.json
  Handler.ts        (~80 LOC)

Handler methods:
  project(params)  → main entry point

Internal logic:
  projectLog(layer, opts, budget)      → query kb_log, sort, truncate
  projectDocs(layer, opts, budget)     → query kb_docs, match tags, truncate
  projectConstitution(layer)           → load from projectConfigs
  computeBoardState()                  → count tasks by status (L0/L1 only)
  getAgentContext(taskId)              → load accumulated step state (L2 only)
```

### 4.3 Projection Logic

```
project('L0', { project: 'all' })  — Yuan sees both projects:
  kb_log:   WHERE active=true AND layer includes 'L0'
            ORDER BY abstraction DESC, timestamp DESC
            BUDGET: 1200 tokens (60% of 2000)
  kb_docs:  WHERE layer includes 'L0'
            AND type IN ('constitution', 'design', 'report')
            BUDGET: 600 tokens
  board:    computed from tasks table
  output:   strategic summaries, patterns, executor profiles

project('L1')  — Process Planner sees tactical context:
  kb_log:   WHERE active=true AND layer includes 'L1'
            AND (tags overlap with stage OR category='pattern')
            BUDGET: 900 tokens
  kb_docs:  WHERE layer includes 'L1'
            AND type IN ('spec', 'design', 'constitution')
            BUDGET: 450 tokens
  output:   stage status, gaps, executor routing, specs

project('L2', { taskId, executor })  — Architect sees operational context:
  kb_log:   WHERE active=true AND layer includes 'L2'
            AND (tags includes executor OR tags includes taskId)
            AND abstraction <= 5
            BUDGET: 600 tokens
  kb_docs:  WHERE layer includes 'L2'
            AND tags overlap with task tags
            BUDGET: 300 tokens
  output:   module knowledge, relevant files, error context, AgentContext
```

### 4.4 Budget Mechanism: Phase 0 Tokenizer

Phase 0 does NOT use a real tokenizer. The abstraction level IS the priority queue, and char-count is the cutoff.

**Why it works**: Entries are short (1-3 sentences). Abstraction level is a perfect proxy for importance. If the budget is off by 10%, nothing breaks — the LLM prompt has its own margin.

```typescript
// In knowledge-projector Handler.ts — the entire Phase 0 tokenizer

async projectLog(layer, opts, charBudget) {
  const entries = await db.kb_log
    .where('layer').equals(layer)
    .filter(e => e.active && e.project === (opts.project || 'target'))
    .reverse()                          // highest abstraction first
    .sortBy('abstraction');

  const lines: string[] = [];
  let chars = 0;

  for (const entry of entries) {        // abstraction DESC — most important first
    const line = `[${entry.category}] ${entry.text}`;
    if (chars + line.length > charBudget) break;  // simple cutoff
    lines.push(line);
    chars += line.length;
  }

  return lines.join('\n');
}
```

~15 LOC. Zero dependencies. The sorted-by-abstraction log makes this trivial:

| Abstraction | Content | Survives cut? |
|---|---|---|
| 9-10 | Strategic insights, constitution | Always — sorted first |
| 7 | Session-dream patterns | Almost always |
| 5 | Micro-dream summaries | Usually |
| 2-3 | Executor outcomes, observations | Sometimes |
| 0-1 | Raw errors, step results | First to drop |

**Budgets are char-counts, not tokens** (multiply by ~0.25 for rough token equivalent):

| Layer | kb_log budget | kb_docs budget | Total chars |
|---|---|---|---|
| L0 | 4800 | 2400 | ~7200 chars (~1800 tokens) |
| L1 | 3600 | 1800 | ~5400 chars (~1350 tokens) |
| L2 | 2400 | 1200 | ~3600 chars (~900 tokens) |

**Migration path**:

| Phase | Budget mechanism | LOC |
|---|---|---|
| **Phase 0** | Sort by abstraction, cut by char count | ~15 |
| **Phase 1** | Approximate token count (~4 chars/token), tag relevance scoring | ~30 |
| **Phase 2** | Graph traversal with weighted edges, real token counting | New module |

### 4.5 No Sandbox Bindings

The projector is called by the orchestrator, Yuan, and process-planner — not by executor code in the sandbox. It produces strings that get injected into LLM prompts upstream.

---

## 5. Module: process-dream

**Category**: Process
**Role**: Dream engine. Three consolidation levels. Background triggers. External KB stubs.

### 5.1 Manifest

```json
{
  "id": "process-dream",
  "name": "Dream Engine",
  "version": "1.0.0",
  "type": "process",
  "description": "Consolidates raw KB entries into higher-abstraction insights. Three levels: micro (post-task), session (idle), deep (daily). Manages external KB stubs.",
  "tools": [
    {
      "name": "process-dream.microDream",
      "description": "Run micro-dream consolidation for a completed task. Signature: Dream.microDream({ taskId })",
      "parameters": {
        "type": "object",
        "properties": {
          "taskId": { "type": "string" }
        },
        "required": ["taskId"]
      }
    },
    {
      "name": "process-dream.sessionDream",
      "description": "Run session-dream consolidation. Gathers all active entries, finds patterns, calls reflection for reclassification, consolidates. Signature: Dream.sessionDream({})",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "process-dream.deepDream",
      "description": "Run deep-dream full consolidation. Reviews everything, resolves gaps via external KB, proposes constitution amendments, prunes. Signature: Dream.deepDream({})",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  ],
  "sandboxBindings": {},
  "permissions": ["network"],
  "configFields": [
    {
      "key": "dreamEnabled",
      "type": "boolean",
      "label": "Enable Dream Engine",
      "default": true
    },
    {
      "key": "sessionIdleMinutes",
      "type": "number",
      "label": "Minutes of idle before session-dream",
      "default": 5
    },
    {
      "key": "deepDreamSchedule",
      "type": "string",
      "label": "Deep dream schedule (cron or 'off')",
      "default": "off"
    },
    {
      "key": "externalKbNotebooklm",
      "type": "boolean",
      "label": "NotebookLM integration enabled",
      "default": false
    },
    {
      "key": "externalKbWebSearch",
      "type": "boolean",
      "label": "Web search integration enabled",
      "default": false
    },
    {
      "key": "gapThreshold",
      "type": "number",
      "label": "Failures before triggering external fetch",
      "default": 3
    }
  ]
}
```

### 5.2 Handler

```
src/modules/process-dream/
  manifest.json
  Handler.ts          (~70 LOC — orchestration)
  dream-levels.ts     (~80 LOC — micro/session/deep logic)
  external-kb.ts      (~30 LOC — stub implementations)
```

### 5.3 Dream Levels

#### microDream(taskId)

```
Trigger: Orchestrator calls after task reaches DONE or FATAL_ERROR

1. Gather: kb_log WHERE tags includes taskId AND abstraction <= 2 AND active=true
2. If count < 3: record executor outcome only, skip consolidation
3. LLM call: "Summarize these N observations into 1-2 sentences"
4. Append consolidated entry (abstraction=5, layer=['L0','L1'], source='dream:micro')
5. Mark raw entries: active=false
6. Record executor outcome entry for session-dream aggregation
```

#### sessionDream()

```
Trigger: Host calls when board idle > config.sessionIdleMinutes

Phase 1: Gather
  - kb_log WHERE active=true AND source IN ('execution','dream:micro')
  - kb_docs WHERE active=true
  - Board state

Phase 2: Pattern recognition
  - Group log entries by executor, category, tags intersection
  - LLM call: extract patterns, failures, strategies, doc gaps

Phase 3: Reflection — delegate to process-reflection
  - Call process-reflection.reclassify({ entries: errorEntries })
  - Receives reclassification results
  - Updates kb_log entries via knowledge-kb.updateEntries

Phase 4: Consolidate
  - For each pattern/failure/strategy: append entry (abstraction=7, source='dream:session')
  - Mark superseded entries active=false
  - Flag document gaps for external enrichment

Phase 5: External enrichment (if configured)
  - For each gap above threshold: call external-kb stub
  - Write findings to kb_log + kb_docs
```

#### deepDream()

```
Trigger: Scheduled (config.deepDreamSchedule) or manual button

Phase 1: Gather everything
  - All active kb_log + kb_docs + board state + constitution + gap flags

Phase 2: LLM consolidation call
  - "Full project consolidation. What do we know? What's missing?"
  - Append strategic insights (abstraction=9, source='dream:deep')

Phase 3: Gap resolution
  - For each gap: should we query external? What query?
  - Trigger external fetches, write results to kb_log + kb_docs

Phase 4: Constitution review
  - "Should any rules change? Propose amendments with rationale."
  - Write proposals to kb_log (category='proposal', project='self')

Phase 5: Pruning
  - Mark raw entries older than 7 days active=false
  - Keep: errors with recurrence > 1, all dream entries, all constitution
```

### 5.4 External KB Stubs

```
// src/modules/process-dream/external-kb.ts

interface ExternalKBSource {
  query(prompt: string, context: string): Promise<string>;
  available(): boolean;
}

class NotebookLMSource implements ExternalKBSource {
  async query() { throw new Error('NotebookLM not configured'); }
  available() { return false; }
}

class WebSearchSource implements ExternalKBSource {
  async query() { throw new Error('Web search not configured'); }
  available() { return false; }
}
```

### 5.5 Background Triggers

The dream module registers background triggers with the host (like `executor-jules` manages sessions):

| Trigger | When | Action |
|---------|------|--------|
| `onTaskComplete` | Task → DONE or FATAL_ERROR | `microDream(taskId)` |
| `onBoardIdle` | No EXECUTING tasks for N minutes | `sessionDream()` |
| `onSchedule` | Cron or manual | `deepDream()` |

---

## 6. Module: process-reflection

**Category**: Process
**Role**: Reflectionist rules. Reclassifies target errors as self-errors. Creates self-tasks.

### 6.1 Manifest

```json
{
  "id": "process-reflection",
  "name": "Reflection Engine",
  "version": "1.0.0",
  "type": "process",
  "description": "Applies reflection rules to batch-error analysis. Reclassifies target errors as self-errors when the agent itself is the common factor. Creates self-tasks for approved self-healing.",
  "tools": [
    {
      "name": "process-reflection.reclassify",
      "description": "Analyze a set of error entries and apply reflection rules. Returns reclassification results. Signature: Reflection.reclassify({ entryIds? })",
      "parameters": {
        "type": "object",
        "properties": {
          "entryIds": {
            "type": "array",
            "items": { "type": "number" },
            "description": "Specific entries to analyze. If omitted, analyzes all active target errors."
          }
        }
      }
    }
  ],
  "sandboxBindings": {},
  "permissions": [],
  "configFields": [
    {
      "key": "reclassifyThreshold",
      "type": "number",
      "label": "Error count threshold for reclassification",
      "default": 3
    },
    {
      "key": "reflectionEnabled",
      "type": "boolean",
      "label": "Enable reflectionist reclassification",
      "default": true
    }
  ]
}
```

### 6.2 Handler

```
src/modules/process-reflection/
  manifest.json
  Handler.ts        (~30 LOC — entry point)
  rules.ts          (~40 LOC — five reflection rules)
```

### 6.3 The Five Reflection Rules

```typescript
// src/modules/process-reflection/rules.ts

interface RuleResult {
  match: boolean;
  entryIds: number[];
  ruleName: string;
  diagnosis: string;
  createSelfTask: boolean;
  taskTitle?: string;
  taskDescription?: string;
}

function applyRules(
  errors: KBEntry[],
  allEntries: KBEntry[],
  threshold: number
): RuleResult[] {

  // Rule 1: SAME-ERROR DIFFERENT-TASK
  // ≥threshold errors with same root cause across ≥2 different tasks
  // → reclassify to project='self'
  // Why: if the task varies but the error doesn't, the agent is the common factor

  // Rule 2: CONSTITUTION-VIOLATION
  // error occurred while following a constitution rule AND ≥2 failures linked
  // → reclassify to project='self'
  // Why: following my own rule caused failure — the rule is wrong

  // Rule 3: RECURRING-PROTOCOL-FAILURE
  // same executor fails at same step type ≥threshold times
  // → reclassify to project='self'
  // Why: my protocol generation produces failing patterns

  // Rule 4: USER-CORRECTION
  // user overrode a decision on a task that also has errors
  // → reclassify the original error to project='self'
  // Why: user knows better → my decision was wrong

  // Rule 5: KNOWN-GAP
  // error matches a flagged knowledge gap
  // → DON'T reclassify, tag as 'gap-confirmed'
  // Why: this is a knowledge problem, not a self problem
}
```

### 6.4 Reclassification Flow

```
process-dream.sessionDream() Phase 3:
  │
  ▼
1. Gather: all active kb_log WHERE category='error'
     AND project='target' AND source='execution'
  │
  ▼
2. Call process-reflection.reclassify({ entries })
  │
  ▼
3. For each RuleResult where match=true:
   a. Update kb_log entries: project='self' (via knowledge-kb.updateEntries)
   b. Append reflection entry:
      text: "[reflection] Reclassified N errors as self-errors.
             Rule: {ruleName}. Pattern: {description}."
      category: 'correction', project: 'self'
      abstraction: 6, layer: ['L0']
      source: 'dream:session'
   c. If createSelfTask=true:
      createTask({
        project: 'self',
        title: "[self] {diagnosis summary}",
        description: "{details, affected errors, proposed fix}",
        priority: based on error frequency and impact
      })
  │
  ▼
4. Return reclassification results to process-dream
```

### 6.5 Self-Task Lifecycle

Identical to any other task. No special code paths.

```
process-reflection creates self-task
  → Task appears on board with [self] badge
  → User can: prioritize, reorder, reject, or let it run
  → Orchestrator picks it up (same pipeline)
  → Architect generates protocol (same pipeline)
  → Steps execute (same sandbox, same tools)
  → Self-task steps can read agent's own source (via knowledge-repo-browser)
  → Step generates proposal → surfaces to user via askUser()
  → User approves or rejects
  → If approved: apply change (write file, update constitution)
  → Task moves to DONE
```

### 6.6 What Self-Tasks Can Propose

| Proposal Type | Target | Approval Required |
|---|---|---|
| **Constitution amendment** | `CONSTITUTION.md` | Yes — always |
| **Code fix** | `src/core/orchestrator.ts` etc. | Yes — always |
| **Config change** | `projectConfigs` in DB | Yes — always |
| **Knowledge addition** | `kb_log` / `kb_docs` | No — auto-applied |

### 6.7 What Self-Tasks Can Never Do

- Never modify code without user approval
- Never change constitution without user approval
- Never merge to main
- Never deploy
- Never modify user's project files (self-tasks only touch agent's own source)

---

## 7. The Self-Healing Loop

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
   Error occurs (project='target')                     │
        │                                              │
        ▼                                              │
   knowledge-kb: recorded as target error              │
        │                                              │
        ▼                                              │
   process-dream: sessionDream()                       │
        │                                              │
        ▼                                              │
   process-reflection: reclassify()                    │
   "Is this actually my fault?"                        │
        │                                              │
   ┌────┴────┐                                         │
   │         │                                         │
 My fault  Task fault                                  │
   │         │                                         │
   ▼         ▼                                         │
 Reclassify Normal dream                               │
 project=   consolidation                              │
 'self'         │                                      │
   │            │                                      │
   ▼            │                                      │
 Create      (continues in process-dream)              │
 self-task         │                                   │
   │               │                                   │
   ▼               │                                   │
 Board: user sees both target and self tasks            │
   │                                                   │
   ▼                                                   │
 Self-task executes: reads own source, generates        │
 proposal, surfaces to user                             │
   │                                                   │
   ┌────┴────┐                                         │
   │         │                                         │
Approved  Rejected                                     │
   │         │                                         │
   ▼         ▼                                         │
 Apply    Record rejection reason                      │
 change   in knowledge-kb (project='self')             │
   │         │                                         │
   ▼         ▼                                         │
 knowledge-kb:  Next session-dream sees                │
 updated        the rejection and adjusts              │
 entries        its reclassification rules             │
   │                                                   │
   └───────────────────────────────────────────────────┘
```

---

## 8. Context Propagation for Self-Project

### 8.1 Self-Project Projections

knowledge-projector filters by project. Self-tasks get self-project context:

```
project('L2', { project: 'self' }):

  kb_log WHERE project='self' AND layer includes 'L2'
    → "Orchestrator retry counter has off-by-one (3 reports)"
    → "Protocol generation fails when step count > 8"
    → "Constitution rule 'always jules for auth' causes timeouts"

  kb_docs WHERE project='self'
    → CONSTITUTION.md (current rules)
    → Agent architecture docs
```

### 8.2 Yuan's Dual Context

Yuan's L0 projection sees both projects:

```
project('L0', { project: 'all' }):

  ## Target Project
  Architecture: React 19 + TS, 11 modules
  Board: 12 tasks (3 TODO, 2 active, 6 done, 1 stuck)
  Patterns: auth work should be <500 LOC chunks

  ## Self Project
  Agent health: 2 open self-tasks, 0 critical
  Known issues: timeout threshold too low, protocol gen bug
  Constitution: 5 rules, 2 flagged for review
  Executor profiles: jules 70%, local 92%
```

Yuan reasons across both. "The target project is stuck on auth. My self-project shows I route auth tasks badly. I should fix my routing before retrying."

---

## 9. Board View

Self-tasks and target tasks coexist. User sees everything.

```
┌─ TODO ──────────────────────┐  ┌─ IN PROGRESS ──────────────┐
│                              │  │                             │
│ [target] Add 2FA login       │  │ [target] Refactor auth      │
│ [self] Fix timeout config    │  │   module                    │
│ [self] Update constitution   │  │                             │
│   for executor routing       │  │ [self] Investigate protocol │
│                              │  │   generation bug            │
└──────────────────────────────┘  └─────────────────────────────┘

┌─ DONE ──────────────────────┐
│                              │
│ [self] Fix timeout config ✓  │
│ [target] Setup CI pipeline ✓ │
│ [target] Add auth module ✓   │
│                              │
└──────────────────────────────┘
```

---

## 10. Where Self-Healing Triggers

| Level | Module | What it detects | What happens |
|-------|--------|----------------|--------------|
| **Micro-dream** | process-dream | Task-level consolidation only | Consolidates task entries |
| **Session-dream** | process-dream + process-reflection | Error patterns | Reclassifies, creates self-tasks |
| **Deep-dream** | process-dream | Reviews all reclassifications | Proposes constitution/code changes |
| **Yuan observe** | (core) | Board-level: stuck + self-issues | Prioritizes self-tasks |

---

## 11. Integration Points with Existing Modules

| Existing Module | Integration |
|----------------|-------------|
| `architect-codegen` | Receives injected context from knowledge-projector before generating protocol |
| `executor-local` | Sandbox gets `KB.record` and `KB.queryLog` bindings from knowledge-kb |
| `executor-jules` | No change — remote executor doesn't access KB directly |
| `knowledge-repo-browser` | Self-tasks use its `readFile`/`writeFile` to read agent's own source |
| `knowledge-artifacts` | No change — separate concern (step artifacts vs KB entries) |
| `channel-user-negotiator` | Self-task proposals surface via `askUser()`. Approval/rejection recorded. |
| `process-project-manager` | No change — separate concern (target project proposals) |

### Orchestrator Changes

```
src/core/orchestrator.ts — minimal changes:

1. After step completes:
   await this.moduleRequest(taskId, 'knowledge-kb.recordEntry', [{
     text: result, category: success ? 'execution' : 'error',
     abstraction: 0, layer: ['L2'], tags: [executor, ...],
     source: 'execution', project: 'target'
   }]);

2. Before calling architect:
   const context = await this.moduleRequest(taskId,
     'knowledge-projector.project',
     [{ layer: 'L2', project: task.project || 'target', taskId: task.id }]
   );
   // inject context into architect prompt

3. After task completes:
   await this.moduleRequest(taskId, 'process-dream.microDream', [{ taskId: task.id }]);
```

### Host Changes

```
src/core/host.ts — add background triggers:

1. Board idle detection:
   setInterval(() => {
     if (noActiveTasks && idleTime > config.sessionIdleMinutes) {
       this.moduleRequest(null, 'process-dream.sessionDream', [{}]);
     }
   }, 60000);

2. Deep dream schedule:
   if (config.deepDreamSchedule !== 'off') {
     // cron-based trigger for deepDream
   }
```

---

## 12. Implementation Summary

### New Modules

| Module | Category | Files | LOC |
|--------|----------|-------|-----|
| `knowledge-kb` | Knowledge | manifest.json, Handler.ts | ~60 |
| `knowledge-projector` | Knowledge | manifest.json, Handler.ts | ~80 |
| `process-dream` | Process | manifest.json, Handler.ts, dream-levels.ts, external-kb.ts | ~180 |
| `process-reflection` | Process | manifest.json, Handler.ts, rules.ts | ~70 |
| | | | **~390** |

### Modified Files

| File | Change | LOC |
|------|--------|-----|
| `src/services/db.ts` | Add kb_log, kb_docs tables + project fields | ~15 |
| `src/core/orchestrator.ts` | Hook recording + projection + micro-dream trigger | ~25 |
| `src/core/host.ts` | Board idle detection + session-dream trigger | ~15 |
| Board component | `[self]` badge for self-tasks | ~10 |
| | | **~65** |

### No New UI Needed

Self-healing proposals reuse the existing **mailbox proposal system** (`MailboxView.tsx`):
- `process-reflection` sends messages with `type: 'proposal'`, `sender: 'process-reflection'`, and `proposedTask`
- User sees proposal in mailbox, clicks to review, accepts → creates task with `project='self'`
- Same flow as `ProcessAgent` proposals today — no new UI components required

### Total Phase 0

| Component | LOC |
|-----------|-----|
| KB + Context + Dream + Self-Healing (this document) | ~480 |
| | **~480** |

---

## 13. Key Principles

1. **Innocent until proven guilty**: Errors default to `project='target'`. Reclassification requires pattern evidence.
2. **Module-based**: Each concern is a proper Fleet module with manifest, handler, tools, permissions.
3. **No special mechanisms**: Self-healing reuses tasks, KB, dream, projections. No separate pipeline.
4. **Always user-approved**: The agent proposes. The user disposes. No autonomous self-modification.
5. **Transparent**: Self-tasks appear on the board. User sees every self-improvement attempt.
6. **Evolutionary**: Every approved change makes the agent better adapted. Every rejection teaches what not to propose.
7. **Composable**: Modules are independent. process-reflection can be disabled without affecting process-dream. knowledge-kb works without knowledge-projector.
