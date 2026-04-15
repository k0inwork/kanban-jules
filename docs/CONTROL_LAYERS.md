# Control Layers and Context Propagation

> How responsibility, control, memory, and experience flow through the system.

---

## 1. The Five Layers

The system has five layers of abstraction, from strategic to mechanical. Each layer has its own time horizon, decision scope, and memory type.

```
+================================================================+
|  L0  YUAN (Autonomous Supervisor)                               |
|  Time horizon: project lifetime                                 |
|  Decides: what to work on, when, why                            |
|  Memory: project constitution, executor profiles, error history |
+================================================================+
         |                    ^
         | spawns goals       | reports outcomes, learnings
         v                    |
+================================================================+
|  L1  PROCESS PLANNER (Project Manager)                          |
|  Time horizon: project stage / sprint                           |
|  Decides: what tasks to create, dependencies, sequencing        |
|  Memory: stage-artifact map, task graph, gap analysis           |
+================================================================+
         |                    ^
         | creates tasks      | reports completion, artifacts, failures
         v                    |
+================================================================+
|  L2  TASK (Protocol)                                            |
|  Time horizon: single deliverable                               |
|  Decides: step ordering, executor per step, retry strategy      |
|  Memory: AgentContext (cross-step KV), protocol steps, chat     |
+================================================================+
         |                    ^
         | runs steps         | returns step result, error context
         v                    |
+================================================================+
|  L3  STEP (Execution Unit)                                      |
|  Time horizon: single action                                    |
|  Decides: nothing -- follows instructions from L2               |
|  Memory: execution history (tool calls + results for this step) |
+================================================================+
         |                    ^
         | calls tools        | returns tool result
         v                    |
+================================================================+
|  L4  EXECUTOR (Tool Layer)                                      |
|  Time horizon: single tool call                                 |
|  Decides: nothing -- executes what L3 asks                      |
|  Memory: none (stateless per call)                              |
+================================================================+
```

### Layer Responsibilities

| Layer | What it controls | What it does NOT control | Independence level |
|-------|-----------------|------------------------|--------------------|
| **L0 Yuan** | Project strategy, board state, constitution, executor routing | Individual step code, tool implementation | Fully autonomous -- acts without prompt |
| **L1 Process Planner** | Task creation, sequencing, gap detection, stage transitions | How tasks execute internally | Semi-autonomous -- triggered by Yuan or events |
| **L2 Task** | Step ordering, code generation, retry logic, AgentContext | Which tasks exist, project strategy | Controlled -- created and monitored by L0/L1 |
| **L3 Step** | Tool call sequence within the sandbox | Nothing -- executes generated code | No independence -- runs LLM-generated JS |
| **L4 Executor** | Tool implementation details (API calls, VM commands) | Nothing -- responds to requests | No independence -- pure function |

### Do Tasks Spawn Each Other?

**Yes, but only upward delegation.** A task (L2) should never directly create another task. Instead:

- **L2 → L0**: A step calls `askUser()` or returns a result that Yuan interprets as "this needs another task." Yuan decides whether to create a follow-up task.
- **L1 → L2**: The Process Planner creates tasks based on project stage analysis. It can create a batch of related tasks with explicit dependencies.
- **L0 → L2**: Yuan creates tasks directly when it detects issues (stuck tasks, missing work, user requests).
- **L0 → L1**: Yuan triggers the Process Planner when it wants a full project-stage review (not just a single task).

**Why no L2→L2 spawning?** Because tasks don't have enough context to decide what other tasks should exist. That's L0/L1's job -- they see the full board, the constitution, and the project stage. A task only sees its own protocol and AgentContext.

---

## 2. Context Propagation

Context flows in both directions: **downward** (instructions, constraints, knowledge) and **upward** (results, learnings, experience).

### 2.1 Downward Flow (Instructions + Knowledge)

```
L0 Yuan
  |
  |-- constitution (rules, constraints, patterns)
  |-- executor profiles (what works, what doesn't)
  |-- project understanding (codebase structure, tech stack)
  |
  v
L1 Process Planner
  |
  |-- stage context (what stage are we in, what's been done)
  |-- gap analysis (what's missing from the plan)
  |-- task dependencies (task A must finish before B)
  |
  v
L2 Task
  |
  |-- protocol (step-by-step plan with executor assignments)
  |-- AgentContext (accumulated state from previous steps)
  |-- constitution subset (Programmer rules relevant to this executor)
  |-- module knowledge (executor-specific tips and patterns)
  |-- error context (from previous failed attempts)
  |
  v
L3 Step
  |
  |-- generated code (JS to execute)
  |-- sandbox bindings (available tools)
  |-- permissions (what the code is allowed to do)
  |-- execution history (for replay mode)
  |
  v
L4 Executor
  |
  |-- tool arguments (what to do)
  |-- request context (taskId, repoUrl, branch, LLM access)
```

