# Proposal: Project Management

Introduce a **Project** as the primary scoping unit. One project = one repo + branch + constitution. The app always has exactly one "current project" active. Switching projects means switching repos, branches, and operating rules.

---

## Problem

Today the app has no project concept:

- `repoUrl` and `repoBranch` are free-floating localStorage values with no identity
- `ProjectConfig` (constitution) is keyed by `repoUrl:branchName` but nothing references it as a unit
- Tasks, KB entries, artifacts, messages — all live in one global bucket
- `ProjectorHandler` and `deepDream` grab `configs[0]` — breaks if multiple configs exist
- No way to work on two repos or two branches without manually swapping settings
- No way to say "this task belongs to project X"

## What a Project Is

```
Project {
  id: string          // uuid
  name: string        // human-readable, e.g. "Fleet MVP"
  repoUrl: string     // e.g. "k0inwork/fleet"
  repoBranch: string  // e.g. "main"
  constitution: string // full constitution text (may be empty)
  createdAt: number
  updatedAt: number
}
```

A project bundles **what you're working on** (repo, branch) and **the rules** (constitution). It does NOT bundle app settings (API keys, model choice, provider) — those remain app-level in localStorage.

### What Changes, What Doesn't

| Concern | Before | After |
|---|---|---|
| Repo URL / Branch | localStorage | Project record in DB |
| Constitution | `ProjectConfig` table, keyed `repo:branch` | `project.constitution` field |
| API keys, model, provider | localStorage | localStorage (unchanged) |
| Jules endpoint, source name/id | localStorage | localStorage (unchanged) |
| Module configs | localStorage | localStorage (unchanged) |
| Autonomy mode | localStorage | localStorage (unchanged) |

---

## UX

The header always has a **project dropdown**. It is the only project management UI. No full-screen picker, no separate page.

### Header States

#### No projects exist (first launch)

```
┌──────────────────────────────────────────────────────────┐
│ 🤖 Agent Kanban                                          │
│ [ No Projects · Create one ▼ ]                           │
│                                                          │
│  ┌─────────────────────────┐                             │
│  │ + New Project           │  ← only option              │
│  └─────────────────────────┘                             │
└──────────────────────────────────────────────────────────┘

Board area: "Select or create a project to get started."
```

#### Projects exist but none selected

```
┌──────────────────────────────────────────────────────────┐
│ 🤖 Agent Kanban                                          │
│ [ Select Project ▼ ]                                     │
│                                                          │
│  ┌─────────────────────────┐                             │
│  │ Fleet Research          │                             │
│  │ Fleet MVP               │                             │
│  │ ─────────────────────── │                             │
│  │ + New Project           │                             │
│  └─────────────────────────┘                             │
└──────────────────────────────────────────────────────────┘

Board area: "Select or create a project to get started."
```

#### Project selected (normal operation)

```
┌──────────────────────────────────────────────────────────┐
│ 🤖 Agent Kanban                                          │
│ Fleet MVP · k0inwork/fleet @ main ▼                      │
│                                                          │
│  ┌─────────────────────────┐                             │
│  │ ✓ Fleet MVP             │  ← current, highlighted    │
│  │   Fleet Research        │                             │
│  │ ─────────────────────── │                             │
│  │ + New Project           │                             │
│  │ ✎ Edit Project         │                             │
│  │ ✕ Delete Project       │                             │
│  └─────────────────────────┘                             │
└──────────────────────────────────────────────────────────┘

Board area: normal kanban board with project-scoped data.
```

All other header buttons (review, mailbox, repo browser, settings, autonomy mode, new task) remain. The project dropdown is just added to the header alongside them.

### Create / Edit Project Form

A modal that appears when you click "New Project" or "Edit Project" from the dropdown.

