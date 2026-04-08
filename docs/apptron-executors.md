# Apptron Executor Profiles: Spec

Two Apptron-based execution environments for the Fleet board.

---

## 1. Isolated Sandbox Executor (`executor-wasm-local`)

### Concept

A headless WASM Linux VM booted inside the browser. The board's GitFs repository is mounted as the VM's filesystem. Code runs inside — tests, analysis, transforms — with no network and no access to anything outside the repo.

### Architecture

```
Browser (existing board tab)
│
├── Board UI (React, Dexie, EventBus, ModuleHost — all existing)
│
└── Web Worker (headless)
    │
    ├── Wanix Kernel (wanix.min.js + boot.wasm)
    │   VFS mounts:
    │     /repo     → gitfs (current repo, read-write)
    │     /tmp      → memfs
    │     /home     → memfs
    │     /usr      → memfs (busybox, esbuild pre-bundled)
    │
    │   NOT mounted:
    │     ✗ network relay
    │     ✗ board 9p
    │     ✗ syncfs / opfs / httpfs
    │     ✗ any outbound connection
    │
    └── v86 VM
        Alpine Linux (32-bit, stripped)
        No eth0. No NIC. Loopback only.
```

### What lives inside

- `/repo/` — the repository from GitFs (read and write). This IS the project. Whatever the step writes here persists as repo changes.
- `/tmp/`, `/home/` — scratch space, memfs, wiped on VM reset.
- `/usr/bin/` — busybox (sh, make, sed, awk), esbuild, node (if bundled), python (if bundled).
- No `apk`. No `curl`. No `git` (the repo is already mounted).

### Lifecycle

```
1. Board creates task → architect generates protocol
2. Step assigned to executor-wasm-local
3. Host spins up Web Worker → boots Wanix → boots v86 → mounts gitfs
   (boot takes ~3-5s; keep VM warm between steps)
4. Host writes step code to /tmp/step.js
5. Host sends: sh -c "node /tmp/step.js"
6. Step code runs. It can:
   - Read/write files in /repo/ (the actual repo)
   - Compute, transform, generate
   - Run tests: sh -c "cd /repo && make test"
   - Build: sh -c "cd /repo && esbuild ..."
   - It CANNOT: fetch, curl, git clone, phone home
7. Host reads stdout/stderr + exit code
8. On exit code 0: mark step complete, collect /repo changes as artifacts
9. On exit code ≠ 0: retry with error context (same as current orchestrator loop)
10. After all steps done: tear down VM (or keep warm for next task)
```

### Module Manifest

```json
{
  "id": "executor-wasm-local",
  "name": "WASM Isolated Sandbox",
  "version": "1.0.0",
  "type": "executor",
  "description": "Runs step code in a WASM Linux VM. The repo is mounted read-write. No network access. Safe for untrusted code.",
  "tools": [
    {
      "name": "executor-wasm-local.execute",
      "description": "Execute a shell command or script inside the isolated VM. The repo is at /repo.",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string",
            "description": "Shell command to run. CWD is /repo."
          }
        },
        "required": ["command"]
      }
    },
    {
      "name": "executor-wasm-local.readFile",
      "description": "Read a file from the VM filesystem.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "executor-wasm-local.writeFile",
      "description": "Write a file in the VM filesystem.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["path", "content"]
      }
    }
  ],
  "permissions": ["storage"],
  "configFields": [
    {
      "key": "memoryMB",
      "type": "number",
      "label": "VM Memory (MB)",
      "description": "RAM allocated to the WASM VM.",
      "default": 512,
      "required": false
    }
  ]
}
```

### Prompt Hint for Architect

When the architect sees this executor in the registry:

> **executor-wasm-local**: Best for code that manipulates the repo directly — running tests, building artifacts, linting, transforming files, generating code. No internet. The repo is at `/repo`. Use `command` to run shell commands. Step code runs as a shell command inside Alpine Linux.

### What the LLM generates

The prompt for this executor would instruct the LLM to output a shell command rather than JavaScript:

```
Current Step: Run unit tests
Step Description: Execute the project's test suite and report results.

Write a shell command that accomplishes this step.
The repo is mounted at /repo. You have: sh, make, node, esbuild, sed, awk, grep.
No network access.

Output ONLY the shell command. No markdown.
```

