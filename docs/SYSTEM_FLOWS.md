# System Flows

Complete map of event flows, inter-agent control, KB projection, and the day-night-day cycle.

---

## 1. Day-Night-Day Cycle

```
DAY (Task Execution)
─────────────────────
  App.tsx useLiveQuery → finds TODO/IN_PROGRESS + IDLE task
    → orchestrator.processTask(task)
      → architect generates protocol (steps + executor assignments)
      → evaluateBranch → git branch (if qualifies)
      → step loop:
          → ProjectorHandler.project(L3) → injects KB into prompt
          → LLM generates JS code
          → executeInSandbox (Web Worker)
              → code calls tools → moduleRequest → eventBus → host → registry → handler
          → step complete → mark completed
      → all steps done:
          → merge branch + enqueue push
          → KBHandler.recordExecution (observation)
          → KBHandler.recordDecision (architect-declared decisions)
          → emit executor:completed
          → process-dream.microDream(taskId)

  MicroDream (per-task consolidation):
      → gather raw entries for task (abstraction ≤ 2, ≥3 needed)
      → verifyDecisions: LLM confirms harvested decision classifications
      → LLM summarizes entries → insight entry (abstraction 7)
      → deactivate raw entries
      → record executor-outcome observation

  Task DONE → processTask returns 'DONE'
    → App.tsx calls handleReviewProject()

NIGHT (Board Idle / Consolidation)
──────────────────────────────────
  TRIGGER 1: Task completes → handleReviewProject()
  TRIGGER 2: Board idle 5 minutes (host.ts idle timer)
      → host.ts: module:log listener resets 5min timer on orchestrator activity
      → when timer fires + 0 IN_PROGRESS tasks:
          → process-dream.sessionDream()

  SessionDream (cross-task consolidation):
      → gather all active raw entries (execution + micro-dream non-insight)
      → LLM pattern recognition → outputs patterns, failures, strategies, docGaps
      → append insight/error/decision/observation entries (abstraction 7)
      → detectConflicts: compare verified decisions for contradictions
          → classify: constitutional-override, guiding, self-correcting, doubtful
          → auto-resolve: constitutional (constitution wins), guiding (higher abs wins)
          → escalate doubtful/self-correcting: create mailbox alert + register user:reply handler
      → deactivate superseded non-error/non-decision entries
      → THEN: ReflectionHandler.reclassify (post-session-dream)
      → THEN: watchdogDream()

  DeepDream (strategic consolidation — manual trigger):
      → full project consolidation LLM call → strategic insight (abstraction 9)
      → external gap resolution (if external sources available)
      → constitution review → propose amendment via mailbox
      → prune raw execution entries older than 7 days
      → generateDecisionLog → save as KB doc
      → THEN: watchdogDream()

  WatchdogDream (the only dream that ACTS):
      → find IN_PROGRESS tasks
      → scan recent (30min) dream/reflection findings for errors, gaps, conflicts, corrections
      → match findings to running tasks (by tag or executor)
      → IF critical (error, conflict, high-abstraction correction):
          AgentBus.send({ from: 'watchdog', to: 'orchestrator', type: 'intervention',
                          payload: { action: 'pause' } })
      → IF non-critical:
          AgentBus.send({ from: 'watchdog', to: 'process-agent', type: 'alert',
                          payload: { action: 'notify' } })

BACK TO DAY
───────────
  ProcessAgent.runReview (react loop):
      → listTasks, listArtifacts, checkGates
      → compare artifact statuses against constitution stages
      → proposeTask (new task via mailbox message)
      → sendMessage (alert/info to mailbox)
      → IF full autonomy: auto-accept → new task created → agent loop picks it up
      → IF assisted/manual: user clicks Accept → task created → agent loop picks it up
```

---

## 2. Event Bus — All 13 Event Types

