# Module System: Implementation Plan & Details

> Sub-document of [modules.md](modules.md) — the unified capability model proposal.
> This file covers the migration path and implementation stages.

---

## 11. Migration Path

Incremental. No big-bang rewrite. Assumes current state: Orchestrator + Sval sandbox + JNA/UNA negotiators.

### Phase 1: Extract interfaces (no behavior change)
- Define `ModuleManifest`, `ModuleHost`, `ModuleWorker`, `EventBus`
- Wrap `ArtifactTool` in `knowledge-artifacts` manifest
- Wrap `RepositoryTool` in `knowledge-repo-browser` manifest
- Wrap `JulesNegotiator` + `JulesSessionManager` in `executor-jules` manifest
- Wrap `UserNegotiator` + mailbox logic in `channel-mailbox` manifest
- Everything still runs in main thread, no workers yet
- All existing functionality works identically

### Phase 2: Dynamic prompt composition
- Replace hardcoded `Orchestrator.runStep()` prompt (lines 119-146) with `composeProgrammerPrompt()`
- Replace hardcoded `TaskArchitect` prompt with `composeArchitectPrompt()`
- Both read from registered module manifests and sandbox bindings
- Adding a new executor now requires zero Orchestrator code changes

### Phase 3: Generalize sandbox injection
- Replace hardcoded `sandbox.injectAPI()` calls in `Orchestrator.executeInSandbox()` (lines 186-240) with the dynamic loop over registry modules
- This is where `sandboxBindings` from manifests become real

### Phase 4: Generalize types
- `TaskStep.delegateTo` → `TaskStep.executor`
- `AgentState.WAITING_FOR_JULES` → `WAITING_FOR_EXECUTOR`
- `Task.pendingJulesPrompt` → `pendingExecutorPrompt` + `pendingExecutorId`
- `Task.jnaLogs` / `Task.unaLogs` → `Task.moduleLogs: Record<string, string>`
- `Task.julesRetryCount` → `Task.retryCounts: Record<string, number>`
- Update all consumers

### Phase 5: Worker sandbox
- Build RPC layer over `postMessage`
- Move one module (easiest: `knowledge-artifacts`) to a worker
- Verify identical behavior
- Migrate remaining modules one by one

### Phase 6: Event bus
- Replace direct `db.tasks.update({ jnaLogs: ... })` calls in modules with `eventBus.emit('module:log', ...)`
- Host subscribes and writes to `moduleLogs`
- Replace UNA polling loop (`UserNegotiator.ts:69`) with event subscription

### Phase 7: New modules
- `executor-wasm`: WASM busybox sandbox (new folder, new manifest)
- `channel-telegram`: Telegram bot integration (new folder, new manifest)
- `executor-openclaude`: OpenClaude session executor (new folder, new manifest)
- None of these touch `core/` code

---

## 13. Implementation Stages

Ordered by dependency. Each stage is independently shippable. No stage requires the next one to be useful.

### Stage 0: Current State (shipped)
- Orchestrator + Sval sandbox + Programmer Agent (compiler)
- JNA (Jules Negotiator) + UNA (User Negotiator)
- ArtifactTool + GlobalVars
- Hardcoded prompt composition in Orchestrator
- All runs on main thread
- Star topology already implicit — architect generates code that calls injected APIs

### Stage 1: Module Manifests + Registry
**Goal**: Wrap existing code in manifests. No behavior change.

- Define `ModuleManifest` interface (with `sandboxBindings`, `description`, tools)
- Create manifests for bundled modules: `executor-jules`, `channel-mailbox`, `knowledge-artifacts`, `knowledge-repo-browser`, `knowledge-globalvars`
- Build `ModuleRegistry` — loads manifests, resolves `sandboxBindings`
- Wire registry into app startup (load bundled manifests)
- Everything still runs on main thread, no workers yet
- **Shippable**: app works exactly as before, but module structure is formalized

### Stage 2: Dynamic Prompt Composition
**Goal**: Orchestrator prompt generated from manifests, not hardcoded.

- `composeProgrammerPrompt(registry)` — reads all manifest descriptions + tool docs, builds the system prompt
- `composeArchitectPrompt(registry)` — same for task protocol generation
- Replace hardcoded prompts in `Orchestrator.runStep()` and `TaskArchitect`
- Add `Promise.race` / `Promise.all` patterns explicitly to architect prompt (multi-channel guidance)
- **Shippable**: adding a new executor requires zero Orchestrator changes — just register a manifest