**Key principle**: Each layer adds specificity. L0 says "implement auth." L1 breaks it into tasks. L2 breaks a task into steps. L3 generates code for a step. L4 executes a tool call. The knowledge narrows and becomes more concrete at each level.

### 2.2 Upward Flow (Results + Experience)

```
L4 Executor
  |
  |-- tool result (file content, command output, API response)
  |-- errors (timeouts, permission denied, API failures)
  |
  v
L3 Step
  |
  |-- step result (success/failure + return value)
  |-- execution history (sequence of tool calls and their results)
  |-- error context (accumulated across retry attempts)
  |
  v
L2 Task
  |
  |-- task outcome (all steps completed / failed at step N)
  |-- AgentContext (all cross-step state accumulated)
  |-- artifacts produced (code, specs, analysis results)
  |-- module logs (timestamped activity from each module)
  |
  v
L1 Process Planner
  |
  |-- stage progress (what artifacts now exist, what gaps remain)
  |-- task completion rate (what succeeded, what failed)
  |-- dependency resolution (which blocked tasks can now proceed)
  |
  v
L0 Yuan
  |
  |-- executor performance data (success rates, failure patterns)
  |-- project state delta (what changed since last review)
  |-- error patterns (recurring failures, systemic issues)
  |-- user satisfaction signals (did user accept results or re-request?)
```

**Key principle**: Each layer abstracts upward. L4 returns raw data. L3 summarizes into step results. L2 summarizes into task outcomes. L1 summarizes into stage progress. L0 synthesizes into project understanding. Raw details are available if needed (drill down), but each layer normally passes a summary.

---

## 3. Memory Collections

Each layer maintains different types of memory with different lifetimes and purposes.

### 3.1 Memory Types

| Memory Type | Lifetime | Where Stored | Who Reads | Who Writes |
|-------------|----------|-------------|-----------|------------|
| **Constitution** | Permanent (project lifetime) | `projectConfigs` table | L0, L1, L2 | L0 (proposes), User (approves) |
| **Executor Profiles** | Long-lived (updated after each task) | `agentContext` or dedicated table | L0, L1 | L0 |
| **Error History** | Long-lived (grows over project) | `moduleKnowledge` table | L0, L2 | L0 (synthesized), L2 (raw errors) |
| **Project Understanding** | Session-lived (rebuilt on wake) | L0's ReAct context | L0 | L0 (from scanning board + repo) |
| **Stage-Artifact Map** | Medium-lived (per project stage) | Constitution or `agentContext` | L1 | L0, L1 |
| **Task Graph** | Medium-lived (per planning cycle) | Tasks table (parent/dependency fields) | L1, L0 | L1 |
| **AgentContext** | Task-lived (per task execution) | `tasks.agentContext` field | L2, L3 | L2 (steps write via `addToContext`) |
| **Execution History** | Step-lived (per step attempt) | `tasks.protocol.steps[].executionHistory` | L2, L3 | L3 (sandbox records tool calls) |
| **Tool Results** | Ephemeral (per tool call) | In-memory during execution | L3 | L4 |

### 3.2 Memory Collection: Experience Store

A new collection that doesn't exist yet. This is where the system accumulates **learned patterns** -- not raw data, but distilled knowledge.

