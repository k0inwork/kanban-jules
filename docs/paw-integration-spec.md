# PAW Integration Specification

> ProgramAsWeights (PAW) compiles natural-language specs into LoRA adapters on GPT-2 124M, running locally in the browser via WASM. After a one-time ~100s compile, inference is free and takes ~50-200ms. This spec maps where PAW can replace repetitive LLM calls in the Agent Kanban system.

## Architecture

```
PAW Program Registry (browser-side, cached in IndexedDB via Cache API)
├── static/        (pre-compiled, ship with app — 0s startup)
│   ├── signal-noise          # Jules message classification
│   ├── jules-activity-type   # What does this activity contain?
│   ├── kb-category-tagger    # Auto-classify KB entries
│   ├── conflict-severity     # Rate conflict urgency
│   ├── error-fingerprint     # Normalize error messages
│   └── relevance-score       # Score KB entry relevance to task
│
├── dynamic/       (compiled on-demand, cached by spec hash)
│   ├── verify:{hash(criteria)}      # Does output meet task criteria?
│   ├── validate:{hash(format)}      # Does user reply match format?
│   ├── extract:{hash(outputType)}   # Extract structured data from Jules output
│   └── relevance:{hash(context)}    # Is this KB entry relevant?
```

**Key distinction:**
- **Static programs** have specs that never change. Compiled once, shipped as pre-built PAW programs (like `email-triage-browser`). Zero startup cost.
- **Dynamic programs** have specs that depend on runtime context (user criteria, format descriptions). Compiled in parallel with work. Cached by spec hash so repeated patterns become de-facto static after first compile.

**Compile timing:** Dynamic programs are kicked off when work starts. The ~100s compile runs concurrently with Jules execution or user reply time, so by the time the result is needed, the program is ready.

---

## Static Programs

### S1. `signal-noise`

| Field | Value |
|-------|-------|
| **Replaces** | `JulesPostman.ts:134` — LLM call every 5s poll on every `agentMessaged` activity |
| **Spec** | "Classify agent message as SIGNAL (asking question, done, needs feedback) or NOISE (progress report, status update)" |
| **Input** | Jules agent message text |
| **Output** | `SIGNAL` or `NOISE` |
| **Volume** | 1 LLM call per 5s poll per active Jules task. Highest ROI in the entire app. |
| **File** | `src/modules/executor-jules/JulesPostman.ts:134` |

Current prompt (from `JulesPostman.ts`):
```
"Classify this message from a remote coding agent as SIGNAL or NOISE. SIGNAL: asking a question, requesting feedback, or finished task. NOISE: just reporting progress, status update, or intermediate step. Message: {content} Return only SIGNAL or NOISE."
```

This is a textbook PAW use case: fixed spec, binary output, high frequency, short input.

---

### S2. `jules-activity-classify`

| Field | Value |
|-------|-------|
| **Replaces** | Nothing — this is a **new capability** |
| **Spec** | "Given a Jules activity JSON, classify what it contains. Return comma-separated tags from: has_git_diff, has_bash_output, has_plan, has_question, has_completion, has_error" |
| **Input** | Raw activity JSON string |
| **Output** | Comma-separated tags |
| **Volume** | Every Jules activity (same cadence as Postman poll) |
| **File** | `src/modules/executor-jules/JulesPostman.ts:161` |

**Why this matters:** Currently `JulesPostman.ts:161` does `JSON.stringify(activity)` into a system message and nothing ever reads it. Jules activities carry rich structured data — git diffs (`changeSet.unidiffPatch`), bash output (`bashOutput`), plan steps — all invisible to the system. This program makes that data parseable without LLM calls.

With this in place, Postman can route:
- Activities with `has_git_diff` → extract file paths → store as artifact
- Activities with `has_bash_output` → extract errors → match against KB
- Activities with `has_plan` → already handled, but verify plan matches task spec
- Activities with `has_error` → immediate escalation

---

### S3. `kb-entry-categorize`

| Field | Value |
|-------|-------|
| **Replaces** | `dream-levels.ts:80-150` (`verifyDecisions`) — LLM classifies harvested decisions |
| **Spec** | "Classify a knowledge base entry as one of: architectural, api, dependency, performance, security, ux, testing, devops, or other" |
| **Input** | KB entry text |
| **Output** | Single category label |
| **Volume** | Every commit-harvest + every microDream consolidation |
| **File** | `src/modules/process-dream/dream-levels.ts:80` |

---

### S4. `error-fingerprint`

