# MVP Phase 1: Decision Harvest — Task Branches + Decision Tracing

> Every non-trivial task works on its own branch. Agents declare decisions intentionally. Dream stages classify, trace, and detect conflicts. Conflicts escalate to user — never auto-resolved. Resolutions become constitution rules so conflicts don't repeat.

---

## 1. Task Branching Model

### 1.1 Branching Policy: Not Every Task

Only tasks that touch >N files or have multi-step protocols get branches. Simple tasks commit directly.

```
Branch condition (any of):
  - Architect protocol has >2 steps
  - Task description contains scope keywords: "implement", "refactor", "migrate", "add"
  - Task is explicitly flagged as architectural

Direct commit (no branch):
  - Typo fixes, config changes, single-file edits, test-only changes
```

This avoids branch proliferation for trivial work while preserving isolation where it matters.

### 1.2 Rule: One Qualifying Task, One Branch

Qualifying tasks get `task/{id}` branched from the current working branch.

```
main ──────────────────────────────────────────────
  │
  ├── task/abc123  ── "Add auth middleware" (3-step protocol)
  │     ├── commit: read existing auth files
  │     ├── commit: add JWT validation
  │     └── commit: add tests
  │
  │     (direct commit) ── "Fix typo in README" (no branch)
  │
  ├── task/def456  ── "Add rate limiting" (2-step protocol)
  │     ├── commit: read middleware chain
  │     └── commit: add rate limiter
  │
  └── task/ghi789  ── "Refactor module loading" (4-step protocol)
        ├── commit: read current module system
        ├── commit: extract interface
        └── commit: migrate all modules
```

### 1.3 Lifecycle

```
1. Task created → evaluate branch condition
   - qualifies → branch task/{id} from HEAD
   - doesn't qualify → commit directly to working branch
2. Executor works → commits on task/{id} (or working branch)
3. Task succeeds → merge task/{id} back (branches only)
4. Task fails → branch stays (retriable), or deleted if abandoned
```

### 1.4 Merge: Post-Harvest, Not Pre-Gate

**Merge is cheap and happens first. Dream harvests decisions after merge.**

Rationale: If the merge gate requires micro dream + conflict analysis before merge, parallel tasks serialize. The branch already isolated the work during execution. Merge it. Then dream extracts decisions. Conflicts are caught at session dream level (board idle). Bad merges are reversible via git + decision log.

```
1. Task completes → merge task/{id} → working branch
2. Micro dream runs on the merged result
3. Extracts decisions (see §2)
4. Session dream catches cross-task conflicts later (see §4)
```

