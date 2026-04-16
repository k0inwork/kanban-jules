# Test Suite vs MVP Proposals — Coverage Gap Analysis

Compares the 42 tests in `src/__tests__/modules.test.ts` against:
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
| `queryLog` — filter by project | self-healing §3.1 | **No** | — |
| `queryLog` — limit | self-healing §3.1 | **Yes** | 1 test |
| `queryLog` — sort (abstraction DESC, timestamp DESC) | self-healing §3.1 | **Yes** | 1 test |
| `updateEntries` — bulk update | self-healing §3.1 | **Yes** | 1 test |
| `saveDocument` — create new | self-healing §3.1 | **Yes** | 1 test |
| `saveDocument` — upsert by title+project | self-healing §3.1 | **Yes** | 1 test |
| `saveDocument` — project isolation | self-healing §3.1 | **Yes** | 1 test |
| `queryDocs` — multi-filter (type, project, tags) | self-healing §3.1 | **Yes** | 1 test |
| `queryDocs` — excludes inactive | self-healing §3.1 | **Yes** | 1 test |
| `queryDocs` — filter by source | self-healing §3.1 | **No** | — |
| `queryDocs` — filter by layer | self-healing §3.1 | **No** | — |
| `queryDocs` — limit | self-healing §3.1 | **No** | — |
| Sandbox bindings (KB.record, KB.queryLog, etc.) | self-healing §3.1 manifest | **No** | — |
| Convenience writers (recordExecution, etc.) | self-healing §3.3 | **No** | Not implemented yet |

**Coverage: 14/20 tested (70%)**

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
| `microDream` — union of tags | self-healing §5.3 | **No** | — |
| `microDream` — supersedes field | self-healing §5.3 | **No** | — |
| `microDream` — executor outcome recording | self-healing §5.3 | **No** | — |
| `sessionDream` — pattern extraction | self-healing §5.3 | **Yes** | 1 test |
| `sessionDream` — failure extraction | self-healing §5.3 | **Yes** | Verified in pattern test |
| `sessionDream` — strategy extraction | self-healing §5.3 | **Yes** | Verified in pattern test |
| `sessionDream` — doc gap flagging | self-healing §5.3 | **Yes** | Verified in pattern test |
| `sessionDream` — early return (no entries) | self-healing §5.3 | **Yes** | 1 test |
| `sessionDream` — malformed JSON handling | self-healing §5.3 | **Yes** | 1 test |
| `sessionDream` — calls reflection for reclassification | self-healing §5.3 Phase 3 | **No** | sessionDream doesn't call reflection in current impl |
| `sessionDream` — deactivates superseded entries | self-healing §5.3 Phase 4 | **No** | — |
| `deepDream` — strategic insight | self-healing §5.3 | **Yes** | 1 test |
| `deepDream` — pruning old raw entries | self-healing §5.3 Phase 5 | **Yes** | 1 test |
| `deepDream` — constitution amendment (positive) | self-healing §5.3 Phase 4 | **Yes** | 1 test |
| `deepDream` — constitution amendment (negative) | self-healing §5.3 Phase 4 | **Yes** | 1 test |
| `deepDream` — gap resolution via external | self-healing §5.3 Phase 3 | **No** | Stubs return available()=false |
| `deepDream` — preserves high-abstraction old entries | self-healing §5.3 | **Yes** | Verified in pruning test |
| External KB stubs (available/query) | self-healing §5.4 | **No** | Trivial no-ops |
| Background triggers (onTaskComplete, onBoardIdle) | self-healing §5.5 | **No** | Not implemented yet |

**Coverage: 12/21 tested (57%)**

### process-reflection (1 tool + 5 rules)

