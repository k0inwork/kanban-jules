# Fleet: Scope & System Identity

## What Fleet Is

Fleet is a **browser-based AI agent orchestrator**. It dispatches work to remote autonomous agents (Jules, Claude, local CLI tools) and manages the full lifecycle: planning, execution, verification, and documentation.

Fleet is **not** a code assistant. It does not edit files itself. It does not autocomplete. It **orchestrates** — decomposing user goals into tasks, routing each task to the best executor, tracking progress, verifying results, and producing documentation.

```
User says: "Implement auth for the API"
                    │
         ┌──────────┴──────────┐
         │  Fleet orchestrates  │
         │  ┌───────────────┐  │
         │  │ 1. Plan tasks  │  │
         │  │ 2. Route to    │  │
         │  │    executors   │  │
         │  │ 3. Track work  │  │
         │  │ 4. Verify done │  │
         │  │ 5. Document it │  │
         │  └───────────────┘  │
         └──────────┬──────────┘
                    │
      ┌─────────────┼─────────────┐
      │             │             │
   Jules VM     Claude CLI    WASM/Local
   (code gen)   (reasoning)  (scripts)
```

---

## Three Core Pillars

### Pillar 1: Local Document Generation

Fleet produces documents from agent work — locally, in the browser, without external services.

**What it generates:**
- Design specs and architecture decisions
- Implementation plans and task breakdowns
- Progress reports and status summaries
- Code analysis reports
- Constitution amendments (project rules)

**How it works:**
- `architect-codegen` produces step plans and analysis
- `process-dream` synthesizes insights from execution history
- `knowledge-artifacts` stores and versions all generated documents
- Documents are artifacts: versioned, searchable, citable by downstream tasks

**Current state:**
- Artifact storage and lifecycle (draft → in_review → revised → approved) exists
- `architect-codegen` generates step protocols but not standalone docs
- `process-dream` produces KB entries but not user-facing documents
- **Gap:** No dedicated document template/pipeline. Artifacts are ad-hoc strings. Need structured document types (spec, report, decision-log) with templates.

### The Project Entity (Structural Backbone)

Everything in Fleet orbits a **Project**. One project = one repo + branch + constitution. The app always has exactly one "current project" active. Full proposal: `docs/PROPOSAL_PROJECT_MANAGEMENT.md`.

**Data model:**
```
Project {
  id: string            // uuid, primary key
  name: string          // human-readable, e.g. "Fleet MVP"
  repoUrl: string       // e.g. "k0inwork/fleet"
  repoBranch: string    // e.g. "main"
  constitution: string  // full constitution text (may be empty)
  createdAt: number
  updatedAt: number
}
```

**What a Project scopes:**
- All data tables get `projectId`: tasks, kbLog, kbDocs, taskArtifacts, taskArtifactLinks, messages, pushQueue, julesSessions
- Legacy rows with `projectId: undefined` are visible in all projects (safe migration)
- `projectConfigs` table deprecated — constitution lives on the project record

**UX — header dropdown:**
- 3 states: no projects (first launch), unselected, selected
- Dropdown in header: switch/create/edit/delete projects
- `currentProjectId` in localStorage — persists across sessions
- Create/edit modal with constitution template dropdown (research, mvp, testing, production, blank)

**Constitution templates (built-in presets):**
- **Research** — read-only exploration, document findings, no branching
- **MVP** — ship fast, branches per task, working code over perfect
- **Testing** — comprehensive coverage, integration over unit tests
- **Production** — strict gates, all changes via PR, no bare catches
- **Blank** — empty, user writes from scratch

**Why this matters:**
- Fixes `configs[0]` bug — no more grabbing wrong constitution
- Multiple projects — switch repos/branches without touching settings
- Clean data scoping — tasks, KB, artifacts, messages all belong to a project
- Constitution per project — each project has its own rules, correctly projected

**Current state:** Fragmented. `ProjectConfig` exists but only stores constitution text. No unified project entity. Tasks link to repos via `repoName`/`branchName` strings scattered across tables. No project-scoped views or dashboards. Proposal written, implementation not started.

**Implementation order (14 steps):** db schema → types → templates → UI components → App.tsx integration → host/orchestrator → consumer updates (projector, dream, process-agent, KB handler, constitution editor).

### Pillar 2: Implementation Tracking

Fleet tracks what was done, by whom, with what result — across all executors.

**What it tracks:**
- Task lifecycle: TODO → IN_PROGRESS → IN_REVIEW → DONE
- Per-task: which executor ran, what branch was created, what logs were produced, what artifacts resulted
- Per-executor: success rate, failure patterns, latency profile
- Branch-to-task mapping: agents create mergeable git branches, Fleet links them to tasks
- Yuan sandbox: local analysis artifacts (no git changes, just IDB artifacts)

**How it works:**
- Dexie/IndexedDB stores all state (tasks, artifacts, sessions, logs, messages)
- `moduleLogs` per task captures executor output
- `kbLog` and `kbDocs` accumulate knowledge across tasks
- `process-reflection` classifies and grades execution outcomes
- `watchdogDream` detects problems with running tasks in real-time

