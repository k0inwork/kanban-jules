# Executor Architecture & E2B Integration Design

## Current Executor Status

Fleet has 4 executor modules, 3 active, 1 disabled:

| Executor | Status | What it does | Where code runs |
|----------|--------|-------------|-----------------|
| `executor-local` | Active | Placeholder handler; Orchestrator generates JS and runs it in Sval sandbox (Web Worker) | Browser (Sval interpreter) |
| `executor-jules` | Active | Delegates coding tasks to Google Jules API. Steering loop: send prompt → poll → verify → feed back | Google Cloud (Jules VM) |
| `executor-github` | Active | Creates GitHub Actions workflow YAML, pushes branch, polls for completion | GitHub Actions runners |
| `executor-wasm` | Disabled | Shell commands in ephemeral WASM Linux VM (Alpine) | Browser (v86 WebAssembly) |

### Key Insight

Only `executor-local` runs code through the Orchestrator's own sandbox (Sval JS interpreter). The other executors expose **tools** that sandbox code *calls* — the sandbox code orchestrates them, it doesn't replace them. So `step.executor` determines which tool set is available to the generated code, not necessarily where the code itself runs.

---

## Architecture Overview

### Registration Flow

```
manifest.json (tools[] + sandboxBindings + type: "executor")
    │
    ▼
registry.ts — ModuleRegistry constructor statically imports all manifests
    │
    ▼
host.ts — ModuleHost.init() instantiates handler classes, calls
          registry.registerModuleHandlers(moduleId, handler.handleRequest)
    │
    ▼
registry.ts — maps each qualified tool name → handler function
    (e.g. "executor-github.runWorkflow" → githubHandler.handleRequest)
```

### Dispatch Chain (Task → Execution)

```
1. Task created with workflowStatus: 'TODO'
       │
2. Orchestrator.processTask()
       │
3. Architect generates protocol (list of steps, each with executor field)
       │
4. Step iteration loop: find next 'pending' step → mark 'in_progress'
       │
5. runStep():
   a. Knowledge projection (ProjectorHandler.project())
   b. Compose programmer prompt (includes executor's sandboxBindings API)
   c. LLM generates JavaScript code
   d. Save code + seed to Dexie
   e. executeInSandbox()
       │
6. executeInSandbox():
   a. Resolve executor module from step.executor
   b. Merge module sandboxBindings + common bindings
   c. Create Sandbox (Web Worker + Sval interpreter)
   d. Inject bindings as callable functions
   e. Execute generated code
```

### The Handler Contract

There is **no formal interface or base class**. The contract is pure convention:

1. A `manifest.json` with `type: "executor"` and required fields
2. A handler class with method: `handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any>`
3. Internal switch on `toolName` to dispatch to private methods

**RequestContext** provides: `taskId`, `repoUrl`, `repoBranch`, `githubToken`, `taskDir`, `branchName`, `llmCall`, `moduleConfig`.

### Sandbox System

The sandbox is a **two-process architecture**:

```
Main Thread (sandbox.ts)          Web Worker (sandbox.worker.ts)
┌─────────────────────────┐       ┌────────────────────────────┐
│ Creates Worker          │──────▶│ Sval JS interpreter        │
│ pendingToolCalls Map    │       │ ecmaVer: 2019, sandBox:true│
│                         │       │                            │
│ On worker 'toolCall':   │◀──────│ Code calls binding function│
│   → toolRequestHandler  │       │                            │
│   → post 'toolResponse' │──────▶│ Receives result            │
│                         │       │                            │
│ historyRecorder saves   │       │ Deterministic: seeded      │
│ each call to Dexie      │       │ Math.random + Date.now()   │
└─────────────────────────┘       └────────────────────────────┘
```

**Permission enforcement** in the worker:
- `storage` — required for repo-browser, artifact tools
- `network` — controls fetch/XHR/WebSocket availability
- `timers` — controls setTimeout/setInterval
- `web-worker` — for WASM executor

**sandboxBindings** is the **sole mechanism** controlling what LLM-generated code can call. Only tools present in the final merged bindings object are injected into the Sval interpreter.

### Progress Reporting

| Channel | Mechanism | What carries it |
|---------|-----------|-----------------|
| Event Bus | `eventBus.emit('module:log', { taskId, moduleId, message })` | Real-time execution logs → Agent Tree, UI |
| Chat Log | `logToChat()` appends to `task.chat` | User-visible messages |
| Step Status | Dexie update: step → 'completed'/'error' | Persistence |
| Executor-specific | Handler's own `logToExecutor()` | Executor-scoped events |

