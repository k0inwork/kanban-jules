# Action Module System: Implementation Plan

> Pluggable event-driven modules that react to board state changes.
> Replaces hardcoded post-completion hooks with declarative subscriptions.

---

## 0. What Already Exists

The system already has event-driven modules. They just aren't formalized:

### commit-harvest (action module in disguise)

`src/modules/process-dream/commit-harvest.ts`

```ts
// Init: subscribes to event
export function initCommitHarvest(config, llmCall) {
  eventBus.on('executor:completed', handleExecutorCompleted);
}

// Handler: reacts to event, writes KB
async function handleExecutorCompleted(data) {
  // Extracts decisions from GitHub commits or module logs
  // Writes KBEntry records to db.kbLog
}

// Destroy: unsubscribes
export function destroyCommitHarvest() {
  eventBus.off('executor:completed', handleExecutorCompleted);
}
```

This IS an action module. It subscribes to `executor:completed`, filters/processes the payload, and writes to KB. The only difference from the proposed design: it's not declared as `type: "action"` in manifest, and it's wired manually via init/destroy instead of a subscription system.

### host.ts event listeners

`src/core/host.ts` — `setupListeners()` subscribes to:

| Event | What it does | Could become action? |
|-------|-------------|---------------------|
| `module:log` | Reset idle timer, persist logs to DB | No — infrastructure |
| `project:review` | Trigger process-project-manager | Maybe — `action-stage-gate` |
| `module:request` | Dispatch to registry (tool invocation) | No — infrastructure |
| `agent:message` | Forward to Yuan UI | No — infrastructure |

### dream-levels one-shot handlers

`src/modules/process-dream/dream-levels.ts` subscribes to `user:reply` for conflict resolution — registers a handler, self-removes after first match. This is a different pattern (one-shot, not persistent). Actions are persistent listeners.

### Existing event types (event-bus.ts)

```ts
type SystemEvent =
  | 'project:review'
  | 'module:log'
  | 'task:manual-trigger'
  | 'user:reply'
  | 'module:request'
  | 'module:response'
  | 'executor:completed'
  | 'projector:injection'
  | 'yuan:event'
  | 'agent:message'
  | 'trace:tool-call'
```

**Missing events that actions need:**
- `task:statusChanged` — { taskId, from, to, task, projectId }
- `test:completed` — { taskId, results, projectId }
- `branch:created` — { taskId, branch, commitSha, projectId }

### Hardcoded post-completion block (orchestrator.ts:543-596)

```
1. Branch merge: gitFs.mergeTaskBranch + pushQueue.enqueue
2. KBHandler.recordExecution — log task completion
3. KBHandler.recordDecision — save architect decisions
4. eventBus.emit('executor:completed', {...}) — triggers commit-harvest
5. moduleRequest('process-dream.microDream') — triggers micro dream
```

All wrapped in try/catch so failures don't affect task status. This is the code action modules replace.

### moduleKnowledge (constitution patch target)

`src/services/db.ts` — `ModuleKnowledge { id: string, content: string, updatedAt: number }`

IDs follow `system:<role>` pattern (system:yuan, system:overseer, system:architect, system:programmer) or `<executor-id>` pattern. Projector reads all entries for prompt assembly:

```ts
// knowledge-projector/Handler.ts
const knowledgeRecords = await db.moduleKnowledge.toArray();
const roleConstitution = knowledgeMap[role.key] || role.fallback;
```

---

## 1. Changes

### 1.1 Type system (types.ts)

Add `'action'` to the module type union:

```ts
// Before
type: 'architect' | 'knowledge' | 'executor' | 'channel' | 'process';

// After
type: 'architect' | 'knowledge' | 'executor' | 'channel' | 'process' | 'action';
```

Add action-specific manifest fields:

```ts
interface ActionSubscription {
  event: string;
  manifestFilter?: Record<string, any>;  // JSON match against event payload
  priority?: number;                      // lower = runs first, default 100
}

interface ConstitutionPatch {
  namespace: string;   // e.g. "action-test-runner"
  rules: string[];
}

interface ModuleManifest {
  // ... existing fields ...
  type: 'architect' | 'knowledge' | 'executor' | 'channel' | 'process' | 'action';

  // Action-specific (only when type === 'action')
  subscriptions?: ActionSubscription[];
  constitutionPatches?: Record<string, ConstitutionPatch>;  // key = target module ID
}
```

### 1.2 Event bus extensions (event-bus.ts)

Add new event types to `SystemEvent`:

```ts
type SystemEvent =
  // ... existing ...
  | 'task:statusChanged'     // { taskId, from, to, task, projectId }
  | 'test:completed'         // { taskId, results, projectId }
  | 'branch:created'         // { taskId, branch, commitSha, projectId }
```

No structural changes to the bus itself — it already supports arbitrary string events with any payload.

### 1.3 Action dispatcher (new: core/action-dispatcher.ts)

The dispatcher is the bridge between event emissions and action module execution.

```ts
interface ActionContext {
  event: {
    type: string;
    payload: any;
  };
  registry: ModuleRegistry;    // tool invocation
  db: typeof db;               // direct DB access
  eventBus: typeof eventBus;   // emit follow-up events
  projectId?: string;
}

class ActionDispatcher {
  private actions: Map<string, {
    manifest: ModuleManifest;
    handler: any;  // imported action module
    subscription: ActionSubscription;
  }[]>;

  // Called during host.init() after registry is populated
  init(registry: ModuleRegistry) {
    const actionModules = registry.getModulesByType('action');
    for (const mod of actionModules) {
      if (!mod.enabled) continue;
      for (const sub of mod.subscriptions ?? []) {
        eventBus.on(sub.event, (payload) => this.onEvent(sub.event, payload, mod));
      }
    }
  }

  destroy() {
    // off all registered listeners
  }

  private async onEvent(eventType: string, payload: any, mod: ModuleManifest) {
    for (const sub of mod.subscriptions ?? []) {
      if (sub.event !== eventType) continue;

      // Layer 1: manifestFilter (fast reject, no module load)
      if (sub.manifestFilter && !this.matchesFilter(payload, sub.manifestFilter)) continue;

      // Load action handler
      const handler = await this.loadActionHandler(mod.id);
      if (!handler) continue;

      // Layer 2: code filter
      if (handler.filter && !handler.filter(payload)) continue;

      // Build context
      const context: ActionContext = {
        event: { type: eventType, payload },
        registry: this.registry,
        db,
        eventBus,
        projectId: payload.projectId,
      };

      // Execute with dispatcher-level error handling
      try {
        await handler.execute(context);
      } catch (err) {
        // Guaranteed error logging — module doesn't need try/catch
        await this.logActionError(mod.id, eventType, err, payload);
        if (handler.blocking) {
          // Blocking action failed = gate blocks
          // For now: log and continue (no hard gate in MVP)
        }
      }
    }
  }

  private matchesFilter(payload: any, filter: Record<string, any>): boolean {
    return Object.entries(filter).every(([key, value]) => payload[key] === value);
  }

  private async logActionError(moduleId: string, event: string, err: any, payload: any) {
    await db.kbLog.add({
      timestamp: Date.now(),
      text: `Action ${moduleId} failed on ${event}: ${err.message}`,
      category: 'error',
      abstraction: 2,
      layer: ['L0', 'L1'],
      tags: ['action', 'error', moduleId],
      source: `action-dispatcher`,
      active: true,
      projectId: payload.projectId,
    });
  }
}
```

### 1.4 Tool permission enforcement

In the dispatcher's context, wrap `registry.invoke` to check the manifest's `tools` array:

```ts
// In ActionContext, replace direct registry access:
const registry = {
  async invoke(toolName: string, args: any) {
    const allowed = mod.tools.some(t => t.name === toolName);
    if (!allowed) {
      throw new Error(`Action ${mod.id} not permitted to call ${toolName}`);
    }
    return fullRegistry.invokeHandler(toolName, [args], { projectId: context.projectId });
  }
};
```

