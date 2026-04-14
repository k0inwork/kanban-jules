# Collective Branch Analysis: CLI Agent Integration into almostnode (yuaone)

## 1. Current Agent Architecture (agent.go)

The WASM agent lives in `wasm/agent/` and consists of 3 Go files (~440 LOC total):

| File | LOC | Role |
|------|-----|------|
| `main.go` | 103 | Entry point: Eino ReAct agent setup, system prompt, run loop |
| `llmmodel.go` | 223 | LLM calls via filesystem RPC (`/llm/request` → `/llm/result`) |
| `pipetool.go` | 121 | Tool calls via filesystem RPC (`/tools/call` → `/tools/result`) |

**Framework:** CloudWeGo Eino (ReAct loop, max 12 steps)
**Compiler:** Standard Go (`GOOS=js GOARCH=wasm`) → **23MB** WASM binary
**Dependencies:** Eino + sonic (with a 217-line shim for WASM compat)

### How it works

The agent runs **inside a Wanix WASM VM** with no network access. All communication goes through virtual filesystems that act as **RPC channels**:

```
agent.wasm (sandboxed, no network)
  │
  ├── Write JSON to /llm/request  ──→  LLMFS (Go, boot layer)
  │   Read from /llm/result       ←──  ──→ JS bridge ──→ browser LLM API
  │
  ├── Read /tools/list            ←──  ToolFS (Go, boot layer)
  │   Write JSON to /tools/call   ──→  ──→ JS bridge ──→ browser tool handlers
  │   Read from /tools/result     ←──
  │
  └── Write to /yuan/in           ──→  YuanFS (Go, boot layer)
      Read from /yuan/out         ←──  ──→ JS bridge ──→ almostnode YUAN agent
```

### Key pattern: Filesystem-as-RPC

Every virtual FS follows the same pattern:
1. **Write** request data to a file (e.g., `/llm/request`)
2. **Read** result from another file (e.g., `/llm/result`) — the read **triggers** the actual operation
3. The boot layer (Go, `//go:build js && wasm`) bridges to JavaScript via `syscall/js`
4. JavaScript calls the actual APIs (LLM, tools, board, etc.)

This is not filesystem storage — it's IPC/RPC disguised as file I/O.

---

## 2. Virtual Filesystem Layer (Boot)

The boot layer (`wasm/boot/`) mounts 5 virtual filesystems into the Wanix kernel namespace:

| FS | Mount | Files | Purpose |
|----|-------|-------|---------|
| **LLMFS** | `#llm` | `prompt`, `response`, `request`, `result` | LLM API tunnel (text + structured JSON) |
| **ToolFS** | `#tools` | `list`, `call`, `result` | Tool invocation tunnel |
| **BoardFS** | `#board` | `tasks/`, `artifacts/`, `invoke` | Kanban board state CRUD |
| **GitFS** | `#repo` | (dynamic) | Read-only repo file access |
| **YuanFS** | `#yuan` | `in`, `out`, `status` | Bridge to YUAN agent in almostnode |

**YuanFS is already the integration point.** It's designed specifically to bridge the WASM agent to an external YUAN agent running in almostnode. The JS side must expose `window.boardVM.yuan.{init(), send(msg), status()}`.

---

## 3. YuanFS: The Existing Bridge to almostnode

`wasm/boot/yuanfs.go` (208 lines) already implements the filesystem bridge:

- **`/#yuan/in`** — Write-only. Accumulates message bytes.
- **`/#yuan/out`** — Read triggers `boardVM.yuan.send(msg)` → runs the YUAN agent → returns response text.
- **`/#yuan/status`** — Read returns current status (`idle`|`running`|`error`|`not initialized`).

**This means the WASM↔almostnode bridge is already built.** The remaining work is on the almostnode side.

---

## 4. YUAN CLI (@yuaone) — What Needs to Run in almostnode

From the AGENT_HARNESS_ANALYSIS.md Section 6, YUAN is a TypeScript agent CLI:

| Package | Size | Key Components |
|---------|------|---------------|
| `@yuaone/cli` | 1.5 MB | TUI, commands, session, auth |
| `@yuaone/core` | 6.6 MB | AgentLoop, DecisionEngine, 170+ modules |
| `@yuaone/tools` | 485 KB | 15 built-in tools, BaseTool, ToolRegistry |

### Why YUAN fits almostnode (portability score: 8/10)

- **Pure TypeScript** — no Python, no Docker, no native binaries required
- **OpenAI SDK as single LLM abstraction** — one 30-line shim redirects all LLM calls through `boardVM.llmfs.sendRequest()`
- **Tool registry is pluggable** — native-dependent tools (`node-pty`, `playwright`) are optional
- **Decision Engine is stateless/pure** — no I/O, no async, runs in any JS runtime
- **Event-driven (not process-driven)** — uses `EventEmitter`, not `child_process.fork()`

### What's already proven working

From `test-yuan-almostnode.html`:
- almostnode container creation ✓
- `npm install @yuaone/core @yuaone/tools` into VFS ✓
- openai shim injection ✓
- Agent loop execution (phases 1-5) ✓

---

## 5. Integration Effort Assessment

### What's Already Done (0 LOC new)

