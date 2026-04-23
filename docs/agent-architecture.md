# Fleet Agent Architecture

## Overview

Fleet runs agents in a single browser tab. No server — everything executes client-side. Agents share an IndexedDB (Dexie) and communicate via EventBus + registry-based tool invocation.

```
Layer  Agents
─────  ──────────────────────────────────────────
L0     Yuan (Overseer sandbox — accesses ALL tools)
L1     Process Project Manager (board review)
L2     Architect (task decomposition)
L3     Programmer (LLM-generated JS in Worker sandbox)
```

All programmer code executes in a **Web Worker** (`new Worker()`) — async and non-blocking. Tool calls go via `postMessage` → main-thread handlers → `postMessage` back.

---

## Agent Catalog

### L0 — Yuan (Overseer)

| | |
|---|---|
| **Module** | `sandbox-yuan` |
| **File** | `src/modules/sandbox-yuan/YuanSandboxHandler.ts` |
| **Trigger** | User sends message via YuanChatPanel |
| **Execution** | Main-thread Sval sandbox with ALL module bindings injected |
| **Behavior** | Yuan receives a prompt, the Projector injects the Overseer constitution (L0), and Yuan generates JS code that calls tools in batches via `runScript`. It can invoke any registered tool — no restrictions. |

**Communication:**
- In: `yuanSend()` from UI → `boardVM.yuan.send` → `YuanSandboxHandler.runScript`
- Out: Emits `yuan:event` (thinking, tool_call, tool_result, completed, error)
- Can call: Everything

---

### L1 — Process Project Manager (Overseer)

| | |
|---|---|
| **Module** | `process-project-manager` |
| **File** | `src/modules/process-project-manager/ProcessAgent.ts` |
| **Trigger** | `project:review` event |
| **Execution** | ReAct loop — bounded LLM calls (max 10 iterations, 80k token budget, 5-min wall clock, 3 consecutive error cap) |
| **Behavior** | Lists board state, reviews artifacts, checks KB for context, proposes tasks, sends messages, updates artifact lifecycle (draft→reviewed→approved), saves mature artifacts to KB |

**Tools:** `listTasks`, `listArtifacts`, `readArtifact`, `queryKB`, `queryKBLog`, `saveToKB`, `updateArtifactStatus`, `analyze`, `proposeTask`, `sendMessage`

**Communication:**
- In: `project:review` event from EventBus
- Out: Writes `db.messages` (proposals, alerts)

---

### L2 — Architect

| | |
|---|---|
| **Module** | `architect-codegen` |
| **File** | `src/modules/architect-codegen/Architect.ts` |
| **Trigger** | `Orchestrator.processTask()` calls `generateProtocol()` |
| **Execution** | Single LLM call with architect constitution |
| **Behavior** | Takes a task title+description, queries knowledge projector (L2 layer), calls LLM with architect constitution, returns a `{steps[], decisions[]}` protocol. Each step specifies which executor to use and focus keywords. |

**Communication:**
- In: Direct call from Orchestrator
- Out: Returns protocol to Orchestrator

---

### L3 — Programmer

| | |
|---|---|
| **Module** | Not a separate module — runs inside `Orchestrator` |
| **File** | `src/core/orchestrator.ts` + `src/core/prompt.ts` |
| **Trigger** | Orchestrator executes each step from the architect's protocol |
| **Execution** | LLM generates JS code → executed in **Web Worker** sandbox. Async, non-blocking. Tool calls go `postMessage` → main-thread ModuleHost dispatches → `postMessage` back. |
| **Behavior** | Per step: Projector assembles L3 context → LLM generates JS code → Worker sandbox executes → code calls tools via `postMessage` bindings |

**Communication:**
- In: Orchestrator passes step + context
- Out: Tool calls via `module:request` event → ModuleHost dispatches

---

## Executors

All executors are invoked by the Programmer (L3) or Yuan (L0) to perform work.