The LLM returns something like: `cd /repo && npm test 2>&1 || make test 2>&1`

### Security

- VM has no NIC. Even if code tries `fetch()`, the network stack doesn't exist.
- GitFs mount is the only writable persistent surface. Everything else is memfs.
- VM runs in a Web Worker — already sandboxed by the browser.
- No access to board state, board DB, other tasks, user tokens, or any API keys.

---

## 2. Board Terminal (`channel-wasm-terminal`)

### Concept

A terminal panel embedded in the board UI (right side). It runs a full Apptron WASM Linux environment with network access. The board's API surface is mounted as a 9p filesystem at `/board/`. An OpenClaude (Claude Code) instance can run inside this terminal, giving it tool-level access to control the board via filesystem operations.

This is a **channel module** — it's how a human (or a Claude instance) interacts with the board.

### Architecture

```
Browser (board tab)
│
├── Left: Kanban Board UI (existing)
│         ┌─────────────┐
│         │  Task cards  │
│         │  Module panel│
│         │  Config      │
│         └─────────────┘
│
└── Right: Terminal Panel (new)
          ┌─────────────────────────────────────┐
          │ xterm.js                             │
          │                                     │
          │  ┌───────────────────────────────┐  │
          │  │ Apptron WASM VM               │  │
          │  │ Alpine Linux + network        │  │
          │  │                               │  │
          │  │ /board/  (9p → BoardFS)       │  │
          │  │ /project/ (gitfs, read-write)  │  │
          │  │ /home/   (syncfs, persisted)   │  │
          │  │ /net     (relay → internet)    │  │
          │  │                               │  │
          │  │ Running inside:                │  │
          │  │   sh, git, node, python, apk   │  │
          │  │   claude (OpenClaude CLI)      │  │
          │  │   custom scripts               │  │
          │  └───────────────────────────────┘  │
          └─────────────────────────────────────┘
```

### The BoardFS Mount

The terminal VM sees the board as a filesystem at `/board/`:

```
/board/
├── tasks/
│   ├── list                     # read → JSON array of all tasks
│   ├── create                   # write → "title\ndescription" → returns task ID on stdout
│   └── {task-id}/
│       ├── meta                 # read → JSON: title, description, status, agentState
│       ├── status               # read/write → get or set workflowStatus
│       ├── protocol             # read → JSON step protocol
│       ├── step                 # write → stepId to mark in_progress
│       ├── logs                 # read → all module logs (blocking = tail -f)
│       └── artifacts/
│           ├── list             # read → artifact names
│           └── {name}           # read → artifact content
│
├── modules/
│   ├── list                     # read → JSON: all enabled modules
│   └── {module-id}/
│       ├── manifest             # read → module manifest JSON
│       ├── config               # read/write → module config as JSON
│       └── invoke               # write → '{"tool":"...","args":{...}}' → read → result
│
├── config/
│   ├── api-provider             # read/write
│   ├── repo-url                 # read/write
│   ├── repo-branch              # read/write
│   └── autonomy-mode            # read/write: "supervised" | "full"
│
├── events/
│   └── stream                   # read (blocking) → newline-delimited JSON events
│                                 #   {"type":"task:created","task":{...}}
│                                 #   {"type":"step:completed","taskId":"...","stepId":1}
│                                 #   {"type":"module:log","taskId":"...","message":"..."}
│                                 #   {"type":"task:error","taskId":"...","error":"..."}
│
└── messages/
    ├── list                     # read → board messages
    ├── send                     # write → "content" → sends message to board inbox
    └── proposals/
        ├── list                 # read → pending proposals
        └── {id}/
            ├── accept           # write → accept proposal
            └── reject           # write → reject proposal
```

### How the terminal controls the board

A user (or Claude) types in the terminal:

