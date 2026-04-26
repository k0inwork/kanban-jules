# Fleet: General Requirements

> Artifact-gated orchestrator of external agents.
> Browser-based. No server dependency.

---

## 1. System Identity

Fleet is a **multi-agent harness**. It wraps each external agent (Jules VM, Claude CLI, GitHub Actions, Yuan/v86 sandbox) the same way single-agent tools (Claude Code, Aider) wrap one LLM. The difference: Fleet dispatches to multiple heterogeneous executors and gates progression on artifact production.

```
Single-agent harness (Claude Code, Aider):
  User → LLM → tools → result

Multi-agent harness (Fleet):
  User → Orchestrator → Agent A (Jules VM)   → artifact
                      → Agent B (Claude CLI)  → artifact
                      → Agent C (v86 sandbox)  → artifact
                      ← gate: all artifacts approved?
                      → next stage
```

Fleet is **not** a code editor, autocomplete, CI pipeline, or project management tool. It orchestrates — decomposing goals into tasks, routing to executors, gating on artifacts, and producing documentation.

---

## 2. Core Requirements

### R1. Executor Abstraction

Each executor is a first-class agent wrapped by a harness interface. Fleet controls them separately — each has its own loop, state, and lifecycle.

**Requirements:**
- [ ] Unified executor interface: `execute(task, context) → result`
- [ ] Per-executor state tracking (idle, busy, errored)
- [ ] Per-executor configuration (constitution, rate limits, capabilities)
- [ ] Independent lifecycle management (boot, health check, teardown)
- [ ] Executor capability declaration (what it can do, what it cannot)

**Current executors:**

| Executor | Type | Best for |
|----------|------|----------|
| `executor-jules` | Cloud VM (Google) | Large implementation, full builds |
| `executor-github` | GitHub Actions | CI/CD, pipelines, builds |
| `executor-local` | Browser sandbox (Sval) | File ops, analysis, artifacts |
| `executor-claude` | Local Claude CLI | Reasoning, review (dev-only) |
| `bash-executor` | v86 VM | Shell commands, git, npm |
| `executor-wasm` | WASM busybox | Scripts (stub) |

**Current state:** Executors exist but share a single orchestrator pipeline. They are not independently controlled. The harness wrapping is implicit — each executor has a handler, not a dedicated loop.

### R2. Test-Gated Progression (MVP)

Tests are the gate. When a task completes and changed code on a branch, the full test suite runs. Pass = done. Fail = needs rework. No formal artifact schemas or approval workflows needed for MVP.

**How tests get written:**
1. Constitution instructs executors: "always write tests for your changes in `tests/` using the project's test framework. Run relevant tests before reporting task complete."
2. Executors (Jules, Claude) produce code + tests as part of normal task work
3. Tests accumulate in git — they're just files, no special system needed

**How tests gate progression:**
```
Task completes (DONE)
  → did it change code on a branch? (check branch exists, has diff)
    → yes → action-test-runner triggers full suite via executor-github
      → pass → task verified, branch safe for merge
      → fail → move task to IN_REVIEW, attach failure results
               (IN_REVIEW = needs rework, semantically correct)
    → no → skip (analysis/documentation only, no tests needed)
```

