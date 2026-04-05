# Unified Capability Model: Module System

## Status: Proposal (April 5, 2026)

This document proposes a refactoring of Fleet from hardcoded agent-tool bindings to a **pluggable module system**. The goal: add new executors (WASM busybox, OpenClaude), knowledge sources (Jira, external docs), and user channels (Telegram, Slack) without touching core orchestration code.

The design accounts for the current architecture: Programmer Agent generating JS code in a Sval sandbox, with specialized Negotiator subagents (JNA for Jules, UNA for user interaction) mediating all external calls.

**Sub-documents:**

- [modules-spec.md](modules-spec.md) — Module interface, sandbox bindings, worker threads, prompt composition, type changes (§4–7)
- [modules-catalog.md](modules-catalog.md) — Bundled module manifests, registry, install flow, future modules (§8)
- [modules-plan.md](modules-plan.md) — Migration path, implementation stages (§11, §13)
- [modules-ui.md](modules-ui.md) — Module management UI, presentation panels (§14)
- [modules-testing.md](modules-testing.md) — Test harness, MockJules, per-module-type test cases (§15)

---

## 1. Why Now

Current coupling points:

| Hardcoded in | What it locks in |
|---|---|
| `TaskStep.delegateTo: 'local' \| 'jules'` | Binary executor choice |
| `TaskArchitect` prompt | "decide if jules or local" — can't reason about N executors |
| Programmer Agent prompt | Jules-specific XML tags, delegation rules, tool XML syntax |
| `AgentState: 'WAITING_FOR_JULES'` | Executor names baked into state machine |
| `ArtifactTool`, `RepositoryTool` | Direct imports, no module boundary |
| `askUser` → UNA → Mailbox only | One user channel, hardcoded |
| Negotiator subagents (JNA, UNA) | Direct class imports, not pluggable |

---

## 2. Current Architecture (As of April 5, 2026)

The system is already a multi-agent orchestration framework. Understanding this is essential to the module design.

```
┌─────────────────────────────────────────────────────────┐
│                     Orchestrator                         │
│  Manages protocol, state, logs, retry logic              │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Programmer Agent (The Architect)     │   │
│  │  Generates JS code per step. Context flushed      │   │
│  │  between steps. Only sees:                        │   │
│  │    - Current step description                     │   │
│  │    - GlobalVars (persistent state)                │   │
│  │    - Previous step result                         │   │
│  │                                                   │   │
│  │  Code runs in Sval sandbox with injected APIs:    │   │
│  │                                                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │   │
│  │  │  askJules() │  │  askUser()  │  │ GlobalVar│ │   │
│  │  │  → JNA      │  │  → UNA      │  │ s.get()  │ │   │
│  │  │             │  │  + format   │  │ s.set()  │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┘ │   │
│  │         │                │                        │   │
│  │  ┌──────┴──────┐  ┌──────┴──────────────────┐   │   │
│  │  │    JNA      │  │         UNA              │   │   │
│  │  │ Jules Negot │  │  User Negotiator Agent   │   │   │
│  │  │ iator Agent │  │  Validates & converts    │   │   │
│  │  │             │  │  user input against       │   │   │
│  │  │ Repo ops    │  │  format constraint via    │   │   │
│  │  │ only. No    │  │  LLM. Retries or throws. │   │   │
│  │  │ artifacts.  │  │                          │   │   │
│  │  └──────┬──────┘  └──────────┬───────────────┘   │   │
│  └─────────┼────────────────────┼───────────────────┘   │
│            │                    │                        │
│  ┌─────────┴──────┐  ┌─────────┴────────────────────┐  │
│  │  Jules API     │  │  Mailbox (in-app)             │  │
│  │  (cloud VM)    │  │  + askUser format validation  │  │
│  └────────────────┘  └──────────────────────────────┘  │
│                                                         │
│  State persistence:                                     │
│  - GlobalVars: cross-step, task-scoped KV store         │
│  - Artifacts: task-scoped file storage (ArtifactTool)   │
│  - programmingLog: code gen attempts (CODE tab in UI)   │
│  - actionLog, UNA log, JNA log: separate log streams    │
└─────────────────────────────────────────────────────────┘
```

### Key Constraints from Current Architecture