### Stage 3: Worker Sandbox
**Goal**: Isolate generated code execution in workers. Infinite loops can't crash the app.

- Build RPC layer over `postMessage` (host ↔ worker)
- Move Sval sandbox into a worker
- Module `execute` / `askUser` / tool calls cross via RPC
- Move one module to worker first (`knowledge-artifacts`), verify identical behavior
- Migrate remaining modules one by one
- Negotiator (JNA) internals also move to worker — Jules API polling doesn't touch main thread
- **Shippable**: generated code crash = kill worker, restart. Main thread untouched.

### Stage 4: Generalized Types
**Goal**: Remove Jules-specific / Mailbox-specific types from core.

- `TaskStep.delegateTo` → `TaskStep.executor: string` (free-form, matches manifest name)
- `AgentState.WAITING_FOR_JULES` → `WAITING_FOR_EXECUTOR`
- `Task.pendingJulesPrompt` → `pendingExecutorPrompt` + `pendingExecutorId`
- `Task.jnaLogs` / `Task.unaLogs` → `moduleLogs: Record<string, string>`
- `Task.julesRetryCount` → `retryCounts: Record<string, number>`
- Update all consumers (UI, DB, orchestrator)
- **Shippable**: any executor works, not just Jules

### Stage 5: Event Bus
**Goal**: Modules don't write to DB directly. They emit events.

- Build lightweight `EventBus` (emit/subscribe)
- Replace direct `db.tasks.update({ jnaLogs: ... })` in negotiators with `eventBus.emit('module:log', ...)`
- Host subscribes and writes to `moduleLogs`
- UNA polling loop subscribes to user reply events instead of DB polling
- **Shippable**: modules are fully decoupled from DB schema

### Stage 6: New Modules
**Goal**: Prove the architecture by adding modules that touch zero core code.

- `executor-wasm`: WASM busybox sandbox — fast, synchronous, no negotiator. Description: "Local dumb executor. Use for simple transforms, string operations, math. Returns predicted results."
- `executor-openclaude`: OpenClaude session executor — local, intelligent-ish, needs steering. Description: "Local intelligent executor. Use for small intellectual tasks, code review, analysis. Not suited for full feature implementation — steer with specific sub-tasks."
- `channel-telegram`: Telegram bot integration — `askUser` via bot messages, `Promise.race` compatible with mailbox channel
- Each module: manifest + implementation + integration tests (test harness deferred)
- **Shippable**: new capability without touching `core/`

### Stage 7: External Module Loading
**Goal**: Load modules from external repos at runtime.

- Define module package format (manifest + source + tests)
- Runtime loader: fetch module from git URL, validate manifest, spin up worker
- Module sandboxing: worker gets only the APIs declared in its manifest
- Board reload picks up new/updated modules (no hot reload)
- **Shippable**: third-party module ecosystem becomes possible

---

## 14. MVP Scenario — Minimum Working Module System

The smallest set of changes that produces a working system with the module architecture end-to-end. Everything after this is incremental improvement. The MVP skips workers, event bus, and new module types — it focuses on the critical path: **dynamic prompts + generalized types + the `analyze()` context transfer**.

### What "working" means

1. A new executor (e.g. `executor-openclaude`) can be added by creating a folder with a manifest — zero core code changes
2. The architect sees all registered executors and routes work to them
3. Multi-step tasks carry context between steps via `analyze()` / `addToContext()`
4. The UI works with generic executor names (no Jules-specific state machine)
5. ProcessAgent can be triggered manually and by events

### MVP stages (subset of full plan)

| MVP Step | Maps to Full Stage | What changes |
|----------|-------------------|--------------|
| **M1** | Stage 1 (partial) | `ModuleManifest` interface + `ModuleRegistry`. Only the fields the MVP needs: `id`, `type`, `description`, `tools`, `sandboxBindings`. No `limits`, `configFields`, `presentations`, `trigger` yet. Wrap existing code in manifests: `executor-jules`, `channel-mailbox`, `knowledge-artifacts`, `knowledge-repo-browser`. |
| **M2** | Stage 2 | `composeProgrammerPrompt(registry)` + `composeArchitectPrompt(registry)`. Replace hardcoded prompts. The architect now reads module descriptions dynamically. |
| **M3** | Stage 4 | Generalize types: `delegateTo` → `executor: string`, `WAITING_FOR_JULES` → `WAITING_FOR_EXECUTOR`, `jnaLogs`/`unaLogs` → `moduleLogs`, `pendingJulesPrompt` → `pendingExecutorPrompt`. Update UI consumers. |
| **M4** | Stage 2 extension | Implement `analyze(text)` and `addToContext(text)` sandbox tools. Host collects results, injects as `accumulatedAnalysis` into subsequent step prompts. This is the missing context transfer — the single biggest improvement to multi-step task quality. |
| **M5** | Stage 1 (partial) | Wrap `ProcessAgent` in `process-project-manager` manifest with `manual: true` trigger. Add `runManual()` to host. Wire "Review Board" button to it. |