**Current state:**
- Task CRUD and status tracking: complete
- Module logs per executor: complete
- KB knowledge accumulation: complete
- Executor profiling (success/fail rates): partial — schema exists, not populated
- Branch-to-task mapping: partial — Jules creates branches, Fleet doesn't systematically store branch names
- PR tracking: missing — Jules can create PRs but Fleet doesn't store PR URLs
- **Gap:** Fleet knows tasks ran but the bridge to git (branch names, PR URLs, commit SHAs) is incomplete.

### Pillar 3: Stage Assessment

Fleet evaluates project state against defined stages and gates progression.

**What it assesses:**
- Current project stage (Discovery → Design → Implementation → Testing → Deployment)
- Stage completeness: all expected artifacts exist? all tasks done?
- Quality gates: tests pass? review approved? no regressions?
- Constitution compliance: project rules followed?

**How it works:**
- `process-project-manager` reads constitution, compares board state against stage expectations
- Constitution defines stages, expected artifacts per stage, and rules
- `process-dream` deep level reviews overall project health
- `knowledge-kb` provides accumulated context for assessment
- User approves/rejects assessments via mailbox proposals

**Current state:**
- Constitution system: complete (per repo+branch, editable, templates)
- ProcessAgent reviews board state against constitution: complete
- `checkGates` tool: gathers constitution stages + artifact statuses, LLM compares substance (not just existence)
- Artifact lifecycle: draft → in_review → revised → approved, with `updateArtifactStatus` tool
- Quality assessment: LLM reads artifact content, checks substance against constitution stage expectations
- **What's working:** The react-loop ProcessAgent already does meaningful assessment — it reads artifacts, judges quality, promotes through lifecycle stages, and saves approved artifacts to KB.
- **Remaining gaps:**
  - Assessment is advisory (alerts only) — no hard gate enforcement that blocks progression
  - No automated regression detection (re-run verification after changes)
  - No quantitative quality scoring — assessment is qualitative LLM judgment

---

## What Fleet Is Not

| Fleet is | Fleet is not |
|----------|-------------|
| Agent dispatcher | Code editor |
| Task orchestrator | Autocomplete |
| Document generator | Documentation site |
| Progress tracker | Project management tool (Jira, Linear) |
| Stage assessor | CI/CD pipeline |
| Knowledge accumulator | Database |
| Browser application | Cloud service |

---

## Executors: The Hands

Fleet dispatches to autonomous agents. Each executor has different strengths:

| Executor | Type | Best for | State |
|----------|------|----------|-------|
| `executor-jules` | Cloud VM (Google) | Large implementation tasks, full builds | Active |
| `executor-github` | GitHub Actions VM | CI/CD, builds, pipelines | Active |
| `executor-local` | Browser sandbox | File ops, analysis, artifact management | Active |
| `executor-claude` | Local Claude CLI | Reasoning, review, quick tasks | Dev-only |
| `executor-wasm` | WASM busybox | Shell commands, grep, scripts | Stub |

---

## Architecture at a Glance

```
Browser SPA (React 19 + Vite 6)
├── Kanban Board (task visualization)
├── Orchestrator (OBSERVE → THINK → PLAN → ACT loop)
├── Module System (20 modules, manifest-declared)
│   ├── Architects  — plan tasks, generate code/protocols
│   ├── Executors   — run tasks on remote/local compute
│   ├── Knowledge   — store, search, analyze information
│   ├── Channels    — communicate with user and external systems
│   └── Processes   — background agents (dream, reflect, watchdog)
├── Agent Bus (inter-module communication)
├── Dream Engine (knowledge consolidation + watchdog intervention)
├── Yuan Agent (in-browser LLM, sandboxed via Sval)
└── Dexie DB (25 schema versions, 11 tables)
```

---

## Current Numbers

- **20 days** of development (Mar 31 — Apr 20, 2026)
- **266 commits** from 7 contributors (5 non-human)
- **115 source files**, 25 test files
- **~25,760 LOC** total
- **20 modules** across 5 categories
- **407 tests passing**, 12 failing (96.4%)
- **25 Dexie schema migrations** (v1 → v25)

---

## Priority Gaps (by Pillar)

### Document Generation
1. ~~Structured document templates~~ — **done**: `Templates.ts` seeds 4 templates (design-spec, api-analysis, implementation-plan, test-report); LLM extracts artifact names from constitution on save (`extractArtifactNames`); `KBBrowser` template dropdown populated from `project.artifactNames`; file upload for custom templates via modal
2. Document generation pipeline (gather context → draft → review → approve)
3. Export formats (markdown, PDF future)

### Implementation Tracking
1. Branch-to-task mapping (which branch did each agent create, link to PR)
2. Executor profiling dashboard (success rates, latency, cost)
3. Yuan sandbox: track analysis artifacts produced locally

### Stage Assessment
1. Artifact quality scoring (not just existence)
2. Stage gate enforcement (block progression until approved)
3. Regression detection (re-run verification after changes)
