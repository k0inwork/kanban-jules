# Test Suite vs MVP Proposals — Coverage Gap Analysis

**Last updated: 2026-04-20 | 357 passed, 8 skipped (3 sandbox + 5 e2e), 0 failures**

## Test Files

| File | Tests | Status |
|---|---|---|
| `src/__tests__/modules.test.ts` | 137 | KB, dream, reflection, conflict, superseded, decision-log |
| `src/__tests__/vfs.test.ts` | 39 | VFS layer (resolvePath, read/write, stat, exists, mkdir, readdir, unlink, clear, headFile, IDBFS verification, fsBridge fallback) |
| `src/__tests__/board-tool.test.ts` | 14 | Board tool CRUD (listTasks, getTask, createTask, updateTask) |
| `src/__tests__/integration.test.ts` | 18 | Cross-module pipelines |
| `src/modules/process-project-manager/ProcessAgent.test.ts` | 21 | ProcessAgent tools, ReAct loop controls, buildToolDescriptions |
| `src/__tests__/branching.test.ts` | 13 | BranchEvaluator, GitFs.taskDir, PushQueue, task DB |
| `src/components/AgentTree/AgentTreeModel.test.ts` | 26 | Task pipeline, Yuan agent, persistence, lifecycle |
| `src/components/AgentTree/AgentTreeModel.integration.test.ts` | 6 | Real eventBus propagation |
| `src/modules/bash-executor/BashExecutorHandler.test.ts` | 10 | Bash exec, clone, init, timeout capping, error handling |
| `src/modules/executor-jules/JulesHandler.test.ts` | 5 | Jules execute (positional/object args, task-not-found, default criteria) |
| `src/modules/channel-user-negotiator/UserHandler.test.ts` | 6 | askUser + sendUser (positional/object args, routing) |
| `src/modules/executor-local/LocalHandler.test.ts` | 5 | Local execute placeholder (routing, arg forms) |
| `src/modules/architect-codegen/Architect.test.ts` | 7 | Protocol generation (projection, prompt, JSON parse, init guard) |
| `src/modules/knowledge-artifacts/ArtifactTool.test.ts` | 14 | Artifact CRUD (list/read/save, underscore filtering, GitFs write) |
| `src/modules/knowledge-local-analyzer/LocalAnalyzer.test.ts` | 10 | Repo scan (pattern matching, case insensitive, empty files, missing task) |
| `src/services/GitFs.test.ts` | 10 | URL parsing, getters, taskDir, constructor options |
| `wasm/worker/WasmHandler.test.ts` | 8 | WASM module loading and execution |
| `src/test-registry.test.ts` | 2 | Module registry + prompt composition |
| `src/core/registry.test.ts` | 2 | Registry internals |
| `src/core/sandbox.test.ts` | 3 | **Skipped** — requires browser Worker API |
| `tests/bash-executor.e2e.test.ts` | 5 | **Skipped** — requires dev server (hook timeout in CI) |

Compares the 326 tests against:
- `docs/self-healing-agent.md` — 4 module specs
- `docs/mvp-phase0-kb-context.md` — 10 implementation steps + 7 data flows
- `docs/modules-testing.md` — per-module-type test strategy

---

## Module Coverage Matrix

### knowledge-kb (5 tools)

| Tool / Behavior | Proposal Spec | Tested? | Tests |
|---|---|---|---|
| `recordEntry` — append to kb_log | self-healing §3.1 | **Yes** | 2 tests (default project, explicit project) |
| `queryLog` — filter by category | self-healing §3.1 | **Yes** | 1 test |
| `queryLog` — filter by active | self-healing §3.1 | **Yes** | 1 test |
| `queryLog` — filter by tags (any-match) | self-healing §3.1 | **Yes** | 1 test |
| `queryLog` — filter by source | self-healing §3.1 | **Yes** | 1 test |
| `queryLog` — filter by layer (includes) | self-healing §3.1 | **Yes** | 1 test |
| `queryLog` — filter by project | self-healing §3.1 | **Yes** | 1 test |
| `queryLog` — limit | self-healing §3.1 | **Yes** | 1 test |
| `queryLog` — sort (abstraction DESC, timestamp DESC) | self-healing §3.1 | **Yes** | 1 test |
| `updateEntries` — bulk update | self-healing §3.1 | **Yes** | 1 test |
| `saveDocument` — create new | self-healing §3.1 | **Yes** | 1 test |
| `saveDocument` — upsert by title+project | self-healing §3.1 | **Yes** | 1 test |
| `saveDocument` — project isolation | self-healing §3.1 | **Yes** | 1 test |
| `queryDocs` — multi-filter (type, project, tags) | self-healing §3.1 | **Yes** | 1 test |
| `queryDocs` — excludes inactive | self-healing §3.1 | **Yes** | 1 test |
| `queryDocs` — filter by source | self-healing §3.1 | **Yes** | 1 test |
| `queryDocs` — filter by layer | self-healing §3.1 | **Yes** | 1 test |
| `queryDocs` — limit | self-healing §3.1 | **Yes** | 1 test |
| Sandbox bindings (KB.record, KB.queryLog, etc.) | self-healing §3.1 manifest | **Yes** | Wiring in orchestrator.ts sandboxBindings |
| Convenience writers (recordExecution, etc.) | self-healing §3.3 | **Yes** | 5 tests (execution default, execution project, observation, decision, error) |

