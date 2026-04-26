# Agent Bus Implementation Plan

Concrete implementation steps for the day/night communication model described in `agent-architecture.md`.

---

## Agent Routing Tables

Each agent needs to know: **when do I send a day-flow message, what type, and to whom?**

### Responsibility Model

Every routing decision follows from what each agent owns:

| Agent | Owns | Scope | Knows about |
|-------|------|-------|-------------|
| **Yuan (L0)** | User interface, project-level decisions, overrides | Whole project | Everything — all KB, all conflicts, full board state |
| **ProcessAgent (L1)** | Board health, artifact lifecycle, task quality | All tasks | All tasks, artifacts, KB — but not step-level execution details |
| **Architect (L2)** | Task decomposition — spec → step protocol | Single task | Task spec + L2 projector knowledge |
| **Orchestrator (L3)** | Step execution, executor management | Single task, one step at a time | Current step, executor result, protocol |
| **Executors** | Do the actual work (Jules, bash, GitHub, user) | Single step payload | Step payload only |
| **WatchdogDream** | Night→day bridge | All running tasks | Dream findings + IN_PROGRESS task list |

**Routing follows ownership:**
- You can message anyone about what you own
- You can report upward about anything you observe
- You can only **direct** (directive/intervention) downward to agents executing work you own
- Architect is never messaged directly — go through orchestrator (orchestrator owns the task execution and decides when to re-plan)

### Decision Rule (all agents)

```
Agent encounters a problem:
  1. Is a task IN_PROGRESS right now that this problem affects?
     NO  → Write to KB. Night flow handles it.
     YES → 2. Will waiting cause damage? (burning tokens, compounding errors, wrong direction)
           NO  → Write to KB. Night flow handles it on next dream cycle.
           YES → Send day-flow message (see routing table below).
```

### Yuan (L0)

**When to send:** User explicitly requests immediate action.

| Trigger | To | Type | Payload |
|---------|----|------|---------|
| User says "cancel task X" | `orchestrator` | `intervention` | `{ action: 'cancel', taskId }` |
| User says "pause task X" | `orchestrator` | `intervention` | `{ action: 'pause', taskId }` |
| User asks "what's happening?" | `process-agent` | `request` | `{ action: 'status-report' }` |
| User changes project direction | `process-agent` | `directive` | `{ action: 'redirect', context }` |
| User says "architect got task X wrong" | `orchestrator` | `directive` | `{ action: 'replan', taskId, reason }` |
| User answers agent question | (reply to sender) | `reply` | `{ content }` |

**Why routes through orchestrator for architect:** Orchestrator owns task execution. It decides when to call architect and manages the protocol. Yuan doesn't bypass the execution owner — it tells orchestrator "re-plan this" and orchestrator calls architect with updated context.

### ProcessAgent (L1)

**When to send:** During runReview, finds a critical problem with a running task.

| Trigger | To | Type | Payload |
|---------|----|------|---------|
| Running task has contradictory plan | `orchestrator` | `intervention` | `{ action: 'pause', taskId, reason }` |
| Multiple tasks stuck | `yuan` | `alert` | `{ finding, taskIds }` |
| Constitution violation in running task | `yuan` | `alert` | `{ violation, taskId }` |
| Protocol doesn't match artifacts | `orchestrator` | `request` | `{ action: 'replan', taskId, reason }` |
| Review findings for user | `yuan` | `status` | `{ summary, taskStats }` |
| Propose new task | `yuan` | `proposal` | `{ title, description }` |

**Cannot send:** `directive` or `intervention` to `yuan` — L1 reports upward, doesn't command L0.

### Orchestrator (L3)

**When to send:** Step result contradicts protocol, executor fails critically, task needs external input.

| Trigger | To | Type | Payload |
|---------|----|------|---------|
| Step result contradicts protocol | `architect` | `request` | `{ action: 'replan-step', taskId, stepIndex }` |
| Executor blocked / stuck | `process-agent` | `status` | `{ taskId, stepIndex, issue }` |
| All steps failed | `process-agent` | `alert` | `{ taskId, errors }` |
| Task completed | `process-agent` | `status` | `{ taskId, result }` |
| Needs user input during step | `yuan` | `request` | `{ question, taskId }` |

