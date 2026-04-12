# Agent Reference Guide for Fleet Orchestrator

This document provides essential knowledge for AI agents working in this codebase. Focuses on non-obvious patterns, gotchas, and context that isn't immediately apparent from reading individual files.

## Project Overview

Fleet is a **multi-agent orchestration system** for autonomous software development. It combines a React UI, TypeScript orchestrator, and WebAssembly VM to let AI agents plan, execute, and review coding tasks with human oversight.

**Core Philosophy**: Agent autonomy with explicit human-in-the-loop. Tasks are decomposed into protocols, executed step-by-step in sandboxed environments, with all actions logged for review.

## Essential Commands

### Development
```bash
npm install              # Install dependencies
npm run dev            # Start dev server (runs server.ts on port 3000)
npm run build          # Build for production (vite)
npm run preview        # Preview production build
npm run clean          # Remove dist/
```

### Quality
```bash
npm run lint           # Type check (tsc --noEmit)
npm run test           # Run tests (vitest)
```

### WASM Assets (Optional)
```bash
# Build WASM VM assets via GitHub Actions or manually
# Requires: Docker, Go 1.25.0, TinyGo 0.36.0
# Assets are checked into public/assets/wasm/
```

### Environment
- Set `GEMINI_API_KEY` in `.env.local` or use `process.env.GEMINI_API_KEY` from vite config
- Dev server runs on port 3000
- HMR is **disabled** when `DISABLE_HMR=true` is set (AI Studio default)

## Architecture Overview

### Multi-Agent System

The system orchestrates multiple specialized agents:

1. **Programmer Agent (Architect)** - Generates JavaScript code per task step, runs in Sval sandbox
2. **Jules Negotiator (JNA)** - ReAct loop for autonomous cloud VM coding (Google Jules)
3. **User Negotiator (UNA)** - Mediates human-in-the-loop interactions, validates input format via LLM
4. **Process Agent** - Background governance layer that proposes tasks based on constitution

**Key Constraint**: Programmer Agent never talks to Jules or user directly. All external interactions go through negotiators.

### Module System

Pluggable architecture organized into five categories:

| Category | Direction | Role | Examples |
|----------|-----------|------|----------|
| **Architect** | Host → Module | Generates code/protocol | `architect-codegen` (current Programmer Agent) |
| **Knowledge** | Architect → Module | Provides data | Repository browser, artifact store |
| **Executor** | Architect → Module | Executes work | Jules (cloud), WASM (local), GitHub Actions |
| **Channel** | Architect → Module | User communication | In-app mailbox (via UNA), Telegram (future) |
| **Process** | Module → Board | Autonomous governance | Constitution-based task proposals |

**Each module has:**
- `manifest.json` - Defines tools, permissions, sandbox bindings, config fields
- `Handler.ts` - Implements tool logic
- Optional dual-role: Executors can also run background triggers (e.g., Jules session management)

### Execution Flow

```
User creates task
  ↓
Architect generates protocol (steps)
  ↓
Orchestrator picks first pending step
  ↓
Programmer Agent generates JavaScript code (per step)
  ↓
Code runs in Sval sandbox with injected APIs:
  - readFile/writeFile (knowledge-repo-browser)
  - saveArtifact/listArtifacts (knowledge-artifacts)
  - askJules (executor-jules) → JNA → Google Jules API
  - askUser (channel-user-negotiator) → UNA → Mailbox/external channels
  - GlobalVars.get/set (cross-step state)
  ↓
Step completes, updates DB, triggers next step
  ↓
All steps done → Task moves to IN_REVIEW
```

**Critical**: The Programmer Agent gets a clean slate per step. Only GlobalVars and previous step result survive across steps. No conversational history.

## Code Organization

### Directory Structure