| Component | Status | Location |
|-----------|--------|----------|
| YuanFS bridge (WASM side) | **Complete** | `wasm/boot/yuanfs.go` |
| LLMFS (LLM tunnel) | **Complete** | `wasm/boot/llmfs.go` |
| ToolFS (tool tunnel) | **Complete** | `wasm/boot/toolfs.go` |
| BoardFS (board state) | **Complete** | `wasm/boot/boardfs.go` |
| Boot sequence with all FS mounts | **Complete** | `wasm/boot/main.go` |
| YUAN running in almostnode (PoC) | **Proven** | `test-yuan-almostnode.html` |
| openai shim for LLM bridge | **Proven** | ~30 lines |

### What Needs Building

#### Phase 1: boardVM Bridge (~150 LOC)
| Component | LOC | What |
|-----------|-----|------|
| `src/bridge/boardVM.ts` | ~80 | `dispatchTool()`, tasks CRUD, `on()`/`emit()` |
| Tool name mapping | ~30 | Short names → qualified module handler names |
| Wire to ModuleRegistry | ~40 | `dispatchTool()` → `registry.invokeHandler()` |

#### Phase 2: @fleet/tools Shim (~100 LOC)
| Component | LOC | What |
|-----------|-----|------|
| `fleet-tools-shim.js` | ~70 | VFS module exposing Fleet tools as async functions |
| Bootstrap VFS injection | ~30 | Write shim into almostnode after container creation |

#### Phase 3: Agent Loop (~350 LOC)
| Component | LOC | What |
|-----------|-----|------|
| Core autonomous loop (observe→think→plan→act) | ~200 | Periodic + event-driven |
| Decision Engine (ported from YUAN) | ~100 | Intent/complexity/routing classification |
| Monitoring & review logic | ~50 | Anomaly detection, stuck task detection |

#### Phase 4: Bootstrap & UI (~150 LOC)
| Component | LOC | What |
|-----------|-----|------|
| `agent-bootstrap.ts` | ~100 | Create almostnode container, install agent, register shims, start loop |
| UI pivot | ~50 | Remove old orchestrator calls, add agent status display |

### Total New Code: ~750-950 LOC

---

## 6. Parallel Track: WASM Agent Migration (Eino → swarm-go)

The `docs/agent-migration-proposal.md` proposes a **separate** migration for the Go WASM agent:

| Aspect | Current | Proposed |
|--------|---------|----------|
| Framework | CloudWeGo Eino | feiskyer/swarm-go |
| Compiler | Standard Go | TinyGo |
| WASM size | 23 MB | 1-5 MB (est.) |
| Effort | — | 5-7 days |

**This is independent of the almostnode integration.** The WASM agent and the almostnode YUAN agent serve different purposes:
- **WASM agent** = lightweight in-browser agent running inside Wanix sandbox
- **almostnode YUAN agent** = full-featured autonomous agent running in browser-side Node.js shim

They communicate via YuanFS. Both can evolve independently.

---

## 7. Architectural Decision: Three Integration Paths

From AGENT_HARNESS_ANALYSIS.md Section 13.13:

| Path | Description | Effort | Risk |
|------|------------|--------|------|
| **A: YUAN as Black-Box Executor** | YUAN runs complete inside almostnode. Fleet passes tasks in, gets results back. No tool-level integration. | ~200 LOC | Low |
| **B: YUAN Tools as Fleet Bindings** | Extract YUAN tool implementations and expose as Fleet sandbox bindings. LLM still generates code (CodeAct). | ~400 LOC | Medium |
| **C: Replace Fleet's Loop with YUAN's** | Replace the orchestrator's LLM-codegen-Sval pipeline with YUAN's AgentLoop. | ~800 LOC | High |

**Recommendation from the analysis: Path A first**, then evolve toward the full autonomous agent (Section 12's "Honest Architecture" — ~950 LOC total).

---

## 8. Key Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| almostnode can't handle long-running agent daemon | High (untested) | Fall back to running agent loop directly in browser (outside almostnode) |
| npm dependency tree too large for almostnode VFS | Medium | Test incrementally; YUAN core has ~170 modules |
| Agent crashes in almostnode | Medium | Restart container; restore state from Dexie (all state persisted in IDB) |
| CodeAct vs tool_call protocol mismatch | High (architectural) | Path A avoids this entirely; Path C requires adapter |

---

## 9. Summary

| Dimension | Assessment |
|-----------|-----------|
| **Bridge (WASM ↔ almostnode)** | **Already built.** YuanFS is complete and designed for this exact purpose. |
| **YUAN in almostnode** | **Already proven.** test-yuan-almostnode.html demonstrates it works. |
| **Remaining work** | ~750-950 LOC: boardVM bridge, tool shims, agent loop, bootstrap |
| **Effort estimate** | **5-10 days** for full autonomous agent; **2-3 days** for Path A (black-box executor) |
| **agent.go role** | Stays as-is. It's the lightweight WASM-side agent. YUAN in almostnode is the heavyweight autonomous brain. They coexist via YuanFS. |
| **Biggest unknown** | Whether almostnode can sustain a persistent autonomous loop (designed for request-response, not daemons) |
