# Test Suite: knowledge-kb, process-dream, process-reflection

## Setup

**File**: `src/__tests__/modules.test.ts`
**Runner**: `npx vitest run` (uses `fake-indexeddb/auto` via `src/__tests__/setup.ts`)
**Result**: 42 tests, all passing, ~300ms

### Test infrastructure

```typescript
// Factory: builds a KBEntry with sensible defaults, override anything
makeEntry({ text: 'some error', tags: ['task-1'], category: 'error' })

// Mock context: fake RequestContext with a stubbed llmCall
mockContext('LLM response string')

// beforeEach: wipes all IndexedDB tables so tests are isolated
```

No real LLM calls — all `llmCall` invocations return a controlled string. This makes tests deterministic and fast.

---

## Test Breakdown

### 1. `applyRules` (10 tests)

Tests the pure reflection rule engine in `process-reflection/rules.ts`. No DB involved — just pass arrays of `KBEntry` and check which rules fire.

| Test | What it verifies |
|---|---|
| Rule 1 fires (≥3 same error, ≥2 tasks) | 3 entries with identical first-60-chars across task-1/2/3 → `SAME-ERROR DIFFERENT-TASK` fires, creates self-task |
| Rule 1 negated (1 task only) | 3 identical errors but all on task-1 → rule does NOT fire (need cross-task evidence) |
| Rule 1 negated (<3 occurrences) | 2 identical errors across 2 tasks → rule does NOT fire (threshold=3) |
| Rule 2 fires (constitution errors) | 2 errors tagged `constitution` on `target` → `CONSTITUTION-VIOLATION` fires |
| Rule 2 ignores self-project | Same setup but `project: 'self'` → rule does NOT fire (agent blaming itself is circular) |
| Rule 3 fires (executor failures) | 3 errors tagged `executor-local` → `RECURRING-PROTOCOL-FAILURE` fires |
| Rule 4 fires (user correction) | User correction entry shares a tag with an error → `USER-CORRECTION` fires, no self-task |
| Rule 5 fires (known gap) | Error shares tag with a `gap`-tagged observation → `KNOWN-GAP` fires, no reclassify |
| No rules match | 2 unique errors, no patterns → empty results |
| Multiple rules fire | 3 same errors across tasks, all on same executor → both Rule 1 AND Rule 3 fire |

**Why these matter**: The rules decide when the agent admits fault. False positives mean the agent blames itself for user bugs. False negatives mean it never self-corrects. The negation tests guard the thresholds.

---

### 2. `ReflectionHandler` (7 tests)

End-to-end tests for the `process-reflection.reclassify` tool. Uses real IndexedDB (fake-indexeddb), seeds entries, calls the handler, checks DB state.

| Test | What it verifies |
|---|---|
| No matching errors | Seeds an `observation` (not `error`) → reclassify returns 0, nothing changes |
| Skips inactive entries | Seeds 3 matching errors but `active: false` → reclassify returns 0 (deleted entries ignored) |
| Reclassifies to "self" | 3 same errors across 3 tasks → project changed from `target` to `self` in DB |
| Appends reflection entry | After reclassification → a `correction` entry is logged with `source: 'dream:session'` and `project: 'self'` |
| Creates self-task | Rule with `createSelfTask: true` → a task with `project: 'self'` and title containing `[self]` appears in DB |
| entryIds filtering | Pass `entryIds: [1]` → only entry #1 is considered (too few to trigger rules → 0 reclassified) |
| Unknown tool rejection | Pass bogus tool name → throws "Unknown tool" |

**Why these matter**: The handler ties together rules + DB mutations. These tests verify the full write pipeline: rule matches → entries reclassified → reflection logged → self-task created. The `entryIds` test confirms scoped reclassify works (important for partial runs).

---

### 3. `DreamHandler` (8 tests)

Tests all 3 dream levels. Uses real IndexedDB with mock LLM calls.

