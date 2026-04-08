# Apptron Strip Proposal: Feasibility Analysis

Two executor profiles derived from Apptron by stripping Apptron-specific layers, keeping the Go/Wanix/v86 core intact.

---

## What Apptron Actually Is (dependency map)

```
boot.go (684 lines, Go → WASM)         — THE file. Everything flows through main()
  ├── Wanix kernel (external dep)       — namespace VFS, bind mounts, 9p server
  ├── v86 (external dep)                — x86 JIT emulator, boots as sub-process
  ├── Alpine rootfs (tar bundle)        — the Linux filesystem the VM boots into
  ├── aptn binary (616 lines, Go→386)   — utilities running INSIDE the VM
  │     ├── exec   (214 lines)          — command execution
  │     ├── ports  (135 lines)          — TCP port monitor → public URLs
  │     ├── shm9p  (48 lines)           — 9p server over shared memory
  │     ├── fuse   (96 lines)           — FUSE filesystem
  │     └── shmtest(92 lines)           — shared memory test
  ├── worker/ (Cloudflare Worker)       — server-side auth, hosting, R2 storage
  └── assets/lib/apptron.js             — client-side bootstrap, auth, caching
```

**Key insight**: boot.go is the only file that needs modification. Everything else is either:
- An external dependency (Wanix, v86) used as-is
- A tar bundle (rootfs, kernel) rebuilt via Dockerfile
- Code running inside the VM (aptn) — optional, used as-is
- The Cloudflare Worker — completely irrelevant, strip entirely

---

## boot.go Line-by-Line Audit

### Section 1: Config Parsing (lines 59-111)
```
Reads window.apptron: user, origin, env, mode, embedded
Resolves JWT promises, extracts username/userID/envUUID/envOwner
```

| Profile | Action | Replacement |
|---------|--------|-------------|
| Isolated | STRIP | Read minimal config from `window.boardSandbox`: `{ memoryMB, bundleUrl }` |
| Terminal | STRIP | Read from `window.boardTerminal`: `{ user, networkRelay, repoUrl }` |

**Feasibility**: Trivial. Replace `apptronCfg` object with a board-specific config object. ~50 lines become ~15.

**Imports removed**: none (still reads from JS globals)

---

### Section 2: Wanix Kernel Init + 9p Setup (lines 113-152)
```
Creates Wanix kernel, registers modules (#web, #vm, #pipe, #commands, #ramfs)
Sets up 9p server via virtio9p.Setup()
Experimental 9p-over-9p server (#9psrv)
```

| Profile | Action | Notes |
|---------|--------|-------|
| Isolated | KEEP core, STRIP #9psrv | Lines 113-136 are load-bearing. Lines 138-152 (9p-over-9p) are unused experiment. |
| Terminal | KEEP core, STRIP #9psrv | Same. |

**Feasibility**: Copy lines 113-136 verbatim. Delete lines 138-152. No modification needed.

**Imports kept**: wanix, web, vm, pipe, ramfs, virtio9p, p9kit, api, jsutil, wanixruntime
**Imports removed**: p9, ulog (only used by the experimental 9p-over-9p)

---

### Section 3: Root Bindings + Port API (lines 154-177)
```
Binds: #task→task, #cap→cap, #web→web, #vm→vm, #|→#console
Sets up api.PortResponder (MessageChannel IPC with host)
createPort factory function
```

| Profile | Action | Notes |
|---------|--------|-------|
| Isolated | KEEP | Port API is the IPC mechanism for the host to send commands. Essential. |
| Terminal | KEEP | Same, plus it's how the xterm.js connects to ttyS0. |

**Feasibility**: Copy verbatim. No changes.

---

### Section 4: Bundle Loading (lines 179-202)
```
Reads _bundle from Wanix instance (sys.tar.gz), unpacks as tarfs
Binds to #bundle and bundle
```

| Profile | Action | Notes |
|---------|--------|-------|
| Isolated | KEEP | This is how the rootfs gets loaded. Essential. |
| Terminal | KEEP | Same. |

**Feasibility**: Copy verbatim. The bundle is provided by the host (board provides it from a static URL or bundled asset).