### Result Flow

```
Sandbox returns value
    → Sandbox controller resolves promise
    → executeInSandbox logs success to chat
    → Merge analysis into task.analysis
    → Mark step 'completed', clear ephemeral state
    → If all steps done: emit 'executor:completed' on EventBus
    → Record outcome in Knowledge Base
    → Trigger process-dream.microDream for self-reflection

On failure:
    → Error propagates to runStep catch block
    → Error context accumulated
    → Code + history wiped
    → Retry up to 5 attempts
```

---

## Adding a New Executor: The Recipe

To add a new executor, you need exactly **3 files** + 1 code edit:

### Step 1: Create the module directory

```
src/modules/executor-<name>/
├── manifest.json
└── <Name>Handler.ts
```

### Step 2: Write `manifest.json`

```json
{
  "id": "executor-<name>",
  "name": "Human-Readable Name",
  "version": "1.0.0",
  "type": "executor",
  "description": "What this executor does and when to use it.",
  "tools": [
    {
      "name": "executor-<name>.execute",
      "description": "Primary tool description. What the LLM-generated code calls.",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": { "type": "string", "description": "What to do" }
        },
        "required": ["prompt"]
      }
    }
  ],
  "sandboxBindings": {
    "<shortName>": "executor-<name>.execute",
    "KB_record": "knowledge-kb.recordEntry",
    "KB_queryDocs": "knowledge-kb.queryDocs"
  },
  "permissions": ["network", "timers"],
  "configFields": [
    {
      "key": "apiKey",
      "type": "string",
      "label": "API Key",
      "description": "Service API key",
      "required": true,
      "secret": true
    }
  ],
  "enabled": true
}
```

The `sandboxBindings` field controls what tools the LLM-generated code has access to. Common patterns:
- Re-export KB tools (`KB_record`, `KB_queryDocs`) so the executor can store findings
- Re-export user channel (`askUser`, `sendUser`) for interactive tasks
- Re-export repo browser (`readFile`, `writeFile`) if the executor needs file access

### Step 3: Write the handler

```typescript
// src/modules/executor-<name>/<Name>Handler.ts

export class NameHandler {
  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    const params = unpack(args);

    switch (toolName) {
      case 'executor-<name>.execute':
        return this.execute(params, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async execute(params: any, context: RequestContext): Promise<any> {
    // Your implementation here
    // context provides: taskId, repoUrl, repoBranch, githubToken,
    //                    taskDir, branchName, llmCall, moduleConfig
    //
    // Emit progress:
    //   eventBus.emit('module:log', {
    //     taskId: context.taskId,
    //     moduleId: 'executor-<name>',
    //     message: 'Doing something...'
    //   });
    //
    // Return result to the sandbox
    return { status: 'success', output: '...' };
  }
}

function unpack(args: any[]): any {
  return args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
    ? args[0] : {};
}
```

### Step 4: Register in `host.ts`

```typescript
// In src/core/host.ts, ModuleHost.init():

import { NameHandler } from '../modules/executor-<name>/<Name>Handler';
import * as nameManifest from '../modules/executor-<name>/manifest.json';

// Add to registry (constructor):
{ ...nameManifest, enabled: true, init: () => {}, destroy: () => {} },

// Add handler registration:
const nameHandler = new NameHandler();
registry.registerModuleHandlers('executor-<name>', nameHandler.handleRequest.bind(nameHandler));
```

### Step 5: Add to architect prompt (optional)

In `src/core/prompt.ts`, add the executor to the list the architect knows about, so it can assign steps to the new executor.

---

## E2B Integration Design

### What is E2B?

E2B provides **cloud microVM sandboxes** built on Firecracker (same tech as AWS Lambda). Each sandbox is a lightweight, ephemeral Linux VM where AI agents can:
- Execute arbitrary code (Python, JS, shell, etc.)
- Read/write files in a real filesystem
- Access the network (install packages, API calls, git clone)
- Run processes with full stdout/stderr streaming

### Why E2B for Fleet?

