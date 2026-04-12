# Module System: Interface & Core

> Sub-document of [modules.md](modules.md) — the unified capability model proposal.
> This file covers the module interface contract, sandbox architecture, prompt composition, and type changes.

---

## 4. Module Interface

Every module implements the same contract. The `type` field determines how the orchestrator treats it.

Crucially: modules don't just expose tools to an LLM prompt. They expose **sandbox APIs** that get injected into the Sval environment. The Programmer Agent writes JS code that calls these APIs. Negotiators (for executors and channels) or direct functions (for knowledge) handle the actual work.

```typescript
interface ModuleManifest {
  id: string;       // 'executor-jules', 'knowledge-artifacts'
  name: string;     // 'Google Jules', 'Artifact Storage'
  version: string;
  type: 'architect' | 'knowledge' | 'executor' | 'channel' | 'process';

  // Free-form description of what this module is and how to use it.
  // Written for LLM consumption — the architect reads this to decide
  // when and how to use this module. No structured capability enums.
  description: string;

  // Tools this module exposes. These serve a dual purpose:
  // 1. For the TaskArchitect prompt: so the architect knows what's available
  //    when planning steps.
  // 2. For the Programmer Agent prompt: so it knows what sandbox APIs it can
  //    call in its generated code.
  tools: ToolDefinition[];

  // How this module is exposed inside the Sval sandbox.
  // The key becomes the function name available to generated code.
  // e.g. { "askJules": "executor-jules.execute" }
  // means the Programmer can write: const result = await askJules(prompt);
  // Architect modules set this to {} — they receive bindings, not expose them.
  sandboxBindings: Record<string, string>; // alias → tool name

  // ARCHITECT ONLY: What this architect module produces.
  // Determines how the host uses the output.
  //   'protocol+code' → step plan + JS code per step (current full flow)
  //   'code'           → just JS code, no step planning
  //   'protocol'       → step descriptions only, no code
  //   'code'           → for simple tasks, single step, direct execution
  // Ignored for non-architect types.
  outputType?: 'protocol+code' | 'code' | 'protocol';

  // ARCHITECT ONLY: Which sandbox bindings this architect needs injected.
  // '*' = all available bindings from all registered modules.
  // Specific list = only those bindings are passed to the architect's prompt.
  // Ignored for non-architect types.
  requiresBindings?: string[] | '*';

  // Permissions this module needs. Enforced by the host before
  // granting access to system resources.
  permissions: Permission[];

  // Git source(s) for updates. Supports multiple URLs — the freshest wins (see §4.7.1).
  source: {
    repoUrl: string | string[];  // one or more repo URLs
    ref: string;                 // tag or commit hash
  };

  // Describes this module's background behavior for documentation and UI.
  // Not used by the host — modules manage their own loops internally.
  // Modules that need background behavior declare 'timers' permission and
  // start their own setInterval in init().
  backgroundSchedule?: string;  // cron expression, e.g. "*/5 * * * * *" — descriptive only

  // Hard resource limits the host enforces programmatically.
  // Descriptive characteristics (latency, autonomy, etc.) go in `description` —
  // the LLM reads them as text, no structured schema needed.
  limits?: ResourceLimit[];

  // Configuration fields this module needs from the user.
  // Rendered as a per-module tab in Settings. Values stored centrally by the host.
  configFields?: ConfigField[];

  // What this module shows on the dashboard. Orthogonal to pipeline role —
  // any module can present data. See §4.0.2.
  presentations?: ModulePresentation[];
}
```

```typescript
// Permissions a module can request. Deny by default.
// Host strips all capabilities from the worker scope before loading module code,
// then restores only what the manifest declares.
type Permission =
  | 'network'      // fetch, XMLHttpRequest, WebSocket
  | 'timers'       // setTimeout, setInterval, requestAnimationFrame
  | 'storage'      // IndexedDB, localStorage, cookies
  ;
  // Additional permissions (clipboard, fullscreen, media) added when real modules need them (see §9.1).
```

```typescript
// Per-module configuration. Module declares what it needs,
// host renders the UI and stores the values centrally.
interface ConfigField {
  key: string;           // 'apiKey', 'pollInterval', 'model'
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;         // Human-readable: "Jules API Key"
  secret?: boolean;      // Masked in UI, encrypted in storage
  required?: boolean;    // Module won't activate without it
  default?: any;         // Default value if not set
  options?: string[];    // For 'select' type
  description?: string;  // Help text shown below the field
}
```

> **Migration note:** Current codebase uses `{ name, type, description, required }`. Must align to `{ key, label, secret, default, options }`. The `name` → `key` rename is breaking — all manifest configFields and `moduleConfigs` lookups must update.