**Orchestrator is the only one who messages architect directly** — because orchestrator owns task execution and manages the protocol. If anyone else needs architect to re-plan, they tell orchestrator (via intervention/request), and orchestrator decides whether to call architect.

### Architect (L2)

**Never sends day-flow messages.** It's a pure function — called with spec, returns plan. If re-planning is needed, orchestrator calls it again with new context.

### WatchdogDream

**When to send:** Dream finding matches a running task. See watchdog scan table in `agent-architecture.md`.

| Trigger | To | Type | Payload |
|---------|----|------|---------|
| Executor pattern failure on running task | `orchestrator` | `intervention` | `{ action: 'pause', taskIds, reason }` |
| Conflict affecting running task | `process-agent` | `alert` | `{ conflict, taskIds }` |
| Recurring error on running task | `orchestrator` | `intervention` | `{ action: 'pause', taskIds, error }` |
| Knowledge gap blocking running task | `process-agent` | `alert` | `{ gap, taskIds }` |

### User Channel — Two Separate Mechanisms

The user interacts through **two different channels**. They are NOT the same.

**1. Yuan Operator** — the human chatting with Yuan in real-time.

Yuan is the user's proxy. When the operator gives a command, Yuan decides which agent to route it to.

| Trigger | To | Type | Payload |
|---------|----|------|---------|
| Operator says "cancel task X" | `orchestrator` | `intervention` | `{ action: 'cancel', taskId }` |
| Operator says "pause task X" | `orchestrator` | `intervention` | `{ action: 'pause', taskId }` |
| Operator asks "what's happening?" | `process-agent` | `request` | `{ action: 'status-report' }` |
| Operator changes direction | `process-agent` | `directive` | `{ action: 'redirect', context }` |
| Operator gives spontaneous command | (Yuan interprets) | varies | varies |

**2. askUser tool** — async mail system. Agent sends question, blocks until user replies.

This is a **tool call**, not a chat. The agent calls `askUser(question)` and waits. The question appears in the UI as a notification/prompt, the user replies, the agent unblocks.

| Trigger | To | Type | Payload |
|---------|----|------|---------|
| Agent asks question | `user` | `request` | `{ question, format?, taskId? }` |
| User replies to question | (reply to sender) | `reply` | `{ content }` |
| Agent sends info (no reply needed) | `user` | `info` | `{ content }` |
| Agent sends alert | `user` | `alert` | `{ content, severity }` |

**Key difference:**
- Yuan operator = **push**. User initiates, Yuan routes.
- askUser = **pull**. Agent initiates, blocks until response.
- Yuan operator messages come from `yuan` agentId.
- askUser messages come from the calling agent's agentId.

---

## Phase 0 — Foundation (no behavioral change)

### 0.1 AgentMessage types

**New file:** `src/core/agent-message.ts`

```typescript
export type AgentId = 'yuan' | 'process-agent' | 'architect' | 'orchestrator' | 'user';

export type AgentMessageType =
  | 'info'
  | 'alert'
  | 'request'
  | 'reply'
  | 'directive'
  | 'proposal'
  | 'status'
  | 'intervention';

export interface AgentMessage {
  id: string;
  from: AgentId;
  to: AgentId | 'broadcast';
  type: AgentMessageType;
  payload: any;
  taskId?: string;
  timestamp: number;
  replyTo?: string;
}
```

### 0.2 MessageQueue

**New file:** `src/core/message-queue.ts`

Simple per-agent queue. No threads — just an array with poll().

```typescript
export class MessageQueue {
  private queues: Map<AgentId, AgentMessage[]> = new Map();

  deliver(msg: AgentMessage): void {
    if (msg.to === 'broadcast') {
      for (const id of ALL_AGENT_IDS) {
        if (id !== msg.from) this.getQueue(id).push(msg);
      }
    } else {
      this.getQueue(msg.to).push(msg);
    }
  }

  poll(agentId: AgentId): AgentMessage | undefined {
    return this.getQueue(agentId).shift();
  }

  peek(agentId: AgentId): AgentMessage | undefined {
    return this.getQueue(agentId)[0];
  }

  private getQueue(id: AgentId): AgentMessage[] {
    if (!this.queues.has(id)) this.queues.set(id, []);
    return this.queues.get(id)!;
  }
}

export const messageQueue = new MessageQueue();
```

