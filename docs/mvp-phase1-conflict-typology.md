# MVP Phase 1: Conflict Typology & Resolution Strategy

## Overview

When two active `decision` entries contradict each other, the system must determine
how to resolve the conflict. Not all conflicts are equal — some are clear hierarchy
enforcement, others are genuine discoveries, and some require human judgment.

The key insight: **evidence backing is not binary**. A decision isn't just "backed"
or "not backed" — it has a *weight* computed from multiple signals in the KB itself.

---

## Evidence Weight Model

Before classifying a conflict, compute an **evidence score** for each decision.

### Signals

Think of each signal as answering a different question about a decision's trustworthiness.
No single signal is decisive — they combine to paint a picture.

---

#### 1. Source Provenance: "Who said this?"

> Not all sources carry the same weight. A human telling you something directly
> is different from an LLM inferring a pattern. This signal tracks **how close
> to ground truth** the decision's origin is.

**Analogy:** In a court, an eyewitness (execution) beats hearsay (dream synthesis)
beats speculation (deep dream). A direct order from the judge (user) overrides both.

| Source | Score | What happened |
|--------|-------|---------------|
| `user` | 5 | A human explicitly wrote this. "Do it this way." Direct intent. |
| `execution` | 4 | Code ran in the sandbox and produced this observation. The machine proved it. |
| `dream:micro` | 3 | After a task completed, the system looked at what happened and drew a conclusion. One step removed from the run itself. |
| `dream:session` | 2 | After multiple tasks, the system noticed a pattern. Broader view, softer ground. |
| `dream:deep` | 1 | A long-term strategic reflection. Valuable direction, but furthest from anything concrete. |

**What it prevents:** A `dream:deep` strategic insight (score 1) shouldn't automatically
override an `execution` observation (score 4) just because it's at a higher abstraction level.

---

#### 2. Duration Standing: "How long has this been unchallenged?"

> A decision that has been sitting in the KB for a week while multiple tasks
> ran and nothing contradicted it has been **silently validated by time**.
> A decision from 10 minutes ago hasn't been tested by anything yet.

**Analogy:** A law that's been on the books for 50 years vs one passed yesterday.
The old law isn't necessarily better, but it's survived every situation that's
come up. The new law is untested.

**Computation:** `min(floor(days since creation), 5)` — caps at 5 days.

**Why it caps:** A decision from 30 days ago isn't 6x more trustworthy than one
from 5 days ago. Once it's survived a working week, the time signal saturates.
Further age doesn't add new information.

**What it prevents:** A freshly-minted dream insight from immediately overturning
a long-standing decision just because the dream was "smarter."

---

#### 3. Task Corroboration: "Did actual work prove this?"

> This is the strongest practical signal. After a decision was made, did tasks
> run in the same domain and **complete without errors that contradict it**?
> Each successful task run is a data point saying "this decision works in practice."

**Analogy:** "Use connection pooling" — then 5 different tasks hit the database,
none of them produced connection timeout errors. That's 5 pieces of evidence
that pooling works. Compare to "Use connection pooling" with zero tasks since —
it's an untested hypothesis.

**Computation:** Count `source: 'execution'` entries created after the decision,
whose tags overlap with the decision's tags. Cap at 5.

**Why it can beat provenance:** A `dream:session` insight with 4 corroborating tasks
(score 2 + 4 = 6) is more trustworthy than a `user` directive that nobody ever
actually followed (score 5 + 0 = 5). Practice validates or invalidates theory.

**What it prevents:** Authority without proof winning over evidence from the field.

---

#### 4. Verification Status: "Did the system already check this?"

> microDream's `verifyDecisions` phase takes harvested decisions and cross-checks
> them against execution evidence before tagging them `verified`. This means
> another process has already done a sanity pass.

**Analogy:** A peer-reviewed paper vs a preprint. Both might be right, but the
reviewed one has been checked by at least one other process. Unverified decisions
might be hallucinations or unstated LLM assumptions.

**Computation:** `+3` if `tags.includes('verified')`

**Why it's moderate:** Verification is a sanity check, not a guarantee. A verified
decision can still be wrong — it just passed a basic "does this match what we've
seen?" test. It shouldn't outweigh 4 corroborating tasks.