1. **Programmer writes code, not tool calls.** The Programmer Agent generates executable JS that the Sval sandbox runs. Modules are not called directly by the LLM — they are injected as async APIs into the sandbox (`askJules()`, `askUser()`, `GlobalVars`).

2. **Negotiators mediate everything.** JNA and UNA are separate ReAct loops with their own LLM context. The Programmer never talks to Jules or the user directly.

3. **Strict separation of concerns.** Jules is prohibited from managing local artifacts or state. Artifacts are managed exclusively through ArtifactTool. GlobalVars is the only cross-step state.

4. **Context flushing.** The Programmer gets a clean slate per step. It cannot rely on conversational history — only GlobalVars and the previous step result survive.

5. **Format validation on askUser.** `askUser(question, format)` triggers LLM-based validation of user input. Failed validation throws back to the Programmer for retry.

---

## 3. Module Categories

Five categories. One interface contract. Different roles. Different direction of control. **Modules can be dual-role** — a module has a primary type but can also declare a `trigger` to run background work (see §4.0.3 in [modules-spec.md](modules-spec.md)).

| Category | Direction | Called by host? | Has sandbox bindings? | What it returns |
|----------|-----------|----------------|----------------------|-----------------|
| **Architect** | **Host → Module** | **Yes (per step)** | **No — receives them** | **Code or plan** |
| Knowledge | Architect → Module | Yes | Yes | Data |
| Executor | Architect → Module | Yes | Yes | Data |
| Channel | Architect → Module | Yes | Yes | Data |
| **Process** | **Module → Board** | **No (self-triggered)** | **No** | **Proposals** |

> **Dual-role modules**: Any non-process module can also declare a `trigger` + `processTick` to run background lifecycle management. Example: `executor-jules` is an executor (called by architect) that also runs a 5s cron tick to manage Jules sessions. See §4.0.3 in [modules-spec.md](modules-spec.md).

### 3.1 Knowledge Sources

Provide information to the agent and the user. Rendered as browsable folders in the left sidebar. Injected into the Sval sandbox as queryable APIs.

Current: ArtifactTool (injected as artifact read/write), RepositoryTool
Future: Jira issues, external docs, database schemas, API specs, RAG vector index

### 3.2 Executors

Run work. Each executor decides its own granularity and autonomy. Accessed through Negotiator subagents that the Programmer calls from sandboxed code.

Two shapes: **local** (WASM, CLI — synchronous, no lifecycle management) and **cloud** (Jules, GitHub Workflows — provision compute, poll, verify, teardown). Cloud executors are typically dual-role: they also run a background trigger to manage sessions/jobs. See §4.0.4 in [modules-spec.md](modules-spec.md).

Cloud executors have **three resource concepts** — only the hard limits need structured schema:

| Concept | Example | Schema or description? | Why |
|---------|---------|----------------------|-----|
| Concurrency cap | 1 concurrent Jules session | **Schema** (`limits`) | Host blocks at runtime |
| Daily quota (new) | 10 new sessions/day | **Schema** (`limits`) | Host counts at runtime |
| Degradation behavior | Reused sessions lose quality over time | **Description** | LLM reads it for routing decisions |

Reused sessions don't count against daily quota — this encourages reuse. Degradation is soft (consecutive verify failures → abandon for fresh session), not a hard wall.

Current: Jules (via JNA — cloud VM, fully autonomous, session reuse with degradation)
Future: WASM busybox (local sandboxed FS), OpenClaude session, local CLI, GitHub Workflows (remote VM), local Docker, serverless containers

### 3.3 User Channels

Bidirectional communication with the human. Accessed through UNA.

Current: In-app Mailbox (via UNA)
Future: Telegram bot, Slack integration, email

### 3.4 Process Controllers

Inward-facing modules that observe the board and propose actions. The architect never calls them — they run on triggers (events, schedules, manual) and push tasks, messages, or state changes onto the board. They are the project's autonomous governance layer.

Unlike the other three categories, process modules have **no sandbox bindings** and **no tools exposed to the architect**. They read board state (tasks, artifacts, messages, constitution) and write proposals back (new tasks, alerts, messages).

Current: ProcessAgent (constitution-based task proposals)
Future: dependency tracker, regression guard, stale task cleanup, milestone planner, review synthesizer