### 0.3 Trace interceptor in registry

**Modified file:** `src/core/registry.ts`

Add optional interceptor to `invokeHandler`. No behavioral change — just logging.

```typescript
// Add to ModuleRegistry:
private interceptor?: (toolName: string, args: any[], context: RequestContext, result: any, durationMs: number) => void;

setInterceptor(fn: typeof this.interceptor) {
  this.interceptor = fn;
}

async invokeHandler(toolName: string, args: any[], context: RequestContext): Promise<any> {
  const handler = this.handlers.get(toolName);
  if (!handler) throw new Error(`No handler registered for tool: ${toolName}`);
  const start = Date.now();
  const result = await handler(toolName, args, context);
  this.interceptor?.(toolName, args, context, result, Date.now() - start);
  return result;
}
```

**Wire in host.ts:**

```typescript
registry.setInterceptor((toolName, args, ctx, result, durationMs) => {
  eventBus.emit('trace:tool-call', { toolName, taskId: ctx.taskId, durationMs, timestamp: Date.now() });
});
```

**Deliverable:** Every tool call now emits `trace:tool-call`. No agent behavior changes.

---

## Phase 1 — Day Flow Infrastructure

### 1.1 Agent bus on EventBus

**Modified file:** `src/core/event-bus.ts`

Add typed event:

```typescript
// Already has event bus — just add the agent:message type to the usage
// No change to event-bus.ts itself — it's untyped.
// The new event is: eventBus.emit('agent:message', msg) / eventBus.on('agent:message', handler)
```

### 1.2 Wire message delivery

**Modified file:** `src/core/host.ts`

In `init()`, add:

```typescript
eventBus.on('agent:message', (msg: AgentMessage) => {
  messageQueue.deliver(msg);
});
```

### 1.3 Orchestrator step-loop interruption

**Modified file:** `src/core/orchestrator.ts`

At the top of the step loop, add a queue check:

```typescript
// Inside the step iteration loop:
const msg = messageQueue.poll('orchestrator');
if (msg?.type === 'intervention') {
  await this.handleIntervention(msg);
  continue; // or break, depending on payload.action
}
```

Add handler method:

```typescript
private async handleIntervention(msg: AgentMessage) {
  const { action, taskId, reason } = msg.payload;
  switch (action) {
    case 'pause':
      // Set task to PAUSED state, stop executing steps
      break;
    case 'cancel':
      // Cancel current executor, set task to CANCELLED
      break;
    case 'abort':
      // Force-stop current step
      break;
  }
}
```

### 1.4 ProcessAgent iteration-loop interruption

**Modified file:** `src/modules/process-project-manager/ProcessAgent.ts`

In `runReview()`, inside the ReAct loop, before each LLM call:

```typescript
const msg = messageQueue.poll('process-agent');
if (msg) {
  // Inject message into prompt context
  this.iterationLog.push(`INCOMING: [${msg.type}] from ${msg.from}: ${JSON.stringify(msg.payload).substring(0, 200)}`);
}
```

### 1.5 Yuan message listener

**Modified file:** `src/modules/sandbox-yuan/YuanSandboxHandler.ts`

Yuan already receives from UI. Add listener for agent messages:

```typescript
// In init():
eventBus.on('agent:message', (msg: AgentMessage) => {
  if (msg.to !== 'yuan' && msg.to !== 'broadcast') return;
  // Forward to UI via yuan:event
  eventBus.emit('yuan:event', {
    type: 'agent-message',
    from: msg.from,
    messageType: msg.type,
    payload: msg.payload,
  });
});
```

### 1.6 askUser fix — agentId routing

**Modified file:** `src/services/negotiators/UserNegotiator.ts`

Change from taskId-only to agentId-based routing:

```typescript
// Current:
static async negotiate(taskId: string, question: string, format: any, llmCall: any): Promise<string>

// After:
static async negotiate(agentId: AgentId, question: string, format: any, llmCall: any, taskId?: string): Promise<string> {
  // Write to db.messages with agentId (not just taskId)
  await db.messages.add({ sender: agentId, taskId: taskId || '', type: 'question', content: question, status: 'unread', timestamp: Date.now() });

  // Block on agent:message reply instead of user:reply filtered by taskId
  return new Promise((resolve) => {
    const handler = (msg: AgentMessage) => {
      if (msg.to === agentId && msg.type === 'reply' && msg.replyTo === questionId) {
        eventBus.off('agent:message', handler);
        resolve(msg.payload.content);
      }
    };
    eventBus.on('agent:message', handler);
  });
}
```

**Modified file:** `src/modules/channel-user-negotiator/UserHandler.ts`

Pass agentId from context:

```typescript
// In handleRequest, extract agentId from context or derive from toolName prefix
```

---

## Phase 2 — Executor Interruption

### 2.1 Jules poll-loop cancel

**Modified file:** `src/modules/executor-jules/JulesHandler.ts` or `JulesNegotiator.ts`

Add message queue check inside the polling loop:

```typescript
// In the poll loop (currently: while status !== completed):
while (!done) {
  await sleep(pollInterval);
  const msg = messageQueue.poll('orchestrator'); // or pass queue check as callback
  if (msg?.type === 'intervention' && msg.payload.taskId === currentTaskId) {
    await this.cancelJulesSession(sessionId);
    return { cancelled: true, reason: msg.payload.reason };
  }
  done = await this.checkStatus(sessionId);
}
```

### 2.2 UserNegotiator cancel injection

**Modified file:** `src/services/negotiators/UserNegotiator.ts`

When intervention arrives for a blocked negotiate() call, inject a synthetic reply:

```typescript
// In the blocking wait:
// If agent:message arrives with intervention type for this agentId,
// resolve with a cancellation response instead of user input
```

### 2.3 Orchestrator → Executor cancel propagation

**Modified file:** `src/core/orchestrator.ts`

When `handleIntervention` fires, propagate cancel to the active executor:

```typescript
// Track active executor promise
// On intervention: signal executor to cancel (AbortController or callback)
```

---

## Phase 3 — WatchdogDream (Night→Day Bridge)

### 3.1 WatchdogDream module

**New file:** `src/modules/process-dream/WatchdogDream.ts`

```typescript
import { messageQueue } from '../../core/message-queue';
import { AgentMessage } from '../../core/agent-message';
import { db } from '../../services/db';

export class WatchdogDream {
  /**
   * Called after sessionDream and deepDream complete.
   * Scans their findings and checks: is any running task affected?
   */
  static async scan(findings: DreamFinding[], context: RequestContext): Promise<void> {
    const runningTasks = await db.tasks
      .where('workflowStatus').equals('IN_PROGRESS')
      .toArray();

    if (runningTasks.length === 0) return; // nothing running, nothing to interrupt

    for (const finding of findings) {
      const affected = this.matchRunningTasks(finding, runningTasks);
      if (affected.length > 0) {
        this.emitDayMessage(finding, affected);
      }
    }
  }

  private static matchRunningTasks(finding: DreamFinding, tasks: Task[]): Task[] {
    // Match based on finding type:
    // - executor failure → tasks using that executor
    // - conflict → tasks whose artifacts are involved
    // - recurring error → tasks with matching error tags
    // - protocol failure → tasks using that protocol
    return tasks.filter(t => this.isAffected(t, finding));
  }

  private static emitDayMessage(finding: DreamFinding, affectedTasks: Task[]): void {
    const msg: AgentMessage = {
      id: crypto.randomUUID(),
      from: 'process-agent', // watchdog runs as part of dream engine
      to: finding.severity === 'critical' ? 'orchestrator' : 'process-agent',
      type: finding.severity === 'critical' ? 'intervention' : 'alert',
      payload: {
        action: finding.severity === 'critical' ? 'pause' : 'review',
        taskIds: affectedTasks.map(t => t.id),
        finding: finding.summary,
        source: 'watchdog-dream',
      },
      timestamp: Date.now(),
    };
    eventBus.emit('agent:message', msg);
  }
}
```

