# Codebase Analysis: kanban-jules (collective branch)

## Overview

Fleet (kanban-jules) is a **browser-based autonomous agent orchestrator** for software development. It combines a React Kanban UI, a TypeScript orchestration engine, and a WebAssembly Linux VM to let AI agents plan, execute, and review coding tasks with human oversight.

The `collective` branch merges two lines of work:
- **main** -- the UI, module system, and orchestrator logic (updated by Gemini Studio)
- **feat/wasm-executor** -- a WASM boot layer providing an in-browser Linux VM with filesystem bridges

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.8, Tailwind CSS 4 |
| Build | Vite 6, `@tailwindcss/vite`, `vite-plugin-node-polyfills` |
| State / DB | Dexie (IndexedDB) with `dexie-react-hooks` for reactive queries |
| LLM | Google Gemini (`@google/genai`), OpenAI-compatible providers |
| Git (browser) | `isomorphic-git` + `@isomorphic-git/lightning-fs` |
| Server | Express (dev server with Vite middleware + MCP endpoint) |
| Sandbox | `sval` (JS interpreter) in a Web Worker |
| WASM VM | Wanix kernel (Go compiled to WASM), v86 Linux, WISP networking |
| Agent (WASM) | Go-based ReAct agent using Eino framework |
| Terminal MUX | Go-based session multiplexer (`session-mux`) with VT emulation |
| Testing | Vitest (unit), Puppeteer (E2E) |

---

## Architecture

The system is organized into six layers, from UI down to the WASM VM:

```
+-----------------------------------------------+
|  Fleet UI (React + Vite + Dexie)               |
|  Kanban board, modals, artifact browser, etc.  |
+-----------------------------------------------+
|  Orchestrator (orchestrator.ts)                |
|  Task lifecycle, executor dispatch, retries,   |
|  AgentContext persistence (immediate to Dexie) |
+-----------------------------------------------+
|  11 Modules (registry.ts)                      |
|  architect-codegen, executor-local/jules/      |
|  github/wasm, knowledge-artifacts/repo-browser/|
|  local-analyzer, channel-user-negotiator/      |
|  wasm-terminal, process-project-manager        |
+-----------------------------------------------+
|  Sandbox (Sval) + Constitution System          |
|  ARCHITECT + PROGRAMMER constitutions          |
|  govern LLM-generated code behavior            |
+-----------------------------------------------+
|  Bridge Layer (src/bridge/)                    |
|  boardVM: LLM, tools, tasks, events           |
|  Yuan agent bootstrap + OpenAI shim            |
+-----------------------------------------------+
|  WASM Boot Layer (Go -> WASM)                  |
|  Wanix kernel, 9p FS, cowfs overlays           |
|  YuanFS, LLMFS, ToolFS, BoardFS, GitFS        |
|  v86 Linux VM + WISP TCP tunneling             |
+-----------------------------------------------+
```

### 1. Agent Loop (src/App.tsx)

The top-level React component doubles as the agent's main loop (~875 lines). It:

- Initializes the DB with seed tasks on first run
- Configures the `ModuleHost` and `Orchestrator` with user settings
- Polls for tasks in `IN_PROGRESS` / `IDLE` state and hands them to the orchestrator
- Manages all UI state (tabs, sidebars, modals, settings, autonomy mode)

### 2. Orchestrator (src/core/orchestrator.ts)

The engine driving task execution through multi-step protocols:

1. **Protocol generation** -- the Architect module decomposes a task into ordered `TaskStep` objects, each tagged with an executor (`executor-local`, `executor-jules`, `executor-github`)
2. **Code generation** -- composes a prompt via `composeProgrammerPrompt()` with constitutions, tool bindings, and context, then calls the LLM
3. **Sandbox execution** -- runs generated JS in a `Sandbox` (Web Worker + sval) with injected tool bindings
4. **Replay mode** -- if a step has `currentCode` saved from a previous attempt, it resumes from that code instead of regenerating
5. **Retry logic** -- up to 5 attempts per step with accumulated error context
6. **Host tools** -- `host.analyze` (LLM-powered analysis) and `host.addToContext` (key-value persistence) are available to sandbox code
7. **Result handling** -- updates state via `TaskStateMachine`, persists `AgentContext` to Dexie immediately on every context write

