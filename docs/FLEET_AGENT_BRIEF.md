# Fleet Agent Operating Brief

> Extracted from AGENT_HARNESS_ANALYSIS.md. This is what the agent needs to act.
> Full reference material (3300+ lines): `AGENT_HARNESS_ANALYSIS.md`

---

## 1. What Fleet Is

Fleet (aka Agent Kanban, kanban-jules) is a **browser-based autonomous agent orchestrator**.
React 19 + Vite 6 + Dexie/IndexedDB + isomorphic-git + Sval sandbox.

```
Browser SPA
├── Kanban UI → task board, module logs, artifacts, mailbox
├── Orchestrator → step runner (OBSERVE→THINK→PLAN→ACT)
├── Sval Sandbox (Web Worker) → ES2019 interpreter for generated code
├── 9 Modules (manifest.json declared) → executors, knowledge, channels, process
├── Dexie DB → 7 tables (tasks, artifacts, messages, sessions, configs, gitCache, links)
└── eventBus → inter-module pub/sub
```

**The agent controls Fleet, doesn't replace it.** Fleet is the hands (execution layer). The agent in almostnode is the brain (decision layer). The agent decides what tasks to create, monitors board state, maintains constitution, and intervenes when things go wrong.

**Key DB schema: v18.** Global state field is `agentContext` (Map-based). Logs are consolidated under `task.moduleLogs[moduleId]`.

---

## 2. How to Talk to Fleet (API Surface)

### Dexie Tables the Agent Reads/Writes

| Table | Agent reads | Agent writes |
|-------|------------|--------------|
| `tasks` | Status, logs, agentContext, success criteria | Create tasks, update status, write agentContext |
| `projectConfigs` | Constitution (key = repoUrl+branch) | Constitution amendments, error log entries |
| `messages` | User replies, unread alerts | Status updates, questions to user |
| `taskArtifacts` | Analysis results, intermediate data | Reports, findings, synthesized results |
| `julesSessions` | Active sessions, repo/branch mapping | (read-only for agent) |
| `gitCache` | Cached file contents | (Fleet-managed) |

### eventBus Events

| Event | Direction | Agent Use |
|-------|-----------|-----------|
| `module:log` | Fleet → all | Subscribe to monitor executor/architect activity in real-time |
| `user:reply` | User → Fleet | Listen for human-in-the-loop responses |
| `project:review` | Trigger | Kick off project health analysis |

### boardVM Bridge

`globalThis.boardVM` is the single escape hatch from almostnode to Fleet modules. All tool calls from the agent's runtime go through this bridge.

---

## 3. Module System (9 Modules)

```
MODULE ID               TYPE        TOOLS/BINDINGS                            PERMS
──────────────────────────────────────────────────────────────────────────────────
architect-codegen       architect   generateProtocol (prompt-level)            —
executor-local          executor    listFiles, readFile, headFile, writeFile,  storage
                                    saveArtifact, listArtifacts, askUser, sendUser
executor-jules          executor    askJules (via JulesNegotiator)             —
executor-github         executor    runWorkflow, runAndWait, fetchLogs,        network,
                                    getRunStatus, fetchArtifacts, askUser       storage, timers
knowledge-artifacts     knowledge   CRUD artifacts + Gemini FunctionDecls      —
knowledge-repo-browser  knowledge   listFiles, readFile, headFile, writeFile   —
knowledge-local-analyzer knowledge  pattern scanning across files               —
channel-user            channel     mailbox (send/receive via UserNegotiator)  —
process-project-manager process     project review trigger                    —
```

**sandboxBindings = the permission boundary.** Code running in the Sval sandbox can ONLY call these declared functions. Nothing else is available.

**Permission gates** (enforced by `sandbox.worker.ts`):
- `storage` — file system access (tool name check)
- `network` — blocks fetch, XMLHttpRequest, WebSocket
- `timers` — gated setTimeout/setInterval

---

## 4. Executor Playbook

### Local Executor (sandbox)

LLM generates JS → Sval interpreter → tool calls bridge to Fleet modules.
Most transparent: every call is logged, auditable.
Best for: file operations, artifact management, analysis tasks, anything using declared bindings.

### Jules Executor (cloud VM)

Always creates fresh session (no reuse). Full negotiation loop:

```
send prompt → poll activities (5s, 15min timeout)
  ├─ progressUpdated → LLM verify against success criteria
  ├─ planGenerated → auto-approve
  ├─ agentMessaged → capture, done
  ├─ AWAITING_USER_FEEDBACK → LLM analyze transcript, send action prompt
  ├─ idle 3min → check-in message
  └─ idle 10min → delete session, fail
after → fetch outputs (PR URLs, branches) → verify → retry up to 3x
```

Rate limit: exponential backoff (10s, 20s, 30s...).
Can create PRs and branches — agent must extract branch names from responses.

### GitHub Actions Executor (CI/CD)

```
runWorkflow(yaml, branch) → parse YAML, create temp branch, push, poll for run ID
runAndWait(yaml, branch)  → runWorkflow + poll until complete + cleanup
fetchArtifacts(runId)     → download as base64, save to Dexie
```