---

### Section 5: IDBFS + Environment Setup (lines 204-267)
```
Creates IDBFS (IndexedDB filesystem) for persistence
Loads env base from bundle rootfs
Optionally loads custom env base from IDBFS (if env UUID has custom root)
Optionally loads env overlay from IDBFS
Creates cowfs (copy-on-write) overlay: envBase + envScratch
```

| Profile | Action | Replacement |
|---------|--------|-------------|
| Isolated | STRIP IDBFS, STRIP overlays, SIMPLIFY | Pure `memfs` for scratch. No IDBFS. No persistence. Base = bundle rootfs only. cowfs with memfs overlay. |
| Terminal | KEEP cowfs pattern | Keep cowfs for writable VM. Optionally keep IDBFS for persisting terminal state across sessions. |

**Isolated boot.go replacement** (~10 lines):
```go
envBase, err := fs.Sub(bundleFS, "rootfs")
if err != nil { log.Fatal(err) }
var envScratch fs.FS = memfs.New()
root.Namespace().Bind(&cowfs.FS{Base: envBase, Overlay: envScratch}, ".", "#env")
```

**Terminal boot.go replacement**: Same as current, but replace `envUUID` checks with board-specific env identifiers. Lines 220-241 (custom env from IDBFS) can stay or be stripped.

**Feasibility**: Easy. The code already uses `memfs.New()` as the default scratch. Just remove the IDBFS and overlay branches.

**Imports removed (isolated)**: idbfs
**Imports kept (terminal)**: idbfs (optional)

---

### Section 6: VM Boot Configuration (lines 269-342)
```
Reads VM config, sets up vm bindings (console, ramfs, pipe, fsys)
Generates /etc/profile.d/apptron.sh with env vars (USER, ENV_MODE, PUBLIC_URL, etc.)
Builds kernel cmdline (init, root, 9p params, memory)
Conditionally adds network device (lines 333-336)
Writes ctl file to boot the VM
```

| Profile | Action | Notes |
|---------|--------|-------|
| Both | KEEP bindings, KEEP network (always on), REPLACE profile | Network always enabled with `relay_url=fetch`. Replace profile vars with board-specific ones: `REPO_PATH=/repo`, `BOARD_MODE`. |

**Network toggle** — always on, no toggle needed:
```go
// Always enable network via fetch adapter (zero cost, no server)
ctlcmd = append(ctlcmd, "-netdev")
ctlcmd = append(ctlcmd, "user,type=virtio,relay_url=fetch")
```

**Feasibility**: Trivial. Network is unconditional.

---

### Section 7: Control File (lines 376-506)
```
setupBundle() — dynamically load additional bundles at runtime
ctl file — CLI interface for runtime operations:
  cmd    → execute command via #commands pipe
  bind   → create new bind mount
  reload → reload page
  bundle → load additional bundle (calls setupBundle)
  cp     → copy files in namespace
  sync   → one-way sync with cleanup of orphaned files
```

| Profile | Action | Notes |
|---------|--------|-------|
| Isolated | KEEP | ctl file is essential for the host to send commands. `cmd` is the primary execution mechanism. |
| Terminal | KEEP | Same. |

**Feasibility**: Copy verbatim. The `cmd` subcommand (lines 418-425) is how we execute shell commands inside the VM. The host writes to `#commands/data` and the VM runs it.

---

### Section 8: Environment BuildFS (lines 508-517)
```
Creates cowfs for /apptron/.buildroot — used for in-VM builds
```

| Profile | Action | Notes |
|---------|--------|-------|
| Isolated | STRIP | No need for buildroot in isolated executor. |
| Terminal | KEEP | Useful for building inside the terminal. |

**Feasibility**: 4 lines. Delete or keep.

---

### Section 9: Apptron Persistence Layers (lines 519-638)
```
User FS:       syncfs(IDBFS + httpfs) mounted at home/{username}
Admin Data FS: httpfs + cache mounted at root/data
Project FS:    syncfs(IDBFS + httpfs) mounted at project
Public FS:     syncfs(IDBFS + httpfs) mounted at public
All use syncfs → periodic sync between local IDBFS and remote HTTP API
All use httpfs → points to Apptron's Cloudflare Worker endpoints
```