### 3.2 Wire into dream pipeline

**Modified file:** `src/modules/process-dream/Handler.ts`

After sessionDream and deepDream run, call WatchdogDream.scan():

```typescript
// After sessionDream completes:
const findings = sessionDreamResults.filter(r => r.watchdogRelevant);
await WatchdogDream.scan(findings, context);

// After deepDream completes:
const deepFindings = deepDreamResults.filter(r => r.watchdogRelevant);
await WatchdogDream.scan(deepFindings, context);
```

---

## Dependency Order

```
Phase 0 (foundation, no behavior change)
  0.1 AgentMessage types
  0.2 MessageQueue
  0.3 Trace interceptor
    ↓
Phase 1 (day flow)
  1.1 Agent bus wiring (host.ts)
  1.2 Message delivery
  1.3 Orchestrator interruption
  1.4 ProcessAgent interruption
  1.5 Yuan listener
  1.6 askUser fix
    ↓
Phase 2 (executor interruption)
  2.1 Jules poll-loop cancel
  2.2 UserNegotiator cancel
  2.3 Executor cancel propagation
    ↓
Phase 3 (watchdog)
  3.1 WatchdogDream module
  3.2 Wire into dream pipeline
```

Each phase is independently shippable. Phase 0 has zero risk. Phase 1 adds the bus without removing old paths. Phase 2 adds executor cancel. Phase 3 adds the night→day bridge.

---

## Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `src/core/agent-message.ts` | 0 | **New** — types |
| `src/core/message-queue.ts` | 0 | **New** — queue |
| `src/core/registry.ts` | 0 | Add interceptor |
| `src/core/host.ts` | 1 | Wire agent:message delivery + trace interceptor |
| `src/core/orchestrator.ts` | 1 | Step-loop queue check + handleIntervention |
| `src/modules/process-project-manager/ProcessAgent.ts` | 1 | ReAct-loop queue check |
| `src/modules/sandbox-yuan/YuanSandboxHandler.ts` | 1 | agent:message listener |
| `src/services/negotiators/UserNegotiator.ts` | 1+2 | agentId routing + cancel injection |
| `src/modules/channel-user-negotiator/UserHandler.ts` | 1 | Pass agentId |
| `src/modules/executor-jules/JulesHandler.ts` | 2 | Poll-loop cancel check |
| `src/modules/process-dream/WatchdogDream.ts` | 3 | **New** — night→day bridge |
| `src/modules/process-dream/Handler.ts` | 3 | Wire watchdog after session/deep dream |

---

## Test Scenarios

Concrete scenarios that exercise the full day/night communication model. Each scenario has a setup, expected message flow, and assertions.

---

### Scenario 1: Night flow — dream enriches KB, no day message

**Setup:**
- Task-1 completed successfully with executor-jules
- Task-2 completed, architect chose REST API pattern
- No tasks IN_PROGRESS

**Expected flow:**
```
commit-harvest → KB entry { category: 'decision', abs: 4, content: 'chose REST API' }
microDream → KB entry { category: 'insight', abs: 5, content: 'project uses REST patterns' }
sessionDream → KB entry { category: 'insight', abs: 7, content: 'consistent REST pattern across tasks' }
reflection → no rules trigger (no errors)
deepDream → KB entry { category: 'insight', abs: 9, content: 'project has REST-first architecture' }
watchdogDream → scans: no IN_PROGRESS tasks → does nothing
projector → feeds 'REST-first' insight into next architect prompt
```

**Assertions:**
- No `agent:message` emitted
- KB has entries at abs 4, 5, 7, 9
- Next architect call sees the insight via projector

---

### Scenario 2: Night→Day — watchdog detects running task affected

**Setup:**
- Task-1 IN_PROGRESS, using executor-jules, step 3/5
- Task-2 IN_PROGRESS, using executor-jules, step 1/3
- Previous 3 completed tasks all failed with jules on infrastructure steps
- sessionDream runs, produces: `{ abs: 7, content: 'infrastructure tasks fail with jules', category: 'insight' }`

