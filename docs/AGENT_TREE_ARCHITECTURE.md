# Agent Tree Panel — Architecture

## Overview

A live-updating right-side panel showing the agent hierarchy and execution state in real-time. Covers both the Yuan Chat agent and the Task pipeline (Orchestrator → Architect → Executors).

## Problem

Currently there are two agent execution paths with zero observability:

1. **Yuan Chat**: AgentLoop emits rich events (thinking, tool_call, phase_transition, etc.) but they stay inside the almostnode container — only `console.log()`. The UI sees a spinner and a final text blob.

2. **Task pipeline**: App.tsx polls every 5s, Orchestrator dispatches to module handlers, but the only UI feedback is `task.agentState` (IDLE/EXECUTING/ERROR) and `moduleLogs` text.

Neither path gives the user visibility into what the agent is doing, which sub-system is active, or how far along execution is.

## Architecture

### 1. Event Bridge (almostnode → React)

**Current state**: AgentLoop events die in console.log inside almostnode.
**Fix**: Forward events through boardVM to React.

```
AgentLoop.emitEvent({kind: "agent:tool_call", ...})
  → agent.on('event', fn)
    → boardVM.emit('yuan:event', ev)        // boardVM is shared globalThis
      → BoardVMContext subscribes
        → React state update → tree panel re-renders
```

**Changes**:
- `agent-bootstrap.ts` line 459: In the `agent.on('event', ...)` handler, add `boardVM.emit('yuan:event', ev)` alongside the console.log
- `BoardVMContext.tsx`: Add `useEffect` subscribing to `boardVM.on('yuan:event', ...)` and expose via context

### 2. Task Pipeline Events

The Fleet eventBus already has `module:log` and `module:request`/`module:response`. These are consumed by `host.ts` and written to `task.moduleLogs`. We need to also forward these to the tree panel:

```
eventBus 'module:request'  → { taskId, toolName, args }
eventBus 'module:response' → { requestId, result, error }
eventBus 'module:log'      → { taskId, moduleId, message }
```

### 3. Tree Data Model

```typescript
interface AgentTreeNode {
  id: string;                    // unique node ID
  type: 'root' | 'agent' | 'subsystem' | 'tool' | 'step';
  name: string;                  // display name ("Yuan", "Architect", "glob", "Step 1")
  state: 'idle' | 'running' | 'pending' | 'completed' | 'error' | 'waiting';
  icon?: string;                 // emoji or icon key
  detail?: string;               // short status text ("editing src/foo.ts")
  tokens?: number;               // token usage if available
  durationMs?: number;
  children?: AgentTreeNode[];
  timestamp?: number;            // last update time
}
```

**Tree structure for Yuan Chat**:
```
Yuan Agent [running]
├── Planning [completed]
├── Execution [running]
│   ├── glob("*", /home) [completed] — 3 results
│   ├── file_read("src/main.ts") [completed] — 142 lines
│   └── file_edit("src/main.ts") [running]
└── Verification [pending]
```

**Tree structure for Task Pipeline**:
```
Task: "Add auth middleware" [running]
├── Architect [completed] — generated 3 steps
├── Step 1: Create middleware file [completed]
│   └── executor-local [completed]
├── Step 2: Add route guards [in_progress]
│   └── executor-jules [running] — editing routes.ts
└── Step 3: Write tests [pending]
    └── executor-local [pending]
```

### 4. Event → Tree Mapping

| Event | Tree Action |
|---|---|
| `agent:start` | Create root node, set state=running |
| `agent:thinking` | Update root detail text |
| `agent:tool_call` | Add child tool node, set state=running |
| `agent:tool_result` | Update tool node state (completed/error), set detail=output summary |
| `agent:phase_transition` | Add/update phase node (plan/execute/verify) |
| `agent:subagent_phase` | Add sub-agent child node |
| `agent:subagent_done` | Update sub-agent node state |
| `agent:completed` | Set root state=completed |
| `agent:error` | Set root or active child state=error |
| `module:request` | Add executor child under current step |
| `module:response` | Update executor node state |

### 5. UI Component

**Location**: Right sidebar in App.tsx (mirrors left sidebar pattern).

```
┌─────────────────────────┬──────────────────┬──────────────┐
│ Left Sidebar            │ Main Content     │ Agent Tree   │
│ (repo/mailbox)          │ (board/workspace)│ (collapsible)│
│                         │                  │              │
│                         │                  │ ◉ Yuan Agent │
│                         │                  │   ○ Planning │
│                         │                  │   ● Execute  │
│                         │                  │     ✓ glob   │
│                         │                  │     ● edit   │
│                         │                  │   ○ Verify   │
└─────────────────────────┴──────────────────┴──────────────┘
```

**Component tree**:
```
AgentTreePanel (right sidebar, w-72)
  ├── AgentTreeHeader (title + collapse button)
  └── AgentTreeView (recursive)
        └── AgentTreeNode (per node)
              ├── icon + name + state badge
              ├── detail text (truncated)
              └── children (collapsible)
```

**State indicators**: ○ idle, ● running (spinner), ✓ completed, ✗ error, ◌ pending

### 6. Implementation Steps

1. **Event bridge**: Add `boardVM.emit('yuan:event', ev)` in agent-bootstrap.ts event handler
2. **React context**: Add `useAgentEvents()` hook in BoardVMContext that subscribes to yuan:events
3. **Tree model**: Create `AgentTreeModel` class that consumes events and builds tree structure
4. **UI component**: `AgentTreePanel.tsx` with recursive `AgentTreeNode.tsx`
5. **Layout**: Add right sidebar toggle in App.tsx header, wire up collapse/expand
6. **Task pipeline integration**: Also subscribe to `module:log` and `module:request/response` events

### 7. Open Questions

- **History**: Show only current run, or keep history of past runs?
- **Detail level**: Show full tool output on click, or just summaries?
- **Task vs Yuan**: One unified tree or separate tabs for task pipeline vs Yuan chat?
- **Auto-scroll**: Auto-expand and scroll to currently active node?