```
experience_store: {
  executor_profiles: {
    "executor-jules": {
      success_rate: 0.85,
      avg_duration_ms: 180000,
      strengths: ["feature implementation", "test writing"],
      failure_patterns: ["monorepo configs", "projects with complex setup"],
      daily_usage: 7,
      daily_limit: 10,
      last_updated: 1713187200000
    },
    "executor-local": {
      success_rate: 0.92,
      avg_duration_ms: 5000,
      strengths: ["file ops", "analysis", "artifact generation"],
      failure_patterns: ["tasks requiring shell access"],
      last_updated: 1713187200000
    },
    "executor-github": {
      success_rate: 0.78,
      avg_duration_ms: 120000,
      strengths: ["CI/CD", "builds", "multi-step pipelines"],
      failure_patterns: ["auth issues", "runner timeouts"],
      last_updated: 1713187200000
    }
  },

  task_patterns: {
    "bug_fix": {
      typical_steps: 3,
      preferred_executor: "executor-jules",
      common_failures: ["insufficient reproduction info"],
      success_tips: ["always include error logs in prompt"]
    },
    "feature": {
      typical_steps: 5,
      preferred_executor: "executor-jules",
      common_failures: ["scope creep", "missing test coverage"],
      success_tips: ["break into smaller PRs"]
    }
  },

  error_log: [
    {
      timestamp: 1713187200000,
      executor: "executor-jules",
      task_type: "feature",
      error_summary: "Jules failed on monorepo -- could not find tsconfig.json in nested package",
      resolution: "Added explicit path instructions to prompt",
      recurrence: 2
    }
  ]
}
```

**Where to store**: New Dexie table `experienceStore` or extend `moduleKnowledge`. L0 reads and writes. L1 reads for planning. L2 reads for prompt composition (module knowledge injection).

### 3.3 Memory Collection: Project Understanding

Rebuilt each time Yuan wakes up. Not persisted as-is -- it's a synthesized view of the current state.

```
project_understanding: {
  repo: "k0inwork/kanban-jules",
  branch: "collective",
  tech_stack: ["TypeScript", "React 19", "Vite 6", "Go/WASM"],
  architecture: "multi-agent orchestrator with module system",
  current_stage: "integration",  // from constitution stage mapping
  
  board_state: {
    total_tasks: 12,
    by_status: { TODO: 3, IN_PROGRESS: 2, IN_REVIEW: 1, DONE: 6 },
    stuck_tasks: ["task-abc"],  // EXECUTING for >10 min with no log output
    failed_tasks: ["task-xyz"], // ERROR state
    blocked_tasks: [],          // waiting on dependency
  },

  recent_activity: [
    { task: "task-123", event: "step completed", module: "executor-jules", ago_ms: 60000 },
    { task: "task-456", event: "user replied", ago_ms: 120000 }
  ],

  gaps: [
    "Constitution says 'testing spec' artifact required for Design stage, but none exists",
    "Task 'implement auth' has been IN_PROGRESS for 2 hours with no progress"
  ]
}
```

**Where to store**: L0's working memory (ReAct context window). Rebuilt on each OBSERVE phase. Not persisted -- it's derived from Dexie tables.

---

## 4. Experience Propagation

Experience flows upward (raw events become patterns) and downward (patterns inform future decisions).

### 4.1 Upward: Events → Patterns → Wisdom

```
L4 returns: "Error: ETIMEDOUT after 30000ms"
     ↓
L3 records: step failed, executor-jules, timeout error
     ↓
L2 records: task step 3 failed, retried 3x, all timeouts
     ↓
L1 observes: this task type ("large refactor") fails with Jules timeout
     ↓
L0 synthesizes: "executor-jules has 60% timeout rate on 'large refactor' tasks.
                 Consider breaking into smaller tasks or increasing timeout."
     ↓
Experience Store updated:
  executor_profiles["executor-jules"].failure_patterns += "large refactors timeout"
  task_patterns["large_refactor"].success_tips += "break into <500 LOC chunks"
```

### 4.2 Downward: Wisdom → Constraints → Prompts

```
L0 reads Experience Store:
  "Jules fails on large refactors"
     ↓
L1 planning: breaks "refactor auth module" into 3 smaller tasks
  instead of 1 large task
     ↓
L2 protocol generation: Architect sees module knowledge entry:
  "For executor-jules: keep changes under 500 LOC per step"
     ↓
L3 code generation: Programmer prompt includes:
  "MODULE KNOWLEDGE: Jules works best with focused, <500 LOC changes"
     ↓
L4 execution: Jules receives a well-scoped prompt
```

### 4.3 Cross-Task Context Transfer

When a task completes, its learnings need to be available to future tasks:

| What transfers | How | Persisted where |
|---------------|-----|-----------------|
| Artifacts (code, specs, analysis) | Saved to `taskArtifacts` table | Dexie, survives reload |
| AgentContext key-values | Saved to `tasks.agentContext` | Dexie, per-task |
| Module logs | Saved to `tasks.moduleLogs` | Dexie, per-task |
| Error patterns | L0 synthesizes into Experience Store | Dexie, project-wide |
| Executor performance | L0 updates executor profiles | Dexie, project-wide |
| Constitution amendments | L0 proposes, user approves | `projectConfigs`, permanent |