```
src/
├── core/                    # Core orchestration engine
│   ├── orchestrator.ts      # Task lifecycle management
│   ├── sandbox.ts           # Sval sandbox + worker management
│   ├── sandbox.worker.ts    # Worker thread execution
│   ├── registry.ts          # Module registry & initialization
│   ├── event-bus.ts         # Pub/sub for module communication
│   ├── host.ts             # Host init, module handler registration
│   └── types.ts            # Core type definitions
│
├── modules/                 # Pluggable modules
│   ├── executor-jules/      # Google Jules cloud VM executor
│   ├── executor-local/      # Local sandbox executor
│   ├── executor-github/     # GitHub Actions executor
│   ├── executor-wasm/       # WASM VM executor
│   ├── knowledge-repo-browser/  # Repository file operations
│   ├── knowledge-artifacts/     # Artifact storage
│   ├── knowledge-local-analyzer/ # Local code analysis
│   ├── channel-user-negotiator/ # User interaction channel
│   ├── channel-wasm-terminal/   # Terminal UI panel
│   ├── architect-codegen/       # Code generation architect
│   └── process-project-manager/  # Task proposal process
│
├── services/                # Business logic services
│   ├── db.ts               # Dexie database schema & migrations
│   ├── GitFs.ts            # GitHub API wrapper for file operations
│   ├── TaskFs.ts           # Task-scoped virtual filesystem
│   ├── GlobalVars.ts       # Cross-step key-value store
│   ├── RepoCrawler.ts      # Repository analysis
│   └── negotiators/        # Negotiator agent implementations
│       ├── JulesNegotiator.ts
│       └── UserNegotiator.ts
│
├── components/              # React UI components
│   ├── KanbanBoard.tsx     # Main task board
│   ├── TaskCard.tsx
│   ├── TaskDetailsModal.tsx
│   ├── RepositoryBrowser.tsx
│   ├── ArtifactBrowser.tsx
│   ├── MailboxView.tsx
│   └── ...
│
├── lib/                     # Utility libraries
│   ├── jules.ts            # Jules API client
│   ├── julesApi.ts          # Session management
│   ├── data.ts             # Initial task data
│   └── utils.ts            # Helper functions
│
└── types.ts                 # Shared types (Task, WorkflowStatus, AgentState)

wasm/                       # WebAssembly VM components
├── boot/                   # Go code for boot.wasm
│   └── main.go            # Wanix VM entrypoint
├── worker/                 # WASM worker logic
│   └── WasmHandler.ts     # Bridge to VM commands
└── system/                 # VM init scripts
    └── bin/

e2e/                        # End-to-end tests (Puppeteer)
docs/                       # Architecture documentation
```

### Module Manifest Pattern

Every module has a `manifest.json` at its root:

```json
{
  "id": "executor-jules",
  "name": "Google Jules",
  "type": "executor",
  "version": "1.0.0",
  "description": "Fully autonomous coding agent in a cloud VM.",
  "tools": [
    {
      "name": "executor-jules.execute",
      "description": "Send prompt to Jules, poll for completion.",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": { "type": "string" },
          "successCriteria": { "type": "string" }
        }
      }
    }
  ],
  "sandboxBindings": {
    "askJules": "executor-jules.execute"
  },
  "permissions": ["network", "jules-api"],
  "configFields": [
    {
      "key": "julesApiKey",
      "type": "string",
      "label": "Jules API Key",
      "required": true,
      "secret": true
    }
  ]
}
```

**Key concepts:**
- `tools`: API exposed to Programmer Agent via sandbox bindings
- `sandboxBindings`: Mapping from sandbox variable names to tool names
- `permissions`: What the generated code is allowed to do
- `configFields`: Module-specific settings (secrets, tuning knobs)

## Key Patterns & Conventions

### Sandbox Code Generation

The Programmer Agent generates JavaScript that runs in Sval sandbox:

```javascript
// Generated code (simplified)
const content = await readFile('src/App.tsx');
const analysis = await analyze(content);
if (analysis.needsRefactor) {
  const newCode = await refactor(content);
  await writeFile('src/App.tsx', newCode);
  await saveArtifact('refactored.ts', newCode);
}
return { success: true, changes: analysis.changes };
```

**What's injected:**
- Tools from `sandboxBindings` (e.g., `readFile`, `askJules`)
- `GlobalVars.get()` / `GlobalVars.set()` for cross-step state
- `console.log/warn/error` if `logging` permission granted

**Permissions enforced at runtime:**
- `network`: Blocks `fetch`, `XMLHttpRequest`, `WebSocket`
- `timers`: Blocks `setTimeout`, `setInterval`
- `storage`: Blocks file/artifact tools
- `logging`: Controls console access

### Database Schema & Migrations

Uses Dexie (IndexedDB wrapper). Schema versioning is explicit:

```typescript
// src/services/db.ts
class MyDatabase extends Dexie {
  constructor() {
    super('AgentKanbanDB');
    this.version(15).stores({ /* v15 schema */ });
    this.version(16).stores({ /* v16 schema */ })
      .upgrade(tx => {
        // Migration logic: transforms data from v15 to v16
        return tx.table('tasks').toCollection().modify(task => {
          if (task.jnaLogs) {
            task.moduleLogs = task.moduleLogs || {};
            task.moduleLogs['executor-jules'] = task.jnaLogs;
            delete task.jnaLogs;
          }
        });
      });
  }
}
```

**Critical tables:**
- `tasks`: Task objects with protocol, globalVars, moduleLogs
- `julesSessions`: Jules session tracking
- `taskArtifacts`: Generated files/scrapes
- `messages`: User messages + agent proposals
- `projectConfigs`: Per-repo constitution

**Migration pattern**: Always add a new version with `.upgrade()`. Never delete versions.

### Event Bus Communication

Modules emit events via `eventBus` for cross-module communication:

```typescript
// src/core/event-bus.ts
type SystemEvent =
  | { type: 'module:log'; moduleId: string; message: string }
  // Future types: step:complete, artifact:saved, user:message

// Usage
eventBus.emit('module:log', { taskId, moduleId: 'executor-jules', message: 'Session started' });

// Host subscribes and persists
eventBus.on('module:log', async (data) => {
  await db.tasks.update(taskId, {
    moduleLogs: { ...task.moduleLogs, [data.moduleId]: data.message }
  });
});
```

**Why**: Decouples modules from DB schema. Host handles persistence, modules just emit events.

### Three-Layer Config Architecture

```
Host Config (Global)
├── LLM API keys (Gemini, OpenAI)
├── Repository settings (repoUrl, branch)
└── Module enable/disable flags
    ↓
Module Config (Per-module)
├── Service API keys (Jules, GitHub)
├── Resource limits (concurrency, daily quota)
└── Module-specific settings
    ↓
Runtime Context (Per-request)
├── taskId
├── repoUrl
├── repoBranch
└── llmCall() function (access to LLM)
```

**Key principle**: LLM keys are host-level, not per-module. Modules access LLM via `context.llmCall()` provided in `RequestContext`.

### Negotiator Pattern

Negotiators are ReAct loops with their own LLM context:

```typescript
// Jules Negotiator (JNA) pattern
async function execute(prompt: string, successCriteria: string) {
  const sessionId = await createSession(prompt);
  while (true) {
    const status = await pollSession(sessionId);
    if (status.done) {
      const verification = await verifyCompletion(sessionId, successCriteria);
      if (verification.passed) return status.result;
      // Retry with feedback
      await sendFeedback(sessionId, verification.issues);
    }
    await sleep(5000); // Poll interval
  }
}
```

**Why negotiators?**
- Jules: Smart executor needs verification loop (poll → verify → retry)
- User: Input needs format validation via LLM
- Dumb executors (WASM, CLI): No negotiator needed (return result directly)

### Retry Logic