**What it prevents:** Unverified LLM hallucinations being treated equally with
decisions that have been cross-referenced against real execution data.

---

#### 5. Conflict Survivor: "Has this been challenged before and won?"

> A decision that has already survived a previous conflict is battle-tested.
> It's not just unchallenged — someone (or some process) explicitly chose it
> over an alternative. That's qualitatively different from never being questioned.

**Analogy:** A law that survived a Supreme Court challenge vs one that was never
tested. The challenged one has been scrutinized and found valid.

**Computation:** `+2` if `tags.includes('conflict-resolved')`

**What it prevents:** Re-litigating decisions that have already been through the
conflict resolution process. A conflict survivor should be harder to displace
than a decision that was never challenged.

---

#### 6. Supersession Breadth: "How much history does this consolidate?"

> A decision that was created by merging 6 prior entries into one carries the
> weight of all that history. It's not just one opinion — it's the synthesis
> of multiple observations, errors, and prior decisions.

**Analogy:** A summary report that cites 10 sources vs a blog post with none.
The summary is grounded in more evidence, even if the blog post's conclusion
happens to be right.

**Computation:** `min(floor(supersedes.length / 2), 3)` — 2 superseded = +1,
4 = +2, 6+ = +3.

**Why divided by 2:** A microDream consolidation naturally supersets all the raw
execution entries it gathered. That's just how consolidation works — it doesn't
mean each superseded entry is independent evidence. The division normalizes for
the "gathering" nature of consolidation.

**What it prevents:** A narrow single-source decision from being treated as equal
to a broad synthesis of many prior entries.

---

#### 7. Constitutional: "Is this a hard rule, not a preference?"

> Constitutional rules are user-defined boundaries. "Never commit to main."
> "All secrets in the vault." "No raw SQL." These are not competing for
> evidence — they're **axioms**. The user set them as non-negotiable constraints.

**Analogy:** The rules of physics vs a strategy for winning a game. You can debate
strategy, but you can't debate gravity. Constitutional rules are the system's gravity.

**Computation:** `+10` if `tags.includes('constitution')`

**Special handling:** If both conflicting entries are constitutional, it's not a
conflict — it's a **constitutional amendment**. Two hard rules that contradict
each other means the rules themselves need changing, which requires explicit user
action. If only one is constitutional, it wins unconditionally against any
non-constitutional entry regardless of other signals.

### Evidence Score Computation

```typescript
function evidenceScore(entry: KBEntry): number {
  let score = 0;

  // Source provenance
  const provenance = { user: 5, execution: 4, 'dream:micro': 3, 'dream:session': 2, 'dream:deep': 1 };
  score += provenance[entry.source] ?? 0;

  // Duration standing (days, capped)
  const daysStanding = (Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24);
  score += Math.min(Math.floor(daysStanding), 5);

  // Task corroboration — count execution entries with overlapping tags created after
  // (computed at detection time, not inline — see below)
  // score += corroboratingTasks

  // Verification
  if (entry.tags.includes('verified')) score += 3;

  // Conflict survivor
  if (entry.tags.includes('conflict-resolved')) score += 2;

  // Supersession breadth
  if (entry.supersedes) score += Math.min(Math.floor(entry.supersedes.length / 2), 3);

  // Constitutional — absolute authority
  if (entry.tags.includes('constitution')) score += 10;

  return score;
}
```

### Task Corroboration (computed separately)

```typescript
async function corroborationScore(entry: KBEntry): Promise<number> {
  const executionEntries = await db.kbLog
    .filter(e => e.active && e.source === 'execution' && e.timestamp > entry.timestamp)
    .toArray();

  const overlapping = executionEntries.filter(e =>
    e.tags.some(t => entry.tags.includes(t))
  );

  return Math.min(overlapping.length, 5);
}
```

Total evidence = `evidenceScore(entry) + corroborationScore(entry)`.

---

## Conflict Types

### Type 0: Constitutional Override

> One or both entries are constitutional rules. Non-negotiable.

**Signal:** Either entry has `tags.includes('constitution')`.

**Auto-resolve:** Constitutional entry always wins. If both are constitutional,
escalate to user — that's a constitution amendment, not a conflict.