```typescript
// Hard resource limits the host enforces programmatically.
// The host checks these at runtime — not soft guidance, actual walls.
// Descriptive characteristics (latency, autonomy, context cost, etc.)
// belong in the module's `description` field — the LLM reads them as
// free-form text, no structured schema needed.
interface ResourceLimit {
  resource: string;       // 'concurrent' | 'newPerDay' | 'sessions' | etc.
  limit: number;          // the cap
  period: string;         // 'concurrent' | 'day' | 'month' | 'per-call'
  description: string;    // human-readable: "3 concurrent sessions", "10 new sessions/day"
}
```

**Why no ResourceProfile:** The architect is an LLM. It reads `description` — a paragraph that says "I'm fast (ms), synchronous, deterministic, use me for simple transforms" or "I'm slow (minutes), autonomous, expensive, give me big tasks." That's how a colleague would explain it. Structured enums like `autonomy: 'semi'` and `latency: 'seconds'` add schema maintenance burden without helping the LLM — it reasons better from natural language.

`ResourceLimit` stays because the **host code** enforces it at runtime. When a step calls `executor-jules.execute`, the host checks: "are we at the concurrent limit? has this executor hit its daily new-session cap?" That's programmatic, not LLM reasoning.

**Rendering:** Each module with `configFields` gets a tab in Settings. The host reads all manifests at startup, builds the Settings UI dynamically, and stores values in a central `ModuleConfig` store. Modules receive their config via `init(config)` and on config change events.

**Three-layer config architecture.** Config is split into three layers with clear ownership:

| Layer | What lives here | Who owns it | When it's used |
|-------|----------------|-------------|----------------|
| **Host Config** | LLM API keys, default model, repo URL, repo branch | Host (Settings → General) | Global — shared by all modules |
| **Module Config** | Per-module `configFields` only (API keys specific to the module, tuning knobs) | Module declares, host stores | Module `init()` — receives own config only |
| **Runtime Context** | Per-call data: `taskId`, `llmCall()` function | Host constructs per invocation | Every handler call — passed as `RequestContext` |

**Why this split:** LLM keys are host-level because multiple modules (architects, executors via JulesPostman, process controllers) all need LLM access. Duplicating LLM keys per module is wrong — the host owns them and provides `llmCall()` as a callable function via RequestContext, so modules never see raw keys. Module config only contains what's truly module-specific: the Jules API key (for calling the Jules service, not for LLM), poll intervals, concurrency limits, model overrides.

```typescript
// RequestContext — constructed per handler invocation by the host
interface RequestContext {
  taskId: string;        // which task this call belongs to
  llmCall: (prompt: string, jsonMode?: boolean) => Promise<string>;
                         // host-provided LLM — uses host-level keys
}

// Handler signature change — RequestContext added as third parameter
type ModuleHandler = (
  toolName: string,
  args: any[],
  context: RequestContext
) => Promise<any>;

// Old: (toolName, args[]) => Promise<any>
// New: (toolName, args[], context: RequestContext) => Promise<any>
```

**How llmCall works:** The host creates the `llmCall` closure when constructing RequestContext, binding it to the host-level LLM config (API key, default model, endpoint). Modules call `context.llmCall(prompt)` without knowing which provider or model is configured. If a module needs a specific model, it adds `{ key: 'modelOverride', type: 'string' }` to its configFields, and the host uses that override when building `llmCall` for that module.

**Current codebase gap:** `JulesPostman` creates its own `GoogleGenAI` instance for message classification and stores LLM keys in `JulesConfig`. `Architect.ts` does the same. Both must be refactored to use `context.llmCall()` instead. `JulesConfig` shrinks from `{ apiKey, geminiApiKey, geminiModel, openaiUrl, openaiKey, openaiModel, apiProvider, ... }` to `{ apiKey, dailyLimit, concurrentLimit }`. `ArchitectConfig` shrinks to `{ modelOverride? }` or becomes empty.

**Module configFields examples — only module-specific fields:**

```typescript
// executor-jules configFields — Jules service key, not LLM key
configFields: [
  { key: 'apiKey', type: 'string', label: 'Jules API Key', secret: true, required: true,
    description: 'API key for the Google Jules service (not your LLM key)' },
  { key: 'pollInterval', type: 'number', label: 'Poll interval (ms)', default: 5000 },
  { key: 'dailyLimit', type: 'number', label: 'Daily task limit', default: 10 },
  { key: 'concurrentLimit', type: 'number', label: 'Concurrent task limit', default: 3 },
]

// architect-codegen configFields — optional model override only
configFields: [
  { key: 'modelOverride', type: 'string', label: 'Model Override',
    description: 'Override the host-level default LLM model for this architect' },
]

// process-project-manager configFields — no secrets, just tuning
configFields: [
  { key: 'reviewInterval', type: 'number', label: 'Review interval (minutes)', default: 30 },
]
```

### 4.0.3 Dual-Role Modules

Module types are not mutually exclusive. A module has a **primary type** (`type` field) that determines its pipeline role, but can also run internal background loops. This is the dual-role pattern.