### What the MVP skips (defers to later stages)

| Skipped | Why it's safe to defer |
|---------|----------------------|
| Worker threads (Stage 3) | All modules run on main thread. Generated code crash still kills the app. Acceptable for MVP — the architecture doesn't change, just the isolation boundary. |
| Event bus (Stage 5) | Modules still write directly to DB (current pattern). Works, just coupled. Refactoring to event bus is purely internal. |
| `limits` enforcement | No runtime quota checking. Jules concurrent-session blocking happens naturally in current code (single Postman loop). Add structured enforcement when a second cloud executor appears. |
| `presentations` | Sidebar stays hardcoded. Dynamic panel rendering is a UI convenience, not a functional requirement. |
| `configFields` UI | API keys stay in localStorage/env as they are today. Module config UI is a convenience. |
| External module loading (Stage 7) | Only bundled modules. No runtime fetch from git. |
| New executors (Stage 6) | Adding `executor-openclaude` is the proof point, but it can happen after the MVP is stable. |

### MVP execution order

```
M1 (manifests + registry)
 │
 ├── M2 (dynamic prompts) ── depends on M1 (reads registry)
 │    │
 │    └── M4 (analyze tool) ── depends on M2 (injects into prompt)
 │
 ├── M3 (generalize types) ── independent of M1/M2, can run in parallel
 │
 └── M5 (ProcessAgent module) ── independent, can run in parallel
```

M1 first (everything reads the registry). Then M2+M3+M5 can run in parallel. M4 depends on M2.

### How to verify the MVP works

1. **Add a dummy executor**: Create `src/modules/executor-dummy/manifest.json` with `description: "I am a dummy executor for testing."`. Verify it appears in the architect prompt without any core code changes.
2. **Run a multi-step task**: Create a task that requires 3+ steps. Verify `analyze()` output from step 1 appears in step 3's prompt context.
3. **Run ProcessAgent manually**: Press "Review Board". Verify proposals appear in mailbox.
4. **Check UI**: Verify tasks with `executor: 'dummy'` display correctly (no Jules-specific labels, no `WAITING_FOR_JULES` state).
5. **Regression**: Run a Jules-delegated task. Verify identical behavior to pre-MVP.

### Post-MVP priority

After the MVP ships, the highest-value next step is **Stage 3 (worker threads)** — this is the only change that improves reliability (crash isolation). Everything else (event bus, presentations, new modules) is feature work that builds on the MVP foundation.

---

## 15. Three Implementation Paths Compared

Three ways to get from current state to a working module system. Each makes different tradeoffs.

---

### 15.1 Path A: Full Incremental Migration (§11, §13)

The 7-stage plan already documented above. Wrap existing code piece by piece.

**Best for**: preserving every line of working code, zero-downtime migration.

**Cost**: 7 stages, each touching multiple files. Every stage risks breaking existing behavior. The hardest stages (3: workers, 5: event bus) are in the middle, not at the end — you commit to the full path before seeing the biggest structural changes.

**Core problem**: the existing code has 5 structural issues that incremental migration can't solve cleanly:

1. **App.tsx is 1223 lines** — agent loop, Postman, task processing, settings, sidebar state all in one component. Extraction is surgical work across 170-line embedded blocks.
2. **No what/how separation** — `processTask` (App.tsx:431) knows about API keys, models, protocol generation, step iteration, error recovery. Both scheduler and executor.
3. **Sval singleton with mutation** — `injectAPI` accumulates across executions. Step 2 sees Step 1's bindings. No per-execution isolation.
4. **~30 direct `db.tasks.update()` calls** across 6 files — each knows which field to write (`jnaLogs`, `unaLogs`, `chat`, `actionLog`). Event bus fixes this but requires touching every callsite.
5. **Postman embedded in React hooks** — 170-line `setInterval` accessing `tasks`, `julesApiKey`, `apiProvider` through closure. Extracting means breaking the hook chain.

---

### 15.2 Path B: Clean-Room Core Rewrite (Hybrid)