### 3.5 Architect Modules

The brain of the operation. Architect modules are what the host calls when it needs to plan or execute work. They receive the full context (task, step, available sandbox APIs, global vars) and return either executable code, a step plan, or both.

Unlike other module types, the architect **receives** sandbox bindings (it sees what APIs are available) but **doesn't expose** them (nothing calls the architect from the sandbox). The host calls the architect, the architect produces output, the host runs it.

Different architect modules produce different output types:

| Architect | Produces | When to use |
|-----------|----------|-------------|
| `architect-codegen-full` | Step plan (protocol) + code per step | Complex tasks needing structured decomposition |
| `architect-codegen-simple` | Just code, no protocol | Simple single-step tasks |
| `architect-describer` | Step descriptions only, no code | Tasks where the executor handles everything (e.g., pure Jules delegation) |
| `architect-planner` | Step plan only, delegates code to executors | Meta-orchestration, multi-executor coordination |

Current: Programmer Agent (codegen) + TaskArchitect (protocol generation) — both hardcoded in Orchestrator
Future: pluggable architects for different task complexity levels

---

> **§4–7: Interface & Core** — Module manifest, sandbox bindings, permissions, presentations, worker threads, prompt composition, type changes.
> → See [modules-spec.md](modules-spec.md)

> **§8: Bundled & Future Modules** — All module manifests, registry, install flow, future catalog.
> → See [modules-catalog.md](modules-catalog.md)

---

## 9. Design Critique

Self-critique of this proposal. What's overengineered, what's missing, and what's deferred intentionally.

### 9.1 Overengineered — Applied

The following were trimmed from the spec. Kept as notes here for context.

1. **Permission granularity.** Reduced to `network`, `timers`, `storage`. Additional permissions (`clipboard`, `fullscreen`, `media`) added when a real module needs them.

2. **`source.integrity` (sha256 of bundle).** Removed. Not a package registry. Bundled modules are in the same repo — pointless. External modules loaded from git refs — the commit hash already provides integrity.

3. **`depends` field.** Removed. Star topology — modules don't know about each other. No current use case for inter-module dependencies. Add when needed.

4. **Event bus with 9 event types.** Reduced to `module:log` only. Add others when real modules need them.

5. **`ResourceProfile` structured enum.** Removed. `latency: 'ms' | 'seconds'`, `autonomy: 'none' | 'semi' | 'full'`, `contextCost: 'low' | 'medium' | 'high'` — all of these are consumed only by the LLM when routing work. The LLM reads the module's `description` for this. Structured enums add schema maintenance without helping the LLM — natural language is how you'd explain it to a colleague. Only `ResourceLimit` (hard caps the host enforces at runtime) stays as schema. See §4 in [modules-spec.md](modules-spec.md).

### 9.2 Undercooked (deferred, not forgotten)

1. **No `executor-cli` spec in bundled modules.** Mentioned as future multiple times but never given a full manifest in section 7. It's the most obvious local dumb executor after WASM. Catalog entry added in 7.4.

2. **`GlobalVars` is not a knowledge source.** It's described as `knowledge-globalvars` but it's a runtime KV store — it doesn't query anything, doesn't browse. It's state, not knowledge. It stays as a core feature (not a module) for now because it's too tightly coupled to the sandbox lifecycle. May become a `state` type later.

3. **`ProgrammingLog` ownership.** Was "Orchestrator-level, not module-level." Now that the architect is a module, `programmingLog` moves to the architect module's log stream. It's a log of code generation attempts — that's the architect's responsibility.

4. **No `channel-email` spec.** Mentioned twice but never spec'd. Catalog entry added in 7.4.

### 9.3 Policy as Non-Type

`policy` was considered as a 5th module type (query at decision points, return yes/no). Rejected because:
- Policy behavior is already expressible through constitutions, executor descriptions, and process modules
- No current use case requires synchronous decision-point querying
- If needed later, it's a clean addition as a 5th type with the same manifest structure

---

## 10. Module Communication

In star topology, cross-module data flows through the architect's generated code. There is no event bus, no pub/sub, no inter-module event types. Communication is just return values.