Orchestrator implements step-level retry (max 5 attempts):

```typescript
// src/core/orchestrator.ts:99-130
let errorContext = '';
let attempt = 0;
const maxAttempts = 5;

while (attempt < maxAttempts) {
  attempt++;
  try {
    const code = await this.config.llmCall(prompt);
    await this.executeInSandbox(taskId, code, stepId);
    return; // Success
  } catch (error: any) {
    errorContext = error.message + (error.stack ? `\n${error.stack}` : '');
    // Retry with error context appended to prompt
  }
}
```

**Pattern**: Accumulate error context across attempts. Last attempt uses full error history.

## Testing Approach

### Unit Tests (Vitest)

```bash
npm run test
```

**Test file pattern**: `*.test.ts` or `*.test.tsx` co-located with source

**Example**: `wasm/worker/WasmHandler.test.ts` tests argument unpacking logic in isolation.

### E2E Tests (Puppeteer)

```bash
# Run with default timeout (120s)
npx tsx e2e/terminal-lifecycle.e2e.ts

# Custom timeout (180s)
VM_BOOT_TIMEOUT=180 npx tsx e2e/terminal-lifecycle.e2e.ts

# Skip VM boot (assets not built)
SKIP_VM_BOOT=1 npx tsx e2e/terminal-lifecycle.e2e.ts
```

**What they test**:
- Page load with no fatal JS errors
- Terminal open/close lifecycle
- WASM VM boot (detects "[board VM ready]")
- Terminal interaction (type commands, read output)
- Worker cleanup (no leaked workers)

**Pattern**: Capture all console output + page errors. Dump at end for debugging.

### Module Testing Strategy

Per `docs/modules-testing.md` (proposed):

- **Architect modules**: Test code generation with MockLLM
- **Executor modules**: Test lifecycle with mock executors
- **Knowledge modules**: Test tool handlers with mock data
- **Channel modules**: Test message flow with mock users
- **Process modules**: Test proposal logic with mock board state

**Key**: Each module type needs a test harness. Don't test through the full Orchestrator — test modules in isolation.

## Important Gotchas

### Context Flushing Between Steps

The Programmer Agent's context is **flushed** after each step. Only survive:
- GlobalVars (KV store)
- Previous step result
- Protocol (step definitions)

**NOT preserved**:
- Conversational history
- Inferred context about project structure
- Intermediate variables

**Implication**: Each step must be self-contained. If you need state across steps, use `GlobalVars.set()`.

### Permission Enforcement at Runtime

Permissions are checked **inside** the sandbox worker (`sandbox.worker.ts:15-17`):

```typescript
if (storageTools.includes(toolName) && !permissions.includes('storage')) {
  throw new Error(`Permission denied: storage (tool: ${toolName})`);
}
```

**Gotcha**: Adding a tool to `sandboxBindings` doesn't grant access. Must also add to `permissions` in manifest.

### Module Log Storage Pattern

Modules **don't write to DB directly**. They emit events:

```typescript
// Wrong (direct DB write)
await db.tasks.update(taskId, { jnaLogs: '...' });

// Right (emit event)
eventBus.emit('module:log', { taskId, moduleId: 'executor-jules', message: '...' });
```

Host subscribes and persists. This decouples modules from DB schema.

### JNA Polling Interval

Jules Negotiator polls every 5 seconds (`src/modules/executor-jules/JulesNegotiator.ts`):

```typescript
const POLL_INTERVAL = 5000;
await sleep(POLL_INTERVAL);
```

**Gotcha**: Changing this requires updating the module. Hardcoded, not configurable.

### Worker Thread Isolation

Each sandbox execution runs in its own Worker (`sandbox.worker.ts`). If generated code infinite-loops, it **only kills its own worker**, not the main thread.

**Implication**: Can't share state between workers. Each execution is isolated.

### HMR Disabled in AI Studio

Vite config (`vite.config.ts:18-22`):