| Test | What it verifies |
|---|---|
| Unknown tool rejection | Bogus tool name → throws |
| **microDream** consolidation | Seeds 4 raw entries tagged `task-42` → LLM summarizes → creates 1 `dream:micro` entry at abstraction 5, originals deactivated |
| **microDream** skip (<3) | Only 1 entry → skips, LLM never called |
| **sessionDream** pattern extraction | Seeds 5 execution + 1 micro-dream entries → mock LLM returns JSON with patterns/failures/strategies/gaps → verifies 1 of each category written to DB |
| **sessionDream** early return | Empty DB → returns "no active entries", LLM never called |
| **sessionDream** malformed JSON | LLM returns garbage string → parser falls back to empty arrays, no crash |
| **deepDream** pruning | Seeds: 3 old raw entries (8 days ago, abstraction 1) + 1 recent + 1 old but high-abstraction → old raw entries deactivated, others survive |
| **deepDream** amendment positive | LLM response includes amendment text → `constitution` entry created with `project: 'self'` |
| **deepDream** amendment negative | LLM says "No amendments needed" → no constitution entry created |

**Why these matter**: Dreams are the agent's learning mechanism. The malformed-JSON test prevents a bad LLM response from crashing the dream cycle. The pruning test ensures raw data is cleaned up but insights are preserved. The amendment tests verify the constitution can evolve but doesn't change unnecessarily.

---

### 4. `KBHandler` (14 tests)

Tests the CRUD layer for `kbLog` and `kbDocs`. Pure DB operations, no LLM involved.

| Test | What it verifies |
|---|---|
| Unknown tool rejection | Bogus tool name → throws |
| **recordEntry** basic | Creates entry, verifies it's in DB with correct defaults (`active: true`, `project: 'target'`) |
| **recordEntry** project param | Explicit `project: 'self'` → respected |
| **queryLog** by category | 3 entries (2 errors, 1 pattern) → filter by `error` → returns 2 |
| **queryLog** by active | 1 active + 1 inactive → `active: true` returns 1, `active: false` returns 1 |
| **queryLog** by tags | Tags: [react,frontend], [backend,api], [react,backend] → filter `['react']` → returns 2 (any-match) |
| **queryLog** by source | execution vs dream:micro → filter works |
| **queryLog** by layer | [L0], [L0,L1], [L2] → filter `L1` → returns only [L0,L1] (includes check) |
| **queryLog** limit | 10 entries, limit 3 → returns 3 |
| **queryLog** sort order | Entries at abstraction 1/9/5 → sorted desc by abstraction (9, 5, 1) |
| **updateEntries** | Changes text and tags on existing entry |
| **saveDocument** create | New doc → version 1, returns ID |
| **saveDocument** upsert | Same title, same project → updates in place, version bumps to 2 |
| **saveDocument** project isolation | Same title, different project → creates separate docs (different IDs) |
| **queryDocs** multi-filter | 3 docs (2 specs + 1 design, mixed projects/tags) → filter by type, project, and tags individually |
| **queryDocs** excludes inactive | Active + inactive doc → only active returned |

**Why these matter**: KBHandler is the data layer everything else depends on. The upsert test catches a real bug we fixed — `kbDocs` was missing a `title` index, so `.where('title').equals()` would throw `SchemaError` in production. The project-isolation test ensures `target` and `self` knowledge never leaks between scopes.

---

## Running

```bash
# All module tests
npx vitest run src/__tests__/modules.test.ts

# Watch mode
npx vitest src/__tests__/modules.test.ts

# Full suite (includes other test files)
npx vitest run
```

## Bug caught during test development

Test 3 failures (`saveDocument` upserts) revealed that `kbDocs` was missing a `title` index in the Dexie schema. The handler uses `.where('title').equals()` for upsert lookups, which requires the field to be indexed. Fixed by adding `title` to the index in schema v21 (`src/services/db.ts`).