**Current problem:** cross-agent communication happens through direct DB writes:
- JNA writes to `task.jnaLogs`
- UNA writes to `task.unaLogs`
- Orchestrator writes to `task.programmingLog` and `task.actionLog`
- UNA polls `db.messages` for user replies (2s interval in `UserNegotiator.ts:69`)

This works but is fragile — modules need to know the DB schema. The event bus replaces direct DB writes with a pub/sub layer, and the host handles persistence.

```typescript
type SystemEvent =
  | { type: 'module:log'; moduleId: string; message: string }
  // Additional event types added when real modules need them (see §9.1).
  // Likely candidates: step:complete, artifact:saved, user:message.

interface EventBus {
  emit(event: SystemEvent): void;
  on(type: SystemEvent['type'], handler: (event: SystemEvent) => void): () => void;
}
```

The host subscribes to `module:log` and writes to `task.moduleLogs[moduleId]`, replacing the current `jnaLogs`/`unaLogs` pattern. This makes logging automatic for any module.

Example:
- Executor-Jules emits `module:log` with progress messages → host writes to `moduleLogs['executor-jules']` → UI updates

**Likely next event types** (add when modules need them):
- `step:complete` — Orchestrator emits when a step finishes → ProcessAgent reviews project state, dependency tracker checks dependents
- `artifact:saved` — emitted when an artifact is created → sidebar refreshes, review synthesizer checks for clusters
- `user:message` — channel receives a reply → routes to Orchestrator as user reply

---

> **§11, §13: Migration Path & Implementation Stages** — Phased migration plan, stage goals and shippable checkpoints.
> → See [modules-plan.md](modules-plan.md)

---

## 12. Open Questions — Resolved

1. **Sval sandbox + Worker threads** — **DECISION: Full-worker.** Everything goes into workers — Sval runtime, module internals, all of it. Main thread stays clean. If generated code infinite-loops, it only kills its own worker. Thread boundary latency is negligible compared to network I/O (5s Jules polls). The LLM and Jules are both major overhaul targets — no reason to fear thread boundaries.

2. **Negotiator ownership** — **DECISION: No negotiator for dumb executors.** Smart executors (Jules, OpenClaude) get negotiators (JNA-style verify-and-retry loops). Dumb executors (WASM, CLI) return predicted results — the architect already knows what to expect. If the architect's generated code is wrong, the architect rewrites it. No verification layer needed.

3. **Module-to-module communication** — **DECISION: Star topology.** The architect (compiler agent) is the center. Modules are self-sufficient and don't know about each other. All cross-module data flows through the architect's generated code. No shared memory, no direct module-to-module calls.

4. **Multi-channel fan-out** — **DECISION: `Promise.race` / `Promise.all`.** When sending a question to multiple channels (e.g. Telegram + Mail), use native `Promise.race` for first-reply-wins semantics, `Promise.all` for gather-all semantics. The architect's prompt should explicitly propose these patterns. No custom primitives needed — no `select()` or `gather()`, just the standard Promise APIs.

5. **Executor routing** — **DECISION: Capability profile in description, not cost.** The `description` field conveys the routing logic:
   - **Local dumb** (WASM/CLI): fast, synchronous, simple transforms
   - **Jules**: intelligent, slow, remote — full feature implementation with testing
   - **OpenClaude**: intelligent-ish, local, needs more steering — small intellectual tasks, not full features
   No dedicated `cost` field. Speed and capability are the routing dimensions, not money.

6. **Module testing** — **DECISION: Required.** Each module type needs its own test harness. See §15 for the full testing strategy.

7. **Hot reloading** — **DECISION: No hot reload.** Reload the board/app when modules update. Simplest possible approach — no in-flight handoff complexity.

8. **UNA polling** — **DECISION: Solved by Promise.race.** Multiple channels each return a promise from `askUser`. `Promise.race` naturally ignores losers. Polling inside workers is fine — they don't block the main thread. May optimize to one shared listener per channel later, but not an architectural concern.

---

> **§14: Module Management UI** — Module list, detail panel, add external module flow, presentation panels on the board.
> → See [modules-ui.md](modules-ui.md)

> **§15: Testing Strategy** — MockHost, MockLLM, MockJules lifecycle simulation, per-module-type test cases.
> → See [modules-testing.md](modules-testing.md)