**Why:** Cloud executors like Jules have ongoing lifecycle needs — sleeping sessions to wake, completed sessions to detach, idle sessions to recycle. These happen between calls. Nobody drives them unless the module itself runs a background loop.

**How it works — internal timers, not host-driven ticks:**

Modules that need background behavior declare `timers` in their `permissions` and start their own `setInterval` in `init()`. The host never calls ticks. The host never drives background behavior. `backgroundSchedule` in the manifest is **descriptive metadata only** — it tells humans and UI what the module does internally, but the host does not parse or act on it.

```
All modules: stateless tools, called by architect or host
Some modules: also run internal background loops (dual-role)
  ├── process-* modules: ONLY background (no sandbox bindings, pure background)
  ├── executor-jules: has BOTH (executor tools + internal session management loop)
  ├── executor-github: has BOTH (execute workflow + internal run cleanup loop)
  └── executor-wasm: executor only, no background (nothing to manage between calls)
```

**The key distinction:** tools are called by the architect's generated code (via sandbox bindings). Background loops are started by the module itself in `init()` and run independently. The host is not involved in either direction:

1. When the architect calls `askJules(prompt)` → host routes to `executor-jules.execute`
2. Meanwhile, executor-jules's own `setInterval` polls Jules sessions, manages lifecycle, recycles idle ones

Both happen inside the same module worker. The internal loop uses `hostRpc.log()` to report progress. When `execute` is called, the module may find a session already warmed up by its background loop — or may need to wait for one. The module manages this internally. The host just sees the `execute` call resolve.

**Why ticks never reach the host:** The host is an orchestration layer, not a scheduler. It calls modules when the architect's code needs something. Background lifecycle management is the module's own concern. If executor-jules needs to poll Jules every 5 seconds, that's its business — it starts a `setInterval` in `init()`, does its own polling, and only surfaces results when `execute` is called. The host never calls `manageSessions`. The host never fires triggers.

```typescript
// Inside executor-jules worker — init() starts the loop
function init(config, hostRpc) {
  // Start internal session management
  setInterval(async () => {
    const sessions = await pollJulesSessions(config.apiKey);
    for (const session of sessions) {
      if (session.status === 'sleeping' && hasNewActivity(session)) {
        hostRpc.log(`Waking session ${session.id}`);
        // Internal steering — no host involvement
      }
    }
  }, config.pollInterval || 5000);
}
```

### 4.0.4 Cloud Executors

Executors split into two shapes based on how they manage compute:

| Shape | Lifecycle | Auth | Examples |
|-------|-----------|------|---------|
| **Local** | Synchronous call, immediate result | None needed | WASM, CLI, local Docker |
| **Cloud** | Provision → run → poll → retrieve → teardown | API keys, tokens | Jules, GitHub Workflows, serverless |

Cloud executors are the primary candidates for dual-role. They own:
- **Credentials** (via `configFields`, stored centrally, never exposed to other modules)
- **Session/job lifecycle** (create, reuse, wake, teardown)
- **Verification loops** (JNA-style steering for smart cloud agents)

The architect doesn't know or care whether an executor is local or cloud. It calls `askJules(prompt)` or `askWasm(command)` the same way. The executor's `description` tells the architect what granularity and autonomy to expect. Cloud executors manage their own lifecycle internally via background loops (see §4.0.3) — the host and architect are unaware of polling, session management, or cleanup.

### 4.0.1 Permission Enforcement

The host controls the worker scope **before** module code loads. There is no trust — only declared permissions are granted.

```javascript
// Inside worker, run by host before loading module source:
const gated = {
  network:   ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
  timers:    ['setTimeout', 'setInterval', 'requestAnimationFrame'],
  storage:   // controlled via host RPC — worker has no direct IndexedDB access
};

// Strip everything
const held = {};
for (const [perm, apis] of Object.entries(gated)) {
  held[perm] = {};
  for (const api of apis) {
    held[perm][api] = self[api];   // save reference
    self[api] = undefined;          // remove from scope
  }
}

// Restore only declared permissions
for (const perm of manifest.permissions) {
  if (held[perm]) {
    for (const [api, ref] of Object.entries(held[perm])) {
      self[api] = ref;
    }
  }
}

// Now load module code — it only sees what was restored
importScripts(moduleSourceUrl);
```

If module code calls an undeclared API (e.g. `fetch` without `'network'` permission), it throws `TypeError: fetch is not a function`. The error is caught by the host, logged to `moduleLogs`, and surfaced as a module failure.

**Per-module permission examples:**

| Module | permissions | Why |
|--------|------------|-----|
| `executor-jules` | `['network']` | Needs to poll Jules API |
| `executor-wasm` | `[]` | Pure computation, no system access |
| `channel-telegram` | `['network']` | Bot webhook / long-polling |
| `channel-mailbox` | `[]` | Reads/writes via host RPC, no direct access |
| `knowledge-artifacts` | `[]` | Reads/writes via host RPC |
| `knowledge-repo-browser` | `['network']` | Fetches repo contents from GitHub API |
| `process-project-manager` | `['network']` | Needs LLM API to analyze board state |

