# Agent Wire Protocol

A typed interface for wiring any agent backend into the system. Backends are swappable — `@yuaone/core` (almostnode), Claude API, mock, or future agents — without changing UI, negotiators, or task orchestration.

## 1. Problem

Currently:

- `agent-bootstrap.ts` hardcodes a **single** `AgentLoop` instance as `globalThis._yuanAgent`
- Spawned Yuan chats (`SpawnedYuanChat`) bypass the agent entirely — raw `callLLM()` with no tool loop, no react pattern, no history accumulation
- Replacing `@yuaone/core` with a different agent means rewriting `agent-bootstrap.ts`, `YuanChatPanel`, `SpawnedYuanChat`, and every consumer
- Events flow through `boardVM.emit('yuan:event', ...)` — untyped global pub/sub with no scoping

We need:

1. **Multiple concurrent agent sessions** — main workspace agent + spawned persona chats, each with its own prompt, tools, budget
2. **Backend abstraction** — swap `@yuaone/core` for Claude, Gemini, or mock without touching consumers
3. **Typed event streaming** — UI components subscribe to specific sessions, not global broadcasts
4. **Interface boundary** — a contract that decouples "what the agent does" from "how the system talks to it"

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ YuanChatPanel│  │SpawnedYuanChat│  │ TaskPanel    │      │
│  │ (main agent) │  │ (persona chat)│  │ (status feed)│      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                  │               │
│         └─────────┬───────┴──────────────────┘               │
│                   │ onEvent(chatId, handler)                 │
│                   │ sendMessage(chatId, msg)                 │
│          ┌────────▼────────┐                                 │
│          │   YuanService   │  ← singleton, app-scoped        │
│          │   (multiplexer) │                                 │
│          └────────┬────────┘                                 │
│                   │                                          │
│         ┌─────────▼──────────┐                               │
│         │  AgentBackend      │  ← swappable interface        │
│         └─────────┬──────────┘                               │
└───────────────────┼──────────────────────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌────────┐   ┌───────────┐   ┌──────────┐
│  Yuan  │   │  Claude   │   │  Mock    │
│Backend │   │  Backend  │   │  Backend │
│        │   │           │   │          │
│AgentLoop│  │tool_use   │   │canned    │
│in      │   │SSE stream │   │responses │
│almost- │   │           │   │          │
│node    │   │           │   │          │
└────────┘   └───────────┘   └──────────┘
```

## 3. Core Types

```typescript
// ─── Agent Event ───

type AgentEventKind =
  | 'thinking'      // agent is processing (may show spinner)
  | 'stream'        // partial text output (streaming token-by-token)
  | 'tool_call'     // agent is calling a tool
  | 'tool_result'   // tool returned a result
  | 'completed'     // agent finished a turn
  | 'error';        // something went wrong

interface AgentEvent {
  chatId: string;
  kind: AgentEventKind;
  payload: Record<string, any>;
  timestamp: number;
}

// Specific payload shapes by kind:
//
// thinking:   { content: string }
// stream:     { text: string, done: boolean }
// tool_call:  { tool: string, args: Record<string, any>, callId?: string }
// tool_result:{ tool: string, output: string, success: boolean, callId?: string, durationMs: number }
// completed:  { summary: string, reason: string, tokensUsed?: number }
// error:      { message: string, recoverable: boolean }

// ─── Session Config ───

type ToolScope = 'readonly' | 'search' | 'full';

interface SessionConfig {
  chatId: string;
  persona: 'explorer' | 'analyst' | 'worker' | string;
  systemPrompt: string;
  objective: string;
  toolScope?: ToolScope;       // default: 'readonly'
  customTools?: ToolDef[];     // additional tools beyond scope
  tokenBudget?: number;        // default: 20000
  maxIterations?: number;      // default: 10
  metadata?: Record<string, any>;  //taskId, projectId, etc.
}

// ─── Session Result ───

interface AgentResult {
  chatId: string;
  summary: string;
  fullHistory: { role: string; content: string }[];
  tokensUsed: number;
  toolCallsMade: number;
  durationMs: number;
}

// ─── Event Handler ───