| Module | File | What it does |
|---|---|---|
| `executor-local` | `src/modules/executor-local/LocalHandler.ts` | Placeholder. Code runs directly in the Orchestrator's Worker sandbox. |
| `executor-jules` | `src/modules/executor-jules/JulesHandler.ts` | Delegates to Google Jules API via `JulesNegotiator`. Polls activities (5s intervals, 15min timeout). Auto-approves plans. Verifies responses via LLM. Up to 3 retries. |
| `executor-github` | `src/modules/executor-github/GithubHandler.ts` | Runs GitHub Actions workflows. Creates temp branch, pushes YAML, polls completion, fetches logs. Tools: `runWorkflow`, `runAndWait`, `fetchLogs`, `getRunStatus`, `fetchArtifacts`. |
| `bash-executor` | `src/modules/bash-executor/BashExecutorHandler.ts` | Shell commands inside v86 Linux VM via `boardVM.bashExec`. Prefetches repo on init. Per-task working dirs. |

> **Note:** `bash-executor` replaced the former `executor-wasm` (removed). Both targeted the same v86 VM; bash-executor is the mature path with git clone, per-task dirs, and fsBridge.

---

## Negotiators

Not modules — shared services consumed by handlers.

### JulesNegotiator

| | |
|---|---|
| **File** | `src/services/negotiators/JulesNegotiator.ts` |
| **Consumer** | `executor-jules` |
| **Behavior** | Full Jules API lifecycle: create session → send message → poll activities (5s) → auto-approve plan → LLM-verify response → retry loop (up to 3x with feedback) |

### UserNegotiator

| | |
|---|---|
| **File** | `src/services/negotiators/UserNegotiator.ts` |
| **Consumer** | `channel-user-negotiator` |
| **Behavior** | `askUser()` writes to `db.messages`, sets task to `WAITING_FOR_USER`, blocks on `eventBus.on('user:reply')`. `sendUser()` is fire-and-forget. Optional LLM-based reply format validation. |

---

## Communication Architecture

Three mechanisms:

1. **EventBus** (`src/core/event-bus.ts`) — typed events
   - `module:request` / `module:response` — core tool invocation (request-response with timeout)
   - `user:reply` — human replies from UI (currently keyed by `taskId`, needs `agentId`)
   - `project:review` — triggers ProcessAgent
   - `yuan:event` — Yuan lifecycle events
   - `executor:completed` — triggers dream engine

2. **Shared IndexedDB** (`src/services/db.ts`) — 10 tables
   - `tasks` — central task records (workflowStatus, agentState, protocol, agentContext)
   - `messages` — agent-to-user messages (currently keyed by `taskId`, needs `agentId`)
   - Plus: `julesSessions`, `kbLog`, `kbDocs`, `taskArtifacts`, `taskArtifactLinks`, `pushQueue`, `moduleKnowledge`, `projectConfigs`

3. **Registry invocation** (`src/core/registry.ts`)
   - `registry.invokeHandler(toolName, args, context)` → `module:request` event → ModuleHost dispatches

---

## Inter-Agent Communication: Day and Night

Fleet has two communication modes — **night flow** (dreaming) and **day flow** (messaging). Most problems are handled at night. Day flow is only for problems that can't sleep on it.

```
┌─────────────────────────────────────────────────────┐
│                    PROBLEM OCCURS                     │
│                         │                             │
│            Can it wait until the task ends?           │
│                    ╱          ╲                       │
│                  YES            NO                    │
│                  ╲              ╱                     │
│                   ▼            ▼                      │
│            NIGHT FLOW    DAY FLOW                    │
│          (dream loop)    (agent bus)                 │
│            KB → dream     real-time messages          │
│            → reflection   between agents              │
│            → projector                             │
│            → next run                               │
└─────────────────────────────────────────────────────┘
```

---

### Night Flow — Dreaming (Asynchronous)

Night flow handles everything that can **wait until the task or session ends**. Agents don't talk to each other — they write to the knowledge base, and the dream engine processes it later.

**The dream cycle:**