### 3. Module Registry (src/core/registry.ts)

A plugin system with 11 registered modules:

| Module | Type | Status | Purpose |
|--------|------|--------|---------|
| `architect-codegen` | architect | enabled | Generates task protocols and step plans |
| `executor-local` | executor | enabled | Runs JS in browser sandbox with repo/artifact tools |
| `executor-jules` | executor | enabled | Delegates to Google Jules cloud VM |
| `executor-github` | executor | enabled | GitHub Actions CI/CD workflows |
| `executor-wasm` | executor | **disabled** | Shell commands in ephemeral WASM Linux VM |
| `knowledge-artifacts` | knowledge | enabled | Save/list/retrieve task artifacts |
| `knowledge-repo-browser` | knowledge | enabled | List/read/write/head Git repo files |
| `knowledge-local-analyzer` | knowledge | enabled | Local code analysis via LLM |
| `channel-user-negotiator` | channel | enabled | Human-in-the-loop (`askUser`, `sendUser`) |
| `channel-wasm-terminal` | channel | **disabled** | xterm.js terminal connected to WASM VM |
| `process-project-manager` | process | enabled | Automated project reviews and task proposals |

Each module declares a `manifest.json` with tools, sandboxBindings, permissions, and configFields.

### 4. Sandbox (src/core/sandbox.ts + sandbox.worker.ts)

Security-critical isolation layer:

- Each execution runs in its own **Web Worker** using `sval` (JavaScript interpreter)
- Tool calls from sandbox code are proxied to the main thread via `postMessage`, resolved by the orchestrator's `moduleRequest`, and the result sent back
- Supports execution history replay and deterministic seeding for reproducibility
- Permissions enforced at runtime: `network`, `storage`, `timers`, `logging`

### 5. Bridge Layer (src/bridge/)

The escape hatch from the WASM VM to Fleet's module system. Exposes `window.boardVM` with:

- `boardVM.llmfs.sendRequest(json)` -- LLM calls in OpenAI Chat Completions format
- `boardVM.llmfs.sendPrompt(prompt)` -- simple text prompts
- `boardVM.toolfs.listTools()` / `boardVM.toolfs.callTool(name, json)` -- Fleet tool access
- `boardVM.yuan.init()` / `boardVM.yuan.send(msg)` -- Yuan agent control
- `boardVM.tasks.*` -- direct Dexie task CRUD
- `boardVM.on` / `boardVM.emit` -- event bus integration

A `TOOL_MAP` translates short agent names (`readFile`, `writeFile`, `bash`, etc.) to qualified Fleet handler names (`knowledge-repo-browser.readFile`, `executor-wasm.execute`, etc.).

### 6. WASM Boot Layer (wasm/)

A full in-browser Linux environment built in Go and compiled to WebAssembly:

**wasm/boot/** -- Wanix kernel bootstrap (`boot.wasm`):
- Initializes the Wanix kernel with 9p filesystem, pipe allocators, and virtual filesystems
- Mounts `cowfs` (copy-on-write) overlays: rootfs (read-only tar) + idbfs (persistent IndexedDB layer)
- Registers virtual filesystems: `YuanFS` (agent bridge), `LLMFS` (LLM proxy), `ToolFS` (Fleet tools), `BoardFS` (task data), `GitFS` (repo access)
- Boots v86 Linux VM with WISP networking for full TCP tunneling

**wasm/agent/** -- ReAct coding agent (`agent.wasm`):
- Go program using Eino framework's ReAct loop
- Calls LLM via `/#llm/` filesystem (write request, read result)
- Calls Fleet tools via `/#tools/` filesystem (write call, read result)
- Max 12 reasoning steps per invocation

**wasm/session-mux/** -- Terminal multiplexer:
- Manages up to 10 terminal panes with VT emulation
- Bridges between xterm.js (browser) and shell processes (WASM)
- Supports Yuan agent communication via 9p session pipes
- Local echo, line editing, newline translation

---

## State Management

### TaskStateMachine (src/core/TaskStateMachine.ts)

Centralizes all task state transitions via `dispatch(taskId, event)`:

| Event | Workflow Status | Agent State |
|-------|----------------|-------------|
| `START` | `IN_PROGRESS` | `EXECUTING` |
| `PAUSE` | `IN_PROGRESS` | `PAUSED` |
| `STOP` | `TODO` | `IDLE` |
| `COMPLETE` | `DONE` | `IDLE` |
| `REQUIRE_USER_INPUT` | `IN_PROGRESS` | `WAITING_FOR_USER` |
| `USER_REPLIED` | `IN_PROGRESS` | `IDLE` |
| `REQUIRE_EXECUTOR` | `IN_PROGRESS` | `WAITING_FOR_EXECUTOR` |
| `EXECUTOR_REPLIED` | `IN_PROGRESS` | `IDLE` |
| `ERROR` | `IN_PROGRESS` | `ERROR` |
| `FATAL_ERROR` | `IN_REVIEW`/`TODO` | `ERROR` |

Every transition persists to IndexedDB and emits a `task:state_changed` event.

### AgentContext (src/services/AgentContext.ts)

Singleton key-value store (`Map<string, any>`) persisting data across protocol steps. Used by sandbox code via `addToContext(key, value)`. Now **immediately persisted** to Dexie on every write (previously only on task completion), surviving crashes and reloads.

### Database (src/services/db.ts)

Dexie (IndexedDB) with explicit schema versioning:

| Table | Purpose |
|-------|---------|
| `tasks` | Core task records with protocol, context, logs |
| `taskArtifacts` | Generated files/code artifacts |
| `taskArtifactLinks` | Many-to-many task-artifact associations |
| `julesSessions` | Google Jules session tracking |
| `messages` | Agent mailbox (proposals, alerts, chat) |
| `gitCache` | Cached Git file contents |
| `projectConfigs` | Per-project constitution overrides |
| `moduleKnowledge` | Per-module knowledge bases |

### Event Bus (src/core/event-bus.ts)

Typed pub/sub decoupling components:

- `project:review` -- triggers process-project-manager
- `module:log` -- structured logging from any module (persisted by host)
- `module:request` / `module:response` -- inter-module RPC
- `task:manual-trigger` -- user-initiated task start
- `user:reply` -- user response to `askUser` prompt
- `task:state_changed` -- state machine transitions

---

## Constitution System

Behavior of LLM-generated code is governed by editable constitutions:

- **Architect Constitution** -- rules for task decomposition: modularity, executor selection, inter-step communication via AgentContext, defensive design, GitHub workflow rules
- **Programmer Constitution** -- rules for generated JS: valid JS only, async/await, sandbox limits, defensive programming, log parsing (timestamp regex, ANSI stripping), self-verification

Constitutions live in `src/core/constitution.ts` and `CONSTITUTION.md`. Per-module knowledge bases (`moduleKnowledge` table) can override or extend them. A retry-specific constitution is injected on failures.

---

## UI Components

| Component | File | Role |
|-----------|------|------|
| `KanbanBoard` | `KanbanBoard.tsx` | 4-column board (TODO, IN_PROGRESS, IN_REVIEW, DONE) |
| `KanbanColumn` | `KanbanColumn.tsx` | Individual column with drag-drop |
| `TaskCard` | `TaskCard.tsx` | Task card with title, state badge, agent status |
| `TaskDetailsModal` | `TaskDetailsModal.tsx` | Full task view: chat, logs, protocol steps |
| `NewTaskModal` | `NewTaskModal.tsx` | Task creation |
| `SettingsModal` | `SettingsModal.tsx` | API keys, repo, module config |
| `RepositoryBrowser` | `RepositoryBrowser.tsx` | Browse Git repo files in-browser |
| `ArtifactBrowser` | `ArtifactBrowser.tsx` | Browse generated artifacts |
| `ArtifactTree` | `ArtifactTree.tsx` | Tree view for artifact navigation |
| `MailboxView` | `MailboxView.tsx` | Agent message inbox |
| `ConstitutionEditor` | `ConstitutionEditor.tsx` | Edit system/project constitutions |
| `PreviewPane` / `PreviewTabs` | `PreviewPane.tsx` | Multi-tab content previewer |
| `JulesProcessBrowser` | `JulesProcessBrowser.tsx` | Monitor Jules sessions |
| `GithubWorkflowMonitor` | `GithubWorkflowMonitor.tsx` | Monitor GitHub Actions runs |
| `TerminalPanel` | `modules/channel-wasm-terminal/TerminalPanel.tsx` | xterm.js terminal for WASM VM |
| `CollapsiblePane` | `CollapsiblePane.tsx` | Resizable sidebar container |

---

## Server (server.ts)

Lightweight Express server:

1. **Vite dev middleware** in development; static file serving in production
2. **MCP endpoint** (`POST /api/mcp/execute`) for local tool execution:
   - `list_directory`, `read_file`, `write_file` -- filesystem operations
   - `clone_repo` -- Git clone with optional branch (60s timeout)
   - `run_command` -- restricted shell execution (15s timeout)

---

## Execution Flow (End-to-End)

1. User creates a task via `NewTaskModal` or the mailbox processes an incoming message
2. Task stored in Dexie: `workflowStatus: 'TODO'`, `agentState: 'IDLE'`
3. User (or autonomy mode) triggers `START` -> `IN_PROGRESS` / `EXECUTING`
4. Agent loop in `App.tsx` picks up the task, calls `orchestrator.processTask()`
5. Architect module generates a protocol (list of `TaskStep` objects)
6. For each step, the orchestrator:
   a. Loads AgentContext from DB into the singleton
   b. Composes prompt with constitution, tools, module knowledge, and error context
   c. Generates JS code via LLM (or replays saved code)
   d. Executes in sandbox with injected tool bindings
   e. If code calls `askJules()`, delegates to Jules and waits
   f. If code calls `askUser()`, pauses for human input
   g. On success, marks step complete, persists context
   h. On failure, retries with error context (up to 5 attempts)
7. All steps done -> task moves to `DONE`

---

## Key Design Patterns

- **Constitution-driven prompting**: Agent behavior is configurable via editable constitutions without code changes
- **Sandboxed code generation**: All LLM code runs in isolated `sval` inside a Web Worker
- **Module manifest system**: New capabilities added via `manifest.json` + handler class + registry registration
- **Event-driven decoupling**: Components communicate via typed event bus, modules never write to DB directly
- **Retry with context accumulation**: Failed steps re-attempted with error history injected into prompt
- **Immediate context persistence**: AgentContext writes go to Dexie immediately, surviving crashes
- **Bridge architecture**: `window.boardVM` provides a clean interface between the WASM VM and Fleet's module system
- **Virtual filesystem IPC**: The WASM agent communicates with Fleet through synthetic filesystems (LLMFS, ToolFS) rather than HTTP or WebSocket

---

## Areas for Improvement

1. **App.tsx complexity** -- at ~875 lines, the main component handles agent loop, UI state, settings, and task processing. Extracting into custom hooks or services would improve maintainability.
2. **Missing error boundaries** -- no React error boundaries visible; a rendering error in any component could crash the entire app.
3. **Limited test coverage** -- unit tests exist for registry and sandbox; no integration tests for the orchestrator flow or the WASM bridge.
4. **Server-side security** -- the `/api/mcp/execute` endpoint's `run_command` action executes arbitrary shell commands with only a timeout guard. Needs authentication and command whitelisting for multi-user scenarios.
5. **WASM modules disabled by default** -- `executor-wasm` and `channel-wasm-terminal` are disabled; their integration path into the orchestrator's step execution is not fully wired.
6. **AgentContext singleton** -- the in-memory `Map` is periodically synced to Dexie but could lose data if the tab crashes between writes (mitigated by immediate persistence, but the sync is not atomic).
7. **Hardcoded module list** -- the registry initializes modules inline rather than discovering them dynamically.
8. **Type safety at sandbox boundary** -- tool call arguments pass as `any[]`, losing type information.
9. **No CSP headers** -- all scripts run in the same origin with no Content Security Policy configured.
10. **Polling-based Jules integration** -- JNA polls every 5 seconds (hardcoded), adding latency vs. a WebSocket approach.
