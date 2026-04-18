# Bash Execution Tool — Architecture (v2)

## Overview

A tool that lets the Yuan agent execute shell commands inside the v86 VM. The agent calls `bash.exec({command, cwd?, timeout?})`, a shell is spawned in v86, output is captured to files, and the result returns to the agent.

## Current Stack

```
Browser (React)
  └── almostnode (Yuan agent, @yuaone/core AgentLoop)
        ↕ boardVM.fsBridge / boardVM.dispatchTool (Go WASM ↔ JS bridge)
  └── WanixRuntime (Go WASM kernel)
        ↕ virtio9p
        v86 Linux VM
          └── session-mux (PID 1 child)
                ├── Pane 0: /bin/sh (local shell, renders to stdout)
                ├── Pane 1: Yuan chat (9p pipe 0)
                └── Pane 2+: spawned shells (9p pipes 1+)
```

**Key interfaces**:
- `boardVM.fsBridge` — async JS→Go→v86 fs ops (readFile, writeFile, stat, glob, etc.)
- `boardVM.dispatchTool(name, args)` — routes Fleet tool calls from agent sandbox to `ModuleRegistry.invokeHandler()` (JS-side)
- `/#sessions/N/in|out` — 9p pipe pairs for session-mux shell I/O (JSON protocol)
- `ToolFS` — Go filesystem bridging `/#tools/call` writes → JS `boardVM.toolfs.callTool()` calls

## Design

### Tool Routing: Fleet Module Path

The agent has two tool dispatch paths (defined in `agent-bootstrap.ts:362-403`):

```
AgentLoop.executeSingleTool(toolCall)
  → toolExecutor.execute(call)           // combined executor in agent-bootstrap.ts
    ├─ Yuan built-in (file_read, etc.)   → yuanExecutor.execute(call)
    │    └─ @yuaone/tools → node:fs/promises shim → boardVM.fsBridge
    └─ Fleet tool (repo.*, bash.*)       → boardVM.dispatchTool(name, args)
         └─ ModuleRegistry.invokeHandler(qualified, args, ctx)
              └─ module's registered handler function
```

Bash tools follow the **Fleet tool path**. A new `bash-executor` module registers handlers in `ModuleRegistry`. When `boardVM.dispatchTool("bash.exec", args)` is called, it routes to the handler which calls `boardVM.bashExec(args)` — a new bridge method on `boardVM` that performs the Go-side execution.

This is all JS-side dispatch. Go ToolFS (`/#tools/call`) is not in the path.

### Command Execution: File-Based Results

**Problem**: Session pipe reads are non-blocking (`block=false`). `Read()` returns `(0, nil)` when empty — polling burns CPU or adds latency. Additionally, session-mux itself doesn't use the `/#sessions/N/in|out` pipes; it spawns shells via `exec.Command("/bin/sh", "-i")` with OS-level pipes and renders to its own stdout.

**Solution**: Don't use session pipes for I/O at all. Instead, use the existing `boardVM.fsBridge` to write commands and read results through files in the v86 filesystem.

```
1. Go creates result dir: fsBridge.mkdir("/tmp/bash-exec/<id>")
2. Go writes command to a shell script file in v86:
     fsBridge.writeFile("/tmp/bash-exec/<id>/run.sh",
       "cd /home/project && npm test > /tmp/bash-exec/<id>/stdout 2>&1; echo $? > /tmp/bash-exec/<id>/exitcode")
3. Go signals execution via session pipe (or alternative — see Open Questions)
4. Shell runs inside v86, stdout/exitcode written to files
5. Go polls fsBridge.stat("/tmp/bash-exec/<id>/exitcode") until it exists
6. Go reads fsBridge.readFile("/tmp/bash-exec/<id>/stdout") and fsBridge.readFile("/tmp/bash-exec/<id>/exitcode")
7. Result returned to agent
```

**Why file-based works**:
- `fsBridge.stat()` already works via 9p → IDB, returns ENOENT until file exists
- Shell redirection (`>`, `2>&1`, `echo $?`) is standard POSIX — works in any v86 shell
- No pipe polling, no blocking concerns — the shell blocks internally, Go just checks for a file
- Streaming: Go can periodically `readFile("/tmp/bash-exec/<id>/stdout")` for partial output