```
Task completes
  │
  ▼
commit-harvest (event: executor:completed)
  → Extracts decisions from executor output
  → KB entry: category=decision, abs=4
  │
  ▼
microDream (per-task)
  → Verifies harvested decisions
  → Consolidates raw entries into insight (abs=5)
  → Records executor outcome (success/error counts)
  │
  ▼
sessionDream (5-min idle or after all tasks)
  → Extracts patterns, failures, strategies, gaps (abs=7)
  → Conflict detection between decisions
  → Auto-resolves: constitutional-override, guiding conflicts
  → Escalates to user: doubtful, self-correcting conflicts
  │
  ▼
reflection.reclassify (triggered by sessionDream)
  → Applies 5 rules to error entries
  → Creates self-tasks for recurring problems
  │
  ▼
deepDream (periodic)
  → Strategic consolidation (abs=9)
  → Resolves knowledge gaps
  → Proposes constitution amendments
  → Prunes old raw entries (7 days)
  │
  ▼
watchdogDream (after sessionDream/deepDream)
  → Only dream that can ACT — all others only enrich KB
  → Scans dream findings: "does this affect a running task right now?"
  → If yes → emits day-flow message (alert/intervention)
  → If no  → does nothing, findings go through projector as usual
  │
  ▼
Projector (per agent invocation)
  → Feeds accumulated KB knowledge into agent prompts
  → Layer-appropriate filtering (L0/L1 see everything, L2/L3 see stable only)
  → Agents wake up smarter
```

**Night→Day escalation — only the watchdog dream can cross the boundary:**

All dreams enrich the KB passively. The watchdog dream is the sole bridge from night to day. It runs after sessionDream and deepDream, inspects their findings, and checks: *is any running task affected right now?* If yes, it emits a day-flow message. If no, findings stay in KB land and reach agents through the projector on next run.

```
watchdogDream trigger examples:
  sessionDream → "infrastructure tasks fail with bash-exec" (abs=7)
    → watchdogDream checks: is any IN_PROGRESS task an infrastructure task using bash-exec?
    → YES → emits agent:message { to: 'orchestrator', type: 'intervention', 
         payload: { action: 'pause', reason: 'dream detected: infra tasks fail with bash-exec' } }

  deepDream → "architectural drift toward microservices" (abs=9)
    → watchdogDream checks: is any running task affected?
    → NO  → does nothing, projector feeds it on next agent invocation
```

**Watchdog scan table — what it watches and when it fires:**

| Dream output | Watchdog checks | Day trigger |
|---|---|---|
| sessionDream: executor pattern failure (abs=7) | Is a task using this executor right now? | `intervention`: pause task |
| sessionDream: conflict detected (doubtful/self-correcting) | Does this conflict affect a running task's plan? | `alert` to ProcessAgent |
| reflection: SAME-ERROR rule fired | Is a task hitting this same error right now? | `intervention`: pause + self-task |
| reflection: CONSTITUTION-VIOLATION | Is a running task violating constitution? | `alert` to ProcessAgent + Yuan |
| deepDream: knowledge gap confirmed | Is a running task blocked by this gap? | `alert` to ProcessAgent |
| sessionDream: recurring protocol failure | Is a task using this protocol right now? | `intervention`: pause, re-plan |

**What the watchdog ignores:**
- Decisions (abs=4) — already committed, nothing to interrupt
- Insights (abs=5) — too low-level to warrant interruption
- Resolved conflicts — already handled
- Strategic drift (abs=9) without active impact — projector will handle it

Key filter: **does this finding map to a specific IN_PROGRESS task?** No running task → no day message, projector handles it.

Simple rule: **only the watchdog dream can wake agents up.** Everything else sleeps until the projector.

**KB severity scale** (abstraction levels — how "digested" the knowledge is):

| Level | Meaning | Who writes it | Example |
|-------|---------|--------------|---------|
| 0 | Raw data | Execution | "bash returned exit 1" |
| 1 | Execution record | Orchestrator | "ran step 3 on executor-bash" |
| 2 | Observation | ProcessAgent, microDream | "task-42 failed 3x on same test" |
| 3 | Executor outcome | microDream | "executor-jules: 2 success, 1 error" |
| 4 | Decision | commit-harvest | "chose REST over GraphQL for auth API" |
| 5 | Consolidated insight | microDream | "project uses test-first pattern" |
| 7 | Session-level pattern | sessionDream | "infrastructure tasks fail with bash-exec" |
| 9 | Strategic insight | deepDream | "project has architectural drift toward microservices" |

**KB categories and their night-flow path:**