| Field | Value |
|-------|-------|
| **Augments** | `process-reflection/rules.ts:13-130` — Rule 1 checks for recurring errors across 3+ tasks |
| **Spec** | "Given an error message, return a normalized error fingerprint — the error type without variable details like file paths, line numbers, timestamps, or specific values" |
| **Input** | Error message text |
| **Output** | Normalized fingerprint string |
| **Volume** | Every error KB entry creation |
| **File** | `src/modules/process-reflection/rules.ts:13` |

**Why this matters:** Rule 1 currently does naive string comparison to detect recurring errors. `"Connection timeout to db after 30s"` and `"Connection timeout to redis after 60s"` are treated as different errors. PAW would normalize both to something like `connection_timeout` — making reflection rules much more effective without LLM calls.

---

### S5. `relevance-score`

| Field | Value |
|-------|-------|
| **Augments** | `knowledge-projector/Handler.ts:244-276` — `projectExperience` uses keyword scoring |
| **Spec** | "Rate how relevant this knowledge entry is to the described task. Return a single number from 1 to 10." |
| **Input** | `KB entry text` + `Task description` (joined with separator) |
| **Output** | Number 1-10 |
| **Volume** | ~50-100 entries per task injection |
| **File** | `src/modules/knowledge-projector/Handler.ts:244` |

**Why this matters:** This is the single biggest quality lever. What context the agent receives determines task success. Current keyword matching misses semantic similarity. PAW runs on ~50-100 entries per task injection, each a simple scoring call.

---

## Dynamic Programs

### D1. `verify:{hash(successCriteria)}`

| Field | Value |
|-------|-------|
| **Replaces** | `JulesNegotiator.ts:138` (progress verify) + `JulesNegotiator.ts:296` (final verify) |
| **Spec template** | "Verify if the following output meets these success criteria: {successCriteria}. Return true or false." |
| **Input** | Jules output text |
| **Output** | `true` or `false` |
| **Trigger** | Compiled when task enters orchestrator, ready by the time Jules finishes (~100s compile ≈ ~100s Jules runtime) |
| **Cache key** | `hash(successCriteria)` — same criteria across tasks reuses compiled program |
| **Volume** | 2-4 LLM calls per Jules session |
| **Files** | `src/services/negotiators/JulesNegotiator.ts:138, 296` |

---

### D2. `extract:{hash(extractionSpec)}`

| Field | Value |
|-------|-------|
| **Replaces** | Nothing — **new capability**. Currently Jules outputs are opaque JSON dumps. |
| **Spec templates** | See examples below |
| **Trigger** | Compiled when Jules session starts, ready by first poll response |
| **Cache key** | `hash(extractionSpec)` |
| **Volume** | Per Jules activity with extractable data |
| **File** | `src/modules/executor-jules/JulesPostman.ts:130-132` |

**Spec template examples:**
- "Extract all changed file paths from this git diff" → file path list
- "Extract the PR URL from this output" → URL string
- "Extract error messages from this bash output" → error text
- "Summarize what files were changed and how" → structured summary

This program, combined with S2, turns Jules from a "black box that returns text" into a structured data pipeline.

---

### D3. `validate:{hash(format)}`

| Field | Value |
|-------|-------|
| **Replaces** | `UserNegotiator.ts:109` — validates user reply matches format |
| **Spec template** | "Does the following text match this format: {format}. Return true or false." |
| **Input** | User reply text |
| **Output** | `true` or `false` |
| **Trigger** | Compiled when askUserFor is called. If user takes 30s+ to reply, program is ready. |
| **Cache key** | `hash(format)` — recurring askUserFor patterns become de-facto static |
| **Volume** | 1 LLM call per askUserFor with format validation |
| **File** | `src/services/negotiators/UserNegotiator.ts:109` |

---

## Statistical Analysis (New Capabilities)

### SA1. Jules Output Mining

**Current state:** All Jules activities → `JSON.stringify(activity)` → opaque system message in `db.messages`. Git diffs, bash output, test results — all invisible.

**With PAW pipeline:** Run S2 (`jules-activity-classify`) on every incoming activity, then route:

| Activity Tag | Action | PAW Program |
|-------------|--------|-------------|
| `has_git_diff` | Extract changed file paths → store as artifact → feed to `projectExperience` | D2 (dynamic) |
| `has_bash_output` | Extract errors → S4 (`error-fingerprint`) → match against KB | D2 + S4 |
| `has_plan` | Verify plan aligns with task spec | D1 (dynamic) |
| `has_error` | Immediate escalation to user | S1 (already SIGNAL) |
| `has_question` | Route to user immediately | S1 (already SIGNAL) |