**No evidence scoring needed.** Constitutional authority is absolute.

---

### Type 1: Guiding (Hierarchy Enforcement)

> Higher-level decision overrides lower-level one. The lower entry has weak
> evidence — it's a recent synthesis with no track record.

**Pattern:**
- D1 (abstraction 7, strategic, evidence score 12): "All API calls must go through the gateway"
  - Standing for 5 days, verified, supersedes 4 entries
- D2 (abstraction 4, operational, evidence score 3): "Call the service directly for performance"
  - Fresh microDream insight, no task corroboration

**Signal:**
- Abstraction gap ≥ 2 (clearly different levels)
- Higher entry evidence score > lower entry evidence score by ≥ 4
- Lower entry has < 2 corroborating tasks

**Auto-resolve:** Higher wins. Lower entry gets deactivated, superseded by higher.
Log an observation: `"Auto-resolved (guiding): [higher] supersedes [lower]"`.

**Cascade:** Resolution keeps the higher entry's layers.

---

### Type 2: Self-Correcting (Ground Truth Override)

> Lower-level entry has accumulated enough evidence to challenge the higher-level
> assumption. The "a-ha!" moment — execution reality contradicts strategic theory.

**Pattern:**
- D1 (abstraction 7, strategic, evidence score 8): "Use PostgreSQL for all data storage"
  - Standing 3 days, verified, from session dream
- D2 (abstraction 3, execution, evidence score 11): "PostgreSQL connection pool exhausted under load,
  key-value cache reduced latency 10x"
  - Source: execution, corroborated by 4 tasks, survived 1 conflict, standing 6 days

**Signal:**
- Cross-level (abstraction gap ≥ 1)
- Lower entry evidence score ≥ higher entry evidence score
- Lower entry has `source` in `['execution', 'user']` OR corroboration score ≥ 3
- Higher entry is NOT constitutional

**Resolution:** Escalate to user with a **recommendation** to adopt the lower-level
insight. Present evidence scores so the user can see *why* the system is biased.

**User prompt format:**
```
CONFLICT DETECTED: Self-correcting insight vs. strategic assumption

Strategic (abs 7, evidence: 8): "Use PostgreSQL for all data storage"
  - Standing: 3 days | Verified | Source: dream:session

Execution evidence (abs 3, evidence: 11): "PostgreSQL pool exhausted, cache reduced latency 10x"
  - Standing: 6 days | 4 tasks corroborate | Source: execution | Survived 1 conflict

⚠ Recommendation: Adopt execution insight (stronger evidence)

(a) Adopt execution insight — update strategy
(b) Keep strategic decision — investigate further
(c) Merge — propose hybrid approach
```

