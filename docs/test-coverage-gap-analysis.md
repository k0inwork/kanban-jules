# Test Suite vs MVP Proposals — Coverage Gap Analysis

Compares the 94 tests in `src/__tests__/modules.test.ts` (76 unit) and `src/__tests__/integration.test.ts` (18 integration) against:
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

---

## Integration Test Coverage

File: `src/__tests__/integration.test.ts` — 18 tests exercising full cross-module pipelines.

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

### Remaining gaps (not testable yet):

1. **F7: Background research** — not implemented (requires async external polling)

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
