# Module System: Management UI

> Sub-document of [modules.md](modules.md) — the unified capability model proposal.
> This file covers the Module Management UI design.

---

## 14. Module Management UI

A dedicated **Modules tab** in the app navigation (alongside the Kanban board). All module management happens here.

### 14.1 Module List

The main view. Shows all registered modules in a table or card grid.

| Column | Description |
|--------|-------------|
| Icon | Type badge (executor / channel / knowledge) |
| Name | Module display name |
| Status | `active` / `disabled` / `error` / `loading` |
| Permissions | Badges for declared permissions (`network`, `timers`, etc.) |
| Source | Git ref (tag or short commit hash) |
| Toggle | Enable/disable switch |

- Bundled modules are shown first, marked with a "built-in" badge
- External modules show their source repo URL
- Error status shows a brief error message inline

### 14.2 Module Detail

Clicking a module opens a detail panel (slide-over or inline expand).

- **Description**: full free-form text from manifest (what the architect reads)
- **Tools**: list of declared tools with names and descriptions
- **Sandbox bindings**: alias → tool name mappings
- **Permissions**: what system access this module has, with human-readable explanations
- **Source**: full repo URL, ref
- **Logs**: scrollable log output from `moduleLogs[moduleId]`, errors highlighted in red
  - This is the generalization of current JNA/UNA logs tabs in TaskDetailsModal
  - Per-module filter, timestamp search
- **Presentations**: list of dashboard panels this module provides (if any)

### 14.3 Add External Module

Flow for loading a module from a git URL:

1. **Paste URL** — user enters git repo URL
2. **Fetch manifest** — app fetches `manifest.json` (or defined entry point) from repo
3. **Review permissions** — permission request screen (like mobile app install):
   - "This module requests: **Network access** (calls external APIs), **Timers** (schedules operations)"
   - Each permission shown with human-readable explanation
   - User approves or rejects individual permissions
4. **Confirm** — module loads into worker, status → `active`
5. **If rejected** — module loads but with reduced permissions (may fail at runtime if it tries to use stripped APIs)

### 14.4 Enable/Disable

- Toggle switch per module
- Disabled modules are removed from the registry — their tools disappear from architect prompts, their sandbox bindings are not injected
- Re-enabling re-registers the module and spins up a new worker
- Bundled modules can be disabled but not removed
- External modules can be removed entirely (uninstall)

### 14.5 Where in the App

```
┌──────────────────────────────────────────┐
│  Board  │  Modules  │                    │
├──────────────────────────────────────────┤
│                                          │
│  (Kanban board or Module manager)        │
│                                          │
└──────────────────────────────────────────┘
```

- Top-level nav tab, equal to the board
- Board view is default (existing behavior)
- Modules tab is for setup and debugging

### 14.6 Presentation Panels on the Board

Modules with `presentations` render as collapsible panels in the **left sidebar** — the same sidebar that currently holds Repository, Artifacts, Jules Processes, and GitHub Workflows. This is the natural place: it slides from the left over the board, toggled by header buttons.

**Current implementation** (App.tsx lines 1041–1089): a `w-80` left sidebar with `CollapsiblePane` components, switched between `sidebarMode === 'repo'` and `sidebarMode === 'mailbox'`. Each pane is already a module presentation — they just happen to be hardcoded.

**Proposed**: the sidebar becomes dynamic. Modules declare presentations in their manifests. The host renders them as `CollapsiblePane` instances automatically.

```
┌─────────────────────────────────────────────────────────┐
│  Agent Kanban          [Bot] [Mail] [+] [+New] │
├──────────────────┬──────────────────────────────────────┤
│ ▾ Repository     │                                      │
│   ├ src/         │                                      │
│   │  ├ App.tsx   │                                      │
│   │  └ ...       │        (Kanban Board)                │
│ ▸ Artifacts (4)  │                                      │
│ ▾ Jules Sessions │                                      │
│   ├ #42 running  │                                      │
│   ├ #41 done     │                                      │
│ ▸ Proposals (1)  │                                      │
│ ▸ GitHub CI      │                                      │
└──────────────────┴──────────────────────────────────────┘
```

- Left sidebar (current location, toggled by header buttons)
- Each module with presentations gets a `CollapsiblePane`
- Panels auto-populated from module manifests at registry load time
- `mailbox` presentations show action buttons (approve/dismiss/cancel)
- Clicking an action routes to the module tool declared in `PresentationAction.tool`
- Panels refresh on `presentation:updated` events from the module
- Empty panels show "No items" and default-collapsed
- Panel order: declaration order in manifest, user can reorder via drag
- Header buttons (Mail, Folder) become generic: one toggle per module that has presentations, or a single sidebar toggle that shows all panels