Exception: git merge conflicts still block (can't auto-merge). These escalate immediately.

---

## 2. Decision Declaration, Not Extraction

### 2.1 The Core Problem with LLM Extraction

LLMs infer "decisions" from implementation details that may be habit, cargo-culting, or default choices. The diff shows *what* changed, not *why*. Task descriptions are vague. Commit messages are terse. The actual reasoning lives in the agent's chain-of-thought, which is discarded.

Triangulating from three sources (task desc + diff + commit messages) produces noise — entries that look like decisions but are just implementation details the agent never thought about.

### 2.2 Solution: Agents Declare Decisions Intentionally

The agent's system prompt includes a rule:

```
RULE: When you make a non-obvious choice with alternatives (library, pattern,
architecture, API design, naming convention), you MUST call:
  knowledge-kb.recordDecision(text, tags, project)

The text should include:
  - What you chose
  - What alternatives you considered (if any)
  - Why you chose this one

Examples of decisions to record:
  - "Using JWT over session cookies — need stateless auth for WASM"
  - "Retry with exponential backoff — simple and sufficient for our scale"
  - "Dexie over raw IndexedDB — need reactive queries"

Examples of NON-decisions (do NOT record):
  - Using the same naming convention as surrounding code
  - Following an established pattern already in the codebase
  - Default parameter values
```

### 2.3 Dual Signal: Declare + Verify

Dream doesn't extract decisions from scratch — it **verifies and enriches** what the agent declared:

```
Micro dream:
  1. Read: agent-declared decisions from KB (source: 'agent', active)
  2. Read: git diff for this task
  3. LLM prompt:
     "The agent declared these decisions during execution:
      [list declared decisions]

      Here is the actual code diff:
      [diff]

      For each declared decision:
       - Does the code match the declaration?
       - Classify: architectural|api|dependency|pattern|local|infra|security
       - Is anything missing? Did the agent make choices it didn't declare?

      Output only high-confidence classifications and missed decisions."

  4. Update declared entries with classification tags
  5. Add any missed decisions the LLM found (flagged source: 'dream:micro')
```

This keeps the signal intentional (agent declares) while catching gaps (dream verifies).

### 2.4 Classification Taxonomy

| Tag | Level | Examples |
|-----|-------|---------|
| `architectural` | System-wide | "Event-driven module communication", "IndexedDB via Dexie for all persistence" |
| `api` | Interface | "REST endpoint POST /tasks", "BoardVM exposes .yuan.send()" |
| `dependency` | Package choice | "Dexie over raw IndexedDB", "Sval for sandboxing", "xterm.js for terminal" |
| `pattern` | Code pattern | "Retry with exponential backoff", "Shim native packages for VFS" |
| `local` | File/naming | "Modules in src/modules/{category}-{name}", "Handler.ts per module" |
| `infra` | Build/deploy | "Vite + React SPA", "Bundle script for @yuaone ESM→CJS" |
| `security` | Auth/validation | "JWT for auth middleware", "Sandbox in Web Worker" |

### 2.5 Extraction at Each Dream Level

**Micro (post-task, after merge):** Verify + classify agent-declared decisions. Catch gaps.

```
Input:
  - Agent-declared decisions from KB (source: 'agent')
  - git diff for this task
  - Commit messages

Output → update existing entries with classification, add missed decisions
  category: 'decision'
  tags: [classification, ...specific_tags, taskId]
  source: 'dream:micro' (for missed) or 'agent' (for declared, now classified)
  abstraction: 4
  layer: ['L0', 'L1']
```

**Session (board idle):** Cross-task pattern detection + conflict flagging.

```
Input:
  - All active decisions (declared + verified)
  - Open task branches (if any still unmerged)

LLM Prompt:
  "Compare these decisions across tasks.
   1. Find contradictions (same concern, different choices)
   2. Find patterns (multiple tasks chose similar approach)
   3. Find dependencies (D1 affects D2)
   Severity: only flag as 'conflict' if decisions directly contradict on same scope.
   Similar but compatible approaches are 'patterns', not conflicts."

Output →
  Pattern entries (abstraction 7, no escalation)
  Conflict entries (abstraction 7, escalated to user — see §3)
```

**Deep (daily):** Architectural consolidation + decision log.

```
Input:
  - All decisions (active + superseded)
  - Full supersedes graph
  - Project docs and constitution

Output →
  KB entries (abstraction 9, superseding session-level patterns)
  KB doc (decision-log-{date}, replacing previous)
  Constitution amendment proposals (from conflict resolutions — see §3.5)
```

---

## 3. Superseded Decision Tracing

### 3.1 The `supersedes` DAG

`KBEntry.supersedes: number[]` already exists in the schema. Convention:

- **`supersedes` means "this entry replaces the listed entries"**
- Superseded entries are marked `active: false`
- Trace history by following `supersedes` links backward

```
D1 (task/abc): "Use REST for internal APIs"
  ↓ superseded by
D2 (task/def): "Switch to gRPC — REST too chatty for module comm"
  ↓ superseded by
D3 (session): "REST for external, event-driven internally"

Query active decisions → only D3 visible
Trace D3.supersedes → [2] → D2.supersedes → [1] → full history
```

### 3.2 Chain Flattening

When D7 supersedes D5, and D5 already supersedes D4:

```
D5.supersedes = [4]
D7.supersedes = [5, ...D5.supersedes] = [5, 4]
```

New entries inherit the full chain of what they replace. This makes tracing O(1) — one entry's `supersedes` array gives you the entire history without recursion.

### 3.3 Tracing a Decision

```typescript
// "Why are we using Dexie?"
const d4 = KB.queryLog({ tags: ['dexie'], category: 'decision' })[0]
// d4.supersedes = [0] → full chain in one array

// "Current auth decisions?"
KB.queryLog({ category: 'decision', tags: ['security', 'auth'], active: true })
```

### 3.4 Abstraction Monotonicity

New entries can only supersede entries with **equal or lower abstraction**. This prevents cycles:

```
Micro (4) → can be superseded by session (7) or deep (9)
Session (7) → can be superseded by deep (9)
Deep (9) → cannot be superseded

Validation: when creating E with supersedes: [ids],
  for each id: assert get(id).abstraction <= E.abstraction
```

---

## 4. Conflict Escalation

### 4.1 The Dream Engine Never Auto-Resolves Conflicts

Conflicts are questions, not answers. The system surfaces them with context and escalates.

### 4.2 Escalation Ladder

```
Level 1: USER (always first)
  ↓ no response within threshold (configurable, default: 1 hour)
Level 2: YUAN (strategic agent proposes resolution, still needs user approval)
  ↓ user rejects Yuan's proposal
Level 3: BLOCKED — halt affected tasks, wait for human
```

### 4.3 Conflict Severity Filter

Not every difference is a conflict. Escalation fatigue is a real risk — if the system escalates trivial disagreements, users will ignore all escalations.

```
Severity levels:

ESCALATE (blocks merge, user must resolve):
  - Two decisions directly contradict on the SAME scope
    e.g., "Use REST for all APIs" vs "Use gRPC for all APIs"
  - A decision violates an active constitution rule

LOG ONLY (no escalation, note in KB):
  - Similar but compatible approaches (different scope)
    e.g., "Use REST for external APIs" vs "Use events internally"
  - Different patterns for different executors
  - Extensions of existing decisions

IGNORE:
  - Same decision reached independently (confirmation, not conflict)
  - Style/naming differences in isolated code
```

### 4.4 Conflicts Are Not Always Binary

Escalation messages offer three options, not two:

```
"D5: Validate at module boundary
 D6: Validate at tool call boundary

Options:
 (a) Choose D5 — validate at module boundary only
 (b) Choose D6 — validate at tool call boundary only
 (c) Both are right — describe the merged rule
     [text input]

 Suggested: (c) Both apply — validate at system boundary
            (module entry + tool call), trust internal code"
```

Option (c) should be the default suggestion. Most conflicts aren't "pick one" — they're "these are both right but incomplete, describe the full picture."

### 4.5 Conflict Resolution → Constitution Rule

**This is the feedback loop.** When a user resolves a conflict, the resolution is promoted:

```
1. User resolves conflict → D7 created with supersedes: [5, 6]
2. If resolution is generalizable (tags: architectural, pattern, or security):
   → Propose as constitution rule
   → "Your resolution: 'Validate at system boundary, trust internal code'
      Should this become a project rule? [Yes] [No]"

3. If user approves → appended to constitution
4. Future tasks see the rule in L0 projection → same conflict doesn't recur
```

Without this loop, the system will keep escalating the same type of conflict. Resolutions must feed back into the decision-making layer.

### 4.6 Merge Policy

```
if (git merge conflicts exist):
  → block merge, escalate to user immediately (can't auto-merge anyway)
elif (decision conflict — ESCALATE severity):
  → block merge, escalate to user with context + three options
elif (decision warning — LOG ONLY):
  → merge, log pattern in KB, no escalation
else:
  → auto-merge, run micro dream post-merge
```

---

## 5. Data Model

### 5.1 No Schema Changes Needed

Existing `KBEntry` already supports decisions:

```typescript
{
  category: 'decision',
  tags: ['architectural', 'auth', 'jwt', 'task/abc123'],
  source: 'agent' | 'dream:micro' | 'dream:session' | 'dream:deep',
  supersedes: [5, 4],  // flattened chain
  abstraction: 4 | 7 | 9,
  active: true,        // false when superseded
}
```

### 5.2 New AgentMessage Types

```typescript
// Escalation message
{
  sender: 'dream:session',
  type: 'escalation',
  content: "Conflict between decisions...",
  status: 'unread',
  proposedTask: {
    title: '[decision] Resolve auth validation conflict',
    description: '...'
  }
}
```

### 5.3 Task Model Addition

```typescript
interface Task {
  // ... existing fields
  branch?: string;  // 'task/{id}' — created for qualifying tasks only
}
```

### 5.4 New KB Doc Type

```typescript
{
  title: 'Decision Log — 2026-04-17',
  type: 'decision-log',
  content: '# Decision Log\n\n## Architectural\n- ...',
  source: 'dream:deep',
  project: 'target',
}
```

---

## 6. Implementation Phases

### Phase 1a: Agent Declaration Rule

- [ ] Add decision declaration rule to Yuan system prompt in `agent-bootstrap.ts`
- [ ] Wire `knowledge-kb.recordDecision` as callable tool in sandbox bindings
- [ ] Agent records decisions during execution (source: 'agent')

### Phase 1b: Task Branching (Conditional)

- [ ] Add `branch` field to Task model
- [ ] On task start: evaluate branch condition → create `task/{id}` if qualifying
- [ ] On task success: merge `task/{id}` back
- [ ] On task failure: leave branch for retry
- [ ] Simple tasks commit directly (no branch)

### Phase 1c: Micro Dream Verification

- [ ] After merge: read agent-declared decisions + git diff
- [ ] LLM verifies + classifies declared decisions
- [ ] LLM flags missed decisions (low confidence)
- [ ] Update entries with classification tags
- [ ] Wire into `microDream()` in `dream-levels.ts`

### Phase 1d: Superseded Tracing

- [ ] Chain flattening: inherit full supersedes array on new entry
- [ ] Validation: only supersede ≤ own abstraction
- [ ] Auto-deactivate superseded entries
- [ ] Query helper: `traceDecisionChain(entryId)`
- [ ] KB browser: show decision history as timeline

### Phase 1e: Session Conflict Detection + Escalation

- [ ] Compare decisions across tasks (severity filter: only direct contradictions)
- [ ] Create escalation AgentMessage for conflicts
- [ ] Present three options to user (pick D5, pick D6, merged rule)
- [ ] Block merge on ESCALATE-severity conflicts
- [ ] Wire into `sessionDream()` in `dream-levels.ts`

### Phase 1f: Resolution Feedback Loop

- [ ] On user resolution: create superseding entry
- [ ] If generalizable: propose as constitution rule
- [ ] User-approved resolutions → appended to constitution
- [ ] Future tasks see resolution in L0 projection

### Phase 1g: Deep Decision Log

- [ ] Generate decision-log document from full superseded graph
- [ ] Supersede previous decision-log docs
- [ ] Wire into `deepDream()` in `dream-levels.ts`

---

## 7. Example Walkthrough

```
Day 1:
  Task abc: "Add auth middleware" (3-step protocol → gets branch)
    → branch task/abc from main
    → agent executes, declares decisions during work:
      D0: "JWT over session cookies — need stateless for WASM" [agent]
      D1: "bcrypt for hashing — standard, no need for argon in browser" [agent]
    → merge task/abc → main
    → micro dream verifies: code matches declarations, classifies:
      D0: tags += [api, auth, jwt], source stays 'agent'
      D1: tags += [dependency, auth, bcrypt], source stays 'agent'
      Missed: none found

  Task def: "Fix typo in README" (no branch)
    → direct commit
    → no decisions to declare
    → micro dream: skip (no decisions, trivial task)

  Task ghi: "Add rate limiting" (2-step protocol → gets branch)
    → branch task/ghi from main
    → agent declares:
      D2: "express-rate-limit — lightweight, well-maintained" [agent]
    → merge task/ghi → main
    → micro dream classifies: D2: tags += [dependency, infra]

  Board idle → session dream:
    Compares D0-D2. No conflicts.
    D3: "Middleware pattern: JWT auth → rate limiting → handler" [pattern]
      abstraction: 7, supersedes: []

Day 2:
  Task jkl: "Add WebSocket auth" (2-step protocol → gets branch)
    → agent declares:
      D4: "Reuse JWT for WS handshake — consistent with HTTP auth" [agent]
    → micro dream: D4 extends D0 (same approach, different transport). LOG ONLY.

  Task mno: "Add input validation" (3-step → gets branch)
    → agent declares:
      D5: "Validate at tool call boundary — catch errors closest to source" [agent]
    → micro dream classifies: D5: tags += [pattern, validation]

  Board idle → session dream:
    Compares all decisions. Finds:
      D5: "validate at tool call boundary"
      But constitution says: "trust internal code, validate at system boundary"
    → ESCALATE to user:
      "D5 contradicts constitution: 'trust internal code'.
       Options: (a) Keep D5, (b) Follow constitution, (c) Clarify scope"
    User picks (c): "Validate at module boundary (system edge), trust internal calls"
    → D6 created: supersedes: [5]
    → D5.active = false
    → Constitution amendment proposed: "Validate at module boundary, trust internal code"
    → User approves → rule added to constitution

Day 7: Deep dream
  Reviews all decisions + superseded chain.
  Generates decision-log doc:
    "## Auth Architecture
     - JWT for HTTP + WebSocket (D0, D4)
     - bcrypt for passwords (D1)
     - Middleware: auth → rate limit → handler (D3)
     - Validate at module boundary (D6, superseded D5)"
```

---

## 8. Open Questions

- **Threshold for branching**: what value of N (files touched / protocol steps) triggers a branch? Start with N=2 steps, tune empirically.
- **Escalation timeout**: how long before user non-response escalates to Yuan? Default 1 hour, configurable per project.
- **Missed decision confidence**: how confident must the LLM be to add a missed decision during micro dream? Start conservative — only add if clearly visible in diff + contradicts a pattern.
- **Constitution rule promotion**: should all conflict resolutions be proposed as rules, or only architectural/security ones? Start with all, user can decline.
