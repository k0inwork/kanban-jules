# MVP Phase 0: Knowledge Base + Context Propagation

> Three-tier KB. Layered propagation. Dream-driven consolidation. All data flows defined.

---

## The Core Idea

The system has **three knowledge tiers** that feed a **context propagation pipeline** from Yuan (strategic) down to executors (operational), and back up through **dreaming** (consolidation).

```
┌─────────────────────────────────────────────────────────────────────┐
│                        THREE KNOWLEDGE TIERS                        │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  OWN KB      │  │  FORMAL KB   │  │ EXTERNAL KB  │             │
│  │ (learned)    │  │ (documents)  │  │ (web/NBLM)   │             │
│  │              │  │              │  │              │             │
│  │ errors       │  │ user uploads │  │ NotebookLM   │             │
│  │ patterns     │  │ design docs  │  │ web search   │             │
│  │ decisions    │  │ specs        │  │ API docs     │             │
│  │ profiles     │  │ PRDs         │  │ tutorials    │             │
│  │ constitution │  │ READMEs      │  │ references   │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                 │                  │                      │
│         └────────┬────────┴──────────┬──────┘                      │
│                  │                   │                              │
│                  ▼                   ▼                              │
│         ┌─────────────────────────────────┐                        │
│         │      PROJECT KB (unified)       │                        │
│         │   Tagged log + document store   │                        │
│         │   + dream-indexed entries       │                        │
│         └────────────┬────────────────────┘                        │
│                      │                                              │
│                      ▼                                              │
│         ┌─────────────────────────────────┐                        │
│         │    CONTEXT PROPAGATION ENGINE    │                        │
│         │   L0 ← project (distill up)     │                        │
│         │   L1 ← stage (tactical)         │                        │
│         │   L2 ← task (enrich + narrow)   │                        │
│         │   L3 ← step (inject)            │                        │
│         │   L4 ← tool (raw args)          │                        │
│         └─────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Three Knowledge Tiers

### 1.1 Own KB (System-Learned)

Knowledge the system discovers and accumulates through operation.

| Source | What Gets Recorded | Abstraction |
|--------|-------------------|-------------|
| Task execution | Step results, errors, retry patterns | 0-2 (raw) |
| Executor outcomes | Success/failure rates, timing, failure modes | 2-3 (observation) |
| Yuan observations | Board state analysis, stuck detection, gap analysis | 5-7 (strategic) |
| Micro-dream | Per-task error consolidation | 5 (synthesized) |
| Session-dream | Cross-task pattern recognition | 7 (pattern) |
| Deep-dream | Full project consolidation | 8-10 (insight) |
| Constitution | User-approved rules (seed) | 9 (canonical) |
| User corrections | Where user overrode the system | 3 (signal) |

**This is the tagged log from PKB_EXPLORATION.md Phase 0.**

### 1.2 Formal KB (Documents)

Structured documents that live alongside the project. Three sources:

| Source | Examples | Lifecycle |
|--------|----------|-----------|
| **User uploads** | PRDs, design specs, architecture diagrams, meeting notes | Explicit import, persistent |
| **System-generated** | Testing specs, analysis reports, architecture snapshots from artifacts | Auto-saved from task artifacts |
| **Auto-discovered** | README.md, CONTRIBUTING.md, API docs from repo | Scanned on project init |

These are NOT log entries. They are **documents** with:
- Title, type (spec, design, report, reference), tags
- Content (text, possibly structured)
- Source (upload, artifact, scan)
- Layer relevance (which layers should see this)

### 1.3 External KB (Enrichment)

External knowledge sources that fill gaps the system detects.

| Source | Mechanism | When Triggered |
|--------|-----------|----------------|
| **NotebookLM** | API query with context | Dream phase: gap in domain knowledge |
| **Web search** | Search + extract | Task failure due to missing docs; dream: background research |
| **API documentation** | Fetch + cache | Executor needs SDK usage patterns |
| **Tutorials/guides** | Search + summarize | New tech stack detected, no internal docs |

**Key insight: External KB does NOT run during task execution.** It runs during **dreaming** as background enrichment. If a task fails because of missing knowledge (e.g., "don't know how to configure vite plugin X"), the failure is logged. Dream picks it up, queries external sources, and writes findings into Own KB or Formal KB for future tasks.

Exception: A task step can explicitly request external context via a tool call, but this is rare and gated.

---

## 2. Data Flows

### 2.1 Flow Map (All Connections)

```
                        ┌─────────────┐
                        │   USER      │
                        │ (creates /  │
                        │  uploads /  │
                        │  corrects)  │
                        └──┬─────┬────┘
                           │     │
              task requests │     │ document uploads
                           │     │
                           ▼     ▼