```bash
# List tasks
cat /board/tasks/list | jq '.[] | .title'

# Create a task
echo "Fix authentication bug\nThe login redirect is broken on Safari" > /board/tasks/create
# stdout: task-abc123

# Watch what happens
tail -f /board/events/stream
# {"type":"task:created","task":{"id":"task-abc123","title":"Fix authentication bug"}}
# {"type":"step:started","taskId":"task-abc123","stepId":1,"title":"Analyze auth flow"}
# {"type":"module:log","taskId":"task-abc123","moduleId":"orchestrator","message":"Generated code for step 1"}
# {"type":"step:completed","taskId":"task-abc123","stepId":1}
# {"type":"task:completed","taskId":"task-abc123"}

# Check results
cat /board/tasks/task-abc123/artifacts/list
cat /board/tasks/task-abc123/artifacts/analysis-report

# Invoke a module tool directly
echo '{"tool":"knowledge-local-analyzer.scan","args":{"patterns":["TODO","HACK"]}}' > /board/modules/knowledge-local-analyzer/invoke
# read back: ["src/auth.ts: TODO: fix redirect","src/utils.ts: HACK: temp workaround"]

# Change config
echo "full" > /board/config/autonomy-mode

# Accept a proposal the architect made
echo "yes" > /board/messages/proposals/prop-456/accept
```

### OpenClaude Inside the Terminal

The terminal VM has internet access. You install the OpenClaude CLI:

```bash
# Inside the terminal
npm install -g @anthropic-ai/claude-code
# or: apk add claude  (if bundled)

claude
# > I'm Claude. How can I help?
```

Claude runs inside the VM. It sees a Linux filesystem. It can read `/board/`. Through the filesystem, it can control the board.

**But the real power is custom MCP tools.** The board filesystem IS an MCP server from Claude's perspective:

```
~/.claude/settings.json (inside the VM):

{
  "mcpServers": {
    "board": {
      "command": "board-mcp-bridge",
      "args": []
    }
  }
}
```

`board-mcp-bridge` is a small binary (Go or Node) that:
- Reads stdin for MCP tool calls
- Maps them to filesystem operations on `/board/`
- Writes MCP responses to stdout

This gives Claude tools like:

| Claude Tool | Maps to |
|---|---|
| `board_list_tasks` | `cat /board/tasks/list` |
| `board_create_task` | `echo "$INPUT" > /board/tasks/create` |
| `board_get_task` | `cat /board/tasks/$ID/meta` |
| `board_run_task` | `echo "$ID" > /board/tasks/$ID/step` |
| `board_watch_events` | `tail -f /board/events/stream` |
| `board_invoke_module` | `echo "$JSON" > /board/modules/$ID/invoke` |
| `board_read_artifact` | `cat /board/tasks/$ID/artifacts/$NAME` |
| `board_send_message` | `echo "$MSG" > /board/messages/send` |
| `board_get_config` | `cat /board/config/$KEY` |
| `board_set_config` | `echo "$VAL" > /board/config/$KEY` |

**Claude's workflow inside the terminal:**

```
User types in terminal: "claude, analyze the repo for security issues and create tasks for what you find"

Claude:
1. Reads /board/config/repo-url → "owner/repo"
2. Clones the repo: git clone https://github.com/owner/repo /tmp/repo
3. Scans files, identifies issues
4. For each issue:
   echo "Fix XSS in login form\n$DETAILS" > /board/tasks/create
5. Reports back in terminal: "Created 3 tasks"
6. Monitors: tail -f /board/events/stream
7. When tasks complete, reads artifacts and summarizes
```

### The Board Reacts to the Terminal

This is bidirectional. The board UI also sends events to the terminal:

- User clicks "Run" on a task card → event appears in `/board/events/stream` → Claude sees it → Claude starts monitoring
- User types a message in the board chat → appears in `/board/messages/list` → Claude reads it → Claude responds
- A step fails → event in stream → Claude reads error → Claude suggests fix → creates new task or modifies step

### UI Layout

```
┌──────────────────────────┬──────────────────────────────┐
│                          │  Terminal                     │
│  Kanban Board            │                              │
│                          │  $ claude                     │
│  ┌─────────┐ ┌────────┐ │  > I'll monitor the board     │
│  │ TODO    │ │ Active │ │  > and help with tasks.        │
│  │         │ │        │ │  >                             │
│  │ task-1  │ │ task-3 │ │  > Board events:               │
│  │ task-2  │ │        │ │  > ✓ task-1: step 2 complete   │
│  │         │ │        │ │  > → task-1: step 3 running    │
│  └─────────┘ └────────┘ │  >                             │
│                          │  > Created task: "Fix lint     │
│  ┌─────────────────────┐ │  > errors in auth module"     │
│  │ Module Panel        │ │  > Assigned to wasm-local     │
│  │ • architect-codegen │ │                               │
│  │ • wasm-local  ●     │ │  $ _                          │
│  │ • wasm-net    ○     │ │                               │
│  │ • analyzer         │ │                               │
│  └─────────────────────┘ │                               │
│                          │  [Resize handle ↕]            │
└──────────────────────────┴──────────────────────────────┘
```