type AgentEventHandler = (event: AgentEvent) => void;
```

## 4. AgentBackend Interface

The contract every backend must implement. This is the **single seam** where agent implementations plug in.

```typescript
interface AgentBackend {
  /**
   * Create a new agent session.
   * The backend calls onEvent for every event this session produces.
   * Returns the chatId (echoed from config.chatId for confirmation).
   */
  createSession(config: SessionConfig, onEvent: AgentEventHandler): Promise<string>;

  /**
   * Send a user message to an existing session.
   * The backend emits events via the onEvent handler provided in createSession.
   * Returns the final text response when the agent turn completes.
   */
  sendMessage(chatId: string, message: string): Promise<string>;

  /**
   * Close a session and return its final state.
   * After this, sendMessage must reject for this chatId.
   */
  closeSession(chatId: string): Promise<AgentResult>;

  /**
   * Abort a running turn (user pressed stop, timeout, etc.).
   */
  abortSession(chatId: string): void;

  /**
   * List active session IDs.
   */
  listSessions(): string[];
}
```

### Why `onEvent` is a callback, not an emitter

- The backend owns the lifecycle — it calls `onEvent` only while the session is alive
- No leak risk from forgotten listeners
- The multiplexer (`YuanService`) controls fan-out
- Easy to test — pass a collector, inspect calls

### Why `sendMessage` returns a promise AND emits events

- Events give real-time streaming (thinking, tool calls, partial text)
- The promise resolves with the final response text — callers who just want the answer don't need to subscribe
- `completed` event fires at the same time the promise resolves

## 5. YuanService (Multiplexer)

A singleton that holds the active `AgentBackend` and fans out events to UI subscribers.

```typescript
class YuanService {
  private backend: AgentBackend;
  private listeners: Map<string, Set<AgentEventHandler>> = new Map();

  constructor(backend: AgentBackend) {
    this.backend = backend;
  }

  /** Swap backend at runtime (e.g. user changes provider in settings). */
  setBackend(backend: AgentBackend): void {
    // Optionally: close all existing sessions first
    this.backend = backend;
  }

  /** Create a new agent session. UI components can subscribe before or after. */
  async createSession(config: SessionConfig): Promise<string> {
    const chatId = await this.backend.createSession(config, (event) => {
      this.emit(event);
    });
    return chatId;
  }

  /** Send message to an existing session. */
  async sendMessage(chatId: string, message: string): Promise<string> {
    return this.backend.sendMessage(chatId, message);
  }

  /** Close session, return final result, clean up listeners. */
  async closeSession(chatId: string): Promise<AgentResult> {
    const result = await this.backend.closeSession(chatId);
    this.listeners.delete(chatId);
    return result;
  }

  /** Abort a running turn. */
  abort(chatId: string): void {
    this.backend.abortSession(chatId);
  }

  /** Subscribe to events for a specific session. Returns unsubscribe fn. */
  onEvent(chatId: string, handler: AgentEventHandler): () => void {
    if (!this.listeners.has(chatId)) {
      this.listeners.set(chatId, new Set());
    }
    this.listeners.get(chatId)!.add(handler);
    return () => {
      this.listeners.get(chatId)?.delete(handler);
      if (this.listeners.get(chatId)?.size === 0) {
        this.listeners.delete(chatId);
      }
    };
  }

  /** Subscribe to ALL agent events (for logging, debugging). */
  onAnyEvent(handler: AgentEventHandler): () => void { /* ... */ }

  private emit(event: AgentEvent): void {
    // Fan out to session-specific listeners
    this.listeners.get(event.chatId)?.forEach(h => {
      try { h(event); } catch (e) { console.error('[YuanService] listener error:', e); }
    });
    // Fan out to global listeners
    this.listeners.get('*')?.forEach(h => {
      try { h(event); } catch (e) { console.error('[YuanService] global listener error:', e); }
    });
  }
}
```

## 6. Backend Implementations

### 6a. YuanBackend (current — @yuaone/core in almostnode)

The first implementation. Wraps the existing `AgentLoop` from `@yuaone/core`.

```typescript
class YuanBackend implements AgentBackend {
  private sessions: Map<string, {
    agent: AgentLoop;
    onEvent: AgentEventHandler;
    history: { role: string; content: string }[];
  }> = new Map();