**Result:** Every Jules session produces structured knowledge instead of a raw JSON dump. Future tasks benefit from the extracted file paths, error patterns, and decisions.

---

### SA2. KB Entry Cross-Referencing

**Current state:** `sessionDream` (`dream-levels.ts:152`) runs after 5-min idle timer, uses LLM to find cross-task patterns. Expensive and infrequent.

**With PAW:** When a new KB entry is created, run S5 (`relevance-score`) against recent entries from other tasks. High-relevance pairs get tagged for `sessionDream` to consolidate.

**This makes the dream pipeline reactive instead of timer-based.** Instead of waiting for idle to discover patterns, patterns are flagged as they emerge.

---

### SA3. Escalation Pattern Mining

**Current state:** Yuan chat transcripts (`type:'yuan-chat'` artifacts) are stored but never analyzed. They contain the richest user thinking in the system — actual conversations about scope, decisions, preferences.

**With PAW:** Compile a dynamic program per chat objective:
- "What decisions were made in this conversation?" → extract decisions → feed into KB as `category:decision`
- "What user preferences were expressed?" → extract preferences → feed into constitution
- "What questions remain unresolved?" → flag for `watchdogDream`

---

### SA4. Message Correspondence Checking

**Concept:** When a message arrives (from Jules, user, or agent), check if it corresponds to or contradicts existing KB entries.

**Implementation:** For each incoming message, score against active KB entries using S5 (`relevance-score`). High-relevance + contradictory content = potential conflict → escalate to `detectConflicts` in `dream-levels.ts:260`.

This catches cases like:
- Jules reports success but KB has an error entry saying the approach doesn't work
- User says "always use TypeScript" but a KB decision logged "use JavaScript for scripts"
- Agent proposes architecture that conflicts with a past architectural decision

---

## Integration Points

Exact file locations and line numbers for all replacements:

| ID | File | Line | Current Implementation | PAW Program | Type |
|----|------|------|----------------------|-------------|------|
| S1 | `src/modules/executor-jules/JulesPostman.ts` | 134 | LLM SIGNAL/NOISE classification | `signal-noise` | static |
| S2 | `src/modules/executor-jules/JulesPostman.ts` | 161 | `JSON.stringify(activity)` dump | `jules-activity-classify` + D2 | static + dynamic |
| S3 | `src/modules/process-dream/dream-levels.ts` | 80 | LLM classify decisions | `kb-entry-categorize` | static |
| S4 | `src/modules/process-reflection/rules.ts` | 13 | String match on errors | `error-fingerprint` | static |
| S5 | `src/modules/knowledge-projector/Handler.ts` | 244 | Keyword scoring for relevance | `relevance-score` | static |
| D1 | `src/services/negotiators/JulesNegotiator.ts` | 138, 296 | LLM verify against criteria | `verify:{hash}` | dynamic |
| D2 | `src/modules/executor-jules/JulesPostman.ts` | 130-132 | Ignore progress data | `extract:{hash}` | dynamic |
| D3 | `src/services/negotiators/UserNegotiator.ts` | 109 | LLM validate format | `validate:{hash}` | dynamic |

---

## Data Flow (Before vs After)

### Before (current)

```
Jules API Activity
  │
  ├─ agentMessaged ──► [LLM call: SIGNAL/NOISE] ──► mailbox
  │
  ├─ git diff ──► JSON.stringify ──► opaque system message (never read)
  │
  ├─ bash output ──► JSON.stringify ──► opaque system message (never read)
  │
  ├─ progress ──► [LLM call: verify criteria] ──► continue/wait
  │
  └─ completion ──► [LLM call: final verify] ──► accept/retry

User Reply
  │
  └─► [LLM call: validate format] ──► accept/reject

KB Entry Created
  │
  └─► (nothing happens until 5-min idle timer fires sessionDream)
```

### After (with PAW)