Features:
- Draggable split between board and terminal
- Terminal has tabs: can open multiple sessions
- Tab 1: Claude agent monitoring the board
- Tab 2: Raw shell (for manual work)
- Tab 3: Another Claude instance for a different task
- Terminal can be collapsed/minimized
- Board events flash a notification badge on the terminal tab when collapsed

### Module Manifest

```json
{
  "id": "channel-wasm-terminal",
  "name": "Board Terminal",
  "version": "1.0.0",
  "type": "channel",
  "description": "A WASM Linux terminal with board control via 9p filesystem. Can run Claude Code or custom agents that interact with the board through filesystem-based tools.",
  "tools": [
    {
      "name": "channel-wasm-terminal.sendToTerminal",
      "description": "Inject text into the terminal as if typed by the user.",
      "parameters": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "tabId": { "type": "string" }
        },
        "required": ["text"]
      }
    },
    {
      "name": "channel-wasm-terminal.onTerminalOutput",
      "description": "Called when the terminal produces output. Board modules can subscribe.",
      "parameters": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "tabId": { "type": "string" }
        }
      }
    }
  ],
  "presentations": [
    {
      "type": "terminal",
      "config": {
        "position": "right",
        "defaultWidth": "40%",
        "minWidth": "25%",
        "maxTabs": 4,
        "defaultShell": "/bin/sh"
      }
    }
  ],
  "permissions": ["network", "storage", "timers"],
  "configFields": [
    {
      "key": "networkRelay",
      "type": "string",
      "label": "Network Relay",
      "description": "WebSocket relay URL for VM internet access.",
      "default": "ws://localhost:8080/x/net"
    },
    {
      "key": "defaultPackages",
      "type": "string",
      "label": "Pre-install Packages",
      "description": "Comma-separated apk packages to install on boot.",
      "default": "git,nodejs,python3"
    },
    {
      "key": "autoStartClaude",
      "type": "boolean",
      "label": "Auto-start Claude",
      "description": "Launch OpenClaude CLI automatically when terminal opens.",
      "default": false
    }
  ]
}
```

### BoardFS Implementation

The 9p server adapter that translates filesystem operations to board API calls:

```typescript
// BoardFS — mounted at /board/ inside the terminal VM

class BoardFS {
  constructor(
    private db: Dexie,              // board database
    private registry: ModuleRegistry,
    private orchestrator: Orchestrator,
    private eventBus: EventBus,
    private host: ModuleHost
  ) {}

  // 9p file operations → board operations

  // --- tasks ---
  // read  /board/tasks/list        → db.tasks.toArray() → JSON
  // write /board/tasks/create      → parse "title\ndesc" → orchestrator.processTask()
  // read  /board/tasks/{id}/meta   → db.tasks.get(id) → JSON
  // read  /board/tasks/{id}/logs   → task.moduleLogs → text (blocks for new lines)
  // write /board/tasks/{id}/status → update workflowStatus

  // --- modules ---
  // read  /board/modules/list           → registry.getEnabled() → JSON
  // read  /board/modules/{id}/manifest  → module manifest → JSON
  // read  /board/modules/{id}/config    → host.config.moduleConfigs[id] → JSON
  // write /board/modules/{id}/config    → update moduleConfigs
  // write /board/modules/{id}/invoke    → parse JSON → registry.invokeHandler() → result

  // --- config ---
  // read  /board/config/{key}    → host.config[key]
  // write /board/config/{key}    → update host.config[key]

  // --- events ---
  // read  /board/events/stream   → blocking read
  //   subscribes to eventBus, yields newline-delimited JSON
  //   each read() returns the next event, or blocks until one arrives

  // --- messages ---
  // read  /board/messages/list       → db.messages.toArray()
  // write /board/messages/send        → create message in board inbox
  // write /board/messages/proposals/{id}/accept → accept proposal
  // write /board/messages/proposals/{id}/reject → reject proposal
}
```

