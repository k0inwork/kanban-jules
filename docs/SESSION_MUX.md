# Session Multiplexer

A terminal multiplexer that runs inside the v86 VM, replacing the need for
tmux/dvtm (which require kernel PTY/AF_UNIX support that v86 lacks).

## Overview

```
Browser (xterm.js)
    ↕ ttyS0 (serial console)
v86 Linux
    └── session-mux  (PID 1 child, exec'd from init-terminal)
        ├── Pane 0: Local sh          (direct fork/exec, no 9p pipe)
        ├── Pane 1: Yuan chat          ←→ pipe 0 (9p → JS agent)
        ├── Pane 2: Yuan shell #1      ←→ pipe 1 (9p → JS agent)
        └── ...
                ↕ 9p
        wanix (Go/WASM) — exposes pipe pairs as /sessions/N/in,out
                ↕ Port API
        JS/Yuan agent
```

## Pane Layout

Each pane takes the **full screen**. Only one pane visible at a time.
Tab bar at the bottom shows all sessions with the active one highlighted.

```
$ ls
file1.txt  file2.txt
$ _
```

```
[0:local] [1:yuan] [2:shell-1] [3:shell-2]
     ^^^^
```

Switching panes replaces the entire screen content (saved/restored from buffer).

## Pane Types

### Pane 0: Local Shell
- Always present, always first.
- `fork/exec` of `/bin/sh` — no 9p pipe needed.
- Mux handles terminal discipline: echo, Ctrl+C, Ctrl+D.
- User's default landing pane.

### Pane 1: Yuan Chat
- JSON-based protocol over 9p pipe 0.
- User types plain text → mux writes to pipe 0 as JSON message.
- Yuan responds via pipe 0 → mux renders in chat format.
- Yuan's control channel: can request spawning new shells, killing sessions.

### Pane 2+: Yuan Shells
- Spawned by Yuan via JSON command on pipe 0.
- Each gets a 9p pipe pair: `/sessions/N/in`, `/sessions/N/out`.
- Shell inside VM: `sh < /sessions/N/in > /sessions/N/out 2>&1`
- Yuan reads output and writes input from JS side.
- User can switch to any pane to watch.

## Tab Bar

Bottom line of the screen. Always visible.

```
[0:local] [1:yuan] [2:shell-1] [3:shell-2]
```

Active pane is highlighted (reverse video or bold). When activity happens in a
background pane, its tab gets a `*` marker:

```
[0:local] [1:yuan*] [2:shell-1] [3:shell-2]
```

This lets the user know Yuan or a shell has new output without switching away.

## Yuan Protocol (Pipe 0)

Line-delimited JSON. Each line is one message.

```jsonc
// Yuan → Mux (JS writes to pipe)
{"type":"chat","text":"I'll run the tests now"}           // displayed in pane 1
{"type":"spawn"}                                          // create a new shell session
{"type":"write","session":2,"data":"npm test\n"}          // write to a shell's stdin
{"type":"kill","session":2}                               // terminate a shell session

// Mux → Yuan (JS reads from pipe)
{"type":"chat","text":"check the results"}                // user typed in pane 1
{"type":"output","session":2,"data":"PASS src/app.test\n"} // shell output
{"type":"exited","session":2,"code":0}                    // shell exited
{"type":"spawned","session":2}                            // confirm shell created
```

## Keyboard Controls

| Key | Action |
|-----|--------|
| `Ctrl+B` `0-9` | Switch to pane N |
| `Ctrl+B` `n` | Next pane |
| `Ctrl+B` `p` | Previous pane |
| `Ctrl+B` `d` | Close current pane (not pane 0 or 1) |
| `Ctrl+B` `?` | Show help |
| `Ctrl+B` `[` | Scroll up in current pane |
| `Ctrl+B` `]` | Scroll down in current pane |
| Everything else | Forwarded to active pane |

When pane 1 is active: typed text goes to Yuan as chat.
When pane 0 or 2+ is active: typed text goes to that shell's input.

## Scrollback