**Cascade on (a):** Resolution creates a NEW entry at the higher abstraction level
(because it's now a strategic truth), with layers from both entries. The old
strategic entry gets superseded.

---

### Type 3: Doubtful (Genuine Ambiguity)

> Both decisions could work. Similar evidence weight, no clear winner.
> Neither has enough backing to claim authority over the other.

**Pattern:**
- D1 (abstraction 4, evidence score 7): "Use REST for external APIs"
- D2 (abstraction 4, evidence score 6): "Use GraphQL for external APIs"

**Signal:**
- Same abstraction level (gap = 0), OR
- Cross-level but evidence scores within ±3 of each other, AND neither meets
  self-correcting criteria

**Resolution:** Escalate to user. No recommendation bias — present neutrally with
evidence scores for both so the user can judge.

**User prompt format:**
```
CONFLICT DETECTED: Conflicting approaches (similar evidence)

Decision A (abs 4, evidence: 7): "Use REST for external APIs"
  - Standing: 2 days | Verified | 3 tasks corroborate

Decision B (abs 4, evidence: 6): "Use GraphQL for external APIs"
  - Standing: 1 day | Verified | 2 tasks corroborate

(a) Choose Decision A
(b) Choose Decision B
(c) Merge — propose combined approach
```

**Cascade:** Winning/merged entry gets `conflict-resolved` tag and union of both
layers, bypassing projector abstraction cap at L2/L3.

---

## Detection Algorithm

```
async detectConflictType(d1, d2):
  // Type 0: Constitutional
  const d1Const = d1.tags.includes('constitution')
  const d2Const = d2.tags.includes('constitution')
  if d1Const && d2Const:
    return CONSTITUTIONAL_AMENDMENT  // escalate — user must amend constitution
  if d1Const:
    return CONSTITUTIONAL_OVERRIDE   // auto: d1 wins
  if d2Const:
    return CONSTITUTIONAL_OVERRIDE   // auto: d2 wins

  // Compute evidence scores
  score1 = evidenceScore(d1) + await corroborationScore(d1)
  score2 = evidenceScore(d2) + await corroborationScore(d2)

  higher = d1.abstraction >= d2.abstraction ? d1 : d2
  lower  = d1.abstraction >= d2.abstraction ? d2 : d1
  higherScore = d1.abstraction >= d2.abstraction ? score1 : score2
  lowerScore  = d1.abstraction >= d2.abstraction ? score2 : score1

  absGap = abs(d1.abstraction - d2.abstraction)

  // Same level — always doubtful
  if absGap == 0:
    return DOUBTFUL

  // Cross-level with strong lower evidence — self-correcting
  const lowerHasExecution = lower.source in ['execution', 'user']
  const lowerCorroboration = await corroborationScore(lower)

  if lowerScore >= higherScore && (lowerHasExecution || lowerCorroboration >= 3):
    return SELF_CORRECTING

  // Cross-level with weak lower evidence — guiding
  if absGap >= 2 && (higherScore - lowerScore) >= 4 && lowerCorroboration < 2:
    return GUIDING

  // Everything else — doubtful (default to user judgment)
  return DOUBTFUL
```

## Resolution Summary

| Type | Auto? | Who decides | Cascade | Evidence needed |
|------|-------|-------------|---------|-----------------|
| Constitutional Override | Yes | System | Winner's layers | Constitution tag |
| Constitutional Amendment | No | User | Amendment flow | Both constitutional |
| Guiding | Yes | System (higher wins) | Higher's layers | Abs gap ≥2, score diff ≥4, low corroboration |
| Self-correcting | No | User (biased: adopt lower) | New entry, union layers | Lower score ≥ higher, execution source or ≥3 corroboration |
| Doubtful | No | User (neutral) | Union layers | Default / fallback |

## Why Evidence Scores Matter

Without scores, the system would make brittle decisions:
- "Higher always wins" → misses self-corrections where execution proves strategy wrong
- "Execution always wins" → a single flaky run could overturn a battle-tested strategy
- "Always escalate" → user fatigue, most conflicts are obvious hierarchy calls

With scores, the system can distinguish:
- A **fresh unverified insight** (score ~2-3) contradicting a **week-old verified strategy** (score ~12) → guiding, auto-resolve
- A **4-task-corroborated execution pattern** (score ~11) contradicting a **3-day session dream** (score ~8) → self-correcting, escalate with recommendation
- Two **equally-backed decisions** (scores within ±3) → doubtful, neutral escalation

## Implementation Notes

- Evidence scores are computed at detection time, not stored — they're derived from current KB state
- `conflict-resolved` entries bypass the projector's abstraction cap at L2/L3
- Guiding auto-resolutions still log an observation entry for audit trail
- Self-correcting resolutions create a new entry (don't just promote the lower one)
  because the insight needs reframing at strategic abstraction with proper context
- Corroboration queries can be cached within a single `detectConflicts` run

---

## Resolution Audit Trail

Every conflict resolution — whether automatic or user-driven — creates a formal
KB entry. This creates a **visible, queryable record** that can be reviewed later.

### Why

- **Automatic resolutions can be wrong.** A guiding auto-resolve might have
  suppressed a valid insight. With audit entries, you can find and override them.
- **Patterns emerge over time.** If the same type of conflict keeps happening,
  the audit trail reveals it. Maybe a constitutional rule is needed.
- **Accountability.** Every resolution says *who* decided, *why*, and *what*
  the evidence was at the time.

### Resolution Entry Schema

Every resolution writes a KB entry with these fields:

```typescript
{
  // Standard fields
  timestamp: Date.now(),
  category: 'resolution',
  abstraction: Math.max(d1.abstraction, d2.abstraction) + 1,  // one above the conflict
  layer: [...new Set([...d1.layer, ...d2.layer])],            // cascade to all involved layers
  source: 'conflict-resolution',
  active: true,
  project: d1.project || 'target',

  // Resolution-specific
  tags: [
    'conflict-resolved',
    `type:${conflictType}`,           // 'guiding', 'self-correcting', 'doubtful', 'constitutional'
    `method:${resolutionMethod}`,     // 'auto', 'user:pick-a', 'user:pick-b', 'user:merge'
    `winner:${winnerId}`,
  ],
  supersedes: [d1Id, d2Id],

  // The text is the audit record — human-readable + machine-parseable
  text: formatResolutionText(conflictType, d1, d2, winner, scores, userChoice),
}
```

### Resolution Text Format

The `text` field includes BOTH conflicting decisions in full, so you can always
see what was at stake — even after the losing entry has been deactivated.

**Automatic (guiding):**
```
[AUTO:guiding]
D1 (#42): "All API calls must go through gateway" (abs 7, evidence 12)
  source=dream:session | standing=5d | verified | supersedes 4 | corroboration 4
D2 (#47): "Call service directly for performance" (abs 4, evidence 3)
  source=dream:micro | standing=0d | unverified | supersedes 0 | corroboration 0
→ Winner: D1. Reason: hierarchy enforcement — higher has strong evidence, lower has weak backing.
```

**User-driven (self-correcting):**
```
[USER:self-correcting]
D1 (#38): "Use PostgreSQL for all data storage" (abs 7, evidence 8)
  source=dream:session | standing=3d | verified | supersedes 2 | corroboration 1
D2 (#51): "PostgreSQL pool exhausted, cache reduced latency 10x" (abs 3, evidence 11)
  source=execution | standing=6d | verified | conflict-survivor | supersedes 0 | corroboration 4
→ Winner: D2. User chose (a) Adopt execution insight.
```

**User-driven (doubtful):**
```
[USER:doubtful]
D1 (#55): "Use REST for external APIs" (abs 4, evidence 7)
  source=dream:micro | standing=2d | verified | supersedes 2 | corroboration 3
D2 (#58): "Use GraphQL for external APIs" (abs 4, evidence 6)
  source=dream:micro | standing=1d | verified | supersedes 0 | corroboration 2
→ Merged. User chose (c) REST for public APIs, GraphQL for internal.
```

### Querying Resolutions

```typescript
// Find all automatic resolutions (candidates for override review)
const autoResolutions = await KBHandler.queryLog({
  category: 'resolution',
  tags: ['method:auto'],
  active: true,
});

// Find all resolutions of a specific type
const guidingResolutions = await KBHandler.queryLog({
  category: 'resolution',
  tags: ['type:guiding'],
  active: true,
});

// Find recent self-correcting overrides
const corrections = await KBHandler.queryLog({
  category: 'resolution',
  tags: ['type:self-correcting'],
  active: true,
  limit: 10,
});
```

### Overriding an Automatic Resolution

Since every auto-resolution is a regular KB entry, overriding it is just
superseding it with a new entry:

```typescript
// User disagrees with an auto-guiding resolution
await KBHandler.supersedeEntries({
  text: 'Override: execution evidence was stronger than the auto-resolve assessed',
  category: 'decision',
  abstraction: resolutionEntry.abstraction,
  layer: resolutionEntry.layer,
  tags: ['override', 'conflict-resolved'],
  source: 'user',
  supersedes: [resolutionEntry.id],
});
```

This reactivates the previously-deactivated losing entry and replaces the
resolution with the user's judgment — all through the existing chain mechanism.

## Status

- [x] Type 3 (Doubtful): implemented — current `detectConflicts` + `registerConflictResolutionHandler`
- [x] Layer cascade on resolution
- [x] Projector bypass for `conflict-resolved` entries
- [x] Evidence score computation (`evidenceScore`, `corroborationScore`)
- [x] Type 0 (Constitutional): auto-resolve + amendment escalation
- [x] Type 1 (Guiding): auto-resolve in `detectConflicts`
- [x] Type 2 (Self-correcting): evidence-based biased escalation
- [x] Updated user prompts with evidence breakdown
- [x] Tests for all types