| KB Category | When created | Night-flow path |
|------------|-------------|-----------------|
| `execution` | Every tool call | Raw data — no escalation |
| `observation` | Agent notices something | microDream → insight |
| `decision` | commit-harvest from executor output | sessionDream verifies → projector feeds to agents |
| `error` | Tool/executor failure | reflection reclassifies if recurring → self-task |
| `insight` | Dream consolidation (abs 5, 7, 9) | projector injects into agent prompts |
| `correction` | Reflection rule matches | self-task created, projector shows to L0/L1 |
| `resolution` | Conflict auto-resolved or user-resolved | projector feeds back to all layers |

**Reflection rules — how recurring problems become self-tasks:**

| Rule | Trigger | What it creates | Who picks it up |
|------|---------|----------------|-----------------|
| SAME-ERROR | Same error >=3 tasks across >=2 tasks | Self-task "Fix recurring error" | ProcessAgent on next review |
| CONSTITUTION-VIOLATION | >=2 errors tagged 'constitution' | Self-task "Review constitution" | ProcessAgent + Yuan |
| RECURRING-PROTOCOL | Same executor >=3 errors | Self-task "Fix protocol for executor" | Architect via projector |
| USER-CORRECTION | User correction with overlapping error tags | Flagged entry | Yuan in next chat context |
| KNOWN-GAP | Error matches flagged gap | `gap-confirmed` tag | deepDream attempts to resolve |

**Conflict resolution — how contradictory knowledge gets resolved:**

| Conflict type | Auto-resolved? | Who resolves | What happens |
|--------------|:-------------:|-------------|-------------|
| `constitutional-override` | Yes | System (constitution wins) | Loser deactivated |
| `guiding` | Yes | System (higher abstraction wins) | Loser deactivated |
| `self-correcting` | No | Escalated with recommendation | ProcessAgent notified |
| `doubtful` | No | User decides | Yuan presents options |
| `constitutional-amendment` | No | User approves amendment | Yuan presents, user approves/rejects |

**Projector closes the loop — agents wake up smarter:**

| Layer | Experience budget | Sees | Conflict visibility |
|-------|-------------------|------|-------------------|
| L0 (Yuan) | 4800 chars | All active entries, board state | All conflicts + resolutions |
| L1 (ProcessAgent) | 3600 chars | All active entries, board state | All conflicts + resolutions |
| L2 (Architect) | 3600 chars | abs<=5 + conflict-resolved | Only resolved conflicts |
| L3 (Programmer) | 2400 chars | abs<=5 + conflict-resolved | Only resolved conflicts |

Yuan and ProcessAgent see everything (including pending conflicts). Architect and Programmer only see stable, resolved knowledge — they don't get distracted.

---

### Day Flow — Agent Bus (Real-Time)

Day flow handles problems that **cannot wait** — things that are actively causing damage (burning tokens, running in the wrong direction, user needs an answer now).

**Proposed: Event-Based Inter-Agent Bus**

Give every agent an `agentId`. Route real-time communication through typed events on the existing EventBus.

**Agent IDs:**

| Agent | agentId |
|-------|---------|
| Yuan (L0) | `yuan` |
| ProcessAgent (L1) | `process-agent` |
| Architect (L2) | `architect` |
| Programmer (L3) | `orchestrator` |
| User (human) | `user` |

**Message schema:**

```typescript
interface AgentMessage {
  id: string;              // unique message id
  from: string;            // agentId of sender
  to: string;              // agentId of recipient, or 'broadcast'
  type: AgentMessageType;
  payload: any;
  taskId?: string;         // optional task context
  timestamp: number;
  replyTo?: string;        // id of message this replies to
}

type AgentMessageType =
  | 'info'           // informational — no action required
  | 'alert'          // attention needed
  | 'request'        // expects a reply
  | 'reply'          // response to a request
  | 'directive'      // command from higher layer — must be obeyed
  | 'proposal'       // suggestion — recipient decides whether to act
  | 'status'         // state update (e.g. "I'm stuck", "task 50% done")
  | 'intervention'   // override — higher agent forcibly changes behavior
```

**When day flow triggers instead of night flow:**

| Scenario | Why night can't handle it | Day flow message |
|----------|--------------------------|-----------------|
| Task burning tokens right now | Can't wait for dream cycle | Orchestrator → ProcessAgent: `status` |
| User asks "what's happening?" | Yuan needs answer now | Yuan → ProcessAgent: `request` |
| User says "stop task 5" | Immediate cancel needed | Yuan → Orchestrator: `intervention` |
| Critical error mid-execution | Will compound if left running | ProcessAgent → Orchestrator: `intervention` |
| User changes project direction | Running tasks now wrong | Yuan → ProcessAgent: `directive` |
| Step result contradicts protocol | Next steps would be wrong | Orchestrator → Architect: `request` |