### 4.0.2 Presentations: Any Module Can Show Things

Pipeline role (`type`) and dashboard presence are **orthogonal**. A module's type tells the architect how to use it in a task pipeline. Its presentations tell the UI what to render on the dashboard. Any module — regardless of type — can have zero or more presentations.

**Why this matters:** Jules is an executor but also manages sessions you'd want to see. ProcessAgent is a process but produces proposals the user should act on. Knowledge-artifacts stores files best shown as a tree. None of these are "knowledge modules" — they just have data worth presenting.

```typescript
interface ModulePresentation {
  id: string;          // unique within module, e.g. "sessions", "proposals"
  type: 'tree' | 'list' | 'mailbox' | 'chart' | 'custom';
  label: string;       // "Jules Sessions", "Proposals", "Artifacts"
  icon?: string;

  // Module tool the UI calls to fetch items for display.
  fetchData: string;   // tool name, e.g. "listSessions", "getProposals"

  // For mailbox type — actions the user can take on items.
  // Each action routes back to a module tool call.
  actions?: PresentationAction[];
}

interface PresentationAction {
  id: string;          // "cancel", "approve", "viewLogs"
  label: string;       // "Cancel Session", "Approve"
  tool: string;        // module tool to call, e.g. "cancelSession"
  confirm?: string;    // if set, show confirmation dialog with this text
  variant?: 'primary' | 'danger' | 'default';
}
```

**Presentation types:**

| Type | Renders | Example |
|------|---------|---------|
| `tree` | Hierarchical nodes with expand/collapse | Artifact file tree, repo browser |
| `list` | Flat rows with optional columns | Jules sessions (status, duration, task) |
| `mailbox` | Items with action buttons | ProcessAgent proposals (approve/dismiss), Jules sessions (cancel/view) |
| `chart` | Data visualization (line, bar, etc.) | Future metrics module — build times, task throughput |
| `custom` | Module provides its own React component | Complex dashboards, specialized visualizations |

**How it works:**

1. Module declares `presentations` in manifest
2. Host calls `fetchData` tool on module init and on refresh
3. UI renders the presentation in a panel on the board view
4. For `mailbox` type: action button clicks call the declared tool, module handles it, data refreshes

**Concrete examples:**

| Module | type | presentations |
|--------|------|--------------|
| `executor-jules` | executor | `list` of sessions (status, task, duration), with `mailbox` actions: cancel, view logs |
| `knowledge-artifacts` | knowledge | `tree` of artifacts per task |
| `knowledge-repo-browser` | knowledge | `tree` of repo files |
| `process-project-manager` | process | `mailbox` of pending proposals (approve / dismiss / edit) |
| `executor-wasm` | executor | (none — it runs and returns) |
| `channel-mailbox` | channel | `mailbox` of pending user questions (reply via inline input) |
| `channel-telegram` | channel | (none — messages go to Telegram app) |

**Knowledge modules still have tools.** `searchFiles`, `getArtifact`, `readRepoFile` — these are read-only query tools the architect calls to gather context. The presentation system is separate from the tool system. A knowledge module exposes tools *for the architect* and presentations *for the user*.

### 4.1 Sandbox Bindings: The Key Abstraction

This is the bridge between modules and the Programmer Agent's generated code.

Currently the Sval sandbox has hardcoded injections:
```javascript
// Current (hardcoded in Orchestrator)
sandbox.inject('askJules', async (prompt, criteria) => jna.negotiate(prompt, criteria));
sandbox.inject('askUser', async (question, format?) => una.negotiate(question, format));
sandbox.inject('GlobalVars', globalVarsProxy);
```

With modules, this becomes dynamic:
```javascript
// Proposed (driven by registry)
for (const module of registry.getAll()) {
  for (const [alias, toolName] of Object.entries(module.manifest.sandboxBindings)) {
    sandbox.inject(alias, async (args) => module.request(toolName, args));
  }
}
```

The Programmer Agent prompt lists available bindings:
```
You have the following APIs available in your sandbox:
- askJules(prompt, successCriteria) — delegate to Google Jules executor
- askWasm(command) — run command in WASM sandbox
- askUser(question, format?) — ask user via Mailbox
- askUserTelegram(question, format?) — ask user via Telegram
- listArtifacts(taskId?) — list stored artifacts
- readArtifact(id) — read artifact content
- saveArtifact(name, content) — save a new artifact
- GlobalVars.get(key) / GlobalVars.set(key, value) — persistent state
```

The Programmer decides which to call, writes JS code that calls them, and the sandbox routes to the correct module.

### 4.2 The Description Field

This is the key design decision. The `description` is free-form text, written as if explaining to a colleague:

```typescript
// executor-jules manifest
{
  id: 'executor-jules',
  name: 'Google Jules',
  type: 'executor',
  description: `
I am a fully autonomous coding agent running in a cloud VM with full
access to the repository, CLI, and file system. I manage my own sessions
and can handle complex, multi-step work independently.

HOW TO DELEGATE TO ME:
Give me large, ambitious tasks. I can search the codebase, modify
multiple files, and run tests in a single turn. Do NOT break my work
into small fragmented steps — give me the whole goal and let me plan
the execution. For example, instead of "add a function to X", give me
"implement feature Y including tests and documentation".

I am strictly limited to repository operations. I cannot manage local
artifacts or state — that is handled by the knowledge-artifacts module.

I am asynchronous — you send me a prompt, I work, and I signal when
I have a plan, a question, or a completion. Expect latency of minutes,
not seconds. The JNA (Jules Negotiator Agent) manages retries and
progress updates autonomously.
  `.trim(),
  tools: [/* ... */],
  sandboxBindings: {
    "askJules": "execute"  // sandbox: await askJules(prompt, successCriteria)
  }
}
```

```typescript
// executor-wasm manifest
{
  id: 'executor-wasm',
  name: 'WASM Sandbox',
  type: 'executor',
  description: `
I am a local sandboxed command executor running in a WASM busybox
environment. I have a cloned copy of the repo mounted as a filesystem.

HOW TO DELEGATE TO ME:
Give me individual commands to run. I am NOT autonomous — I execute
exactly what you tell me and return stdout/stderr. I am fast (milliseconds)
and free. Use me for: file inspection, grep, small scripts, test runs,
git operations. Do NOT give me high-level goals — I need exact commands.

I am synchronous. I return immediately with results.
  `.trim(),
  tools: [runCommandTool, writeFileTool, readFileTool],
  // ...
}
```

The architect LLM reads these descriptions when generating protocols. No enums, no capability matching logic — just natural language reasoning about which executor fits which step.

### 4.3 Tool Naming: Unified vs Diverse

Executors and channels share a **unified tool interface** within their category. Knowledge modules have **diverse, module-specific toolsets**.

Why this split:

- **Executors** all do the same thing: receive work, return results. The architect already decided *which* executor to use per step. The agent just needs to send work to it. One tool name: `execute`.
- **Channels** all do the same thing: deliver a message to the human and optionally wait for a reply. One tool name: `askUser`.
- **Knowledge modules** wrap fundamentally different data models (file trees, artifact stores, issue trackers, vector indexes). Forcing them into a unified `query` interface would lose the semantics the LLM needs. A `searchIssues` tool tells the LLM more than `knowledge-jira.query`.

Tool names are namespaced by module ID: `<executor-jules.execute prompt="..."/>`, `<channel-telegram.askUser question="..."/>`, `<knowledge-repo-browser.listFiles path="src"/>`.

The agent prompt lists all tools from all modules flat — the LLM picks the right namespaced tool for the job.

```typescript
interface ToolDefinition {
  // Full namespaced name: 'executor-jules.execute', 'channel-mailbox.askUser'
  name: string;
  description: string;
  parameters: ParameterSchema;
  moduleId?: string; // set by registry at load time
}
```

### 4.4 Unified Executor Tool: `execute`

Every executor module exposes exactly one tool: `{moduleId}.execute`.

The parameters are identical across executors — a freeform prompt string. What differs is the *semantics* (autonomous vs dumb, async vs sync), which the architect learns from the executor's `description`.

```
<executor-jules.execute prompt="implement feature X with tests"/>
<executor-wasm.execute prompt="grep -r 'TODO' src/"/>
<executor-openclaude.execute prompt="review the auth module for security issues"/>
```

The orchestrator doesn't care about the difference. It sends the prompt to the module worker and waits for the result (or an event, for async executors).

### 4.5 Unified Channel Tool: `askUser`

Every channel module exposes `askUser`. Some may also expose `sendMessage` for one-way notifications.

```
<channel-mailbox.askUser question="Which branch should I target?"/>
<channel-telegram.askUser question="Should I proceed with the migration?"/>
```

The orchestrator routes `askUser` to the user's preferred channel (configurable). If multiple channels are active, the user picks a default, or the system uses all of them (ask in mailbox + Telegram, first reply wins).

### 4.6 Diverse Knowledge Tools

Knowledge modules define their own tools. No unified interface. Examples:

```
<knowledge-artifacts.listArtifacts/>
<knowledge-artifacts.readArtifact artifactId="42"/>
<knowledge-artifacts.saveArtifact name="design.md" content="..."/>

<knowledge-repo-browser.listFiles path="src/services"/>
<knowledge-repo-browser.readFile path="src/types.ts"/>

<knowledge-jira.searchIssues query="status=open AND project=ENG"/>
<knowledge-jira.getIssue issueId="ENG-123"/>
```

### 4.7 System Tools: `spawnSubtask`