**Expected flow:**
```
sessionDream → KB entry { abs: 7, 'infrastructure tasks fail with jules' }
watchdogDream → scans findings
  → matches: Task-1 is infrastructure + using jules? YES
  → matches: Task-2 is infrastructure + using jules? YES
  → emits agent:message {
      from: 'process-agent', to: 'orchestrator', type: 'intervention',
      payload: { action: 'pause', taskIds: ['task-1', 'task-2'], reason: '...' }
    }
orchestrator → receives intervention
  → pauses both tasks
  → emits agent:message { to: 'process-agent', type: 'status', payload: { paused: ['task-1', 'task-2'] } }
```

**Assertions:**
- 1 day-flow message emitted (watchdog → orchestrator)
- Both tasks set to PAUSED
- ProcessAgent receives status confirmation

---

### Scenario 3: Yuan operator cancels a running task

**Setup:**
- Task-5 IN_PROGRESS, orchestrator executing step 2/4 on jules
- User says "cancel task 5, it's going in circles"

**Expected flow:**
```
yuanSend('cancel task 5, it's going in circles')
Yuan → interprets → emits agent:message {
  from: 'yuan', to: 'orchestrator', type: 'intervention',
  payload: { action: 'cancel', taskId: 'task-5', reason: 'user: going in circles' }
}
orchestrator → receives intervention between step 2 and step 3
  → cancels jules session
  → sets task-5 to CANCELLED
  → emits agent:message { to: 'yuan', type: 'reply', payload: { cancelled: 'task-5' } }
Yuan → shows "task-5 cancelled" to user
```

**Assertions:**
- Jules session cancelled
- Task-5 status = CANCELLED
- Yuan receives reply and shows to user
- Steps 3, 4 never executed

---

### Scenario 4: Yuan operator requests architect re-plan

**Setup:**
- Task-3 IN_PROGRESS, orchestrator on step 2/6
- Architect's plan has steps 3-6 about building GraphQL API
- User says "no, we want REST, not GraphQL"

**Expected flow:**
```
yuanSend('no, we want REST, not GraphQL')
Yuan → interprets → emits agent:message {
  from: 'yuan', to: 'orchestrator', type: 'directive',
  payload: { action: 'replan', taskId: 'task-3', reason: 'user wants REST not GraphQL' }
}
orchestrator → receives directive
  → pauses step execution
  → calls architect.generateProtocol() with updated context: 'user requires REST, not GraphQL'
  → architect returns new protocol { steps: [3..6 using REST] }
  → resumes from step 3 with new protocol
```

**Assertions:**
- Yuan does NOT message architect directly
- Orchestrator calls architect with user's constraint
- New protocol uses REST
- Steps continue from step 3

---

### Scenario 5: ProcessAgent detects contradictory plan mid-task

**Setup:**
- Task-7 IN_PROGRESS, orchestrator executing step 4/5
- ProcessAgent runs review, reads plan.md (artifact) → plan says "use bash-executor"
- ProcessAgent reads step 4 → it's using executor-jules
- Contradiction: plan says bash, step uses jules

**Expected flow:**
```
ProcessAgent.runReview()
  → listTasks → sees task-7 IN_PROGRESS
  → readArtifact('plan.md') → "use bash-executor"
  → contradiction detected
  → emits agent:message {
      from: 'process-agent', to: 'orchestrator', type: 'intervention',
      payload: { action: 'pause', taskId: 'task-7', reason: 'plan.md says bash-executor, step 4 uses jules' }
    }
orchestrator → receives intervention
  → pauses task-7
  → emits agent:message { to: 'architect', type: 'request',
       payload: { action: 'replan-step', taskId: 'task-7', stepIndex: 4, reason: '...' } }
architect → replans step 4 with correct executor
orchestrator → resumes task-7
```

**Assertions:**
- ProcessAgent intervention stops task before step 4 wastes tokens
- Orchestrator requests architect re-plan for the specific step
- Task resumes with corrected step

---

### Scenario 6: Orchestrator reports step contradiction to architect

**Setup:**
- Task-2 IN_PROGRESS, step 3/5
- Step 3 result: file `auth.ts` was deleted by executor (unexpected)
- Protocol step 4 depends on `auth.ts` existing

