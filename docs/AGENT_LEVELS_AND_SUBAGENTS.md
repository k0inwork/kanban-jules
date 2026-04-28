# Agent Levels, Cross-System Comparison & Subagent Integration

> How KJ's L0-L4 layers compare to NTM and OMC, and how external systems could plug in as subagents.

---

## 1. KJ's Layer Taxonomy (Internal)

KJ has 5 layers. These are already documented in `CONTROL_LAYERS.md` but summarized here for comparison.

| Layer | Name | Runs as | LLM loop | Time horizon | Decides |
|-------|------|---------|----------|-------------|---------|
| **L0** | Yuan / Overseer | Yuan bootstrap | Yes (ReAct) | Project lifetime | What to work on, when, why |
| **L1** | Process Planner | ProcessAgent | Yes (agentic, 10 iter max) | Sprint / stage | Task creation, sequencing, gap analysis |
| **L2** | Task / Protocol | Orchestrator + Architect | Yes (single-shot codegen) | Single deliverable | Step ordering, executor per step |
| **L3** | Step / Execution | Sandbox (sval) | No — follows generated code | Single action | Nothing — executes L2's code |
| **L4** | Executor / Tool | Module handlers | No — stateless functions | Single tool call | Nothing — responds to requests |

### Layer-to-Module Mapping

| Layer | Modules that operate here |
|-------|--------------------------|
| L0 | Yuan, ProcessAgent (project-wide mode), Dream (session/deep), Board (read board state) |
| L1 | ProcessAgent (agentic loop), Architect-Codegen, KB (stage/artifact tracking) |
| L2 | Orchestrator, Architect-Codegen (generates protocol), Projector (L2 context assembly) |
| L3 | Sandbox (sval), Local executor, Bash executor, Claude executor, Jules executor |
| L4 | All module tool handlers (repo-browser, artifacts, board CRUD, github API, etc.) |

---

## 2. NTM Layer Mapping

NTM has no explicit layers. All agents are the same abstraction: a CLI process in a tmux pane.