```typescript
server: {
  hmr: process.env.DISABLE_HMR !== 'true',
}
```

AI Studio sets `DISABLE_HMR=true` to prevent flickering during agent edits. Manually unset for faster development.

### Git Cache in Dexie

`GitFs.ts` caches GitHub API responses in Dexie to avoid rate limits:

```typescript
// src/services/GitFs.ts
const cached = await db.gitCache.get(path);
if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
  return cached.content;
}
```

**Gotcha**: Changes to remote repo won't appear until cache expires. Clear DB to refresh.

### WASM Asset Loading

WASM assets (`boot.wasm`, `sys.tar.gz`, `wanix.min.js`) are loaded from `/assets/wasm/`. If missing, terminal shows error.

**Build**: Use GitHub Actions workflow (`.github/workflows/build-wasm-assets.yml`) or manually copy to `public/assets/wasm/`.

## Type System

### Core Types (src/types.ts)

```typescript
type WorkflowStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
type AgentState = 'IDLE' | 'EXECUTING' | 'WAITING_FOR_EXECUTOR' | 'WAITING_FOR_USER' | 'PAUSED' | 'ERROR';
type AutonomyMode = 'manual' | 'assisted' | 'full';

interface TaskStep {
  id: number;
  title: string;
  description: string;
  executor: string;  // Maps to module.id
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

interface Task {
  id: string;
  title: string;
  description: string;
  workflowStatus: WorkflowStatus;
  agentState: AgentState;
  protocol?: TaskProtocol;
  globalVars?: Record<string, any>;
  moduleLogs?: Record<string, string>;  // moduleId → log string
  analysis?: string;  // Architect's accumulated analysis
}
```

### Module Types (src/core/types.ts)

```typescript
interface ModuleManifest {
  id: string;
  type: 'architect' | 'knowledge' | 'executor' | 'channel' | 'process';
  tools: ToolDefinition[];
  sandboxBindings: Record<string, string>;
  permissions: string[];
  configFields?: ConfigField[];
  init?: (config: any) => void;
  destroy?: () => void;
}

interface RequestContext {
  taskId: string;
  repoUrl: string;
  repoBranch: string;
  llmCall: (prompt: string, jsonMode?: boolean) => Promise<string>;
  moduleConfig: any;  // From module configFields
}
```

## Build & Deployment

### Vite Build

```bash
npm run build  # Outputs to dist/
```

Vite handles:
- React JSX transformation
- TypeScript compilation
- Asset bundling (WASM, images)
- Source map generation

### WASM Asset Build (Optional)

Triggered by:
- Push to `wasm/boot/**`, `wasm/system/**`, `Dockerfile.wasm`
- Manual workflow dispatch

**Outputs**:
- `public/assets/wasm/boot.wasm`
- `public/assets/wasm/sys.tar.gz`
- `public/assets/wasm/wanix.min.js`

**Process**: Docker builds, extracts, commits back to repo (with `[skip ci]`).

### Production Server

```bash
npm run start  # Serves dist/ via Express
```

**Environment**: `NODE_ENV=production` disables Vite dev middleware, serves static files from `dist/`.

## Working with Modules

### Adding a New Module

1. Create directory under `src/modules/{category}-{name}/`
2. Add `manifest.json` with module metadata
3. Implement `Handler.ts` with tool handlers
4. Register in `src/core/registry.ts`:

```typescript
import myManifest from '../modules/my-module/manifest.json';
import { MyHandler } from '../modules/my-module/Handler';

export class ModuleRegistry {
  private modules: ModuleManifest[] = [
    { ...myManifest, enabled: true, init: MyHandler.init, destroy: MyHandler.destroy },
    // ...
  ];
}
```

5. Host automatically initializes modules via `host.init(config)`

### Module Handler Signature