| Limitation | Current Solution | E2B Solution |
|-----------|-----------------|--------------|
| No shell access | executor-local uses Sval (JS interpreter only) | Full Linux shell: bash, grep, npm test, pip install |
| No native code | Sval can't run binaries | Can run any compiled language |
| No real git | git_ops tool blocked | Full git CLI in the VM |
| No test runners | test_run blocked | Run Jest, Vitest, Pytest natively |
| No package install | Must pre-bundle everything | npm install, pip install on the fly |
| Deterministic replay | Sval seeds Math.random + Date.now | N/A (cloud VM, non-deterministic) |
| Cost | Free (browser) | Usage-based pricing |

### Proposed Architecture

```
                    Fleet Browser App
                    ┌──────────────────────────────────────┐
                    │  Orchestrator                         │
                    │    │                                  │
                    │    ▼                                  │
                    │  executor-e2b handler                 │
                    │    │                                  │
                    │    ▼                                  │
                    │  E2B SDK (browser or backend proxy)   │
                    └────┬─────────────────────────────────┘
                         │ HTTPS
                         ▼
                    ┌──────────────┐
                    │  E2B Cloud   │
                    │  ┌──────────┐│
                    │  │ Firecracker│
                    │  │ microVM   ││
                    │  │           ││
                    │  │ /repo     ││ ← cloned from GitHub
                    │  │ /workspace││ ← agent working dir
                    │  └──────────┘│
                    └──────────────┘
```

### Integration Options

#### Option A: Direct from Browser (simpler)

```
Browser → E2B SDK (client-side) → E2B Cloud
```

- **Pros**: No backend needed, fast to implement
- **Cons**: E2B API key exposed in browser (security risk)
- **Best for**: Development, personal use, trusted environments

#### Option B: Backend Proxy (production)

```
Browser → Fleet API route → E2B SDK (server-side) → E2B Cloud
```

- **Pros**: API key stays on server, can add rate limiting, auth
- **Cons**: Requires a backend (Express, Next.js API route, or Cloudflare Worker)
- **Best for**: Multi-user production deployment

#### Option C: Hybrid (recommended)

```
Browser → E2B SDK for sandbox streaming
       → Fleet backend for sandbox creation (holds API key)
```

- Browser creates sandboxes via a thin backend proxy (just holds the API key)
- Streams process stdout/stderr directly from E2B to browser via WebSocket
- Best balance of security and real-time interactivity

### Proposed Implementation

#### manifest.json

```json
{
  "id": "executor-e2b",
  "name": "E2B Sandbox",
  "version": "1.0.0",
  "type": "executor",
  "description": "Runs code in E2B cloud microVM sandboxes. Full Linux environment with shell access, package installation, test runners, and network. Use for tasks requiring real process execution.",
  "tools": [
    {
      "name": "executor-e2b.execute",
      "description": "Execute a shell command in an E2B sandbox VM. Returns stdout, stderr, and exit code.",
      "parameters": {
        "type": "object",
        "properties": {
          "command": { "type": "string", "description": "Shell command to execute" },
          "timeout": { "type": "number", "description": "Timeout in seconds (default 30)" },
          "cwd": { "type": "string", "description": "Working directory (default /workspace)" }
        },
        "required": ["command"]
      }
    },
    {
      "name": "executor-e2b.writeFile",
      "description": "Write a file to the E2B sandbox filesystem.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["path", "content"]
      }
    },
    {
      "name": "executor-e2b.readFile",
      "description": "Read a file from the E2B sandbox filesystem.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "executor-e2b.installPackages",
      "description": "Install packages in the E2B sandbox. Auto-detects npm/pip based on file extensions.",
      "parameters": {
        "type": "object",
        "properties": {
          "packages": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Package names to install"
          },
          "manager": {
            "type": "string",
            "enum": ["npm", "pip"],
            "description": "Package manager (auto-detected if omitted)"
          }
        },
        "required": ["packages"]
      }
    },
    {
      "name": "executor-e2b.runTests",
      "description": "Run tests in the E2B sandbox. Auto-detects framework (Jest/Vitest/Pytest).",
      "parameters": {
        "type": "object",
        "properties": {
          "testPath": { "type": "string", "description": "Specific test file or directory" },
          "coverage": { "type": "boolean", "description": "Enable coverage report" }
        }
      }
    }
  ],
  "sandboxBindings": {
    "e2b": "executor-e2b.execute",
    "e2bWriteFile": "executor-e2b.writeFile",
    "e2bReadFile": "executor-e2b.readFile",
    "e2bInstall": "executor-e2b.installPackages",
    "e2bTest": "executor-e2b.runTests",
    "askUser": "channel-user-negotiator.askUser",
    "sendUser": "channel-user-negotiator.sendUser",
    "saveArtifact": "knowledge-artifacts.saveArtifact",
    "listArtifacts": "knowledge-artifacts.listArtifacts",
    "readArtifact": "knowledge-artifacts.readArtifact",
    "KB_record": "knowledge-kb.recordEntry",
    "KB_queryLog": "knowledge-kb.queryLog",
    "KB_queryDocs": "knowledge-kb.queryDocs",
    "KB_saveDoc": "knowledge-kb.saveDocument"
  },
  "permissions": ["network", "timers", "storage"],
  "configFields": [
    {
      "key": "e2bApiKey",
      "type": "string",
      "label": "E2B API Key",
      "description": "Get from https://e2b.dev/dashboard",
      "required": true,
      "secret": true
    },
    {
      "key": "e2bTemplate",
      "type": "string",
      "label": "Sandbox Template",
      "description": "E2B template ID (default: base Ubuntu with Node.js + Python)",
      "required": false
    },
    {
      "key": "e2bTimeout",
      "type": "number",
      "label": "Default Timeout (seconds)",
      "description": "Default sandbox timeout per command",
      "required": false,
      "default": 300
    }
  ],
  "enabled": true
}
```

