# Knowledge Projection & Escalation Pipeline

## Context

We have a 4-layer agent hierarchy where a single LLM plays different roles via different prompts:

| Layer | Role | What it does |
|-------|------|-------------|
| L0 | Yuan | Self-management, meta-reflection, strategic oversight |
| L1 | Overseer | Tactical coordination, board-level decisions |
| L2 | Architect | Step planning, executor selection, protocol generation |
| L3 | Programmer/Executor | Code generation, tool execution, concrete work |

All are the same agent wearing different hats. Knowledge projection gives each hat the right context. Escalation lets a lower hat ask a higher hat for help.

---

## Core Principle: Two-Way Knowledge Flow

Knowledge has a direction. Understanding this is critical to the design.

### Knowledge flows UP (Observation)

The programmers/executors (L3) are the **primary knowledge producers**. They run code, hit errors, and observe the real behavior of the project. Every run generates raw observations.

```
L3 Executor runs code
  → hits an error, observes behavior
  → records via KB_record({ category: "error", abstraction: 2, source: "execution" })
  → raw observations accumulate in kbLog

Upper layers (L0-L2) record knowledge too, but it's about self — how the agent system itself is performing.
No module currently synthesizes patterns from observations.
Future: Jules session analysis or dream engine could produce higher-abstraction entries.
```

The key insight: **most knowledge about the project comes from the bottom**. Executors (Jules, local, GitHub Actions) are the ones touching real code, running real tests, hitting real errors. Their observations are the foundation.

### Retrieved knowledge flows DOWN (Projection / RAG)

The projector retrieves accumulated knowledge from the KB and injects it into the prompt at each layer. This is RAG — Retrieval-Augmented Generation. The prompt is augmented with relevant KB content filtered by layer, project, tags, and char budget.

No synthesis happens in the projector itself. It's a filter + budget allocator. It retrieves what's already there and passes it down.

```
Projector retrieves:
  → kbLog entries (filtered by layer, project, executor, tags)
  → kbDocs (filtered by layer, project, tags)
  → constitution (from projectConfigs)
  → board state (L0/L1 only)
  → agentContext (L3 for specific task)

Future synthesis (not yet built):
  → Dream engine could analyze L3 errors and produce L1/L2 pattern docs
  → Jules session transcripts could be analyzed post-run for patterns
  → These would land in kbDocs and be picked up by the projector naturally
```

---

## Projection Model: Base + RAG + Experience

Every prompt is composed of three distinct parts. The projector (also called the injector) assembles all three and injects them into the prompt.

### 1. BASE — static instructions

Constitution + project config. High-level instructions on project structure, phases, conventions. Always the same for a given project.

```
Constitution           → hardcoded or user-customized, describes the project
Project config         → repo URL, branch, project-specific rules
```

This is the foundation. Doesn't change between tasks.

### 2. RAG — retrieved by task relevance

KB docs matched by relevance to the task description. "What specs, designs, or references exist for THIS kind of work?"

Selection: extract tags from task description → match against kbDocs with those tags.

```
Task: "Add REST API endpoint for user authentication"
  → tags extracted: ["api", "rest", "authentication", "user"]
  → retrieve kbDocs tagged with matching terms
  → specs, design docs, references relevant to this domain
```

Budget-capped per layer. L3 gets tight, concrete specs. L2 gets broader design docs.

### 3. EXPERIENCE — accumulated from past runs

KB log entries from previous executions, filtered by tags (executor, domain). "What happened when we tried something like this before?"

Selection: match by executor + domain tags → sort by recency + abstraction.

```
Task runs on executor-jules about "API endpoints"
  → retrieve log entries tagged ["executor-jules", "api"]
  → past errors, observations from similar work
  → sorted: most recent first, higher abstraction first
```

Budget-capped per layer. Grows richer with every run. First run: empty. After 100 runs: deep knowledge of what works and what doesn't.

### Composition