```typescript
export const MyHandler = {
  async init(config: any) {
    // Called on host init. Access module config from configFields
  },
  async destroy() {
    // Called on host teardown. Cleanup resources
  },
  // Tool handlers are registered via registry.registerHandler()
};

// Example tool handler
async function myTool(toolName: string, args: any[], context: RequestContext): Promise<any> {
  const { taskId, repoUrl, llmCall } = context;
  // Implement tool logic
}
```

### Dual-Role Modules

Executors can run background triggers:

```typescript
// executor-jules is both executor AND process
const julesManifest = {
  type: 'executor',
  tools: [/* executor tools */],
  backgroundSchedule: '*/5 * * * *',  // Every 5 seconds (cron syntax)
};

// Background tick function
async function processTick() {
  // Manage Jules sessions, cleanup stale ones, etc.
}
```

**Pattern**: Used for lifecycle management (session pooling, resource cleanup, health checks).

## Common Issues & Solutions

### Issue: "Module not found" error

**Cause**: Module not registered in `registry.ts`

**Fix**: Add module to `modules` array in `ModuleRegistry` constructor

### Issue: "Permission denied: network" in sandbox

**Cause**: Code tries to `fetch()` but `network` permission not granted

**Fix**: Add `"network"` to `permissions` in module manifest

### Issue: GlobalVars not persisting across steps

**Cause**: Not saving after step execution

**Fix**: Ensure `orchestrator.executeInSandbox()` updates task with `globalVars`:

```typescript
await db.tasks.update(taskId, { globalVars: globalVars.getAll() });
```

### Issue: WASM VM won't boot

**Cause**: Missing assets in `public/assets/wasm/`

**Fix**: Build via GitHub Actions or manually copy assets. Check browser console for 404s.

### Issue: E2E test times out on VM boot

**Cause**: Default timeout (120s) too short

**Fix**: Run with custom timeout:

```bash
VM_BOOT_TIMEOUT=180 npx tsx e2e/terminal-lifecycle.e2e.ts
```

### Issue: Module logs not appearing in UI

**Cause**: Emitting logs to wrong event type or not emitting at all

**Fix**: Emit to `'module:log'`:

```typescript
eventBus.emit('module:log', { taskId, moduleId: 'my-module', message: '...' });
```

Host automatically persists to `task.moduleLogs[moduleId]`.

## Performance Considerations

### Worker Thread Pool

Each sandbox execution creates a new Worker. Workers are not reused.

**Implication**: No worker reuse overhead. Each execution is isolated.

### Polling vs. WebSockets

JNA uses polling (5s intervals) instead of WebSockets.

**Why**: Simpler, no connection management overhead. Trade-off: latency vs. complexity.

### Git Cache TTL

Default cache TTL is not explicitly defined in code. Check `GitFs.ts` for `CACHE_TTL` constant.

**Recommendation**: Clear DB if you see stale data.

### Database Indexing

Dexie indexes are defined in `.stores()` calls:

```typescript
this.version(17).stores({
  tasks: 'id, workflowStatus, agentState, createdAt',  // Indexed fields
  messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
});
```

**Gotcha**: Only indexed fields support efficient queries. Use `.filter()` for non-indexed fields (slower).

## Security Considerations

### Sandbox Isolation

Sval sandbox provides **language-level** isolation, not OS-level. Generated code still runs in browser process.

**What's blocked**: Access to DOM, `window`, `document`, network APIs (if no permission)
**What's allowed**: Async/await, tool calls, `console.log` (if logging permission)

### API Key Storage

- LLM keys (Gemini, OpenAI): In `HostConfig`, stored in localStorage
- Module keys (Jules, GitHub): In `ModuleConfig`, stored in localStorage

**Gotcha**: Not encrypted. LocalStorage is accessible to any script in same origin.

### Permission System

Permissions are checked **inside** sandbox worker (`sandbox.worker.ts`). Host passes permissions to worker via `postMessage`.

**Attack surface**: If worker is compromised, attacker can bypass checks. Mitigation: Worker isolation (one per execution).