#### E2BHandler.ts (outline)

```typescript
import { Sandbox } from '@e2b/sdk';
import { eventBus } from '../../core/event-bus';

export class E2BHandler {
  private sandboxes = new Map<string, Sandbox>(); // taskId → sandbox

  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    const params = unpack(args);

    switch (toolName) {
      case 'executor-e2b.execute':      return this.execute(params, context);
      case 'executor-e2b.writeFile':     return this.writeFile(params, context);
      case 'executor-e2b.readFile':      return this.readFile(params, context);
      case 'executor-e2b.installPackages': return this.installPackages(params, context);
      case 'executor-e2b.runTests':      return this.runTests(params, context);
      default: throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async getOrCreateSandbox(context: RequestContext): Promise<Sandbox> {
    const existing = this.sandboxes.get(context.taskId);
    if (existing) return existing;

    const apiKey = context.moduleConfig?.e2bApiKey;
    const template = context.moduleConfig?.e2bTemplate;

    eventBus.emit('module:log', {
      taskId: context.taskId,
      moduleId: 'executor-e2b',
      message: 'Creating E2B sandbox...'
    });

    const sandbox = await Sandbox.create({
      apiKey,
      template,
      envVars: {
        REPO_URL: context.repoUrl,
        BRANCH: context.repoBranch,
      },
    });

    // Clone the repo into the sandbox
    await sandbox.process.startAndWait({
      cmd: `cd /home/user && git clone --branch ${context.repoBranch} https://github.com/${context.repoUrl}.git /workspace`,
    });

    this.sandboxes.set(context.taskId, sandbox);
    return sandbox;
  }

  private async execute(params: any, context: RequestContext): Promise<any> {
    const sandbox = await this.getOrCreateSandbox(context);

    eventBus.emit('module:log', {
      taskId: context.taskId,
      moduleId: 'executor-e2b',
      message: `$ ${params.command}`
    });

    const result = await sandbox.process.startAndWait({
      cmd: params.command,
      cwd: params.cwd || '/workspace',
      timeoutMs: (params.timeout || 30) * 1000,
    });

    eventBus.emit('module:log', {
      taskId: context.taskId,
      moduleId: 'executor-e2b',
      message: `exit ${result.exitCode}: ${result.stdout.slice(0, 200)}`
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  private async writeFile(params: any, context: RequestContext): Promise<any> {
    const sandbox = await this.getOrCreateSandbox(context);
    await sandbox.filesystem.write(params.path, params.content);
    return { status: 'ok' };
  }

  private async readFile(params: any, context: RequestContext): Promise<any> {
    const sandbox = await this.getOrCreateSandbox(context);
    const content = await sandbox.filesystem.read(params.path);
    return { content };
  }

  private async installPackages(params: any, context: RequestContext): Promise<any> {
    const sandbox = await this.getOrCreateSandbox(context);
    const manager = params.manager || 'npm';
    const installCmd = manager === 'pip'
      ? `pip install ${params.packages.join(' ')}`
      : `npm install ${params.packages.join(' ')}`;

    const result = await sandbox.process.startAndWait({
      cmd: installCmd,
      cwd: '/workspace',
    });
    return { stdout: result.stdout, exitCode: result.exitCode };
  }

  private async runTests(params: any, context: RequestContext): Promise<any> {
    const sandbox = await this.getOrCreateSandbox(context);
    const coverageFlag = params.coverage ? ' --coverage' : '';
    const testPath = params.testPath || '';

    // Try common test commands
    const result = await sandbox.process.startAndWait({
      cmd: `cd /workspace && npx vitest run ${testPath}${coverageFlag} 2>/dev/null || npx jest ${testPath}${coverageFlag} 2>/dev/null || pytest ${testPath}${coverageFlag ? ' --cov' : ''}`,
      timeoutMs: 120000,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async destroySandbox(taskId: string): Promise<void> {
    const sandbox = this.sandboxes.get(taskId);
    if (sandbox) {
      await sandbox.close();
      this.sandboxes.delete(taskId);
    }
  }
}
```

### Architect Integration

Add to the architect prompt (`src/core/prompt.ts`) so it knows when to use E2B:

```
- executor-e2b: Use for tasks requiring real shell commands, package installation,
  test execution, or native code compilation. Provides a full Linux VM with
  network access. Prefer for: running tests, installing dependencies, git operations,
  multi-language support (Python, Go, Rust), and long-running processes.
  Avoid for: simple file reads/writes (use executor-local instead).
```

### Lifecycle: Task with E2B Steps

```
1. Architect generates protocol:
   Step 1: executor-e2b — "Install dependencies and set up test environment"
   Step 2: executor-e2b — "Run the test suite and capture results"
   Step 3: executor-local — "Generate fix based on test output"

2. Orchestrator.processTask():
   Step 1 → E2B sandbox created, repo cloned, npm install runs
   Step 2 → Tests run in same sandbox (reused by taskId)
   Step 3 → Test results fed to LLM, fix generated in Sval sandbox

3. On executor:completed:
   → E2B sandbox destroyed
   → Results stored in Knowledge Base
   → Artifacts (test output, coverage) saved
```

### Differences from Existing Executors

| Aspect | executor-local | executor-jules | executor-github | executor-e2b (proposed) |
|--------|---------------|---------------|-----------------|------------------------|
| Where code runs | Browser (Sval) | Google Cloud | GitHub runners | E2B cloud VM |
| Shell access | No (JS only) | Yes (remote) | Yes (CI) | Yes (full Linux) |
| File system | Virtual (VFS) | Remote | Remote | Real Linux FS |
| Network | No | Yes | Yes | Yes |
| Test runners | Blocked | Yes | Yes | Yes |
| Package install | No | Yes | Yes | Yes |
| Deterministic | Yes (seeded) | No | No | No |
| Cost | Free | Per-task | Per-workflow | Per-second |
| Latency | Instant | 30s-5min | 1-10min | 2-10s startup |
| Sandbox reuse | Per-step | Per-task | Per-workflow | Per-task |

### Open Questions

1. **API key management**: Store in module config (current pattern) or use a backend proxy?
2. **Sandbox pooling**: Keep warm sandboxes to reduce startup latency, or create per-task?
3. **Custom templates**: Pre-bake templates with project dependencies vs install on the fly?
4. **Streaming output**: Should stdout/stderr stream in real-time via EventBus or buffer until done?
5. **Cost controls**: Daily/hourly budgets, max concurrent sandboxes, auto-timeout?
6. **Deterministic replays**: E2B is non-deterministic (unlike Sval). How to handle execution history replay?

### Implementation Checklist

- [ ] `npm install @e2b/sdk`
- [ ] Create `src/modules/executor-e2b/manifest.json`
- [ ] Create `src/modules/executor-e2b/E2BHandler.ts`
- [ ] Register in `src/core/host.ts` (manifest + handler)
- [ ] Add to architect prompt in `src/core/prompt.ts`
- [ ] Add config UI for E2B API key in Settings panel
- [ ] Add E2B status indicator in Agent Tree panel
- [ ] Write tests for E2BHandler
- [ ] Handle sandbox cleanup on task completion / error
- [ ] Add cost tracking / budget limits
- [ ] Test with real E2B API