**Day flow escalation paths:**

```
ESCALATION (bottom-up — reporting problems upward):

L3 Programmer → L2 Architect: "step stuck, need re-plan" (status)
L2 Architect → L1 ProcessAgent: "protocol can't be fixed" (status)
L3 Programmer → L1 ProcessAgent: "executor blocked, task stuck" (status)
L1 ProcessAgent → L0 Yuan: "multiple tasks stuck, need user input" (alert)

INTERVENTION (top-down — directing lower layers):

L0 Yuan → L1 ProcessAgent: "user wants to change direction" (directive)
L0 Yuan → L3 Orchestrator: "user says cancel task 5" (intervention)
L1 ProcessAgent → L3 Orchestrator: "artifact errors, pause task" (intervention)
L1 ProcessAgent → L2 Architect: "protocol doesn't match artifacts" (request)
L3 Orchestrator → L2 Architect: "step contradicts protocol" (request)
```

**What this replaces:**

| Current | After |
|---------|-------|
| ProcessAgent writes `db.messages` directly | Emits `agent:message` to `user` |
| `user:reply` filtered by `taskId` | Filtered by `agentId` |
| `project:review` event triggers ProcessAgent | Addressed `agent:message` to `process-agent` |
| No agent-to-agent | Any agent can address any other agent |

---

### Day/Night Boundary — Intervention Scenarios

Concrete examples of when day flow is needed:

**ProcessAgent spots critical error mid-task:**
```
ProcessAgent reviews artifacts during runReview()
  → finds plan.md has contradictions
  → task-42 is still running, about to waste more steps
  → DAY FLOW: emits agent:message { to: 'orchestrator', type: 'intervention',
       payload: { action: 'pause', taskId: 'task-42', reason: 'plan.md needs rework' } }

Orchestrator receives intervention
  → pauses step execution for task-42
  → emits agent:message { to: 'architect', type: 'directive',
       payload: { action: 'regenerate', taskId: 'task-42', reason: '...' } }
```

**Yuan intervenes on user request:**
```
User tells Yuan "task 5 is going in circles"
  → DAY FLOW: Yuan emits agent:message { to: 'process-agent', type: 'directive',
       payload: { action: 'review-task', taskId: 'task-5' } }

ProcessAgent receives directive
  → includes task-5 in next review cycle
  → emits agent:message { to: 'yuan', type: 'reply',
       payload: { finding: 'task-5 stuck on failing tests, propose rollback' } }
```

**Architect needs to re-plan mid-execution:**
```
Orchestrator executes step, result contradicts protocol
  → next steps would be wrong
  → DAY FLOW: emits agent:message { to: 'architect', type: 'request',
       payload: { action: 'replan-step', taskId: 'task-42', stepIndex: 3, reason: '...' } }

Architect receives request
  → regenerates steps 3+ with new context
  → returns revised protocol to orchestrator
```

---

### Message Receipt Requirements

For day flow to work, **every agent must be able to receive messages**. Currently:

| Agent | Can receive? | Current mechanism | Gap |
|-------|:-----------:|-------------------|-----|
| Yuan | **No** | Only receives from UI via `yuanSend()` | Needs `agent:message` listener for ProcessAgent/Orchestrator reports |
| ProcessAgent | Partial | Triggered by `project:review` event | Needs persistent listener, not just trigger |
| Architect | **No** | Only called directly by Orchestrator | Needs listener for re-plan requests |
| Orchestrator | **No** | Runs Worker to completion | Needs message channel into Worker via `postMessage` |

**What each agent needs to receive:**

**Yuan** — receives replies and reports:
- ProcessAgent reports findings after review
- Orchestrator reports task completion or failure
- User replies (currently via `user:reply` event)

```
Yuan message handler:
  status   → show in chat panel ("task 42 completed", "task 5 stuck")
  reply    → show in chat panel (response to Yuan's request)
  alert    → highlight in chat panel, prompt user action
```