### 1.5 Constitution patches (host.ts)

When an action module is enabled/disabled, merge/remove patches to moduleKnowledge:

```ts
async enableActionPatches(mod: ModuleManifest) {
  if (!mod.constitutionPatches) return;
  for (const [targetId, patch] of Object.entries(mod.constitutionPatches)) {
    const knowledgeId = `${targetId}:patch-${patch.namespace}`;
    await db.moduleKnowledge.put({
      id: knowledgeId,
      content: patch.rules.join('\n'),
      updatedAt: Date.now(),
    });
  }
}

async disableActionPatches(mod: ModuleManifest) {
  if (!mod.constitutionPatches) return;
  for (const [targetId, patch] of Object.entries(mod.constitutionPatches)) {
    const knowledgeId = `${targetId}:patch-${patch.namespace}`;
    await db.moduleKnowledge.delete(knowledgeId);
  }
}
```

The projector already reads ALL moduleKnowledge entries. Patches with ID `executor-jules:patch-action-test-runner` will be picked up automatically when building executor-jules's prompt. No projector changes needed.

### 1.6 Registry query by type (registry.ts)

Add one method:

```ts
getModulesByType(type: string): ModuleManifest[] {
  return this.modules.filter(m => m.type === type);
}
```

### 1.7 Event emission points

Add `task:statusChanged` emissions where tasks change status:

- `knowledge-board/Handler.ts` — `updateTask` method: emit when `workflowStatus` changes
- `orchestrator.ts` — task completion: already emits `executor:completed`, add `task:statusChanged`

```ts
// In knowledge-board updateTask, after DB update:
if (changes.workflowStatus && changes.workflowStatus !== existing.workflowStatus) {
  eventBus.emit('task:statusChanged', {
    taskId: id,
    from: existing.workflowStatus,
    to: changes.workflowStatus,
    task: updated,
    projectId: updated.projectId,
  });
}
```

### 1.8 Orchestrator refactor (orchestrator.ts)

Replace the hardcoded post-completion block (lines 543-596) with a single event emission:

```ts
// Before: 5 hardcoded steps
// After:
eventBus.emit('task:statusChanged', {
  taskId: task.id,
  from: 'IN_PROGRESS',
  to: 'DONE',
  task,
  projectId: task.projectId,
});
```

The action modules handle the rest. During migration (Phase 2), the old code stays as fallback until all actions are verified.

---

## 2. New Event-Driven Modules

### 2.1 Existing modules that become actions

| Current location | Current pattern | Action equivalent |
|-----------------|----------------|-------------------|
| `process-dream/commit-harvest.ts` | `eventBus.on('executor:completed', ...)` init/destroy | `action-branch-tracker` — subscribes to `task:statusChanged`, manifestFilter `{ to: 'DONE' }` |
| orchestrator.ts KB recording | Hardcoded `KBHandler.recordExecution` + `recordDecision` | `action-kb-recorder` — subscribes to `task:statusChanged`, manifestFilter `{ to: 'DONE' }` |
| orchestrator.ts microDream trigger | Hardcoded `moduleRequest('process-dream.microDream')` | `action-kb-recorder` emits `executor:completed` → dream subscribes (or dream becomes an action itself) |

### 2.2 New action modules

#### action-test-runner

```json
{
  "id": "action-test-runner",
  "name": "Test Runner",
  "version": "1.0.0",
  "type": "action",
  "description": "Runs full test suite when code tasks complete",
  "subscriptions": [
    {
      "event": "task:statusChanged",
      "manifestFilter": { "to": "DONE" },
      "priority": 20
    }
  ],
  "tools": [
    { "name": "executor-github.runAndWait", ... },
    { "name": "knowledge-artifacts.saveArtifact", ... },
    { "name": "knowledge-kb.recordEntry", ... },
    { "name": "knowledge-board.updateTask", ... }
  ],
  "permissions": ["network"],
  "enabled": true,
  "constitutionPatches": {
    "executor-jules": {
      "namespace": "action-test-runner",
      "rules": [
        "Always write tests for your changes in the configured test directory.",
        "Run the project's test command before reporting task complete.",
        "Tests must be independent and runnable in isolation."
      ]
    },
    "executor-claude": {
      "namespace": "action-test-runner",
      "rules": [
        "Always write tests for your changes in the configured test directory.",
        "Run the project's test command before reporting task complete."
      ]
    }
  }
}
```