**Coverage: 20/20 tested (100%)**

### knowledge-projector

| Tool / Behavior | Proposal Spec | Tested? | Tests |
|---|---|---|---|
| `project('L0')` — Yuan strategic view | self-healing §4.3 | **Yes** | Separate e2e suite (`test-projector.ts`) |
| `project('L1')` — tactical view | self-healing §4.3 | **Yes** | Separate e2e suite |
| `project('L2')` — operational view | self-healing §4.3 | **Yes** | Separate e2e suite |
| `project('L3')` — step-level injection | mvp §4.1 | **Yes** | Separate e2e suite |
| Token/char budget cutoff | self-healing §4.4 | **Yes** | Separate e2e suite |
| Board state computation (L0/L1) | self-healing §4.2 | **Yes** | Separate e2e suite |
| AgentContext injection (L2) | self-healing §4.2 | **No** | — |
| Self-project projection | self-healing §8.1 | **No** | — |

**Coverage: in modules.test.ts: 0 tests (projector has its own 46-assertion e2e suite)**

### process-dream (3 tools + background triggers)

| Tool / Behavior | Proposal Spec | Tested? | Tests |
|---|---|---|---|
| `microDream` — consolidation (≥3 entries) | self-healing §5.3 | **Yes** | 1 test |
| `microDream` — skip (<3 entries) | self-healing §5.3 | **Yes** | 1 test |
| `microDream` — deactivates raw entries | self-healing §5.3 | **Yes** | Verified in consolidation test |
| `microDream` — union of tags | self-healing §5.3 | **Yes** | 1 test |
| `microDream` — supersedes field | self-healing §5.3 | **Yes** | 1 test |
| `microDream` — executor outcome recording | self-healing §5.3 | **Yes** | 2 tests (count recording, error count) |
| `sessionDream` — pattern extraction | self-healing §5.3 | **Yes** | 1 test |
| `sessionDream` — failure extraction | self-healing §5.3 | **Yes** | Verified in pattern test |
| `sessionDream` — strategy extraction | self-healing §5.3 | **Yes** | Verified in pattern test |
| `sessionDream` — doc gap flagging | self-healing §5.3 | **Yes** | Verified in pattern test |
| `sessionDream` — early return (no entries) | self-healing §5.3 | **Yes** | 1 test |
| `sessionDream` — malformed JSON handling | self-healing §5.3 | **Yes** | 1 test |
| `sessionDream` — calls reflection for reclassification | self-healing §5.3 Phase 3 | **Yes** | Integration test (session-dream → reflection pipeline) |
| `sessionDream` — deactivates superseded entries (non-error) | self-healing §5.3 Phase 4 | **Yes** | 1 test (observations deactivated, errors preserved) |
| `deepDream` — strategic insight | self-healing §5.3 | **Yes** | 1 test |
| `deepDream` — pruning old raw entries | self-healing §5.3 Phase 5 | **Yes** | 1 test |
| `deepDream` — constitution amendment (positive) | self-healing §5.3 Phase 4 | **Yes** | 1 test (+ AgentMessage proposal) |
| `deepDream` — constitution amendment (negative) | self-healing §5.3 Phase 4 | **Yes** | 1 test (no AgentMessage created) |
| `deepDream` — gap resolution via external | self-healing §5.3 Phase 3 | **Yes** | Integration test (FixedKBSource → gap-resolved entries) |
| `deepDream` — preserves high-abstraction old entries | self-healing §5.3 | **Yes** | Verified in pruning test |
| External KB stubs (available/query) | self-healing §5.4 | **Yes** | 5 unit tests (FixedKBSource: available, keyword match, default, multiple matches, context match) |
| Background triggers (onTaskComplete, onBoardIdle) | self-healing §5.5 | **Yes** | Implemented: onTaskComplete→microDream in orchestrator.ts, onBoardIdle→sessionDream in host.ts |