┌──────────┐     ┌──────────────────────┐     ┌──────────────┐
│ EXECUTORS│◄────│   CONTEXT PROPAGATION │────►│  FORMAL KB   │
│ (L3/L4)  │     │       ENGINE          │     │  (documents) │
│          │     │                       │     │              │
│ returns  │────►│  L4→L3→L2→L1→L0      │◄────│ uploads      │
│ raw      │     │  enrich + narrow      │     │ artifacts    │
│ results  │     │  down: L0→L1→L2→L3   │     │ repo scans   │
└──────────┘     └──────────┬───────────┘     └──────────────┘
                            │
                     reads/writes KB
                            │
                            ▼
                 ┌──────────────────────┐
                 │   PROJECT KB         │
                 │ (unified store)      │
                 │                      │
                 │  kb_log (tagged)     │◄── Own KB entries
                 │  kb_docs (documents) │◄── Formal KB entries
                 └──────────┬───────────┘
                            │
                     dream reads/writes
                            │
                            ▼
                 ┌──────────────────────┐     ┌──────────────┐
                 │   DREAM ENGINE       │────►│  EXTERNAL KB │
                 │                      │     │  (enrichment)│
                 │ micro / session /    │◄────│ NotebookLM   │
                 │ deep consolidation   │     │ web search   │
                 └──────────────────────┘     └──────────────┘

  Also: Dream writes back to Project KB (higher-abstraction entries,
  document gaps flagged, external findings ingested into Own KB)
```

### 2.2 The Seven Data Flows

#### Flow 1: Task Execution → Own KB (Recording)

```
Executor runs step
  → tool call made (e.g., readFile, askJules)
  → tool result returned
  → step succeeds or fails
  → Orchestrator records outcome

Recording:
  append to kb_log:
    - text: "executor-jules timed out on auth-module refactor (attempt 2/5)"
    - category: 'error'
    - abstraction: 1
    - layer: ['L2']
    - tags: ['executor-jules', 'timeout', 'auth-module', taskId]
    - source: 'execution'
    - active: true
```

**Trigger**: Every step completion or failure.
**Writer**: Orchestrator (after each step).
**Reader**: Dream engine, context propagation engine.

#### Flow 2: Own KB → Yuan (Distillation Upward)

```
Yuan wakes (ReAct OBSERVE phase)
  → queries Project KB at L0 projection
  → KB returns highest-abstraction active entries + board state summary

Projection:
  kb_log WHERE active=true AND layer includes 'L0'
    sorted by abstraction DESC, timestamp DESC
    within token budget (2000)

  kb_docs WHERE layer includes 'L0'
    sorted by relevance (type=constitution first, then design, then report)

Output (what Yuan sees):
  "[architecture] React 19 + TS + Go/WASM, 11 modules
   [dream] executor-jules: 70% success, fails on >500 LOC tasks
   [constitution] Always test auth changes before merge
   [design] Auth flow uses JWT with refresh tokens"
```

**Trigger**: Yuan's OBSERVE phase (each ReAct cycle).
**Writer**: Dream engine (creates high-abstraction entries).
**Reader**: Yuan (L0 projection).

#### Flow 3: Yuan → Architect → Executor (Narrowing Downward)

```
Yuan decides: "Create task: implement 2FA for login"
  → creates task with description, success criteria, executor hint