```
Jules API Activity
  │
  ├─ agentMessaged ──► [PAW S1: signal-noise, 50ms] ──► mailbox
  │
  ├─ all activities ──► [PAW S2: classify tags, 50ms] ──► route:
  │    ├─ has_git_diff ──► [PAW D2: extract paths, 80ms] ──► artifact + KB
  │    ├─ has_bash_output ──► [PAW D2: extract errors, 80ms] ──► [PAW S4: fingerprint] ──► KB match
  │    └─ has_error ──► immediate escalation
  │
  ├─ progress ──► [PAW D1: verify:{hash}, 80ms] ──► continue/wait
  │
  └─ completion ──► [PAW D1: verify:{hash}, 80ms] ──► accept/retry

User Reply
  │
  └─► [PAW D3: validate:{hash}, 80ms] ──► accept/reject

KB Entry Created
  │
  └─► [PAW S5: relevance-score vs recent entries, 50ms each] ──► flag high-relevance pairs
       └─► reactive sessionDream (no idle timer needed)
```

---

## Cost Savings Estimate

### Per Jules session (typical 10-min run, ~20 activities)

| Call Type | Current (LLM) | With PAW | Savings |
|-----------|--------------|----------|---------|
| SIGNAL/NOISE (S1) | 20 calls | 0 | 20 LLM calls |
| Progress verify (D1) | 2 calls | 0 | 2 LLM calls |
| Context analysis | 1 call | 1 call (too complex for PAW) | 0 |
| Final verify (D1) | 1 call | 0 | 1 LLM call |
| Activity classification (S2) | 0 (not done) | 0 | 0 |
| Extraction (D2) | 0 (not done) | 0 | 0 |
| **Total** | **24 LLM calls** | **1 LLM call** | **23 LLM calls** |

### Per task lifecycle (orchestrator + execution + KB + dream)

| Call Type | Current (LLM) | With PAW | Savings |
|-----------|--------------|----------|---------|
| Architect (plan generation) | 1 call | 1 call (too complex) | 0 |
| Programmer (code generation) | 1 call | 1 call (too complex) | 0 |
| Projector scoring (S5) | 0 (keyword) | 0 | 0 (quality improvement) |
| Dream classification (S3) | 3-5 calls | 0 | 3-5 LLM calls |
| Error fingerprinting (S4) | 0 (string match) | 0 | 0 (quality improvement) |
| Commit-harvest (S3) | 2-3 calls | 0 | 2-3 LLM calls |
| User validation (D3) | 1 call (if used) | 0 | 1 LLM call |
| **Total** | **8-12 LLM calls** | **2 LLM calls** | **6-10 LLM calls** |

### Combined per task with Jules

- **Current: ~32-36 LLM calls per task**
- **With PAW: ~3 LLM calls per task** (architect + programmer + context analysis)
- **Reduction: ~90%**

---

## Implementation Priority

### Phase 1: Immediate (static programs, highest ROI)

1. **S1 (`signal-noise`)** — One file change (`JulesPostman.ts`), eliminates the highest-volume LLM call. Can be tested with the existing `paw-test.html`.
2. **S2 (`jules-activity-classify`)** — Unlocks SA1 (Jules output mining). New capability, no existing code to break.

### Phase 2: Short-term (dynamic programs)

3. **D1 (`verify:{hash}`)** — Eliminates 3-4 LLM calls per Jules session. Requires adding compile-on-task-start logic to orchestrator.
4. **D3 (`validate:{hash}`)** — Simple replacement in `UserNegotiator`.

### Phase 3: Quality improvements

5. **S5 (`relevance-score`)** — Improves agent context quality. Replaces keyword scoring in projector.
6. **S4 (`error-fingerprint`)** — Improves reflection rule accuracy. Augments string matching in rules.ts.

### Phase 4: New capabilities

7. **SA1 (Jules output mining)** — Depends on S2 + D2. Turns Jules from black box into structured pipeline.
8. **SA2 (reactive KB cross-referencing)** — Depends on S5. Makes dream pipeline reactive.
9. **SA3 (escalation pattern mining)** — Mining Yuan chat transcripts for decisions/preferences.
10. **SA4 (message correspondence checking)** — Detect contradictions between incoming data and KB.

---

## Compilation Budget

### One-time compilations (static programs)

These compile once, ship with the app, never compile again.

| Program | Compiles | When |
|---------|----------|------|
| S1 `signal-noise` | 1 | Pre-compiled, shipped with app |
| S2 `jules-activity-classify` | 1 | Pre-compiled, shipped with app |
| S3 `kb-entry-categorize` | 1 | Pre-compiled, shipped with app |
| S4 `error-fingerprint` | 1 | Pre-compiled, shipped with app |
| S5 `relevance-score` | 1 | Pre-compiled, shipped with app |
| **Total** | **5** | **One-time** |

Cost: 5 × 100s = ~8 minutes total, once ever. Zero ongoing cost.