```
┌─────────────────────────────────────────┐
│               PROMPT                     │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  1. BASE (static)               │    │
│  │  Constitution + project config   │    │
│  │  Always the same.                │    │
│  └─────────────────────────────────┘    │
│  +                                      │
│  ┌─────────────────────────────────┐    │
│  │  2. RAG (retrieved by task)     │    │
│  │  KB docs matched by task tags    │    │
│  │  "What knowledge exists for     │    │
│  │   THIS kind of task?"           │    │
│  └─────────────────────────────────┘    │
│  +                                      │
│  ┌─────────────────────────────────┐    │
│  │  3. EXPERIENCE (accumulated)    │    │
│  │  KB log entries by executor/tags │    │
│  │  "What happened before when     │    │
│  │   we did similar work?"         │    │
│  │  Grows with every run.          │    │
│  └─────────────────────────────────┘    │
│  +                                      │
│  ┌─────────────────────────────────┐    │
│  │  TASK CONTEXT (given per step)  │    │
│  │  Task title, description         │    │
│  │  Step title, description         │    │
│  │  AgentContext (previous steps)   │    │
│  │  Available APIs                  │    │
│  │  Error context (retry)           │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

The key difference between RAG and EXPERIENCE:
- **RAG** = docs you wrote deliberately (specs, designs, references). Selected by *task relevance*.
- **EXPERIENCE** = observations from past runs (errors, patterns). Selected by *tags* (executor + domain).

Both are retrieved by the projector. Both are budget-capped. Both get better as the KB grows.

### Tag quality is critical

The projector matches by tags. So the tags on KB_record and KB_saveDoc calls determine what gets retrieved. Current tags are too narrow: `[executorId, taskId]`. They should include domain tags that describe the *kind of work*:

```
// Current (too narrow):
KB_record({ tags: ["executor-local", "task-42"] })

// Better (describes the domain):
KB_record({ tags: ["executor-local", "api", "authentication", "error"] })
```

The task description → tag extraction step (for RAG) could be done by:
- Simple keyword extraction from task description
- LLM-based tag suggestion at task creation time
- Manual tags added by the user

---

## Projection Budgets

```
L0: { log: 4800, docs: 2400 }  // Yuan sees everything
L1: { log: 3600, docs: 1800 }  // Overseer sees tactical view
L2: { log: 3600, docs: 2400 }  // Architect — bumped docs for design/spec
L3: { log: 2400, docs: 1200 }  // Programmer — tight, only concrete
```

L3 gets concrete errors and specs (what went wrong last time).
L2 gets broader patterns and design docs.
L1 gets board state (tactical overview).
L0 sees everything (strategic reflection).

### What Each Layer Sees

| Section | L0 | L1 | L2 | L3 |
|---------|----|----|----|-----|
| **BASE** (constitution) | yes | yes | yes | yes (in prompt, not projector) |
| **RAG** (kbDocs, budgeted) | 2400 chars | 1800 chars | 2400 chars | 1200 chars |
| **EXPERIENCE** (kbLog, budgeted) | 4800 chars | 3600 chars | 3600 chars (abstraction ≤5) | 2400 chars (abstraction ≤5) |
| Board state | yes | yes | — | — |
| AgentContext | — | — | — | yes (per task) |

---

## Injection Points (Implemented)

### Architect (L2) — `src/modules/architect-codegen/Architect.ts`

```
generateProtocol()
  → ProjectorHandler.project({ layer: 'L2', project: 'target' })
  → injected into composeArchitectPrompt() as RELEVANT KNOWLEDGE
```

### Programmer (L3) — `src/core/orchestrator.ts`

```
runStep()
  → ProjectorHandler.project({ layer: 'L3', project: 'target', taskId, executor })
  → injected into composeProgrammerPrompt() as RELEVANT KNOWLEDGE