**But how does step 3 (signal execution) work?** This is the gap — see "Trigger Mechanism" below.

### Trigger Mechanism: Serial Escape Sequence via session-mux

The proven path for Go→v86 communication is the serial console. Resize already works this way: Go writes `\x1b[8;ROWS;COLSt` to the `#console/data` pipe → v86 serial → session-mux stdin → `handleInputByte()` parses it → `handleResizeSeq()` applies it.

We reuse this exact mechanism for bash execution. Define a custom OSC sequence that session-mux intercepts, forks a background shell, and writes results to files.

**Custom OSC sequence**: `\x1b]89;<base64-payload>\x07`

- `OSC 89` — custom, not assigned by any terminal standard
- Payload: `base64(id:cwd:command)`
- `BEL` (`\x07`) — sequence terminator

**Why OSC, not CSI**: CSI sequences (`\x1b[...`) have a defined parameter grammar (`digits;digits`). OSC (`\x1b]...`) accepts arbitrary string payloads up to the terminator — perfect for base64-encoded commands. session-mux's escape buffer (`escBuf`) already accumulates bytes until `BEL`.

**Example**: Execute `npm test` in `/home/project`
```
Payload: "a1b2:/home/project:npm test"
Base64:  "YTFiMjovaG9tZS9wcm9qZWN0Om5wbSB0ZXN0"
Full:    \x1b]89;YTFiMjovaG9tZS9wcm9qZWN0Om5wbSB0ZXN0\x07
```

**session-mux changes** (~30 lines in `main.go`):

```go
// In handleInputByte(), extend the escape buffer handling:
// Currently: buffers until 't' for resize CSI sequence
// Add: detect OSC 89 for bash execution

func (m *Mux) handleInputByte(b byte) {
    if len(m.escBuf) > 0 || b == 0x1b {
        m.escBuf = append(m.escBuf, b)
        // Existing resize: CSI 8;rows;cols t
        if b == 't' && len(m.escBuf) >= 6 && m.escBuf[0] == 0x1b && m.escBuf[1] == '[' {
            m.handleResizeSeq()
            m.escBuf = m.escBuf[:0]
            return
        }
        // NEW: OSC 89 (bash exec) — terminated by BEL (0x07)
        if b == 0x07 && len(m.escBuf) >= 6 && m.escBuf[0] == 0x1b && m.escBuf[1] == ']' {
            m.handleBashExec()
            m.escBuf = m.escBuf[:0]
            return
        }
        // Timeout: flush if buffer too long
        if len(m.escBuf) > 512 {
            for _, eb := range m.escBuf {
                m.handleKey(eb)
            }
            m.escBuf = m.escBuf[:0]
        }
        return
    }
    m.handleKey(b)
}

func (m *Mux) handleBashExec() {
    // Parse: \x1b]89;<base64>\x07
    s := string(m.escBuf)
    if !strings.HasPrefix(s, "\x1b]89;") {
        // Not our sequence, forward as keystrokes
        for _, b := range m.escBuf {
            m.handleKey(b)
        }
        return
    }
    payload := s[5 : len(s)-1] // strip "\x1b]89;" and "\x07"
    decoded, err := base64.StdEncoding.DecodeString(payload)
    if err != nil {
        return
    }
    parts := strings.SplitN(string(decoded), ":", 3)
    if len(parts) != 3 {
        return
    }
    id, cwd, command := parts[0], parts[1], parts[2]

    resultDir := "/tmp/bash-exec/" + id
    os.MkdirAll(resultDir, 0755)

    // Fork background shell, redirect to files
    script := fmt.Sprintf("cd %s && %s > %s/stdout 2>&1; echo $? > %s/exitcode",
        shellescape(cwd), command, resultDir, resultDir)
    cmd := exec.Command("/bin/sh", "-c", script)
    cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
    cmd.Start()
    // Track in map for kill support (m.bashProcs[id] = cmd)
}
```

**Go side** — sending the escape sequence via `#console/data`:

```typescript
// In boardVM.bashExec(), after writing the result dir:
async function triggerBashExec(id: string, cwd: string, command: string) {
  const payload = btoa(`${id}:${cwd}:${command}`);
  const seq = `\x1b]89;${payload}\x07`;
  // Use the same path as resize: #console/data pipe
  const encoded = new TextEncoder().encode(seq);
  await runtime.appendFile('#console/data', encoded);
  // Or: __boardSendRaw(encoded) for raw Uint8Array without CR
}
```

**How it works end-to-end**:
1. Go creates result dir via fsBridge.mkdir (`/tmp/bash-exec/<id>`)
2. Go sends escape sequence via `#console/data` pipe
3. v86 serial delivers bytes to session-mux stdin
4. session-mux's `handleInputByte()` buffers, detects OSC 89, parses payload
5. session-mux forks background shell (`exec.Command("/bin/sh", "-c", ...)`)
6. Shell redirects stdout/stderr/exitcode to files under `/tmp/bash-exec/<id>/`
7. Go polls `fsBridge.stat("/tmp/bash-exec/<id>/exitcode")` until it exists
8. Go reads results via fsBridge.readFile

**Why this is better than bashd**:
- **No new process**: session-mux is always running — no daemon to start, monitor, or crash
- **Immediate response**: escape sequence arrives on next stdin read (no 200ms poll)
- **Concurrent execution**: each command forks an independent background shell
- **Kill support**: session-mux tracks forked processes in a map (`m.bashProcs[id]`)
- **Proven path**: resize already uses this exact serial→stdin→escape-parse flow
- **Process listing**: session-mux can report active bash execs from its tracked map
- **No init-terminal changes**: nothing to add before the exec line

**Kill support** (built-in):

Extend with a second OSC sequence for killing a running command:
```
\x1b]89;kill:<id>\x07   → session-mux looks up cmd in m.bashProcs[id], sends SIGKILL
```

**Limitations**:
- Payload size: base64-encoded command in a single escape sequence. Practical limit ~500 bytes (most commands fit easily). For longer commands, write command to a file via fsBridge first, then trigger execution of that file.
- No streaming output: output is captured to files, read after completion. For v1, this is acceptable. Streaming could be added later via a named pipe or periodic readFile.
- Serial interleaving: escape sequences are interleaved with user keystrokes on the same ttyS0 stream. session-mux's `handleInputByte()` already handles this — escape bytes are buffered, regular keystrokes forwarded immediately.

## Bash Tool API

```typescript
interface BashExecTool {
  name: "bash.exec";
  parameters: {
    command: string;       // shell command to execute
    cwd?: string;          // working directory (default: /home)
    timeout?: number;      // max execution time in ms (default: 30000, max: 120000)
  };
  result: {
    stdout: string;        // combined stdout+stderr output
    exitCode: number;      // process exit code (0 = success)
    error?: string;        // error message if execution failed
    durationMs: number;    // execution duration
  };
}
```

### Additional tools (future)

```typescript
// Kill a running process
bash.kill({id: string}) → void

// Stream output (for long-running commands)
bash.stream({command: string}) → {id, onData: callback, stop()}
```

## Implementation

### 1. New Fleet module: `bash-executor`

Register as a Fleet module with tool handlers:

```
src/modules/bash-executor/
  ├── manifest.json       — tool definitions + sandboxBindings
  ├── index.ts            — registers handlers in ModuleRegistry
  └── handler.ts          — bash.exec handler implementation
```

**manifest.json**:
```json
{
  "id": "bash-executor",
  "name": "Bash Executor",
  "tools": [
    {
      "name": "exec",
      "description": "Execute a shell command in the v86 workspace",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {"type": "string", "description": "Shell command"},
          "cwd": {"type": "string", "description": "Working directory"},
          "timeout": {"type": "number", "description": "Timeout in ms"}
        },
        "required": ["command"]
      }
    }
  ],
  "sandboxBindings": {
    "bash.exec": "bash-executor.exec"
  }
}
```

**handler.ts**:
```typescript
export function register(registry: ModuleRegistry, boardVM: BoardVM) {
  registry.register("bash-executor.exec", async (name, args, ctx) => {
    return boardVM.bashExec(args);
  });
}
```

### 2. JS: `boardVM.bashExec()` bridge method

New async method on `boardVM` that the bash-executor handler calls. Sends the command via serial escape sequence to session-mux, polls for file-based results.