| Profile | Action | Notes |
|---------|--------|-------|
| Isolated | STRIP ALL | Board handles persistence. VM is ephemeral. |
| Terminal | STRIP ALL | Replace with board-specific mounts (BoardFS, GitFs). |

**This is the biggest win**: 120 lines of Apptron-specific persistence code deleted entirely.

**Imports removed**: httpfs, syncfs, slices (only used for admin check)

**Terminal replacements** (new code, not in Apptron):
```go
// BoardFS mount — new Wanix fs adapter
boardfs := NewBoardFS(boardConfig)
root.Namespace().Bind(boardfs, ".", "#board")
root.Bind("#board", "board")

// GitFs mount — expose the board's GitFs as /repo in the VM
gitfs := NewGitFsAdapter(repoUrl, repoBranch, token)
root.Namespace().Bind(gitfs, ".", "#repo")
root.Bind("#repo", "repo")
```

---

### Section 10: Shutdown + rwcConn (lines 640-684)
```
wg.Wait(), _wasmReady signal, run9p() blocks
rwcConn adapter (35 lines) — net.Conn wrapper for io.ReadWriteCloser
dummyAddr (3 lines) — used by rwcConn
```

| Profile | Action | Notes |
|---------|--------|-------|
| Isolated | KEEP | Essential: _wasmReady signals host, run9p() is the main loop. |
| Terminal | KEEP | Same. |

**rwcConn** (lines 650-684): Only used by the commented-out shm9p code. Safe to remove, but also harmless to keep.

**Feasibility**: Copy verbatim.

---

## Summary: What Stays, What Goes

### KEEP (load-bearing core, ~320 lines)

| Section | Lines | Purpose |
|---------|-------|---------|
| Wanix init + 9p | 113-136 | Kernel, modules, 9p server |
| Root bindings + Port API | 154-177 | IPC with host |
| Bundle loading | 179-202 | Rootfs from tar |
| Env base + cowfs | 213-245 (simplified) | Writable filesystem |
| VM boot config | 269-342 | v86 boot, bindings |
| Control file (ctl) | 376-506 | Runtime commands |
| Shutdown + 9p serve | 640-648 | Main loop |

### STRIP (Apptron-specific, ~250 lines)

| Section | Lines | Why |
|---------|-------|-----|
| Config parsing | 59-111 | Replace with board config |
| Experimental 9p-over-9p | 138-152 | Unused |
| IDBFS (executor mode) | 204-210 | Executor uses memfs, no persistence |
| Custom env overlay | 220-241 | Board provides env |
| Profile vars | 293-316 | Replace with board env vars |
| Env buildFS (executor mode) | 508-517 | Not needed in executor |
| User FS | 519-546 | Board handles users |
| Admin data FS | 550-569 | Board-specific |
| Project FS | 571-608 | Board handles projects |
| Public FS | 610-638 | Board handles public |
| rwcConn | 650-684 | Unused (shm9p is commented out) |
| Worker/ | entire dir | Cloudflare Worker, not needed |

### NEW CODE (must be written)

| Component | Language | Lines (est.) | Purpose |
|-----------|----------|-------------|---------|
| `boot.go` (stripped) | Go | ~250 | Single boot.go with mode switch (executor/terminal) |
| `BoardFS` adapter | Go | ~200 | Wanix fs.FS implementation mapping 9p ops to board JS API |
| `GitFs` adapter | Go | ~80 | Wanix fs.FS wrapping the board's GitFs (JS→Go bridge) |
| `init-executor` | Shell | ~15 | Mount proc, loopback, DHCP, run command, exit |
| `init-terminal` | Shell | ~20 | Full boot with networking, BoardFS PATH, shell |
| Board-side worker | TypeScript | ~150 | Web Worker that boots Wanix, provides execute/readFile/writeFile |
| Board-side handler | TypeScript | ~80 | WasmLocalHandler / WasmTerminalHandler for module registry |
| Terminal UI component | TypeScript+CSS | ~100 | xterm.js wrapper, serial port bridge, fit addon |