### Dynamic compilations (per spec hash, cached)

These compile per unique spec hash. The key question: **how many unique specs appear in practice?**

| Program | Unique Spec Trigger | Estimated Unique Specs | Compiles Per |
|---------|-------------------|----------------------|--------------|
| D1 `verify:{hash(criteria)}` | Each unique `successCriteria` string | **5-15 per project** | Project lifetime |
| D2 `extract:{hash(spec)}` | Each unique extraction need | **3-8 per project** | Project lifetime |
| D3 `validate:{hash(format)}` | Each unique `format` description | **3-5 per project** | Project lifetime |

**Why these numbers are small:**

Projects tend to have recurring patterns:
- Tasks in the same project often share similar acceptance criteria ("all tests pass", "no TypeScript errors", "build succeeds")
- askUserFor format descriptions recur ("yes/no", "file path", "branch name", "JSON schema")
- Extraction needs cluster around a few types ("changed files from diff", "error from log", "URL from output")

### Compilation estimates by scenario

#### Scenario A: Single project, light use (1-2 tasks/day)

| Period | D1 Compiles | D2 Compiles | D3 Compiles | Total |
|--------|------------|------------|------------|-------|
| First day | 3 | 2 | 1 | **6** |
| First week | 5 | 3 | 2 | **10** |
| First month | 8 | 4 | 3 | **15** |
| Steady state (month 2+) | 0-1 new | 0-1 new | 0 | **0-2** |

After the first month, most specs have been compiled and cached. New compilations only happen when the project introduces genuinely new criteria patterns.

#### Scenario B: Single project, heavy use (5-10 tasks/day)

| Period | D1 Compiles | D2 Compiles | D3 Compiles | Total |
|--------|------------|------------|------------|-------|
| First day | 5 | 3 | 2 | **10** |
| First week | 10 | 5 | 3 | **18** |
| First month | 15 | 8 | 5 | **28** |
| Steady state (month 2+) | 1-2 new | 0-1 new | 0 | **1-3** |

Higher volume accelerates hitting all unique specs, but saturation still happens within ~1 month.

#### Scenario C: Multiple projects (10 projects)

| Period | Total Compiles | Notes |
|--------|---------------|-------|
| First month | 100-150 | Each project has unique criteria patterns |
| Steady state | 5-15/month | New projects + new criteria patterns |

Approximately **10-15 unique dynamic compilations per project**, mostly front-loaded in the first month.

### Total compilation budget summary

| Category | Compiles | Time | Cost (if paid) |
|----------|----------|------|----------------|
| Static (5 programs) | 5, once ever | ~8 min total | One-time |
| Dynamic (per project, first month) | 10-15 | ~17-25 min | Front-loaded |
| Dynamic (per project, steady state) | 0-3/month | 0-5 min | Minimal |
| Dynamic (10 projects, first year) | ~150-200 | ~4-5 hours total | Over entire year |

### Cost model assumptions (if PAW charges per compile)

| PAW Compile Price | Scenario A (1 project/yr) | Scenario B (heavy/yr) | Scenario C (10 projects/yr) |
|-------------------|--------------------------|----------------------|----------------------------|
| $0.01/compile | $0.20 | $0.46 | $2.00 |
| $0.05/compile | $1.00 | $2.30 | $10.00 |
| $0.10/compile | $2.00 | $4.60 | $20.00 |
| $0.50/compile | $10.00 | $23.00 | $100.00 |

Compare to LLM API costs saved (at GPT-4o-mini pricing ~$0.15/1M input tokens):

| Scenario | LLM Calls Saved/Year | Est. Tokens Saved | Cost Saved |
|----------|---------------------|-------------------|------------|
| A (light) | ~1,000 | ~2M tokens | ~$0.30 |
| B (heavy) | ~6,000 | ~12M tokens | ~$1.80 |
| C (10 projects) | ~30,000 | ~60M tokens | ~$9.00 |

**Break-even:** If PAW compile costs >$0.10, the economics only work for high-volume scenarios or when using more expensive LLM models (GPT-4 class). For GPT-4o-mini class, PAW compile should stay under ~$0.05 to be net-positive at low volume.

**Strategic value beyond cost:** Even if PAW compilation costs match LLM savings, the non-cost benefits remain:
- **Latency:** 50ms PAW inference vs 1-3s LLM API call
- **Reliability:** No network dependency for classification
- **Privacy:** Sensitive data stays in browser
- **Parallelism:** Browser can run multiple PAW programs simultaneously