Process Planner (L1) reads L1 projection:
  → "Stage: integration. Gaps: no testing spec, no 2FA design.
     Pattern: break auth work into <500 LOC chunks for Jules."

Architect (L2) reads L2 projection for this task:
  → "Relevant files: src/services/auth.ts, src/middleware/auth.ts
     Module knowledge: Jules works best with focused, <500 LOC changes
     Error context: previous attempt failed — couldn't find auth.test.ts
     Constitution: always test auth changes"

Architect generates protocol:
  Step 1: Read auth module (executor-local) — understand current structure
  Step 2: Add TOTP secret to user model (executor-jules) — focused change
  Step 3: Add 2FA verification endpoint (executor-jules) — focused change
  Step 4: Write tests (executor-jules) — focused change

Each step gets injected with:
  - Constitution rules for its executor
  - Module knowledge (tips, gotchas)
  - Error context from previous attempts
  - AgentContext from previous steps
```

**Trigger**: Task creation → orchestrator picks up → architect generates protocol.
**Writer**: Context propagation engine (assembles projections).
**Reader**: Architect (L2), Programmer (L3).

#### Flow 4: Formal KB → Context Propagation (Document Injection)

```
User uploads: "2FA Design Spec" → saved to kb_docs

When architect works on a task involving 2FA:
  kb_docs WHERE tags includes 'auth' OR '2FA'
    AND layer includes 'L2'

  Output:
  "[design] 2FA Design Spec: TOTP-based, uses QR code enrollment,
   backup codes stored hashed, 6-digit codes, 30s window"

This gets injected into architect's L2 projection alongside Own KB entries.
```

**Trigger**: Context propagation reads docs alongside log entries during projection.
**Writer**: User (uploads), system (artifacts saved as docs).
**Reader**: Context propagation engine (for L1/L2 projections).

#### Flow 5: Dream → Own KB (Consolidation)

```
Micro-dream (after each task):
  1. Gather: kb_log entries for this task (abstraction 0-2, active=true)
  2. If <3 entries: skip (not enough to consolidate)
  3. LLM call: "Summarize these N observations into 1-2 sentences"
  4. Append: new entry with abstraction=5, source='dream:micro'
  5. Deactivate: mark raw entries active=false

Session-dream (when board idle):
  1. Gather: all active entries from this session
  2. Group by: executor, task type, category
  3. LLM call: "What patterns emerge? Update executor profiles."
  4. Append: pattern entries (abstraction=7, source='dream:session')
  5. Deactivate: superseded entries

Deep-dream (scheduled or manual):
  1. Gather: full experience store + all formal docs
  2. LLM call: "Full project consolidation. What do we know?
     What's missing? What should change?"
  3. Append: strategic insights (abstraction=8-10, source='dream:deep')
  4. Propose: constitution amendments (written as proposals, user approves)
  5. Flag: document gaps (→ triggers Flow 6)
  6. Prune: old raw entries (TTL-based)
```

**Trigger**: Task complete (micro), board idle (session), scheduled (deep).
**Writer**: Dream engine (appends to kb_log).
**Reader**: Yuan, Process Planner (via projections).

#### Flow 6: Dream → External KB → Formal/Own KB (Gap-Filling)

```
Deep-dream detects: "No documentation for vite-plugin-pwa configuration.
 3 tasks failed trying to set it up. Pattern: missing external knowledge."

Dream triggers external enrichment:
  1. Query NotebookLM (if configured):
     "vite-plugin-pwa configuration guide, service worker setup,
      manifest.json options"
  2. Web search (if configured):
     "vite-plugin-pwa typescript setup tutorial 2026"

  3. Ingest results:
     - Summarized findings → append to kb_log (category='observation',
       abstraction=4, source='external:notebooklm', tags=['vite','pwa'])
     - Full reference doc → save to kb_docs (type='reference',
       source='external:web', tags=['vite','pwa','config'])

  4. Next time a task touches PWA config:
     L2 projection includes the external findings
     architect sees: "[external] vite-plugin-pwa: configure with
      VitePWA() plugin in vite.config.ts, registerType='autoUpdate'"