Not tied to any module — this is a **host-provided sandbox tool** available to all Programmer Agent code. It allows a task to create a subtask on the board and wait for its result.

```typescript
// In generated sandbox code:
const result = await spawnSubtask({
  title: "Write auth tests",
  description: "Test JWT middleware for: valid token, expired token, missing header, malformed token. Save test file as artifact."
});
// result.artifacts → [{ name: "auth.test.ts", content: "..." }]
// result.status → 'DONE' | 'IN_REVIEW'
```

**How it works:**
1. Programmer Agent's code calls `spawnSubtask({ title, description })`
2. Host creates a new `Task` on the board with `parentTaskId` set to the current task
3. Host sets parent task's `agentState` to `WAITING_FOR_SUBTASK`
4. Subtask runs through the normal pipeline (architect → steps → executors)
5. When subtask reaches `DONE` or `IN_REVIEW`, host resumes the parent
6. Parent receives the subtask's artifacts as the return value

**No steering.** The subtask is self-sufficient. It has access to the same knowledge modules, repo, and artifacts as the parent. Context goes in the description — the parent doesn't know more than the subtask. If the subtask needs clarification, it uses `askUser` (channel), not the parent.

**Why no steering:** Tasks are self-contained. A parent task spawning "write auth tests" has no special knowledge the subtask doesn't. The subtask reads the same repo, same artifacts, same constitution. Steering would require a task-to-task negotiator adapter — unnecessary complexity for no information gain. Provide enough context in the description.

**Blocking semantics:** `spawnSubtask` is a suspension point. The parent worker pauses (not polling — the host resumes it on subtask completion). This is the same pattern as `WAITING_FOR_USER` — the worker is suspended, not busy-waiting.

**`Task` type change:**
```diff
 export interface Task {
   // ... existing fields ...
+  parentTaskId?: string;  // set by spawnSubtask
 }
```

### 4.7.1 Multi-Source Resolution

When `source.repoUrl` is an array, the host fetches all URLs and uses the source with the latest commit timestamp as the current version of the module.

**Resolution algorithm:**
1. For each URL in `source.repoUrl`, fetch the repo at `source.ref`
2. Compare commit timestamps on the ref
3. Use the source with the most recent commit as the active module version
4. Cache the resolved URL — don't re-resolve on every load

**Why:** Users may develop a module in AI Studio (one repo) while also having a copy in another editor (different repo). The system picks whichever was updated most recently. This is a convenience feature for development workflows — production modules should have a single `repoUrl`.

### 4.8 Host-Provided Tools

Not tied to any module. These sandbox tools are injected by the host into every code execution step, regardless of which architect or modules are active.

| Tool | Type | Cost | What it does |
|------|------|------|-------------|
| `GlobalVars.get(key)` / `.set(key, value)` | Core state | Free | Persistent KV store. Survives across steps. Task-scoped. |
| `spawnSubtask({ title, description })` | Task decomposition | Task cost | Creates a child task, blocks parent until done. Returns artifacts. See §4.7. |
| `analyze(text)` | Context transfer (codegen-full only) | LLM call | Structured analysis of text. Result auto-forwarded to all subsequent steps as `accumulatedAnalysis`. See §8.1.0. |
| `addToContext(text)` | Context transfer (codegen-full only) | Free | Remembers string for forwarding to subsequent steps. No LLM call. |

**Rules:**
- `GlobalVars` is always available — every architect, every step.
- `spawnSubtask` is always available — any step can decompose work.
- `analyze` and `addToContext` are codegen-full architect only — they're context transfer tools for multi-step code generation. Single-step architects don't need them. See §8.1.0 for details.

---

## 5. Sandbox: Worker Threads

Modules run in Web Workers. Communication is message-based only.

```
Host (main thread)                  Worker (sandboxed)
  │                                    │
  │  { requestId, method, args }       │
  │ ─────────────────────────────────> │
  │                                    │  module processes
  │  { requestId, result }             │
  │ <───────────────────────────────── │
  │                                    │
  │  { event: 'status', data: ... }    │  (unsolicited push)
  │ <───────────────────────────────── │
```

The host provides:
- **RPC**: `postMessage` with requestId correlation
- **Event bus**: modules can emit events, host routes to subscribers
- **Resource proxy**: modules request DB reads, network access, FS operations through the host (subject to `permissions`)

Workers do NOT get:
- Direct IndexedDB access (host proxies data)
- DOM access
- Unrestricted network access (host gatekeeps based on permissions)