**Important**: AgentContext does NOT transfer between tasks automatically. Each task gets a fresh context. Cross-task knowledge lives in:
1. Experience Store (executor profiles, error patterns)
2. Constitution (project rules)
3. Artifacts (produced by one task, consumed by another)
4. Module Knowledge (executor-specific tips)

---

## 5. Dreaming (Background Memory Consolidation)

### 5.1 What is Dreaming?

Dreaming is the process of compressing raw experience into abstract, reusable knowledge. It runs in the background when the system is idle -- not during active task execution.

**Why it matters**: Raw logs and error histories grow without bound. Task artifacts accumulate. Module logs get verbose. Without compression, the system's "memory" becomes noise. Dreaming extracts signal from noise.

### 5.2 The Dreaming Process

```
Trigger: system idle for >N minutes, OR scheduled (e.g., nightly)

Phase 1: COLLECT
  - Read all task outcomes from last cycle (completed, failed, stuck)
  - Read all module logs from last cycle
  - Read all error entries from last cycle
  - Read current executor profiles

Phase 2: COMPRESS
  - LLM call: "Given these N task outcomes, what patterns emerge?"
  - Extract: which executors succeeded/failed at what task types
  - Extract: which error patterns recur
  - Extract: which constitution rules were violated or validated
  - Output: compact summary (3-5 bullet points per category)

Phase 3: INTEGRATE
  - Update executor profiles with new success/failure rates
  - Update error_log with synthesized entries (replace raw with abstract)
  - Update task_patterns with new observations
  - Propose constitution amendments if patterns warrant it

Phase 4: PRUNE
  - Archive raw logs older than N days (move to cold storage or delete)
  - Compact execution histories (keep summary, drop tool-call-level detail)
  - Merge duplicate error entries (increment recurrence counter)
  - Trim AgentContext of completed tasks (keep artifacts, drop intermediate state)
```

### 5.3 Dreaming Outputs

| Output | Written to | Effect |
|--------|-----------|--------|
| Updated executor profiles | Experience Store | L0 makes better routing decisions |
| Synthesized error entries | Experience Store | L0 detects systemic issues |
| Task pattern updates | Experience Store | L1 creates better protocols |
| Constitution amendments | Messages (proposals) | User reviews and approves |
| Pruned logs | Dexie tables (in-place) | Smaller DB, faster queries |
| Project understanding summary | Artifacts | Persistent snapshot of "what the system knows" |

### 5.4 Dreaming Levels

| Level | Frequency | Depth | What it does |
|-------|-----------|-------|-------------|
| **Micro-dream** | After each task completes | Shallow | Update executor profile for the executor used. Log error if failed. |
| **Session-dream** | When Yuan goes idle (no active tasks) | Medium | Review all tasks from this session. Compress module logs. Update task patterns. |
| **Deep-dream** | Scheduled (daily) or manual trigger | Deep | Full experience consolidation. Constitution review. Prune old data. Generate project understanding snapshot. |

### 5.5 Implementation Sketch

```
// Micro-dream: triggered by TaskStateMachine on COMPLETE or FATAL_ERROR
async function microDream(taskId: string) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  
  const executor = task.protocol?.steps?.map(s => s.executor) || [];
  const success = task.workflowStatus === 'DONE';
  
  // Update executor profile
  for (const exec of new Set(executor)) {
    await updateExecutorProfile(exec, success, task.structuredLogs);
  }
  
  // If failed, synthesize error entry
  if (!success) {
    await synthesizeErrorEntry(task);
  }
}

// Session-dream: triggered when board has no EXECUTING tasks
async function sessionDream(llmCall) {
  const recentTasks = await db.tasks
    .where('workflowStatus').anyOf('DONE', 'IN_REVIEW')
    .toArray();
  
  const summary = await llmCall(`
    Analyze these ${recentTasks.length} completed tasks.
    Extract: recurring patterns, failure modes, executor performance.
    Output JSON: { patterns: [], failures: [], recommendations: [] }
  `, true);
  
  await integrateSessionLearnings(JSON.parse(summary));
}

// Deep-dream: triggered on schedule or manual
async function deepDream(llmCall) {
  // Full consolidation...
  const experience = await loadExperienceStore();
  const allLogs = await db.tasks.toArray();
  
  const consolidation = await llmCall(`
    You are the Memory Consolidation Agent.
    Given the full experience store and all task history,
    produce a compressed project understanding.
    Identify: what we know, what works, what doesn't, what to change.
    Propose constitution amendments if warranted.
  `, true);
  
  await applyConsolidation(JSON.parse(consolidation));
  await pruneOldData();
}
```