Handler (`src/modules/action-test-runner/action.ts`):

```ts
export const action = {
  filter: ({ to, task }) => to === 'DONE' && !!task.branch,
  blocking: false,
  async execute({ event, registry, db }) {
    const { task } = event.payload;
    const result = await registry.invoke('executor-github.runAndWait', {
      workflow: 'test.yml',
      branch: task.branch
    });

    await registry.invoke('knowledge-artifacts.saveArtifact', {
      name: `test-results-${task.id}.json`,
      type: 'test-results',
      content: JSON.stringify(result),
      projectId: task.projectId
    });

    await registry.invoke('knowledge-kb.recordEntry', {
      text: `Test suite "${task.title}": ${result.pass ? 'PASSED' : 'FAILED'} (${result.passed}/${result.total})`,
      category: result.pass ? 'observation' : 'error',
      tags: ['test', 'verification'],
      source: 'action-test-runner',
      projectId: task.projectId
    });

    if (!result.pass) {
      // Regress to IN_REVIEW — task needs rework
      await registry.invoke('knowledge-board.updateTask', {
        id: task.id,
        workflowStatus: 'IN_REVIEW',
        agentState: 'TEST_FAILED',
        testResults: result
      });
    }
  }
};
```

#### action-kb-recorder

Replaces hardcoded KB recording + microDream trigger.

```json
{
  "id": "action-kb-recorder",
  "type": "action",
  "subscriptions": [
    {
      "event": "task:statusChanged",
      "manifestFilter": { "to": "DONE" },
      "priority": 5
    }
  ],
  "tools": [
    { "name": "knowledge-kb.recordEntry", ... },
    { "name": "process-dream.microDream", ... }
  ],
  "enabled": true
}
```

Priority 5 — runs before test-runner (priority 20) and branch-tracker (priority 10). Records KB first, then triggers microDream.

#### action-branch-tracker

Extracts git metadata from completed tasks. Migrates `commit-harvest.ts` into the action system.

```json
{
  "id": "action-branch-tracker",
  "type": "action",
  "subscriptions": [
    {
      "event": "task:statusChanged",
      "manifestFilter": { "to": "DONE" },
      "priority": 10
    }
  ],
  "tools": [
    { "name": "knowledge-kb.recordEntry", ... },
    { "name": "knowledge-board.updateTask", ... }
  ],
  "enabled": true
}
```

Priority 10 — after KB recording (5) but before test runner (20). Populates `task.branch`, `task.commitSha`, `task.prUrl` so test-runner can use them.

---

## 3. Phase Plan

### Phase 1: Infrastructure (types + dispatcher + registry)

Files changed:
- `src/core/types.ts` — add `'action'` type, `ActionSubscription`, `ConstitutionPatch` interfaces
- `src/core/registry.ts` — add `getModulesByType()`
- `src/core/event-bus.ts` — add `task:statusChanged`, `test:completed`, `branch:created` to event types
- `src/core/action-dispatcher.ts` — **new file**, the dispatcher class
- `src/core/host.ts` — instantiate `ActionDispatcher`, call `init()` after registry setup, call `destroy()` on teardown

No behavioral change. Dispatcher loads but no action modules exist yet.

### Phase 2: Event emissions

Files changed:
- `src/modules/knowledge-board/Handler.ts` — emit `task:statusChanged` in `updateTask`
- `src/core/orchestrator.ts` — emit `task:statusChanged` on task completion (in addition to existing `executor:completed`)

Keep the hardcoded post-completion block. Both old and new paths run. Verify events fire correctly via KB logging.

### Phase 3: First action module (action-kb-recorder)