```

**Trigger**: Dream detects knowledge gap (recurring failures on a topic with no internal docs).
**Writer**: Dream engine (writes to kb_log and kb_docs).
**Reader**: Context propagation engine (for future projections).

#### Flow 7: External KB → Dream (Background Research)

```
On project init or periodic check:
  1. Scan tech stack from constitution/repo
  2. Identify: "This project uses React 19, Vite 6, Dexie, Sval"
  3. For each major dependency, check Formal KB:
     - Do we have local docs for this?
     - Have tasks failed related to this?
  4. If gap detected → queue background research
  5. Dream picks up queue, fetches external docs, writes to kb_docs

This is the proactive variant of Flow 6.
Instead of reacting to failures, it anticipates gaps.
```

**Trigger**: Project init (scan), periodic (weekly), or manual.
**Writer**: Dream engine (writes to kb_docs).
**Reader**: Context propagation engine.

---

## 3. Storage Schema (Phase 0)

Two Dexie tables. Nothing else.

### 3.1 kb_log (Own KB + Dream entries)

```
kb_log:
  id:            auto-increment
  timestamp:     number

  // Content
  text:          string        (1-3 sentences, human-readable)

  // Classification
  category:      string        ('architecture' | 'decision' | 'error' |
                                  'pattern' | 'executor' | 'constitution' |
                                  'observation' | 'dream' | 'correction' |
                                  'external')
  abstraction:   number        (0=raw, 5=synthesized, 10=strategic)
  layer:         string[]      (['L0'] | ['L1'] | ['L2'] | ['L0','L1'] | ...)

  // Filtering
  tags:          string[]      (['executor-jules', 'timeout', 'auth-module', ...])

  // Provenance
  source:        string        ('scan' | 'execution' | 'dream:micro' |
                                  'dream:session' | 'dream:deep' |
                                  'user' | 'external:notebooklm' |
                                  'external:web')

  // Dreaming
  supersedes:    number[]      (IDs of entries this summarizes)
  active:        boolean       (false = superseded, excluded by default)
```

### 3.2 kb_docs (Formal KB + External references)

```
kb_docs:
  id:            auto-increment
  timestamp:     number

  // Content
  title:         string        ("2FA Design Spec", "Vite PWA Config Guide")
  type:          string        ('spec' | 'design' | 'report' | 'reference' |
                                  'constitution' | 'readme' | 'meeting-notes')
  content:       string        (full text)
  summary:       string        (auto-generated 2-3 sentence summary for projections)

  // Filtering
  tags:          string[]      (['auth', '2fa', 'security'])
  layer:         string[]      (which layers should see this)

  // Provenance
  source:        string        ('upload' | 'artifact' | 'repo-scan' |
                                  'external:notebooklm' | 'external:web')

  // Lifecycle
  active:        boolean
  version:       number        (incremented on updates)
```

### 3.3 External KB (No Storage -- On-Demand)

External KB is not persisted as a separate table. Results get written into kb_log (summaries) or kb_docs (reference docs) by the dream engine. The external KB configuration is just settings:

```
projectConfigs:
  externalKb:
    notebooklm:
      enabled: boolean
      notebookId: string
    webSearch:
      enabled: boolean
    gapThreshold: number       (how many failures before triggering external fetch)
    researchSchedule: string   (cron or 'idle' or 'off')