**Expected flow:**
```
orchestrator → executes step 3 → result: auth.ts deleted
  → checks: step 4 needs auth.ts → file doesn't exist → contradiction
  → emits agent:message {
      from: 'orchestrator', to: 'architect', type: 'request',
      payload: { action: 'replan-step', taskId: 'task-2', stepIndex: 4, reason: 'auth.ts deleted, step 4 depends on it' }
    }
architect → replans steps 4-5 without auth.ts dependency
orchestrator → continues with revised steps
```

**Assertions:**
- Orchestrator detects contradiction before executing step 4
- Architect replans only affected steps (4+), keeps 1-3
- No token waste on a step that would fail

---

### Scenario 7: askUser — agent asks question, blocks until reply

**Setup:**
- Task-4 IN_PROGRESS, orchestrator on step 2/3
- Step 2 needs to know: "should we use JWT or session cookies for auth?"
- Orchestrator calls askUser

**Expected flow:**
```
orchestrator → calls askUser('JWT or session cookies?')
  → emits agent:message {
      from: 'orchestrator', to: 'user', type: 'request',
      payload: { question: 'JWT or session cookies?', taskId: 'task-4' }
    }
  → blocks on reply

UI → shows question notification
User → clicks "JWT"
  → emits agent:message {
      from: 'user', to: 'orchestrator', type: 'reply',
      payload: { content: 'JWT' }, replyTo: originalMessageId
    }

orchestrator → unblocks with "JWT"
  → continues step 2 with JWT approach
```

**Assertions:**
- Orchestrator blocked (no further steps) until reply
- Question appeared in UI
- Reply routed to correct agent via agentId, not taskId

---

### Scenario 8: askUser — non-task agent asks question

**Setup:**
- ProcessAgent runs review, finds constitution is ambiguous about testing strategy
- ProcessAgent has taskId: '' (no task context)
- ProcessAgent calls askUser to clarify

**Expected flow:**
```
ProcessAgent.runReview()
  → finds constitution gap
  → calls askUser('Testing strategy unclear: TDD or test-after?')
  → emits agent:message {
      from: 'process-agent', to: 'user', type: 'request',
      payload: { question: 'Testing strategy unclear: TDD or test-after?' }
    }
  → blocks on reply

User → replies "TDD"
  → emits agent:message { from: 'user', to: 'process-agent', type: 'reply', payload: { content: 'TDD' } }

ProcessAgent → unblocks → saves to KB as constitution amendment proposal
```

**Assertions:**
- askUser works WITHOUT taskId (agentId routing, not taskId)
- ProcessAgent can ask questions despite having no task
- Reply routed to 'process-agent' agentId

---

### Scenario 9: Watchdog ignores finding with no running tasks

**Setup:**
- All tasks completed or in TODO
- deepDream produces: { abs: 9, 'architectural drift toward microservices' }

**Expected flow:**
```
deepDream → KB entry { abs: 9, 'architectural drift toward microservices' }
watchdogDream → scans: IN_PROGRESS tasks = 0
  → does nothing
projector → feeds insight into next agent invocation
```

**Assertions:**
- Zero day-flow messages emitted
- KB entry exists for projector to use
- No agents interrupted

---

### Scenario 10: Reflection triggers watchdog — recurring error on running task

**Setup:**
- Task-8 IN_PROGRESS, step 1/3, using bash-executor
- Previous 3 tasks had same bash error: "permission denied on /tmp/build"
- reflection.reclassify fires SAME-ERROR rule

**Expected flow:**
```
reflection → SAME-ERROR rule fires
  → creates self-task "Fix recurring permission error on bash-exec"
  → watchdogDream scans: is task-8 running with bash-executor? YES
  → emits agent:message {
      from: 'process-agent', to: 'orchestrator', type: 'intervention',
      payload: { action: 'pause', taskIds: ['task-8'], reason: 'recurring bash permission error' }
    }
orchestrator → pauses task-8
self-task → picked up by ProcessAgent on next review
```

**Assertions:**
- Self-task created
- Task-8 paused before more steps hit the same error
- Watchdog crossed night→day because task was actively affected