Each pane has a scrollback buffer (last N lines, e.g. 1000).
`Ctrl+B` `[` / `]` to scroll up/down when viewing a pane.
Scrollback shows most recent output at the bottom.
Any new output in the active pane resets scroll position to bottom.

## Session Recording

Every pipe I/O event is logged with timestamps:

```
{"ts":1234567890,"session":1,"dir":"in","data":"ls\n"}
{"ts":1234567891,"session":1,"dir":"out","data":"file1.txt\n"}
```

Replay: mux reads the log, emits output at original timing (or sped up).

## Implementation Plan

### 1. `sessionfs` — wanix module (Go)

New module `#sessions` that exposes pipe pairs as 9p files.

```
/sessions/
├── 0/
│   ├── in      (JS writes, mux reads)
│   ├── out     (mux writes, JS reads)
│   └── status  (running/exited)
├── 1/
│   ├── in
│   ├── out
│   └── status
```

Builds on existing `vfs/pipe` module. Registered in `main.go` like `#pipe` and `#llm`.

~200 lines.

### 2. `session-mux` — VM binary (Go, cross-compiled to linux/386)

The mux process. Runs in the VM.

Responsibilities:
- Render active pane full-screen on ttyS0 using VT100 escape codes
- Draw tab bar on bottom line
- Save/restore screen buffer when switching panes
- Route keyboard input to active pane
- Fork/exec shells for panes 0 and 2+
- Open 9p pipe files for Yuan sessions
- Terminal discipline for local shell: echo, Ctrl+C, Ctrl+D
- Per-pane scrollback buffer
- Activity markers on background pane tabs
- Log all session I/O for recording

~600-800 lines. Cross-compiled, added to Dockerfile.wasm.

### 3. JS agent integration

Yuan agent on JS side:
- Opens pipe 0 (`/sessions/0/in`, `/sessions/0/out`) via Port API
- Sends/receives JSON protocol messages
- Reads shell output, writes commands

### 4. `init-terminal` changes

```sh
# Before:
exec setsid sh -c 'exec sh </dev/ttyS0 >/dev/ttyS0 2>&1'

# After:
exec setsid /bin/session-mux </dev/ttyS0 >/dev/ttyS0 2>&1
```

## Terminal Control

The mux sits between each shell and ttyS0. Shells never write to the real
terminal directly. Instead:

```
Shell output → VT100 escapes → Mux parses into virtual grid → Mux renders to ttyS0
```

### How it works

1. **Each pane has a virtual `Terminal`** (from `vito/midterm` library).
2. Shell output bytes are fed into `Terminal.Write()` which parses all VT100
   escape sequences and maintains an in-memory grid (`Content [][]rune`).
3. The mux renders the active pane's virtual grid onto ttyS0.
4. The tab bar occupies the last row of ttyS0 — it's mux-owned, not part of
   any pane's grid.
5. Shells think they have `rows-1` x `cols` (one row reserved for tab bar).

### Full-screen apps (top, vi, clear)

When a shell switches to alternate screen (`\x1b[?1049h`):
- `midterm` automatically switches to `Alt *Screen` buffer.
- The mux detects `IsAlt == true` and **hides the tab bar**, giving the app
  full screen. App gets the real terminal dimensions.
- When app exits (`\x1b[?1049l`), mux restores tab bar and redraws the
  previous main screen.

For `clear`: shell sends `\x1b[2J`, midterm clears the virtual grid, tab bar
stays — it was never part of the grid.

### Pane switching

When user presses Ctrl+B to switch panes:
1. Mux saves the current virtual grid state (already in `Terminal.Screen`).
2. Mux redraws the new pane's grid to ttyS0 via `Terminal.Render()`.
3. Mux redraws the tab bar on the last row.
4. Old pane continues running in background — its output still feeds into its
   virtual Terminal, just not rendered to ttyS0.

### VT100 Library: `charmbracelet/x/vt` (via `unixshells/vt-go` fork)

GitHub: `github.com/charmbracelet/x/vt` — MIT license, actively maintained.
Fork: `github.com/unixshells/vt-go` — adds IRM (Insert/Replace Mode) needed for vi/nano.