**Total new code: ~895 lines** across Go, Shell, and TypeScript.

---

## One WASM, Two Modes

Both profiles use the same `boot.go` compiled to the same `boot.wasm`. Network is always on (`relay_url=fetch`, zero cost, no server). The difference is **what gets mounted** and **what init runs** — controlled by the config object passed from the host.

| | Executor Mode | Terminal Mode |
|--|--------------|---------------|
| **Purpose** | Run a step, collect output, die | Interactive shell + Claude Code |
| **Config key** | `window.boardVM.mode = "executor"` | `window.boardVM.mode = "terminal"` |
| **Network** | Always on (fetch) | Always on (fetch) |
| **GitFs mount** | `/repo` (read-only) | `/repo` (read-write) |
| **BoardFS mount** | No | `/board` |
| **Persistence** | memfs (ephemeral, dies with VM) | IDBFS (persists across sessions) |
| **init** | `init-executor` — mount proc, loopback, run command, exit | `init-terminal` — full boot, DHCP, shell |
| **Lifecycle** | Created per step, destroyed after | Persistent for session duration |

### Resulting boot.go structure (~250 lines, single file)

```
main()
  1. Read board config from window.boardVM            [NEW, ~15 lines]
     → { mode, memoryMB, bundleUrl, repoUrl, token }
  2. Wanix kernel init + 9p setup                     [COPIED, ~25 lines]
  3. Root bindings + Port API                         [COPIED, ~25 lines]
  4. Load bundle (sys.tar.gz)                         [COPIED, ~25 lines]
  5. if executor: cowfs(bundle rootfs + memfs)        [ADAPTED, ~15 lines]
     if terminal: cowfs(bundle rootfs + IDBFS)
  6. Mount GitFs at #repo → /repo                     [NEW, ~10 lines]
  7. if terminal: Mount BoardFS at #board → /board    [NEW, ~5 lines]
  8. VM boot config (always with network)             [ADAPTED, ~55 lines]
     - relay_url=fetch (always)
     - profile vars: REPO_PATH, BOARD_MODE
  9. Control file (cmd, bind, cp)                     [COPIED, ~45 lines]
  10. if terminal: Env buildFS                        [COPIED, ~5 lines]
  11. Signal ready, serve 9p                          [COPIED, ~5 lines]
```

### Executor mode: what the VM sees

```
/repo/     → GitFs (read-only, board's repo browser)
/tmp/      → memfs (ephemeral)
/home/     → memfs (ephemeral)
/usr/      → from rootfs (busybox, esbuild, make, sed, awk)
/bin/      → from rootfs (sh, aptn)
/etc/      → from rootfs + profile.d/board-vm.sh
/net       → fetch adapter (npm, curl, apk all work)
```

### Terminal mode: what the VM sees

```
/board/    → BoardFS (9p → board API)
  tasks/list, tasks/create, tasks/{id}/*
  modules/list, modules/{id}/invoke
  config/*, events/stream, messages/*

/repo/     → GitFs (read-write)
/home/     → cowfs (IDBFS-backed, persists across sessions)
/usr/      → from rootfs (busybox, git, node, python, esbuild, apk)
/net       → fetch adapter (internet access)
```

### Terminal UI: xterm.js

Terminal mode uses **xterm.js** connected to the VM's serial port (ttyS0). This is not the VGA canvas — it's a proper terminal emulator with scrollback, copy/paste, resize, and font control.

```
Board UI (React)
  └── xterm.js instance
        └── WebSocket/MessageChannel → Wanix serial port (ttyS0)
              └── VM shell (sh/bash)
```

Apptron already exposes serial via the Port API. The board-side worker connects xterm.js's `onData`/`onWrite` to the serial stream. No VGA display needed for terminal mode — xterm.js is both more functional and lighter weight.

**Dependencies**: `xterm` (npm package, ~100KB gzipped). Addons: `@xterm/addon-fit` (auto-resize), `@xterm/addon-web-links` (clickable URLs).

**Executor mode** does not need xterm.js — it's headless. The host sends commands via `#commands` pipe and reads output from the console stream.