  async createSession(config: SessionConfig, onEvent: AgentEventHandler): Promise<string> {
    // Call into almostnode via globalThis bridge
    const bridge = (globalThis as any)._yuanBridge;
    const chatId = await bridge.createSession({
      chatId: config.chatId,
      systemPrompt: config.systemPrompt,
      toolScope: config.toolScope || 'readonly',
      tokenBudget: config.tokenBudget || 20000,
      maxIterations: config.maxIterations || 10,
    });

    // Subscribe to events from almostnode, translate to AgentEvent
    (globalThis as any).boardVM.on('yuan:event', (ev: any) => {
      if (ev.chatId !== config.chatId) return;
      onEvent(this.translateEvent(config.chatId, ev));
    });

    return chatId;
  }

  private translateEvent(chatId: string, raw: any): AgentEvent {
    const timestamp = Date.now();
    switch (raw.kind) {
      case 'agent:thinking':
        return { chatId, kind: 'thinking', payload: { content: raw.content }, timestamp };
      case 'agent:tool_call':
        return { chatId, kind: 'tool_call', payload: { tool: raw.tool, args: raw.args }, timestamp };
      case 'agent:tool_result':
        return { chatId, kind: 'tool_result', payload: { tool: raw.tool, output: raw.output, success: raw.success }, timestamp };
      case 'agent:completed':
        return { chatId, kind: 'completed', payload: { summary: raw.summary }, timestamp };
      case 'agent:error':
        return { chatId, kind: 'error', payload: { message: raw.message, recoverable: true }, timestamp };
      default:
        return { chatId, kind: 'error', payload: { message: `unknown event kind: ${raw.kind}`, recoverable: true }, timestamp };
    }
  }
}
```

#### Almostnode runner changes

Inside `agent-bootstrap.ts`, the runner script adds three functions to `globalThis._yuanBridge`:

```javascript
globalThis._yuanBridge = {
  agents: new Map(),

  createSession: function(config) {
    var agent = new AgentLoop({
      config: {
        byok: { /* from boardVM settings */ },
        loop: {
          maxIterations: config.maxIterations,
          totalTokenBudget: config.tokenBudget,
          tools: filterToolsByScope(allDefs, config.toolScope),
          systemPrompt: config.systemPrompt,
        }
      },
      toolExecutor: toolExecutor,
    });

    // Wire events to boardVM.emit with chatId scoping
    agent.on('event', function(ev) {
      if (!ev || !ev.kind) return;
      globalThis.boardVM.emit('yuan:event', { chatId: config.chatId, ...ev });
    });

    globalThis._yuanBridge.agents.set(config.chatId, { agent, config });
    return config.chatId;
  },

  sendToSession: function(chatId, message) {
    var entry = globalThis._yuanBridge.agents.get(chatId);
    if (!entry) throw new Error('No session: ' + chatId);
    return entry.agent.run(message);
  },

  closeSession: function(chatId) {
    var entry = globalThis._yuanBridge.agents.get(chatId);
    if (!entry) return null;
    var history = entry.agent.contextManager ? entry.agent.contextManager.getMessages() : [];
    globalThis._yuanBridge.agents.delete(chatId);
    return { chatId, history: history };
  },
};
```

#### Tool scope filtering

```javascript
function filterToolsByScope(allDefs, scope) {
  var READONLY = new Set([
    'file_read', 'glob', 'grep', 'code_search',
    'repo.readFile', 'repo.listFiles', 'repo.headFile',
    'web_search', 'conversationSearch',
    'task_complete',  // every agent needs to signal completion
  ]);
  var SEARCH = new Set([
    ...READONLY,
    'kb.queryLog', 'kb.recordEntry', 'kb.queryDocs', 'kb.saveDocument',
  ]);
  // 'full' = everything

  var allowed = scope === 'full' ? null
    : scope === 'search' ? SEARCH
    : READONLY;

  if (!allowed) return allDefs;
  return allDefs.filter(function(d) { return allowed.has(d.name); });
}
```

### 6b. DirectLLMBackend (lightweight — for when no agent loop is available)

What `SpawnedYuanChat` currently does, but conforming to the interface. No tool calling, no react — just prompt/response.

```typescript
class DirectLLMBackend implements AgentBackend {
  constructor(private callLLM: (messages: any[]) => Promise<string>) {}