---

## Project Methodology Impact on PAW Compilation

Different project methodologies produce different patterns of spec reuse. This analysis maps common methodologies to their PAW compilation behavior.

### Methodology 1: Bug Factory (issue-in, fix-out)

**Pattern:** User reports bugs → agent fixes them → verification → done.

**Typical task flow:**
```
"Fix login crash on mobile" → executor-jules → verify: "login works on mobile"
"Fix memory leak in websocket" → executor-jules → verify: "no memory leak"
```

**Spec reuse:**

| PAW Program | Unique Specs | Why |
|-------------|-------------|-----|
| D1 `verify:{hash}` | **LOW (2-4)** | Most bugs resolve to the same criteria patterns: "error no longer occurs", "test passes", "feature works as described". Hash clusters around ~4 patterns. |
| D2 `extract:{hash}` | **LOW (3-5)** | Extracting: changed files, error output, test results. Same extraction patterns every time. |
| D3 `validate:{hash}` | **LOW (2-3)** | askUserFor formats: "describe the error", "yes/no confirm fix", "paste stack trace". |
| S1 `signal-noise` | **1** | Static. Identical for all bug tasks. |

**Compilation budget (20 bugs/month):**
- First month: ~10 unique dynamic compilations
- Steady state: 0-1 new compilations/month
- **~90% of compilations happen in week 1, then all cached.**

**Why so few:** Bug descriptions vary, but the *extraction and verification patterns* are nearly identical. "Does the output contain 'All tests passed'?" is the same verification whether the bug was in login or websocket.

---

### Methodology 2: Feature Factory (spec-in, feature-out)

**Pattern:** Product spec → architect breaks into tasks → implement → verify against acceptance criteria.

**Typical task flow:**
```
"Add dark mode toggle" → architect → 3 steps → verify: "toggle appears in settings, theme changes"
"Add user profile page" → architect → 5 steps → verify: "profile page shows avatar, name, email"
```

**Spec reuse:**

| PAW Program | Unique Specs | Why |
|-------------|-------------|-----|
| D1 `verify:{hash}` | **MEDIUM (8-15)** | Each feature has unique acceptance criteria. "Toggle appears in settings" ≠ "Profile shows avatar". But sub-patterns repeat: "UI renders correctly", "data persists", "API returns 200". |
| D2 `extract:{hash}` | **MEDIUM (5-8)** | Extracting changed files, UI component names, API endpoints. More varied than bugs. |
| D3 `validate:{hash}` | **MEDIUM (4-6)** | askUserFor: "which component library?", "confirm the design", "review the API schema". More format variety. |
| S1 `signal-noise` | **1** | Static. |

**Compilation budget (10 features/month):**
- First month: ~20-25 unique dynamic compilations
- Steady state: 3-5 new/month (new feature types introduce new patterns)
- **Compilations grow with feature type diversity, not feature count.**

**Sub-pattern clustering:** While acceptance criteria differ, the *verification verbs* cluster:
- "renders correctly" → shared program
- "API returns expected data" → shared program
- "no console errors" → shared program
- "data persists across reload" → shared program

A feature with 3 acceptance criteria might hit 3 already-compiled programs if the criteria match common verification verbs.

---

### Methodology 3: Continuous Refactoring (iterate-on-codebase)

**Pattern:** Continuous improvement tasks: refactor module X, improve test coverage, optimize query performance.

**Typical task flow:**
```
"Refactor auth middleware to use dependency injection" → executor-jules → verify: "all auth tests pass"
"Increase test coverage on PaymentService to 80%" → executor-jules → verify: "coverage report shows ≥80%"
"Optimize dashboard query from 3s to <500ms" → executor-jules → verify: "query time <500ms"
```

**Spec reuse:**

| PAW Program | Unique Specs | Why |
|-------------|-------------|-----|
| D1 `verify:{hash}` | **LOW (3-6)** | Verification is almost always about metrics: "tests pass", "coverage ≥ X%", "performance < Xms". The numeric threshold changes but the pattern doesn't. |
| D2 `extract:{hash}` | **LOW (3-5)** | Extracting: test results, coverage numbers, benchmark times. |
| D3 `validate:{hash}` | **LOW (2-3)** | askUserFor: "which module?", "what threshold?". |

**Compilation budget (15 refactors/month):**
- First month: ~8-12 unique dynamic compilations
- Steady state: 1-2 new/month
- **Fastest saturation of any methodology.** Metrics-based verification is inherently repetitive.