```
┌─────────────────────────────────────────────────────────┐
│  Create Project                                    [✕]  │
│                                                         │
│  Name           [ Fleet MVP                        ]    │
│  Repo URL       [ k0inwork/fleet                  ]    │
│  Branch         [ main                            ]    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Constitution     [ Research Template ▼ ]         │   │
│  │                   ┌──────────────────────┐       │   │
│  │                   │ Research             │       │   │
│  │                   │ MVP                  │       │   │
│  │                   │ Testing              │       │   │
│  │                   │ Production           │       │   │
│  │                   │ Blank                │       │   │
│  │                   └──────────────────────┘       │   │
│  │                                                  │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │ ## Objective                             │   │   │
│  │  │ Explore the codebase, understand         │   │   │
│  │  │ architecture, document findings.         │   │   │
│  │  │                                          │   │   │
│  │  │ ## Rules                                 │   │   │
│  │  │ - Read-only: no code modifications       │   │   │
│  │  │ - Document all findings                  │   │   │
│  │  │ - Generate research report artifact      │   │   │
│  │  │                                          │   │   │
│  │  │ ## Gates                                 │   │   │
│  │  │ - Research report: draft → approved      │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  [ Cancel ]                            [ Create ]       │
└─────────────────────────────────────────────────────────┘
```

The template dropdown pre-fills the textarea. The user can edit freely after selecting. The dropdown is just a convenience — it populates the text, nothing more.

### Constitution Templates

Built-in presets, hardcoded in the app. Each is a markdown string that populates the textarea.

#### Research

```markdown
## Objective
Explore the codebase, understand architecture, document findings.

## Rules
- Read-only: no code modifications
- Document all findings as artifacts
- Generate a research report artifact before closing

## Gates
- Research report: draft → in_review → approved

## Constraints
- No branching — all work on main
- All output goes to artifact documents, not code files
```

#### MVP

```markdown
## Objective
Build the minimum viable product. Ship fast, iterate.

## Rules
- All changes via branches (task/{taskId})
- Tests encouraged but not required for initial implementation
- Prefer working code over perfect code

## Gates
- Feature spec: draft → approved
- Implementation: verified by manual review

## Constraints
- No refactoring unless directly related to the feature
- No documentation generation unless requested
```

#### Testing

```markdown
## Objective
Comprehensive test coverage. All existing features must be tested.

## Rules
- Every PR must include tests for changed code
- No merge without passing test suite
- Integration tests over unit tests where possible
- Test files must follow existing naming conventions

## Gates
- Test plan: draft → approved
- Test implementation: all tests passing
- Coverage report: generated and reviewed

## Constraints
- No code changes outside test files unless fixing a bug found during testing
- No skipping failing tests — fix or flag
```

#### Production

```markdown
## Objective
Hardening for production deployment. Strict quality gates.

## Rules
- All changes via PR with review
- Every change must have tests
- No direct pushes to main
- All CI checks must pass

## Gates
- Design doc: draft → in_review → approved
- Implementation: tests pass, code reviewed
- Deployment checklist: verified

## Constraints
- No breaking changes without migration path
- No undocumented behavior changes
- All errors must be handled, no bare catches
```

#### Blank

Empty textarea. Write your own from scratch.

### Switching Projects

1. Click project name in header → dropdown opens
2. Click a different project
3. `currentProjectId` updates in localStorage
4. `repoUrl` / `repoBranch` reload from the new project record
5. Host and orchestrator reinitialize with new config
6. Board re-renders with only that project's tasks, artifacts, KB, messages

### Returning to the App

`currentProjectId` persists in localStorage. App loads the project from DB, board appears exactly as left. No extra clicks.

### Project Deleted

If the project record is gone (DB cleared), `currentProjectId` still points to it. App detects the project doesn't exist, clears `currentProjectId`, dropdown shows "Select Project" with remaining projects listed. Board shows empty state message.

### Legacy Data

Rows created before this feature have `projectId: undefined`. They appear in **every** project as a fallback. The user can optionally assign them to a specific project via a "Migrate legacy data" action (not part of initial build).

---

## Data Model

### New Table: `projects`