Files created:
- `src/modules/action-kb-recorder/manifest.json`
- `src/modules/action-kb-recorder/action.ts`

- `src/core/host.ts` — register handler, call `dispatcher.init()`

Migrates `KBHandler.recordExecution` + `recordDecision` out of orchestrator. Verify KB entries appear as before.

### Phase 4: Migrate commit-harvest → action-branch-tracker

Files created:
- `src/modules/action-branch-tracker/manifest.json`
- `src/modules/action-branch-tracker/action.ts`

Files modified:
- `src/modules/process-dream/commit-harvest.ts` — remove event subscription (action dispatcher handles it)
- `src/core/orchestrator.ts` — remove `eventBus.emit('executor:completed')` from post-completion block (action emits it instead)

### Phase 5: Action test-runner

Files created:
- `src/modules/action-test-runner/manifest.json`
- `src/modules/action-test-runner/action.ts`

Constitution patches for test-writing rules. Test failure → IN_REVIEW regression.

### Phase 6: Remove hardcoded post-completion block

File changed:
- `src/core/orchestrator.ts` — delete lines 543-596, replace with `eventBus.emit('task:statusChanged', ...)`

Verify: all post-completion behavior still works via action modules. Run full test suite.

### Phase 7: Constitution patch system

Files changed:
- `src/core/host.ts` — `enableActionPatches()` / `disableActionPatches()` on module enable/disable
- UI toggle for enabling/disabling action modules (optional for MVP)

---

## 4. File Map

```
src/core/
  types.ts                    — add 'action' type, interfaces
  registry.ts                 — add getModulesByType()
  event-bus.ts                — add event types
  action-dispatcher.ts        — NEW: dispatcher class
  host.ts                     — instantiate dispatcher, patch lifecycle

src/modules/action-test-runner/
  manifest.json               — NEW
  action.ts                   — NEW: handler

src/modules/action-kb-recorder/
  manifest.json               — NEW
  action.ts                   — NEW: handler

src/modules/action-branch-tracker/
  manifest.json               — NEW
  action.ts                   — NEW: handler (migrates from process-dream/commit-harvest.ts)

src/modules/knowledge-board/
  Handler.ts                  — emit task:statusChanged

src/core/orchestrator.ts      — replace hardcoded block with event emission

src/modules/process-dream/
  commit-harvest.ts           — remove eventBus subscription (phase 4)
```

---

## 5. Existing Modules That Already Listen

These are proto-action modules — they subscribe to events and act autonomously. They stay as-is initially (Phase 4 migrates commit-harvest):

| Module | File | Event | Pattern | Migration |
|--------|------|-------|---------|-----------|
| commit-harvest | `process-dream/commit-harvest.ts` | `executor:completed` | init/destroy with `eventBus.on/off` | Phase 4 → `action-branch-tracker` |
| dream conflict resolution | `process-dream/dream-levels.ts` | `user:reply` | One-shot `eventBus.on` then self-`off` | Stays — one-shot is different from persistent action |
| host.ts setupListeners | `core/host.ts` | `module:log`, `project:review`, `module:request`, `agent:message` | Direct `eventBus.on` in host | Stays — infrastructure, not domain logic |
| process-project-manager | Triggered by host via `project:review` | `project:review` | Indirect: host subscribes, invokes handler | Could become action — out of scope for MVP |

---

## 6. Test Plan

Per phase:

| Phase | What to test | How |
|-------|-------------|-----|
| 1 | Dispatcher loads, no crashes | App boots, all existing tests pass |
| 2 | Events fire on status change | Update a task, check `task:statusChanged` payload in console |
| 3 | KB recording via action | Complete a task, verify KB entries match old format |
| 4 | Branch tracking via action | Complete a task with branch, verify branch/commit extracted |
| 5 | Test runner fires | Complete a code task, verify GitHub Actions triggered, verify IN_REVIEW regression on failure |
| 6 | Old code fully removed | All post-completion behavior works, no regressions |
| 7 | Constitution patches | Enable/disable test-runner, verify patches appear/disappear in moduleKnowledge |