**Special opportunity:** The `relevance-score` program (S5) becomes extremely valuable here. When refactoring auth middleware, the projector needs to surface auth-related KB entries. PAW's semantic scoring beats keyword matching for this.

---

### Methodology 4: Greenfield Project (build-from-scratch)

**Pattern:** New project with constitution defining stages, artifacts, and gates. ProcessAgent enforces stage progression.

**Typical flow (from ProcessAgent + constitution):**
```
Stage 1: Architecture Spec → artifact: architecture.md → gate: approved
Stage 2: API Design → artifact: api-spec.yaml → gate: approved
Stage 3: Implementation → executor-jules per module → verify: "implements API spec"
Stage 4: Testing → executor-local → verify: "test coverage ≥ 80%"
Stage 5: Documentation → artifact: readme.md → gate: approved
```

**Spec reuse:**

| PAW Program | Unique Specs | Why |
|-------------|-------------|-----|
| D1 `verify:{hash}` | **HIGH (15-25)** | Each stage has unique verification: "spec is complete", "API matches design", "implementation follows architecture", "tests cover critical paths". But within a stage, all tasks share the same verify spec. |
| D2 `extract:{hash}` | **MEDIUM (5-8)** | Extracting: spec sections, API endpoints, implementation status, test results. |
| D3 `validate:{hash}` | **MEDIUM (4-6)** | askUserFor at gates: "approve architecture?", "confirm API design?", "review implementation?". |
| S1 `signal-noise` | **1** | Static. |
| S3 `kb-entry-categorize` | **1** | Static. But heavily used — every artifact review produces KB entries. |
| S5 `relevance-score` | **1** | Static. Critical for stage transitions — projector must surface the right stage context. |

**Compilation budget (1 greenfield project, 30 tasks):**
- First month: ~25-35 unique dynamic compilations
- Steady state: 0-2 new/month (project stabilizes)
- **Heaviest upfront compilation.** But stage-based methodology means all tasks in a stage share specs.

**Key insight:** The `checkGates` tool in ProcessAgent (line 159-184) already compares artifacts against constitution stages. PAW could automate gate verification:
- Instead of LLM analyzing "does this artifact meet the stage criteria?", run D1 with the stage's spec.
- Stage specs come from the constitution — so all tasks in the same stage share the same D1 program.

---

### Methodology 5: Kanban Flow (continuous delivery)

**Pattern:** Continuous stream of mixed tasks (bugs + features + chores). No stages, no gates. Prioritization-driven.

**Typical flow:**
```
Mix of: bug fixes, small features, dependency updates, documentation, performance tuning
Each task: brief description → executor → verify: "task description satisfied"
```

**Spec reuse:**

| PAW Program | Unique Specs | Why |
|-------------|-------------|-----|
| D1 `verify:{hash}` | **HIGHEST (20-40)** | Every task has a unique description used as success criteria. Minimal pattern reuse. |
| D2 `extract:{hash}` | **MEDIUM (5-8)** | Extraction patterns still cluster (files, errors, URLs). |
| D3 `validate:{hash}` | **LOW-MEDIUM (3-5)** | askUserFor tends to be simple: "confirm?", "which option?". |

**Compilation budget (30 tasks/month, mixed):**
- First month: ~30-45 unique dynamic compilations
- Steady state: 5-10 new/month (always new task types)
- **Slowest saturation.** Unique task descriptions mean unique verify specs.

**Mitigation:** Normalize success criteria before hashing. "Fix the login bug" and "Fix login page crash" should hash to the same program. This could be done with a static PAW program that normalizes criteria text before hashing.

---

### Summary: Methodology vs Compilation Rate

| Methodology | Dynamic Compiles (Month 1) | Steady State/Month | Time to 90% Saturation | Key Driver |
|-------------|---------------------------|-------------------|----------------------|------------|
| Bug Factory | 10 | 0-1 | ~2 weeks | Repetitive verification patterns |
| Continuous Refactoring | 8-12 | 1-2 | ~2 weeks | Metrics-based verification |
| Feature Factory | 20-25 | 3-5 | ~6 weeks | Feature type diversity |
| Greenfield Project | 25-35 | 0-2 | ~4 weeks (then done) | Stage-based reuse within stages |
| Kanban Flow | 30-45 | 5-10 | ~3 months | Unique task descriptions |

### What This Means for the Program Store

**Methodology-aware caching strategy:**