Why the fork: upstream `charmbracelet/x/vt` lacks IRM (`\x1b[4h`/`\x1b[4l`), which breaks
interactive editors. The `unixshells` fork was created for `latch` — a terminal multiplexer,
exactly our use case. Monitor upstream for IRM support and switch back when available.

Provides:
- Virtual screen grid with cell-level access (`CellAt(x, y)`, `SetCell(x, y, cell)`)
- Full VT100/VT220/xterm escape sequence parsing (CSI, ESC, DCS, OSC, APC, PM, SOS)
- Alternate screen buffer (`IsAltScreen()`)
- Scrollback buffer with configurable size
- Damage tracking (`Touched()` returns dirty lines)
- Scroll regions, cursor tracking, line wrap, IRM
- `Resize(width, height)` for dynamic resizing
- `Write(p []byte)` to feed bytes, `String()` to get rendered output
- Zero GUI dependencies, pure Go, no CGO

API:
```go
emu := vt.NewSafeEmulator(80, 24)
emu.Write(shellOutputBytes)
cell := emu.CellAt(x, y)  // Cell{Rune, Fg, Bg, ...}
emu.Touched()              // []int — dirty row indices
emu.Resize(newW, newH)
emu.IsAltScreen()          // bool — alternate screen active
```

Dependencies: charmbracelet ecosystem (ultraviolet, x/ansi), go-runewidth, go-colorful.
Moderate dep tree but all well-maintained. Requires Go 1.24+.

This saves us ~500 lines of VT100 state machine code.

**Alternative**: `ricochet1k/termemu` — lighter deps, headless-first, MIT. Less complete but
cleaner if charmbracelet deps are too heavy.

### Rendering to ttyS0

The mux renders by:
1. Move cursor to home: `\x1b[H`
2. Render active pane's virtual grid row-by-row (from `Screen.Content`)
3. Move to last row, clear it, render tab bar
4. Position cursor where the active pane's virtual cursor is

For efficiency: track dirty rows via `Screen.Changes[]` and only redraw
changed rows instead of full screen every frame.

## Open Questions

1. **Max panes** — Hard limit?
   Recommendation: soft limit of 10. Tab bar is the only screen constraint.

2. **Binary vs JSON protocol** — JSON is debuggable but heavier.
   Recommendation: JSON. Performance isn't the bottleneck here.

## Future Work: Per-Session Namespaces

Each Yuan shell should run in its own isolated filesystem namespace, so it can't
see or affect other sessions. Two possible approaches:

### Option A: wanix NS.Clone()

wanix already has Plan 9-style namespaces (`vfs.NS`) with a `Clone()` method.
Each session gets a cloned namespace with its own bindings:

```
rootNS = main namespace (shared)
session2NS = rootNS.Clone()   // copy bindings
session2NS.Bind(ownOverlay, ".", "#env")  // private /env
```

The session-mux on the VM side would open a different 9p aname per session:
`rootflags=...,aname=vm/1/fsys` vs `aname=vm/2/fsys`.

Pros: clean separation, reuses existing namespace machinery.
Cons: requires per-session 9p mounts, more wanix-side state.

### Option B: idbfs-level isolation

idbfs prefixes all paths with a session ID. Each session writes to its own
IndexedDB namespace:

```
session 2 writes to: idbfs["wanix-env::2"]/tmp/...
session 3 writes to: idbfs["wanix-env::3"]/tmp/...
```

The session ID could be passed via environment variable or 9p aname.

Pros: simpler, no namespace changes.
Cons: all sessions still share the same mount point, leakage risk.

### Recommendation

Start with no isolation (v1). Add NS.Clone()-based isolation in v2 — it's the
cleaner model and wanix already supports it.

## What This Replaces

| Current | Replaced by |
|---------|-------------|
| `yuanfs` | Pipe 0 (Yuan chat channel) |
| `tmux`/`dvtm` | session-mux |
| Kernel PTYs | Mux's user-space terminal discipline |
| AF_UNIX sockets | 9p pipe pairs |