**Architect** — receives re-plan requests:
- Orchestrator asks to regenerate a step
- ProcessAgent asks to revise protocol

```
Architect message handler:
  directive    → regenerate protocol with new constraints
  request      → re-plan specific step (keep rest of protocol)
  intervention → abort current protocol, start fresh
```

**Orchestrator (L3)** — receives interventions and directives:
- ProcessAgent pauses/cancels a task
- Yuan cancels a task on user request

```
Orchestrator message handler:
  intervention → pause/cancel/abort current step
  directive    → change executor for next step, skip step
  status       → acknowledge, no action needed
```

### Intervention Priority & Rules

Not all agents can intervene in all directions. The hierarchy constrains who can send what:

| From → To | `directive` | `intervention` | `request` | `status` | `proposal` |
|-----------|:-----------:|:--------------:|:---------:|:--------:|:----------:|
| Yuan → ProcessAgent | yes | yes | yes | no | yes |
| Yuan → Orchestrator | yes | yes | yes | no | yes |
| Yuan → Architect | yes | yes | yes | no | yes |
| ProcessAgent → Orchestrator | yes | yes | yes | no | yes |
| ProcessAgent → Yuan | no | no | yes | yes | yes |
| ProcessAgent → Architect | no | yes | yes | no | yes |
| Orchestrator → ProcessAgent | no | no | yes | yes | no |
| Orchestrator → Yuan | no | no | yes | yes | no |
| Orchestrator → Architect | yes | no | yes | no | no |
| Architect → anyone | no | no | yes | yes | no |

**Rules:**
- `directive` — only flows **downward** (higher layer → lower layer). Must be obeyed.
- `intervention` — only flows **downward**. Forcibly changes behavior (pause, cancel, reassign).
- `request`/`reply` — flows in **any direction**. Peer communication.
- `status` — only flows **upward** (lower layer reports to higher layer).
- `proposal` — flows in **any direction**. Non-binding suggestion.

### How Agents Handle Incoming Tasks

Most agents are **call-and-return** — they run to completion with no event loop. Day-flow messages don't change this model. They just add **interruption checks at natural boundaries**.

| Agent | Model | Natural boundary | How it handles messages |
|-------|-------|-----------------|------------------------|
| Yuan | Event-driven (already) | UI input via `yuanSend()` | Add `agent:message` listener alongside existing UI handler |
| ProcessAgent | ReAct loop (up to 10 iterations) | Between iterations | Check message queue between loop ticks |
| Architect | Pure function | None — call with spec, return plan | No change. If re-plan needed, call again with new context |
| Orchestrator | Sequential step loop | Between steps | Check message queue between executor calls |

Agents stay request-response. They don't become reactive. Just a queue poll at their existing loop boundaries.

```
Orchestrator step loop (current):
  for (step of steps):
    result = executor.run(step)

Orchestrator step loop (with messages):
  for (step of steps):
    msg = messageQueue.poll()
    if (msg?.type === 'intervention'):
      handleIntervention(msg)
      continue
    result = executor.run(step)
```

### Executor Interruption

Executors are the agents that run for minutes — they're the ones most worth interrupting. But they're all **waiting on something external**, which is the natural check point.

| Executor | Waits on | Interruption check | Needs it? |
|----------|----------|-------------------|-----------|
| Jules | Polling loop (checks API every N sec) | Check message queue on each poll tick | **Yes** — runs minutes |
| Local/Bash | Process spawn | Check on stdout/stderr callbacks | Low priority — usually fast |
| Github | API call (~seconds) | Not worth interrupting | **No** — let it finish |
| User | `eventBus.on('user:reply')` block | Already interruptible — inject cancel reply | **Yes** — blocks indefinitely |
| Yuan sandbox | Script execution | Check on yield points | Low priority — usually fast |

**Jules is the main target** — it polls in a loop, so just add a queue check per poll cycle:

```
Jules poll loop (current):
  while (!julesTask.done):
    await sleep(pollInterval)
    status = checkJulesAPI()

Jules poll loop (with messages):
  while (!julesTask.done):
    await sleep(pollInterval)
    msg = messageQueue.poll()
    if (msg?.type === 'intervention'):
      cancelJulesTask()
      return { cancelled: true }
    status = checkJulesAPI()
```