```typescript
// In boardVM.ts or a new bash-bridge.ts
boardVM.bashExec = async (args: {command: string, cwd?: string, timeout?: number}) => {
  const id = crypto.randomUUID().slice(0, 8);
  const resultDir = `/tmp/bash-exec/${id}`;
  const cwd = args.cwd || "/home";
  const timeout = args.timeout || 30000;
  const start = Date.now();

  // 1. Create result directory via fsBridge
  await boardVM.fsBridge.mkdir(resultDir);

  // 2. Send command via serial escape sequence (session-mux intercepts)
  //    \x1b]89;<base64(id:cwd:command)>\x07
  const payload = btoa(`${id}:${cwd}:${args.command}`);
  const seq = new TextEncoder().encode(`\x1b]89;${payload}\x07`);
  await runtime.appendFile('#console/data', seq);

  // 3. Poll for exitcode file (with timeout)
  const deadline = start + timeout;
  while (Date.now() < deadline) {
    const stat = await boardVM.fsBridge.stat(`${resultDir}/exitcode`);
    if (stat.exists) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // 4. Read results
  const stdout = await boardVM.fsBridge.readFile(`${resultDir}/stdout`);
  const exitCode = parseInt(await boardVM.fsBridge.readFile(`${resultDir}/exitcode`), 10);

  // 5. Cleanup
  // Optionally: await boardVM.fsBridge.rm(resultDir);

  return { stdout, exitCode, durationMs: Date.now() - start };
};
```

### 3. Agent tool registration

In `agent-bootstrap.ts`, `bash.exec` is discovered automatically via `boardVM.toolfs.listTools()` which queries the Fleet module registry. The combined `toolExecutor` routes it:

```typescript
// Already exists in agent-bootstrap.ts:362-403
// bash.exec is a Fleet tool, so it hits the dispatchTool path:
var fleetResult = await boardVM.dispatchTool("bash.exec", [args]);
```

No changes needed to agent-bootstrap.ts routing — it already handles Fleet tools.

### 4. `bash.clone` — Workspace Bootstrap

Before the agent can use bash tools on real code, the repository must be cloned into v86. Once cloned, the agent has full `git` CLI access — no need for GitFs (which is read-only file access only).

**Why clone instead of GitFs**:
- `git log`, `git diff`, `git blame` — history and context
- `npm test`, `npm run build` — execute against real files
- File editing with immediate verification
- `git checkout <branch>` for task isolation
- LLMs are far more effective with CLI git than filesystem reads

**bash.clone tool**:
```typescript
interface BashCloneTool {
  name: "bash.clone";
  parameters: {
    repoUrl?: string;    // defaults to boardVM.repoUrl
    branch?: string;     // defaults to boardVM.repoBranch
    targetDir?: string;  // defaults to /home/project
  };
  result: {
    path: string;
    branch: string;
    commit: string;      // HEAD commit hash
    error?: string;
  };
}
```

**Mirror + Checkout strategy**:
```
Startup:
  1. bash.exec("git clone <repoUrl> /home/_mirror")   // once, full clone
  2. bash.exec("cd /home/_mirror && git fetch --all")  // periodic sync

Per-task:
  3. bash.exec("cp -r /home/_mirror /home/project")    // local copy (no network)
  4. bash.exec("cd /home/project && git checkout <branch>")  // fast checkout
```

**Why a dedicated tool instead of raw bash.exec**:
- Token injection: avoids exposing `githubToken` in agent-visible command strings
- Mirror management: keeps `/home/_mirror` synced, handles first-time clone
- Idempotent: skips if target already exists
- Defaults from board config: agent doesn't need to know repoUrl/branch