```ts
export interface Project {
  id: string;           // uuid, primary key
  name: string;
  repoUrl: string;
  repoBranch: string;
  constitution: string; // full text, may be empty
  createdAt: number;
  updatedAt: number;
}
```

Dexie store: `projects: 'id, name, createdAt'`

### Existing Tables — Add `projectId`

| Table | New Index | Migration |
|---|---|---|
| `tasks` | `projectId` | Existing rows → `undefined` (visible in all projects) |
| `kbLog` | `projectId` | Existing rows → `undefined` |
| `kbDocs` | `projectId` | Existing rows → `undefined` |
| `taskArtifacts` | `projectId` | Existing rows → `undefined` |
| `taskArtifactLinks` | `projectId` | Existing rows → `undefined` |
| `messages` | `projectId` | Existing rows → `undefined` |
| `pushQueue` | `projectId` | Existing rows → `undefined` |
| `julesSessions` | `projectId` | Existing rows → `undefined` |
| `yuanHistory` | _(no change — app-level)_ | — |

Rows with `projectId: undefined` are "legacy" data. Queries without a projectId filter include them. Queries with a projectId filter include them too (OR `projectId === undefined`). This ensures no data is hidden during migration.

### Deprecated: `projectConfigs` Table

Superseded by `project.constitution`. Remains in schema for backward compat. No longer written to. All reads move to `db.projects.get(currentProjectId)`.

### Current Project Pointer

```ts
localStorage.getItem('currentProjectId')  // string | null
```

Single source of truth for which project is active. Set on create/switch. Cleared on delete.

---

## Component Changes

### New: `ProjectDropdown.tsx`

Inline dropdown component rendered in the header. Not a full-screen page.

Renders as: `[ Project Name ▼ ]` or `[ Select Project ▼ ]` or `[ No Projects · Create one ▼ ]`

States:
1. **Empty** — no projects → dropdown shows only "New Project"
2. **Unselected** — projects exist, none selected → dropdown lists all projects + "New Project"
3. **Selected** — current project active → dropdown lists all projects (current highlighted) + "New Project" + "Edit" + "Delete"

All project CRUD (create, edit, delete) happens through modals triggered from this dropdown.

Reads/writes DB directly. No props needed beyond a callback to notify App.tsx when project changes.

### New: `ProjectFormModal.tsx`

Modal for create/edit. Fields: name, repoUrl, repoBranch, constitution with template dropdown.

Template dropdown pre-fills the constitution textarea. Templates are a static map:

```ts
const CONSTITUTION_TEMPLATES: Record<string, string> = {
  research: `## Objective\n...`,
  mvp: `## Objective\n...`,
  testing: `## Objective\n...`,
  production: `## Objective\n...`,
  blank: '',
};
```

### Modified: `App.tsx`

- Add `currentProjectId` state from localStorage
- Render `<ProjectDropdown />` in header
- `repoUrl` and `repoBranch` initialized from current project, not localStorage
- When project changes: re-init host + orchestrator
- All `useLiveQuery` calls filter by `projectId`
- Task creation sets `projectId` from current project
- Board area shows empty state when no project selected

### Modified: `ConstitutionEditor.tsx`

Currently saves to `db.projectConfigs`. Change to `db.projects.update(currentProjectId, { constitution })`.

### Modified: Header

Add `<ProjectDropdown />` between the app title and the existing buttons. Replace the current `repoUrl @ repoBranch` badge with the project dropdown (which already shows that info).

---

## Consumer Updates (Queries)

Every place that reads data must be aware of `projectId`.

### `ProjectorHandler.projectBase`

```ts
// Before
const configs = await db.projectConfigs.toArray();
if (configs.length > 0 && configs[0].constitution) {
  sections.push(configs[0].constitution);
}

// After
const project = await db.projects.get(context.projectId);
if (project?.constitution) {
  sections.push(project.constitution);
}
```

### `DeepDream` (dream-levels.ts)

```ts
// Before
const configs = await db.projectConfigs.toArray();
const constitution = configs[0]?.constitution || '(none)';

