# Agent Harness Architecture: Comprehensive Analysis

> How Claude Code, Aider, SWE-agent, OpenHands, and others build reliable coding agents from LLM APIs.
>
> Sources: Claude Code leaked source (via Claurst specs), official docs, community analysis, academic research, competitor repos.

---

## Table of Contents

1. [What is an Agent Harness?](#1-what-is-an-agent-harness)
2. [The Universal Agentic Loop](#2-the-universal-agentic-loop)
3. [Claude Code: The Gold Standard](#3-claude-code-the-gold-standard)
   - 3.1 [Architecture Overview](#31-architecture-overview)
   - 3.2 [The Query Loop (Core Engine)](#32-the-query-loop)
   - 3.3 [Tool System](#33-tool-system)
   - 3.4 [Context Window Management](#34-context-window-management)
   - 3.5 [Permission & Security System](#35-permission--security-system)
   - 3.6 [System Prompt Architecture](#36-system-prompt-architecture)
   - 3.7 [State Management](#37-state-management)
   - 3.8 [Hook System](#38-hook-system)
   - 3.9 [MCP Integration](#39-mcp-integration)
   - 3.10 [Multi-Agent Orchestration](#310-multi-agent-orchestration)
   - 3.11 [Memory System ("Dream")](#311-memory-system-dream)
   - 3.12 [Error Handling & Recovery](#312-error-handling--recovery)
   - 3.13 [Hidden Features (from leak)](#313-hidden-features-from-leak)
4. [Competitor Analysis](#4-competitor-analysis)
   - 4.1 [Aider](#41-aider)
   - 4.2 [mini-SWE-agent](#42-mini-swe-agent)
   - 4.3 [OpenHands](#43-openhands)
   - 4.4 [Cline](#44-cline)
   - 4.5 [Cursor](#45-cursor)
   - 4.6 [Devin](#46-devin)
5. [Open Source Frameworks](#5-open-source-frameworks)
6. [YUAN CLI (@yuaone/cli) — Deep Dive](#6-yuan-cli-yuaonecli--deep-dive)
   - 6.1 [Architecture Overview](#61-architecture-overview)
   - 6.2 [Package Structure](#62-package-structure)
   - 6.3 [The Agent Loop](#63-the-agent-loop)
   - 6.4 [Decision Engine (No LLM Needed)](#64-decision-engine-no-llm-needed)
   - 6.5 [Tool System](#65-tool-system)
   - 6.6 [Prompt Architecture](#66-prompt-architecture)
   - 6.7 [Context Management](#67-context-management)
   - 6.8 [Permission & Security](#68-permission--security)
   - 6.9 [Multi-Agent & Sub-Agents](#69-multi-agent--sub-agents)
   - 6.10 [Advanced Features](#610-advanced-features)
   - 6.11 [YUAN vs Claude Code Comparison](#611-yuan-vs-claude-code-comparison)
7. [Key Harness Components Reference](#7-key-harness-components-reference)
8. [Common Failure Modes & Mitigations](#8-common-failure-modes--mitigations)
9. [How to Build Your Own Harness](#9-how-to-build-your-own-harness)
10. [Comparative Architecture Table](#10-comparative-architecture-table)
11. [Browser Portability Analysis (almostnode)](#11-browser-portability-analysis-almostnode)
12. [Synthesis: Our Case — Autonomous Agent Controls Fleet](#12-synthesis-our-case--autonomous-agent-controls-fleet)
   - 12.1 [The Mental Model](#121-the-mental-model)
   - 12.2 [What the Agent Loop Actually Looks Like](#122-what-the-agent-loop-actually-looks-like)
   - 12.3 [Fleet's Role: One of Many Toolsets](#123-fleets-role-one-of-many-toolsets)
   - 12.4 [What the Agent Does That Fleet Cannot](#124-what-the-agent-does-that-fleet-cannot)
   - 12.5 [The Ten Best Ideas — Re-ranked for Our Case](#125-the-ten-best-ideas--re-ranked-for-our-case)
   - 12.6 [What We DON'T Need](#126-what-we-dont-need)
   - 12.7 [The Executor Triangle (Revised)](#127-the-executor-triangle-revised)
   - 12.8 [Build Assessment](#128-build-assessment)
   - 12.9 [The Honest Architecture — Our Case](#129-the-honest-architecture--our-case)
   - 12.10 [Risk Assessment](#1210-risk-assessment)
   - 12.11 [What mini-SWE-agent Teaches Us](#1211-what-mini-swe-agent-teaches-us)
   - 12.12 [The Agent Needs a Real User Interface](#1212-the-agent-needs-a-real-user-interface)
   - 12.13 [Knowledge Base: The Agent Reads Smart, Not Wide](#1213-knowledge-base-the-agent-reads-smart-not-wide)
   - 12.14 [Project Constitution & Error Analysis](#1214-project-constitution--error-analysis--the-agent-builds-understanding)
13. [Fleet Browser Platform Analysis](#13-fleet-browser-platform-analysis)
14. [Sources & References](#14-sources--references)
15. [Fleet Main Branch Audit](#15-fleet-main-branch-audit)
   - 15.1 [What Changed vs. Review Branch](#151-what-changed-vs-review-branch)
   - 15.2 [Module Manifests — The Real System](#152-module-manifests--the-real-system)
   - 15.3 [Three Executors — Actual Implementation](#153-three-executors--actual-implementation)
   - 15.4 [Constitution System — Current State](#154-constitution-system--current-state)
   - 15.5 [docs/ Folder — Planned Architecture](#155-docs-folder--planned-architecture)
   - 15.6 [What the Agent Can Leverage Today](#156-what-the-agent-can-leverage-today)

---

## 1. What is an Agent Harness?

An **agent harness** is the software layer between an LLM API and the real world. It wraps a raw model API (which just generates text) into a system that can:

- **Observe** the environment (read files, search code, run commands)
- **Think** about what to do (the model does this naturally)
- **Act** on the environment (write files, run code, make API calls)
- **Loop** until the task is complete
- **Stay safe** (permissions, sandboxing, budget limits)

The harness provides **tools**, **context**, **safety**, and **orchestration**. The model provides **intelligence**.

> Key insight: The harness is the safety and reliability layer. Never rely on the LLM to enforce constraints programmatically. The harness must enforce them.

---

## 2. The Universal Agentic Loop

Every agent system follows the same fundamental pattern:

```
┌─────────────────────────────────────────────────┐
│                 AGENTIC LOOP                     │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │  OBSERVE  │───>│  THINK    │───>│   ACT     │   │
│  │ (context) │    │ (LLM)     │    │ (tools)  │   │
│  └──────────┘    └──────────┘    └──────────┘   │
│        ^                               │         │
│        └───────────────────────────────┘         │
│              (tool results fed back)              │
│                                                  │
│  STOP CONDITIONS:                                │
│  - Model returns end_turn (no more tool calls)   │
│  - Max iterations reached                        │
│  - Budget exceeded (tokens or $)                 │
│  - User cancellation                             │
│  - Timeout                                       │
└─────────────────────────────────────────────────┘
```

**Three loop variants by complexity:**

| Variant | Description | Used By |
|---------|-------------|---------|
| **Fixed Loop** | Simple while loop: call LLM -> execute tools -> repeat | OpenAI Agents SDK, mini-SWE-agent |
| **Graph-Based** | State machine with explicit nodes for error handling, validation, human approval | LangGraph |
| **Task Queue** | Pre-planned tasks executed sequentially, each with its own mini-loop | CrewAI, AutoGPT |

---

## 3. Claude Code: The Gold Standard

Source: Kuberwastaken/claurst `spec/` directory (14 architecture docs reverse-engineered from Claude Code's leaked source), blog analysis.

### 3.1 Architecture Overview

```
~800K+ LOC TypeScript/TSX, ~1,902 files, compiled with Bun

┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACE                        │
│   Terminal (Ink TUI) ←→ React Components ←→ Hooks      │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   MAIN APPLICATION                       │
│  main.tsx → REPL → Commands (87) → Plugin System        │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    QUERY ENGINE                          │
│  query.ts (69KB) → QueryEngine.ts (46KB)                │
│  Token Budget → Stop Hooks → Compact → History          │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   TOOL SYSTEM (40+ tools)                │
│  Bash, Read, Write, Edit, Glob, Grep, WebFetch          │
│  Agent, TeamCreate, TaskCreate, MCP, Skill, ...         │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   SERVICES LAYER                         │
│  API Client → Analytics → SessionMemory → Compact        │
│  AutoDream → RateLimit → MCP servers → Cost Tracking    │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   TRANSPORT LAYER                        │
│  CLI (local) / Bridge (remote) / IDE direct-connect     │
│  SSETransport | WebSocketTransport | HybridTransport    │
└─────────────────────────────────────────────────────────┘
```

**Key files by importance:**

| File | Size | Role |
|------|------|------|
| `src/query.ts` | 69KB | Core agentic loop (the heart) |
| `src/QueryEngine.ts` | 46KB | Stateful query engine for SDK/headless |
| `src/Tool.ts` | 30KB | Tool base framework |
| `src/main.tsx` | 4,683 lines | Entry point, app initialization |
| `src/interactiveHelpers.tsx` | 57KB | Interactive UI helpers |
| `src/commands.ts` | 25KB | Command registry (87 slash commands) |
| `src/tools.ts` | 17KB | Tools registry |
| `src/history.ts` | 14KB | Session history |

### 3.2 The Query Loop

The core loop in `query.ts`:

```
query(params)
  └── queryLoop(params, consumedCommandUuids)
        ├── snapshot config (buildQueryConfig())
        ├── start memory prefetch (startRelevantMemoryPrefetch)
        └── while (true):
              1. yield { type: 'stream_request_start' }
              2. build queryTracking (chainId/depth)
              3. get messages after compact boundary
              4. apply tool result budget (applyToolResultBudget)
              5. snip compact if needed (HISTORY_SNIP feature)
              6. microcompact (deps.microcompact)
              7. context collapse (CONTEXT_COLLAPSE feature)
              8. build fullSystemPrompt
              9. autocompact (deps.autocompact) → maybe compact
             10. check blocking token limit
             11. call model (deps.callModel) → stream response
             12. execute tools (runTools or StreamingToolExecutor)
             13. yield messages, tool results
             14. handleStopHooks
             15. check continuation:
                  - stop hooks blocked → continue with errors
                  - maxTurns exceeded → return 'max_turns'
                  - no tool use → check tokenBudget → return 'end_turn'
                  - tool use → continue loop
```

**Internal state tracked per loop:**

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined  // Why previous iteration continued
}
```

**Dependency injection** via `QueryDeps`:
```typescript
type QueryDeps = {
  callModel: typeof queryModelWithStreaming       // API streaming call
  microcompact: typeof microcompactMessages       // microcompaction
  autocompact: typeof autoCompactIfNeeded         // autocompaction
  uuid: () => string                              // UUID generation
}
```

### 3.3 Tool System

**Tool interface** (every tool implements this):

```typescript
type Tool<Input, Output, Progress> = {
  // Identity
  name: string
  isMcp?: boolean
  mcpInfo?: { serverName: string; toolName: string }

  // Schema
  readonly inputSchema: Input          // Zod-validated
  readonly outputSchema?: Output

  // Metadata
  description(): Promise<string>
  prompt(): Promise<string>            // Per-tool instructions
  userFacingName(input?): string

  // Capability flags
  isEnabled(permissionContext?): boolean
  isConcurrencySafe(input?): boolean
  isReadOnly(input?): boolean
  isDestructive?(input?): boolean
  toAutoClassifierInput(input): string

  // Execution
  validateInput?(input): Promise<ValidationResult>
  checkPermissions(input, context): Promise<PermissionDecision>
  call(input, context): Promise<ToolResult<Output>>

  // UI rendering (React/Ink terminal)
  renderToolUseMessage(input, options): ReactNode
  renderToolResultMessage(output): ReactNode
  mapToolResultToToolResultBlockParam(output, toolUseId): ToolResultBlockParam

  // Safety
  getPath?(input?): string | undefined  // For permission rules
}
```

**Permission decision types:**

```typescript
type PermissionDecision =
  | { behavior: 'allow'; updatedInput: Input }
  | { behavior: 'ask'; message: string }      // Prompt user
  | { behavior: 'deny'; message: string }     // Block
  | { behavior: 'passthrough' }               // Always ask
```

**Tool categories** (40+ tools):

| Category | Tools |
|----------|-------|
| File ops | FileRead, FileWrite, FileEdit |
| Shell | Bash, PowerShell |
| Search | Glob (bfs/ugrep), Grep |
| Web | WebFetch, WebSearch |
| Agent/Multi-Agent | Agent, TeamCreate, TeamDelete, SendMessage |
| Task Management | TaskCreate, TaskGet, TaskUpdate, TaskList, TaskStop, TaskOutput |
| MCP | MCPTool, McpAuth, ListMcpResources, ReadMcpResource |
| Planning | EnterPlanMode, ExitPlanMode |
| Worktrees | EnterWorktree, ExitWorktree |
| Scheduling | CronCreate, CronDelete, CronList |
| Meta | ToolSearch, AskUserQuestion, Skill |
| Output | SyntheticOutput (structured JSON schemas) |

**Tool result budget:** Before each API call, tool results are trimmed to fit within the token budget. Old/large results are reduced first.

**Tool schema caching:** Dedicated cache avoids recomputing JSON schemas per turn, reducing prompt token usage and enabling prompt cache coherence.

### 3.4 Context Window Management

This is the most critical engineering challenge. Claude Code uses a **multi-layered approach:**

```
┌─────────────────────────────────────────────────┐
│           CONTEXT MANAGEMENT LAYERS              │
│                                                  │
│  Layer 1: Token Budget Tracking                  │
│  - Count tokens before each API call             │
│  - Reserve tokens for response                  │
│  - Trigger compression when threshold hit        │
│                                                  │
│  Layer 2: Microcompaction                        │
│  - Clear old tool result content                 │
│  - Two paths:                                    │
│    a) API cache_edits (server-side)              │
│    b) Time-based (direct content mutation)       │
│  - "Old tool result content cleared"             │
│                                                  │
│  Layer 3: Auto-Compaction                        │
│  - Triggered at 90% of context window            │
│  - Groups messages by API round                  │
│  - LLM-powered summarization                     │
│  - Writes <compact_summary> tagged message       │
│                                                  │
│  Layer 4: History Snip                           │
│  - Truncates conversation history                │
│  - Keeps system prompt + recent context          │
│                                                  │
│  Layer 5: Context Collapse                       │
│  - Drains staged collapses when overflow         │
│                                                  │
│  Layer 6: Prompt Cache Optimization              │
│  - SYSTEM_PROMPT_DYNAMIC_BOUNDARY marker         │
│  - Static sections before boundary (cached)      │
│  - Dynamic sections after boundary (fresh)       │
│  - cache_control: { type: "ephemeral" } headers  │
│                                                  │
│  Layer 7: Deferred Tools                         │
│  - Tool names listed only, schemas fetched       │
│    on demand via ToolSearch                      │
│  - Reduces system prompt token count massively   │
└─────────────────────────────────────────────────┘
```

**Microcompaction details:**

Compactable tools: FileRead, Bash, Grep, Glob, WebSearch, WebFetch, FileEdit, FileWrite

Time-based trigger: If gap since last assistant message > threshold, directly clear old tool result content.

API microcompaction: Uses server-side `cache_edits` feature to clear tool results without rewriting the full context.

**Compaction strategies (API-native):**

```typescript
type ContextEditStrategy =
  | { type: 'clear_tool_uses_20250919'        // Clear tool results
      trigger?: { type: 'input_tokens'; value: number }
      keep?: { type: 'tool_uses'; value: number }
      exclude_tools?: string[] }
  | { type: 'clear_thinking_20251015'         // Clear thinking blocks
      keep: { type: 'thinking_turns'; value: number } | 'all' }
```

### 3.5 Permission & Security System

**Four permission modes:**

| Mode | Behavior |
|------|----------|
| `default` | Interactive prompts for each action |
| `auto` | ML-based auto-approval ("YOLO classifier") |
| `bypassPermissions` | Skip all checks (`--dangerously-skip-permissions`) |
| `plan` | Special restrictions during planning phase |

**Risk classification:** Every tool action classified as LOW, MEDIUM, or HIGH risk by a fast ML classifier.

**Path traversal prevention:**
- URL-encoded traversals (`%2e%2e%2f`)
- Unicode normalization attacks
- Backslash injection
- Case-insensitive path manipulation

**Protected files:** `.gitconfig`, `.bashrc`, `.zshrc`, `.mcp.json` guarded from auto-editing.

**Permission Explainer:** Separate LLM call generates human-readable explanations of tool risks before user approval.

**Settings layering** (priority order):
1. Managed (enterprise, read-only)
2. Local project (`.claude/settings.local.json`, gitignored)
3. Project (`.claude/settings.json`, committed)
4. Global (`~/.claude/settings.json`)

### 3.6 System Prompt Architecture

The system prompt is **modular**, assembled from cached sections:

```
[CACHEABLE SECTIONS] (before DYNAMIC_BOUNDARY)
  1. Attribution: "You are Claude, Anthropic's official CLI..."
  2. Core capabilities: Tool descriptions, workflow guidance
  3. Tool use guidelines: How to use tools effectively
  4. Actions section: "Executing actions with care"
  5. Safety guidelines
  6. Cyber-risk instruction (Safeguards team)
  7. Output style (Concise/Explanatory/Learning/Formal/Casual)
  8. Custom instructions from settings

__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__

[DYNAMIC SECTIONS] (after boundary, breaks cache)
  9. Working directory
  10. Memory content (from memdir)
  11. Environment info (platform, shell, date)
  12. Append system prompt (--append-system-prompt flag)
```

**Key prompt engineering techniques:**
- **Guidelines embedded in tool descriptions:** Each tool's description contains behavioral rules
- **Extensive "NEVER" directives:** Clear safety rules
- **Structured workflow procedures:** "When the user asks to commit, follow these steps: 1. Run git status... 2. Run git diff... 3. Analyze... 4. Draft... 5. Execute..."
- **Dynamic injection via `<system-reminder>` tags:** Hook outputs injected at runtime
- **Hierarchical layers:** System prompt → CLAUDE.md → Memory files → Hook reminders → User message

### 3.7 State Management

**Global session state** (`bootstrap/state.ts`) — single singleton with ~80 fields:

| Category | Fields |
|----------|--------|
| Identity | sessionId, parentSessionId, projectRoot, cwd, clientType |
| Cost tracking | totalCostUSD, totalAPIDuration, modelUsage (per-model) |
| Token tracking | totalInputTokens, totalOutputTokens, cacheReadInputTokens, currentTurnTokenBudget |
| Feature flags | kairosActive, sessionBypassPermissionsMode, scheduledTasksEnabled |
| UI state | agentColorMap, lastInteractionTime, memory usage |
| Cache | systemPromptSectionCache, cachedClaudeMdContent, promptCache1hAllowlist |

**Migrations:** Currently at version 11. Handles model renames, permission system changes, feature flag updates.

### 3.8 Hook System

Hooks are the **primary extensibility mechanism** — middleware for the agentic loop.

**Hook lifecycle events (27 events):**

```typescript
const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'UserPromptSubmit',
  'SessionStart', 'SessionEnd',
  'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact',
  'PermissionRequest', 'PermissionDenied',
  'Setup', 'TeammateIdle',
  'TaskCreated', 'TaskCompleted',
  'Elicitation', 'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate', 'WorktreeRemove',
  'InstructionsLoaded', 'CwdChanged', 'FileChanged',
]
```

**How hooks work:**
- Configured in `settings.json` under a `hooks` key
- Each hook maps an event to a command/script
- Scripts receive tool metadata via stdin
- Script output is injected as `<system-reminder>` into the conversation

**Stop hook execution order:**
1. Save cache-safe params (prompt suggestion cache)
2. Template job classification (60s timeout)
3. Background side-effects: prompt suggestion, memory extraction, auto-dream
4. Computer-use cleanup
5. Execute Stop/SubagentStop hooks in parallel
6. Yield summary if hooks ran

### 3.9 MCP Integration

**Architecture:**
- MCP servers run as separate processes
- Tools appear with prefix `mcp__<server>__<tool>`
- Schemas fetched on demand (deferred tools pattern)
- Claude Code can also **run as an MCP server** itself (name: `claude/tengu`)

**Tool pool assembly:**
```typescript
function assembleToolPool(baseTools, mcpTools): Tool[]
// Combines built-in + MCP tools
// Sorts by name for prompt-cache stability
// Deduplicates (built-in wins over MCP with same name)
```

### 3.10 Multi-Agent Orchestration

**Coordinator Mode:** Four-phase workflow:

| Phase | Actor | Purpose |
|-------|-------|---------|
| Research | Workers (parallel) | Investigate codebase |
| Synthesis | Coordinator | Read findings, craft specs |
| Implementation | Workers | Make changes per spec |
| Verification | Workers | Test changes |

**Team/Swarm system:**
- In-process teammates via `AsyncLocalStorage` for context isolation
- Process-based teammates via tmux/iTerm2 panes
- Team memory synchronization, color assignments

**Task types:**
```typescript
type TaskType =
  | 'local_bash'           // Shell commands (prefix: 'b')
  | 'local_agent'          // Sub-agent (prefix: 'a')
  | 'remote_agent'         // Remote sub-agent (prefix: 'r')
  | 'in_process_teammate'  // Teammate (prefix: 't')
  | 'local_workflow'       // Workflow (prefix: 'w')
  | 'monitor_mcp'          // MCP monitor (prefix: 'm')
  | 'dream'                // Dream consolidation (prefix: 'd')
```

Task IDs: prefix + 8 crypto-random base-36 chars (36^8 ~ 2.8 trillion combinations).

### 3.11 Memory System ("Dream")

Background memory consolidation engine — Claude literally "dreams."

**Three-gate trigger:**
1. **Time gate:** 24 hours since last dream
2. **Session gate:** 5+ sessions since last dream
3. **Lock gate:** File-based mutex (`.consolidate-lock`, 1h stale threshold)

All three must pass. This prevents both over-dreaming and under-dreaming.

**Four phases:**
1. **Orient** — ls memory directory, read MEMORY.md, skim existing files
2. **Gather** — Find new info: daily logs → drifted memories → transcript search
3. **Consolidate** — Write/update memory files, convert relative dates to absolute
4. **Prune & Index** — Keep MEMORY.md under 200 lines / ~25KB

The dream subagent gets **read-only bash** — purely a memory consolidation pass.

### 3.12 Error Handling & Recovery

| Error | Recovery |
|-------|----------|
| `max_output_tokens` | Retry up to 3 times, incrementing budget |
| Prompt too long | Reactive compact or return `blocking_limit` |
| Streaming fallback | Tombstone orphaned messages, create fresh executor |
| FallbackTriggeredError | Switch to fallback model, retry |
| Context overflow | Drain staged collapses |
| Rate limit (429) | Exponential back-off (`withRetry.ts`) |
| Tool failure | PostToolUse hook: "Analyze the error, fix the issue, and continue" |

**Key principle:** Feed errors back to the LLM and let it self-correct. This is remarkably effective — LLMs can fix their own malformed JSON, bad arguments, or wrong tool selection when told what went wrong.

### 3.13 Hidden Features (from leak)

| Feature | Description |
|---------|-------------|
| **KAIROS** | "Always-on Claude" — persistent assistant with `<tick>` prompts, 15s blocking budget, exclusive tools (SendUserFile, PushNotification, SubscribePR) |
| **ULTRAPLAN** | Offloads planning to remote Opus 4.6 with 30min thinking time, polls every 3s |
| **BUDDY** | Tamagotchi companion — deterministic gacha (Mulberry32 PRNG), 18 species, rarity weights, procedurally generated stats |
| **Undercover Mode** | Hides Anthropic identity in public repo commits — no internal codenames, no "Claude Code", no Co-Authored-By |
| **Model codenames** | Internal models use animal names (Capybara, Tengu, Fennec) |
| **Anti-distillation** | Fake tools injected into API calls as training data quality signal |

---

## 4. Competitor Analysis

### 4.1 Aider

**Stars:** 24k+ | **License:** Apache 2.0 | **Install:** 5.7M+

**Key architecture decisions:**
- **Git-first:** Every change auto-committed. Operates on local filesystem (no sandbox).
- **Repo Map:** Tree-sitter AST parsing builds a dependency graph of the entire codebase. Injected into system prompt so the LLM navigates without reading every file.
- **No tool-calling API:** Does NOT use tool_use. Prompts model to output SEARCH/REPLACE blocks parsed client-side. Model-agnostic.
- **88% "singularity":** 88% of Aider's own latest release was written by Aider itself.

**Why it works:** The tree-sitter repo map provides comprehensive codebase context at low token cost. SEARCH/REPLACE editing is more reliable than full-file rewrites.

### 4.2 mini-SWE-agent

**Affiliation:** Princeton/Stanford | **SWE-bench:** 74% verified | **Paper:** NeurIPS 2024

**The radical insight:** ~100 lines of Python achieve 74% on SWE-bench. As LLMs improve, elaborate scaffolding becomes unnecessary.

```python
class DefaultAgent:
    def run(self, task):
        self.messages = [system_prompt, instance_prompt]
        while True:
            self.step()
            if self.messages[-1].get("role") == "exit":
                break

    def step(self):
        message = self.model.query(self.messages)
        outputs = [self.env.execute(action) for action in message.get("actions", [])]
        self.add_messages(*format_observations(outputs))
```

**Key design choices:**
- **Bash only** — no tool-calling API, no custom tools. Bash is the universal action space.
- **Completely linear history** — every step appends to messages array. No summarization.
- **Stateless execution** — every action via `subprocess.run` (not persistent shell).
- **Environment abstraction** — LocalEnvironment, Docker, Podman are drop-in replacements.

### 4.3 OpenHands

**Stars:** 50k+ | **License:** MIT | **SWE-bench:** 77.6% (current leader)

Most architecturally elaborate open-source coding agent:

```
EventStream (central event bus)
  ├── Action (edit file, run command, send message)
  ├── Observation (file contents, command output)
  └── Event (_message, _id, _timestamp, _source, _cause, _llm_metrics)

Agent → examines State → produces Action
AgentController → manages State → drives loop
Runtime → abstract sandbox (Docker/Remote/Modal)
Server → FastAPI REST + WebSocket
Session → one EventStream + AgentController + Runtime per task
```

**Key differentiator:** Enterprise-ready (multi-user, RBAC, Slack/Jira, Kubernetes). Trusted by TikTok, Amazon, Netflix, Apple, NVIDIA, Google.

### 4.4 Cline (formerly Claude Dev)

VS Code extension pioneering human-in-the-loop GUI:

- Diff view for human approval of every change
- Dynamic MCP tool creation ("just ask Cline to add a tool")
- Browser automation via Claude Computer Use
- Checkpoints: workspace snapshots at each step

### 4.5 Cursor

VS Code fork (not open-source) with embedding-based semantic code search that goes beyond grep.

### 4.6 Devin

First autonomous AI software engineer (proprietary). Full cloud VM sandbox per task.

---

## 5. Open Source Frameworks

| Framework | Loop Type | Multi-Agent | Memory | Language |
|-----------|-----------|-------------|--------|----------|
| **OpenAI Agents SDK** | Fixed loop | Handoffs | Short-term | Python, TypeScript |
| **LangGraph** | Graph-based | Subgraphs | Checkpointer + Store | Python |
| **AutoGPT** | Task-driven | Task queue | Vector store | Python |
| **CrewAI** | Role-based | Crew (workers) | Entity/knowledge stores | Python |
| **AutoGen** | Conversational | GroupChat | Per-agent history | Python |
| **DSPy** | Declarative pipeline | N/A | Compiled modules | Python |

---

## 6. YUAN CLI (@yuaone/cli) — Deep Dive

> **Source:** npm packages `@yuaone/cli@2.0.2`, `@yuaone/core@1.0.2`, `@yuaone/tools@1.0.2` — decompiled and analyzed 2026-04-12.
>
> **Repo:** github.com/yuaone/yuan (private source, AGPL-3.0) | **License:** AGPL-3.0 | **Language:** TypeScript | **Versions:** 114 releases

YUAN is a Korean-built autonomous coding agent CLI that is architecturally the **most feature-rich open-core harness examined in this analysis**. It demonstrates what happens when you take every concept from this analysis and implement it — all at once.

### 6.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        YUAN ARCHITECTURE                            │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │ @yuaone/cli  │───>│ @yuaone/core     │───>│  LLM API (BYOK)   │  │
│  │ (TUI, REPL)  │    │ (AgentLoop, 170+ │    │  OpenAI/Anthropic/│  │
│  │              │    │  modules)         │    │  Google/YUA       │  │
│  └──────────────┘    └────────┬─────────┘    └───────────────────┘  │
│                               │                                     │
│                      ┌────────┴────────┐                            │
│                      │ @yuaone/tools   │                            │
│                      │ (15 built-in +  │                            │
│                      │  MCP dynamic)    │                            │
│                      └─────────────────┘                            │
│                                                                     │
│  ADVANCED SUBSYSTEMS (inside @yuaone/core):                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Decision Engine (pure sync, no LLM)                         │   │
│  │ HierarchicalPlanner (3-level: Strategic/Tactical/Operational)│   │
│  │ SubAgent system (coder/critic/verifier/specialist roles)    │   │
│  │ WorldModel (StateStore + TransitionModel + SimulationEngine)│   │
│  │ ReflexionEngine, SelfReflection, DebateOrchestrator         │   │
│  │ StrategyMarket, CapabilityGraph, CapabilitySelfModel        │   │
│  │ MetaLearningEngine, SkillLearner, StrategyLearner           │   │
│  │ FailureSignatureMemory, CausalChainResolver, PlaybookLibrary│   │
│  │ TrustEconomics, RepoKnowledgeGraph, InMemoryVectorStore     │   │
│  │ BackgroundAgentManager, ContinuationEngine, StallDetector   │   │
│  │ PatchTransaction, SemanticDiffReviewer, WorkspaceMutationPol│   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Key stat:** `@yuaone/core` contains **~170 modules** — more subsystems than Claude Code's ~800K LOC codebase, packed into a 6.6MB package. This is both impressive and a warning sign (see §6.11).

### 6.2 Package Structure

| Package | Size | LOC (est.) | Key Exports |
|---------|------|-----------|-------------|
| `@yuaone/cli` | 1.5 MB | ~8K | TUI (Ink/React), commands, session, auth, config, diff renderer |
| `@yuaone/core` | 6.6 MB | ~55K | AgentLoop, Governor, DecisionEngine, all subsystems, LLM client |
| `@yuaone/tools` | 485 KB | ~4K | 15 tools, BaseTool, ToolRegistry, validators |

**Dependencies:**
- CLI: `ink@5` (React for terminal), `commander@13`, `chalk@5`
- Core: `openai@6` (universal LLM client), `ts-morph@27` (AST), `chokidar@5` (file watch)
- Tools: `node-pty@1` (pseudo-terminal), `playwright@1.52` (browser automation), `fast-glob@3`

### 6.3 The Agent Loop

`AgentLoop` (extends EventEmitter) — the central orchestration class.

**Imports count:** 99 modules imported at the top of agent-loop.js alone.

```
Constructor initialization (in order):
  BYOKClient → Governor → OverheadGovernor → ContextManager
  → TokenBudgetManager → YuanMemory → MemoryManager
  → HierarchicalPlanner → ReflexionEngine → ContinuationEngine
  → MCPClient → FailureRecovery → ExecutionPolicyEngine
  → CostOptimizer → ImpactAnalyzer → SelfReflection
  → DebateOrchestrator → ContinuousReflection
  → PluginRegistry → SkillLoader → SpecialistRegistry
  → ToolPlanner → SelfDebugLoop → SkillLearner
  → RepoKnowledgeGraph → BackgroundAgentManager
  → ReasoningTree → ReasoningAggregator → CrossFileRefactor
  → ContextBudgetManager → QAPipeline → PersonaManager
  → VectorStore → WorldModel (StateStore, TransitionModel, SimulationEngine, StateUpdater)
  → Planner subsystem (MilestoneChecker, RiskEstimator, PlanEvaluator, ReplanningEngine)
  → TraceRecorder → ArchSummarizer → FailureSignatureMemory
  → CausalChainResolver → PlaybookLibrary → ProjectExecutive
  → StallDetector → SelfImprovementLoop → MetaLearningCollector
  → TrustEconomics → StrategyLearner → SkillRegistry
  → TracePatternExtractor → MetaLearningEngine → ToolSynthesizer
  → BudgetGovernorV2 → CapabilityGraph → CapabilitySelfModel
  → StrategyMarket → VisionIntentDetector → PatchTransaction
  → SecurityGate → JudgmentRules → ModelWeaknessTracker
  → DependencyGuard → WorkspaceMutationPolicy → PreWriteValidator
  → PatchScopeController → CommandPlanCompiler → SemanticDiffReviewer
```

**Comparison:** Claude Code's `query()` is an async generator with ~50 dependencies injected via `QueryDeps`. YUAN's AgentLoop is a God class with ~99 directly imported modules. Both achieve the same thing — the difference is dependency injection vs direct coupling.

### 6.4 Decision Engine (No LLM Needed)

This is YUAN's most distinctive architectural innovation.

```typescript
// Pure function — NO LLM calls, NO async
function agentDecide(message, projectContext, affordance): AgentDecisionContext
```

**What it computes (per user message):**
1. **Intent classification** — question/edit/refactor/fix/debug/explore/generate/review
2. **Complexity assessment** — trivial/simple/moderate/complex/massive
3. **ComputePolicy** — model tier, max iterations, token budget, parallel agents
4. **FailureSurface** — patchRisk, buildRisk, testRisk, blastRadius, ambiguityRisk
5. **VetoFlags** — editVetoed, verifyRequired, clarifyForced, finalizeBlocked
6. **ToolBudget** — per-type limits (reads, edits, shells, tests, searches, web lookups)
7. **NextAction** — ask_user / blocked_external / plan_required / execute

**Policy table (complexity → compute):**
| Complexity | Max Iterations | Token Budget | Model Tier | Parallel Agents |
|-----------|---------------|-------------|-----------|----------------|
| trivial | 3 | 8K | fast | 0 |
| simple | 8 | 20K | fast | 0 |
| moderate | 15 | 50K | standard | 1 |
| complex | 30 | 100K | standard | 2 |
| massive | 50 | 200K | deep | 3 |

**Comparison:** Claude Code uses ML-based permission classification (auto-accept mode). YUAN uses a pure deterministic decision engine — zero LLM calls for routing. This is **faster, cheaper, and more predictable** but less nuanced than Claude Code's approach. The trade-off is clear: YUAN trades contextual understanding for deterministic reliability.

**Failure Surface computation** uses YUA's "risk balance" formula from their FSLE (Failure Surface Likelihood Estimation):
```
risk_balance = (tau + fp_cost) / fn_cost
// FP cost (unnecessary caution) = 0.3
// FN cost (missed bug) = 0.7
// Result: ~1.14 — slightly risk-averse
```

### 6.5 Tool System

**15 built-in tools** (via `@yuaone/tools`):

| Tool | Risk Level | Category |
|------|-----------|----------|
| `file_read` | low | File ops |
| `file_write` | medium | File ops |
| `file_edit` | medium | File ops |
| `shell_exec` | medium | Execution |
| `bash` | medium | Execution |
| `grep` | low | Search |
| `glob` | low | Search |
| `git_ops` | low-medium | Version control |
| `test_run` | low | Verification |
| `code_search` | low | Search (AST) |
| `security_scan` | low | Analysis |
| `web_search` | low | External |
| `parallel_web_search` | low | External |
| `browser_tool` | medium | Design (Playwright) |
| `task_complete` | low | Control flow |

Plus **Design Mode tools**: DesignSnapshotTool, DesignScreenshotTool, DesignNavigateTool, DesignResizeTool, DesignInspectTool, DesignScrollTool (all Playwright-based).

**Tool architecture:**
```
BaseTool (abstract)
  ├── name, description, parameters (ParameterDef map)
  ├── riskLevel: 'low' | 'medium' | 'high'
  ├── requiresApproval: derived from riskLevel !== 'low'
  ├── validatePath(path, workDir) — path traversal defense
  ├── truncateOutput(output) — size limits
  ├── toJsonSchema() — ParameterDef → JSON Schema for LLM
  ├── toDefinition() — full ToolDefinition for LLM consumption
  ├── ok(toolCallId, output) → ToolResult
  └── fail(toolCallId, error) → ToolResult

ToolRegistry
  ├── register(tool) / registerAll(tools)
  ├── toDefinitions() — all tools → LLM format
  ├── execute(name, args, workDir) → ToolResult
  ├── executeWithSignal(name, args, workDir, abortSignal)
  └── toExecutor(workDir) → ToolExecutor adapter (core-compatible)
```

**Comparison with Claude Code:**
- Claude Code: 40+ tools, Zod schema validation, permission checking integrated into tool execution, deferred tool system for lazy-loading tool schemas
- YUAN: 15 core tools (+6 design tools), JSON Schema validation, risk-based approval, simpler BaseTool pattern
- Claude Code's tool system is more mature (deferred tools, Zod, tighter permission integration) but YUAN's BaseTool → ToolRegistry → ToolExecutor pipeline is cleaner and easier to extend

### 6.6 Prompt Architecture

YUAN uses a **3-layer prompt envelope** inspired by Gemini's U-curve attention pattern:

```
┌─────────────────────────────────────┐
│ FRONT (highest LLM attention)        │
│  ┌─────────────────────────────────┐ │
│  │ SystemCore (immutable)          │ │
│  │ - Identity, core rules, safety  │ │
│  │ - Korean 반말 requirement       │ │
│  │ - Tool usage rules, edit scope  │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ RuntimePolicy (decision-based)   │ │
│  │ - Execution mode (FAST/NORMAL/   │ │
│  │   DEEP/SUPERPOWER/COMPACT)      │ │
│  │ - Next action contract           │ │
│  │ - Tool budget hints              │ │
│  │ - Veto flags                     │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Role (decision-based)            │ │
│  │ - Specialist role injection       │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ TaskContext (per-run)            │ │
│  │ - Plan context, changed files,   │ │
│  │   project context                │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Ephemeral (per-iteration)        │ │
│  │ - Stall warnings, failure hints,  │ │
│  │   impact reports                  │ │
│  └─────────────────────────────────┘ │
│                                     │
│ [Conversation history + tool results]│
│                                     │
│ BACK (U-curve second attention peak) │
│  ┌─────────────────────────────────┐ │
│  │ Reinforce (immutable)            │ │
│  │ - Repeated critical rules        │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Token budgets by model:**
| Model | Context | System % | Conversation % | Tool Results % | Output % |
|-------|---------|---------|---------------|----------------|---------|
| Gemini | 32K | 25% (8K) | 40% (12.8K) | 20% (6.4K) | 15% (4.8K) |
| Claude | 200K | 15% (30K) | 45% (90K) | 25% (50K) | 15% (30K) |
| OpenAI | 128K | 20% (25.6K) | 40% (51.2K) | 25% (32K) | 15% (19.2K) |

**PromptRuntime** is the sole place that decides what goes into the prompt. It:
1. Consumes `DecisionContext` ONLY (no new decisions)
2. Produces `PromptEnvelope` (structured sections with priority)
3. Delegates to `PromptBuilder` for final string assembly

**Comparison:** Claude Code uses a modular assembly with CACHEABLE/DYNAMIC boundary for prompt caching. YUAN uses a priority-based section system with FRONT/BACK U-curve positioning. Claude Code's approach is optimized for Anthropic's prompt caching; YUAN's is optimized for cross-provider attention patterns.

**Korean 반말 requirement** is unique to YUAN — the system prompt mandates informal Korean when the user speaks Korean, with specific banned polite forms. This is a deliberate UX choice.

### 6.7 Context Management

`ContextManager` — token estimation and multi-layer compression.

**Token estimation:** ~4 chars/token (English), ~2 chars/token (Korean/CJK), with LRU message-level caching.

**Compression layers (in order of fallback):**
1. **ContextCompressor** — priority-based compression (preserves recent, compresses old tool results)
2. **compactHistory()** — sliding window: keep last 5 iterations raw, summarize iterations 6-15
3. **emergencyTrim()** — hard truncate to fit within budget

```
Default config:
  recentWindow: 5  (keep raw)
  summaryWindow: 10  (summarize tool results)
  outputReserve: 8192 tokens
```

**Tool result size limits:**
| Tool | Max bytes |
|------|----------|
| file_read | 50 KB |
| shell_exec | 100 KB |
| grep | 10 KB |
| glob | 5 KB |
| test_run | 20 KB |

**Comparison:** Claude Code has 7 context management layers (token budget, microcompact, auto-compact, history snip, context collapse, prompt cache, deferred tools). YUAN has 3 layers (compressor, compact, emergency trim). Claude Code's system is more sophisticated but YUAN's is simpler and sufficient for most use cases.

### 6.8 Permission & Security

**Governor** — execution limits and safety validation.

**Plan tier limits:**
| Tier | Max Iterations | Token Budget | Session TTL | Parallel Agents |
|------|---------------|-------------|------------|----------------|
| LOCAL | 200 | ∞ | 24h | ∞ |
| FREE | 5 | 20K | 5 min | 1 |
| PRO | 25 | 72K | 30 min | 3 |
| BUSINESS | 50 | 140K | 2h | 7 |
| ENTERPRISE | 100 | 240K | 8h | 20 |
| MAX | 200 | ∞ | 24h | ∞ |

**ApprovalManager** — event-driven approval flow:
```
Governor detects risk → ApprovalManager.needsApproval() → emit event
  → CLI shows [Allow] [Always Allow] [Deny] prompt
  → User response → continue or abort
```

**Tool approval rules:**
- `file_write` with `overwrite=true` → medium risk
- `shell_exec` with `npm install / pip install` → medium risk
- `shell_exec` (generic) → high risk
- `git_ops push` → critical risk
- Config file modifications → medium risk

**Security (SSOT in `security.js`):**
- **BLOCKED_EXECUTABLES:** sudo, vim, ssh, curl, wget, docker, bash, sh, zsh, env, xargs, nohup, gdb, strace... (70+ blocked)
- **DANGEROUS_ARG_PATTERNS:** `rm -rf`, `chmod 777`, `git push`, `git reset --hard`...
- **SENSITIVE_FILE_PATTERNS:** .env, credentials, private keys...
- **Safe verify commands** (auto-approved): typecheck, lint, test commands with no destructive side effects
- **Path traversal defense** in BaseTool.validatePath()

**Comparison:** Claude Code has 4 permission modes (default, auto/ML, bypass, plan) with LOW/MEDIUM/HIGH risk classification. YUAN has a simpler approval system but more aggressive security blocking (70+ blocked executables vs Claude Code's more permissive approach). YUAN's BYOK model means it can't use ML-based auto-permission since it supports multiple providers.

### 6.9 Multi-Agent & Sub-Agents

**SubAgent** — independent agent instances for bounded subtasks.

```
Lifecycle: SPAWN → INIT → EXECUTE → VALIDATE → REPORT → CLEANUP

Roles:
  coder    → writes code (mapped from "specialist")
  reviewer → reviews for issues (mapped from "critic")
  tester   → checks correctness (mapped from "verifier")
```

Each SubAgent creates its own `AgentLoop` internally, scoped to:
- **Target files** (write access limited to these)
- **Read files** (read-only reference set)
- **Tool subset** (only allowed tools)
- **Max iterations** (independent budget)
- **Language/framework auto-detection**

**spawn_sub_agent** tool — LLM can spawn sub-agents at runtime:
```json
{
  "name": "spawn_sub_agent",
  "parameters": {
    "goal": "string (required)",
    "role": "coder | critic | verifier | specialist"
  },
  "riskLevel": "medium"
}
```

**BackgroundAgentManager** — manages background agents that run independently.

**Comparison:** Claude Code's multi-agent system includes Coordinator mode, teams/swarm, and task types (bash/agent/teammate/workflow) with worktree isolation. YUAN's sub-agent system is simpler (4 roles) but includes auto-detection of language/framework and scoped file access. Claude Code's approach is more production-hardened.

### 6.10 Advanced Features

**Features unique to YUAN (not in Claude Code):**

| Feature | Description |
|---------|------------|
| **Decision Engine** | Pure deterministic routing — no LLM call needed |
| **WorldModel** | StateStore + TransitionModel + SimulationEngine for predicting plan outcomes |
| **HierarchicalPlanner** | 3-level: Strategic (flagship model) → Tactical (premium) → Operational (standard) |
| **StrategyMarket** | Economic model for selecting strategies based on past success |
| **CapabilityGraph** | Graph of tool capabilities and their relationships |
| **CapabilitySelfModel** | Agent's model of its own abilities |
| **TrustEconomics** | Economic model for trust decisions |
| **ReflexionEngine** | Verbal reinforcement learning (from Reflexion paper) |
| **DebateOrchestrator** | Multi-perspective review by playing devil's advocate |
| **FailureSignatureMemory** | Remembers past failure patterns to avoid repeats |
| **CausalChainResolver** | Traces root causes through chains of evidence |
| **PlaybookLibrary** | Stored playbooks for common task patterns |
| **StallDetector** | Detects when the agent is stuck in loops |
| **PatchTransaction** | Journal of all file patches with rollback support |
| **SemanticDiffReviewer** | AI-powered diff review before committing |
| **WorkspaceMutationPolicy** | Controls what the agent can mutate |
| **SkillLearner** | Learns new skills from user interactions |
| **MetaLearningEngine** | Meta-learning across sessions |
| **ToolSynthesizer** | Dynamically creates tool compositions |
| **VisionIntentDetector** | Auto-triggers image reads when LLM signals intent |
| **PersonaManager** | Learns user communication style |
| **35 built-in skills** | Language-specific + domain-specific auto-activation |
| **Design Mode** | Playwright-based live design collaboration |
| **BYOK multi-provider** | OpenAI + Anthropic + Google + YUA platform |

**Features in Claude Code but NOT in YUAN:**

| Feature | Description |
|---------|------------|
| **Prompt caching** | Claude-specific prompt cache optimization |
| **Deferred tools** | Lazy-loading tool schemas to save context |
| **Worktree isolation** | Git worktree for sub-agent isolation |
| **Dream system** | Background memory consolidation with 3-gate trigger |
| **Hook system** | 27 lifecycle events with user-defined hooks |
| **Buddy system** | Tamagotchi-like gamification |
| **Anti-distillation** | Leaked source protections |

### 6.11 YUAN vs Claude Code Comparison

| Dimension | Claude Code | YUAN |
|-----------|------------|------|
| **LOC** | ~800K | ~67K (est. from 3 packages) |
| **Modules** | ~1902 files | ~170 modules |
| **Tool count** | 40+ | 15 (+6 design mode) |
| **LLM support** | Anthropic only | OpenAI + Anthropic + Google + YUA |
| **Decision routing** | ML-based (auto-accept mode) | Pure deterministic (Decision Engine) |
| **Context mgmt layers** | 7 | 3 |
| **Permission modes** | 4 (default/auto/bypass/plan) | 2 (auto/manual) |
| **Blocked executables** | ~20 | ~70 |
| **Sub-agent roles** | bash/agent/teammate/workflow | coder/reviewer/tester/specialist |
| **Sub-agent isolation** | Git worktree | File scope only |
| **Planning** | Implicit (via prompt) | Explicit (3-level HierarchicalPlanner) |
| **Memory** | Dream system (background consolidation) | YuanMemory + vector store |
| **Hooks** | 27 lifecycle events | None (overridable via plugins) |
| **MCP** | First-class | Built-in pure TypeScript client |
| **Skill system** | Via hooks/slash commands | 35 built-in skills + plugins |
| **Design mode** | No | Yes (Playwright) |
| **Open source** | Yes | AGPL-3.0 (open core) |
| **SWE-bench** | Competitive | Unknown |
| **System prompt size** | ~30K tokens (estimated) | ~5K tokens (SYSTEM_CORE alone) |

#### Architectural Assessment

**YUAN's strengths:**
1. **Decision Engine is brilliant** — zero-cost, zero-latency routing without LLM calls. This should be copied by every harness.
2. **Multi-provider BYOK** — practical advantage over Claude Code's Anthropic lock-in
3. **HierarchicalPlanner** — explicit 3-level planning is more reliable than implicit "figure it out" prompting
4. **Risk-averse failure surface** — quantitative risk computation (patchRisk, blastRadius, etc.) is more principled than heuristic rules
5. **Extensive self-improvement subsystems** — Reflexion, Debate, MetaLearning, StrategyMarket show ambition
6. **Clean tool pipeline** — BaseTool → ToolRegistry → ToolExecutor is simple and extensible
7. **Security SSOT** — single `security.js` file for all safety rules avoids duplication

**YUAN's weaknesses:**
1. **God class AgentLoop** — 99 direct imports, ~330 instance variables. This is an unmaintainable monolith. Claude Code's `QueryDeps` dependency injection pattern is far superior.
2. **Feature bloat** — WorldModel, SimulationEngine, TrustEconomics, StrategyMarket, CapabilitySelfModel... Many of these are research concepts that likely add overhead without proportional reliability gains. The mini-SWE-agent proved that ~100 lines can achieve 74% SWE-bench.
3. **No hook system** — Claude Code's 27 lifecycle hooks allow user customization without modifying core. YUAN's plugin system is less granular.
4. **Context management is thin** — 3 layers vs Claude Code's 7. Will struggle with long sessions on large codebases.
5. **No prompt caching** — Significant cost disadvantage for Anthropic users.
6. **No worktree isolation** — Sub-agents share the filesystem. Risk of conflicts.
7. **Unproven at scale** — No published benchmarks. Claude Code has been battle-tested by thousands of users.

**Verdict:** YUAN is the most architecturally ambitious open-source agent harness. Its **Decision Engine** is a genuine innovation that the industry should adopt. However, it suffers from "second system syndrome" — too many subsystems, too little integration testing. For building a production harness, take YUAN's Decision Engine + security SSOT + HierarchicalPlanner concepts, but use Claude Code's dependency injection + context management + hook patterns.

---

## 7. Key Harness Components Reference

### 6.1 The Agentic Loop

**Pattern A: Fixed Loop** (simple, fragile)
```python
while not done:
    response = llm(messages, tools)
    if response.has_tool_calls:
        for tool_call in response.tool_calls:
            result = execute(tool_call)  # with guardrails
            messages.append(tool_result)
    else:
        done = True
```

**Pattern B: Graph-Based** (robust, auditable)
```
[agent node] → [has tool calls?] → yes → [tools node] → [agent node]
                                → no  → (END)
Error paths modeled as explicit nodes
```

**Pattern C: Task Queue** (checkpoints, loss of flexibility)
```
plan = generate_plan(task)
for step in plan:
    result = execute(step)
    plan = maybe_revise_plan(plan, step, result)
```

### 6.2 Tool Calling Management

| Concern | Harness Strategy |
|---------|-----------------|
| Invalid arguments | Validate against JSON Schema before execution |
| Non-existent tool | Return error: "Tool X does not exist. Available: [...]" |
| Parallel calls | Execute concurrently where safe, sequentially when ordered |
| Timeout | Per-tool timeout (30s-120s). On timeout, return error to LLM |
| Side effects | Track idempotency — some tools safe to retry, others not |
| Large output | Truncate to token budget, persist full output to disk |

### 6.3 Context Window Management

```
Strategies (ordered by complexity):

1. Sliding window — keep last N messages, drop oldest (simplest)
2. Token budget — count tokens, compress when approaching limit
3. Hierarchical summarization — periodic LLM-powered compression
4. Selective retention — keep messages by relevance (embedding similarity)
5. State-based — replace raw messages with typed state (LangGraph)
```

**Claude Code's approach:** Layers 2-5 combined. Most sophisticated in production.

### 6.4 Error Handling

| Error Type | Recovery Strategy |
|-----------|-------------------|
| Rate limit (429) | Exponential backoff with jitter, max 3-5 retries |
| Malformed tool args | Feed error to LLM — self-correction is remarkably effective |
| Tool execution failure | Return structured error, optionally retry transient errors |
| Context overflow | Trigger compression, never silently truncate |
| Guardrail violation | Block output, return violation message to LLM |
| Budget exceeded | Force termination, return partial result with explanation |

### 6.5 Guardrails

**Input:** Prompt injection detection, content policy, schema validation
**Output:** Hallucination detection, PII redaction, toxicity filtering, code safety
**Runtime:** Max iterations, max tool calls per step, approval gates, budget limits, network restrictions

### 6.6 Cost Management

- Per-run budget: Hard dollar/token limit per run
- Per-step tracking: Display cumulative cost
- Model tiering: Cheap model for routine decisions, expensive model for complex reasoning
- Caching: Prompt caching reduces cost 50-90% for repeated prefixes
- Early termination: Detect repeated tool calls (no progress), force stop

---

## 8. Common Failure Modes & Mitigations

### Infinite Loops
**Cause:** LLM retries same tool call with same arguments, getting same error.
**Fix:** Max iteration count (25-50). Progress detection — if last N iterations produced no new info, terminate. Repeated action detection with cache.

### Context Overflow
**Cause:** Conversation history exceeds model's context window.
**Fix:** Proactive token counting. Trigger compression BEFORE hitting the limit. Tool result truncation. Separate scratchpad from essential context.

### Hallucinated Tool Calls
**Cause:** LLM generates tool name that doesn't exist, or wrong arguments.
**Fix:** Tool name validation. Argument schema validation. Few-shot examples in tool descriptions. Precise, specific tool descriptions.

### Task Drift
**Cause:** Agent gradually moves away from original task.
**Fix:** Task anchoring — periodically remind of original task. Progress checks. Plan-based execution with deviation detection. Hierarchical oversight via manager agent.

### Permission Escalation
**Cause:** Agent attempts operations beyond authorized scope.
**Fix:** Tool-level permissions. Sandboxing (Docker/Firecracker). Approval gates. Path traversal prevention. Network allowlists. Audit logging.

### Cost Overruns
**Cause:** Runaway agent in open-ended loop.
**Fix:** Hard per-run budget. Per-step cost display. Model tiering. Caching. Cost prediction before each LLM call.

---

## 9. How to Build Your Own Harness

### Minimal Viable Harness (~200 lines)

```python
# agent.py - The simplest possible coding agent harness

import os, json, subprocess
from anthropic import Anthropic

client = Anthropic()

tools = [
    {"name": "bash", "description": "Run a shell command",
     "input_schema": {"type": "object", "properties": {
         "command": {"type": "string", "description": "The command to run"}},
         "required": ["command"]}},
    {"name": "read_file", "description": "Read a file",
     "input_schema": {"type": "object", "properties": {
         "path": {"type": "string"}, "offset": {"type": "integer"}, "limit": {"type": "integer"}},
         "required": ["path"]}},
    {"name": "write_file", "description": "Write to a file",
     "input_schema": {"type": "object", "properties": {
         "path": {"type": "string"}, "content": {"type": "string"}},
         "required": ["path", "content"]}},
    {"name": "edit_file", "description": "Replace a string in a file",
     "input_schema": {"type": "object", "properties": {
         "path": {"type": "string"}, "old_string": {"type": "string"},
         "new_string": {"type": "string"}},
         "required": ["path", "old_string", "new_string"]}},
]

def execute_tool(name, args):
    if name == "bash":
        result = subprocess.run(args["command"], shell=True, capture_output=True, text=True, timeout=120)
        return result.stdout[:10000] + (f"\n[STDERR: {result.stderr[:2000]}]" if result.stderr else "")
    elif name == "read_file":
        with open(args["path"]) as f:
            lines = f.readlines()
            start = args.get("offset", 0)
            end = start + args.get("limit", 2000)
            return "".join(lines[start:end])
    elif name == "write_file":
        with open(args["path"], "w") as f:
            f.write(args["content"])
        return f"Wrote {len(args['content'])} chars to {args['path']}"
    elif name == "edit_file":
        with open(args["path"]) as f:
            content = f.read()
        if args["old_string"] not in content:
            return f"ERROR: old_string not found in {args['path']}"
        content = content.replace(args["old_string"], args["new_string"], 1)
        with open(args["path"], "w") as f:
            f.write(content)
        return f"Edited {args['path']}"
    return f"Unknown tool: {name}"

def run(task, max_turns=25):
    messages = [
        {"role": "user", "content": task},
        {"role": "assistant", "content": "Understood. Let me start by exploring the codebase."},
    ]
    system = """You are a coding assistant. You have access to bash, read_file, write_file, and edit_file tools.
Work step by step. Read files before editing them. Be careful with destructive operations."""

    for turn in range(max_turns):
        response = client.messages.create(
            model="claude-sonnet-4-6", max_tokens=8192,
            system=system, tools=tools, messages=messages)

        # Add assistant response
        messages.append({"role": "assistant", "content": response.content})

        # Process tool calls
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            # Final text response — done
            text = "".join(b.text for b in response.content if b.type == "text")
            print(f"\n[Agent done in {turn+1} turns]")
            return text

        # Execute each tool and add results
        for tool_use in tool_uses:
            result = execute_tool(tool_use.name, tool_use.input)
            messages.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": tool_use.id, "content": result}
            ]})
            print(f"  [{tool_use.name}] → {result[:100]}...")

    return f"[Max turns ({max_turns}) reached]"
```

### Production Harness Checklist

To go from the minimal version to production reliability, add:

- [ ] **Context management** — Token counting, auto-compaction, prompt caching
- [ ] **Permission system** — Ask/allow/deny per tool, pattern-based rules
- [ ] **Error recovery** — Retry with backoff, LLM self-correction, fallback models
- [ ] **Budget enforcement** — Token and dollar limits, cost tracking
- [ ] **Timeout/cancellation** — Per-tool, per-turn, and per-run timeouts; graceful shutdown
- [ ] **State persistence** — Session resume, transcript storage
- [ ] **Git integration** — Auto-commit, diff review, branch management
- [ ] **Prompt engineering** — Modular system prompt, CLAUDE.md-style project instructions
- [ ] **Memory system** — Cross-session persistence, auto-consolidation
- [ ] **Hook system** — Pre/post tool execution middleware
- [ ] **MCP support** — Dynamic tool loading from external servers
- [ ] **Multi-agent** — Sub-agents for parallel execution
- [ ] **Observability** — Logging, tracing, cost dashboards
- [ ] **Sandboxing** — Docker/namespace isolation for untrusted code

### Architecture Principles (from research synthesis)

1. **Bounded execution is non-negotiable.** Max iterations, max time, max cost.
2. **The harness is the safety layer, not the LLM.** Enforce constraints programmatically.
3. **Context management is the hardest problem.** Compress before overflow, not after.
4. **Tool design matters more than prompt design.** Invest in tool quality.
5. **Observability is essential.** Log every LLM call and tool invocation.
6. **Graceful degradation over hard failure.** Return useful errors to the LLM.
7. **Structured workflows for predictable tasks, agentic loops for exploratory tasks.**

---

## 10. Comparative Architecture Table

| Feature | Claude Code | Aider | mini-SWE-agent | OpenHands | Cline | YUAN |
|---------|-------------|-------|----------------|-----------|-------|------|
| **Interface** | Terminal | Terminal | Terminal/Python | Web/CLI/SDK | VS Code | Terminal (TUI) |
| **Tool API** | Anthropic tool_use | XML parsing | Text parsing | LiteLLM (multi) | Anthropic/OpenAI | OpenAI SDK (multi) |
| **Sandbox** | None (local) | None (local) | subprocess/docker | Docker (required) | None (local) | None (local) |
| **Edit method** | SEARCH/REPLACE | SEARCH/REPLACE | Bash commands | File ops + Bash | Diff view | file_edit tool |
| **Context mgmt** | 7-layer system | Tree-sitter map | Linear history | EventStream | @mentions + AST | 3-layer compress |
| **Git integration** | Deep (auto) | Deep (auto) | Manual (bash) | Manual (bash) | None built-in | git_ops tool |
| **MCP support** | Yes (first-class) | No | No | No | Yes | Yes (built-in) |
| **Human-in-loop** | Configurable | Always (terminal) | Configurable | Configurable | Always (GUI) | Configurable |
| **Multi-agent** | Yes (subagents) | No | No | Yes | No | Yes (sub-agents) |
| **Memory** | Dream system | N/A | N/A | N/A | N/A | YuanMemory + RAG |
| **Open source** | Yes | Yes | Yes | Yes | Yes | AGPL-3.0 |
| **SWE-bench** | Competitive | N/A | 74% | 77.6% | N/A | Unknown |
| **LOC** | ~800K | ~30K | ~100 (agent) | ~100K | ~50K | ~67K |

---

## 11. Browser Portability Analysis (almostnode)

> **Context:** The kanban-jules-review project (Fleet) runs agent code in-browser using `almostnode` — a Node.js runtime shim for browsers that provides a virtual filesystem (VFS), `npm install`, `container.execute()`, and `container.run()` (basic shell). YUAN CLI was chosen because it loads in almostnode with minimal shimming (~1 shim: openai). This section analyzes how feasible it would be to port OTHER agent harnesses to almostnode.

### 11.1 What almostnode Provides (and Doesn't)

| Capability | Status | Notes |
|-----------|--------|-------|
| `require()` / CommonJS | Full support | Module resolution, node_modules |
| Virtual filesystem (VFS) | Full support | `fs.readFileSync/writeFileSync` etc. — all in-memory |
| `path`, `os`, `util` | Supported | Polyclone shims |
| `npm install` | Supported | `container.npm.install('pkg')` — fetches and extracts into VFS |
| Shell execution | Partial | `container.run('echo hi')` — very basic, not full bash |
| `process.cwd()`, `process.env` | Supported | Minimal shims |
| `http` / `fetch` | Browser-native | Works via browser's fetch |
| **`child_process.spawn`** | NOT supported | Major gap — no subprocess spawning |
| **`node:child_process`** | NOT supported | Only `exec`-like via `container.run()` |
| **`node:net` / `node:tls`** | NOT supported | No raw TCP/UDP sockets |
| **`node:fs` (real)** | NOT supported | VFS only, no real disk access |
| **`node:crypto`** | NOT supported | Would need Web Crypto shim |
| **`node:events`** | Partial | almostnode polyfills some, but not all EventEmitter methods |
| **Native binaries (`.node`)** | NOT supported | No FFI — kills `node-pty`, `playwright`, `esbuild.native` |
| **Worker threads** | NOT supported | No `worker_threads` module |
| **WebSocket** | Browser-native | Available via global `WebSocket` |

**Key insight:** almostnode is designed for pure-JS npm packages that do file I/O and computation. It breaks on anything that spawns processes, opens network sockets, or loads native binaries.

### 11.2 YUAN's Portability Profile (Baseline)

YUAN works in almostnode with **one shim** (openai → bridge to `boardVM.llmfs.sendRequest()`). Here's why:

**What YUAN uses that almostnode handles:**
- `node:fs` → VFS (file operations work transparently)
- `node:path`, `node:os`, `node:util` → polyfilled by almostnode
- `node:events` → polyfilled (EventEmitter works)
- `node:crypto` → used for hashing; can be stubbed or shimmed with Web Crypto
- `openai` npm package → replaced with thin shim that bridges to browser LLM

**What YUAN uses that almostnode CANNOT handle (but these are optional/pluggable):**
- `node-pty` (ShellExecTool) — used for interactive terminal, **not required** for core agent loop
- `playwright` (BrowserTool) — used for browser automation, **not required** for core agent loop
- `node:child_process` (MCPClient) — used for MCP stdio transport, **not required** for basic operation
- `chokidar` (file watching) — uses `node:fs` events, can be stubbed
- `ts-morph` (AST analysis) — pure JS after npm install, may work

**Portability score: 8/10.** The core agent loop (AgentLoop → DecisionEngine → ToolRegistry → LLM API) is pure JS with no native deps. The tools that need native access are isolated behind the tool registry and can be swapped out.

**Shim inventory:**
| Shim | Complexity | Purpose |
|------|-----------|---------|
| `openai/index.js` | ~30 lines | Route LLM calls through `boardVM.llmfs.sendRequest()` |
| `node:crypto` | ~10 lines | Stub or bridge to `crypto.subtle` |
| `chokidar` | ~5 lines | Stub (no-op file watcher) |
| `node-pty` | Skip | Don't use ShellExecTool |
| `playwright` | Skip | Don't use BrowserTool |

### 11.3 Portability Assessment: Each Harness

#### Claude Code

**Verdict: IMPOSSIBLE (1/10)**

Claude Code is ~800K LOC of deeply integrated Node.js/TypeScript with hard dependencies on:
- `node:child_process` (spawn) — used constantly for running tools, sub-agents, git, tests
- `node:fs` (real filesystem) — operates on actual project files
- `node:net` / `node:tls` — MCP server/client stdio transport
- `node:crypto` — signing, hashing throughout
- Native binaries — esbuild native binding for fast compilation
- `worker_threads` — parallel processing
- VS Code extension API — for IDE integration

**Why not:** Claude Code IS a Node.js CLI tool. It doesn't have a clean separation between "agent logic" and "system access." The tool execution model is literally `child_process.spawn()`. You'd need to rewrite ~60% of the codebase to even attempt it.

**Minimum shims needed:** 15+. `child_process.spawn`, `child_process.exec`, `node:fs` (redirect to VFS), `node:net`, `node:crypto`, `node:tls`, `worker_threads`, `node:os`, git binary, shell binary, esbuild native, pty native, etc.

**Alternative approach:** Run Claude Code in a v86 VM (see kanban-jules-review's WASM VM approach) with a full Linux userspace. This sidesteps almostnode entirely — the VM provides real Node.js. This is what Fleet's `executor-wasm` module explores.

#### Aider

**Verdict: VERY HARD (2/10)**

Aider is Python, not Node.js. almostnode only runs JavaScript.

**Blockers:**
- Language mismatch — Aider is ~30K LOC of Python
- Requires `subprocess.run` for every git operation and file edit
- Requires `tree-sitter` native binary for repo map generation
- Requires real filesystem access (it edits actual project files)
- Requires actual git binary on PATH

**Alternative:** Could run Aider inside v86 VM (Python + git pre-installed). But this is running a full OS, not porting Aider to almostnode.

#### mini-SWE-agent

**Verdict: VERY HARD (2/10)**

Also Python (~100 lines of agent code, but depends on SWE-agent environment).

**Blockers:**
- Language mismatch
- Every action is `subprocess.run()` — runs arbitrary bash commands
- Requires Docker or similar sandbox for safety
- The beauty of mini-SWE-agent is its use of bash as the universal action space — but bash doesn't exist in almostnode

**`container.run()` gap:** almostnode's `container.run()` is a very basic shell, not bash. It can't pipe, redirect, run scripts, or access environment variables reliably. mini-SWE-agent needs real bash.

#### OpenHands

**Verdict: IMPOSSIBLE (1/10)**

OpenHands requires Docker as a mandatory runtime sandbox. It runs agents inside Docker containers.

**Blockers:**
- Python backend (FastAPI server)
- Docker SDK (Python `docker` package) for container management
- Requires real Docker daemon
- EventStream architecture assumes persistent server-side state
- WebSocket server for real-time updates
- Enterprise features (RBAC, multi-user) require real infrastructure

OpenHands is architecturally a server application, not a library you can embed.

#### Cline

**Verdict: VERY HARD (3/10)**

Cline is a VS Code extension (TypeScript/Node.js), which is closer to almostnode's domain, but:

**Blockers:**
- VS Code Extension API — deeply integrated (`vscode.workspace`, `vscode.window`, etc.)
- `child_process.spawn` — for running terminal commands
- `node:fs` — real filesystem access for file edits
- MCP client uses `child_process.spawn` for stdio transport
- Claude Computer Use requires screen capture (native APIs)

**If you extracted just the agent loop:** The core loop (LLM call → parse response → execute tool → loop) is ~500 LOC and could theoretically be extracted. But the tool implementations all assume Node.js system access. You'd need to rewrite every tool.

#### Open Source Frameworks (LangGraph, CrewAI, AutoGen, etc.)

**Verdict: IMPOSSIBLE (1/10)**

All major agent frameworks are Python. Almostnode only runs JavaScript.

**Notable exception — OpenAI Agents SDK (TypeScript):**
- Pure TypeScript, could theoretically be `npm install`'d into almostnode
- Uses `openai` npm package (needs shim like YUAN's)
- Minimal system access requirements
- **BUT:** It's a framework, not a harness. You'd need to build the tool system, context management, permission system, etc. yourself
- **Portability score: 6/10** — the SDK itself ports easily, but it doesn't do anything useful without tools

### 11.4 Portability Comparison Matrix

| Harness | Language | `node:` imports | Native deps | Spawn deps | Shim count | Score |
|---------|----------|----------------|-------------|------------|------------|-------|
| **YUAN** | TypeScript | 7 (all polyfillable) | 2 (optional) | 1 (MCP) | 1 required | **8/10** |
| **OpenAI Agents SDK** | TypeScript | 0-1 | 0 | 0 | 1 (openai) | **6/10** |
| **Cline (extracted loop)** | TypeScript | 5+ | 0-1 | 3+ | 5-8 | **3/10** |
| **Claude Code** | TypeScript/JS | 10+ | 3+ | constant | 15+ | **1/10** |
| **Aider** | Python | N/A | 2+ | constant | N/A | **2/10** |
| **mini-SWE-agent** | Python | N/A | 1+ | constant | N/A | **2/10** |
| **OpenHands** | Python | N/A | Docker SDK | Docker | N/A | **1/10** |
| **CrewAI/LangGraph/AutoGen** | Python | N/A | varies | varies | N/A | **1/10** |

### 11.5 Why YUAN Wins at Portability

YUAN's architecture has several properties that make it unusually portable:

**1. OpenAI SDK as the LLM abstraction layer.**
YUAN uses the `openai` npm package exclusively for LLM calls. This is a single point of interception — replace one package with a ~30-line shim and ALL LLM providers work through the browser bridge. Other harnesses that use `@anthropic-ai/sdk` directly, or raw `fetch()`, or multiple SDKs, need multiple shims.

**2. Tool registry with pure-JS tools.**
YUAN's 15 built-in tools inherit from `BaseTool` and most use only `node:fs` (via VFS). The two that need native access (`ShellExecTool` → `node-pty`, `BrowserTool` → `playwright`) are cleanly separated and can be disabled. In contrast, Claude Code and Cline have tools that directly call `spawn()` as part of their core implementation.

**3. Decision Engine is stateless and pure.**
YUAN's `DecisionEngine` takes structured input and returns structured output — no I/O, no side effects, no external calls. It runs perfectly in any JS runtime.

**4. Event-driven architecture (not process-driven).**
YUAN uses `EventEmitter` rather than spawning subprocesses for orchestration. Sub-agents are created in-process, not via `child_process.fork()`. This means the entire multi-agent system runs in a single almostnode container.

**5. No Python, no Docker, no external binaries.**
The entire stack is TypeScript → npm → almostnode. No requirement for a Python runtime, Docker daemon, git binary, or any other external tool.

### 11.6 Portability Gaps and Potential Shims

Even for YUAN, there are gaps. Here's the full shim inventory for a production deployment:

#### Already Solved

| Gap | Solution | Status |
|-----|----------|--------|
| LLM API calls | openai shim → `boardVM.llmfs.sendRequest()` | Working in test page |
| Virtual filesystem | almostnode VFS | Working |

#### Solvable with Small Shims

| Gap | Solution | Complexity |
|-----|----------|------------|
| `node:crypto` | Bridge to `crypto.subtle` (Web Crypto API) | ~20 lines |
| `chokidar` (file watch) | Stub: `new EventEmitter()` with no-op `watch()` | ~10 lines |
| `node:events` (gaps) | Polyfill missing EventEmitter methods | ~15 lines |
| `node:os` (gaps) | Return static values (platform: 'browser') | ~5 lines |
| `node:buffer` | almostnode may already polyfill; if not, use Uint8Array shim | ~10 lines |

#### Requires Architecture Decisions

| Gap | Solution | Complexity |
|-----|----------|------------|
| `child_process` (MCP) | WebSocket-based MCP transport instead of stdio | Medium — protocol change |
| Shell execution | Use `container.run()` or bridge to v86 VM via WISP | Medium — architectural |
| `ts-morph` (AST) | Test if pure-JS version works after npm install; if not, use lighter parser | Low-Medium |
| Persistent state | almostnode VFS is in-memory; bridge to IndexedDB for persistence | Medium |

#### Not Solvable in almostnode

| Gap | Reason | Alternative |
|-----|--------|-------------|
| `node-pty` (real terminal) | Native binary, needs real PTY | Use xterm.js + v86 VM or container.run() |
| `playwright` (browser) | Downloads Chromium binary | Use browser's own DOM or bridge to v86 |
| `worker_threads` | Browser has Workers but not Node's worker_threads | Rewrite to use Web Workers |
| `node:net` / raw TCP | No raw sockets in browser | Use WISP relay (WebSocket → TCP) |

### 11.7 The Fleet Integration Path

The kanban-jules-review project (Fleet) has TWO execution strategies, which map to two portability tiers:

**Tier 1: almostnode (pure JS, in-browser)**
```
Browser → almostnode container → YUAN core → VFS tools → LLM via openai shim
                                                         ↓
                                              boardVM.llmfs.sendRequest()
```
- Good for: File analysis, code generation, planning, simple edits
- Current status: Working (test-yuan-almostnode.html passes phases 1-5)

**Tier 2: v86 VM (full Linux, in-browser via WASM)**
```
Browser → v86 WASM emulator → Linux userspace → Real Node.js → Any harness
                                        ↓
                               WISP relay → server.ts → TCP to internet
```
- Good for: Running git, bash, Python, Docker, any native tool
- Current status: Infrastructure exists (WISP relay in server.ts, boot config in wasm/boot/main.go)
- This is Fleet's `executor-wasm` module strategy

**Key insight:** almostnode handles Tier 1 (pure JS agents). v86 handles Tier 2 (anything requiring real OS). YUAN is the only harness that fits Tier 1 without massive rewriting. Everything else needs Tier 2.

### 11.8 Recommendation

**For browser-only operation:** YUAN is the only viable choice among analyzed harnesses. Nothing else comes close in portability. The OpenAI Agents SDK is a secondary option if you want to build a minimal harness from scratch rather than using YUAN's full-featured one.

**For browser-with-VM operation (Fleet's architecture):** Any harness becomes viable once v86 provides a Linux environment. The v86 path makes portability a non-issue — you get real Node.js, real Python, real bash, real git. The tradeoff is performance (WASM emulation is ~10-50x slower than native) and complexity (VM boot time, WISP relay, disk image management).

**The pragmatic path:**
1. Use YUAN in almostnode for Tier 1 tasks (fast, lightweight, no VM overhead)
2. Use v86 VM for Tier 2 tasks (anything needing bash, git, Python, Docker)
3. This matches Fleet's existing architect + executor module architecture

---

## 12. Synthesis: Our Case — Autonomous Agent Controls Fleet

> **This section reframes the generic "build a harness" synthesis around our actual architecture: an autonomous agent running in almostnode that controls Fleet as one of its toolsets.**
>
> Fleet is NOT the brain — it's the hands. The agent in almostnode is the brain. It thinks, plans, browses code, monitors work, catches mistakes, delegates, and intervenes. Fleet's modules (file browser, artifacts, Jules, user negotiator, etc.) are tools the agent calls. v86 is another tool. Jules is another tool. The agent sits above all of them.
>
> The agent does NOT replace Fleet's orchestrator. It controls Fleet. Fleet still runs tasks its own way — step-by-step, module by module, through its existing orchestrator. The agent decides what tasks to create, what protocols to use, and when to intervene. Optionally, the agent can generate tasks with exact protocols or inline JS code (replacing the architect), but that's a choice, not a requirement. Fleet remains the execution layer. The agent is the decision layer above it.

### 12.1 The Mental Model

**Wrong:** Agent is a tool dispatcher for Fleet's module system.
**Right:** Agent is an autonomous brain. Fleet is one set of tools it can reach through boardVM.

The distinction matters because it changes what the agent does:

| Framing | Agent does... | Agent doesn't do... |
|---------|--------------|-------------------|
| Tool dispatcher (wrong) | Route calls to modules, wait for results | Think on its own, run periodically, browse code independently |
| Autonomous supervisor (right) | Think, plan, monitor, review, browse, delegate, intervene | Just pass through tool calls |

The agent has its own loop. It's not waiting for a user message to start. It can:
- **Run periodically** — wake up, check board state, review progress, look for problems
- **Browse code on its own** — read files, scan repos, understand structure, not just because a task asked it to
- **Analyze intent** — understand what the user actually wants, decompose it, plan before acting
- **Monitor Fleet's execution** — watch task progress, read module logs, detect stuck/error patterns
- **Intervene** — correct a task that's going wrong, re-route, retry with different approach
- **Create subtasks** — break its work into pieces, create Fleet board tasks, track dependencies
- **Ask the user** — when it's genuinely stuck or needs clarification
- **Delegate to Jules** — when it decides something is too complex for local work
- **Use v86 directly** — for git, shell, npm, anything needing a real OS
- **Use Fleet tools directly** — readFile, writeFile, artifacts, all through boardVM
- **Do things Fleet cannot do** — cross-task analysis, intent browsing, periodic health checks, pattern recognition across modules

### 12.2 What the Agent Loop Actually Looks Like

The agent's loop is NOT "user says X → agent does X → done." It's an interactive session where the user sits in the loop:

```
┌──────────────────────────────────────────────────────┐
│                  AGENT LOOP (almostnode)              │
│                                                       │
│  1. OBSERVE                                           │
│     ├── Read board state (tasks, statuses, logs)      │
│     ├── Check for new user messages (CLI input)       │
│     ├── Review recent module activity                 │
│     └── Scan for anomalies (stuck tasks, errors)      │
│                                                       │
│  2. THINK                                              │
│     ├── What needs attention right now?               │
│     ├── What's the user trying to accomplish?         │
│     ├── What's the state of work in progress?         │
│     ├── Are any tasks going wrong?                    │
│     └── What should I do next? (Decision Engine)      │
│                                                       │
│  3. PLAN                                              │
│     ├── Decompose goals into actionable steps         │
│     ├── Decide executor per step (board/v86/Jules)    │
│     ├── Classify risk → autonomy level (§12.12)      │
│     ├── Identify dependencies between steps           │
│     └── Create or update tasks on Fleet board         │
│                                                       │
│  4. ACT                                               │
│     ├── If high-risk → ask user via CLI, wait for OK  │
│     ├── Execute steps using appropriate executor      │
│     ├── Stream progress to user via CLI               │
│     ├── Monitor execution (subscribe to events)       │
│     ├── Review results, verify quality                │
│     ├── Correct if needed, retry if needed            │
│     └── Report findings, ask follow-up questions      │
│                                                       │
│  5. REPEAT (periodic or event-driven)                 │
│     ├── User can interrupt at ANY point → back to 2   │
│     ├── Sleep / wait for event                        │
│     └── Wake up and go back to OBSERVE                │
└──────────────────────────────────────────────────────┘
```

**This is autonomous behavior.** The agent decides when to act. It doesn't wait for a user to click "run." It watches the board, notices things, acts on them. It's closer to a CI/CD pipeline that also thinks than to a chatbot that waits for prompts.

### 12.3 Fleet's Role: One of Many Toolsets

Fleet is not the system the agent lives in. It's a set of capabilities the agent can reach through boardVM:

```
Agent
  │
  ├── boardVM (the bridge to browser)
  │     ├── Fleet modules (tools)
  │     │     ├── readFile, writeFile, listFiles → GitHub API
  │     │     ├── saveArtifact, listArtifacts → Dexie
  │     │     ├── askUser → user negotiator
  │     │     ├── askJules → Jules cloud VM
  │     │     ├── scan → local analyzer
  │     │     └── analyze, addToContext → host
  │     │
  │     ├── Board state (control surface)
  │     │     ├── tasks.list() → see all tasks
  │     │     ├── tasks.get(id) → inspect one
  │     │     ├── tasks.create(task) → create subtask
  │     │     ├── tasks.update(id, changes) → fix/intervene
  │     │     └── on('module:log') → monitor events
  │     │
  │     └── Direct shell (bypasses Fleet entirely)
  │           └── bash(command) → v86 persistent VM
  │
  └── Its own brain (runs in almostnode)
        ├── Decision Engine (intent, complexity, routing)
        ├── Intent analysis (what does user actually want)
        ├── Pattern recognition (what's going wrong)
        ├── Planning (decompose, sequence, delegate)
        └── Memory (Dexie-backed state + observations)
```

Notice: **the agent can bypass Fleet entirely for shell work.** When it calls `bash('git status')`, that goes through boardVM directly to the persistent v86 VM — it doesn't go through Fleet's module system. Fleet's modules are used when they're the right tool (file operations via GitHub API, artifacts, user interaction, Jules delegation), but the agent isn't forced to route everything through Fleet.

### 12.4 What the Agent Does That Fleet Cannot

Fleet's current orchestrator is a two-phase pipeline: architect generates protocol, then executor runs steps. It's linear, reactive, and stateless between steps. The agent in almostnode is none of these things.

| Capability | Fleet Orchestrator | Agent in almostnode |
|-----------|-------------------|---------------------|
| **Periodic monitoring** | No — runs only when triggered | Yes — wakes up, checks board, reviews |
| **Intent browsing** | No — parses tasks from user messages | Yes — reads code, understands context, infers goals |
| **Cross-task analysis** | No — each task is independent | Yes — sees all tasks, tracks dependencies, spots conflicts |
| **Self-correction** | Limited — retries step with error context | Full — reviews results, decides to retry/re-route/escalate |
| **Proactive problem detection** | No — only reacts to step failures | Yes — reads project plan artifacts, compares against actual codebase, flags gaps |
| **Autonomous planning** | No — user creates tasks | Yes — decomposes goals, creates tasks, sequences work |
| **Work delegation** | Static — protocol assigns executor per step | Dynamic — Decision Engine classifies per action, can change mid-task |
| **Learning from observation** | No | Yes — tracks what works, adjusts routing over time |
| **Running without user input** | No — waits for user message | Yes — autonomous loop with periodic wake-up |

**The agent is a supervisor. Fleet's orchestrator is a step runner. They coexist — the agent creates tasks and monitors them, Fleet executes them.**

### 12.5 The Ten Best Ideas — Re-ranked for Our Case

#### 1. Deterministic Decision Router (YUAN) — KEEP, WIRE FIRST

**What:** Pure function classifying intent, complexity, risk → executor routing. Zero LLM calls.

**Why it matters here:** The agent makes routing decisions constantly: should I read this file through Fleet's GitHub API, or clone the repo in v86 and read it locally? Should I implement this feature myself, or delegate to Jules? Is this task complex enough to warrant planning, or should I just do it? The Decision Engine answers these in microseconds without burning an LLM call.

**How to use:** Port YUAN's `agentDecide()` as a pure function inside almostnode. It classifies intent (question/edit/refactor/debug/explore/generate/review/monitor) and complexity (trivial→massive). The agent uses this to decide its own behavior, not just which tool to call.

**Effort:** ~200 LOC to port.

#### 2. Autonomous Agent Loop — BUILD THIS

**What:** The agent has its own loop that runs periodically and event-driven. Not waiting for user messages.

**Why it matters here:** This is what makes our architecture different from every other harness analyzed. Claude Code waits for user input. YUAN waits for user input. Fleet waits for user input. Our agent doesn't. It runs, monitors, thinks, acts. The user sends messages into this loop (they don't start it).

**How to use:** The agent loop has phases: OBSERVE (read board state, check messages, scan logs) → THINK (decide what needs attention) → PLAN (decompose, sequence, delegate) → ACT (execute, monitor, verify) → WAIT (sleep or wait for event). It's a daemon, not a request handler.

**Effort:** ~200 LOC (the core loop + periodic timer + event subscription).

#### 3. Board State as Agent's Memory — ALREADY EXISTS

**What:** Fleet's Dexie database (7 tables) persists everything. Tasks, logs, messages, artifacts, sessions.

**Why it matters here:** The agent doesn't need its own memory system. Dexie IS its memory. It reads board state to understand what's happened. It writes observations and decisions back to Dexie. If the agent crashes and restarts, it restores state from Dexie. The user can also see what the agent was doing by looking at the board.

**How to use:** Agent calls `boardVM.tasks.list()` to see everything. It creates tasks with `boardVM.tasks.create()` to record its own plans. It updates tasks with `boardVM.tasks.update()` to log progress. The React UI shows all of this — the user sees the agent's thinking on the kanban board.

**Effort:** ~50 LOC (CRUD wrapper on Dexie exposed through boardVM).

#### 4. Jules as Heavy Executor — ALREADY EXISTS

**What:** JulesNegotiator with send→poll→verify→retry loop. Cloud VM per task.

**Why it matters here:** When the agent decides a task is too complex for local work (implement a feature, refactor a module, write a test suite), it delegates to Jules. The agent crafts the prompt and success criteria. Jules does the work. The agent monitors the result and verifies quality. If Jules fails, the agent can retry with different instructions, try a different approach itself, or escalate to the user.

**The key difference:** Fleet's current orchestrator delegates to Jules as a static protocol step. The agent delegates to Jules dynamically, based on its own judgment, and reviews the results critically.

**Effort:** 0 LOC new.

#### 5. Event-Driven Reactivity (Fleet) — ALREADY EXISTS

**What:** Typed pub/sub with 6 event types. Modules communicate through events.

**Why it matters here:** The agent subscribes to Fleet events from inside almostnode. When a module logs an error, the agent gets notified immediately. When a user replies to a question, the agent gets notified. When a Jules session completes, the agent gets notified. This is how the agent stays aware without constant polling.

**How to use:** `boardVM.on('module:log', (data) => { ... })` — agent reacts to module activity in real time.

**Effort:** ~30 LOC.

#### 6. Persistent v86 for Shell — THE MAIN BUILD ITEM

**What:** v86 running persistent Alpine Linux with WISP networking. Boot once, use many times.

**Why it matters here:** The agent needs a real shell. It needs git, npm, grep, file system operations. Not for every action — but for anything that requires real OS tools. The VM stays alive, so state carries between commands. The agent can `cd` into a project, install packages, run builds — and it all persists.

**How the agent uses v86:** It's not "the bash tool." It's the agent's direct access to a Linux environment. The agent decides when to use it (based on Decision Engine classification). It can run multiple commands in sequence, check results, and decide what to do next — all in the same VM session.

**Effort:** ~200 LOC.

#### 7. Human-in-the-Loop (Fleet) — ALREADY EXISTS

**What:** UserNegotiator: ask→wait→validate reply.

**Why it matters here:** The agent can ask the user questions. But more importantly, the agent decides WHEN to ask. It doesn't ask for permission on every action — it asks when it's genuinely uncertain or when a decision has high risk. The Decision Engine's veto flags determine this: `clarifyForced: true` means ask the user; otherwise, act autonomously.

**Effort:** 0 LOC new.

#### 8. Monitoring and Review — NEW, UNIQUE TO US

**What:** The agent actively monitors Fleet's board, tracks what's failing, and checks whether the project is on track against its plan.

**Why it matters here:** No other harness in this analysis does this. Claude Code doesn't monitor its own tool executions for patterns. YUAN doesn't review its sub-agent work proactively. Our agent reads module logs, spots failures, and either fixes the problem or escalates to the user.

**Concrete monitoring targets:**

1. **Failed tasks.** Fleet marks tasks as ERROR or FAILED. The agent notices, reads the error, and decides: retry with different approach, escalate to user, or create a remediation task.

2. **Missing project zones.** The board has artifacts that define the project plan — what should exist, what's been built, what's pending. The agent compares the plan against the actual codebase (via scan, readFile, listFiles). If the plan says "implement auth module" and there's no auth module in the codebase, the agent flags it.

3. **Stuck tasks.** Tasks in EXECUTING state with no log output for a configurable timeout. The agent checks module logs, diagnoses, and either unblocks or escalates.

**How it works:**
```
Agent wakes up (periodic or event-triggered)
  → reads all tasks from Dexie
  → checks: any FAILED? any stuck? any EXECUTING too long?
  → for failures: read error logs, diagnose, retry or escalate
  → reads project plan artifacts
  → compares plan vs actual codebase state
  → flags gaps: "plan says X should exist, but it doesn't"
  → reads user messages (any new requests?)
  → goes back to sleep or acts on findings
```

**Effort:** ~150 LOC (monitoring loop + anomaly detection patterns).

#### 9. Intent Browsing — NEW, UNIQUE TO US

**What:** The agent doesn't just execute tasks — it understands what the user is trying to accomplish. It reads code, browses repos, analyzes structure, and forms an understanding before acting.

**Why it matters here:** Fleet's current flow is: user says something → parse into task → architect generates protocol → execute. The agent adds a phase before all of that: understand what the user actually wants. Read the relevant code. Understand the context. THEN decide how to act. This is closer to how a senior developer works — they don't start coding immediately after getting a ticket. They read the code first.

**How it works:** When the agent receives a user message (or decides to start work based on monitoring), it first browses: reads relevant files, scans the repo structure, checks recent changes. This gives it context that a simple task description doesn't provide. Then it plans. Then it acts.

**Effort:** This is part of the agent's loop behavior, not a separate component. It uses existing tools (readFile, listFiles, scan) to browse. ~0 LOC new for the browsing itself — it's how the agent uses its tools.

#### 10. Tool Result Size Limits (YUAN) — SMALL ADDITION

**What:** Every tool caps output to prevent context blowout.

**Why it matters here:** The agent reads files, runs shell commands, and processes logs. Any of these can produce large output that wastes context. Cap at the dispatch level.

**Effort:** ~30 LOC.

### 12.6 What We DON'T Need

| Idea | Why We Skip It |
|------|---------------|
| **Layered Context Management (7 layers)** | The agent's context is tool results + board state, not a growing conversation. It's a ReAct loop, not a chat session. Add compression if it becomes a problem, not before. |
| **Dependency Injection** | Single agent in a single almostnode container. No testability concerns at this scale. |
| **Sub-Agent Spawning** | Jules IS the heavy executor. The agent doesn't need to spawn sub-agents — it delegates to Jules for complex work. (If almostnode can't run npm packages we need, the agent can still delegate to Jules or v86 for those.) |
| **Hook System** | Fleet's event bus provides the reactivity we need. Hooks are for user extensibility — not needed yet. |
| **Dream/Memory Consolidation** | Dexie IS the memory. The agent reads and writes board state. Project knowledge (§12.13) extends this — it's the same Dexie store, not a separate subsystem. |
| **SEARCH/REPLACE Editing** | The agent doesn't edit files directly. It delegates coding to Jules or uses v86 for edits. |
| **HierarchicalPlanner (3-level)** | Over-engineered for our case. The agent plans at one level: decompose goal into steps, decide executor per step. |
| **Security SSOT** | Fleet's sandbox already enforces permissions. boardVM dispatches through the existing system. |
| **WorldModel, TrustEconomics, StrategyMarket** | Research concepts. No proven ROI. Skip. |
| **MCP Support** | boardVM IS our tool protocol. We don't need an external tool-loading protocol. |
| **Prompt Caching** | Using OpenAI-compatible API through boardVM bridge. Provider-specific optimizations don't apply. |

**Open question: npm in almostnode.** The agent needs npm packages (for LLM calls, for tool libraries, for the Decision Engine). almostnode supports `npm install` into its VFS. But we haven't tested what works: can it install any npm package, or only ones without native dependencies? Does it handle large dependency trees? What's the performance impact? This needs testing before we commit to running the agent entirely inside almostnode. If npm is too limited, the agent loop can run directly in the browser with only LLM calls and tool dispatch going through boardVM.

### 12.7 The Executor Triangle (Revised)

Three executor paths, chosen dynamically by the agent based on what it's trying to do:

```
                          Agent (autonomous, almostnode)
                                   │
                                   │ Thinks, plans, monitors, reviews
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
            BOARD TOOLS        v86 VM         JULES
            (Fleet modules)  (direct shell)  (cloud VM)
                    │              │              │
            ┌───────┤        ┌─────┤        ┌────┤
            │       │        │     │        │    │
        readFile  askUser  bash  git     impl  test
        writeFile askJules npm   grep    debug  refactor
        listFiles saveArt curl  build   any   any
        scan      analyze etc   etc     heavy heavy
                                        coding coding
```

**But the agent ALSO does things that don't use any executor:**
- Think about what to do (no tool call — pure reasoning)
- Monitor board state (reads Dexie, doesn't execute anything)
- Review module logs (reads logs, analyzes patterns)
- Plan and decompose (creates tasks on the board, doesn't execute them yet)
- Decide when to ask the user (veto flag check, then askUser)

**The agent's Decision Engine routes each action:**
```
Action type                  → Executor
─────────────────────────────────────────
Read a file                  → board tool (GitHub API) or v86 (if cloned)
Write a file                 → board tool or v86
Run shell command            → v86
Implement a feature          → Jules
Debug a hard issue           → Jules or v86 (depending on complexity)
Write tests                  → Jules
Browse code / understand     → board tools (readFile, listFiles, scan)
Monitor board                → board state (Dexie) — no executor needed
Ask user                     → board tool (user negotiator)
Create subtask               → board state (Dexie) — no executor needed
```

### 12.8 Build Assessment

#### Phase 1: boardVM Bridge (~150 LOC)
| Component | LOC | What |
|-----------|-----|------|
| `src/bridge/boardVM.ts` | ~80 | dispatchTool, tasks CRUD, on/emit |
| Tool name mapping | ~30 | Short names → qualified module names |
| Wire to ModuleRegistry | ~40 | dispatchTool → registry.invokeHandler() |

#### Phase 2: @fleet/tools Shim (~100 LOC)
| Component | LOC | What |
|-----------|-----|------|
| `fleet-tools-shim.js` | ~70 | VFS module: all tools as async functions → boardVM |
| Bootstrap (write to VFS) | ~30 | Inject shim into almostnode after container creation |

#### Phase 3: Persistent v86 (~200 LOC)
| Component | LOC | What |
|-----------|-----|------|
| `PersistentVM.ts` | ~120 | Boot once, exec many, command queue |
| VM worker persistent mode | ~50 | Modify for keep-alive |
| Wire bash tool | ~30 | boardVM → PersistentVM |

#### Phase 4: Agent Loop (~350 LOC)
| Component | LOC | What |
|-----------|-----|------|
| Core loop (observe→think→plan→act) | ~200 | Periodic + event-driven, autonomous behavior |
| Decision Engine (ported from YUAN) | ~100 | Intent/complexity/routing classification |
| Monitoring & review logic | ~50 | Anomaly detection in module logs, stuck detection |

#### Phase 5: Bootstrap & UI Pivot (~150 LOC)
| Component | LOC | What |
|-----------|-----|------|
| `agent-bootstrap.ts` | ~100 | Create almostnode, install agent, register shims, start loop |
| UI changes | ~50 | Remove orchestrator calls, add agent status display |

**Total new code: ~950 LOC.** More than the previous estimate because the agent loop itself is the main build item — it's not just wiring, it's the brain.

### 12.9 The Honest Architecture — Our Case

```
┌─────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                 │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                        REACT UI                               │  │
│  │  ┌─────────────────────────┐  ┌────────────────────────────┐  │  │
│  │  │   AGENT CLI (primary)   │  │   KANBAN (secondary)       │  │  │
│  │  │                         │  │                            │  │  │
│  │  │  > Streaming output     │  │  Agent's task board        │  │  │
│  │  │  > Approval gates       │  │  Status, progress          │  │  │
│  │  │  > User input           │  │  Module logs               │  │  │
│  │  │  > Conversation         │  │                            │  │  │
│  │  └────────────┬────────────┘  └────────────────────────────┘  │  │
│  └───────────────┼───────────────────────────────────────────────┘  │
│                  │ user ↔ agent messages                             │
│  ┌───────────────▼───────────────────────────────────────────────┐  │
│  │                        boardVM BRIDGE                          │  │
│  │  userInterface.say/ask/approve/stream ← agent pushes to user  │  │
│  │  userInterface.onUserMessage ← user types anytime (interrupt) │  │
│  │  dispatchTool() → Fleet ModuleRegistry (for Fleet tools)      │  │
│  │  dispatchTool() → PersistentVM (for bash, direct)             │  │
│  │  tasks → Dexie CRUD (agent reads/writes board state)          │  │
│  │  on/emit → EventBus (agent subscribes to events)              │  │
│  └──────────┬──────────────────────────────────┬─────────────────┘  │
│             │                                  │                    │
│  ┌──────────▼──────────────────────────────────▼────────────────┐   │
│  │                    almostnode                                 │   │
│  │                                                                │   │
│  │  ┌────────────────────────────────────────────────────────┐   │   │
│  │  │              THE AGENT (autonomous loop)                │   │   │
│  │  │                                                         │   │   │
│  │  │  OBSERVE → THINK → PLAN → ACT → REPEAT                 │   │   │
│  │  │                                                         │   │   │
│  │  │  Monitors board, reviews work, catches problems,        │   │   │
│  │  │  browses code, understands intent, delegates work,      │   │   │
│  │  │  creates subtasks, asks user when needed                │   │   │
│  │  │                                                         │   │   │
│  │  │  Uses Decision Engine for routing (no LLM call needed)  │   │   │
│  │  └───────────────────────┬────────────────────────────────┘   │   │
│  │                          │                                     │   │
│  │  Tools available to agent:                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │   │
│  │  │ Fleet tools  │  │ v86 shell    │  │ Jules        │         │   │
│  │  │ (via boardVM)│  │ (via boardVM)│  │ (via boardVM)│         │   │
│  │  │              │  │              │  │              │         │   │
│  │  │ readFile     │  │ bash(cmd)    │  │ askJules(    │         │   │
│  │  │ writeFile    │  │              │  │  prompt,     │         │   │
│  │  │ listFiles    │  │ git, npm,    │  │  criteria)   │         │   │
│  │  │ scan         │  │ grep, build, │  │              │         │   │
│  │  │ saveArtifact │  │ test, etc    │  │ heavy coding │         │   │
│  │  │ askUser      │  │              │  │ in cloud VM  │         │   │
│  │  │ analyze      │  │              │  │              │         │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │   │
│  │                                                                │   │
│  │  Board state (agent's memory & control surface):               │   │
│  │  tasks.list() / tasks.create() / tasks.update()                │   │
│  │  on('module:log') / on('user:reply')                          │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Underneath everything:                                              │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Fleet Modules    │  │ Dexie (IDB)  │  │ v86 + WISP relay     │  │
│  │ (9 modules,      │  │ (7 tables,   │  │ (persistent Linux,   │  │
│  │  23 handlers)    │  │  all state)  │  │  real TCP via WS)    │  │
│  └──────────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**The key insight in this diagram:** The agent is the center. Everything else is a tool it reaches through boardVM. Fleet's modules, Dexie, v86, Jules — they're all at the same level: things the agent can use. The agent decides what to use, when, and why.

**The user sits in the loop, not outside it.** The Agent CLI is the primary interaction surface — a streaming terminal where the user can see what the agent is doing, approve risky actions, redirect decisions, and type unprompted at any time. The kanban board is secondary context. The agent is semi-autonomous: it can observe and plan freely, but high-risk actions require explicit user approval (see §12.12 for the autonomy level model).

**The agent controls Fleet, it doesn't replace it.** Fleet's orchestrator still runs tasks step-by-step, manages state machines, handles module sequencing. The agent sits above Fleet: it creates tasks, sets their protocols, monitors their progress, and intervenes when things go wrong. Optionally, the agent can generate tasks with exact protocols or inline JS code (replacing the architect role) — but that's a choice per task, not a replacement of Fleet's execution machinery.

The React UI becomes the agent's display and input layer — CLI panel and kanban board, tab-swappable.

### 12.10 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent loop logic is wrong (monitors too much, acts too little, or vice versa) | Medium | High | Iterate on the loop. Start simple (react to events only, no periodic monitoring). Add periodic monitoring after the reactive version works. |
| Agent burns LLM calls on unnecessary monitoring | Medium | Medium | Decision Engine gates LLM calls. Monitoring board state (Dexie reads) is free — only thinking/planning costs LLM tokens. Set a token budget per wake-up cycle. |
| Persistent v86 unstable | Medium | High | Watchdog timer. Auto-reboot on stale response. Serialize commands through queue. |
| almostnode can't handle long-running agent | High (unknown) | High | almostnode was designed for YUAN's request-response loop, not a persistent daemon. Must test: can container.execute() run indefinitely? Does memory accumulate? Does VFS garbage-collect? If almostnode fails here, fall back to running the agent loop directly in the browser (outside almostnode) with tool calls going through boardVM. |
| Agent crashes in almostnode | Medium | Medium | Restart container. Restore state from Dexie. All agent state is in the board — nothing is lost. |
| Jules daily limits | Medium | Medium | Agent tracks Jules usage via GlobalVars. Routes to v86 for work that doesn't need Jules. |
| Agent makes bad decisions autonomously | Medium | High | Decision Engine is conservative (risk-averse by default). Veto flags force user interaction on risky actions. User can see everything the agent does on the kanban board. |
| Agent and Fleet's old orchestrator conflict | High (during migration) | Medium | Phase 5 removes the old orchestrator entirely. During transition, disable Fleet's orchestrator and run only the agent. |

### 12.11 What mini-SWE-agent Teaches Us

100 lines of Python. 74% SWE-bench. The loop is a commodity.

But our agent is more than a loop. It's:
- **Autonomous** (runs without user input)
- **Supervisory** (monitors other agents' work)
- **Multi-executor** (chooses between board tools, v86, and Jules dynamically)
- **Stateful** (Dexie-backed, survives crashes)
- **Observable** (user sees everything on the kanban board)

The loop is still simple. The value is in what the agent does between loop iterations: observe, monitor, review, intervene. That's not the loop — that's the brain.

**Build the brain. Wire the tools. Ship it.**

### 12.12 The Agent Needs a Real User Interface

The agent is NOT a silent background daemon. It's an **interactive session** — like Claude Code's terminal UI or Aider's REPL. The user sits in the loop, not outside it.

#### What's wrong with the current plan

The architecture (Section 12.9) frames the React UI as a passive dashboard: "shows what the agent is doing." And the agent's user communication goes through Fleet's `UserNegotiator` — an async poll-wait-validate pattern designed for orchestrator-driven tasks. Both are wrong:

- **UserNegotiator is too slow and indirect.** It was built for Fleet's step-by-step task execution where the orchestrator pauses and polls for a user reply. The agent needs something faster — a direct channel where the user can type at any time, see the agent mid-thought, and intervene.
- **A read-only dashboard is passive observation, not interaction.** The user isn't a spectator watching the kanban board update. They're a participant who needs to approve risky actions, redirect the agent, answer questions, and provide context.

#### What the agent actually needs

```
┌─────────────────────────────────────────────────────────────┐
│                   USER ↔ AGENT CHANNEL                      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Agent CLI (dedicated, not v86 shell)                │   │
│  │                                                       │   │
│  │  > I'm going to refactor the auth module. Jules?      │   │
│  │    Decision: HIGH complexity, HIGH risk → routing to   │   │
│  │    Jules with success criteria: [tests pass, no       │   │
│  │    regressions in login flow]                         │   │
│  │                                                       │   │
│  │  > [APPROVE] [DENY] [REDIRECT TO V86]                │   │
│  │                                                       │   │
│  │  You: use v86 instead, Jules is at limit today        │   │
│  │                                                       │   │
│  │  > Understood. Routing to v86. I'll break it into     │   │
│  │    smaller steps: 1) scan auth module, 2) plan        │   │
│  │    changes, 3) execute file-by-file, 4) test.         │   │
│  │    Starting step 1...                                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Properties:                                                 │
│  • Streaming — agent output appears in real-time             │
│  • Interruptible — user can type anytime, agent pauses       │
│  • Approval gates — risky actions require explicit OK        │
│  • Contextual — agent explains what it's doing and why       │
│  • Persistent — scroll back through session history          │
└─────────────────────────────────────────────────────────────┘
```

#### Three layers of user interaction

| Layer | What | When | Example |
|-------|------|------|---------|
| **Ambient** | Status bar, activity feed, kanban updates | Always | "Agent is monitoring 3 tasks. Last scan: 2m ago." |
| **Conversational** | Agent messages, user replies | Agent has something to say or ask | "I found a circular dependency in the auth module. Want me to fix it?" |
| **Interventional** | Approval gates, redirects, overrides | Agent hits a decision threshold | User denies Jules routing, redirects to v86 |

The ambient layer is the dashboard. The conversational and interventional layers are the CLI.

#### Not fully autonomous — semi-autonomous with escalating trust

The agent's autonomy level depends on what's happening:

- **Fully autonomous** (no user needed): Monitoring board state, reading logs, scanning for patterns, browsing code, planning (low-risk observation)
- **Semi-autonomous** (user informed, not asked): Creating low-risk subtasks, running non-destructive commands, reading files, running tests
- **Requires approval** (user must OK): Writing files, executing heavy Jules tasks, making architectural changes, deploying anything
- **Requires conversation** (user must answer): Ambiguous intent, conflicting requirements, multiple valid approaches

This maps directly to Claude Code's permission model (auto-allow, ask-every-time, deny). The Decision Engine classifies risk. High-risk actions get an approval gate. The user can adjust thresholds — more autonomous when they trust the agent, less when they don't.

#### Where this lives

The agent CLI is a **browser-based terminal** — a `<div>` styled like a terminal that renders streaming agent output and accepts user input. It's not a v86 shell (the agent doesn't type into a Linux terminal to talk to the user). It's its own thing:

```
boardVM.userInterface = {
  // Agent pushes messages to the user
  say: (message, options) => { /* render in CLI panel */ },

  // Agent asks the user a question, waits for reply
  ask: (question, options) => Promise<reply>,

  // Agent requests approval for an action
  approve: (action, details) => Promise<boolean>,

  // Agent streams real-time output (thinking, progress)
  stream: (chunk) => { /* append to current output block */ },

  // User typed something unprompted (interrupt)
  onUserMessage: (callback) => { /* listen for freeform input */ },
};
```

#### The UI layout: CLI and Board, tab-swappable

The user sees two views, switchable via tabs:

```
┌─────────────────────────────────────────────────────────────┐
│  [Agent CLI]  [Board]                          tab switch    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ AGENT CLI VIEW ─────────────────────────────────────┐   │
│  │                                                       │   │
│  │  > Agent streaming output, conversation, approvals    │   │
│  │  > User types here, interrupts here                  │   │
│  │                                                       │   │
│  │  ┌─ v86 terminal (expandable, below agent CLI) ──┐   │   │
│  │  │  User can also access the v86 shell directly  │   │   │
│  │  │  for manual work alongside the agent           │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ BOARD VIEW ────────────────────────────────────────┐    │
│  │  Kanban board, task details, module logs, artifacts │    │
│  │  (read-write: user can also create/edit tasks)      │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

- **Agent CLI tab**: Primary interaction surface. Shows agent output, takes user input, approval gates. Expandable v86 terminal below for direct shell access.
- **Board tab**: Kanban board with tasks, status, module logs, artifacts. User can also manually create/edit tasks here — the agent sees these changes on its next OBSERVE cycle.
- **Tab-swappable**: User flips between them. CLI is the default view (that's where the conversation happens). Board is for overview and manual task management.

#### What changes in the build estimate

| Component | Previous LOC | Revised LOC | Why |
|-----------|-------------|-------------|-----|
| Agent CLI (`agent-cli.ts`) | 0 | ~80 | Streaming output, approval gates, user interrupt handling |
| boardVM userInterface surface | 0 | ~30 | `say`, `ask`, `approve`, `stream`, `onUserMessage` |
| React CLI panel component | ~50 | ~100 | Terminal-styled div, streaming render, input handling |
| Permission model (Decision Engine extension) | (included) | ~40 | Risk classification → autonomy level mapping |
| **Additions** | | **~250** | |

Total estimate rises from ~950 to **~1200 LOC**. The agent CLI is not optional — it's how the user stays in control.

### 12.13 Knowledge Base: The Agent Reads Smart, Not Wide

The agent's context window is finite. Every token matters. Rather than stuffing the entire codebase into context and hoping the LLM figures it out, the agent should **query a knowledge base** with targeted questions — like a senior developer who knows where to look rather than memorizing everything.

#### The problem this solves

- **Context window is small.** A real project has hundreds of files, thousands of functions. You can't fit it all in context.
- **Brute-force reading is expensive and noisy.** Reading every file to find one function definition wastes tokens and introduces irrelevant context that confuses the LLM.
- **The agent needs to understand architecture, not just syntax.** "What calls `authenticateUser()`?" is more valuable than reading the file that defines it.

#### What the knowledge base provides

```
┌──────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE LAYER                            │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │ Code Analysis    │  │ Project Knowledge                 │  │
│  │ (structural)     │  │ (accumulated, cross-session)     │  │
│  │                   │  │                                   │  │
│  │ • Symbol index    │  │ • Architecture decisions          │  │
│  │ • Call graph      │  │ • API contracts                   │  │
│  │ • Dependencies    │  │ • Gotchas & patterns              │  │
│  │ • File map        │  │ • Domain vocabulary               │  │
│  │ • Import tree     │  │ • What changed & why              │  │
│  └────────┬──────────┘  └──────────────┬────────────────────┘  │
│           │                            │                       │
│           └────────────┬───────────────┘                       │
│                        │                                      │
│  ┌─────────────────────▼────────────────────────────────────┐ │
│  │              Query Interface                             │ │
│  │                                                          │ │
│  │  query("what calls authenticateUser?")                   │ │
│  │    → symbol index → callers: [login.ts:42, session.ts:18]│ │
│  │                                                          │ │
│  │  query("what handles payments?")                         │ │
│  │    → knowledge base → module: payments, files: [...]     │ │
│  │                                                          │ │
│  │  query("what broke after the auth refactor?")            │ │
│  │    → knowledge base → recent changes, affected modules   │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

#### Two tiers of knowledge

**Tier 1: Structural analysis (fresh, generated on demand or cached)**

This is what tools like LSP, tree-sitter, AST analysis provide. The agent asks targeted structural questions:

- "What symbols does this file export?" → only the public API surface
- "What imports this module?" → reverse dependency map
- "Where is `X` defined and who calls it?" → definition + call sites
- "What changed in the last commit?" → diff summary

This is cheap. It's deterministic. No LLM calls needed. The agent uses this to narrow down what it actually needs to read.

Fleet's existing `knowledge-local-analyzer.scan` does some of this. The v86 shell can run `grep`, `rg`, `git log`, `ast-grep` for deeper queries. The point is: query first, read second.

**Tier 2: Semantic queries via background LLM calls**

For questions that structural analysis can't answer — "how does error handling work in this project?", "what's the relationship between the auth module and the payment module?", "what would break if I change this interface?" — the agent can spawn **background LLM queries** that don't pollute the main agent's context window.

```
Main agent context (small, focused):
  Current task, user message, immediate tool results

Background query (separate LLM call, separate context):
  "Given these 5 files from the auth module, explain how JWT validation works"
  → result: structured summary stored in Dexie
  → main agent reads the summary (compact) instead of the raw files (expensive)
```

This is how the agent stays smart without blowing up its context. The background query runs in its own LLM call with its own context window. The result is a compressed, structured answer stored in Dexie. The main agent reads the summary — not the source files. This is analogous to NotebookLM's approach: query a corpus, get a synthesized answer, don't read the corpus yourself.

**Tier 3: Accumulated project knowledge (cross-session)**

This is what Claude Code's "Dream" memory provides. It's the agent's accumulated understanding, stored in Dexie:

- Architecture decisions and their rationale
- API contracts between modules
- Known gotchas ("don't modify `x` without also updating `y`")
- Domain vocabulary (what "task" means in this codebase vs. general usage)
- Patterns that worked (and didn't) in previous sessions

This is what YUAN's `.yuan/memory.json` does at a basic level. Our version should be richer — stored in Dexie, accumulated over time, queryable by the agent. Every time the agent learns something (a code review finding, a bug root cause, a successful refactor pattern), it writes it to the knowledge base. Future sessions start smarter.

#### How the agent uses it

The agent's OBSERVE phase already includes "browse code." With a knowledge base, this becomes:

```
Without knowledge base:
  "Read every file in /src/auth → read every file in /src/api → ..."
  (expensive, noisy, misses cross-cutting concerns)

With knowledge base:
  "What modules handle authentication? → knowledge-base says: auth-middleware.ts, session.ts, jwt.ts
   What changed recently? → git log says: auth-middleware.ts was refactored 2 days ago
   What calls authenticateUser? → call graph says: 3 callers, 2 in login flow, 1 in session refresh
   Read auth-middleware.ts (focused, with context about why it matters)"
  (targeted, efficient, context-aware)
```

#### NotebookLM-style integration

For projects with existing documentation (READMEs, ADRs, design docs, JSDoc comments), the agent should be able to query these as a knowledge base rather than reading them raw. The flow:

1. **Index** documentation and code comments into a vector store (or structured index) — can run in v86 or as a Fleet module
2. **Query** with natural language: "how does error handling work in this project?"
3. **Get back** relevant excerpts with source references, not the entire document
4. **Read selectively** — only open the files that matter

This is particularly valuable for **onboarding** (new agent session understanding an unfamiliar codebase) and **cross-cutting questions** (architecture decisions that span multiple files).

#### Connection to Decision Engine

The knowledge base feeds the Decision Engine. Before the agent decides how to act, it queries what it needs to know:

```
Decision Engine flow with knowledge base:
  1. User request arrives
  2. Query knowledge base: "what's the relevant context for this?"
  3. Knowledge base returns: affected modules, recent changes, known patterns
  4. Decision Engine classifies: complexity, risk, executor choice
  5. Agent acts with focused context, not brute-force reads
```

This makes the agent **faster** (fewer token-wasting reads), **smarter** (starts with accumulated knowledge), and **cheaper** (fewer LLM calls to figure out basic structure).

#### Build impact

| Component | LOC | What |
|-----------|-----|------|
| Knowledge base module (Dexie-backed) | ~80 | Structured store for architecture notes, patterns, gotchas |
| Query interface on boardVM | ~30 | `queryKB(question) → structured answer` |
| Agent KB usage in OBSERVE phase | ~20 | Query before read, use results to focus |
| Documentation indexer (v86 script) | ~40 | Scan docs/comments, build index |
| Accumulation logic (agent writes what it learns) | ~30 | After each session, persist new findings |

**Additions: ~200 LOC.** Total estimate now **~1400 LOC**.

### 12.14 Project Constitution & Error Analysis — The Agent Builds Understanding

The agent doesn't just execute tasks — it constructs and maintains the project's **constitution**: the living documentation of what the project is, how it works, what its rules are, and what went wrong. This is accumulated knowledge that makes every future session smarter.

#### What a project constitution contains

A constitution is not a static README. It's a structured, agent-maintained document (stored in Dexie as an artifact) that covers:

| Section | What | Who writes it | Example |
|---------|------|---------------|---------|
| **Project identity** | Name, language, framework, build/test commands | Agent (detected on first scan) | "TypeScript React project, `npm run build`, `npm test`" |
| **Architecture overview** | Module structure, key abstractions, data flow | Agent (from code analysis) | "Auth handled by middleware.ts, state via Zustand, API through /src/api" |
| **Executor profiles** | What executors exist, what they're good at, their limits | Agent (observed over time) | "Jules: good for features, bad for small fixes. v86: good for git/build, slow boot." |
| **Rules & constraints** | Things that must or must not be done | User (told to agent) + Agent (observed) | "Never modify dist/. Always run tests after changing auth." |
| **Patterns** | Conventions that work in this codebase | Agent (observed from code reviews) | "Error handling pattern: try/catch with typed Error subclasses, never throw strings." |
| **Error log** | What broke, why, how it was fixed | Agent (collected from monitoring) | "2026-04-12: JWT validation broke after refactor — missing `await` on token verify." |

#### The agent constructs the constitution iteratively

```
Session 1 (cold start):
  Agent scans codebase → detects project type, framework, structure
  Writes initial constitution to Dexie artifact:
    "TypeScript React project. Modules: auth, api, ui, utils. Build: vite. Test: jest."
  This is minimal. It gets richer over time.

Session 2 (agent monitors tasks):
  Task fails: "TypeError: Cannot read property 'user' of undefined"
  Agent collects: error, stack trace, which task, which executor
  Agent writes short analysis to error log:
    "auth-middleware.ts:45 — `req.user` undefined when token expired. Fleet task #23 failed.
     Fix: check token expiry before accessing req.user."
  Agent updates constitution rules: "Always validate token expiry before accessing req.user"

Session 5 (constitution is rich):
  Agent reads constitution on session start → knows project structure, known pitfalls, executor preferences
  New task arrives → agent checks constitution for relevant rules before acting
  Agent references constitution in its planning: "Constitution says: always test auth changes"
```

#### Error collection and analysis

The agent collects errors from three sources:

1. **Fleet task failures** — tasks that end in ERROR/FAILED state. The agent reads the module logs, extracts the error, writes a short analysis: what broke, where, likely cause.

2. **v86 command failures** — shell commands that return non-zero exit codes. The agent captures stderr, identifies the pattern (build error, test failure, missing dependency).

3. **Jules session failures** — when Jules can't complete a task after retries. The agent records what Jules tried, why it failed, and what worked instead.

Each error entry is **short** (2-3 sentences max). The agent doesn't dump raw logs — it synthesizes:

```
BAD (raw dump):
  "Error: Cannot find module 'express'. Require stack: src/server.ts:1:15
   at Function.Module._resolveFilename (node:internal/modules/cjs/loader:1089:15)
   at Function.Module._load (node:internal/modules/cjs/loader:935:27) ..."

GOOD (agent-synthesized):
  "Missing dependency: 'express' not installed. Occurred after v86 VM reboot lost installed packages.
   Fix: add 'npm install' to VM boot script. Recurrence: 2."
```

#### Executor constitution

Fleet is adding **per-executor constitutions** — behavior profiles that each executor carries, defining what it should/shouldn't do, preferred patterns, and communication format. These are Fleet-native (not agent-layer), stored alongside the project constitution. See Section 15.4 for details.

The agent layer maintains its own **executor profiles**, built from observation, that complement Fleet's executor constitutions:

```
executor_profiles: {
  jules: {
    strengths: ["feature implementation", "test writing", "large refactors"],
    weaknesses: ["small fixes", "projects with complex setup", "rate-limited daily"],
    daily_limit: 10,  // agent tracks this
    avg_duration: "3-5 min",
    success_rate: 0.85,  // agent calculates from history
    last_updated: "2026-04-12"
  },
  v86: {
    strengths: ["git operations", "npm builds", "shell scripting", "quick fixes"],
    weaknesses: ["slow boot", "memory leaks after prolonged use", "no GPU"],
    persistence: true,
    avg_command_time: "1-3s (after boot)",
    last_updated: "2026-04-12"
  },
  board_tools: {
    strengths: ["file read/write via GitHub API", "artifact storage", "user interaction"],
    weaknesses: ["no shell access", "no build/test capability"],
    last_updated: "2026-04-12"
  }
}
```

**Two-layer executor intelligence:**

| Layer | Source | Content | Mutable? |
|-------|--------|---------|----------|
| Fleet executor constitution | Fleet maintainer/user | Declarative rules, capability claims, constraints | Yes (user edits) |
| Agent executor profile | Agent observation | Empirical success rates, failure modes, latency data | Yes (agent updates) |

The agent's responsibilities toward executor constitutions:
1. **Read** — Before routing a task, read the target executor's constitution to ensure task compatibility
2. **Cross-check** — Compare the constitution's claimed capabilities against observed profiles; flag mismatches (e.g., constitution says "handles any TypeScript project" but profile shows 40% failure rate on monorepos)
3. **Detect conflicts** — If two executor constitutions have contradictory rules, flag for user resolution
4. **Suggest amendments** — Based on observed patterns, propose constitution updates to the user

The agent uses executor profiles in its Decision Engine: if Jules has hit its daily limit, route to v86. If v86 is showing memory issues, route to Jules. This is adaptive routing based on observed reality, not static configuration.

#### User can edit the constitution

The constitution is an artifact in Dexie. The user can:
- Read it via the Board tab (artifacts section)
- Edit rules and constraints directly
- Tell the agent: "add a rule: never deploy on Fridays" → agent writes it to constitution
- Override agent's error analysis: "that wasn't a token expiry issue, it was a clock skew" → agent corrects the entry

The agent respects user-written rules as higher priority than its own observations.

#### Build impact

| Component | LOC | What |
|-----------|-----|------|
| Constitution schema (Dexie table) | ~30 | Fields: project identity, architecture, rules, executor_profiles, error_log |
| Agent: initial scan & constitution creation | ~40 | Detect project type, write first constitution |
| Agent: error collection & analysis | ~50 | Read failures from Dexie, synthesize short analysis, write to error_log |
| Agent: executor profile tracking | ~30 | Update success rates, detect limits, record observations |
| Agent: reference constitution in planning | ~20 | Read constitution before ACT, apply rules |

**Additions: ~170 LOC.** Total estimate now **~1570 LOC**.

---

## 13. Fleet Browser Platform Analysis

> **Source:** `/tmp/kanban-jules-review/` — the Fleet system (also called "Agent Kanban" or "TerminalBoard").
> This section is a read-only audit of what exists in the browser today.

### 13.1 Architecture at a Glance

Fleet is a **multi-agent orchestration system** that runs entirely in the browser as a React SPA, with a lightweight Express + Vite dev server for COOP/COEP headers and WISP relay. It is NOT a harness in the Claude Code / YUAN sense — it does not have a single agentic loop. Instead, it orchestrates **task-level agent sessions** through a kanban board metaphor.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                                │
│                                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌──────────┐                    │
│  │ Kanban   │   │ ModuleHost   │   │ Dexie DB │                    │
│  │ UI       │──▶│ (event bus)  │──▶│ (7 tables)│                    │
│  └──────────┘   └──────┬───────┘   └──────────┘                    │
│                        │                                           │
│           ┌────────────┼────────────┐                               │
│           ▼            ▼            ▼                               │
│     ┌──────────┐ ┌──────────┐ ┌──────────────┐                     │
│     │Orchestr. │ │ Sandbox  │ │  9 Modules   │                     │
│     │(step     │ │ (Sval in │ │  (manifests) │                     │
│     │ runner)  │ │ Worker)  │ │              │                     │
│     └──────────┘ └──────────┘ └──────────────┘                     │
│           │                                                        │
│           ▼                                                        │
│     ┌──────────────┐   ┌────────────────┐                          │
│     │ LLM Calls    │   │ Executor Paths │                          │
│     │ (Gemini or   │   │ local/jules/   │                          │
│     │  OpenAI)     │   │ github/wasm)   │                          │
│     └──────────────┘   └────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
         │                              │
    fetch()                        WebSocket
         │                              │
    ┌────▼────┐                  ┌──────▼──────┐
    │ Gemini /│                  │ /wisp relay │
    │ OpenAI  │                  │ (WISP→TCP)  │
    └─────────┘                  └─────────────┘
```

**Key stats:**
- TypeScript codebase, React 19, Vite 6
- ~3,000 LOC across `src/core/`, `src/modules/`, `src/services/`
- 9 modules, 23 registered tool handlers
- IndexedDB persistence (Dexie, 7 tables, 3 schema migrations)
- Two LLM providers: Gemini (native SDK) and OpenAI-compatible (raw fetch)

### 13.2 Component Inventory

#### Core Runtime (6 files)

| File | LOC | Purpose |
|------|-----|---------|
| `core/types.ts` | 83 | ModuleManifest, RequestContext, HostConfig, OrchestratorConfig |
| `core/event-bus.ts` | 32 | Typed pub/sub: 6 event types |
| `core/registry.ts` | 79 | ModuleRegistry: 9 manifests, handler map, enable/disable |
| `core/host.ts` | 163 | ModuleHost: init, 23 handler registrations, llmCall (Gemini + OpenAI) |
| `core/orchestrator.ts` | 284 | Task lifecycle: generateProtocol → runStep → executeInSandbox |
| `core/prompt.ts` | 160 | composeProgrammerPrompt, composeArchitectPrompt, parseTasksFromMessage |

#### Sandbox System (2 files)

| File | LOC | Purpose |
|------|-----|---------|
| `core/sandbox.ts` | 61 | Sandbox class: spawns Worker, bridges toolCall/toolResponse |
| `core/sandbox.worker.ts` | 116 | Sval interpreter in Worker: permission enforcement, tool injection, async wrapper |

#### Modules (9 modules, each with manifest.json + handler)

| Module ID | Type | Enabled | Description | Key Tools |
|-----------|------|---------|-------------|-----------|
| `architect-codegen` | architect | yes | Generates task protocols via LLM | `generateProtocol` |
| `knowledge-repo-browser` | knowledge | yes | GitHub API file browser | `listFiles`, `readFile`, `headFile`, `writeFile`, `deleteFile` |
| `knowledge-artifacts` | knowledge | yes | Named artifact storage (Dexie) | `listArtifacts`, `saveArtifact`, `readArtifact` |
| `knowledge-local-analyzer` | knowledge | yes | Pattern scanner (secrets etc.) | `scan` |
| `executor-local` | executor | yes | Browser sandbox JS execution | `execute` |
| `executor-jules` | executor | yes | Google Jules cloud VM agent | `execute` (ReAct: send→poll→verify→retry) |
| `executor-github` | executor | yes | GitHub Actions workflow runner | `runWorkflow`, `getRunStatus`, `fetchArtifacts` |
| `executor-wasm` | executor | **no** | WASM Linux VM (v86/Wanix) | `execute` (shell commands in ephemeral VM) |
| `channel-user-negotiator` | channel | yes | Human-in-the-loop Q&A | `askUser` |
| `process-project-manager` | process | yes | Project state analysis | `runReview` |

#### Negotiators (2 files)

| File | Purpose | Pattern |
|------|---------|---------|
| `JulesNegotiator.ts` | ReAct loop with Jules cloud VM | send prompt → poll 5s → LLM verify → retry ≤3x |
| `UserNegotiator.ts` | Ask user, await reply | write to Dexie → set WAITING_FOR_USER → await event |

#### Persistence (Dexie, 7 tables)

| Table | Purpose |
|-------|---------|
| `tasks` | Task entities with protocol, globalVars, moduleLogs, chat |
| `messages` | Agent-user mailbox (alerts, proposals, chat) |
| `taskArtifacts` | Named artifacts (design specs, code analysis) |
| `taskArtifactLinks` | Many-to-many: tasks ↔ artifacts |
| `gitCache` | GitHub API response cache |
| `julesSessions` | Jules cloud VM session tracking |
| `projectConfigs` | Per-project constitution/config |

### 13.3 How the Agentic Loop Actually Works

Fleet does NOT have a single agentic loop like Claude Code or YUAN. Instead it has a **two-phase pipeline**:

#### Phase 1: Architecture (LLM-driven planning)
```
User message → parseTasksFromMessage() → Task entity
Task → orchestrator.processTask()
  → architect-codegen.generateProtocol() [LLM call]
  → TaskProtocol { steps[] }
```

The LLM receives the task title + description + available executors, and outputs a JSON protocol — an ordered list of steps, each assigned to an executor.

#### Phase 2: Execution (LLM-generated code in sandbox)
```
For each pending step:
  → composeProgrammerPrompt() [LLM prompt with step context]
  → LLM generates JavaScript code
  → extract code from ``` blocks
  → executeInSandbox(taskId, code, stepId)
    → Sandbox (Sval interpreter in Web Worker)
    → tool calls bridge back to main thread
    → main thread dispatches via ModuleRegistry
    → results return to sandbox
```

**Key insight:** The LLM writes code that CALLS tools. It does not use tool_use/tool_call JSON format. The LLM generates imperative JavaScript that calls injected async functions (e.g., `await readFile('/src/index.ts')`, `await askUser('What color?')`). This is fundamentally different from Claude Code's structured tool_use protocol and closer to CodeAct pattern (Section 5).

#### Error Recovery
- Up to 5 attempts per step
- Error context accumulates: each retry gets the previous error message
- On failure: task → `ERROR` state, pauses
- On user wait: task → `WAITING_FOR_USER`, resumes on `user:reply` event

### 13.4 The Sandbox: Sval in a Web Worker

The execution sandbox is one of the most interesting parts:

```
Main Thread                          Web Worker (sandbox.worker.ts)
┌─────────────────┐                  ┌─────────────────────────┐
│                 │  postMessage     │                         │
│  Sandbox class  │─────────────────▶│  Sval interpreter       │
│                 │  {execute, ...}  │  (ecmaVer: 2019)        │
│                 │                  │                         │
│  toolRequest    │◀─────────────────│  toolCall {name, args}  │
│  handler        │                  │                         │
│      │          │  toolResponse    │                         │
│      ▼          │─────────────────▶│  await result           │
│  ModuleRegistry │                  │                         │
│  .invokeHandler │                  │  Permission checks:     │
│                 │                  │  - network (blocks      │
│                 │                  │    fetch/XHR/WS)        │
│                 │                  │  - timers (blocks       │
│                 │                  │    setTimeout/setInt.)  │
│                 │                  │  - storage (checks      │
│                 │                  │    tool names)          │
│                 │                  │  - logging (console)    │
└─────────────────┘                  └─────────────────────────┘
```

**Permission model:** Each executor module declares permissions in its manifest. The sandbox.worker enforces these:
- `network`: allows fetch, XMLHttpRequest, WebSocket
- `timers`: allows setTimeout, setInterval
- `storage`: allows knowledge-repo-browser and knowledge-artifacts tools
- `logging`: allows console.log/error/warn
- `web-worker`: allows Worker creation (for WASM executor)

**Limitations of Sval:**
- ECMAScript 2019 only — no optional chaining, no nullish coalescing in the sandbox
- No `import` statements — only `require()` style
- Sandboxed globals are injected via `interpreter.import(name, value)`
- Cannot access DOM, window, or any browser APIs unless explicitly injected

### 13.5 The Module System

Fleet's module architecture is a **manifest-driven plugin system**:

```typescript
interface ModuleManifest {
  id: string;                    // e.g. "executor-local"
  type: 'architect' | 'knowledge' | 'executor' | 'channel' | 'process';
  tools: ToolDefinition[];       // JSON Schema parameter descriptions
  sandboxBindings: Record<string, string>;  // alias → toolName mapping
  permissions: string[];         // sandbox permission gates
  configFields?: ConfigField[];  // UI configuration form fields
  enabled?: boolean;             // runtime enable/disable
  init?: (config) => void;       // lifecycle hook
  destroy?: () => void;          // cleanup hook
}
```

**sandboxBindings** is the key innovation — it maps friendly names (like `readFile`) to fully-qualified tool names (like `knowledge-repo-browser.readFile`). The LLM prompt only sees the friendly names, making it easier to generate correct code.

**Tool dispatch flow:**
```
Sandbox code calls readFile('/foo.js')
  → sandbox.worker.ts maps to 'knowledge-repo-browser.readFile'
  → postMessage to main thread
  → ModuleHost receives 'module:request' event
  → ModuleRegistry.invokeHandler('knowledge-repo-browser.readFile', ['/foo.js'], context)
  → RepositoryTool.handleRequest (actual GitHub API call)
  → result flows back through event bus → worker → Sval
```

### 13.6 Executor Tier Analysis

Fleet has 4 executor paths, mapping well to the three tiers from Section 12:

| Executor | Tier | Where It Runs | What It Does | Status |
|----------|------|---------------|--------------|--------|
| `executor-local` | Tier 1 | Browser (Sval) | LLM-generated JS calling knowledge/user tools | **Active** |
| `executor-jules` | Tier 3 | Cloud (Jules VM) | Fully autonomous coding agent in remote VM | **Active** |
| `executor-github` | Tier 3 | Cloud (GitHub Actions) | Workflow YAML → run → poll → fetch artifacts | **Active** |
| `executor-wasm` | Tier 2 | Browser (v86/Wanix) | Shell commands in ephemeral Alpine Linux VM | **Disabled** |

**The missing tier:** There is NO `executor-almostnode` — no path for running real Node.js packages in the browser. This is exactly what YUAN fills.

#### executor-local: CodeAct in Sval
The LLM generates JavaScript code that calls async tool functions. This works well for:
- Reading/writing files (via GitHub API)
- Creating artifacts
- Asking user questions
- Analyzing data

It does NOT work for:
- Running npm packages
- Shell commands
- File system operations (real FS, not GitHub API)
- Network requests (blocked by sandbox permissions unless explicitly granted)

#### executor-wasm: Dead on Arrival (but interesting)
The WASM executor boots a full Wanix Linux VM per execution. From the manifest:
> "Full Alpine Linux environment with network access. Output is collected and returned as artifacts."

**Why it's disabled:** Likely because:
1. v86 VM boot takes 5-10 seconds per execution
2. 10-50x slower than native (as noted in Section 12)
3. The VM is ephemeral — no persistence between steps
4. Requires WISP relay server for network, adding infrastructure dependency
5. Asset bundle (sys.tar.gz + boot.wasm + wanix.min.js) must be served statically

**What it proves:** That a Linux VM CAN run in the browser with network access via WISP. This validates the Tier 2 path from Section 12.

### 13.7 LLM Integration

Fleet makes LLM calls in 3 places:

| Location | Purpose | Provider | Format |
|----------|---------|----------|--------|
| `parseTasksFromMessage()` | Extract tasks from user messages | Gemini or OpenAI | JSON mode |
| `ArchitectTool.generateProtocol()` | Generate step protocol | Via `llmCall()` (host) | JSON mode |
| `composeProgrammerPrompt()` → LLM | Generate executable JS code | Via `llmCall()` (host) | Raw text (code in ``` blocks) |

**The `llmCall` abstraction** in ModuleHost:
```typescript
async llmCall(prompt: string, jsonMode?: boolean): Promise<string>
```
- Gemini: uses `@google/genai` SDK directly
- OpenAI: raw `fetch()` to configurable endpoint (supports any OpenAI-compatible API)
- Single-turn only (no conversation history in the call itself)
- Temperature: 0.1 (deterministic)
- No streaming

**Gap:** No conversation history management. Each LLM call is a single prompt → response. The orchestrator manually assembles context (task title, description, step info, GlobalVars, error context) into the prompt, but there's no automatic context window management like Claude Code's.

### 13.8 Human-in-the-Loop: The User Negotiator

The `channel-user-negotiator` module provides the HITL mechanism:

```
Agent code calls askUser("What color should the button be?")
  → UserNegotiator.negotiate(taskId, question)
  → Writes message to Dexie `messages` table
  → Sets task.agentState = 'WAITING_FOR_USER'
  → Awaits 'user:reply' event on EventBus
  → User replies via UI → emits 'user:reply'
  → Optional LLM format validation of reply
  → Returns reply string to sandbox code
```

**This is genuinely well-designed:**
- Non-blocking: event-driven, doesn't freeze the UI
- Persistent: uses Dexie, survives page reloads
- Deduplication: checks if question was already asked
- Format validation: optional LLM check that reply matches expected format
- Clean state machine: WAITING_FOR_USER ↔ EXECUTING

**What it's missing compared to Claude Code:**
- No rich interactive elements (file picker, dropdown, multi-choice)
- No auto-approval for safe operations
- No permission tiers (approve once vs. approve for session)

### 13.9 Persistence & State

Fleet persists everything to IndexedDB via Dexie:

| What's persisted | Where | Survives reload? |
|------------------|-------|-----------------|
| Tasks + protocols | `tasks` table | Yes |
| Module logs | `tasks.moduleLogs` | Yes |
| Chat history | `tasks.chat` | Yes |
| Agent-user messages | `messages` table | Yes |
| Artifacts | `taskArtifacts` table | Yes |
| GlobalVars | `tasks.globalVars` | Yes (per task) |
| GitHub API cache | `gitCache` table | Yes |
| Jules sessions | `julesSessions` table | Yes |
| Project config | `projectConfigs` table | Yes |

**GlobalVars** is the cross-step state mechanism: a `Record<string, any>` attached to each task. Steps can `GlobalVars.set(key, value)` and `GlobalVars.get(key)` to pass data between steps. This is similar to Claude Code's context accumulation but simpler — it's just a flat key-value store, not a structured context window.

### 13.10 The Server: Minimal Infrastructure

The Node.js server (`server.ts`, 276 LOC) provides three things:

1. **COOP/COEP headers** — Required for `SharedArrayBuffer` (which almostnode/WASI workers need)
2. **`/api/mcp/execute`** — In-place agent API: file ops, git clone, command execution (15s timeout)
3. **`/proxy`** — CORS proxy for v86 VM networking (auto-upgrades HTTP→HTTPS)
4. **`/wisp`** — WISP relay bridging v86 VM WebSocket to real TCP sockets

**Critical:** The server does NOT participate in the agent loop. All orchestration, LLM calls, and sandbox execution happen in the browser. The server is infrastructure only.

### 13.11 The YUAN Integration Point

From `test-yuan-almostnode.html`, we know YUAN runs in almostnode in the browser with a single shim:

```javascript
// openai shim: bridges to boardVM.llmfs.sendRequest()
container.vfs.writeFileSync('/node_modules/openai/index.js', `
  function OpenAI(opts) {
    this.chat = { completions: new Completions(this) };
  }
  Completions.prototype.create = async function(params) {
    var result = await boardVM.llmfs.sendRequest(JSON.stringify(req));
    return JSON.parse(result);
  };
  module.exports = { OpenAI: OpenAI };
`);
```

This means the LLM bridge already works. The openai shim converts OpenAI SDK calls into `boardVM.llmfs.sendRequest()` calls, which presumably route to the same Gemini/OpenAI infrastructure that Fleet's `llmCall()` uses.

**Where YUAN plugs into Fleet's module system:**

```
New module: executor-almostnode (Tier 1)
  manifest.json:
    type: executor
    tools: [{ name: "executor-almostnode.runAgent", ... }]
    sandboxBindings: { /* YUAN tools would be available inside almostnode */ }
    permissions: ["storage"]

  Handler:
    - Creates almostnode container
    - Installs @yuaone/core + @yuaone/tools
    - Registers openai shim
    - Runs agent loop with task context
    - Returns results
```

But this raises a fundamental architectural question (see 13.13).

### 13.12 Gap Analysis: Fleet vs. Section 12's "Honest Architecture"

Mapping Fleet's current capabilities against the 10 best ideas from Section 12.1:

| # | Best Idea | Fleet Has? | Notes |
|---|-----------|------------|-------|
| 1 | Deterministic Decision Engine | **No** | Architect uses LLM for protocol generation. No YUAN-style intent/complexity/risk classification |
| 2 | Content-addressed file editing | **No** | Uses GitHub API write (full file replace). No SEARCH/REPLACE |
| 3 | Permission tiers (approve once/session/always) | **Partial** | Binary permissions in sandbox (allow/deny). No user approval UI for tool calls |
| 4 | U-curve prompt positioning | **No** | Prompts are functional but not optimized for U-curve |
| 5 | Security SSOT | **No** | Security rules scattered across sandbox.worker.ts permissions + manifest declarations |
| 6 | Sub-agent spawning | **No** | Single orchestrator. No recursive agent spawning |
| 7 | Context window management | **Minimal** | Single-turn LLM calls with manually assembled context. No auto-summarization, no priority truncation |
| 8 | Multi-provider LLM | **Yes** | Gemini (native SDK) + OpenAI-compatible (raw fetch). Well-implemented |
| 9 | Manifest-driven module system | **Yes** | Excellent. 9 modules, JSON manifests, sandboxBindings, lifecycle hooks |
| 10 | HITL event-driven negotiator | **Yes** | Well-designed. Event bus, Dexie persistence, format validation |

**Score: 3/10 ideas implemented, 1 partial.**

### 13.13 The Architectural Tension: Two Incompatible Patterns

Fleet and YUAN represent two fundamentally different approaches to the "agentic loop" problem. This is the central tension:

#### Fleet: LLM-Generated Code (CodeAct pattern)
```
LLM prompt → LLM generates JavaScript → Sval executes → tool calls bridge back
```
- LLM is a **code generator**
- Tools are **async JavaScript functions** injected into the sandbox
- The LLM must write correct JS to call tools correctly
- Sval interprets the code (slow, ES2019 limited)
- No structured tool schema visible to the LLM at call time (only in prompt text)

#### YUAN: Structured Tool Use (OpenAI function calling pattern)
```
LLM prompt → LLM returns tool_call JSON → Decision Engine routes → handler executes → result back to LLM
```
- LLM is a **decision maker**
- Tools are **structured JSON definitions** (name, description, parameters)
- The LLM returns tool_use blocks, not code
- YUAN's runtime calls the actual tool handlers
- Full tool schema in the API request (model sees it natively)

**These are NOT compatible without an adapter layer.** You cannot simply "drop YUAN into Fleet's module system" because:
1. Fleet's sandbox expects LLM to write code that calls functions
2. YUAN's loop expects LLM to return structured tool_call JSON
3. YUAN uses OpenAI's function calling protocol; Fleet uses a custom code-generation protocol

#### Resolution Paths

**Path A: YUAN as a Black-Box Executor (simplest)**
Add `executor-almostnode` module that runs YUAN inside almostnode as a complete agent. Fleet's orchestrator passes task context to YUAN, YUAN does its own loop internally, returns results. The two systems don't integrate at the tool level — YUAN is just another executor like Jules.

**Effort:** ~200 LOC (module manifest + handler + openai shim + almostnode bootstrap)
**Tradeoff:** YUAN has its own tool set (shell, file read/write, glob, grep). Fleet's module tools (GitHub browser, artifacts) are not available inside YUAN unless bridged.

**Path B: YUAN Tools as Fleet Sandbox Bindings (medium)**
Extract YUAN's tool implementations from `@yuaone/tools` and make them available as Fleet sandbox bindings. The LLM still generates code, but now it can call YUAN's file/glob/grep tools via the existing sandbox bridge.

**Effort:** ~400 LOC (adapter layer + VFS bridge + tool wrappers)
**Tradeoff:** You lose YUAN's structured tool_use protocol (the model sees tools as JS functions, not JSON schema). But you gain access to YUAN's tools within Fleet's existing architecture.

**Path C: Replace Fleet's Loop with YUAN's Loop (most ambitious)**
Replace `orchestrator.runStep()`'s LLM-codegen-Sval pipeline with YUAN's AgentLoop. The orchestrator becomes a thin wrapper that creates YUAN agent instances and feeds them task context.

**Effort:** ~800 LOC (rewrite orchestrator, adapt module tools to YUAN format, new prompt templates)
**Tradeoff:** You gain YUAN's Decision Engine, structured tool use, and retry logic. But you lose Fleet's current module system (unless you write a YUAN tool adapter for each module).

### 13.14 What Fleet Does Well (Keep These)

1. **Module system design** — Manifest-driven, pluggable, lifecycle hooks. This is genuinely good architecture. Keep it regardless of which executor path is chosen.

2. **Event bus decoupling** — Modules communicate through typed events. Clean separation of concerns. No module needs to know about other modules.

3. **Human-in-the-loop** — The UserNegotiator is well-implemented. Event-driven, persistent, with format validation. This is better than most harness HITL implementations.

4. **Multi-provider LLM** — Gemini + OpenAI via a simple abstraction. Easy to add more providers.

5. **Dexie persistence** — Everything survives page reload. Task state, logs, messages, artifacts. Production-quality.

6. **Permission enforcement** — The sandbox.worker.ts permission checks are simple but effective. They run BEFORE tool calls, not after.

7. **GlobalVars cross-step state** — Clean mechanism for passing data between protocol steps without coupling them.

### 13.15 What Fleet Needs (Critical Gaps)

1. **No real file system access** — `executor-local` can only touch GitHub API files. No local FS, no npm packages, no shell commands in the browser. YUAN+almostnode fills this completely.

2. **No structured tool use** — The LLM generates code that calls functions. This is fragile — the LLM must write syntactically correct JS, use the right function names, handle async/await properly. Structured tool_use (like OpenAI function calling) is more reliable.

3. **No context window management** — Single-turn LLM calls with no history tracking. For complex tasks, the LLM has no memory of what it tried before (except via GlobalVars and error context).

4. **No decision engine** — Every step requires an LLM call, even simple routing decisions. YUAN's deterministic classification would eliminate many unnecessary LLM calls.

5. **Sval is limiting** — ES2019, no native module support, no DOM access. almostnode provides a real Node.js environment (with VFS) that can run actual npm packages.

6. **No sub-agent architecture** — Single flat orchestrator. Cannot spawn specialized sub-agents for different aspects of a task.

7. **WASM executor is dead** — Disabled, and likely not worth reviving given almostnode is faster and more capable for most use cases.

### 13.16 Recommended Integration Strategy

Based on this analysis, the optimal path is **Path A (YUAN as black-box executor) with elements of Path B**:

```
Phase 1: executor-almostnode module (~200 LOC)
  - New Fleet module that creates an almostnode container
  - Installs YUAN, registers openai shim
  - Passes task context as initial prompt
  - YUAN runs its full agent loop internally
  - Returns results (files changed, output, errors) to Fleet
  - Result gets saved as artifacts, logged in moduleLogs

Phase 2: Tool bridge for Fleet modules (~300 LOC)
  - Allow YUAN (inside almostnode) to call Fleet's knowledge tools
  - Bridge: YUAN tool → almostnode message → Fleet event bus → module handler
  - This gives YUAN access to GitHub browser, artifacts, user negotiator

Phase 3: Decision Engine adoption (~200 LOC)
  - Extract YUAN's Decision Engine (intent/complexity/risk classifier)
  - Use it in Fleet's orchestrator for step routing
  - Skip LLM call for simple decisions ("just run a file read? don't ask LLM")
```

**Total: ~700 LOC** to get YUAN running as a first-class Fleet executor with access to Fleet's tool ecosystem.

**What this gives us:**
- Real shell commands in the browser (via almostnode)
- npm package execution in the browser
- File system operations (read, write, glob, grep) in the browser
- Deterministic routing for simple tasks
- YUAN's agent loop handles retries, tool orchestration, and error recovery
- Fleet retains its module system, event bus, HITL, and persistence

### 13.17 File Count & LOC Summary

```
Fleet Source Inventory (src/ only, excluding UI components):

Core runtime:        6 files, ~700 LOC
Sandbox system:      2 files, ~180 LOC
Module handlers:    ~12 files, ~800 LOC (est.)
Negotiators:         2 files, ~200 LOC
Services (DB, etc):  ~5 files, ~300 LOC (est.)
Types/interfaces:    2 files, ~120 LOC
─────────────────────────────────────────
Total:              ~29 files, ~2,300 LOC (backend logic)

Server:              1 file,  276 LOC
WASM executor:       2 files, ~150 LOC (disabled)
Test HTML:           1 file,  260 LOC
─────────────────────────────────────────
Grand total:        ~33 files, ~3,000 LOC
```

---

## 14. Sources & References

### Claude Code Architecture (from leak)

| Source | URL |
|--------|-----|
| Kuberwastaken/claurst (8.9k stars) | https://github.com/Kuberwastaken/claurst |
| Spec directory (14 architecture docs) | https://github.com/Kuberwastaken/claurst/tree/main/spec |
| Blog: Full technical writeup of the leak | https://kuber.studio/blog/AI/Claude-Code's-Entire-Source-Code-Got-Leaked-via-a-Sourcemap-in-npm,-Let's-Talk-About-it |
| arielril/claurst (original, archived) | https://github.com/arielril/claurst |
| oliverking2/claurst (breakdown + discoveries) | https://github.com/oliverking2/claurst |

### Official Documentation

| Resource | URL |
|----------|-----|
| Claude Code GitHub | https://github.com/anthropics/claude-code |
| Claude Code Docs | https://code.claude.com/docs/en/overview |
| Anthropic API Docs | https://docs.anthropic.com/en/docs |
| Tool Use Guide | https://docs.anthropic.com/en/docs/build-with-claude/tool-use |
| Prompt Caching | https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching |
| MCP Specification | https://modelcontextprotocol.io/ |
| Anthropic Blog (agents) | https://www.anthropic.com/research |

### Competitor Repos

| Tool | URL |
|------|-----|
| Aider | https://github.com/paul-gauthier/aider |
| SWE-agent | https://github.com/SWE-agent/SWE-agent |
| mini-SWE-agent | https://github.com/SWE-agent/mini-swe-agent |
| OpenHands | https://github.com/All-Hands-AI/OpenHands |
| Cline | https://github.com/cline/cline |

### Academic Papers

| Paper | Year |
|-------|------|
| SWE-agent: Agent-Computer Interfaces (NeurIPS) | 2024 |
| ReAct: Synergizing Reasoning and Acting | 2023 |
| Toolformer: Language Models Can Teach Themselves to Use Tools | 2023 |
| Reflexion: Language Agents with Verbal Reinforcement Learning | 2023 |
| Tree of Thoughts: Deliberate Problem Solving with LLMs | 2023 |
| CodeAct: Unified Action Space for LLM Agents | 2024 |

### Open Source Frameworks

| Framework | URL |
|-----------|-----|
| OpenAI Agents SDK | https://github.com/openai/openai-agents-python |
| LangGraph | https://github.com/langchain-ai/langgraph |
| CrewAI | https://github.com/crewAIInc/crewAI |
| AutoGen | https://github.com/microsoft/autogen |
| DSPy | https://github.com/stanfordnlp/dspy |

### YUAN CLI

| Resource | URL |
|----------|-----|
| GitHub (private source) | https://github.com/yuaone/yuan |
| npm: @yuaone/cli | https://www.npmjs.com/package/@yuaone/cli |
| npm: @yuaone/core | https://www.npmjs.com/package/@yuaone/core |
| npm: @yuaone/tools | https://www.npmjs.com/package/@yuaone/tools |
| Libraries.io | https://libraries.io/npm/@yuaone%2Fcli |

---

## 15. Fleet Main Branch Audit

> Full code-level audit of `k0inwork/kanban-jules` main branch (2026-04-12).
> Cloned to `/tmp/kanban-main-analysis/`. ~30 source files across `src/`, `docs/`, and module manifests.

### 15.1 What Changed vs. Review Branch

The main branch has evolved significantly from the review branch analyzed in Section 13:

| Area | Review Branch (Section 13) | Main Branch |
|------|---------------------------|-------------|
| DB Schema | v15 | v18 (3 migrations applied) |
| Global state | `globalVars` | Renamed to `agentContext` (v18 migration) |
| Task logs | `jnaLogs`, `unaLogs`, `programmingLog`, `actionLog`, `logs` (scattered fields) | All consolidated into `moduleLogs` object keyed by module ID |
| Local executor | Concept only | Stub `LocalHandler.ts` — returns `{status: 'success'}` (real execution is the Sval sandbox) |
| GitHub executor | Concept only | Full `GithubHandler.ts` (485 lines) — YAML parsing, temp branch creation, polling, artifact fetch |
| Jules executor | Concept only | Full `JulesSessionManager.ts` (199 lines) + `JulesNegotiator.ts` (330 lines) |
| Sandbox | Concept only | `sandbox.worker.ts` (157 lines) — Sval interpreter, seeded determinism, permission gates, tool bridge |
| AgentContext | Not present | `AgentContext.ts` (42 lines) — Map-based registry with singleton export |
| Constitution | 3 templates | 5 templates, per-executor constitutions incoming |
| Module system | Ad hoc imports | Manifest-based: 9 modules with `manifest.json` defining type, tools, bindings, permissions, configFields |

**Key architectural shifts:**
- **Schema v18**: The `globalVars` → `agentContext` rename is semantic — the field now clearly represents the persistent cross-step state that the agent layer reads/writes.
- **Log consolidation**: All module-level logs are now under `task.moduleLogs[moduleId]` instead of scattered top-level fields. This is critical for the agent — it can read per-module logs to understand what each subsystem did.
- **Manifest system**: Each module declares its type (`architect|knowledge|executor|channel|process`), tools, sandbox bindings, and permissions. This is the plugin API the agent can introspect.

### 15.2 Module Manifests — The Real System

All 9 modules and their manifest declarations:

```
MODULE ID               TYPE       TOOLS                                    SANDBOX BINDINGS                              PERMS
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
architect-codegen       architect   generateProtocol                         (none — operates at prompt level)             —
executor-local          executor    (none — stub)                            listFiles, readFile, headFile, writeFile,     storage
                                                                            saveArtifact, listArtifacts, askUser, sendUser
executor-jules          executor    (none — uses JulesNegotiator)            askJules                                      —
executor-github         executor    runWorkflow, runAndWait, fetchLogs,      askUser                                       network,
                            getRunStatus, fetchArtifacts                                                         storage, timers
knowledge-artifacts     knowledge   (Gemini FunctionDeclarations)            (none — Dexie CRUD)                           —
knowledge-repo-browser  knowledge   (Gemini FunctionDeclarations)            (none — wraps GitFs)                          —
knowledge-local-analyzer knowledge  (pattern scanning)                       (none — wraps file listing)                   —
channel-user            channel     (event-driven mailbox)                   (none — UserNegotiator)                       —
process-project-manager process     project review                           (none — ProcessAgent)                         —
```

**What this means for the agent:**

1. **Type-based routing**: The `composeArchitectPrompt()` function in `prompt.ts` lists executors by reading their manifest types. The agent can do the same — read manifests, identify executor capabilities, and make routing decisions.

2. **sandboxBindings = the agent's API surface**: Each executor declares what functions it exposes into the Sval sandbox. The agent's generated code can only call these bindings. This is the permission boundary.

3. **Permission gates**: `storage` (file system), `network` (fetch/XHR/WS), `timers` (setTimeout/setInterval). The sandbox worker enforces these in `sandbox.worker.ts` by patching `fetch`, `XMLHttpRequest`, `WebSocket`, and checking tool names before allowing `setTimeout`.

4. **Gemini FunctionDeclarations**: Knowledge modules export Gemini tool schemas directly. This means the LLM in the cloud (Gemini) can call these tools natively via function calling — the agent doesn't need to mediate.

### 15.3 Three Executors — Actual Implementation

#### Local Executor (`executor-local`)

```typescript
// LocalHandler.ts — 22 lines, entirely stub
static async handleRequest(_request: any): Promise<{status: string, message: string}> {
  return { status: 'success', message: 'Code executed locally.' };
}
```

**Reality**: "Local execution" means the LLM-generated protocol code runs in the Sval sandbox with injected bindings. The `handleRequest` is vestigial — the actual execution path is:
1. `composeProgrammerPrompt()` builds a prompt listing all available bindings
2. LLM generates JavaScript using only those bindings
3. Code is sent to the Sval interpreter in `sandbox.worker.ts`
4. Tool calls bridge from Sval → postMessage → Fleet module handlers → response

**Agent implication**: The local executor is the most transparent to the agent. Every tool call passes through the bridge and is logged. The agent can audit exactly what was called, with what arguments, and what was returned.

#### Jules Executor (`executor-jules`)

**SessionManager** (`JulesSessionManager.ts`, 199 lines):
- `reuseSessions = false` — always creates a fresh session
- Source context: constructs `sources/github/{owner}/{repo}` from repo URL
- Plan approval: `requiresPlanApproval: true` — polls until session exits QUEUED state, then auto-approves generated plans
- Polling: checks activities via paginated API (100 per page), filters by `createTime` for new activities

**Negotiator** (`JulesNegotiator.ts`, 330 lines):

The JulesNegotiator is the most complex executor interface. Its negotiation loop:

```
send prompt → poll activities (5s interval, 15min timeout)
  ├─ progressUpdated → LLM verify against success criteria → if match, break
  ├─ planGenerated → auto-approve
  ├─ agentMessaged → capture response, break
  ├─ sessionCompleted → break
  ├─ sessionFailed → throw
  ├─ AWAITING_USER_FEEDBACK (no new activity) → LLM analyze transcript
  │    ├─ has_result → break with result
  │    ├─ needs_action → send action prompt, continue polling
  │    └─ working → send "please continue", continue polling
  ├─ idle 3min → send check-in
  └─ idle 10min → delete session, throw error

after break → fetch session outputs (PR URLs, branch names)
            → LLM verify against success criteria
            → if fail, send feedback, retry (max 3 attempts)
```

**Key behaviors the agent must understand:**
- Jules can create PRs and branches — the agent must extract branch names from responses
- Rate limiting is handled with exponential backoff (10s, 20s, 30s...)
- Session sends are retried up to 5 times for 404/412 errors
- The system instruction tells Jules to always output results in chat (not just files)

#### GitHub Actions Executor (`executor-github`)

**Handler** (`GithubHandler.ts`, 485 lines):

```
runWorkflow(yamlContent, branch):
  1. Parse YAML → force `on: push` → inject temp branch name
  2. GitFs: get base SHA → create temp branch → write workflow YAML
  3. Poll GitHub API for run ID (30s timeout per poll)
  4. Return run ID

runAndWait(yamlContent, branch, timeout=5min):
  1. runWorkflow()
  2. Poll getRunStatus() until complete
  3. Cleanup temp branch
  4. Return { status, conclusion, logs }

fetchArtifacts(runId):
  1. List artifacts → download each as base64
  2. Save to Dexie via TaskFs
```

**Known bug**: `getRunStatus()` calls `fetchWithRetry()` (undefined) instead of `this.fetchWithRetry()`. This will throw at runtime.

**Agent implication**: GitHub Actions is the CI/CD executor. The agent can:
- Construct workflow YAMLs and submit them
- Chain multiple workflow runs (each `runAndWait` creates/cleans a temp branch)
- Fetch artifacts (test results, build outputs) into Dexie for analysis

### 15.4 Constitution System — Current State

**5 static templates** in `src/lib/constitutions.ts`:

| Template | Scope | Key Rules |
|----------|-------|-----------|
| Default | Generic | Obey instructions, use available tools, report clearly |
| Frontend | React/UI | Component-first, test in browser, responsive |
| Backend | API/Server | REST conventions, error handling, input validation |
| Full-Stack | Combined | Separation of concerns, API contracts, end-to-end |
| Custom | User-defined | Empty skeleton for user customization |

**Per-executor constitutions** (confirmed by user, not yet in main branch):

Each executor will have its own constitution — a behavior profile that constrains and guides that executor's actions. This is distinct from the static templates above. Executor constitutions define:
- What the executor *should* do (capabilities, preferred patterns)
- What the executor *shouldn't* do (anti-patterns, limitations)
- How the executor should communicate results (format, verbosity, channel)

**Agent's role in executor constitutions:**
1. **Read**: Before routing a task, the agent reads the target executor's constitution to ensure compatibility
2. **Maintain**: After observing executor behavior (success/failure patterns), the agent updates the constitution with empirical corrections
3. **Detect conflicts**: If two executor constitutions have contradictory rules (e.g., Jules says "always create PRs" but the project constitution says "no direct commits to main"), the agent flags this
4. **Suggest improvements**: Based on error patterns, the agent proposes constitution amendments

### 15.5 docs/ Folder — Planned Architecture

The `docs/` folder describes a system far more ambitious than what's implemented:

| Document | Key Claims | Implementation Status |
|----------|-----------|----------------------|
| `agents.md` | ReAct protocol, Negotiator pattern (JNA/UNA/CNA), Semantic Contracts, Global Variable Registry | ReAct partial (architect prompt), Negotiators implemented (JNA/UNA), CNA not implemented, agentContext exists |
| `DESIGN_PHILOSOPHY.md` | 5 principles: autonomy+HITL, sandboxed execution, subagent delegation, persistent state, task-centric UI | All 5 reflected in current code |
| `modules-catalog.md` | 30+ future modules | 9 implemented, catalog is aspirational |
| `status_1_04.md` | "Distributed Agentic System" with ReAct loops | Partially implemented — ReAct loop exists but only single-loop, no distributed agents |

**`modules-catalog.md` deep dive** (1229 lines) — planned modules the agent should be aware of:

- **Architect variants**: simple, describer, planner, DAG (dependency-aware task decomposition)
- **Executors**: WASM, OpenClaude, Docker, browser automation, SQL, image generation
- **Knowledge sources**: Jira, Notion, web scrape, git log analysis, vector search, dependency graph, metrics
- **Channels**: Telegram, email, Slack, SMS
- **Process modules**: dependency tracker, regression guard, stale task cleanup, milestone planner, review synthesizer, GitHub webhook, cron scheduler, file watcher

**Gap analysis**: The gap between docs/ and implementation is ~70%. The core loop works (task creation → architect → executor → result), but the extensibility layer (manifest-based module loading, dynamic registration) is not yet pluggable. Modules are imported directly, not loaded from a registry.

### 15.6 What the Agent Can Leverage Today

**Immediate hooks** (available in current main branch):

| Hook | Mechanism | Agent Use |
|------|-----------|-----------|
| `agentContext` (Dexie field) | Map-based registry, survives task restarts | Store cross-step state: task routing decisions, executor observations, error counts |
| `moduleLogs[moduleId]` | Per-module log strings on each task | Read to diagnose failures: check `executor-jules` logs for API errors, `architect` logs for planning decisions |
| `manifest.json` | Type, tools, bindings, permissions | Dynamically discover what executors are available and what they can do |
| `eventBus` | EventEmitter for inter-module communication | Listen for `module:log` events in real-time, emit custom events |
| `db.messages` | Mailbox system | Read user messages, send status updates, check for human-in-the-loop decisions |
| `db.taskArtifacts` | Artifact storage | Read/write analysis results, intermediate data, reports |
| `db.projectConfigs` | Per-project constitution storage | Read/write constitution, detect changes |

**Agent workflow integrated with Fleet:**

```
1. AGENT STARTUP
   ├─ Read projectConfigs → load constitution
   ├─ Scan task list → identify pending/in-progress tasks
   └─ Read moduleLogs for recent tasks → build situational awareness

2. TASK MONITORING LOOP
   ├─ Listen to eventBus for module:log events
   ├─ On task completion: verify result against success criteria
   ├─ On task failure: log error pattern to constitution
   └─ On Jules idle timeout: record as executor weakness

3. CONSTITUTION MAINTENANCE
   ├─ Track executor success rates per task type
   ├─ Update executor profiles (daily_limit, avg_duration, failure_modes)
   ├─ Detect cross-constitution conflicts
   └─ Propose amendments to user via mailbox

4. TASK ROUTING (when creating new tasks)
   ├─ Read executor constitutions
   ├─ Match task type to executor strengths
   ├─ Check daily limits / rate limits
   └─ Set appropriate success criteria format
```

**Technical constraints the agent must respect:**

1. **No Node.js built-ins in sandbox**: Sval only supports ES2019. The agent's generated code for local execution must use only the declared sandbox bindings.
2. **Tool call bridge is async**: Every tool call from sandbox → Fleet module goes through `postMessage`. The agent cannot make synchronous external calls.
3. **GitFs is shallow**: `depth=1`, single branch. The agent can't access git history beyond the latest commit.
4. **Dexie is browser-only**: All data persistence is IndexedDB. The agent can't use filesystem or network storage directly.
5. **Jules always creates new sessions**: No session reuse. Each task gets a fresh Jules VM. Context must be passed in the prompt.
6. **GitHub Actions temp branches**: Each workflow run creates and cleans up a temp branch. Concurrent runs are safe but each is isolated.

**What to build next** (priority order for the agent layer):

1. **Constitution reader/writer** — Read `projectConfigs`, parse rules, write amendments. ~40 LOC.
2. **Executor profiler** — Track success/failure per executor, update `agentContext`. ~30 LOC.
3. **Task result verifier** — Post-execution check of task results against success criteria. ~25 LOC.
4. **Module manifest introspector** — Read manifests, build capability map for routing. ~20 LOC.
5. **Event bus listener** — Subscribe to `module:log`, aggregate into agent context. ~15 LOC.