### Content Security Policy

No CSP headers configured. All scripts run in same origin.

**Recommendation**: Add CSP for production deployments.

## Extending the System

### Adding New Event Types

1. Update `SystemEvent` type in `event-bus.ts`:

```typescript
type SystemEvent =
  | { type: 'module:log'; ... }
  | { type: 'artifact:saved'; artifactId: number };
```

2. Subscribe in `host.ts`:

```typescript
eventBus.on('artifact:saved', async (data) => {
  // Handle artifact saved event
});
```

3. Emit from modules:

```typescript
eventBus.emit('artifact:saved', { taskId, artifactId: 123 });
```

### Custom Executors

Follow the executor pattern:

```typescript
// manifest.json
{
  "type": "executor",
  "tools": [
    { "name": "my-executor.run", "parameters": { "code": "string" } }
  ],
  "sandboxBindings": { "runMyCode": "my-executor.run" },
  "permissions": ["network"]
}

// Handler.ts
async function run(toolName: string, args: any[], context: RequestContext) {
  const code = args[0].code;
  // Execute code in your environment (VM, container, etc.)
  return { output: '...' };
}
```

**Decision point**: Does executor need a negotiator?
- **Smart executors** (cloud VMs, AI services): Yes, need poll → verify → retry loop
- **Dumb executors** (CLI, WASM): No, return result directly

### Custom Channels

Channel modules provide user communication:

```typescript
// manifest.json
{
  "type": "channel",
  "tools": [
    { "name": "my-channel.ask", "parameters": { "question": "string" } }
  ],
  "sandboxBindings": { "askUserOnMyChannel": "my-channel.ask" }
}

// Handler.ts
async function ask(toolName: string, args: any[], context: RequestContext) {
  const question = args[0].question;
  // Send question via your channel (Telegram, Slack, email)
  // Poll for response or wait for webhook
  return { answer: '...' };
}
```

**Integration**: UNA calls channel tools. Format validation happens in UNA via LLM.

## Documentation References

Key architecture docs in `/docs/`:

- `DESIGN_PHILOSOPHY.md` - Core philosophy and design principles
- `modules.md` - Module system overview (proposal)
- `modules-spec.md` - Module interface specification
- `modules-catalog.md` - Bundled modules catalog
- `modules-testing.md` - Module testing strategy
- `modules-ui.md` - Module management UI design

**Read these** before making architectural changes. The module system is evolving (proposal status as of April 2026).

## Summary

**What makes this codebase unique**:

1. **Multi-agent orchestration** with clear role separation (Programmer, Negotiators, Process Agents)
2. **Module system** for pluggable executors, knowledge sources, channels
3. **Sandboxed code generation** via Sval with permission enforcement
4. **Three-layer config** (Host/Module/Runtime) separating concerns
5. **Event-driven logging** decoupling modules from DB schema
6. **WASM VM** for terminal/file operations in browser
7. **Retry logic** at step level with error context accumulation

**Key gotchas to remember**:

- Programmer context flushed between steps (only GlobalVars survive)
- Modules emit events, don't write to DB directly
- Permissions checked inside sandbox worker, not just manifest
- JNA polls every 5s (hardcoded)
- HMR disabled in AI Studio
- Each sandbox execution gets new Worker (no reuse)

**Commands to remember**:

- `npm run dev` - Start dev server
- `npm run test` - Run unit tests
- `npm run lint` - Type check
- `VM_BOOT_TIMEOUT=180 npx tsx e2e/terminal-lifecycle.e2e.ts` - E2E tests
- `SKIP_VM_BOOT=1 npx tsx e2e/terminal-lifecycle.e2e.ts` - E2E without VM

When in doubt, read `DESIGN_PHILOSOPHY.md` for rationale, check `docs/modules-*.md` for module system details, and inspect `orchestrator.ts` for execution flow.