| Event | Emitter | Consumer(s) | Purpose |
|---|---|---|---|
| `module:log` | Any module | `host.ts` | Append to `task.moduleLogs[moduleId]`. Resets idle timer if moduleId=`orchestrator`. |
| `module:request` | `orchestrator.moduleRequest()` | `host.ts` | Route sandbox tool calls: eventBus → host → registry → handler |
| `module:response` | `host.ts` | `orchestrator.moduleRequest()` | Resolve handler result back to waiting Promise |
| `executor:completed` | `orchestrator.processTask()` (on DONE) | `commit-harvest` listener | Extract decisions from commit diffs |
| `projector:injection` | `orchestrator.runStep()` | UI | Visibility into what KB was injected for a step |
| `agent:message` | `AgentBus.send()` | `host.ts`, `messageQueue` | Inter-agent comms. host.ts forwards to/yuan/broadcast as `yuan:event` |
| `yuan:event` | `host.ts` | Yuan UI event stream | Bridge from agent messages to Yuan interface |
| `user:reply` | Mailbox UI | `UserNegotiator`, conflict handlers | Resume waiting step or resolve decision conflicts |
| `project:review` | `App.tsx handleReviewProject()` | `host.ts` → `ProcessAgent.runReview()` | Trigger project review cycle |
| `task:manual-trigger` | `App.tsx` drag/drop | `orchestrator.runManual()` | Manual task start |
| `trace:tool-call` | `registry` interceptor | Observability | Every tool call emits a trace event |

---

## 3. Agent Bus — Inter-Agent Control

### Agent IDs

`yuan` | `process-agent` | `architect` | `orchestrator` | `watchdog` | `user`

### Message Flow

```
AgentBus.send({ from, to, type, payload })
  → eventBus.emit('agent:message')     // host.ts → yuan:event bridge
  → messageQueue.deliver(msg)          // poll-based consumers
```

### Poll-Based Consumers

**Orchestrator** — `orchestrator.pollIntervention()`:
- `messageQueue.poll('orchestrator')` — called between steps in the step loop
- Handles: `pause` (PAUSED), `cancel` (abort + TODO), `replan` (clear protocol)

**ProcessAgent** — react loop iteration:
- `messageQueue.poll('process-agent')` — at start of each iteration
- Logs as INCOMING message

### Intervention Handling (Orchestrator)

| Action | Effect |
|---|---|
| `pause` | agentState → PAUSED (stops step loop, stays IN_PROGRESS) |
| `cancel` | abort controller + workflowStatus → TODO, agentState → IDLE |
| `replan` | Clear protocol → architect re-generates on next processTask |

### Yuan Bridge

```
agent:message where to='yuan' or to='broadcast'
  → host.ts emits yuan:event { kind: 'agent-message', from, messageType, payload }
  → Yuan UI receives in event stream
  → Yuan does NOT send back via agent bus — uses boardVM tools
    which go through module:request → normal tool routing
```

---

## 4. KB Projection Flow

```
ProjectorHandler.project({ layer, project, taskId, executor, taskDescription, focus })
  │
  ├── 1. BASE (projectBase)
  │     ├── Constitution text (L0/L1 only, from projectConfigs)
  │     ├── Role constitution (per layer):
  │     │     L0 → system:yuan       (or OVERSEER_CONSTITUTION fallback)
  │     │     L1 → system:overseer   (or OVERSEER_CONSTITUTION fallback)
  │     │     L2 → system:architect  (or ARCHITECT_CONSTITUTION fallback)
  │     │     L3 → system:programmer (or PROGRAMMER_CONSTITUTION fallback)
  │     └── Executor-specific knowledge (from moduleKnowledge table)
  │
  ├── 2. RAG (projectRAG)
  │     ├── Filter: active kbDocs matching layer + project + tags
  │     ├── Chunk each doc (by headers, then paragraphs)
  │     ├── Score: keyword overlap + focus keyword 3x + tag exact match 5x
  │     ├── Sort by score desc, then recency
  │     └── Take until char budget exhausted
  │         L0=2400  L1=1800  L2=2400  L3=1200
  │
  ├── 3. EXPERIENCE (projectExperience)
  │     ├── Filter: active kbLog matching layer + project + executor + taskId + tags
  │     ├── L2/L3: cap abstraction ≤5 (conflict-resolved bypasses cap)
  │     ├── Block: conflict-pending entries are NOT projected
  │     ├── Score by keyword + focus overlap
  │     └── Take until char budget exhausted
  │         L0=4800  L1=3600  L2=3600  L3=2400
  │
  ├── 4. BOARD STATE (L0/L1 only)
  │     └── Task counts by workflowStatus
  │
  └── 5. AGENT CONTEXT (L3 only)
        └── task.agentContext JSON dump
```