The blocking read on `/board/events/stream` is the key mechanism. In 9p terms:

```
1. VM opens /board/events/stream
2. 9p read() arrives at BoardFS
3. BoardFS checks: any queued events? If yes → return them.
4. If no → await on eventBus subscription → return when event arrives
5. VM gets data, processes it, reads again (loop = tail -f behavior)
```

### The MCP Bridge Binary

A tiny program that runs inside the VM and translates MCP protocol to board filesystem operations:

```go
// board-mcp-bridge — runs inside the VM
// Reads MCP JSON-RPC from stdin, translates to /board/ filesystem ops, writes results to stdout

func main() {
    scanner := bufio.NewScanner(os.Stdin)
    for scanner.Scan() {
        req := parseMCPRequest(scanner.Text())

        switch req.Method {
        case "tools/list":
            // Return list of board-* tools
            respond(toolsList())

        case "tools/call":
            tool := req.Params["name"]
            args := req.Params["arguments"]

            switch tool {
            case "board_list_tasks":
                data := os.ReadFile("/board/tasks/list")
                respond(data)

            case "board_create_task":
                f, _ := os.OpenFile("/board/tasks/create", os.O_WRONLY, 0)
                f.WriteString(args["title"] + "\n" + args["description"])
                f.Close()
                // Read back the task ID somehow (ioctl? result file?)

            case "board_watch_events":
                // Stream events from /board/events/stream
                f, _ := os.Open("/board/events/stream")
                buf := make([]byte, 4096)
                for {
                    n, _ := f.Read(buf)
                    // Forward as MCP notifications
                    notify("board_event", buf[:n])
                }

            // ... etc for each tool
            }
        }
    }
}
```

### Event Flow: Board → Terminal → Claude → Board

```
Board UI                           Terminal VM
┌──────────┐                      ┌──────────────────┐
│          │  eventBus.emit()     │                  │
│ User     │──────────────────►   │ BoardFS receives │
│ clicks   │                      │ event, unblocks  │
│ "Run"    │                      │ /board/events/   │
│ on task  │                      │ stream read()    │
│          │                      │                  │
│          │                      │ Claude reads:    │
│          │                      │ {"type":"task:   │
│          │                      │  started"...}    │
│          │                      │                  │
│          │                      │ Claude decides:  │
│          │                      │ "I should help   │
│          │                      │  with step 2"    │
│          │                      │                  │
│          │  BoardFS write()     │ Claude writes:   │
│          │◄──────────────────── │ echo "scan for   │
│          │  invokeHandler()     │ secrets" > /board│
│          │                      │ /modules/know-   │
│ Task     │                      │ ledge-local-     │
│ step     │                      │ analyzer/invoke  │
│ runs     │  result via 9p       │                  │
│          │──────────────────►   │ Claude reads     │
│          │                      │ result,          │
│          │                      │ summarizes in    │
│          │                      │ terminal         │
└──────────┘                      └──────────────────┘
```

### Bidirectional: Terminal → Board Messages

The terminal isn't just a viewer. Claude can create messages that appear in the board UI:

```bash
# Claude sends a message to the board inbox
echo "I found 3 security issues. Created tasks #4, #5, #6. Starting analysis on #4 now." > /board/messages/send
```

This appears as a chat message in the board UI, tagged with the terminal/Claude identity:

```
┌──────────────────────────────┐
│ 💬 Board Chat                │
│                              │
│ [Claude Terminal]            │
│ I found 3 security issues.   │
│ Created tasks #4, #5, #6.   │
│ Starting analysis on #4 now. │
│                              │
│ [You] Thanks, go ahead       │
│                              │
│ [Claude Terminal]            │
│ Task #4 complete. 2 findings │
│ saved as artifacts. Moving   │
│ to #5.                       │
└──────────────────────────────┘
```

The user can reply from the board chat, and Claude reads it from `/board/messages/list`.

---

## Implementation Plan

### Phase 1: Executor-WASM-Local (Isolated Sandbox)