Failed tests move the task **back to IN_REVIEW**, not to a new column. IN_REVIEW already means "needs attention" — test failures are a reason for review. This avoids the contradiction of "blocking" a DONE task (you can't gate something that already happened). Instead, the task regresses: DONE → IN_REVIEW with `agentState: TEST_FAILED`.

**Requirements:**
- [ ] Constitution rule for test writing conventions (framework, location, command)
- [ ] Post-completion test trigger: task DONE + has branch → run full suite
- [ ] Test results stored as artifacts (linked to task, searchable in KB)
- [ ] Fail action: regress task to IN_REVIEW with `agentState: TEST_FAILED` + failure context
- [ ] Regression attribution: full suite fails → find which task introduced failing tests

**Current state:** Artifact lifecycle exists. `executor-github` can run workflows. No auto-trigger on task completion. No test result parsing or storage. Constitution has no test-writing rules.

### R3. Task Decomposition & Routing

User goals decompose into tasks, each routed to the best executor based on task characteristics and executor capabilities.

**Requirements:**
- [ ] Goal → task decomposition (LLM-assisted or plan-driven)
- [ ] Executor routing based on task type, complexity, and executor profile
- [ ] Task dependency graph (sequential, parallel, conditional)
- [ ] Per-task success criteria defined before execution
- [ ] Retry with escalating context (accumulated error history)
- [ ] Cross-task context passing (agentContext / globalVars)

**Current state:** Architect generates protocol (ordered step plan). Steps execute sequentially in Sval sandbox. Jules gets dedicated negotiation loop. Routing is LLM-decided at plan time. No dependency graph — steps are linear.

### R4. Verification Loop

Every task result is verified against success criteria. Failed verification triggers remediation.

**Requirements:**
- [ ] Post-execution verification against pre-defined success criteria
- [ ] LLM-assisted verification (substance check, not just existence)
- [ ] Deterministic verification where possible (tests pass, file exists, build succeeds)
- [ ] Retry loop with max attempts and accumulating error context
- [ ] Verification results stored as artifacts

**Current state:** Jules has a 3-retry verification loop. ProcessAgent does LLM-based substance review. No deterministic verification hooks. No generic verification primitive.

### R5. Knowledge Accumulation

Everything Fleet learns persists — execution logs, decisions, errors, observations, documents.

**Requirements:**
- [ ] Append-only knowledge log (observations, decisions, errors, corrections)
- [ ] Knowledge documents (specs, reports, analysis — versioned, searchable)
- [ ] Abstraction layers (raw L0 → consolidated L1 → synthesized L2)
- [ ] Cross-project knowledge sharing
- [ ] Dream engine for background consolidation (micro, session, deep)
- [ ] Watchdog for real-time anomaly detection from knowledge patterns

**Current state:** KB log with categories, abstraction levels, supersede chains. KB docs with full-text search. Dream engine with 3 consolidation levels + watchdog. Commit harvesting for git-based knowledge extraction. All working.

### R6. Constitution System

Each project has rules that govern agent behavior, artifact expectations, and stage definitions.

**Requirements:**
- [ ] Per-project constitution (editable, versioned)
- [ ] Constitution templates (Research, MVP, Testing, Production, Blank)
- [ ] LLM-extracted artifact names from constitution text
- [ ] Stage definitions with required artifacts per stage
- [ ] Executor-specific rules (what each executor may/may not do)
- [ ] Runtime constitution compliance checking

**Current state:** Per-project constitution with templates. `extractArtifactNames` uses LLM to parse artifact names on save. ProcessAgent reads constitution for gate checking. Executor-specific constitutions (overseer, architect, programmer) exist as module knowledge. Compliance checking is advisory.

### R7. External Agent Control

Fleet dispatches to agents running outside the browser — cloud VMs, local CLIs, CI runners. Each is a separate process with its own harness.

**Requirements:**
- [ ] Negotiator pattern per external agent type (send → poll → verify → retry)
- [ ] Session management (create, track, recover, teardown)
- [ ] Rate limiting and quota tracking per executor
- [ ] Result extraction (branch names, PR URLs, commit SHAs, logs)
- [ ] Error classification and escalation
- [ ] Independent health monitoring per executor

**Current state:** JulesNegotiator with full steering loop. UserNegotiator for human-in-the-loop. Session tracking in DB. No health monitoring. Branch/PR/commit extraction incomplete. No independent executor loops.

### R8. Multi-Project Support

The app manages multiple projects, each with its own repo, branch, constitution, and data scope.

**Requirements:**
- [ ] Project entity (id, name, repoUrl, repoBranch, constitution, artifactNames)
- [ ] All data scoped by projectId (tasks, KB, artifacts, messages, sessions)
- [ ] Project switching via header dropdown
- [ ] Create/edit/delete with constitution template selection
- [ ] Current project persisted in localStorage

**Current state:** Projects table exists (schema v26+). Project-scoped queries on all tables. Header dropdown. Create/edit modal. Constitution templates. Migration handles legacy `projectId: undefined` rows. Working.

### R9. Action Module System

Modules subscribe to board events and act autonomously. Not hardcoded hooks — pluggable, extendable listeners that react to state changes. Each action module declares what events it cares about and has its own tools for acting on them.

**Module type expansion:**

| Type | Role | Examples |
|------|------|----------|
| architect | Plan tasks | codegen |
| executor | Run tasks | jules, github, local |
| knowledge | Store/search | kb, artifacts |
| channel | Communicate | user, agent-bus |
| process | Background agents | dream, reflection |
| **action** | **React to events** | **test-runner, branch-tracker, kb-recorder** |

**Manifest declaration:**
```json
{
  "id": "action-test-runner",
  "type": "action",
  "subscriptions": [
    {
      "event": "task:statusChanged",
      "manifestFilter": { "to": "DONE" },
      "priority": 10
    }
  ],
  "tools": ["executor-github.runAndWait", "knowledge-artifacts.saveArtifact", "knowledge-kb.recordEntry", "knowledge-board.updateTask"],
  "constitutionPatches": {
    "executor-jules": {
      "namespace": "action-test-runner",
      "rules": [
        "Always write tests for your changes in the configured test directory.",
        "Run the project's test command before reporting task complete.",
        "Tests must be independent and runnable in isolation."
      ]
    },
    "executor-claude": {
      "namespace": "action-test-runner",
      "rules": [
        "Always write tests for your changes in the configured test directory.",
        "Run the project's test command before reporting task complete."
      ]
    }
  }
}
```

**Two-layer filtering:**
1. `manifestFilter` — JSON object, evaluated by dispatcher before loading module code. Fast reject. Example: `{ "to": "DONE" }` matches event payload.
2. Code filter — in the handler, after module loads. Fine-grained logic like `!!task.branch`. Only modules passing manifestFilter pay the load cost.

**Priority** — integer, lower = runs first. Actions subscribing to the same event run in priority order. No priority = last. This replaces "no ordering guarantee" with explicit control where needed.

**Constitution patches** use namespaced blocks, not raw text injection. When an action module is enabled, its namespace block is appended to the target module's `moduleKnowledge`. When disabled, the entire namespace block is removed by key. This avoids the problem of surgically removing free-form text from a blob — the namespace IS the surgical unit.

Current limitation: patches reference modules by explicit ID (`executor-jules`). Later: late binding by module type or capability tag (`executor:*`, `executor:has-git`).

**Action handler interface:**
```ts
export const action = {
  // Code filter — runs after manifestFilter passes
  filter: ({ to, task }) => to === 'DONE' && !!task.branch,
  blocking: false,  // true = gate (must pass before task can progress)
  async execute(context) {
    const { event, registry, db } = context;
    const { task } = event;
    const result = await registry.invoke('executor-github.runAndWait', {
      workflow: 'test.yml',
      branch: task.branch
    });
    await registry.invoke('knowledge-artifacts.saveArtifact', {
      name: `test-results-${task.id}.json`,
      type: 'test-results',
      content: JSON.stringify(result),
      projectId: task.projectId
    });
    await registry.invoke('knowledge-kb.recordEntry', {
      text: `Test suite for task "${task.title}": ${result.pass ? 'PASSED' : 'FAILED'} (${result.passed}/${result.total})`,
      category: result.pass ? 'observation' : 'error',
      tags: ['test', 'verification', task.executorId],
      source: 'action-test-runner',
      projectId: task.projectId
    });
    if (!result.pass) {
      // Regress task to IN_REVIEW with failure context
      await registry.invoke('knowledge-board.updateTask', {
        id: task.id,
        workflowStatus: 'IN_REVIEW',
        agentState: 'TEST_FAILED',
        testResults: result
      });
    }
  }
};
```

**Action modules have their own tools and KB footprint:**
- Each action records its activity to KB (searchable, filterable by source)
- Test runs become KB entries: "test suite for task X: PASSED (42/42)"
- Branch extractions become KB entries: "task X created branch feat/auth on commit abc123"
- Actions can use LLM tools (`host.analyze`) for intelligent processing, or be fully deterministic

**Candidate action modules:**

| Module | Subscribes to | What it does | Uses tools from |
|--------|--------------|--------------|-----------------|
| `action-test-runner` | `task:DONE` + has branch | Run full test suite via GitHub Actions, store results | executor-github, knowledge-artifacts, knowledge-kb |
| `action-branch-tracker` | `task:DONE` | Extract branch name, PR URL, commit SHA, store on task | knowledge-board, knowledge-kb |
| `action-kb-recorder` | `task:DONE` | Extract decisions from task logs, record to KB | knowledge-kb, host.analyze |
| `action-stage-gate` | `task:DONE` | Count remaining tasks in stage, propose stage advance if zero | knowledge-board, channel-user |
| `action-notifier` | `task:ERROR`, `task:DONE` | Send user alerts on errors, summaries on completion | channel-user |
| `action-regression` | `test-suite:FAIL` | Find which task introduced failing tests, flag it | knowledge-kb, knowledge-board |

**Design decisions:**
- **Sync vs async:** Manifest declares `blocking: true/false`. Blocking actions gate progression. Async actions run fire-and-forget.
- **Ordering:** Priority field (lower = first) for same-event ordering. No priority = last. If ordering matters between events, chain via events (action A emits event that action B subscribes to).
- **Failure:** Dispatcher wraps every action execute() in try/catch. Failed actions are logged to KB with `source: 'action-<id>'` and `category: 'error'`. Blocking actions that fail = gate blocks. The module does NOT need to handle its own errors — the dispatcher guarantees it.
- **Context:** Action context is derived by the dispatcher (task from event payload, registry, db, eventBus). No RequestContext leakage — actions don't need to know about orchestrator internals.
- **Tool permissions:** Manifest `tools` array is enforced by the dispatcher. Actions can only invoke tools they declared. Attempting to call an undeclared tool throws.
- **LLM involvement:** Module decides. `action-branch-tracker` is deterministic. `action-kb-recorder` may use LLM to synthesize decisions from logs.
- **Test failure regression:** Failed tests on DONE tasks move task back to IN_REVIEW with `agentState: TEST_FAILED`. This resolves the "blocking on DONE" contradiction — the task doesn't stay in DONE, it regresses to a state that semantically means "needs attention."

**What this replaces (currently hardcoded in orchestrator):**
- Post-completion KB recording → `action-kb-recorder`
- Post-completion branch tracking → `action-branch-tracker`
- Post-completion microDream trigger → `action-kb-recorder` (emits event dream subscribes to)
- Commit harvesting → `action-branch-tracker`

**Requirements:**
- [ ] `action` module type in manifest schema
- [ ] Event subscription system (modules register interest in events)
- [ ] Two-layer filter: manifestFilter (JSON, fast reject) + code filter (JS, fine-grained)
- [ ] Priority field per subscription (lower = runs first)
- [ ] Blocking/async flag in manifest
- [ ] Action context derived by dispatcher (task from event, registry, db, eventBus — no RequestContext)
- [ ] Dispatcher-level try/catch with KB error logging for all actions
- [ ] Tool permission enforcement (manifest `tools` array is the allowlist)
- [ ] Namespaced constitution patches (namespace key for surgical add/remove)
- [ ] Test failure regression: DONE → IN_REVIEW with `agentState: TEST_FAILED`
- [ ] Extract hardcoded post-completion hooks into action modules

**Current state:** No action module type exists. Post-completion logic is hardcoded in `orchestrator.ts` (KB recording, microDream trigger, commit harvest). Event bus exists but no subscription-based module dispatch.

- **Browser-only.** No server-side agent loop. Server (276 LOC Express) provides only COOP/COEP headers, CORS proxy, WISP relay.
- **IndexedDB persistence.** Dexie with 27 schema versions, 13 tables. All state is local.
- **Module system.** Manifest-declared (19 modules, 6 categories). Each module declares type, tools, permissions. Action modules subscribe to events.
- **CodeAct pattern.** LLM generates JS code, Sval sandbox executes with injected tool bindings. Not structured tool_use JSON.
- **Event bus.** Typed pub/sub for inter-module communication. Agent bus for cross-agent messaging.
- **No external dependencies at runtime.** LLM calls go to Gemini or OpenAI-compatible APIs. No middleware, no message queue, no database server.

---

## 4. What Fleet Is Not

| Fleet is | Fleet is not |
|----------|-------------|
| Multi-agent harness | Single-agent code assistant |
| Artifact gatekeeper | CI/CD pipeline |
| Task orchestrator | Project management tool (Jira, Linear) |
| Knowledge accumulator | Document hosting service |
| Constitution enforcer | Static analysis tool |
| Browser application | Cloud service / SaaS |

---

## 5. Current Implementation State

### Working (17/19 modules wired)

- Task CRUD and lifecycle tracking
- KB knowledge accumulation (log + docs + search)
- Artifact storage with lifecycle states
- Dream engine (3 consolidation levels + watchdog + commit harvest)
- Constitution system (per-project, templates, LLM artifact extraction)
- Template system (4 default templates, file upload, artifact name dropdown)
- ProcessAgent (ReAct loop with 11 tools, advisory gate checking)
- JulesNegotiator (full steering loop, retry, verification)
- UserNegotiator (human-in-the-loop via mailbox)
- GitHub Actions executor
- Local sandbox executor (Sval)
- Bash executor (v86 VM via session-mux)
- Board tools (task CRUD from agent context)
- Repo browser (GitHub API file read/write)
- Agent bus (inter-module messaging)
- Projector (L0/L1/L2 context assembly)
- Reflection (error reclassification)
- Scanner (secrets/patterns)

### Stubs (2/19)

- `channel-wasm-terminal` — declared, `enabled: false`, no handler
- `executor-wasm` — declared, `enabled: false`, no handler

### Partially wired

- `executor-claude` — works but dev-only, no production gate
- `agent-bootstrap` / Yuan bridge — container creation works, full loop depends on terminal panel + session-mux

---

## 6. Gap Analysis (Priority Order)

### Critical — Core Loop Gaps

| # | Gap | Why it matters | Effort |
|---|-----|---------------|--------|
| G1 | **Action module system** | Event subscription, filter, execute pattern. Foundation for all reactive behavior (test-runner, branch-tracker, etc). | Medium |
| G2 | **Test runner action** | MVP gate: task DONE + has branch → run full suite → pass/fail. Tests-as-gate replaces formal artifact schemas. | Small |
| G3 | **Branch/PR/commit tracking action** | Fleet can't answer "what did agent X produce for task Y?" without structured git artifact extraction. | Small |
| G4 | **Constitution test-writing rules** | Executors need to know: write tests in `tests/`, use project framework, run before done. | Small |

### Important — Functionality Gaps

| # | Gap | Why it matters | Effort |
|---|-----|---------------|--------|
| G5 | **Per-executor independent loops** | Currently all flow through one orchestrator pipeline. Each executor should have its own loop, state, and lifecycle. | Large |
| G6 | **Executor profiling** | No success rates, latency data, or cost tracking. Can't make informed routing decisions. | Small |
| G7 | **Task dependency graph** | Linear step execution can't express parallel tasks or conditional branching. | Medium |
| G8 | **Document generation pipeline** | No automated gather → draft → review → approve flow. Artifact lifecycle exists but no agent triggers it end-to-end. | Medium |

### Nice-to-have — Quality Gaps

| # | Gap | Why it matters | Effort |
|---|-----|---------------|--------|
| G9 | **Regression detection action** | Full suite fails → find which task introduced failing tests → flag it. Needs G2 + G3. | Medium |
| G10 | **Stage gate action** | Count remaining tasks in stage, propose stage advance. Needs action system. | Small |
| G11 | **Executor health monitoring** | No heartbeat, no stale-session detection, no auto-recovery. | Small |
| G12 | **Yuan full loop integration** | Bootstrap works, but terminal panel + session-mux needed for full agent-in-browser loop. | Large |
| G13 | **Export formats** | Everything is markdown in IndexedDB. No download/export. | Small |

---

## 7. Landscape Positioning

No existing framework implements true artifact gating:

| Framework | Gating | External Agents | Verification | Reactive Actions |
|-----------|--------|----------------|--------------|------------------|
| CrewAI | None | None | Pattern only | None |
| AutoGen | None | Docker subprocess | Pattern only | None |
| LangGraph | Conditional edges (closest) | None | Graph cycles | None |
| OpenAI Agents SDK | Guardrails (I/O only) | None | Pattern only | None |
| Claude Agent SDK | Hooks (tool-level) | tmux/CLI processes | Verification phase | Hooks |
| Google ADK | LoopAgent termination | None (cloud tools) | LoopAgent primitive | Callbacks |
| **Fleet** | **Test-gated (MVP)** | **Cloud VM + CLI + sandbox** | **Negotiator retry loops** | **Action modules** |

Fleet's combination of test-gated progression + heterogeneous external agents + pluggable action modules is unique. The action module system is the extensibility layer — users add new reactive behaviors without touching core orchestration.

---

## 8. Numbers

- **22 days** of development (Mar 31 — Apr 22, 2026)
- **266+ commits** from 7 contributors (5 non-human)
- **~25,760 LOC** total (115 source files, 25 test files)
- **19 modules** across 5 categories (17 wired, 2 stubs)
- **27 Dexie schema migrations** (13 tables)
- **407 tests passing** (96.4%)