Known bug: `getRunStatus()` calls `fetchWithRetry()` instead of `this.fetchWithRetry()`.
Concurrent runs are safe (isolated temp branches).

### Routing Decision

| Task type | Executor | Why |
|-----------|----------|-----|
| File read/write, analysis, artifacts | local | Transparent, fast, no API cost |
| Feature implementation, large refactors, test writing | jules | Full VM, can run builds/tests |
| CI/CD, builds, multi-step pipelines | github | Real GitHub Actions runner |
| Small fixes, quick checks | local first, jules fallback | Local is faster, jules for complexity |

---

## 5. Constitution Duties

### Two-Layer System

| Layer | Source | Content | Who maintains |
|-------|--------|---------|---------------|
| Fleet executor constitution | Fleet/user | Declarative rules per executor | User edits, Fleet stores |
| Agent executor profile | Agent observation | Empirical: success rates, failure modes, latency | Agent updates from history |

### Agent's 4 Responsibilities

1. **Read** — Before routing, check target executor's constitution for compatibility
2. **Cross-check** — Compare claimed capabilities vs observed profile; flag mismatches
3. **Detect conflicts** — Contradictory rules between executors → flag for user
4. **Suggest amendments** — Based on error patterns, propose updates

### Error Collection (synthesized, not raw)

```
GOOD: "auth-middleware.ts:45 — req.user undefined when token expired. Task #23 failed.
       Fix: validate token expiry before accessing. Recurrence: 2."
BAD:  "TypeError: Cannot read property 'user' of undefined at ..." (full stack)
```

Sources: Fleet task failures (moduleLogs), Jules session failures, command failures.
Each entry: 2-3 sentences max. What broke, where, likely cause, fix suggestion.

---

## 6. Sandbox Constraints

1. **ES2019 only** — No Node.js built-ins, no `require`, no `process`, no `Buffer`
2. **Async tool bridge** — Every external call goes through `postMessage`; no synchronous I/O
3. **Shallow git** — `depth=1`, single branch via isomorphic-git; no history access
4. **Browser-only storage** — Dexie/IndexedDB; no filesystem, no network storage
5. **Jules: no session reuse** — Context must be passed in each prompt
6. **GitHub Actions: temp branches** — Each run isolated; branch created and cleaned up

---

## 7. Task Lifecycle

```
USER REQUEST
  ↓
parseTasksFromMessage() → LLM extracts task objects
  ↓
Task created in Dexie (status: PENDING)
  ↓
Orchestrator picks up task
  ↓
composeArchitectPrompt() → LLM generates protocol (which modules to use, in what order)
  ↓
Protocol steps execute in Sval sandbox
  ↓ (per step)
  ├─ Tool call via sandbox bridge → Fleet module handler → result
  ├─ askUser → UserNegotiator → waits for user reply
  └─ askJules → JulesNegotiator → cloud VM → poll for result
  ↓
Task result verified against success criteria
  ↓
Task marked COMPLETE or ERROR
  ↓
Agent monitors, reviews, intervenes if needed
```

The agent plugs in at three points:
- **Before**: Set success criteria, choose executor, write constitution rules
- **During**: Monitor moduleLogs via eventBus, detect stuck/error patterns
- **After**: Verify result, update executor profiles, log errors, amend constitution

---

## 8. Build Plan (Priority Order)

| # | Component | LOC | What |
|---|-----------|-----|------|
| 1 | Constitution reader/writer | ~40 | Read `projectConfigs`, parse rules, write amendments |
| 2 | Executor profiler | ~30 | Track success/failure per executor, update agentContext |
| 3 | Task result verifier | ~25 | Post-execution check against success criteria |
| 4 | Module manifest introspector | ~20 | Read manifests, build capability map for routing |
| 5 | Event bus listener | ~15 | Subscribe to `module:log`, aggregate into context |
| 6 | Error collector/analyzer | ~50 | Read failures, synthesize short entries, write to error_log |
| 7 | Initial project scanner | ~40 | Detect project type, write first constitution |
| 8 | Constitution-aware planner | ~20 | Read constitution before ACT, apply rules |
| | | **~240** | |

---

## 9. What's Coming (Not Yet in Main)

- **Per-executor constitutions**: Behavior profiles per executor (user confirmed, not yet merged)
- **CNA (Claude Negotiator Agent)**: Third negotiator type, not implemented
- **Planner architect variant**: DAG-based dependency-aware task decomposition
- **30+ modules cataloged**: WASM executor, Docker executor, Jira/Notion/web knowledge sources, Telegram/Slack channels, cron/file-watch triggers — all in `docs/modules-catalog.md`, none implemented
- **Dynamic module loading**: Manifests exist but modules are imported directly, not from a registry

---

## Reference

Full analysis: `AGENT_HARNESS_ANALYSIS.md` (3300+ lines, 15 sections)
- Sections 1-11: Claude Code internals, competitor analysis, harness patterns
- Section 12: Synthesis — our architecture (agent controls Fleet)
- Section 13: Fleet browser platform analysis (review branch)
- Section 14: Sources & references
- Section 15: Fleet main branch audit (this brief's primary source)