**bash.clone handler** (in bash-executor module):
```typescript
async function handleClone(args, boardVM) {
  const repoUrl = args.repoUrl || boardVM.repoUrl;
  const branch = args.branch || boardVM.repoBranch;
  const targetDir = args.targetDir || "/home/project";

  // Inject auth token (not visible to agent)
  const authUrl = repoUrl.replace("https://",
    `https://${boardVM.githubToken}@`);

  // Check if mirror exists
  const mirrorExists = await boardVM.fsBridge.exists("/home/_mirror");

  if (mirrorExists) {
    await boardVM.bashExec({command: `cp -r /home/_mirror ${targetDir} && cd ${targetDir} && git checkout ${branch}`});
  } else {
    await boardVM.bashExec({command: `git clone ${authUrl} -b ${branch} ${targetDir}`});
    // Also create mirror for next time
    await boardVM.bashExec({command: `git clone --mirror ${authUrl} /home/_mirror`});
  }

  const commitResult = await boardVM.bashExec({command: `cd ${targetDir} && git rev-parse HEAD`});
  return { path: targetDir, branch, commit: commitResult.stdout.trim() };
}
```

**Periodic sync** (background):
```typescript
// Every 5 minutes, fetch all branches into mirror
setInterval(() => {
  boardVM.bashExec({command: "cd /home/_mirror && git fetch --all"});
}, 5 * 60 * 1000);
```

### 5. Auto-clone on agent init

In `agent-bootstrap.ts`, after agent initialization, automatically clone the workspace:

```typescript
// After initYuan(), if repoUrl is configured:
if (boardVM.repoUrl && boardVM.repoBranch) {
  await boardVM.dispatchTool("bash.clone", [{}]);
}
```

### 6. Future: Per-Task Branches

When tasks receive their own branches (parallel workflow):

```typescript
interface Task {
  taskBranch?: string;  // e.g. "task/123-add-auth-middleware"
}

// bash.clone reads task context:
bash.clone({ taskId: "123" })
// → checks out task.taskBranch, isolated workspace at /home/project-task-123
```

## Data Flow: bash.exec("npm test")

```
1. Yuan agent calls tool: bash.exec({command: "npm test", cwd: "/home/project"})
2. AgentLoop.executeSingleTool → toolExecutor.execute (agent-bootstrap.ts:364)
3. Combined executor: not a Yuan built-in → dispatches to Fleet path (line 389)
4. boardVM.dispatchTool("bash.exec", [{command:"npm test", cwd:"/home/project"}])
5. ModuleRegistry.invokeHandler("bash-executor.exec", args, ctx)
6. Handler calls boardVM.bashExec(args)
7. bashExec:
   a. mkdir /tmp/bash-exec/a1b2c3d4 via fsBridge.mkdir
   b. Send escape sequence: \x1b]89;<base64("a1b2c3d4:/home/project:npm test")>\x07
      → runtime.appendFile('#console/data', encoded)
      → v86 serial → session-mux stdin
      → session-mux intercepts OSC 89, forks background shell
   c. Shell runs: cd /home/project && npm test > /tmp/bash-exec/a1b2c3d4/stdout 2>&1; echo $? > ...
   d. Go polls fsBridge.stat("/tmp/bash-exec/a1b2c3d4/exitcode") every 200ms
   e. Read stdout and exitcode via fsBridge.readFile
   f. Return {stdout: "PASS 3 tests", exitCode: 0, durationMs: 4200}