| Tool / Behavior | Proposal Spec | Tested? | Tests |
|---|---|---|---|
| Rule 1: SAME-ERROR DIFFERENT-TASK (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 1: negated — single task | self-healing §6.3 | **Yes** | 1 test |
| Rule 1: negated — below threshold | self-healing §6.3 | **Yes** | 1 test |
| Rule 2: CONSTITUTION-VIOLATION (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 2: ignores self-project | self-healing §6.3 | **Yes** | 1 test |
| Rule 3: RECURRING-PROTOCOL-FAILURE (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 3: negated — below threshold | self-healing §6.3 | **No** | — |
| Rule 4: USER-CORRECTION (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 4: negated — no tag overlap | self-healing §6.3 | **No** | — |
| Rule 5: KNOWN-GAP (positive) | self-healing §6.3 | **Yes** | 1 test |
| Rule 5: negated — no matching gap | self-healing §6.3 | **No** | — |
| Multiple rules fire simultaneously | self-healing §6.3 | **Yes** | 1 test |
| No rules match — empty result | self-healing §6.3 | **Yes** | 1 test |
| `reclassify` — no matching errors | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — skips inactive entries | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — changes project to 'self' | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — appends reflection entry | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — creates self-task | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — entryIds filtering | self-healing §6.4 | **Yes** | 1 test |
| `reclassify` — KNOWN-GAP tags but doesn't reclassify | self-healing §6.3 | **No** | — |
| Custom threshold parameter | self-healing §6.2 config | **No** | — |
| Unknown tool rejection | — | **Yes** | 1 test |

**Coverage: 17/22 tested (77%)**

---

## MVP Implementation Steps Coverage

From `mvp-phase0-kb-context.md` §7:

| Step | Component | Implemented? | Tested? |
|---|---|---|---|
| 1 | Dexie schema (kb_log + kb_docs) | **Yes** | Indirect (all tests use it) |
| 2 | KB Writer (convenience functions) | **No** | — |
| 3 | KB Projector (context propagation) | **Yes** | Separate e2e suite (46 assertions) |
| 4 | Hook projection into orchestrator | **Yes** | Not directly tested |
| 5 | Micro-dream | **Yes** | **Yes** (2 tests) |
| 6 | Session-dream | **Yes** | **Yes** (3 tests) |
| 7 | Deep-dream | **Yes** | **Yes** (3 tests) |
| 8 | Document manager | **Yes** (in KBHandler) | **Yes** (3 tests) |
| 9 | Repo scanner | **No** | — |
| 10 | External KB stubs | **Yes** | Not tested (trivial) |

---

## Data Flow Coverage

From `mvp-phase0-kb-context.md` §2.2:

| Flow | From → To | Tested? |
|---|---|---|
| F1 | Execution → kb_log (recording) | **No** — orchestrator integration not tested |
| F2 | kb_log → Yuan L0 projection | **Yes** — e2e projector suite |
| F3 | Yuan → Architect → Executor (narrowing) | **No** — orchestrator integration not tested |
| F4 | kb_docs → Projection (doc injection) | **Yes** — e2e projector suite |
| F5 | Dream → kb_log (consolidation) | **Yes** — modules.test.ts |
| F6 | Dream → External → kb (gap-filling) | **No** — stubs, not testable yet |
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
| Integration tests (orchestrator → module pipeline) | **Not done** |
| Integration — happy path step execution | **Not done** |
| Integration — module failure + retry | **Not done** |
| Integration — GlobalVars persistence | **Not done** |
| Integration — analyze forwarding | **Not done** |

---

## Summary

| Area | Covered | Missing | Coverage |
|---|---|---|---|
| **knowledge-kb** | 14 | 6 (project filter, queryDocs source/layer/limit, sandbox bindings, convenience writers) | **70%** |
| **knowledge-projector** | — | — | **Separate suite** (46 assertions) |
| **process-dream** | 12 | 9 (tags union, supersedes, executor outcome, reflection call, supersede deactivation, external KB, triggers, threshold) | **57%** |
| **process-reflection** | 17 | 5 (rule 3/4/5 negation, KNOWN-GAP tag-only behavior, custom threshold) | **77%** |
| **Implementation steps** | 7/10 | 3 (KB Writer, Repo Scanner, External KB) | **70%** |
| **Data flows** | 3/7 | 4 (recording, narrowing, gap-filling, background research) | **43%** |
| **Integration tests** | 0 | All (orchestrator pipeline, sandbox bindings, retry loops) | **0%** |

### High-priority gaps to close:

1. **queryLog project filter** — currently untested, critical for self/target separation
2. **sessionDream → reflection integration** — proposal says sessionDream Phase 3 calls reflection, current impl doesn't
3. **microDream supersedes + tag union** — key for dream correctness
4. **Integration tests** — the testing strategy doc calls for full orchestrator→module pipeline tests; none exist
5. **Convenience writers** (recordExecution, etc.) — not implemented, so not testable yet
6. **Background triggers** (onTaskComplete, onBoardIdle) — not implemented, so not testable yet