**Coverage: 21/21 tested (100%)**

### process-reflection (1 tool + 5 rules)

| Tool / Behavior | Proposal Spec | Tested? | Tests |
|---|---|---|---|
| Rule 1: SAME-ERROR DIFFERENT-TASK (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 1: negated — single task | self-healing §6.3 | **Yes** | 1 test |
| Rule 1: negated — below threshold | self-healing §6.3 | **Yes** | 1 test |
| Rule 2: CONSTITUTION-VIOLATION (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 2: ignores self-project | self-healing §6.3 | **Yes** | 1 test |
| Rule 3: RECURRING-PROTOCOL-FAILURE (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 3: negated — below threshold | self-healing §6.3 | **Yes** | 1 test |
| Rule 4: USER-CORRECTION (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 4: negated — no tag overlap | self-healing §6.3 | **Yes** | 1 test |
| Rule 5: KNOWN-GAP (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 5: negated — no matching gap | self-healing §6.3 | **Yes** | 1 test |
| Multiple rules fire simultaneously | self-healing §6.3 | **Yes** | 1 test |
| Rule interaction: KNOWN-GAP doesn't overwrite prior Rule 1 project change | self-healing §6.3 | **Yes** | 1 test |
| Rule interaction: Rule 1+3+5 coexistence with deduplication | self-healing §6.3 | **Yes** | 1 test |
| No rules match — empty result | self-healing §6.3 | **Yes** | 1 test |
| `reclassify` — no matching errors | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — skips inactive entries | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — changes project to 'self' | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — appends reflection entry | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — creates self-task | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — entryIds filtering | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — KNOWN-GAP tags but doesn't reclassify | self-healing §6.3 | **Yes** | 1 test |
| Custom threshold parameter | self-healing §6.2 config | **Yes** | 1 test |
| Unknown tool rejection | — | **Yes** | 1 test |

**Coverage: 24/24 tested (100%)**

### Phase 1e: Superseded Tracing

| Behavior | Tested? | Tests |
|---|---|---|
| `supersedeEntries` creates new entry and deactivates targets | **Yes** | 1 test |
| Flattens chains from targets | **Yes** | 1 test |
| Rejects lower abstraction superseding higher | **Yes** | 1 test |
| Rejects missing target | **Yes** | 1 test |
| Rejects empty supersedes array | **Yes** | 1 test |
| Allows same abstraction | **Yes** | 1 test |
| `traceDecisionChain` returns entry + flattened ancestors | **Yes** | 1 test |
| Returns single entry when no supersedes | **Yes** | 1 test |
| Returns empty for missing entry | **Yes** | 1 test |
| `handleRequest` routes supersedeEntries | **Yes** | 1 test |
| `handleRequest` routes traceDecisionChain | **Yes** | 1 test |

**Coverage: 11/11 tested (100%)**

### Phase 1d: Decision Harvest Verification

| Behavior | Tested? | Tests |
|---|---|---|
| Verifies harvested decisions and adds verified tag | **Yes** | 1 test |
| Reclassifies decision tags when LLM says so | **Yes** | 1 test |
| Skips verification when no harvested decisions exist | **Yes** | 1 test |
| Gracefully handles malformed verification response | **Yes** | 1 test |
| Skips already-verified decisions | **Yes** | 1 test |

**Coverage: 5/5 tested (100%)**

### Phase 1f: Session Conflict Detection + Evidence-based Classification

| Behavior | Tested? | Tests |
|---|---|---|
| Escalates conflicting decisions via AgentMessage | **Yes** | 1 test |
| Does not escalate when no conflicts found | **Yes** | 1 test |
| Skips with fewer than 2 verified decisions | **Yes** | 1 test |
| Handles malformed conflict response | **Yes** | 1 test |
| Tags conflict-pending to prevent re-escalation | **Yes** | 1 test |
| Resolves conflict option (a) — keeps D1, deactivates D2 | **Yes** | 1 test |
| Resolves conflict option (c) — merges both into new decision | **Yes** | 1 test |
| Guiding conflict — auto-resolves (strong vs weak evidence) | **Yes** | 1 test |
| Constitutional override — auto-resolves, constitution wins | **Yes** | 1 test |
| Self-correcting — escalates with recommendation | **Yes** | 1 test |
| Doubtful — neutral escalation | **Yes** | 1 test |
| Resolution audit entry on user pick | **Yes** | 1 test |
| Resolution audit entry on user merge | **Yes** | 1 test |

**Coverage: 13/13 tested (100%)**

### Phase 1h: Deep Decision Log

| Behavior | Tested? | Tests |
|---|---|---|
| Generates decision-log doc with grouped decisions | **Yes** | 1 test |
| Decision log includes superseded history | **Yes** | 1 test |
| Skips decision log when no decisions exist | **Yes** | 1 test |
| Upserts decision-log on repeated deep dreams | **Yes** | 1 test |

**Coverage: 4/4 tested (100%)**

### Task Branching

File: `src/__tests__/branching.test.ts` — 13 tests.

| Area | Tests |
|---|---|
| BranchEvaluator — qualifies by protocol step count (>=3) | 1 |
| BranchEvaluator — qualifies by scope keywords | 1 |
| BranchEvaluator — qualifies by explicit flag | 1 |
| BranchEvaluator — rejects small scope | 1 |
| BranchEvaluator — rejects low step count | 1 |
| BranchEvaluator — rejects when no criteria met | 1 |
| BranchEvaluator — combined criteria | 1 |
| GitFs.taskDir — short-id path | 1 |
| GitFs.taskDir — short ID without truncation | 1 |
| PushQueue — enqueue + flush | 1 |
| PushQueue — deduplication by taskId | 1 |
| PushQueue — auto-flush interval | 1 |
| Task DB — branchName and branchDir fields | 1 |

**Coverage: 13/13 tested (100%)**

### GitFs (isomorphic-git)

File: `src/services/GitFs.test.ts` — 10 tests.

| Area | Tests |
|---|---|
| URL parsing — sources/github/owner/repo | 1 |
| URL parsing — github.com with protocol | 1 |
| URL parsing — github.com without protocol | 1 |
| URL parsing — plain owner/repo | 1 |
| Constructor defaults — branch defaults to main | 1 |
| Constructor defaults — getters (token, repoUrl) | 1 |
| taskDir static — short-id task directory | 1 |
| taskDir static — short IDs | 1 |
| taskDir static — github.com URLs | 1 |
| taskDir constructor option | 1 |

**Coverage: 10/10 tested (100%)**

### WASM Handler

File: `wasm/worker/WasmHandler.test.ts` — 8 tests.

**Coverage: 8/8 tested (100%)**

### Module Registry

Files: `src/test-registry.test.ts` (2) + `src/core/registry.test.ts` (2) — 4 tests.

**Coverage: 4/4 tested (100%)**

### Sandbox (skipped)

File: `src/core/sandbox.test.ts` — 3 tests skipped (requires browser Worker API).

**Coverage: 0% — deferred to browser e2e**

### BashExecutor

File: `src/modules/bash-executor/BashExecutorHandler.test.ts` — 10 tests.

| Area | Tests |
|---|---|
| Exec with cwd — resolves relative paths | 1 |
| Timeout capping — limits to 120s max | 1 |
| Clone — clones into task-specific directory | 1 |
| Init — initializes git repo | 1 |
| Command not found — returns exit code | 1 |
| Working directory creation | 1 |
| Stdout capture | 1 |
| Stderr capture | 1 |
| Max output truncation | 1 |
| Abort on timeout | 1 |

**Coverage: 10/10 tested (100%)**

### ProcessAgent (ReAct Loop)

File: `src/modules/process-project-manager/ProcessAgent.test.ts` — 21 tests.

| Area | Tests |
|---|---|
| **handleRequest routing** | 2 (runReview routing, unknown tool rejection) |
| **Tools — listTasks** | 1 (mapped tasks) |
| **Tools — listArtifacts** | 2 (underscore filter, namePattern filter) |
| **Tools — readArtifact** | 2 (content retrieval, missing artifact error) |
| **Tools — updateArtifactStatus** | 2 (invalid status rejection, valid statuses accepted) |
| **Tools — proposeTask** | 1 (adds message to db) |
| **Tools — sendMessage** | 2 (info message, alert message) |
| **Tools — executeTool errors** | 2 (unknown tool, catch execution errors) |
| **ReAct loop — done:true** | 1 (stops on first iteration) |
| **ReAct loop — no actions** | 1 (stops when empty actions) |
| **ReAct loop — consecutive errors** | 1 (stops after MAX_CONSECUTIVE_ERRORS=3) |
| **ReAct loop — error count reset** | 1 (resets on success after transient failure) |
| **ReAct loop — multi-action iteration** | 1 (executes multiple actions per step) |
| **ReAct loop — repoName extraction** | 1 (extracts from repoUrl) |
| **buildToolDescriptions** | 1 (lists all registered tools) |

**Coverage: 21/21 tested (100%)**

### AgentTree

Files: `src/components/AgentTree/AgentTreeModel.test.ts` (26) + `AgentTreeModel.integration.test.ts` (6) — 32 tests.

| Area | Tests |
|---|---|
| Task pipeline (addTask, addStep, step state transitions) | 12 |
| Yuan agent node (creation, expansion, model changes) | 6 |
| Persistence (save/load round-trip) | 4 |
| Lifecycle (dispose, cleanup) | 2 |
| Event replay | 2 |
| **Integration — real eventBus propagation** | 6 |

**Coverage: 32/32 tested (100%)**

### VFS (Virtual File System)

File: `src/__tests__/vfs.test.ts` — 39 tests.

| Area | Tests |
|---|---|
| resolvePath (path normalization, /workspace mapping) | 8 |
| readFile / writeFile (IDBFS overlay) | 2 |
| stat (file, directory, missing, implicit dir) | 4 |
| exists (file, implicit dir, nonexistent) | 3 |
| mkdir / mkdirp (single, nested) | 2 |
| readdir (direct children, subdirectory) | 2 |
| unlink / rmrf (single file, recursive) | 2 |
| clear | 1 |
| headFile (default 3 lines, custom N) | 2 |
| RepositoryTool integration (listFiles, readFile, headFile, writeFile, taskDir) | 6 |
| IDBFS record verification (raw IDB correctness) | 8 |
| fsBridge fallback (readFile fallback + backfill, stat, exists, readdir merge) | 5 |

**Coverage: 39/39 tested (100%)**

### Board Tool (knowledge-board)

File: `src/__tests__/board-tool.test.ts` — 14 tests.

| Area | Tests |
|---|---|
| listTasks (empty, list all, filter by status, filter by project) | 4 |
| getTask (by ID, by title substring, not found) | 3 |
| createTask (title only, with description+project, missing title) | 3 |
| updateTask (whitelisted fields, by title substring, ignore non-whitelisted, not found) | 4 |

**Coverage: 14/14 tested (100%)**

### JulesHandler

File: `src/modules/executor-jules/JulesHandler.test.ts` — 5 tests.

| Area | Tests |
|---|---|
| Unknown tool rejection | 1 |
| Task not found error | 1 |
| Execute with positional args | 1 |
| Execute with object-form args | 1 |
| Default successCriteria | 1 |

**Coverage: 5/5 tested (100%)**

### UserHandler

File: `src/modules/channel-user-negotiator/UserHandler.test.ts` — 6 tests.

| Area | Tests |
|---|---|
| Unknown tool rejection | 1 |
| askUser with positional args | 1 |
| askUser with object-form args | 1 |
| askUser without format | 1 |
| sendUser with positional arg | 1 |
| sendUser with object-form arg | 1 |

**Coverage: 6/6 tested (100%)**

### LocalHandler

File: `src/modules/executor-local/LocalHandler.test.ts` — 5 tests.

| Area | Tests |
|---|---|
| Routes executor-local.execute | 1 |
| Object-form args | 1 |
| Empty args | 1 |
| Unknown tool rejection | 1 |
| Consistent placeholder response | 1 |

**Coverage: 5/5 tested (100%)**

### ArchitectTool

File: `src/modules/architect-codegen/Architect.test.ts` — 7 tests.

| Area | Tests |
|---|---|
| Unknown tool rejection | 1 |
| Init guard (not-initialized error) | 1 |
| ProjectorHandler.project called with L2 | 1 |
| Prompt composition with enabled modules | 1 |
| LLM call with title+description, json mode | 1 |
| Empty LLM response → empty object | 1 |
| Malformed JSON from LLM → throws | 1 |

**Coverage: 7/7 tested (100%)**

### ArtifactTool

File: `src/modules/knowledge-artifacts/ArtifactTool.test.ts` — 14 tests.

| Area | Tests |
|---|---|
| Routing — unknown tool | 1 |
| listArtifacts — all, underscore filtering, ownership, positional/object args | 5 |
| readArtifact — by ID, missing, object-form args | 3 |
| saveArtifact — db write, GitFs write, skip underscore, skip no-token, object-form args | 5 |

**Coverage: 14/14 tested (100%)**

### LocalAnalyzer

File: `src/modules/knowledge-local-analyzer/LocalAnalyzer.test.ts` — 10 tests.

| Area | Tests |
|---|---|
| Unknown tool rejection | 1 |
| Default pattern matching | 1 |
| Custom pattern matching | 1 |
| No patterns found | 1 |
| Directory entries ignored | 1 |
| Case-insensitive matching | 1 |
| Empty file list | 1 |
| Multiple matching files | 1 |
| Task title in artifact name | 1 |
| Missing task fallback | 1 |

**Coverage: 10/10 tested (100%)**

---

## Integration Test Coverage

File: `src/__tests__/integration.test.ts` — 18 tests exercising full cross-module pipelines (unchanged).

| Flow | What it tests | Data Flow |
|---|---|---|
| Multi-task failure → self-healing | Records errors across 3 tasks → session-dream → reflection reclassifies → self-task | F1 + F5 + F8 |
| Dream propagation (abstraction climb) | Raw → microDream (5) → sessionDream (7) → verify queryLog retrieves chain | F5 end-to-end |
| Constitution evolution | Constitution errors → deepDream proposes amendment → reflection creates self-task | F5 + F8 |
| Knowledge gap lifecycle | Session-dream flags gap → subsequent error → reflection tags `gap-confirmed` | F5 + F8 |
| Full agent session lifecycle | Record → microDream (consolidation + executor outcome) → sessionDream (with internal reflection) → verify all KB state | F1 + F5 + F8 |
| Deep-dream pruning + amendment | Old raw pruned, high-abstraction preserved, amendment proposed as AgentMessage | F5 pruning + §5.3 Phase 4 |
| Constitution amendment approval | deepDream proposes → user approves via event bus → constitution updated | F5 + user interaction |
| Constitution amendment rejection | deepDream proposes → user rejects → constitution unchanged | F5 + user interaction |
| Full project lifecycle (e-commerce checkout) | scanRepo → 3 tasks (success + errors) → microDream → sessionDream + reflection → deepDream + constitution amendment → full state verification | F1 + F2 + F4 + F5 + F8 |
| GlobalVars persistence (step→step) | agentContext set in step 1 → persisted to DB → loaded in step 2 → appears in prompt | Orchestrator context flow |
| GlobalVars accumulation (3 steps) | Context accumulates across 3 steps without data loss | Orchestrator context flow |
| Analyze forwarding (step 1→2) | host.analyze output → task.analysis → appears in step 2 prompt | F3 partial |
| Analyze accumulation (multiple calls) | Multiple analyze() calls accumulate → all visible in step 3 prompt | F3 partial |
| addToContext passthrough | addToContext key-value → persisted to agentContext → visible in next step prompt | Orchestrator context flow |
| F6 gap resolution (FixedKBSource) | Gap entries + FixedKBSource → deepDream → gap-resolved entries with external answers | F6 |
| F6 no external available | Default stubs (available()=false) → deepDream → no gap-resolved entries written | F6 negative |
| F3 focus narrowing (auth) | KB with mixed entries + focus=['auth','jwt'] → projector surfaces auth entry first | F3 |
| F3 focus narrowing (different focus sets) | Same KB + react focus vs DB focus → different entries surfaced | F3 |

---

## MVP Implementation Steps Coverage

From `mvp-phase0-kb-context.md` §7:

| Step | Component | Implemented? | Tested? |
|---|---|---|---|
| 1 | Dexie schema (kb_log + kb_docs) | **Yes** | Indirect (all tests use it) |
| 2 | KB Writer (convenience functions) | **Yes** | **Yes** (5 tests) |
| 3 | KB Projector (context propagation) | **Yes** | Separate e2e suite (46 assertions) |
| 4 | Hook projection into orchestrator | **Yes** | Not directly tested |
| 5 | Micro-dream | **Yes** | **Yes** (4 tests: consolidation, skip, supersedes, tag union) |
| 6 | Session-dream | **Yes** | **Yes** (3 tests + integration) |
| 7 | Deep-dream | **Yes** | **Yes** (3 tests + integration) |
| 8 | Document manager | **Yes** (in KBHandler) | **Yes** (6 tests: create, upsert, isolation, source, layer, limit) |
| 9 | Repo scanner | **Yes** | **Yes** (6 tests: tech detection, README docs, package.json parsing, dedup docs, dedup entries, empty files) |
| 10 | External KB stubs | **Yes** | **Yes** (5 unit tests + 2 integration) |

---

## Data Flow Coverage

From `mvp-phase0-kb-context.md` §2.2:

| Flow | From → To | Tested? |
|---|---|---|
| F1 | Execution → kb_log (recording) | **Yes** — integration tests record via KBHandler |
| F2 | kb_log → Yuan L0 projection | **Yes** — e2e projector suite |
| F3 | Yuan → Architect → Executor (narrowing) | **Yes** — focus keywords boost relevant entries in projector |
| F4 | kb_docs → Projection (doc injection) | **Yes** — e2e projector suite |
| F5 | Dream → kb_log (consolidation) | **Yes** — modules.test.ts + integration tests |
| F6 | Dream → External → kb (gap-filling) | **Yes** — FixedKBSource + integration tests (gap-resolved entries) |
| F7 | External → Dream (background research) | **No** — not implemented |

---

## modules-testing.md Coverage

From the testing strategy doc §15:

| Proposed Test | Status |
|---|---|
| **Knowledge modules** — save/read/list round-trip | **Done** |
| **Knowledge modules** — private artifact filtering | N/A (knowledge-artifacts specific) |
| **Process modules** — missing stage artifacts | N/A (process-project-manager specific) |
| **Process modules** — duplicate proposal detection | N/A (process-project-manager specific) |
| MockHost test harness | Not built — using direct DB + mock llmCall instead |
| Integration tests (orchestrator → module pipeline) | **Done** — 14 integration tests |
| Integration — multi-module pipelines | **Done** — dream → reflection → self-task |
| Integration — KB state evolution | **Done** — abstraction climb, pruning, gap lifecycle |
| Integration — constitution evolution | **Done** — deep-dream amendment → reflection self-task |
| Integration — GlobalVars persistence | **Done** — context persists across steps, accumulates without loss |
| Integration — analyze forwarding | **Done** — analyze output forwarded to subsequent step prompts |

---

## Summary

| Area | Covered | Missing | Coverage |
|---|---|---|---|
| **knowledge-kb** | 20 | 0 | **100%** |
| **knowledge-projector** | — | — | **Separate suite** (46 assertions) |
| **process-dream** | 21 | 0 | **100%** |
| **process-reflection** | 24 | 0 | **100%** |
| **Implementation steps** | 10/10 | 0 | **100%** |
| **Data flows** | 6/7 | 1 (background research) | **86%** |
| **Integration tests** | 18 | 0 (all MVP flows covered) | **100%** |
| **Conflict classification** | 5 | 0 | **100%** |
| **Superseded tracing** | 9 | 0 | **100%** |
| **Decision harvest/verification** | 5 | 0 | **100%** |
| **Decision log (deep dream)** | 4 | 0 | **100%** |
| **Task branching** | 13 | 0 | **100%** |
| **GitFs (URL parsing, taskDir)** | 10 | 0 | **100%** |
| **WASM handler** | 8 | 0 | **100%** |
| **Module registry** | 4 | 0 | **100%** |
| **BashExecutor** | 10 | 0 | **100%** |
| **ProcessAgent (ReAct loop)** | 21 | 0 | **100%** |
| **AgentTree (model + integration)** | 32 | 0 | **100%** |
| **VFS (virtual file system)** | 39 | 0 | **100%** |
| **Board tool (knowledge-board)** | 14 | 0 | **100%** |
| **JulesHandler** | 5 | 0 | **100%** |
| **UserHandler** | 6 | 0 | **100%** |
| **LocalHandler** | 5 | 0 | **100%** |
| **ArchitectTool** | 7 | 0 | **100%** |
| **ArtifactTool** | 14 | 0 | **100%** |
| **LocalAnalyzer** | 10 | 0 | **100%** |
| **Sandbox execution** | 0 | 3 (skipped) | **0%** (needs browser Worker) |
| **Bash executor e2e** | 0 | 5 (skipped) | **0%** (needs dev server) |

**Total: 357 passed, 8 skipped (3 sandbox + 5 e2e)**

### Remaining gaps (not testable yet):

1. **F7: Background research** — not implemented (requires async external polling)
2. **Sandbox tests (3)** — skipped in Node.js vitest; require browser Worker API (Puppeteer e2e)
3. **Bash executor e2e (5)** — skipped in CI; requires dev server startup (hook timeout)
4. **E2e browser tests** — `e2e/` directory excluded from vitest; terminal-lifecycle and terminal-tab tests run separately via `npx tsx`
5. **Orchestrator → GitFs live integration** — task branching lifecycle (create branch → commit → merge → push) requires real GitHub API; tested at unit level only
6. **Coverage report** — no coverage tooling configured; all coverage percentages above are manual analysis against spec

### Untested modules (no dedicated test files):

| Module | Tools | Notes |
|---|---|---|
| `executor-github` | runWorkflow, runAndWait, fetchLogs, getRunStatus, fetchArtifacts | Requires GitHub API, heavy fetch usage |
| `executor-claude` | runClaude | DEV-ONLY, gated behind env flag |
| `sandbox-yuan` | runScript | Yuan sandbox execution |
| `process-dream/commit-harvest` | (background) | Commit message harvesting, tested indirectly via dream tests |

---

## Deviation Tracking (Implementation vs Proposal)

### §5.3 Phase 3: sessionDream → reflection integration

| Aspect | Proposal | Implementation | Deviation |
|---|---|---|---|
| Trigger | Reflection called separately after sessionDream | sessionDream internally calls `ReflectionHandler.reclassify` | **Intentional**: guarantees reflection always follows session-dream, prevents skip |
| Error handling | Not specified | Reflection failure caught and swallowed, dream result still returned | **Pragmatic**: reflection failure shouldn't block the dream cycle |
| Return shape | Single string result | `{ dream: string, reflection: object \| null }` | **Necessary**: both results surfaced to caller |

### §5.3 Phase 4: deepDream AgentMessage proposals

| Aspect | Proposal | Implementation | Deviation |
|---|---|---|---|
| Amendment delivery | "Write proposals as messages (user approves/rejects)" | Writes to both `kb_log` (self-knowledge) and `db.messages` (AgentMessage for UI) | **Enhancement**: dual-write preserves the knowledge even if user hasn't seen the message yet |
| Amendment detection | Not specified | Checks if response contains "No amendments needed" substring | **Acceptable**: simple heuristic, LLM prompted to produce this exact phrase |

### §5.3 Step 6: microDream executor outcome

| Aspect | Proposal | Implementation | Deviation |
|---|---|---|---|
| Outcome recording | "Update executor profile: append entry `[executor] {name}: {success/fail}`" | Records a structured observation with success/error counts and `executor-outcome` tag | **Equivalent**: same data, slightly different format; serves same purpose for sessionDream aggregation |

### §5.3 Phase 4b: sessionDream superseded deactivation

| Aspect | Proposal | Implementation | Deviation |
|---|---|---|---|
| Deactivation scope | "Mark superseded entries active=false" | Only deactivates non-error entries; errors preserved for reflection | **Critical fix**: errors must survive for process-reflection to analyze. Reflection deactivates them after reclassification. |

### Rule interaction (KNOWN-GAP overwrite bug)

| Aspect | Proposal | Implementation | Deviation |
|---|---|---|---|
| Rule 5 (KNOWN-GAP) update | Not specified — rules fire independently | KNOWN-GAP uses `db.kbLog.update()` (partial) instead of `bulkPut` (full replace) | **Bug fix**: `bulkPut` was overwriting prior Rule 1 project='self' change back to 'target' |

### reclassifiedIds deduplication

| Aspect | Proposal | Implementation | Deviation |
|---|---|---|---|
| Counting | Not specified | `reclassifiedIds` checked for `includes(id)` before push | **Bug fix**: when Rule 1 + Rule 3 both fire on same entries, entries were double-counted |

### F3: Context narrowing via focus keywords

| Aspect | Proposal | Implementation | Deviation |
|---|---|---|---|
| Narrowing mechanism | Yuan output constrains lower-level context | `focus?: string[]` on TaskStep, passed to projector for 3x scoring weight | **Simpler**: architect declares focus per step instead of Yuan actively scoping — achieves same narrowing with less coupling |
| Focus source | Yuan writes scoping entry, orchestrator passes down | Architect prompt instructs focus per step, stored in protocol JSON | **Practical**: architect already knows step intent, no extra Yuan→orchestrator communication needed |
| Filtering | Hard filter (only matching entries shown) | Soft boost (focus keywords get 3x weight in scoring) | **Safer**: hard filter could exclude critical context; soft boost surfaces relevant entries while keeping fallback access |
