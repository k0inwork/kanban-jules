# Fleet Integration Architecture

> Agent in almostnode. Tools through boardVM. Bash through v86.
> Jules for heavy coding. Browser UI as dashboard.

## 1. The Model

```
User
  │
  ▼
React UI (dashboard — shows state, lets user intervene)
  │
  │ user messages, task display
  │
  ▼
boardVM (bridge on window.globalThis)
  │
  ▼
almostnode (agent's home — in browser)
  │
  │  every tool call exits almostnode via shim
  │  shim calls boardVM.dispatchTool(name, args)
  │  boardVM routes to Fleet's ModuleRegistry
  │
  ├── readFile, writeFile, listFiles, headFile  → knowledge-repo-browser
  ├── askUser                                    → channel-user-negotiator
  ├── saveArtifact, listArtifacts, readArtifact  → knowledge-artifacts
  ├── askJules                                   → executor-jules (cloud VM)
  ├── runWorkflow, getRunStatus, fetchArtifacts   → executor-github
  ├── scan                                       → knowledge-local-analyzer
  ├── analyze                                    → host.analyze
  ├── addToContext                                → host.addToContext
  ├── globalVarsGet, globalVarsSet               → host.globalVars
  │
  └── bash, shell, exec                          → v86 VM (Wanix, via WISP)
                                                    ↕ WISP relay
                                                  Node.js server
                                                    ↕ real TCP
                                                  git, npm, grep, etc.
```

**One escape hatch. Everything goes through it.**

The agent sees all tools as regular function calls. The shim inside almostnode intercepts every call and routes it to `globalThis.boardVM`. From the agent's perspective, it's just calling APIs. It doesn't know (or care) that some go to Dexie, some go to GitHub, some go to Jules, and one goes to a Linux VM.

## 2. What Already Exists

| Piece | Where | Status |
|-------|-------|--------|
| Module system (9 modules, 23 handlers) | `src/core/registry.ts`, `src/core/host.ts` | Working |
| Event bus (typed pub/sub) | `src/core/event-bus.ts` | Working |
| Dexie persistence (7 tables) | `src/services/db.ts` | Working |
| almostnode running YUAN | `test-yuan-almostnode.html` | Proven |
| openai shim (LLM → boardVM.llmfs.sendRequest) | `test-yuan-almostnode.html` | Proven |
| v86 with WISP networking | `wasm/worker/`, `server.ts /wisp` | Proven |
| JulesNegotiator (send→poll→verify→retry) | `src/services/negotiators/JulesNegotiator.ts` | Working |
| UserNegotiator (ask→wait→validate) | `src/services/negotiators/UserNegotiator.ts` | Working |
| WasmHandler (boot v86, send command) | `wasm/worker/WasmHandler.ts` | Exists, needs persistent VM |
| ArchitectTool (task→protocol) | `src/modules/architect-codegen/Architect.ts` | Working |
| GitHub API tools (repo browser) | `src/modules/knowledge-repo-browser/` | Working |
| Artifact storage | `src/modules/knowledge-artifacts/` | Working |

## 3. The Shim Architecture

### What the openai shim proves

The test already shows the pattern:
1. almostnode can't use real Node.js APIs that depend on `node:` imports
2. Write a JS module into VFS that replaces the problematic package
3. The replacement module calls out to `globalThis.boardVM`
4. almostnode code does `require('openai')` and gets the shim

### Generalize to all tools

Instead of shimming just `openai`, create a single tool dispatch layer:

```javascript
// Written to VFS as /node_modules/@fleet/tools/index.js

const tools = {};
const boardVM = globalThis.boardVM;

function registerTool(name) {
  tools[name] = async (...args) => {
    const result = await boardVM.dispatchTool(name, args);
    return result;
  };
}

// Register all Fleet tools as callable functions
registerTool('readFile');
registerTool('writeFile');
registerTool('listFiles');
registerTool('headFile');
registerTool('saveArtifact');
registerTool('listArtifacts');
registerTool('readArtifact');
registerTool('askUser');
registerTool('askJules');
registerTool('runWorkflow');
registerTool('getRunStatus');
registerTool('fetchArtifacts');
registerTool('scan');
registerTool('analyze');
registerTool('addToContext');
registerTool('globalVarsGet');
registerTool('globalVarsSet');
registerTool('bash');

module.exports = tools;
```