  async createSession(config: SessionConfig, onEvent: AgentEventHandler): Promise<string> {
    onEvent({ chatId: config.chatId, kind: 'completed', payload: { summary: 'session ready' }, timestamp: Date.now() });
    return config.chatId;
  }

  async sendMessage(chatId: string, message: string): Promise<string> {
    // No tool loop — just call the LLM and return
    // Events are optional here (could emit 'thinking' and 'completed')
    const response = await this.callLLM(messages);
    return response;
  }

  async closeSession(chatId: string): Promise<AgentResult> {
    return { chatId, summary: '', fullHistory: [], tokensUsed: 0, toolCallsMade: 0, durationMs: 0 };
  }
}
```

### 6c. MockBackend (testing)

```typescript
class MockBackend implements AgentBackend {
  private sessions: Map<string, AgentEventHandler> = new Map();
  private responses: Map<string, string[]> = new Map();

  setResponse(chatId: string, ...responses: string[]): void {
    this.responses.set(chatId, responses);
  }

  async createSession(config: SessionConfig, onEvent: AgentEventHandler): Promise<string> {
    this.sessions.set(config.chatId, onEvent);
    onEvent({ chatId: config.chatId, kind: 'completed', payload: { summary: 'mock ready' }, timestamp: Date.now() });
    return config.chatId;
  }

  async sendMessage(chatId: string, message: string): Promise<string> {
    const onEvent = this.sessions.get(chatId);
    const queue = this.responses.get(chatId) || ['mock response'];
    const response = queue.shift() || 'mock response';

    onEvent?.({ chatId, kind: 'thinking', payload: { content: 'mock thinking' }, timestamp: Date.now() });
    onEvent?.({ chatId, kind: 'completed', payload: { summary: response }, timestamp: Date.now() });
    return response;
  }

  async closeSession(chatId: string): Promise<AgentResult> {
    this.sessions.delete(chatId);
    return { chatId, summary: 'mock closed', fullHistory: [], tokensUsed: 0, toolCallsMade: 0, durationMs: 0 };
  }

  abortSession(chatId: string): void {}
  listSessions(): string[] { return [...this.sessions.keys()]; }
}
```

## 7. Consumer Integration

### 7a. YuanService initialization (in BoardVMContext or App)

```typescript
// During app startup:
const backend = new YuanBackend();  // or: new DirectLLMBackend(callLLM)
const yuanService = new YuanService(backend);

// Expose via context or global
(window as any).yuanService = yuanService;
```

### 7b. SpawnedYuanChat (replaces raw callLLM)

```typescript
// Before:
const response = await callLLM(historyRef.current);

// After:
useEffect(() => {
  const unsub = yuanService.onEvent(chatId, (event) => {
    switch (event.kind) {
      case 'thinking':
        term.writeln('\x1b[35m[yuan]\x1b[0m \x1b[2mThinking...\x1b[0m');
        break;
      case 'stream':
        term.write(event.payload.text);
        break;
      case 'tool_call':
        term.writeln(`\x1b[33m[tool]\x1b[0m ${event.payload.tool}(${JSON.stringify(event.payload.args).slice(0, 80)})`);
        break;
      case 'tool_result':
        const mark = event.payload.success ? '✓' : '✗';
        term.writeln(`\x1b[2m  ${mark} ${String(event.payload.output).slice(0, 120)}\x1b[0m`);
        break;
      case 'completed':
        term.writeln('');
        setStatus('ready');
        break;
      case 'error':
        term.writeln(`\x1b[31m[error]\x1b[0m ${event.payload.message}`);
        setStatus('error');
        break;
    }
  });
  return unsub;
}, [chatId]);