### init scripts

**init-executor** (runs command, exits):
```sh
#!/bin/busybox sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t binfmt_misc none /proc/sys/fs/binfmt_misc
echo ':wasm:M::\x00\x61\x73\x6d::/bin/wexec:' > /proc/sys/fs/binfmt_misc/register
source /etc/profile
ifconfig lo up
ifconfig eth0 up
udhcpc -i eth0 -s /bin/post-dhcp
# Execute the step command, then exit
exec /bin/sh -c "$EXECUTOR_CMD"
```

**init-terminal** (interactive session):
```sh
#!/bin/busybox sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t binfmt_misc none /proc/sys/fs/binfmt_misc
echo ':wasm:M::\x00\x61\x73\x6d::/bin/wexec:' > /proc/sys/fs/binfmt_misc/register
source /etc/profile
ifconfig lo up
ifconfig eth0 up
udhcpc -i eth0 -s /bin/post-dhcp
export PATH=$PATH:/board/bin
exec /bin/sh
```

### Rootfs bundle

One bundle, not two. Reuse Apptron's rootfs Docker build (Dockerfile lines 27-33):
- Alpine 32-bit + fuse + make + git + esbuild
- Same packages for both modes — the size difference is negligible
- Optionally add: node (for Claude Code in terminal mode, or JS test runners in executor mode)

The bundle is built once, served as a static asset. ~30-50MB compressed.

### Feasibility: HIGH

- One boot.go, one WASM, one bundle — mode is a runtime config switch
- Network is always available at zero cost (fetch adapter, no server)
- No new Go concepts needed — GitFs adapter is a standard Wanix `fs.FS` implementation
- The `cowfs` package already provides ephemeral writes over read-only base
- Executor lifecycle (run command → collect output → destroy) is trivially managed by the host

### Risk: GitFs write-back

The board's GitFs is currently read-only (fetches files from GitHub). For the executor to modify repo files, we need either:
1. **Read-only GitFs + artifact collection**: Executor reads from `/repo`, writes output to `/tmp/artifacts/`. Host collects artifacts after execution. No write-back needed.
2. **Writable GitFs**: Add commit+push to GitFs. More complex but enables real repo manipulation.

**Recommendation**: Start with option 1. The executor doesn't need to write to the repo — it reads source, runs commands, produces output. The host collects output as step artifacts.

### Risk: 32-bit compatibility

v86 emulates 32-bit x86. Some tools may not have 32-bit builds. Claude Code (Node.js) should work since Node supports 32-bit Linux. Python3 is available in Alpine 32-bit. Git works. The risk is low but should be verified.

---

## Networking: No Server Required

### How it works

v86 has a built-in `FetchNetworkAdapter` (`src/browser/fetch_network.js`). It runs a full TCP/IP stack in JavaScript inside v86. The VM thinks it has a real NIC — it does DHCP, DNS, TCP handshake, the works. But all HTTP traffic is intercepted at the TCP layer and routed through the browser's native `fetch()` API.

**No relay server. No WebSocket proxy. No backend.**

```
VM (Alpine Linux)
  → eth0 sends Ethernet frames
  → v86's fake TCP/IP stack (fake_network.js, runs in browser)
  → FetchNetworkAdapter intercepts HTTP
  → browser fetch() → internet
```

### Network config in boot.go

```go
// Both modes: always on, zero cost
ctlcmd = append(ctlcmd, "-netdev")
ctlcmd = append(ctlcmd, "user,type=virtio,relay_url=fetch")
```

### What works with `fetch`

| Operation | Protocol | Works? |
|-----------|----------|--------|
| `npm install` | HTTPS | Yes |
| `apk add` | HTTPS | Yes |
| `git clone` / `git push` | HTTPS | Yes |
| `curl` / `wget` | HTTPS | Yes |
| Claude Code → Anthropic API | HTTPS (streaming) | Yes |
| DNS resolution | DoH | Yes |
| SSH | Raw TCP | No |
| Arbitrary TCP | Raw TCP | No |