The agent does `const tools = require('@fleet/tools')` and gets every tool as an async function. Each call exits almostnode, hits `boardVM.dispatchTool()`, and routes through Fleet's existing `ModuleRegistry.invokeHandler()`.

### The boardVM surface

```javascript
window.boardVM = {
  // LLM calls (existing — from test)
  llmfs: {
    sendRequest: async (jsonPayload) => { /* → host.llmCall */ }
  },

  // Tool dispatch (new — routes to ModuleRegistry)
  dispatchTool: async (toolName, args) => {
    const mappedName = TOOL_MAP[toolName]; // e.g. 'bash' → 'executor-wasm.execute'
    const result = await registry.invokeHandler(mappedName, args, context);
    return result;
  },

  // Board state (new — direct Dexie access)
  tasks: {
    list: async () => db.tasks.toArray(),
    get: async (id) => db.tasks.get(id),
    update: async (id, changes) => db.tasks.update(id, changes),
    create: async (task) => db.tasks.add(task),
  },

  // Events (new — subscribe to board events)
  on: (event, callback) => eventBus.on(event, callback),
  emit: (event, data) => eventBus.emit(event, data),
};
```

### Tool name mapping

Fleet tools have qualified names (`knowledge-repo-browser.readFile`). The agent sees short names (`readFile`). The mapping:

| Agent sees | Maps to |
|-----------|---------|
| `readFile` | `knowledge-repo-browser.readFile` |
| `writeFile` | `knowledge-repo-browser.writeFile` |
| `listFiles` | `knowledge-repo-browser.listFiles` |
| `headFile` | `knowledge-repo-browser.headFile` |
| `saveArtifact` | `knowledge-artifacts.saveArtifact` |
| `listArtifacts` | `knowledge-artifacts.listArtifacts` |
| `readArtifact` | `knowledge-artifacts.readArtifact` |
| `askUser` | `channel-user-negotiator.askUser` |
| `askJules` | `executor-jules.execute` |
| `runWorkflow` | `executor-github.runWorkflow` |
| `getRunStatus` | `executor-github.getRunStatus` |
| `fetchArtifacts` | `executor-github.fetchArtifacts` |
| `scan` | `knowledge-local-analyzer.scan` |
| `analyze` | `host.analyze` |
| `addToContext` | `host.addToContext` |
| `globalVarsGet` | `host.globalVarsGet` |
| `globalVarsSet` | `host.globalVarsSet` |
| `bash` | `executor-wasm.execute` |

## 4. v86 Bash Tool

### Current state

`WasmHandler` boots a **fresh ephemeral VM per execution**. This means:
- 5-10 second boot time every single command
- No state between commands (no `cd`, no installed packages, no file edits preserved)
- One Worker per execution, terminated after use

### What we need: persistent VM

```
Browser
  │
  │  postMessage or shared ArrayBuffer
  │
  ▼
v86 Worker (kept alive)
  │
  │  stdin/stdout over message channel
  │
  ▼
Wanix Linux (persistent)
  │
  │  WISP WebSocket
  │
  ▼
Node.js server /wisp → real TCP → git, npm, shell
```

### Implementation approach