### Layer Consumers

| Layer | Role | Used By |
|---|---|---|
| L0 | Yuan / Overseer | ProcessAgent review |
| L1 | Project Overseer | ProcessAgent `runReview` |
| L2 | Architect | Protocol generation (`composeArchitectPrompt`) |
| L3 | Programmer/Executor | Per-step in `runStep` (`composeProgrammerPrompt`) |

---

## 5. KB Write Flows (Who Writes, What, When)

### Execution Phase (Day)

| Writer | What | Source |
|---|---|---|
| Sandbox code | `kb.recordEntry({ category, abstraction, tags })` | `execution` |
| Orchestrator | `KBHandler.recordExecution()` on task DONE | `execution` |
| Orchestrator | `KBHandler.recordDecision()` for architect-declared decisions | `execution` |
| commit-harvest | Decision entries from commit diffs | `dream:micro` |

### MicroDream (per task)

| Action | Detail |
|---|---|
| Insight entry | abstraction 5, source `dream:micro` |
| Executor-outcome observation | abstraction 3 |
| Verified decision tags | LLM confirms classifications |
| Deactivate raw entries | Superseded by consolidation |

### SessionDream (cross-task)

| Action | Detail |
|---|---|
| Pattern insights | abstraction 7, source `dream:session` |
| Failure entries | abstraction 7 |
| Strategy decisions | abstraction 7 |
| Gap observations | abstraction 3 |
| Conflict resolution entries | source `conflict-resolution` |
| Deactivate superseded | Non-error, non-decision only |

### DeepDream (strategic)

| Action | Detail |
|---|---|
| Strategic insight | abstraction 9, source `dream:deep` |
| Gap-resolved observations | From external sources |
| Constitution-amendment decisions | project `self` |
| Decision-log KB doc | Auto-generated |
| Prune | Raw execution entries older than 7 days |

### Other Writers

| Writer | What |
|---|---|
| ProcessAgent | `saveToKB` tool → save artifact as KB doc (source `process-agent`) |
| Artifact promotion | `promoteToKB` → save approved artifact as KB doc (source `artifact`) |

---

## 6. Timers & Polling

| Timer | Interval | Location | Purpose |
|---|---|---|---|
| Agent Loop | Reactive (Dexie) | `App.tsx` | Pick up TODO/IN_PROGRESS + IDLE tasks |
| Board Idle | 5 min | `host.ts` | No orchestrator activity → sessionDream |
| JulesPostman | 5 sec | `JulesPostman.ts` | Poll WAITING_FOR_EXECUTOR tasks |
| JulesNegotiator | 5 sec | `JulesNegotiator.ts` | Poll Jules API during step execution |
| Jules check-in | 3 min | `JulesNegotiator.ts` | "Where are we now?" to Jules |
| Jules idle timeout | 10 min | `JulesNegotiator.ts` | Abandon unresponsive session |
| Jules max timeout | 15 min | `JulesNegotiator.ts` | Hard limit per negotiation |
| Protocol retry | 10 sec | `orchestrator.ts` | Network error backoff |
| Step retry | 15 sec | `orchestrator.ts` | Network error backoff |
| Push queue flush | Periodic | `PushQueue` | Auto-flush pending git pushes |
| LLM call timeout | 60 sec | `host.ts` | Network timeout per call |
| ProcessAgent per-iteration | 16k chars | `ProcessAgent.ts` | Token cap per LLM turn |
| ProcessAgent total | 80k chars | `ProcessAgent.ts` | Total token budget per review |
| ProcessAgent wall-clock | 5 min | `ProcessAgent.ts` | Max review duration |
| Watchdog findings window | 30 min | `dream-levels.ts` | Scan recent dream/reflection outputs |