Rewrite the orchestration layer from scratch. Keep the UI shell, adapt it.

**Best for**: getting a clean module architecture without untangling legacy couplings.

**What gets rewritten** (~600 lines of new core):

```
src/core/
  registry.ts       ~80 lines   ModuleRegistry, manifest loading
  host.ts           ~150 lines  ModuleHost lifecycle, trigger dispatch, runManual()
  orchestrator.ts   ~120 lines  Step loop, dynamic prompt composition, context forwarding
  sandbox.ts        ~80 lines   Per-execution Sval instance, dynamic binding injection
  types.ts          ~50 lines   Generalized TaskStep, AgentState, ModuleManifest
  event-bus.ts      ~40 lines   emit/on, module:log only
```

**What gets kept** (adapted, not rewritten):

- `db.ts` — add `moduleLogs` field, rename fields. IndexedDB version bump.
- UI components — update Task type imports, rename state constants. Mechanical.
- `JulesSessionManager` — move to `src/modules/executor-jules/` with manifest wrapper.
- `ProcessAgent` — move to `src/modules/process-project-manager/` with `manual: true`.
- `ArtifactTool`, `RepositoryTool` — wrap in manifests.
- `UserNegotiator` — becomes `channel-mailbox` module internals.

**What gets deleted**:
- `Orchestrator.ts` (replaced by `core/orchestrator.ts`)
- `TaskArchitect.ts` (merged into `core/orchestrator.ts`)
- `Sandbox.ts` singleton (replaced by per-execution instances in `core/sandbox.ts`)

**Hybrid steps**:

| Step | What | Lines touched | Risk |
|------|------|---------------|------|
| **H1** | Generalized types in `core/types.ts`. DB version bump with migration. | ~50 new, ~30 adapted | Low — additive |
| **H2** | Write clean core: registry, host, orchestrator, sandbox, event-bus. No existing code touched yet. | ~470 new | None — new files |
| **H3** | Write manifests for existing modules: `executor-jules`, `channel-mailbox`, `knowledge-artifacts`, `knowledge-repo-browser`, `process-project-manager`. | ~200 new | None — new files |
| **H4** | Wire new core into App.tsx. Replace `processTask` + Postman with calls to new orchestrator + module ticks. | ~100 changed in App.tsx | Medium — integration point |
| **H5** | Implement `analyze()` / `addToContext()` in new sandbox. | ~40 new in core | Low — additive |
| **H6** | Update UI consumers: `TaskDetailsModal`, state labels, log tabs. Mechanical. | ~60 changed across components | Low — find-and-replace |

**Dependency graph**:

```
H1 (types)
 │
 ├── H2 (core) ── depends on H1
 │    │
 │    ├── H3 (manifests) ── depends on H2 (registry interface)
 │    │    │
 │    │    └── H4 (wire into App) ── depends on H3 (modules exist)
 │    │         │
 │    │         └── H5 (analyze tool) ── depends on H4 (sandbox wired)
 │    │
 │    └── H5 (can also start in parallel with H3 if sandbox interface is stable)
 │
 └── H6 (UI updates) ── depends on H1, can run in parallel with H2-H5
```

**Why this beats Path A**: Steps H1-H3 produce ~720 lines of new code with zero risk (no existing files touched). H4 is the only risky step — the surgical integration. Path A has 7 risky steps. The core is small enough that writing it clean is faster than extracting from the existing ball of yarn.

**Why this beats a full rewrite**: The UI is ~3400 lines across 15+ components that all work. Rewriting them buys nothing. Adapting imports and field names is mechanical.

---

### 15.3 Path C: Clean MVP (Minimal Hybrid)

The absolute minimum to prove the module concept works end-to-end. No event bus, no generalized types, no UI changes. Just enough to add a new executor with zero core code changes.

**Best for**: validating the architecture fast before committing to either Path A or B.

**What "works" means for Path C**:
1. A new executor manifest can be dropped into `src/modules/` and the architect sees it
2. The architect routes work to it based on description
3. Everything else runs exactly as it does today

**What changes** (4 files, ~300 lines total):

```
src/core/
  registry.ts       ~60 lines   Minimal: load manifests, return descriptions
  prompt.ts         ~80 lines   composeProgrammerPrompt(registry) only
  sandbox.ts        ~60 lines   Dynamic binding injection from registry

src/modules/
  executor-jules/manifest.json    ~30 lines
  channel-mailbox/manifest.json   ~20 lines
  knowledge-artifacts/manifest.json ~15 lines
```