---

## 6. Layer Interaction Map

```
           DOWNWARD (instructions)              UPWARD (experience)
           ==================                   ==================

L0 Yuan ──────────────────────────────────────────────────────────
  |  Writes: constitution, executor profiles     Reads: board state,
  |  Triggers: process review, task creation     executor outcomes,
  |  Injects: project understanding              error patterns
  |                                              Runs: dreaming
  v
L1 Process ───────────────────────────────────────────────────────
  |  Writes: tasks with dependencies             Reads: task completion,
  |  Sets: task descriptions, success criteria   artifact production,
  |  Maps: stage → required artifacts            gap analysis
  v
L2 Task ──────────────────────────────────────────────────────────
  |  Writes: protocol steps, AgentContext        Reads: step results,
  |  Generates: code via LLM                     retry outcomes,
  |  Injects: constitution + module knowledge    accumulated context
  v
L3 Step ──────────────────────────────────────────────────────────
  |  Writes: tool calls in sequence              Reads: tool results
  |  Records: execution history                  Reports: success/error
  v
L4 Executor ──────────────────────────────────────────────────────
     Executes: tool implementation               Returns: raw result
     (stateless, no memory)                      (file content, API response, etc.)
```

---

## 7. What Needs to Be Built

### Currently Exists

| Component | Layer | Status |
|-----------|-------|--------|
| Executor modules (Jules, Local, GitHub, WASM) | L4 | Working |
| Sandbox + Worker (step execution) | L3 | Working |
| Orchestrator (task protocol runner) | L2 | Working |
| AgentContext (cross-step KV store) | L2 | Working |
| Process Agent (project review) | L1 | Basic (single LLM call, no stage tracking) |
| Constitution system | L0/L1 | Exists but Yuan doesn't read it yet |
| boardVM bridge | L0 | Built, not activated |
| Yuan bootstrap | L0 | Built, not activated |

### Needs Building

| Component | Layer | Priority | LOC est. |
|-----------|-------|----------|----------|
| Yuan ReAct loop activation | L0 | 1 | ~50 |
| Board-planning system prompt for Yuan | L0 | 1 | ~30 |
| Yuan → UI message flow | L0 | 1 | ~30 |
| Experience Store (Dexie table + CRUD) | L0 | 2 | ~60 |
| Micro-dream (post-task executor profiling) | L0 | 2 | ~40 |
| Task dependency fields (parent, blockedBy) | L1/L2 | 2 | ~30 |
| Process Planner stage tracking | L1 | 3 | ~60 |
| Session-dream (idle consolidation) | L0 | 3 | ~80 |
| Deep-dream (scheduled consolidation) | L0 | 4 | ~100 |
| Cross-task artifact consumption | L1/L2 | 3 | ~40 |
| Constitution amendment proposals from Yuan | L0 | 4 | ~40 |
| | | | **~560** |

---

## 8. Design Principles

1. **Each layer summarizes upward.** Never pass raw data to a higher layer. L4 returns files; L3 summarizes into step results; L2 summarizes into task outcomes; L1 into stage progress; L0 into project understanding.

2. **Each layer constrains downward.** L0 sets rules (constitution). L1 sets task scope. L2 sets step instructions. L3 sets tool arguments. Each layer narrows freedom.

3. **Memory lives at the appropriate layer.** Ephemeral state (tool results) stays at L3/L4. Task state (AgentContext) stays at L2. Project state (experience, constitution) stays at L0/L1.

4. **Tasks don't spawn tasks.** Only L0 (Yuan) and L1 (Process Planner) create tasks. Tasks report results upward; the upper layers decide what to do next.

5. **Dreaming compresses, never deletes understanding.** Raw data can be pruned, but synthesized patterns are permanent. The experience store only grows more abstract, never loses learned patterns.

6. **Constitution is the shared contract.** All layers read the constitution. Only L0 proposes changes. Only the user approves them. This prevents the system from silently changing its own rules.