8. Result flows back: handler → registry → dispatchTool → toolExecutor → AgentLoop
9. Agent receives: {stdout: "PASS 3 tests", exitCode: 0}
```

## Security Considerations

1. **No root access**: Commands run as regular user in v86 VM
2. **Timeout enforcement**: bashExec deadline kills execution if command hangs
3. **Max concurrent**: Cap at 5 concurrent bash sessions
4. **No interactive commands**: batch-mode only — write command, capture output, done
5. **CWD restriction**: Only paths under /home and /tmp
6. **Output size limit**: Truncate at 64KB
7. **Token injection**: `githubToken` injected by handler, never exposed to agent
8. **Network for git only**: v86 network is WISP-tunneled; git clone/fetch needs it, arbitrary access shouldn't

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Command exits non-zero | Return `{exitCode: N, stdout: "..."}` — agent decides |
| Command times out | Return `{exitCode: -1, error: "timeout after Nms"}` |
| Result dir conflict | Use UUID-based dir names (collision improbable) |
| Shell crashes | exitcode file contains signal code (137, etc.) |
| Output exceeds 64KB | Truncate, append `"\n... truncated (N bytes total)"` |
| fsBridge unavailable | Return `{error: "execution bridge not ready"}` |

## Implementation Steps

1. **Add OSC 89 handler to session-mux** — extend `handleInputByte()` + new `handleBashExec()` (~30 lines Go)
2. **Add process tracking map** — `m.bashProcs map[string]*exec.Cmd` for kill support (~5 lines)
3. **Create `bash-executor` module** — manifest.json + handler.ts (~30 lines)
4. **Add `boardVM.bashExec()` bridge method** — escape sequence send + file-based poll (~50 lines)
5. **Register module** — add to Fleet module loading in host.ts
6. **Add `bash.clone` handler** — mirror + checkout logic (~40 lines)
7. **Test with simple commands** — `echo hello`, `ls /home`, `cat /etc/os-release`
8. **Add timeout + output truncation** — harden for real usage
9. **Auto-clone on agent init** — wire in agent-bootstrap.ts

## Open Questions

1. **Streaming**: Buffer all output until exit (v1), or stream partial results? File-based approach supports both — periodic readFile for streaming. Recommendation: buffer for v1.

2. **Poll interval**: 200ms stat() polls add ~200ms latency. Could reduce to 50ms at cost of more 9p round-trips.

3. **Concurrent execution**: Multiple bash.exec calls in parallel? Yes — session-mux forks each command as an independent background process. Up to 5 concurrent (enforced in bashExec).

4. **cp -r performance**: Each file copy in v86 is a 9p round-trip through IDB. For large repos, `cp -r` may be slow. Consider `git clone --reference /home/_mirror` as an alternative (hardlinks, no copy).

5. **Cleanup**: Should result files be cleaned up after reading? Or left for debugging? Recommendation: clean up after successful read, leave on error for inspection.

6. **Long commands**: Base64 payload in escape sequence is practical up to ~500 bytes. For longer commands (complex scripts), write the command to a file via fsBridge first, then send a short escape sequence that executes that file: `\x1b]89;<base64(id:cwd:/tmp/bash-exec/id/run.sh)>\x07`.

7. **Timeout enforcement**: Go-side timeout stops polling + sends kill sequence (`\x1b]89;kill:<id>\x07`). session-mux looks up the process and sends SIGKILL. No orphaned processes.

## Gaps / Missing Pieces

### Critical: OSC 89 handler not implemented in session-mux
The escape sequence parsing and shell forking code (~30 lines) needs to be added to `wasm/session-mux/main.go`. Extends the existing `handleInputByte()` pattern that already handles resize (`\x1b[8;ROWS;COLSt`). Requires adding `base64` and `shellescape` imports to session-mux.

### Critical: `boardVM.bashExec()` bridge method not implemented
The JS method that sends the escape sequence via `#console/data` and polls for file results. ~50 lines. Uses `runtime.appendFile('#console/data', seq)` — the same path as resize commands and `sendToTerminal()`.

### Major: Shell escape for command arguments
The command string from the agent is interpolated into a shell script. Must be properly escaped to prevent injection. Options: (a) `shellescape` library in session-mux Go code, (b) write command to a file via fsBridge and execute the file instead. Recommendation: (b) is safer — write command to file first, then trigger execution of that file.

### Minor: Output encoding
Shell output may contain binary data or non-UTF8. fsBridge.readFile returns strings. May need base64 encoding or binary-safe reads for some commands.

### Minor: Working directory persistence
Agent must pass `cwd` on every call (no persistent shell state). This is correct for v1 but may surprise agents that expect `cd` to persist.

### Minor: No process listing
`bash.ps` tool (future) could be added as another OSC sequence that asks session-mux to report tracked processes.

### Future (v2): Streaming output
For long-running commands (dev servers, test suites), stream partial output instead of waiting for completion. Options: (a) periodic `fsBridge.readFile()` for stdout (file grows as shell writes), (b) named pipe with non-blocking reads, (c) session-mux writes chunk markers to stdout file.

### Future (v2): session-mux 9p pipe integration
session-mux currently only creates local shells via `exec.Command("/bin/sh", "-i")` with OS pipes. It does not read from `/#sessions/N/in` or write to `/#sessions/N/out`. The SESSION_MUX.md design describes this integration but it's not implemented. When done, bash tools could use session-mux-managed shell sessions with proper stream/lifecycle support, and the OSC trigger could be retired in favor of direct pipe I/O.