// Sending:
const handleSend = async () => {
  term.writeln(`\x1b[34m[you]\x1b[0m> ${input}`);
  setInput('');
  await yuanService.sendMessage(chatId, input);
};
```

### 7c. YuanChatPanel (main agent — backward compat)

```typescript
// Main agent uses a reserved chatId: "main"
// YuanService creates it during init
await yuanService.createSession({
  chatId: 'main',
  persona: 'worker',
  systemPrompt: buildSystemPrompt(fleetDefs),
  objective: '',
  toolScope: 'full',
  tokenBudget: 100000,
  maxIterations: 25,
});

// Sending stays the same conceptually:
const response = await yuanService.sendMessage('main', userMessage);
```

### 7d. YuanNegotiator (spawning persona chats)

```typescript
// Currently:
eventBus.emit('yuan-chat:spawn', { chatId, systemPrompt, ... });

// After:
const chatId = await yuanService.createSession({
  chatId: generateId(),
  persona: opts.chatStyle,
  systemPrompt: YuanNegotiator.buildSystemPrompt(opts),
  objective: opts.objective,
  toolScope: personaToScope(opts.chatStyle),
  tokenBudget: 20000,
  maxIterations: 10,
  metadata: { taskId: opts.taskId, projectId: opts.projectId },
});

// UI still gets notified to open a tab:
eventBus.emit('yuan-chat:spawn', { chatId, ... });
```

### 7e. Persona → tool scope mapping

```typescript
const personaToScope = (persona: string): ToolScope => {
  switch (persona) {
    case 'explorer': return 'readonly';
    case 'analyst':  return 'search';
    case 'worker':   return 'full';
    default:         return 'readonly';
  }
};
```

## 8. Migration Plan

### Phase 1: Runner script refactor

Add `_yuanBridge` to the almostnode runner in `agent-bootstrap.ts`:
- `createSession(config)` — creates scoped `AgentLoop` instances in a `Map`
- `sendToSession(chatId, message)` — routes to the right instance
- `closeSession(chatId)` — cleans up
- Keep existing `_yuanAgent` / `_yuanRunWithCallback` as `bridge.get('main')` for backward compat

### Phase 2: YuanService + YuanBackend

Create `src/services/YuanService.ts` with:
- The `AgentBackend` interface
- The `YuanService` multiplexer class
- The `YuanBackend` implementation (calls `globalThis._yuanBridge`)

### Phase 3: Wire consumers

Update in this order:
1. `YuanChatPanel` — switch from `yuanSend()` to `yuanService.sendMessage('main', ...)`
2. `SpawnedYuanChat` — switch from `callLLM()` to `yuanService.sendMessage(chatId, ...)`
3. `YuanNegotiator` — use `yuanService.createSession()` instead of event-only flow

### Phase 4: Backend selection

Wire settings UI to `yuanService.setBackend()`:
- almostnode available → `YuanBackend`
- only API key → `DirectLLMBackend`
- testing → `MockBackend`

## 9. Open Questions

1. **History persistence**: Should `closeSession` write the full history to `db.yuanChatSessions`, or is that the consumer's job? Lean toward: backend returns it, YuanService or YuanNegotiator persists it.

2. **Session limits**: How many concurrent AgentLoop instances can almostnode handle? Each has its own context manager and history. Probably fine for 3-5 spawned chats, but worth profiling.

3. **Streaming granularity**: `AgentLoop` emits `agent:thinking` but not token-level streaming. For SSE-style token streaming, we'd need to hook into the LLM response handler inside the openai-shim. This is a future enhancement — the `'stream'` event kind is reserved for it.

4. **Tool result routing**: When a spawned session calls `askUserFor`, the reply needs to get back to the right agent session. Currently this goes through `eventBus` + `UserNegotiator`. With the new protocol, `YuanService` could have a `injectToolResult(chatId, callId, result)` method, but this needs design.

5. **Main agent backward compat**: The main workspace agent has special behavior (async task injection, agent bus messages, conversation search sync). These hooks live in `_yuanRunWithCallback`. During migration, the "main" session should inherit all of these. Spawned sessions should not.