---

## 7. Complete Task Lifecycle

```
TODO/IDLE ──[agent loop]──→ IN_PROGRESS/EXECUTING
  │                            │
  │                    ┌───────┴────────┐
  │                    ▼                ▼
  │              Architect          Branch eval
  │              (protocol)         (git branch)
  │                    │                │
  │                    └───────┬────────┘
  │                            ▼
  │                      Step Loop ──→ runStep ──→ L3 projection ──→ sandbox
  │                            │                                        │
  │                   ┌────────┼────────┐                               │
  │                   ▼        ▼        ▼                               │
  │              WAITING   WAITING    ERROR ──→ retry (≤5x) ──→ PAUSED │
  │              FOR_USER  FOR_EXEC                                      │
  │                   │        │                                        │
  │            user:reply  JulesPostman                                 │
  │                   │     (5s poll)                                   │
  │                   └───┬────┘                                        │
  │                       ▼                                             │
  │                  step complete → next step                          │
  │                       │                                             │
  │                       ▼                                             │
  │                    DONE/IDLE                                        │
  │                       │                                             │
  │              merge + push + KB record + microDream                  │
  │                       │                                             │
  │                       ▼                                             │
  │               handleReviewProject()                                 │
  │                       │                                             │
  │                       ▼                                             │
  │               ProcessAgent.runReview()                              │
  │                       │                                             │
  │              proposeTask / sendMessage                              │
  │                       │                                             │
  │              [mailbox] → accept → new TODO/IDLE ──→ (cycle)
  │
  └──[manual drag]──→ IN_PROGRESS/EXECUTING (same flow)
```

### Autonomy Modes

| Mode | Agent Loop | Proposals |
|---|---|---|
| `manual` | Disabled — user drags tasks | User accepts manually |
| `assisted` | Runs — picks up eligible tasks | User clicks Accept |
| `full` | Runs — picks up eligible tasks | Auto-accepted, auto-started |

---

## 8. Key Source Files

| File | Role |
|---|---|
| `src/App.tsx` | Agent loop, autonomy modes, task lifecycle UI |
| `src/core/orchestrator.ts` | Task execution: protocol → branch → step loop → sandbox → KB hooks |
| `src/core/host.ts` | Module init, event routing, idle timer, agent→yuan bridge |
| `src/core/event-bus.ts` | Typed pub/sub (13 event types) |
| `src/core/agent-bus.ts` | Inter-agent messaging via AgentBus + MessageQueue |
| `src/core/agent-message.ts` | Agent IDs, message types, AgentMessage interface |
| `src/core/message-queue.ts` | Per-agent queue with deliver/poll/peek |
| `src/core/prompt.ts` | Prompt composition (architect + programmer), task parsing |
| `src/modules/process-dream/dream-levels.ts` | All dream levels: micro, session, deep, watchdog |
| `src/modules/process-dream/Handler.ts` | Dream routing: chains sessionDream → reflection → watchdog |
| `src/modules/process-project-manager/ProcessAgent.ts` | React-loop review with tools (listTasks, checkGates, proposeTask, etc.) |
| `src/modules/knowledge-projector/Handler.ts` | KB projection: base + RAG + experience + board state + agent context |
| `src/modules/knowledge-artifacts/ArtifactTool.ts` | Artifact lifecycle + promoteToKB |
| `src/modules/architect-codegen/Architect.ts` | Multi-step protocol generation |
| `src/modules/knowledge-kb/Handler.ts` | KB read/write (recordEntry, recordDecision, saveDocument, queryDocs/Log) |
| `src/services/db.ts` | Dexie DB schema (25 versions), all table definitions |