1. **Greenfield/Stage-based**: Cache by stage name, not spec hash. All tasks in "Stage 3: Implementation" share one verify program keyed by `verify:stage:implementation:{projectId}`.

2. **Bug/Refactoring**: Cache by verification verb pattern. "tests pass", "no errors", "performance < X" normalize to shared programs. Key: `verify:verb:{normalized_verb}`.

3. **Feature/Kanban**: Full spec hash. Highest compilation rate, but also the highest LLM call volume — so PAW savings are proportionally larger.

4. **Cross-project reuse**: For teams running multiple projects with the same methodology (e.g., all greenfield), share the program cache across projects. Stage-based specs from one project's constitution often match another's.

---

## Technical Notes

### PAW SDK Location
- Local SDK: `public/paw-sdk/` (index.js, loader.js, runtime.js)
- WASM runtime: wllama (llama.cpp WASM binding)
- Model: GPT-2 124M Q8_0 (~134MB, cached via Cache API after first download)
- Adapter + prefix cache per program: ~12MB

### Cache Strategy

#### Base Model (~134MB, shared across all programs)
- Stored in Cache API (`paw-model-cache`), keyed by model URL
- Downloaded once, reused by every program
- Shared across all PAW programs — no per-program cost

#### Program Store (IndexedDB, new table `pawPrograms`)

```typescript
interface PawProgram {
  id: string;            // spec hash (SHA-256 of spec text)
  spec: string;          // original natural-language spec
  slug: string;          // program slug or generated name
  programId: string;     // PAW program ID (from compile API or CDN)
  adapterBlob: Blob;     // LoRA adapter weights (~5MB)
  prefixCacheBlob: Blob; // KV cache for prompt prefix (~7MB)
  prefixTokens: any;     // token sequence for prefix cache
  promptTemplate: string;// prompt template with {INPUT_PLACEHOLDER}
  meta: object;          // runtime manifest, interpreter info
  type: 'static' | 'dynamic';
  compileTime?: number;  // ms taken to compile (dynamic only)
  createdAt: number;
  lastUsedAt: number;
  usageCount: number;
  projectId?: string;    // project that triggered compilation
}
```

**Storage estimate per program:** ~12MB (5MB adapter + 7MB prefix cache)
**Storage estimate for typical project:** ~120-180MB (10-15 dynamic programs)
**Storage estimate for 10 projects:** ~1.2-1.8GB

#### Lookup flow

```
Need PAW program for spec "Classify as SIGNAL or NOISE"
  │
  ├─ hash(spec) → "a1b2c3..."
  │
  ├─ Check IndexedDB pawPrograms where id === "a1b2c3..."
  │    │
  │    ├─ FOUND → load adapter + prefix cache from IndexedDB → run (0ms startup)
  │    │
  │    └─ NOT FOUND
  │         │
  │         ├─ STATIC: fetch from CDN → store → run
  │         │
  │         └─ DYNAMIC: compile via API → wait ~100s → fetch assets → store → run
```

#### Why IndexedDB, not Cache API

- Cache API stores URL → Response pairs. Programs are looked up by spec hash, not URL.
- IndexedDB supports Blob storage with efficient range queries.
- Cache API has eviction risk (browser may clear under storage pressure). IndexedDB is more persistent.
- Need to store structured metadata alongside binary blobs (adapter + prefix cache).

#### Garbage collection

Programs that haven't been used in 30 days can be pruned:
```sql
DELETE FROM pawPrograms WHERE lastUsedAt < (now - 30 days) AND type = 'dynamic'
```

Static programs are never pruned. Dynamic programs are pruned only if storage pressure exceeds 500MB.

#### Export/Import for multi-device

Since programs are ~12MB each, a project's full PAW cache (~120-180MB) can be exported as a single file and imported on another device, skipping all compilation entirely:
- Export: serialize pawPrograms entries + adapter blobs into a tar
- Import: deserialize into IndexedDB
- Use case: team sharing, dev/prod parity, offline setup

### Compile Timing
- Static programs: pre-compiled, no compile time
- Dynamic programs: ~100s compile, kicked off when work starts (task creation, Jules session start, askUserFor call). By the time the result is needed, the program is ready.

### Limitations
- GPT-2 124M handles narrow classification/extraction well, but cannot replace reasoning-heavy LLM calls (architect, programmer, context analysis)
- 2048 token context window limits input length
- Dynamic programs require the PAW API key for compilation
- First model download is ~134MB (subsequent loads use Cache API)