```javascript
// PersistentVM class (runs in browser)
class PersistentVM {
  private worker: Worker;
  private commandQueue: Map<string, {resolve, reject}>;
  private booted: boolean = false;

  async boot() {
    this.worker = new Worker('./vm-worker.ts', { type: 'module' });
    this.worker.postMessage({
      type: 'init',
      mode: 'persistent',  // NEW — don't boot fresh each time
      bundleUrl: '/assets/wasm/sys.tar.gz',
      wasmUrl: '/assets/wasm/boot.wasm',
      wanixUrl: '/assets/wasm/wanix.min.js',
    });
    // Wait for boot confirmation
    await this.waitForMessage('booted');
    this.booted = true;
  }

  async exec(command: string, timeout = 30000): Promise<{stdout, stderr, exitCode}> {
    if (!this.booted) throw new Error('VM not booted');
    const id = generateId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
      this.commandQueue.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); }, reject });
      this.worker.postMessage({ type: 'exec', id, command });
    });
  }

  destroy() {
    this.worker.terminate();
  }
}
```

### The VM worker (persistent mode)

Instead of booting Wanix per command, boot once and keep it running. New commands arrive via postMessage, execute in the running VM, output comes back.

The Wanix side needs a small init script that:
1. Listens for commands on a channel (stdin pipe or shared message)
2. Executes each command via `sh -c`
3. Captures stdout/stderr/exitCode
4. Sends results back

This is roughly what Wanix's "executor mode" does, but persistent instead of one-shot.

## 5. Jules: The Heavy Executor

Jules is not a backup. It's the primary tool for real coding work.

### How it works now

```
Fleet orchestrator
  → JulesNegotiator.negotiate()
    → JulesSessionManager.findOrCreateSession() — cloud VM per task
    → JulesSessionManager.sendMessage(prompt)
    → poll every 5s via julesApi.listActivities()
    → extract agent response
    → LLM verify against success criteria
    → if fail: send feedback, retry (≤3x)
    → return final response
```

### How the agent uses it

From inside almostnode, the agent calls `askJules({ prompt, successCriteria })`. The shim routes this to `executor-jules.execute`, which triggers `JulesNegotiator`. The agent doesn't need to know about polling, verification, or retries — that's all inside the negotiator.

### When the agent routes to Jules

The agent decides based on task characteristics:
- **Small/local** (read a file, check a log, create an artifact) → v86 bash or board tools
- **Medium** (edit a few files, run a refactor) → v86 bash with multiple commands
- **Large/complex** (implement a feature, debug a hard issue, write tests for a module) → Jules

This routing decision is where YUAN's Decision Engine (deterministic intent/complexity classifier) could plug in. No LLM call needed for the routing — just classify the task and dispatch.

## 6. The Monitoring Agent

The agent in almostnode can monitor the board. This is the "meta" capability:

```javascript
// Example: agent periodically reviews task progress
async function reviewBoard() {
  const tasks = await boardVM.tasks.list();
  const inProgress = tasks.filter(t => t.agentState === 'EXECUTING');

  for (const task of inProgress) {
    const logs = task.moduleLogs || {};

    // Check if any module is stuck
    for (const [moduleId, log] of Object.entries(logs)) {
      if (log.includes('Error') && !log.includes('resolved')) {
        // Flag to user or create remediation task
        await boardVM.tasks.update(task.id, {
          agentState: 'ERROR',
          chat: (task.chat || '') + '\n> [Monitor] Stuck detected in ' + moduleId
        });
      }
    }
  }
}
```

The agent can:
- Poll board state via `boardVM.tasks.list()`
- Read module logs to detect stuck/error patterns
- Create new tasks based on what it observes
- Escalate to user via `askUser()`
- Route work to Jules or v86 based on what needs doing
- Track cross-task dependencies

This is NOT a separate system. It's the same agent with access to the same tools. Monitoring is just another thing the agent can do — it reads board state, thinks about it, acts on it.

## 7. React UI: Orchestrator → Dashboard

The React app doesn't need to orchestrate anymore. The agent in almostnode handles that. The UI becomes:

| Current Role | New Role |
|-------------|----------|
| `orchestrator.processTask()` — runs the agent loop | Show what the agent is doing |
| `composeProgrammerPrompt()` — generates code | Show task status, logs, artifacts |
| `executeInSandbox()` — runs generated code | Let user send messages to agent |
| Step-by-step execution | Let user approve/override decisions |