```

---

## 4. Context Propagation Engine

### 4.1 The Projection Function

A single function that assembles the right context for each layer:

```typescript
async function project(
  layer: 'L0' | 'L1' | 'L2',
  opts?: { taskId?: string, stepId?: number, executor?: string, tags?: string[] }
): Promise<string> {
  const budget = { L0: 2000, L1: 1500, L2: 1000 }[layer];
  const sections: string[] = [];

  // 1. Log entries (Own KB)
  const logEntries = await projectLog(layer, opts, budget * 0.6);
  sections.push(logEntries);

  // 2. Documents (Formal KB)
  const docs = await projectDocs(layer, opts, budget * 0.3);
  if (docs) sections.push(docs);

  // 3. Constitution (always included, compressed)
  const constitution = await projectConstitution(layer);
  sections.push(constitution);

  // 4. Board state (computed, not stored -- L0/L1 only)
  if (layer === 'L0' || layer === 'L1') {
    const boardState = await computeBoardState();
    sections.push(boardState);
  }

  // 5. AgentContext (L2 only -- from task's accumulated state)
  if (layer === 'L2' && opts?.taskId) {
    const agentCtx = await getAgentContext(opts.taskId);
    sections.push(agentCtx);
  }

  return sections.filter(Boolean).join('\n\n');
}
```

### 4.2 Layer Projections

**L0 (Yuan -- Strategic)**

```
Sources:
  kb_log:  WHERE active=true AND layer includes 'L0'
           ORDER BY abstraction DESC, timestamp DESC
           LIMIT budget (1200 tokens)
           → shows patterns, decisions, executor profiles

  kb_docs: WHERE layer includes 'L0'
           AND type IN ('constitution', 'design', 'report')
           ORDER BY relevance
           LIMIT 600 tokens

Output:
  "## Project: kanban-jules (collective branch)
   ## Architecture: React 19 + TS + Go/WASM, 11 modules
   ## Executor Profiles:
     jules: 70% success, fails on >500 LOC (3 timeouts this week)
     local: 92% success, can't do shell ops
   ## Recent Patterns:
     - Auth work should be broken into <500 LOC chunks
     - Tests must be created before auth module tests will pass
   ## Constitution:
     - Always test auth changes before merge
     - Use executor-local for analysis, executor-jules for implementation
   ## Board: 12 tasks (3 TODO, 2 active, 6 done, 1 stuck)
   ## Design Docs:
     [2FA Design Spec] TOTP-based, QR enrollment, backup codes hashed"
```

**L1 (Process Planner -- Tactical)**

```
Sources:
  kb_log:  WHERE active=true AND layer includes 'L1'
           AND (tags overlap with stage keywords OR category='pattern')
           ORDER BY abstraction DESC
           LIMIT 900 tokens

  kb_docs: WHERE layer includes 'L1'
           AND type IN ('spec', 'design', 'constitution')
           LIMIT 450 tokens

Output:
  "## Stage: integration
   ## Required artifacts: testing spec, CI config, deployment docs
   ## Existing: design spec (done), code analysis (done)
   ## Gaps: no testing spec, no CI pipeline
   ## Executor routing: auth→jules, analysis→local, CI→github
   ## Patterns: break auth work into <500 LOC chunks
   ## Specs:
     [2FA Design Spec] TOTP-based, QR enrollment..."
```

**L2 (Task/Step -- Operational)**

```
Sources:
  kb_log:  WHERE active=true AND layer includes 'L2'
           AND (tags includes executor OR tags includes taskId)
           AND abstraction <= 5  (operational needs concrete info)
           ORDER BY abstraction ASC, timestamp DESC
           LIMIT 600 tokens

  kb_docs: WHERE layer includes 'L2'
           AND tags overlap with task tags
           LIMIT 300 tokens