Executors stay one-shot. They don't become reactive. They just check for cancel signals at their natural wait points.

### Coupling Points

| Coupling | Where | Risk |
|----------|-------|------|
| Yuan ↔ ALL modules | `YuanSandboxHandler` collects `sandboxBindings` from every manifest | Replacing Yuan means reimplementing binding injection |
| Agent ↔ DB schema | ProcessAgent queries `db.tasks`, `db.taskArtifacts`, `db.messages` directly | Schema change breaks agents |
| No uniform interface | Each agent has different handler signature | Can't swap agents generically |
| No tool call tracing | `registry.invokeHandler` is a passthrough | No observability into agent decisions |

### askUser / User Channel

`UserNegotiator` is the bridge between agents and the human user.

**Current flow:**
```
Agent calls askUser(question)
  → UserHandler → UserNegotiator.negotiate(taskId, question)
    → db.messages.add({ taskId, sender: 'local-agent', ... })
    → db.tasks.update(taskId, { agentState: 'WAITING_FOR_USER' })
    → blocks on eventBus.on('user:reply') filtered by taskId
```

**Problem:** Everything is keyed on `taskId`. Agents without a task can't ask questions:
- ProcessAgent (L1): `taskId: ''` — runs reviews, not tasks
- Yuan (L0): `taskId: 'yuan-script'` — fake ID

**Fix with agent bus:** askUser becomes `agent:message` to `user` with type `request`. Reply comes back as `agent:message` to the sender's `agentId`. Task-level blocking stays (sequential agents = only one active per task).

```
After fix:
  → eventBus.emit('agent:message', {
      from: agentId, to: 'user', type: 'request',
      payload: { question }, taskId?
    })
  → UI shows question, user replies
  → eventBus.emit('agent:message', {
      from: 'user', to: agentId, type: 'reply',
      payload: { content: '...' }
    })
```

This unblocks non-task agents and makes the user just another addressable agent.

### Observability Gap

There is no interception point for tool calls. All tool invocations go through `registry.invokeHandler` with no logging, tracing, or budget tracking.

**Proposed:** Add interceptor/middleware to registry — every tool call gets timestamped, logged, and timed. This gives:
- Trace timeline for debugging agent decisions
- Token/call budget enforcement per agent
- Debug UI surface (render trace entries)

Combined with the agent bus, every inter-agent message and every tool call flows through observable channels.

### Agent Replacement Difficulty

Replacing Yuan is **medium difficulty** — narrower than it appears:

| Component | Coupling | Change Needed |
|-----------|----------|---------------|
| `sandbox-yuan` manifest | Low — single tool, clean manifest | Reuse manifest structure |
| `YuanSandboxHandler` (97 lines) | Low — self-contained | New handler class |
| Binding injection | Low — `registry.getEnabled()` → `sandboxBindings` | Same pattern, different execution model |
| UI events | Low — `yuan:send` / `yuan:event` | Emit same event types |
| `host.ts` registration | Low — one line | Swap handler class |

With the agent bus in place, replacement becomes even easier — the new agent just needs to emit/consume `agent:message` events with its `agentId`. The binding collection pattern (YuanSandboxHandler lines 33-46) already decouples "what tools exist" from "how Yuan calls them."

---

## Task Lifecycle (Primary Flow)

```
User creates task → db.tasks
  │
  ├─ Architect.generateProtocol()
  │   LLM → {steps[], decisions[]}
  │
  ├─ Per step:
  │   Projector assembles L3 context
  │   LLM → JS code
  │   Worker sandbox executes (async, non-blocking)
  │   Code calls tools → postMessage → ModuleHost → handler
  │
  └─ On completion:
      KB records decisions
      Dream engine consolidates
      Reflection reclassifies errors

Background:
  5-min idle → sessionDream → reflection.reclassify
  project:review → ProcessAgent.runReview()
  Yuan chat → YuanSandboxHandler.runScript()
```

---

## Concurrency Model

- **Programmer sandbox** runs in a **Web Worker** — async, non-blocking
- **WASM executor** spawns a fresh Worker per call
- **v86 VM** (bash-executor) runs in its own thread
- All other agents run on the **main thread** (LLM calls, tool dispatch)
- No mutex/locks — Dexie transactions handle DB concurrency
- EventBus is synchronous dispatch on main thread