**Verdict**: `fetch` covers everything the terminal needs. The terminal's purpose is board control (9p, no network) plus Claude Code / npm / git — all HTTPS.

### WISP relay extension (future, if raw TCP is needed)

If SSH or arbitrary TCP ever becomes necessary, v86 also has a built-in `WispNetworkAdapter`. Switching to it requires:

1. **Change one config value**: `relay_url=fetch` → `relay_url=wisp://your-server:8080`
2. **Deploy a WISP relay**: ~50 lines of Node.js, one file, one dependency (`ws`)

```js
// relay.js — WISP v1 server, ~50 lines
const { WebSocketServer } = require("ws");
const net = require("net");
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  const sockets = new Map();
  let nextId = 1;

  ws.on("message", (raw) => {
    const buf = Buffer.from(raw);
    const type = buf[0];
    const streamId = buf.readUInt32LE(1);

    if (type === 0x01) { // CONNECT
      const port = buf.readUInt16LE(6);
      const host = buf.slice(8).toString();
      const id = nextId++;
      const sock = net.connect(port, host, () => {
        sockets.set(id, sock);
        const cont = Buffer.alloc(9);
        cont[0] = 0x03; // CONTINUE
        cont.writeUInt32LE(id, 1);
        cont.writeUInt32LE(65536, 5);
        ws.send(cont);
      });
      sock.on("data", (data) => {
        const frame = Buffer.alloc(5 + data.length);
        frame[0] = 0x02; // DATA
        frame.writeUInt32LE(id, 1);
        frame.set(data, 5);
        ws.send(frame);
      });
      sock.on("close", () => {
        const frame = Buffer.alloc(6);
        frame[0] = 0x04; // CLOSE
        frame.writeUInt32LE(id, 1);
        frame[5] = 0x02;
        ws.send(frame);
        sockets.delete(id);
      });
      sock.on("error", () => { sock.destroy(); });
    }
    if (type === 0x02) { // DATA
      const sock = sockets.get(streamId);
      if (sock) sock.write(buf.slice(5));
    }
    if (type === 0x04) { // CLOSE
      const sock = sockets.get(streamId);
      if (sock) sock.destroy();
      sockets.delete(streamId);
    }
  });

  ws.on("close", () => {
    for (const sock of sockets.values()) if (sock) sock.destroy();
  });
});
```

| WISP extension | Detail |
|----------------|--------|
| Files to create | 1 file: `relay.js` |
| Dependencies | `ws` (WebSocket library) |
| Effort | 1-2 hours to write + test |
| Deploy | `node relay.js` or Docker |
| No userspace TCP/IP stack needed | v86 handles TCP client-side |
| When needed | Only if SSH or raw TCP is required from inside the VM |

### Server-side summary

| Component | Executor Mode | Terminal Mode |
|-----------|--------------|---------------|
| Static assets (wasm, bundle) | Yes — one bundle, served with board | Same bundle |
| Network relay | **No** (uses `fetch`) | **No** (uses `fetch`) |
| API server | No | No |
| Database | No | No |
| WISP relay (future) | No | Optional, if raw TCP needed |

**Both modes are pure static deploy. No backend required.**

---

## Build Pipeline

### What's reused from Apptron

| Asset | Source | How |
|-------|--------|-----|
| wanix.min.js | `ghcr.io/tractordev/wanix:runtime` | `docker cp` as in Makefile |
| v86.wasm + BIOS | `ghcr.io/progrium/v86:latest` | From Dockerfile bundle-sys stage |
| Linux kernel (bzImage) | `ghcr.io/tractordev/apptron:kernel` | Custom 32-bit kernel with 9p support |
| Alpine rootfs | Dockerfile rootfs stage | Alpine 32-bit + busybox + tools |
| aptn binary | `system/cmd/aptn/` | Cross-compiled Go→386, used as-is |
| Wanix Go deps | `go.work` with tractordev/wanix | Same dependency |

### What's new in the build

| Asset | Build Step |
|-------|------------|
| boot.wasm | `GOOS=js GOARCH=wasm go build` in `wasm/boot/` |
| sys.tar.gz | rootfs (Alpine 32-bit + busybox + git + fuse + make + esbuild) + kernel + v86 |

