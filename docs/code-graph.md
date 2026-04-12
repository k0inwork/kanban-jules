# Knowledge-Joern: Code Graph Module

## Status: Proposal (April 6, 2026)

A knowledge module that provides code structure analysis and change impact estimation. The architect discovers these capabilities on load, generates its own workflow constitution, and decides when to use them during task generation.

**Sub-documents:**

- [code-graph-spec.md](code-graph-spec.md) — Manifest, capabilities, types, architect config, query layer
- [code-graph-design.md](code-graph-design.md) — Data flow, self-constitution model, task splitting, CI pipeline
- [code-graph-code.md](code-graph-code.md) — Full implementation: JoernAnalyzer, constitution generator, GitHub Action, tests

---

## 1. Why

The architect currently receives a user request and generates a single task protocol. It has no visibility into code structure, no tools to query the codebase, and no way to decide whether work should be one task or many. Every module's data gets baked into prompt text — lossy, hardcoded, and static.

This module provides **queryable code structure** that the architect calls on demand. Combined with a self-constitution model, the architect bootstraps its own workflow from whatever modules are available.

## 2. Core Idea

**Joern runs in CI. Fleet reads JSON. Architect queries on demand.**

```
Push to repo → GitHub Action (Joern) → .joern/*.json committed to repo
                                         ↓
Fleet loads JSON via RepositoryTool → architect queries during task generation
                                         ↓
Architect discovers capabilities → generates its own constitution → uses tools as needed
```

## 3. The Self-Constitution Model

### The old model (hardcoded)

```
composeArchitectPrompt(modules) → bakes impact data into text → LLM one-shots a protocol
```

Every new module requires prompt changes. Data is lossy. LLM does graph math in its head.

### The new model (architect bootstraps itself)

```
Fleet starts
  → modules load, each declares capabilities
  → architect reads all capabilities
  → architect generates its own constitution (one LLM call)
  → constitution = generated workflow + user notes
  → saved to settings

User submits task
  → architect reads its constitution
  → follows its own workflow
  → calls tools as needed
  → outputs TaskPlan
```

The architect writes its own process based on what's available. No hardcoded prompts.

### Constitution = generated + user notes

```
┌─────────────────────────────────────────┐
│  Architect Constitution                 │
│                                         │
│  ## Generated (auto, read-only)         │
│  Workflow, capabilities, tool usage...  │
│                                         │
│  ## User Notes (persistent)             │
│  - always ask before splitting tasks    │
│  - don't split tasks smaller than 2 steps│
│  - always read existing tests first     │
└─────────────────────────────────────────┘
```

When modules change → generated part regenerates. User notes stay untouched.

## 4. Module Capabilities

Not just tools with schemas. Each module declares **what it enables**:

```json
{
  "action": "task-splitting",
  "description": "Can determine if work items can run as separate tasks without conflicts.",
  "tools": ["CodeGraph.suggestTaskSplit"],
  "suggestedWhen": "user request spans multiple unrelated areas"
}
```

The architect reads these and decides its own workflow. Capabilities are hints, not commands.

## 5. Task Splitting

The architect decides whether to split based on:
- The user request (does it naturally have multiple parts?)
- Capability hints (a module suggests splitting is useful here)
- Its own self-generated constitution (what workflow did it decide on?)

```
Architect identifies two work areas → calls suggestTaskSplit → no overlap → creates two tasks
Architect identifies two work areas → calls suggestTaskSplit → overlap → creates one task with sequential steps
```

No changes to TaskStep, Task, orchestrator, or executor. The splitting decision is entirely at the architect level.

## 6. What Gets Computed in CI

| File | Content |
|---|---|
| `metadata.json` | Timestamp, commit SHA, Joern version, file count |
| `file-deps.json` | File → imports / imported-by graph |
| `usages.json` | Symbol → which files/methods use it |
| `clusters.json` | Auto-detected module boundaries |
| `dataflow.json` | Data flow paths (unused in v1, kept for future) |

## 7. Fallback

No `.joern/` in repo? Module loads empty. Capability `impact-analysis` reports no data. Architect's generated constitution says "no impact data available, skip splitting checks." Graceful degradation, no errors.

## 8. Security & Performance

- **No secrets in `.joern/`**: only structural data — function names, file paths, import edges
- **Index size**: ~50-200KB total
- **CI cost**: Joern parse in 1-3 minutes per push
- **Runtime cost**: single JSON load, cached in memory
- **Constitution generation**: one LLM call on startup, cached until modules change

## 9. Future Extensions

- **Live re-index**: process module that triggers re-indexing on task completion
- **Cross-repo analysis**: index multiple repos, trace cross-repo dependencies
- **Test impact**: "Which tests should I run if I change file X?"
- **Architecture drift detection**: compare cluster boundaries across commits
- **New modules = new capabilities**: architect regenerates constitution automatically