The UI still:
- Displays the kanban board (tasks, columns, drag)
- Shows module logs in real-time (subscribe to `module:log` events)
- Handles user replies (subscribe to `user:reply` from UserNegotiator)
- Shows artifacts and task details

The UI stops:
- Running `processTask()` / `runStep()`
- Calling `composeProgrammerPrompt()`
- Managing the sandbox directly

The agent loop moves from `src/core/orchestrator.ts` into almostnode. The React app becomes a view layer.

## 8. What Needs Building

### Phase 1: boardVM bridge (~150 LOC)
- [ ] Expose `window.boardVM` with `dispatchTool()`, `tasks`, `on/emit`
- [ ] Create tool name mapping (short → qualified)
- [ ] Wire `dispatchTool()` to `registry.invokeHandler()`
- [ ] Provide request context (taskId, repoUrl, etc.) to handlers

### Phase 2: Generalize the shim (~100 LOC)
- [ ] Create `@fleet/tools` VFS module that registers all tools
- [ ] Each tool function calls `globalThis.boardVM.dispatchTool()`
- [ ] Write into VFS after almostnode container creation
- [ ] Test: agent calls `readFile('/src/foo.ts')` → GitHub API → content returned

### Phase 3: Persistent v86 (~200 LOC)
- [ ] Modify `vm-worker.ts` to support persistent mode
- [ ] Create `PersistentVM` class (boot once, exec many)
- [ ] Wire stdin/stdout over postMessage channel
- [ ] Register `bash` tool that routes to persistent VM
- [ ] Test: agent calls `bash('git status')` → v86 → output returned

### Phase 4: Agent loop in almostnode (~200 LOC)
- [ ] Create almostnode container on app load
- [ ] Install YUAN (or custom loop)
- [ ] Register all shims (openai, @fleet/tools)
- [ ] Boot persistent v86 VM
- [ ] Start agent with board context
- [ ] Wire agent output to Dexie (task updates, logs)

### Phase 5: UI pivot (~150 LOC changes)
- [ ] Remove `processTask()` / `runStep()` from React flow
- [ ] Replace with "start agent" / "send message to agent"
- [ ] Display agent activity from Dexie logs
- [ ] Keep kanban board as read-only view of agent state

**Total new code: ~800 LOC.** Most of it is wiring, not logic. The existing Fleet modules handle all the actual work.

## 9. Risk & Unknowns

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Persistent v86 is unstable (memory leaks, crashes) | Medium | Watchdog timer, auto-reboot on stale response |
| almostnode VFS too slow for real work | Low | Already proven with YUAN test |
| boardVM tool dispatch latency (async hop) | Low | Each call is a postMessage round-trip, <5ms |
| Dexie access from agent blocks UI | Low | Dexie is async, doesn't block main thread |
| Jules daily limits hit during heavy use | Medium | Agent tracks usage via globalVars, routes to v86 when low |
| Agent in almostnode crashes | Medium | Restart container, restore state from Dexie |
| Multiple tasks need simultaneous v86 access | Low | Persistent VM is single-session; serialize commands via queue |

## 10. File Impact Summary

| File | Change |
|------|--------|
| `src/core/host.ts` | Add `boardVM` exposure on window |
| `src/core/registry.ts` | Add tool name mapping, `dispatchFromBridge()` |
| `wasm/worker/vm-worker.ts` | Add persistent mode |
| `wasm/worker/WasmHandler.ts` | Rewrite to use PersistentVM |
| `src/App.tsx` (or equivalent) | Remove orchestrator calls, add agent start |
| New: `src/bridge/boardVM.ts` | boardVM API surface definition |
| New: `src/bridge/fleet-tools-shim.js` | @fleet/tools VFS module (template, written to VFS at runtime) |
| New: `src/bridge/agent-bootstrap.ts` | almostnode setup, shim injection, agent start |