**Step 1.1: Strip Apptron boot.go**
- Fork `boot.go` into `boot-sandbox.go`
- Remove: user FS, project FS, public FS, data FS, auth, admin, env UUID
- Remove: network relay, DHCP setup
- Keep: Wanix kernel init, v86 boot, 9p server, cowfs/memfs, tarfs for rootfs
- Add: GitFs mount at `/repo` (reuse existing `knowledge-repo-browser` GitFs)

**Step 1.2: Sandbox Worker**
- New `WasmSandboxWorker` class (similar to current `Sandbox` but boots v86)
- `execute(command: string): Promise<{ stdout, stderr, exitCode }>`
- `readFile(path: string): Promise<Uint8Array>`
- `writeFile(path: string, content: Uint8Array): Promise<void>`
- Boots in a Web Worker. xterm not needed (headless).

**Step 1.3: Handler + Registry**
- `WasmLocalHandler` with `handleRequest` routing to execute/readFile/writeFile
- Register in `host.ts` alongside existing handlers
- Architect prompt updated to describe shell command output format

**Step 1.4: Warm pool**
- Pre-boot one VM on board init. Keep it alive between steps.
- Reset cowfs overlay between tasks (fresh repo state).

### Phase 2: BoardFS (9p Adapter)

**Step 2.1: BoardFS class**
- Implement as a Wanix filesystem module in Go (or as a JS 9p server)
- Map all paths from the spec above
- Blocking reads on `/board/events/stream` via eventBus subscription

**Step 2.2: Integration with Wanix**
- In `boot-terminal.go` (fork of boot.go): `root.Namespace().Bind(boardfs, ".", "#board")`
- Bind to `/board/` inside the VM

### Phase 3: Terminal UI

**Step 3.1: Terminal panel component**
- React component wrapping xterm.js
- Resizable panel on the right side of the board
- Tab support (multiple terminal sessions)
- Connect to Wanix VM's serial console (existing v86 ttyS0)

**Step 3.2: Terminal lifecycle**
- Boot VM when terminal panel opens
- Show boot progress in terminal
- Shell prompt when ready
- Tear down (or suspend) when panel closes

### Phase 4: Claude Integration

**Step 4.1: Install Claude in VM**
- Bundle OpenClaude CLI in the system tarball, or install on first boot via npm
- Configure MCP settings pointing to `board-mcp-bridge`

**Step 4.2: board-mcp-bridge**
- Small Go binary (cross-compiled to 386 for v86)
- Reads MCP JSON-RPC from Claude's stdout/stdin
- Translates to /board/ filesystem ops
- Returns results as MCP responses

**Step 4.3: Auto-start option**
- Config field `autoStartClaude` — if true, terminal boots directly into Claude
- Claude's system prompt includes board context (current tasks, config, repo)

### Phase 5: Polish

- Event notifications in board UI when terminal/Claude creates tasks
- Syntax highlighting in terminal for /board/ paths
- Tab completion for /board/ paths
- A `/board` shell command for ergonomic access (wrapper around cat/echo)
- Terminal recording/playback for audit

---

## Open Questions

1. **Boot time** — v86 + Alpine boots in ~3-5s. Acceptable? Can we pre-bundle a lighter rootfs for the isolated profile (drop everything except busybox + esbuild)?

2. **Memory** — v86 VM takes 512MB-1GB of browser memory. Running two VMs (isolated executor + terminal) simultaneously may be too much for some devices. Options: serialize VM access, use SharedArrayBuffer, or accept the constraint.

3. **Claude Code availability** — Does OpenClaude CLI run on 32-bit Linux? If not, we need a 64-bit VM (qemu-wasm instead of v86?) or a shim that runs Claude outside the VM but connects its tools to /board/.

4. **GitFs write-back** — When the isolated executor writes to `/repo/`, those changes need to propagate back to the actual GitHub repo. Current GitFs is read-only. Need to add commit+push capability, or collect changes as patches.

5. **9p performance** — Every `/board/` read/write crosses the 9p boundary (VM → Wanix → JS → Dexie). For bulk operations this could be slow. Consider a bulk API: `echo '{"op":"bulk","reads":["/tasks/list","/modules/list"]}' > /board/_bulk`.

6. **Security model for terminal** — The terminal VM has internet AND board access. A rogue process inside the VM could exfiltrate board data. Options: restrict boardfs to read-only for sensitive paths, or accept the risk since the user chose to run code there.