### Build via GitHub Actions

Assets are built by a GitHub Actions workflow (`.github/workflows/build-wasm-assets.yml`), not locally.

**Workflow triggers**: push to `wasm/` or `Dockerfile.wasm`, or manual dispatch.

**Workflow steps**:
1. Build `boot.wasm` using Go Docker container
2. Build `sys.tar.gz` using `Dockerfile.wasm` (multi-stage: kernel + v86 + rootfs)
3. Pull `wanix.min.js` from `ghcr.io/tractordev/wanix:runtime`
4. Upload all assets as GitHub artifacts
5. Commit assets to `public/assets/wasm/` for serving

**No local Docker required.** Push to the branch, wait for the workflow, download assets.

### Dockerfile.wasm

Stripped version of Apptron's Dockerfile. Removes:
- `worker-build` stage (Cloudflare Worker)
- `bundle-goroot`, `bundle-gocache-*` stages (Go dev environment)
- `aptn-go`, `aptn-tinygo` stages (not needed initially)

Keeps:
- `kernel` stage (pre-built from `ghcr.io/tractordev/apptron:kernel`)
- `v86` stage (pre-built from `ghcr.io/progrium/v86:latest`)
- `rootfs` stage (Alpine 32-bit + tools + our init scripts)
- `bundle` stage (packages everything into sys.tar.gz)

---

## Effort Estimate

| Task | Effort | Dependency |
|------|--------|------------|
| Strip boot.go (mode switch) | 1 day | Read boot.go (done) |
| Write BoardFS adapter (Go) | 2-3 days | Understand Wanix fs.FS interface |
| Write GitFs adapter (Go) | 1 day | Understand Wanix fs.FS interface |
| Customize rootfs bundle | 0.5 day | Modify Dockerfile |
| Board-side Web Worker (TS) | 1 day | Port API pattern from apptron.js |
| Board-side handlers (TS) | 0.5 day | Module registry pattern |
| init scripts (2) | 0.5 day | Simple shell scripts |
| Build pipeline | 1 day | Dockerfile adaptation |
| Testing + integration | 2-3 days | Everything above |
| board-mcp-bridge (optional) | 1-2 days | Claude Code availability |

**Total: ~9-13 days**, assuming Wanix and v86 are used as-is without modification.

---

## What We're NOT Doing

1. **Rewriting Go in Node.js** — Go stays. Wanix stays. v86 stays.
2. **Modifying Wanix** — Used as an external dependency via go.work.
3. **Modifying v86** — Used as-is from the Docker image.
4. **Building a new kernel** — Reuse Apptron's pre-built kernel image.
5. **Rebuilding the Cloudflare Worker** — Not needed. Board serves assets.
6. **Full Apptron IDE** — No VS Code integration, no user auth, no environment management.

---

## Minimal Viable Path (implemented)

The initial scaffold is in place on the `feat/wasm-executor` branch:

```
wasm/
  boot/main.go              — Stripped boot.go with mode switch (~280 lines)
  boot/go.mod               — Go module (Wanix + p9 deps)
  system/bin/init           — Dispatcher: reads BOARD_MODE, execs init-executor or init-terminal
  system/bin/init-executor  — Mount proc/sysfs, DHCP, run command, exit
  system/bin/init-terminal  — Full boot, DHCP, BoardFS PATH, interactive shell
  worker/vm-worker.ts       — Web Worker: boots Wanix, executor/terminal mode logic
  worker/WasmHandler.ts     — Module handler for executor-wasm

src/modules/
  executor-wasm/            — Executor module (manifest + handler)
  channel-wasm-terminal/    — Terminal module (manifest + xterm.js component)

Dockerfile.wasm             — Multi-stage build: kernel + v86 + rootfs → sys.tar.gz
.github/workflows/build-wasm-assets.yml — CI: builds assets, pushes to public/assets/wasm/
```

**What's done**: boot.go stripped, init scripts, worker, handlers, manifests, build pipeline, CI workflow.
**What's TODO**: BoardFS adapter, GitFs adapter, go.sum, test end-to-end.