Output:
  "## Module Knowledge:
     executor-jules: keep changes <500 LOC, include file paths in prompt
   ## Relevant Files:
     src/services/auth.ts (3 exports: login, logout, refresh)
     src/services/auth.test.ts (doesn't exist — must create first)
   ## Error Context:
     Previous attempt failed: 'Cannot find auth.test.ts' — create it first
   ## Wrong Paths:
     Tried to import jest directly (sandbox doesn't support it)
   ## AgentContext:
     step1.result = { moduleStructure: {...} }
   ## Docs:
     [2FA Design Spec §2] TOTP setup: generate secret, show QR, verify code"
```

---

## 5. Dream Engine

### 5.1 Three Levels

| Level | Trigger | Scope | LLM Cost | Output |
|-------|---------|-------|----------|--------|
| **Micro** | After each task completes | This task's entries | Low (1 call, ~200 tokens) | 1 consolidated entry |
| **Session** | Board idle >5 min (no EXECUTING tasks) | All active entries from session | Medium (1 call, ~1000 tokens) | 2-5 pattern entries |
| **Deep** | Scheduled (daily) or manual trigger | Full KB + docs + external | High (3-5 calls, ~3000 tokens) | Strategic insights + gap flags + constitution proposals |

### 5.2 Micro-Dream Flow

```
Task completes (DONE or FATAL_ERROR)
  │
  ▼
1. Gather: kb_log WHERE tags includes taskId AND abstraction <= 2 AND active=true
  │
  ▼
2. If count < 3: record executor outcome only, skip consolidation
  │
  ▼
3. LLM call:
   "Summarize these {N} observations into 1-2 sentences.
    Focus on: what worked, what failed, what to do differently.
    Entries: {texts joined by newline}"
  │
  ▼
4. Append to kb_log:
   text: {summary}
   category: 'dream'
   abstraction: 5
   layer: ['L0', 'L1']
   tags: {union of all raw entry tags}
   source: 'dream:micro'
   supersedes: {ids of raw entries}
   active: true
  │
  ▼
5. Mark raw entries: active=false
  │
  ▼
6. Update executor profile:
   Append entry: "[executor] {name}: {success/fail} on {task type}"
   (this feeds into session-dream for profile aggregation)
```

### 5.3 Session-Dream Flow

```
Board idle >5 min (no EXECUTING tasks, no pending user replies)
  │
  ▼
1. Gather:
   a. kb_log WHERE active=true AND source IN ('execution','dream:micro')
   b. kb_docs WHERE active=true
   c. Board state (task counts, stuck tasks, failed tasks)
  │
  ▼
2. Group log entries by:
   - executor → executor performance summary
   - category='error' → recurring failure patterns
   - tags intersection → related task clusters
  │
  ▼
3. LLM call:
   "Analyze these {N} active observations and {M} documents.
    Extract: 1) executor performance patterns 2) recurring failures
    3) successful strategies 4) document gaps.
    Output JSON: { patterns: [], failures: [], strategies: [], docGaps: [] }"
  │
  ▼
4. For each pattern/failure/strategy:
   Append to kb_log (abstraction=7, layer=['L0'], source='dream:session')
   Mark superseded entries active=false
  │
  ▼
5. For each doc gap:
   Flag for external enrichment (Flow 6):
   Write to kb_log:
     text: "GAP: {description}"
     category: 'observation'
     abstraction: 3
     layer: ['L0']
     tags: ['gap', ...relevant topics]
     source: 'dream:session'
     active: true
   │
   If external KB configured AND gap has >= threshold failures:
     → Trigger Flow 6 (external fetch)
```

### 5.4 Deep-Dream Flow

```
Triggered: scheduled (daily) or manual ("dream now" button)
  │
  ▼
1. Gather everything:
   a. All active kb_log entries
   b. All active kb_docs
   c. Full board state
   d. Constitution
   e. Pending gap flags
  │
  ▼
2. Call 1 — Project consolidation:
   "You are the Memory Consolidation Agent.
    Given the full knowledge base and all task history,
    produce a compressed project understanding.
    Identify: what we know, what works, what doesn't, what to change."
   → Output: strategic insights (abstraction=9, source='dream:deep')

3. Call 2 — Gap resolution:
   "These knowledge gaps exist: {gaps}.
    For each: should we query external sources? If yes, what query?"
   → For each approved gap: trigger Flow 6

4. Call 3 — Constitution review:
   "Given these patterns and outcomes, should any constitution rules change?
    Propose amendments with rationale."
   → Write proposals as messages (user approves/rejects)

5. Call 4 — Pruning:
   "Which raw entries older than 7 days can be pruned?
    Keep: errors with recurrence > 1, all dream entries, all constitution."
   → Mark prunable entries active=false

6. For each external gap resolved:
   - Write findings to kb_log (source='external:*')
   - Write reference docs to kb_docs (source='external:*')