**What stays exactly as-is**: types.ts, db.ts, App.tsx, all components, JulesNegotiator, UserNegotiator, JulesSessionManager, ProcessAgent, ArtifactTool, RepositoryTool.

**The trick**: the manifests are read-only. The registry loads them and provides description text to the prompt composer. The prompt composer replaces the hardcoded `Orchestrator.runStep()` template (lines 119-146). The sandbox reads `sandboxBindings` from manifests and injects the same functions it always did — but now the mapping comes from the manifest, not from hardcoded `injectAPI` calls.

No types change. No DB schema changes. No UI changes. The `delegateTo: 'local' | 'jules'` still exists in types — but the architect prompt now reads "here are the available executors and their descriptions" from the registry, so a third option gets described to the LLM. The LLM returns `jules` or `local` (or a new name), and the orchestrator maps it to the right module's `execute` tool.

**Clean MVP steps**:

| Step | What | Changes |
|------|------|---------|
| **C1** | Write `registry.ts` — scan `src/modules/*/manifest.json`, load into memory | ~60 lines new |
| **C2** | Write `prompt.ts` — `composeProgrammerPrompt(registry)` replaces hardcoded prompt in Orchestrator.ts:119-146 | ~80 lines new, ~30 lines changed in Orchestrator.ts |
| **C3** | Write `sandbox.ts` — dynamic `injectAPI` loop from registry instead of hardcoded calls in Orchestrator.ts:186-240 | ~60 lines new, ~55 lines changed in Orchestrator.ts |
| **C4** | Write manifests for `executor-jules`, `channel-mailbox`, `knowledge-artifacts` | ~65 lines new (JSON) |

**Total**: ~265 lines new, ~85 lines changed. Two files touched (Orchestrator.ts + new core files). Everything else untouched.

**What C explicitly skips** (that both A and B do):

| Skipped | Why acceptable for validation |
|---------|------------------------------|
| Type generalization | `delegateTo` still `'local' \| 'jules'` — but architect prompt describes N executors. Mismatch between types and prompt is fine for validation. |
| Event bus | Modules still log directly to `jnaLogs`/`unaLogs`. Works today. |
| Worker threads | Main thread. Same as today. |
| `analyze()` | No context forwarding. Same as today. |
| ProcessAgent as module | Stays as-is. Manual trigger only. Same as today. |
| UI changes | No changes. Same labels, same state names. |

**Validation test**: after C1-C4, add `src/modules/executor-dummy/manifest.json` with `description: "Local echo executor. Returns whatever prompt you send."`. Create a task. Check the architect prompt includes the dummy executor's description. The LLM may or may not route to it — that's fine. The point is: **the core doesn't need to change when a new module appears**.

**If Path C succeeds**: you've validated the architecture with minimal risk. Then upgrade to Path B (clean core rewrite) for the full module system.

**If Path C reveals a problem**: you've spent ~300 lines, not 3000. Pivot to Path A or rethink the manifest structure. Low cost of failure.

---

### 15.4 Decision Matrix

| | Path A: Full Migration | Path B: Hybrid Rewrite | Path C: Clean MVP |
|---|---|---|---|
| **New lines** | ~800 (wrappers + stages) | ~720 (core + manifests) | ~265 (core + manifests) |
| **Lines changed** | ~1500 (across 7 stages) | ~250 (App.tsx wire-up + UI) | ~85 (Orchestrator.ts only) |
| **Files touched** | ~20 (every stage touches multiple) | ~10 (core new + targeted surgery) | 2 (Orchestrator.ts + new files) |
| **Risk** | Medium (each stage can break things) | Low-Medium (integration is the only risk point) | Very low (barely touches existing code) |
| **Time to module system** | Longest (7 sequential stages) | Medium (6 steps, core is fast to write) | Shortest (4 steps, days not weeks) |
| **Result quality** | Clean eventually, legacy patterns linger | Clean core, proven shell | Proof of concept only — needs Path B after |
| **Event bus** | Stage 5 | Day 1 | Skipped |
| **Worker threads** | Stage 3 | Post-MVP | Skipped |
| **`analyze()` context** | Stage 2 extension | Step H5 | Skipped |
| **Generalized types** | Stage 4 | Step H1 | Skipped |
| **UI decoupled** | Stage 4 | Step H6 | No |

**Recommended sequence**: Path C first (validate architecture in days). If it works, Path B for production quality. Path A only if Path C reveals that the current code structure is actually fine and you just need manifests on top.