Benefits:
- Module crash doesn't take down the app
- Memory isolation (WASM executor allocating 500MB doesn't starve UI)
- Clean teardown (terminate worker)
- Security boundary (third-party modules can't escape sandbox)

### 5.1 Module Lifecycle

```typescript
// What the module author implements inside the worker
interface ModuleWorker {
  // init receives module-level config only (the module's own configFields values).
  // LLM keys and host config are NOT passed here — they arrive via RequestContext
  // on each handler call.
  init(config: Record<string, any>, hostRpc: HostRpc): Promise<void>;

  // handleRequest is called for every tool invocation.
  // context.llmCall() provides LLM access without the module owning keys.
  handleRequest(method: string, args: any, context: RequestContext): Promise<any>;

  emit(event: ModuleEvent): void;
  destroy(): Promise<void>;
}

// Host RPC interface available in workers
interface HostRpc {
  log(message: string): void;
  emit(event: ModuleEvent): void;
}
```

```typescript
// What the host sees
interface ModuleHost {
  id: string;
  manifest: ModuleManifest;
  worker: Worker;

  // request now includes RequestContext with taskId + llmCall
  request(method: string, args: any, context: RequestContext): Promise<any>;
  onEvent(handler: (event: ModuleEvent) => void): void;
  start(config: Record<string, any>): Promise<void>;
  stop(): Promise<void>;
}
```

---

## 6. Dynamic Prompt Composition

The current `Orchestrator.runStep()` has a hardcoded prompt listing `askJules`, `askUser`, `GlobalVars`, and `Artifacts`. This is replaced by a prompt composer that reads module manifests and sandbox bindings.

### 6.1 Architect Prompt (replaces hardcoded TaskArchitect)

```typescript
function composeArchitectPrompt(modules: ModuleManifest[]): string {
  const executors = modules.filter(m => m.type === 'executor');

  const executorSection = executors.map(e => `
## Executor: "${e.name}"
${e.description}
  `).join('\n---\n');

  return `
You are a Task Architect. Break down the task into steps and assign
each step to the best executor.

AVAILABLE EXECUTORS:
${executorSection}

RULES:
- Read each executor's description carefully.
- Assign each step to the executor that fits best.
- Respect each executor's stated granularity preferences.
- If an executor says "don't micromanage me", give it a large step.
- If an executor says "give me exact commands", break work into small steps.

Output JSON: { steps: [{ id, title, description, executor, status }] }
  `;
}
```

### 6.2 Programmer Agent Prompt (replaces hardcoded Orchestrator prompt)

Currently the prompt in `Orchestrator.ts:119-146` lists APIs by hand. With modules, this is composed dynamically:

```typescript
function composeProgrammerPrompt(modules: ModuleManifest[], task: Task, step: TaskStep, errorContext: string): string {
  // Collect all sandbox bindings from all modules
  const apiSection = modules.flatMap(m =>
    Object.entries(m.manifest.sandboxBindings).map(([alias, toolName]) => {
      const tool = m.manifest.tools.find(t => t.name === toolName);
      return `- ${alias}${paramSummary(tool)} : ${tool?.description || ''}`;
    })
  ).join('\n');

  return `
You are the Main Architect. Write executable JavaScript code to accomplish
the following protocol step.

Task Title: ${task.title}
Task Description: ${task.description}

Current Step: ${step.title}
Step Description: ${step.description}

You have access to a persistent GlobalVars object.
Current GlobalVars: ${JSON.stringify(globalVars.getAll())}

You have access to the following async APIs:
${apiSection}

State management:
- GlobalVars: persistent object to store state across steps.
- Use GlobalVars.get(key) / GlobalVars.set(key, value).

${errorContext ? `PREVIOUS EXECUTION FAILED:\n${errorContext}\nRewrite the code or use askUser().\n` : ''}

Write ONLY valid JavaScript code. No markdown formatting.
The code runs in an async context. You can use await.
  `;
}
```

### 6.3 Sandbox Injection (replaces hardcoded injectAPI calls)

Currently `Orchestrator.executeInSandbox()` hardcodes three injections (`Artifacts`, `askJules`, `askUser`). With modules:

```typescript
// Current (Orchestrator.ts:186-240)
sandbox.injectAPI('Artifacts', ArtifactTool);
sandbox.injectAPI('askJules', async (prompt, criteria) => { /* JNA */ });
sandbox.injectAPI('askUser', async (question, format?) => { /* UNA */ });

// Proposed (driven by registry)
for (const module of registry.getAll()) {
  for (const [alias, toolName] of Object.entries(module.manifest.sandboxBindings)) {
    sandbox.injectAPI(alias, async (...args: any[]) => {
      return module.request(toolName, args);
    });
  }
}
```

Adding `executor-wasm` means adding a binding: `{ "askWasm": "execute" }`. The sandbox automatically gets `askWasm()`. The Programmer Agent prompt automatically lists it. Zero code changes to Orchestrator.

---

## 7. Changes to Existing Types

### 7.1 `TaskStep.delegateTo` becomes `executor`

```diff
 export interface TaskStep {
   id: number;
   title: string;
   description: string;
-  delegateTo: 'local' | 'jules';
+  executor: string;  // module ID, e.g. 'executor-jules', 'executor-wasm'
   status: 'pending' | 'in_progress' | 'completed' | 'failed';
+  dependsOn?: string[];  // step IDs this step depends on (DAG architect)
 }
```

When `dependsOn` is present and non-empty, the host builds a dependency graph. Steps with all dependencies completed run in parallel (`Promise.all`). Steps with no `dependsOn` run immediately (or in sequence for linear architects). Linear architects simply omit this field — backward compatible.

### 7.2 `AgentState` generalizes

```diff
-export type AgentState = 'IDLE' | 'EXECUTING' | 'WAITING_FOR_JULES' | 'WAITING_FOR_USER' | 'PAUSED' | 'ERROR';
+export type AgentState =
+  | 'IDLE'
+  | 'EXECUTING'
+  | 'WAITING_FOR_EXECUTOR'  // was WAITING_FOR_JULES
+  | 'WAITING_FOR_USER'
+  | 'WAITING_FOR_SUBTASK'   // parent paused, waiting for spawned subtask
+  | 'PAUSED'
+  | 'ERROR';
```

The specific executor being waited on is tracked in `Task.pendingExecutorId`, not in the state enum.

### 7.4 `OrchestratorConfig` loses module-specific keys

```diff
 export interface OrchestratorConfig {
   // ... existing fields ...
-  julesApiKey?: string;           // moved to executor-jules configFields
-  julesDailyLimit?: number;       // moved to executor-jules configFields
-  julesConcurrentLimit?: number;  // moved to executor-jules configFields
-  geminiApiKey?: string;          // moved to Host Config (shared LLM)
-  openaiKey?: string;             // moved to Host Config (shared LLM)
-  openaiUrl?: string;             // moved to Host Config (shared LLM)
-  openaiModel?: string;           // moved to Host Config (shared LLM)
-  geminiModel?: string;           // moved to Host Config (shared LLM)
-  apiProvider?: string;           // moved to Host Config (shared LLM)
+  // LLM config is now in Host Config, accessed via RequestContext.llmCall()
+  // Module-specific config is now in module configFields, stored in moduleConfigs
   moduleConfigs: Record<string, any>;  // stays — now keyed by configField.key
 }
```

### 7.5 Handler signature in registry

```diff
 // Current (registry.ts)
-type HandlerFn = (toolName: string, args: any[]) => Promise<any>;
+// Proposed — adds RequestContext
+type HandlerFn = (toolName: string, args: any[], context: RequestContext) => Promise<any>;

 // handlers: Map<string, HandlerFn> — keyed by module ID
```

### 7.6 JulesConfig and ArchitectConfig shrink

```diff
 // JulesConfig — executor-jules types.ts
 export interface JulesConfig {
-  julesApiKey: string;      // was module-specific already, keep as apiKey
-  apiProvider?: string;     // moved to Host Config
-  geminiApiKey?: string;    // moved to Host Config
-  geminiModel?: string;     // moved to Host Config
-  openaiUrl?: string;       // moved to Host Config
-  openaiKey?: string;       // moved to Host Config
-  openaiModel?: string;     // moved to Host Config
-  repoUrl?: string;         // moved to Host Config
-  repoBranch?: string;      // moved to Host Config
+  apiKey: string;           // Jules service key only
+  dailyLimit: number;
+  concurrentLimit: number;
+  pollInterval?: number;
 }

 // ArchitectConfig — architect-codegen types.ts
 export interface ArchitectConfig {
-  apiProvider?: string;     // moved to Host Config
-  geminiApiKey?: string;    // moved to Host Config
-  geminiModel?: string;     // moved to Host Config
-  openaiUrl?: string;       // moved to Host Config
-  openaiKey?: string;       // moved to Host Config
-  openaiModel?: string;     // moved to Host Config
-  repoUrl?: string;         // moved to Host Config
-  repoBranch?: string;      // moved to Host Config
+  modelOverride?: string;   // optional per-module LLM model override
 }
```

Current `Task` already has `jnaLogs`, `unaLogs`, `programmingLog` (added in latest commit). With modules, JNA/UNA logs generalize:

```diff
 export interface Task {
   // ... existing fields ...
   protocol?: TaskProtocol;
   globalVars?: Record<string, any>;
-  pendingJulesPrompt?: string;
+  pendingExecutorPrompt?: string;    // prompt waiting to be sent
+  pendingExecutorId?: string;        // which executor module
-  retryCount?: number;
-  julesRetryCount?: number;
+  retryCounts?: Record<string, number>;  // per-executor retry tracking
-  jnaLogs?: string;     // was only for Jules
-  unaLogs?: string;     // was only for Mailbox
+  moduleLogs?: Record<string, string>;   // per-module logs, keyed by module ID
   programmingLog?: string;   // stays — this is Orchestrator-level, not module-level
 }
```

`moduleLogs['executor-jules']` replaces `jnaLogs`. `moduleLogs['channel-mailbox']` replaces `unaLogs`. This lets any module write to its own log stream.