```

---

## Error Recording (Implemented)

The programmer writes JavaScript that runs in the sandbox. On error, it records to the KB:

```
ERROR RECORDING:
When your code catches an error, record it so future executions can learn:
  await KB_record({
    text: "concise description of what went wrong",
    category: "error",
    abstraction: 2,
    layer: ["L2", "L3"],
    tags: ["<executor id>", "<task id>"],
    source: "execution"
  });
```

This makes L3 the primary knowledge producer. Errors flow up → accumulate in kbLog → get projected back down at L3 via EXPERIENCE.

**Note:** No module currently synthesizes patterns from these errors. Future work: analyze Jules session transcripts or run dream analysis to produce higher-abstraction kbDocs.

---

## Escalation

### Phase 1 (implemented): Escalation to user = askUser()

The programmer already has `askUser()`. We formalize escalation as a structured call:

```
ESCALATION TO USER:
If stuck after multiple attempts, escalate:
  await askUser("ESCALATION REPORT:\nTask: <title>\nStep: <step>\n
    Attempts: N\nLast Error: <summary>\nWhat I tried: <list>\n
    What I need: <specific question>");
```

### Phase 2 (future): Inter-agent escalation via mailbox

When programmer is stuck, it could escalate to architect/overseer instead of always going to user. Requires:
- Extended AgentMessage with `recipient`, `type: 'escalation'`, `escalationContext`
- `escalate()` sandbox binding
- Agent scheduling (architect/overseer wake up on trigger)
- Push notifications via EventBus `agent:mail` event

---

## The Flywheel (Current State)

```
┌──────────────────────────────────────────┐
│                                          │
│  L3 executor runs code                   │
│       ↓                                  │
│  hits error → KB_record(error)           │
│       ↓                                  │
│  error lands in kbLog (abstraction: 2)   │
│       ↓                                  │
│  next run: projector retrieves it        │
│       ↓                                  │
│  injected as EXPERIENCE at L3            │
│       ↓                                  │
│  L3 programmer sees past errors          │
│       ↓                                  │
│  writes better code → fewer errors       │
│                                          │
│  (Future: dream/Jules analysis adds      │
│   higher-abstraction entries to kbDocs,  │
│   enriching RAG retrieval)              │
│                                          │
└──────────────────────────────────────────┘
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                      L0 Yuan                         │
│  BASE: constitution                                  │
│  RAG: widest kbDocs (L0 budget)                      │
│  EXPERIENCE: widest kbLog (L0 budget)                │
│  Writes: strategic self-observations (future)        │
├─────────────────────────────────────────────────────┤
│                     L1 Overseer                      │
│  BASE: constitution                                  │
│  RAG: tactical kbDocs + board state (L1 budget)      │
│  EXPERIENCE: tactical kbLog (L1 budget)              │
│  Writes: tactical self-observations (future)         │
├─────────────────────────────────────────────────────┤
│                     L2 Architect                     │
│  BASE: constitution                                  │
│  RAG: design docs + specs (L2 budget)                │
│  EXPERIENCE: patterns + errors (L2 budget, abs ≤5)   │
│  Writes: — (receives, doesn't produce)               │
├─────────────────────────────────────────────────────┤
│                 L3 Programmer/Executor               │
│  BASE: constitution (in prompt)                      │
│  RAG: specs + references (L3 budget)                 │
│  EXPERIENCE: concrete errors (L3 budget, abs ≤5)     │
│  Writes: KB_record(error) — primary KB producer      │
│  Escalates: askUser() when stuck                     │
└─────────────────────────────────────────────────────┘

Knowledge flow:
  UP:   L3 ──raw errors──→ kbLog (accumulates over time)
  DOWN: PROJECTOR assembles BASE + RAG + EXPERIENCE → injects into prompt
  RAG:   kbDocs matched by task tags (domain relevance)
  EXP:   kbLog matched by executor + domain tags (run history)
  Future: dream/Jules analysis → synthesized kbDocs → enriches RAG
```