```

---

## 6. External KB Integration (Phase 0: Stubs)

### 6.1 What's Built in Phase 0

In Phase 0, external KB is **configuration + interface, not full implementation**:

```
// Config in projectConfigs
externalKb: {
  notebooklm: { enabled: false, notebookId: null },
  webSearch: { enabled: false },
  gapThreshold: 3,          // failures before auto-fetch
  researchSchedule: 'off'    // 'off' for Phase 0
}

// Interface
interface ExternalKBSource {
  query(prompt: string, context: string): Promise<string>;
  available(): boolean;
}

// Stub implementations
class NotebookLMSource implements ExternalKBSource {
  async query() { throw new Error('NotebookLM not configured'); }
  available() { return false; }
}

class WebSearchSource implements ExternalKBSource {
  async query() { throw new Error('Web search not configured'); }
  available() { return false; }
}
```

### 6.2 What the Stubs Enable

- Dream engine can call `externalKB.query()` — if not configured, it's a no-op
- Gap flags accumulate in kb_log even without external sources
- When external sources are wired later, gaps are already flagged and ready
- No blocking dependency on external integrations

### 6.3 Future: Real External Sources

```
Phase 1: NotebookLM API (read existing notebooks)
Phase 2: Web search (fetch + extract + summarize)
Phase 3: User-configured APIs (Confluence, Notion, etc.)
Phase 4: Auto-research (proactive background queries)
```

---

## 7. Implementation Steps

### Step 1: Dexie Schema (kb_log + kb_docs)

**Add two tables to `db.ts`:**

```
kb_log: '++id, timestamp, category, abstraction, active, source'
kb_docs: '++id, timestamp, type, active, source'
```

Plus indexes for tag filtering (Dexie doesn't index arrays directly —
use `filter()` for tag queries, which is fine for Phase 0 scale).

**LOC: ~15**

### Step 2: KB Writer (recording)

**`src/services/KBWriter.ts`**

Functions:
- `recordExecution(taskId, executor, success, details)` — called by orchestrator after each step
- `recordObservation(text, category, tags, layer)` — called by Yuan
- `recordDecision(text, rationale, tags)` — called by Yuan/Planner
- `recordError(taskId, executor, error, context)` — called by orchestrator on failure
- `saveDocument(title, type, content, summary, tags, layer, source)` — called by upload flow, artifact save, or repo scan

Each function appends to kb_log or kb_docs with correct defaults.

**LOC: ~60**

### Step 3: KB Projector (context propagation)

**`src/services/KBProjector.ts`**

Single function: `project(layer, opts?) → string`

Implementation:
1. Query kb_log with layer filter, active=true, abstraction sorting per layer
2. Query kb_docs with layer filter, tag matching
3. Load constitution from projectConfigs
4. If L0/L1: compute board state from tasks table
5. If L2: load AgentContext from task
6. Assemble within token budget
7. Return formatted string

**LOC: ~80**

### Step 4: Hook Projection Into Existing Flows

Wire the projector into:

**Orchestrator (`orchestrator.ts`):**
- Before calling architect: `project('L2', { taskId, executor })` → inject into architect prompt
- After step completes: call `KBWriter.recordExecution()` or `KBWriter.recordError()`

**Process Planner (`process-project-manager/`):**
- Before planning: `project('L1')` → inject into planner prompt

**Yuan (when activated):**
- OBSERVE phase: `project('L0')` → feeds Yuan's context

**LOC: ~30 (changes to existing files)**

### Step 5: Micro-Dream (post-task consolidation)

**`src/services/KBDreamer.ts`**

Function: `microDream(taskId, llmCall)`

1. Gather raw entries for task
2. If <3 entries: skip
3. LLM summarize
4. Append consolidated entry
5. Deactivate raw entries
6. Record executor outcome

**Trigger**: Called by orchestrator when task reaches DONE or FATAL_ERROR.

**LOC: ~40**

### Step 6: Session-Dream (idle consolidation)

**Function: `sessionDream(llmCall)`**

1. Check board state (no EXECUTING tasks)
2. Gather active entries + docs
3. Group by executor/category
4. LLM analyze
5. Append pattern entries
6. Flag document gaps

**Trigger**: Called by host when board is idle >5 min (background tick).

**LOC: ~50**

### Step 7: Deep-Dream (full consolidation)

**Function: `deepDream(llmCall)`**

1. Gather everything
2. LLM consolidation call
3. Gap resolution + external KB stubs
4. Constitution review (proposal)
5. Pruning

**Trigger**: Manual button in UI or scheduled.

**LOC: ~60**

### Step 8: Formal KB — Document Management

**`src/services/DocumentManager.ts`**

Functions:
- `importDocument(title, type, content, tags, source)` — user upload or artifact save
- `scanRepoForDocs()` — discover README, CONTRIBUTING, etc.
- `updateDocument(id, changes)` — version increment
- `deleteDocument(id)` — soft delete (active=false)

**UI**: Add document upload to settings or a dedicated panel.

**LOC: ~50**

### Step 9: Repo Scanner (initial KB population)

**`src/services/RepoScanner.ts`**

On project init:
1. Scan repo structure (using knowledge-repo-browser)
2. Detect tech stack (package.json, go.mod, etc.)
3. Discover existing docs (README, CONTRIBUTING, API docs)
4. Write initial architecture entry to kb_log
5. Import discovered docs to kb_docs
6. Record initial constitution (if not already set)

**LOC: ~40**

### Step 10: External KB Interface (stubs)

**`src/services/ExternalKB.ts`**

- Interface definition
- Stub implementations (NotebookLM, WebSearch)
- Configuration in projectConfigs
- Integration point in dream engine

**LOC: ~30**

---

## 8. LOC Summary

| Step | Component | LOC |
|------|-----------|-----|
| 1 | Dexie schema (kb_log + kb_docs) | 15 |
| 2 | KB Writer (recording) | 60 |
| 3 | KB Projector (context propagation) | 80 |
| 4 | Hook projection into existing flows | 30 |
| 5 | Micro-dream | 40 |
| 6 | Session-dream | 50 |
| 7 | Deep-dream | 60 |
| 8 | Document manager | 50 |
| 9 | Repo scanner | 40 |
| 10 | External KB interface (stubs) | 30 |
| | **Total** | **~455** |

New files:
```
src/services/KBWriter.ts
src/services/KBProjector.ts
src/services/KBDreamer.ts
src/services/DocumentManager.ts
src/services/RepoScanner.ts
src/services/ExternalKB.ts
```

Modified files:
```
src/services/db.ts          (add kb_log, kb_docs tables)
src/core/orchestrator.ts    (hook recording + projection)
src/core/host.ts            (dream triggers on idle)
```

---

## 9. Data Flow Summary (Quick Reference)

```
ID  From              To                 What               When
──────────────────────────────────────────────────────────────────────
F1  Executor          kb_log (Own KB)    Raw outcomes       Every step
F2  kb_log            Yuan (L0)          Distilled view     Yuan's OBSERVE
F3  Yuan              Architect/L2       Narrowed context   Task creation
F4  kb_docs           Projection         Document excerpts  Every projection
F5  Dream             kb_log             Consolidated entry After task/idle
F6  Dream→External→kb  kb_log + kb_docs  External findings  Gap detected
F7  External          Dream              Background research Periodic/proactive
```

---

## 10. What Phase 0 Delivers

- **Own KB**: System learns from every execution, consolidates through dreaming
- **Formal KB**: Users can upload/import docs; system discovers repo docs
- **External KB**: Interface defined, stubs in place, gaps flagged for future
- **Context propagation**: Every layer gets the right context from the unified KB
- **Dream engine**: Three levels (micro/session/deep) with consolidation
- **Gap detection**: System knows what it doesn't know and flags it
- **Migration path**: Tagged log → graph index → full PKB module, additive phases

What's NOT in Phase 0:
- No real external KB calls (stubs only)
- No graph structure (just filtered log)
- No token-budgeted traversal (sorted + cutoff)
- No constitution auto-amendment (proposals only, manual approval)
- No UI for KB browsing (programmatic access only)