| NTM Concept | Implicit Layer | Role |
|-------------|---------------|------|
| Human operator | **L0** | Oversees everything — triages, assigns, approves |
| `ntm work triage` | **L0** | Graph-aware task selection (replaces Yuan's board scanning) |
| `ntm safety` / `ntm approve` | **L0** | Policy engine (KJ has no equivalent) |
| `ntm pipeline` | **L1** | Sequential task orchestration (replaces ProcessAgent) |
| `ntm assign` | **L1** | Work assignment to agents (KJ does this via orchestrator) |
| `--cc` (Claude Code pane) | **L3** | Autonomous coder — no architect role |
| `--cod` (Codex pane) | **L3** | Autonomous coder — no architect role |
| `--gmi` (Gemini pane) | **L3** | Autonomous coder — no architect role |
| `ntm locks` / `ntm worktrees` | **L4** | File conflict prevention (KJ has no equivalent) |
| `ntm checkpoint` / `ntm audit` | **L0** | Durable state capture (KJ loses state on tab close) |
| `ntm serve` / `--robot-*` | **L0** | Programmatic control surface (KJ has no REST API) |

### NTM's Missing Layers

- **No L2 (Architect)**. All agents are coders. No agent reviews code, designs architecture, or provides structural analysis. The human must provide all L2 judgment.
- **No L4 differentiation**. All agents have the same capabilities — they're just different CLIs. No specialization for testing, CI, file ops, etc.
- **L1 is thin**. `ntm pipeline` provides sequencing but no autonomous gap analysis or stage tracking.

---

## 3. OMC Layer Mapping

OMC has 19 specialized agents organized into lanes, but no explicit L0-L4. Mapping by functional scope:

| OMC Agent | Layer | Model | Scope |
|-----------|-------|-------|-------|
| `planner` | **L0→L1** | Opus | Project decomposition into task sequences |
| `analyst` | **L0** | Opus | Requirements, gap analysis, project-wide |
| `critic` | **L0→L1** | Opus | Multi-perspective plan/code review |
| `architect` | **L2** | Opus | System design, module structure |
| `code-reviewer` | **L2** | Opus | Logic defects, SOLID, anti-patterns |
| `security-reviewer` | **L2** | Opus | OWASP, secrets, unsafe patterns |
| `code-simplifier` | **L2** | Opus | Refactoring for clarity |
| `scientist` | **L2** | Sonnet | Data analysis, research |
| `document-specialist` | **L2** | Sonnet | External docs/SDK reference |
| `executor` | **L3** | Sonnet | Writes code, implements features |
| `debugger` | **L3** | Sonnet | Root-cause analysis, fix build errors |
| `verifier` | **L3** | Sonnet | Validates completion evidence |
| `test-engineer` | **L3** | Sonnet | Test strategy, coverage, flaky tests |
| `tracer` | **L3** | Sonnet | Evidence-driven causal tracing |
| `designer` | **L2→L3** | Sonnet | UI/UX implementation |
| `git-master` | **L3** | Sonnet | Atomic commits, rebasing |
| `qa-tester` | **L3** | Sonnet | Interactive CLI testing via tmux |
| `explore` | **L2→L3** | Haiku | Codebase search (serves all layers) |
| `writer` | **L1** | Haiku | Documentation, README, API docs |

### OMC's Missing Layers

- **No persistent L1 task board**. OMC is a stateless pipeline — planner decomposes, executor implements, verifier checks. No kanban columns, no stuck task detection, no board scanning.
- **No L4 tool differentiation**. All agents use the same Claude Code toolset. No specialized executors (CI runner, file ops, VM shell).
- **No L0 safety/approval system**. READ-ONLY vs full access is the only safety mechanism. No policy engine, no approval gates.

---

## 4. Cross-System Comparison Matrix

### 4.1 Layer Coverage

| Layer | KJ | NTM | OMC | Winner |
|-------|----|-----|-----|--------|
| **L0 — Project strategy** | Yuan (ReAct loop) + Dream + Board | Human operator + work triage + safety + checkpoints | Planner + Analyst + Critic | **KJ** (autonomous) / **NTM** (safety, durability) |
| **L1 — Task management** | ProcessAgent (agentic loop, 10 iter) + Board | Pipeline (sequential) + assign | Planner (decompose) + Writer | **KJ** (autonomous PM) |
| **L2 — Architecture** | Architect-Codegen (single-shot) | **Nothing** | Architect + Code-Reviewer + Security-Reviewer + Simplifier | **OMC** (4 specialized L2 agents) |
| **L3 — Execution** | 5 executors (Jules, Local, Claude, GitHub, Bash) | 3 coders (Claude, Codex, Gemini) | Executor + Debugger + Verifier + Tester + Tracer + Git-Master | **KJ** (variety) / **OMC** (verification) |
| **L4 — Tools** | 14 tool-only modules | File locks + worktrees | Same Claude Code tools for all | **KJ** (specialized modules) / **NTM** (conflict prevention) |

### 4.2 Feature Comparison

| Feature | KJ | NTM | OMC |
|---------|----|-----|-----|
| Model routing | Single `llmCall()` — no tier | Each agent IS a model | 3-tier adaptive (Haiku/Sonnet/Opus) |
| File conflict prevention | None | File locks + worktrees + force-release | Git worktree isolation per agent |
| Safety/approval | Constitution patches only | Full policy engine + approval gates + guards | READ-ONLY vs full access |
| Durable state | IndexedDB (ephemeral, tab-scoped) | Checkpoints + timeline + audit (files) | Git commits + project memory |
| Inter-agent comms | eventBus + messageQueue + shared DB | Agent Mail + tmux broadcast | No direct comms — parent coordinates |
| Quality gates | Test-runner action (post-DONE) | Human review (no automated gate) | Pipeline: critic → executor → verifier |
| Context assembly | Projector (L0/L1/L2/L3 projection with RAG) | None — each agent is independent | Agent-specific prompts (no RAG) |
| Work triage | Kanban columns + stuck detection | Graph-aware DAG + dependency ordering | Planner decomposition |
| Parallelism | Sequential steps within a task | Multiple panes concurrently (coordinated by locks) | Max 6 concurrent child agents |
| Programmatic API | None | REST + SSE + WebSocket + OpenAPI + `--robot-*` | None (Claude Code plugin only) |

---

## 5. NTM/OMC as KJ Subagents

### 5.1 The Question

KJ already has external agent executors (`executor-jules`, `executor-claude`). Could NTM or OMC become executors too? There are two integration models:

### 5.2 Model A: NTM/OMC as L3 Executors (One-Shot Delegates)

Treat NTM or OMC the same as `executor-jules` — hand off a task, get a result back.

```
KJ Orchestrator (L2)
  |
  |-- step.executor = "executor-ntm"
  |     |-- KJ creates a task description
  |     |-- NTM spawns a tmux pane with the description
  |     |-- NTM agent completes the work
  |     |-- KJ polls for completion (like JulesPostman)
  |     |-- KJ reads the result (git diff, file changes)
  |
  |-- step.executor = "executor-omc"
        |-- KJ creates a task description
        |-- OMC runs its pipeline (explore → analyst → planner → critic → executor → verifier)
        |-- OMC returns result
        |-- KJ reads the result
```

**Pros**: Simple — fits existing executor pattern. KJ controls the board; NTM/OMC are dumb workers.
**Cons**: Wastes NTM's coordination (Agent Mail, locks) and OMC's quality pipeline (critic, verifier). These systems become overpriced L3 coders.

### 5.3 Model B: NTM/OMC as L1 Sub-Orchestrators (Autonomous Delegates)

Let NTM or OMC manage their own subtasks. KJ creates a high-level task; the sub-orchestrator decomposes and executes it autonomously.

```
KJ Yuan (L0)
  |
  |-- "Implement auth module" (KJ task)
        |
        |-- step.executor = "executor-ntm"  (or "executor-omc")
        |     |
        |     |-- NTM: spawns 3 panes (--cc=2, --cod=1)
        |     |-- NTM: assigns sub-work to each pane
        |     |-- NTM: manages locks, coordinates via Agent Mail
        |     |-- NTM: collects results, reports back
        |     |
        |     |-- OR OMC: runs explore → analyst → planner → critic → executor → verifier
        |     |-- OMC: handles its own subtask decomposition
        |     |-- OMC: coordinates via parent-child hand-offs
        |
        |-- KJ: receives the completed result
        |-- KJ: records learnings, updates KB, runs microDream
```

**Pros**: Uses the full power of each system. KJ delegates a chunk of work and gets back a verified result.
**Cons**: KJ loses visibility into subtask execution. The sub-orchestrator's internal state is opaque.

### 5.4 Model C: NTM/OMC as Peer Systems (Linked Board)

KJ tasks and NTM/OMC tasks coexist on the same board, linked by dependencies. This is the DAG model.

```
KJ Board
  |
  |-- Task A: "Design auth architecture"  (KJ L2 — architect-codegen)
  |     |
  |     v  (dependency)
  |-- Task B: "Implement auth module"     (delegated to NTM swarm)
  |     |                                    NTM creates 3 sub-panes internally
  |     |                                    But KJ sees Task B as a single unit
  |     v  (dependency)
  |-- Task C: "Review auth implementation" (delegated to OMC critic)
  |     |
  |     v
  |-- Task D: "Run test suite"             (KJ action-test-runner)
```

In this model:
- KJ's ProcessAgent (L1) creates tasks with dependencies (DAG)
- Some tasks are "internal" (run by KJ modules)
- Some tasks are "delegated" (handed to NTM or OMC)
- The delegated task is opaque internally but has a clear contract (input → output)
- KJ's board tracks the DAG; each system tracks its own internal work

**Pros**: Best of both worlds. KJ controls the strategy; sub-orchestrators handle tactical execution.
**Cons**: Requires a shared task format and status sync protocol.

### 5.5 Recommendation

**Model C (Peer/Linked Board)** is the right architecture, but start with **Model A (One-Shot)** as the MVP:

1. **Phase 1**: Implement `executor-ntm` and `executor-omc` as one-shot executors (like `executor-jules`). They receive a task description, run autonomously, and return a result.
2. **Phase 2**: Add bidirectional status sync — KJ can query NTM/OMC for progress, and they can report back intermediate results.
3. **Phase 3**: Enable DAG-linked tasks — a KJ task can spawn NTM/OMC subtasks that appear on the KJ board as linked tasks with dependencies.

---

## 6. Steps as Subtasks — The Parallel Execution Question

### 6.1 Current State: Steps ARE Subtasks

KJ's `TaskProtocol` already decomposes work into steps:

```typescript
interface TaskProtocol {
  steps: TaskStep[];       // ordered sequence
  decisions?: ArchitectDecision[];
}

interface TaskStep {
  id: number;
  title: string;
  executor: string;        // which executor runs this step
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  focus?: string[];        // keywords for context projection
}
```

Steps run **sequentially**. The orchestrator executes step 0, waits for completion, then executes step 1, etc. Each step gets the accumulated `AgentContext` from previous steps.

**This is already a subtask system.** The question is: do we need ANOTHER layer of subtasks, or do we extend steps?

### 6.2 Why NOT Add Another Subtask Layer

Adding a `subtasks` field to `TaskStep` would create complexity without clear benefit:

```
Task (L2)
  |-- Step 1
  |     |-- Subtask 1a   ← new layer
  |     |-- Subtask 1b   ← new layer
  |-- Step 2
        |-- Subtask 2a   ← new layer
```

Problems:
- Steps are already the right granularity for LLM-generated code. A step = one coherent unit of work.
- Adding subtasks means the architect needs to decompose further, which is hard to get right.
- The orchestrator would need to manage subtask parallelism AND step sequencing.
- AgentContext becomes harder to manage — which subtask's results does the next step see?

### 6.3 Instead: Extend Steps to Support Parallel Execution

The better approach: steps can declare **parallel groups**. Steps within the same group run concurrently; groups run sequentially.

```typescript
interface TaskProtocol {
  steps: TaskStep[];
  parallelGroups?: number[][];  // arrays of step IDs that run concurrently
  decisions?: ArchitectDecision[];
}

// Example: "Implement auth module"
// Group 1: [0, 1] — both run in parallel
//   Step 0: "Create auth service"  (executor: executor-jules)
//   Step 1: "Write auth types"     (executor: executor-local)
// Group 2: [2] — waits for group 1
//   Step 2: "Wire auth into API"   (executor: executor-jules)
// Group 3: [3, 4] — both run in parallel
//   Step 3: "Write tests"          (executor: executor-jules)
//   Step 4: "Update docs"          (executor: executor-local)
```

### 6.4 How Parallel Steps Would Work

```
Orchestrator starts Task X

  Phase 1 (parallel):
    ├── Step 0 → sval sandbox A → executor-jules (remote VM)
    │     runs in Web Worker or async task
    │
    └── Step 1 → sval sandbox B → executor-local (in-browser)
          runs in main thread (or another Worker)

    JOIN: both must complete before Phase 2
    Step 0 result → AgentContext["step0_result"]
    Step 1 result → AgentContext["step1_result"]

  Phase 2 (sequential):
    └── Step 2 → sval sandbox C
          sees merged AgentContext from Phase 1
          executor-jules (remote)

  Phase 3 (parallel):
    ├── Step 3 → executor-jules
    └── Step 4 → executor-local
    JOIN: both complete
```

### 6.5 Multiple Running Svals?

Yes — this is the key implementation question. Currently there's one sval sandbox per task. For parallel steps, we'd need:

**Option A: Multiple sval instances in the same thread**
- sval is synchronous and lightweight (~1ms to create)
- Run steps sequentially within each parallel group (defeats the purpose)
- Or use async generators to interleave (complex)

**Option B: Web Workers per parallel step**
- Each parallel step gets its own Worker + sval instance
- They share `AgentContext` via `postMessage` (copy-on-write)
- Workers can't share IndexedDB transactions (each gets its own)
- Best isolation, true parallelism

**Option C: External executors for parallelism**
- Parallel steps that use `executor-jules` or `executor-claude` are already parallel by nature (they run externally)
- Only `executor-local` (sval) steps need parallel svals
- For most cases, one sval step + one external step in parallel is sufficient

**Recommendation**: Option C is pragmatic. Most parallelism comes from mixing external (Jules, Claude) and internal (local, bash) executors. Full sval parallelism (Option B) can be added later if needed.

### 6.6 Parallel Step Example

```
Architect generates protocol for "Add user authentication":

TaskProtocol:
  parallelGroups: [[0, 1], [2], [3, 4]]

  Step 0: "Implement JWT middleware"      → executor: executor-jules
  Step 1: "Create user model + migration" → executor: executor-claude
  --- JOIN (both must complete) ---
  Step 2: "Wire auth routes"              → executor: executor-jules
  --- (sequential) ---
  Step 3: "Write auth tests"              → executor: executor-jules
  Step 4: "Scan for secrets in auth code" → executor: executor-local
  --- JOIN (both must complete) ---

Jules and Claude run steps 0 and 1 simultaneously on different branches.
Step 2 waits for both, merges context.
Steps 3 and 4 run simultaneously — Jules writes tests while local-analyzer scans.
```

### 6.7 What About Subtasks in NTM/OMC Context?

When KJ delegates a task to NTM or OMC (Model A/C from section 5), the sub-orchestrator manages its own internal decomposition. KJ doesn't need to know about it:

- **NTM subtasks** = multiple tmux panes with Agent Mail coordination
- **OMC subtasks** = pipeline stages (explore → analyst → planner → critic → executor → verifier)

For KJ, the delegated task is a single step with `executor: "executor-ntm"` or `executor: "executor-omc"`. The internal decomposition is opaque. KJ only cares about: input → output → duration → success/failure.

This is the right boundary. KJ's steps are at the granularity of "implement X" or "review Y." NTM/OMC's internal tasks are at the granularity of "write function A" or "check file B for vulnerabilities." Different scopes, different abstractions.

---

## 7. Hook Modules → Agents

### 7.1 Current Hook Module Pattern

KJ's `action-test-runner` uses `constitutionPatches` to inject rules into executors:

```json
"constitutionPatches": {
  "executor-jules": {
    "namespace": "action-test-runner",
    "rules": [
      "Always write tests for your changes.",
      "Run the project's test command before reporting complete."
    ]
  }
}
```

This is a **passive hook** — it modifies the executor's prompt but doesn't run independently. The test-runner action only fires on `task:statusChanged → DONE`.

### 7.2 Hook Modules That Could Become Agents

| Current Hook | Could Become | Why |
|-------------|-------------|-----|
| `action-test-runner` | **L2 Test Agent** | Instead of just triggering on DONE, it could proactively suggest test cases during protocol generation, review test coverage after each step, and enforce test requirements in architect decisions |
| `action-kb-recorder` | **L1 Memory Agent** | Instead of just recording post-task, it could actively monitor execution and surface relevant KB entries mid-task (like OMC's `explore` agent) |
| `action-branch-tracker` | **L3 Git Agent** | Like OMC's `git-master`, it could manage branch lifecycle: create, track, merge, and handle conflicts proactively |
| `constitutionPatches` | **L2 Constraint Agent** | Instead of static rule injection, a constraint agent could dynamically adjust rules based on task type, executor, and accumulated experience |

### 7.3 The Upgrade Path

Hook modules become agents when they need to:
1. **Make autonomous decisions** (not just react to events)
2. **Communicate bidirectionally** (not just write to DB)
3. **Hold state across events** (not just fire-and-forget)

The progression:

```
Static config → Event hook → Reactive agent → Autonomous agent
(passive)        (fire-and-  (responds to      (initiates actions,
                  forget)     events, has        has own LLM loop,
                              simple logic)      maintains state)
```

- **Static config**: `constitutionPatches` (current)
- **Event hook**: `action-test-runner` (current — fires on DONE)
- **Reactive agent**: Test agent that responds to step completion, reviews coverage, suggests fixes
- **Autonomous agent**: Test agent that proactively writes test scaffolding, monitors coverage, and creates test tasks

---

## 8. KJ's Gaps — What to Build

### Priority 1: L2 Review Loop (Learn from OMC)

KJ has only single-shot architect-codegen. OMC has 4 L2 agents. KJ needs:

1. **Code Review Agent** (L2) — reviews step output before marking complete. Like OMC's `code-reviewer`.
2. **Security Scanner Agent** (L2) — runs after each step. Already have `knowledge-local-analyzer` but it's unlayered and passive.

### Priority 2: L0 Safety Policy (Learn from NTM)

KJ has no safety system. NTM has a full policy engine. KJ needs:

1. **Policy Engine** — configurable rules for what executors can do (e.g., "executor-local cannot delete files", "executor-jules cannot push to main")
2. **Approval Gates** — certain actions require user approval before execution (e.g., merging to main, deleting branches)
3. **Audit Trail** — log all executor actions for review

### Priority 3: Parallel Steps (Extend Existing)

As designed in section 6:

1. **`parallelGroups` field** on `TaskProtocol`
2. **Orchestrator fork/join** — run parallel steps concurrently, join results
3. **Mixed executor parallelism** — external (Jules/Claude) + internal (local/bash) running simultaneously

### Priority 4: Subagent Executor (Integrate NTM/OMC)

As designed in section 5:

1. **`executor-ntm`** — one-shot delegate to NTM (creates tmux pane, polls for completion)
2. **`executor-omc`** — one-shot delegate to OMC (runs pipeline, waits for result)
3. **DAG-linked tasks** — KJ board can reference NTM/OMC tasks as linked dependencies

---

## 9. Model Routing — What KJ Can Learn

KJ currently uses a single `context.llmCall()` with no tier differentiation. All modules that need LLM use the same call. OMC's adaptive routing shows a better way:

| Task Complexity | KJ (current) | KJ (proposed) | OMC equivalent |
|----------------|-------------|---------------|----------------|
| Simple lookup (file read, keyword search) | `llmCall()` — full model | **Tier 1: Rule-based** (no LLM) | Haiku (`explore`, `writer`) |
| Standard task (code generation, KB entry) | `llmCall()` — full model | **Tier 2: Fast model** (Haiku/Sonnet) | Sonnet (`executor`, `debugger`) |
| Complex reasoning (architecture, debugging, security) | `llmCall()` — full model | **Tier 3: Capable model** (Opus) | Opus (`architect`, `critic`, `code-reviewer`) |

Implementation: Extend `RequestContext.llmCall` to accept a `tier` parameter. The Projector already knows the layer — L0/L1 could default to Tier 3, L2 to Tier 2, L3 to Tier 1.

---

## 10. Summary

| What | Where it lives | What KJ should do |
|------|---------------|-------------------|
| L2 review | OMC (4 agents) | Build code-review and security-review agents |
| L0 safety | NTM (policy engine) | Build policy engine with approval gates |
| Model routing | OMC (3-tier adaptive) | Add tier parameter to `llmCall` |
| Parallel execution | NTM (concurrent panes), OMC (max 6 agents) | Add `parallelGroups` to TaskProtocol |
| File conflict prevention | NTM (locks + worktrees) | Add file reservation system |
| Durable state | NTM (checkpoints + audit) | Export state to files, survive tab close |
| Subagent integration | NTM/OMC as executors | Start with one-shot delegates, evolve to linked board |
| Hook → Agent upgrade | KJ internal | When hooks need autonomy, promote to agents |
| Subtask decomposition | Steps ARE subtasks | Extend steps with parallel groups, don't add another layer |
