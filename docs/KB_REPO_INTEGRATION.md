# KB + Artifacts: Repo Integration

## Problem

Knowledge base lives only in IndexedDB. If the browser clears IDB, accumulated knowledge is gone. Artifacts already persist to `.artifacts/` in the git repo, but KB has no such safety net. Additionally, there are no document templates — agents produce ad-hoc markdown.

## Design

### Two folders, two strategies

```
repo/
├── .artifacts/          ← task branches (already works)
│   ├── design-spec.md
│   └── api-analysis.md
│
├── .kb/                 ← main branch only
│   ├── docs/
│   │   ├── tech-stack.md
│   │   ├── auth-pattern.md
│   │   └── template_design-spec.md   ← templates are KB docs
│   └── log.jsonl        ← NOT implemented (see rationale below)
```

**`.artifacts/`** — writes to whatever branch the task runs on. Merges to main via PR. Already implemented.

**`.kb/docs/`** — writes to main branch only. No task branches touch it. No merge conflicts possible.

**`.kb/log.jsonl`** — NOT implemented. KB log entries are high-frequency, low-value individually (error observations, execution traces). Committing each one to git would be noisy. Log stays IDB-only. If IDB is lost, log entries are replanished by re-running tasks. Docs are the valuable persistent knowledge.

### No merge problem

KB docs write to the project's main branch only. Task branches read from main (via RepoScanner) but never write to `.kb/`. The only writers are:
- `KBHandler.saveDocument` — when agents save knowledge
- `ArtifactTool.promoteToKB` — when approved artifacts graduate to KB
- `ProcessAgent.saveToKB` — when overseer promotes artifacts
- User manual KB entry via UI

All write to the project's configured branch (main). No concurrent branch writes = no conflicts.

### Templates as KB docs

Templates are regular KB docs with naming convention `template_<doc_type>.md`:

```
.kb/docs/template_design-spec.md
.kb/docs/template_api-analysis.md
.kb/docs/template_implementation-plan.md
.kb/docs/template_test-report.md
```

Any agent queries templates via `kb.queryDocs({ type: 'template' })` or by name pattern. Agents read the template before generating an artifact, producing structured output instead of ad-hoc markdown.

Templates are editable by the user — they're files in the repo. Edit in your editor, Fleet picks them up via RepoScanner.

## Sync Model

```
IDB (runtime)                    Git (persistence)
─────────────                    ─────────────────
kbDocs.saveDocument() →          write .kb/docs/<title>.md to main
kbDocs.queryDocs()   ←          RepoScanner reads .kb/docs/ into IDB on startup
kbLog.recordEntry()              IDB only (no git write)
artifact saved       →           write .artifacts/<name>.md to task branch (already works)
artifact approved + promoted →   write to .kb/docs/<name>.md on main
```

### Write path (IDB → Git)

In `KBHandler.saveDocument()`, after the IDB write succeeds, also write to `.kb/docs/<title>` on the project's main branch via `GitFs`.

Conditions:
- Only for docs with `source` not equal to `repo-scan` (avoid writing back what we just read)
- Only when `repoUrl`, `branchName`, and `token` are available
- Fire-and-forget — git write failure does not fail the IDB operation

### Read path (Git → IDB)

Already handled by `RepoScanner.scanRepo()`. Add `.kb/docs/` to scan patterns so these files are picked up on project load.

### Rebuild path (IDB lost → Git → IDB)

If IDB is cleared, RepoScanner runs on next project load, reads all `.kb/docs/*.md` files back into IDB. Knowledge is restored. Artifacts in `.artifacts/` are also restored by the existing scanner.

## Implementation

### Step 1: Add `.kb/docs/` to RepoScanner scan patterns

File: `src/modules/knowledge-kb/RepoScanner.ts`

Add a scan pattern that matches `.kb/docs/*.md` files. These get ingested as KB docs with source `repo-scan`.

### Step 2: Dual-write in KBHandler.saveDocument

File: `src/modules/knowledge-kb/Handler.ts`

After IDB write, write to `.kb/docs/<title>` on the project's main branch via `GitFs`. Skip if source is `repo-scan` (avoid echo).

Needs `repoUrl`, `branchName`, `token` from context. These are passed through `RequestContext` which already has `repoUrl` and `repoBranch`.

### Step 3: Templates initialization

Add a function that creates default templates (design-spec, api-analysis, implementation-plan, test-report) as KB docs if they don't exist. Called on first project setup or on demand.

Default templates are simple markdown structures:

```markdown
# <Document Title>

## Overview
<!-- Brief description of what this document covers -->

## Context
<!-- Relevant background, requirements, constraints -->

## Details
<!-- Main content -->

## Decisions
<!-- Key decisions made and rationale -->

## Open Questions
<!-- Unresolved items -->
```

### Step 4: Wire template lookup into artifact generation prompts

In `composeProgrammerPrompt` (`src/core/prompt.ts`), add instruction:

> Before creating an artifact, use `kb.queryDocs({ type: 'template', search: '<artifact_type>' })` to find a template. Follow the template structure.

## What This Enables

- **KB survives IDB loss** — docs persist in git, RepoScanner rebuilds
- **Templates for structured artifacts** — agents produce consistent documents
- **User-editable templates** — edit in repo, Fleet picks up changes
- **No merge complexity** — KB writes to main only, task branches don't touch it