// After
const project = await db.projects.get(context.projectId);
const constitution = project?.constitution || '(none)';
```

### `ProcessAgent.checkGates`

```ts
// Before
const config = await db.projectConfigs.get(`${repoName}:${branchName}`);

// After
const project = await db.projects.get(context.projectId);
const constitution = project?.constitution || '';
```

### `ProcessAgent` tool queries

`listTasks`, `listArtifacts`, `queryKB`, `queryKBLog` — add `.where({ projectId })` with legacy fallback (OR `projectId === undefined`).

### `KBHandler` queries

`queryDocs`, `queryLog`, `recordEntry`, `saveDocument` — all include `projectId` from context.

### Orchestrator

`orchestrator.processTask(task)` reads `task.projectId`, passes through `RequestContext`.

### Task creation

`handleCreateTask`, `handleAcceptProposal`, agent loop — set `projectId` from current project.

---

## Migration Strategy

Dexie version 26:

```ts
this.version(26).stores({
  // Existing tables — add projectId to indexes
  tasks: 'id, workflowStatus, agentState, createdAt, projectId',
  kbLog: '++id, timestamp, category, abstraction, active, source, project, projectId',
  kbDocs: '++id, timestamp, title, type, active, source, project, projectId',
  taskArtifacts: '++id, taskId, repoName, branchName, status, projectId',
  taskArtifactLinks: '++id, taskId, artifactId, projectId',
  messages: '++id, sender, taskId, type, status, category, activityName, timestamp, projectId',
  pushQueue: '++id, branch, status, timestamp, projectId',
  julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName, projectId',

  // New table
  projects: 'id, name, createdAt',

  // Deprecated but kept for compat
  projectConfigs: 'id',
  // All other tables unchanged
}).upgrade(tx => {
  // No data migration — existing rows get projectId: undefined
  // Visible in all projects as legacy fallback
});
```

---

## Implementation Order

| Step | File(s) | Description |
|---|---|---|
| 1 | `db.ts` | Add `Project` interface + `projects` table + version 26 migration with `projectId` on all data tables |
| 2 | `types.ts` | Add `projectId?: string` to `Task` interface |
| 3 | `core/types.ts` | Add `projectId` to `RequestContext` |
| 4 | `lib/constitution-templates.ts` | Static map of constitution template strings (research, mvp, testing, production, blank) |
| 5 | `components/ProjectDropdown.tsx` | Header dropdown component — switch/create/edit/delete projects |
| 6 | `components/ProjectFormModal.tsx` | Modal for create/edit project with template dropdown |
| 7 | `App.tsx` | Add `currentProjectId` state, render dropdown in header, load repoUrl/branch from project, filter queries by projectId |
| 8 | `core/host.ts` | Accept `projectId` in config, pass through to context |
| 9 | `core/orchestrator.ts` | Read `task.projectId`, pass in context |
| 10 | `modules/knowledge-projector/Handler.ts` | Replace `configs[0]` with project query |
| 11 | `modules/process-dream/dream-levels.ts` | Replace `configs[0]` with project query |
| 12 | `modules/process-project-manager/ProcessAgent.ts` | Replace `ProjectConfig` query with project query, add projectId filters |
| 13 | `modules/knowledge-kb/Handler.ts` | Add projectId to all queries and writes |
| 14 | `components/ConstitutionEditor.tsx` | Save to `projects` table instead of `projectConfigs` |

---

## What This Enables

- **Multiple projects** — switch between repos/branches without touching settings
- **Clean data scoping** — tasks, KB, artifacts, messages all belong to a project
- **Constitution per project** — each project has its own rules, correctly projected
- **Fixes `configs[0]` bug** — no more grabbing the wrong constitution
- **Template-driven setup** — new projects start with sensible defaults

## What This Doesn't Do (Yet)

- Import/export project data
- Cross-project KB sharing
- Project-level user permissions
- Migrating legacy rows to a specific project (manual or separate tool)
- Custom/user-defined templates (templates are hardcoded for now)
