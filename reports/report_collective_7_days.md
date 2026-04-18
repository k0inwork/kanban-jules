# Activity Report: collective (7 Days)

## Total Commits: 64

## Summary of Changes

* **fix: rebuild yuaone bundles with Korean removed from all prompt content** (2026-04-18) - Yanis Tabuns
Patched system-core.js, persona.js, agent-decision.js, prompt-runtime.js
source files and rebuilt bundles. All Korean in prompt templates replaced
with English. Only Korean in JS comments remains (not sent to LLM).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: patch Korean out of yuaone core, fix fsOpen, clarify repo vs fs tools** (2026-04-18) - Yanis Tabuns
- Patch @yuaone/core bundle: replace Korean 반말 rules with English-only
  in system-core.js, persona.js, prompt-runtime.js, agent-decision.js
- Fix fsOpen is not a function: patch fsShim.promises.open before tools load
- Fix English prefix \n escaping in template literal (caused Vite 500)
- Rewrite agent system prompt: clear separation of Fleet repo tools
  (GitHub API) vs local file tools (v86 fs) vs search tools
- Fix YuanChatPanel xterm double-mount and input focus issues

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: prevent double-mount welcome msg, redirect xterm focus to input** (2026-04-18) - Yanis Tabuns
- Guard xterm init against React StrictMode double-mount
- Autofocus textarea, redirect xterm focus to input bar

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: explicitly mention Chinese in English-only prompt for GLM model** (2026-04-18) - Yanis Tabuns
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: xterm.js chat panel + agent tree architecture doc** (2026-04-18) - Yanis Tabuns
- Replace YuanChatPanel with xterm.js terminal matching TerminalPanel theme
  (Catppuccin Mocha, read-only output, input bar with [you]> prompt)
- Add AGENT_TREE_ARCHITECTURE.md documenting right-side agent tree panel design
  (event bridge, tree model, UI layout, implementation steps)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: native function calling, event listeners, and run timeout** (2026-04-17) - Yanis Tabuns
- Switch from text-based tool call format to native OpenAI function calling
- Fix event listeners: AgentLoop.emitEvent() uses emit("event", ...), not emit(kind, ...)
- Remove text-injection hack in BoardVMContext that was stripping tools from API requests
- Add 120s timeout to _yuanRunWithCallback so UI never hangs forever

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: route agent results through boardVM.yuan._onResult callback** (2026-04-17) - Yanis Tabuns
almostnode runs in a web worker with its own globalThis, so
resolve/reject set on browser globalThis were invisible.
Now uses boardVM.yuan._onResult/_onError which is injected
into the worker by almostnode.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: write fs shim under /node_modules/fs/ not /node_modules/node:fs/** (2026-04-17) - Yanis Tabuns
almostnode strips the "node:" prefix before module resolution,
so "node:fs/promises" resolves as "fs/promises" and looks in
/node_modules/fs/promises/. The old path /node_modules/node:fs/
was never reached, causing "fsOpen is not a function".

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **debug: add glob logging to trace empty results** (2026-04-17) - Yanis Tabuns
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: map /home 1:1 to v86 /home, not v86 root** (2026-04-17) - Yanis Tabuns
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: resolve /home paths in fsBridge to v86 filesystem** (2026-04-17) - Yanis Tabuns
resolvePath now maps both /home/* and /workspace/* to vm/{vmID}/fsys/*,
fixing glob returning empty when agent root is /home.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **change agent root from /workspace to /home** (2026-04-17) - Yanis Tabuns
Agent projectPath and cwd now point to /home on the v86 filesystem
instead of a virtual /workspace. Removed unnecessary VFS mkdir since
file ops go through fsBridge directly to v86.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: use [] brackets in tool call format prompts, add []+<> extraction** (2026-04-17) - Yanis Tabuns
Prompt examples now use [] brackets with instruction to replace with <>
to avoid XML mangling. Added Pass 1b extraction for [tool_call]NAME
format with both [] and <> bracket support in openai-shim and
BoardVMContext parsers.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Fix Yuan agent boot: local bundles, ESM→CJS transform, XML tool calls, missing shims** (2026-04-17) - Yanis Tabuns
- Replace npm registry installs with pre-built local JSON bundles (scripts/bundle-yuaone.mjs)
- Fix ESM→CJS transform bug where trailing commas in export {} produced empty identifiers
- Add SSE delta chunk support in openai-shim for BYOKClient.chatStream()
- Add XML tool call extraction for arbitrary tag names (not just <tool_call name="...">)
- Add shims for fast-glob, node-pty, playwright, node:fs/promises, ollama
- Wire Yuan built-in tools via createDefaultRegistry alongside Fleet tools
- Add BoardVMContext provider and YuanChatPanel for standalone Yuan chat UI

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Pre-boot VM at module load, resize via escape sequences, XML tool calling** (2026-04-15) - Yanis Tabuns
- Auto-preboot Wanix VM at module import time (fetch wanix + bundle + WASM
  in parallel) so terminal is near-instant when user clicks the tab
- Dynamic resize via CSI escape sequences (\x1b[8;rows;colst) intercepted
  by session-mux, replacing static termCols/termRows in boardVM
- Handle hidden terminal container (display:none) gracefully with defaults
- ResizeObserver sends resize to VM when terminal tab becomes visible
- XML-based tool calling for providers without native function calling (Zhipu):
  inject tool schema as XML in prompt, parse <tool_call/> from response
- Fix termSizeRef for boardVM (no longer depends on xterm instance)
- Fix session-bridge efd.write/efd.close → w.write/w.close bug
- Bump BUILD to 37

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Wire Yuan agent (almostnode + @yuaone/core) to WASM terminal chat** (2026-04-15) - Yanis Tabuns
- Add bridge layer: agent-bootstrap, openai-shim, fleet-tools-shim
- Init almostnode container in TerminalPanel, replacing yuan.send stub
- Route agent tool calls through boardVM.dispatchTool -> toolfs.callTool
- Stub Ollama embeddings (fetch intercept for localhost:11434)
- Force stream:false in openai shim with async iterable fallback
- Export OpenAI error classes for instanceof checks in @yuaone/core
- Add zlib polyfill to vite config for almostnode/just-bash
- Copy runtime-worker to public/assets for build resolution
- Return actual LLM text instead of generic "Task completed"

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Add proper terminal sizing, vi raw passthrough, and alt screen support** (2026-04-15) - Yanis Tabuns
- Pass xterm.js cols/rows to VM via boardVM config with 80x24 minimum
- Read terminal size from env vars in session-mux instead of broken ioctl
- Add raw passthrough mode when alt screen is active (vi, less, etc.)
- Update init-terminal to read COLUMNS/LINES from boot profile

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Fix session-mux terminal: add local echo, line editing, and newline translation** (2026-04-15) - Yanis Tabuns
Shell runs without TTY (pipe stdin), so session-mux now handles:
- Local echo for typed characters
- Backspace/Delete line editing with Ctrl+U support
- \\n to \\r\\n translation for proper VT column alignment
- Removed stderr debug prints that garbled the display
- Silenced idbfs log spam with debug flag gate

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Wire session-mux to JS via 9p session pipes with LLM chat bridge** (2026-04-14) - Yanis Tabuns
Fix bidirectional pipe model in session-mux: each side opens a single
file (mux opens "in" with O_RDWR) instead of two separate files. Add
boardVM.yuan config and session pipe bridge in TerminalPanel that reads
mux JSON messages from #sessions/0/out, processes chat via LLM, and
writes responses back to #sessions/0/in.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Add session-mux terminal multiplexer and sessionfs module** (2026-04-14) - Yanis Tabuns
Custom VT100 terminal multiplexer (unixshells/vt-go) that replaces
tmux/dvtm which require kernel PTY/AF_UNIX support v86 lacks. Full-screen
panes with tab bar, Ctrl+B keybindings, alt screen detection, and 9p pipe
pairs for Yuan agent communication. Includes sessionfs wanix module (#sessions)
exposing pipe pairs as /sessions/N/in|out via 9p.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Add devpts mount and TERM env for dvtm/PTY support** (2026-04-14) - Yanis Tabuns
Mount /dev/pts (devpts) in both init-executor and init-terminal so
dvtm and other PTY-dependent tools can allocate pseudo-terminals.
Set TERM=xterm and COLUMNS/LINES in init-terminal for ncurses support.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Replace idbfs OpenFileFS with CreateFS (memfs pattern)** (2026-04-14) - Yanis Tabuns
idbfs had a custom OpenFileFS with writableFile buffer that caused
tmux/htop segfaults. memfs works because it uses CreateFS and returns
writable nodeFile handles. Restructured idbfs to match: removed
OpenFileFS, added CreateFS, made Open return writable idbFile handles
(like memfs's nodeFile). This lets the generic fs.OpenFile fallback
handle the create/write path the same way memfs does.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **re-enable idbfs OpenFileFS** (2026-04-14) - Yanis Tabuns
Reverted the OpenFileFS disabling test — it broke the write path.
The nlink=1 vendor patch is confirmed working (stat shows Links: 1).
Segfault root cause is still unknown.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **test: disable idbfs OpenFileFS to use fs.OpenFile fallback** (2026-04-14) - Yanis Tabuns
Testing hypothesis: the segfault is caused by idbfs's custom OpenFile
implementation. With this disabled, fs.OpenFile fallback is used (same
path as memfs). Remove NOIDBFS from localStorage to test with idbfs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **NOIDBFS mode: use memfs overlay instead of raw base** (2026-04-14) - Yanis Tabuns
memfs provides a writable overlay like idbfs but in-memory only.
This lets us compare memfs vs idbfs behavior for debugging segfaults.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **build with -mod=vendor to use patched pstat** (2026-04-14) - Yanis Tabuns
Previous vendor patch for nlink=1 was ignored because go build
used modules by default, not the vendor directory.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **use localStorage for NOIDBFS flag** (2026-04-14) - Yanis Tabuns
Set localStorage.setItem('NOIDBFS','true') in console to persist
across page reloads.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **add NOIDBFS flag to disable idbfs overlay for testing** (2026-04-14) - Yanis Tabuns
Set window.NOIDBFS=true in browser console before loading to bind
envBase directly without idbfs overlay. Useful for comparing behavior
with/without idbfs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix nlink=0: patch pstat.SysToStat to return Nlink=1 on js/wasm** (2026-04-14) - Yanis Tabuns
Vendored wanix pstat and patched stat_other.go to check if Sys()
returns a *Stat (use it), otherwise default to Nlink=1 instead of 0.
This fixes kernel VFS inode WARN at fs/inode.c:417 that caused
segfaults in tmux/screen/htop.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix idbfs: set nlink=1 in Sys() to fix kernel VFS inode warnings** (2026-04-14) - Yanis Tabuns
On js/wasm, pstat.SysToStat returns &Stat{} with Nlink=0. The 9p server
uses this value, causing the kernel to see files with 0 hard links,
triggering WARN at fs/inode.c:417 and subsequent segfaults in tmux/screen.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **docs** (2026-04-14) - Yanis Tabuns

* **fix idbfs: follow symlinks within overlay before falling back to base** (2026-04-14) - Yanis Tabuns
openFollow resolves symlink chains inside idbfs. If the target exists
in the overlay, returns it. If not, returns ErrNotExist so cowfs falls
back to base. This handles both apk-installed symlinks (target in
overlay) and base-layer symlinks correctly.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix idbfs: return ErrNotExist for symlinks in Open/OpenFile** (2026-04-14) - Yanis Tabuns
Symlinks have no data. Returning them as files gave cowfs a 0-byte
handle, preventing fallback to base layer. Now return ErrNotExist so
cowfs falls back to base, which handles symlink resolution correctly.
Should fix tmux/screen/htop segfaults.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix idbfs: remove symlink following from Open to fix segfaults** (2026-04-14) - Yanis Tabuns
OpenContext and OpenFile now return symlink records as-is instead of
following them. The 9p/cowfs layer handles Readlink and symlink
resolution. Previously, openFollow tried to resolve symlinks to targets
that only exist in the base layer (not idbfs), causing ErrNotExist and
segfaults in tmux/screen/htop.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Add statFollow logging, reduce PATH search noise** (2026-04-14) - Yanis Tabuns
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Add debug logging to idbfs openFollow/StatContext/Readlink** (2026-04-14) - Yanis Tabuns
Logs symlink resolution, misses, and readlink calls to diagnose
tmux/screen segfaults.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Add symlink following to idbfs Open/Stat** (2026-04-14) - Claude
When opening or stating a path that is a symlink, idbfs now resolves
the target recursively (up to 10 hops) instead of returning the
empty symlink record. This fixes segfaults when binaries are loaded
via symlinks (e.g. apk-created .so version links).

* **Add SymlinkFS/ReadlinkFS to idbfs, remove debug logging from nswrap** (2026-04-14) - Claude
idbfs now stores symlink targets in IndexedDB records, enabling apk to
create symlinks for shared library versioning.

* **Add debug logging to nsWrapper.Rename to trace apk rename failures** (2026-04-14) - Claude

* **fix: use create op context for rename destination resolution** (2026-04-14) - yanistabuns
NS ResolveFS only allows create/mkdir/symlink ops for new-file lookup.
Rename of temp files (like apk does) failed because the destination
could not be resolved without an allowed op context.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: add nsWrapper to fix NUL bytes on write and I/O errors in WASM VM** (2026-04-13) - yanistabuns
vfs.NS was missing OpenFileFS and other write interfaces, causing fs.OpenFile
to fall back to a broken path that returned read-only handles. The nsWrapper
resolves through the namespace with correct op context before delegating.
Also rebuilds sys.tar.gz to fix Alpine UNTRUSTED signature issue.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: add nsWrapper to fix NUL bytes on write and I/O errors in WASM VM** (2026-04-13) - yanistabuns
vfs.NS was missing OpenFileFS and other write interfaces, causing fs.OpenFile
to fall back to a broken path that returned read-only handles. The nsWrapper
resolves through the namespace with correct op context before delegating.
Also rebuilds sys.tar.gz to fix Alpine UNTRUSTED signature issue.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: add nsWrapper to fix NUL bytes on write and I/O errors in WASM VM** (2026-04-13) - yanistabuns
vfs.NS was missing OpenFileFS and other write interfaces, causing fs.OpenFile
to fall back to a broken path that returned read-only handles. The nsWrapper
resolves through the namespace with correct op context before delegating.
Also rebuilds sys.tar.gz to fix Alpine UNTRUSTED signature issue.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **docs: add collective branch overview (2026-04-13)** (2026-04-13) - Yanis Tabuns
Status snapshot of merged main + feat/wasm-executor content,
architecture stack, and pending items.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Merge remote-tracking branch 'origin/feat/wasm-executor' into collective** (2026-04-13) - Yanis Tabuns
# Conflicts:
#	.gitignore

* **Merge remote-tracking branch 'origin/main' into collective** (2026-04-13) - Yanis Tabuns

* **chore: rebuild sys.tar.gz from fresh Docker build** (2026-04-13) - Yanis Tabuns
Fixes UNTRUSTED signature errors by using freshly built Alpine rootfs
with valid signing keys instead of stale cached extraction.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: add repack.sh pipeline for sys.tar.gz builds** (2026-04-13) - Yanis Tabuns
Single source of truth: Docker builds the base Alpine image,
repack.sh overlays wasm/system/bin/ files and tars the result.
Without --docker it just re-overlays and repacks from .build/.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: enable job control and Ctrl+C by binding shell to ttyS0** (2026-04-13) - Yanis Tabuns
Shell now runs with setsid and stdin/stdout/stderr bound to /dev/ttyS0,
giving it a controlling terminal so SIGINT (Ctrl+C) works properly.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **chore: update WASM assets [skip ci]** (2026-04-12) - github-actions[bot]

* **fix: restore networking with default udhcpc script and rebuild sys.tar.gz** (2026-04-13) - Yanis Tabuns
- Fix init-terminal and init-executor to use default udhcpc script
  instead of nonexistent /bin/post-dhcp, restoring DHCP and gateway
- Rebuild sys.tar.gz with proper Alpine signing keys
- Add wispURL debug log for network troubleshooting
- Restore missing lsfs.wasm and wexec binaries

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix(idbfs): add WriteAt/ReadAt, Chtimes/Chmod, and immediate persist on create** (2026-04-13) - Yanis Tabuns
Fixes I/O errors on file creation in the VM:
- writableFile now implements io.WriterAt and io.ReaderAt for p9 protocol
- Implement ChtimesFS and ChmodFS interfaces for touch/chmod support
- Immediately persist new file records in OpenFile so Stat finds them

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: Enhance data integrity and context persistence** (2026-04-12) - k0inwork
Introduce "Self-Verification" checks for steps to ensure critical data is saved. Add immediate persistence of agent context to the database after updates to prevent data loss during long-running tasks. Refine `host.analyze` tool to support different output formats.

* **fix(idbfs): set ModeDir flag in recordToInfo for directory records** (2026-04-12) - Yanis Tabuns
recordToInfo was only using r.mode (the unix permissions) without
OR-ing in fs.ModeDir when r.isDir was true. This made directories
appear as regular files to cowfs and the kernel, causing "Not a
directory" errors when traversing paths through the overlay.

Also make #yuan vmBinding conditional on cfg.yuan to avoid fatal
error when yuan is not configured.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Merge remote-tracking branch 'origin/main' into collective** (2026-04-12) - Yanis Tabuns

* **feat: Refactor constitutions and improve logging** (2026-04-12) - k0inwork
Introduces dedicated constitution files for Architect and Programmer agents.
Improves logging verbosity and truncation in TaskCard for better debugging.
Enhances ConstitutionEditor to load system constitutions and adds system tab indicators.
Adjusts hover delay in TaskCard for better user experience.

* **Merge feat/wasm-executor into collective** (2026-04-12) - Yanis Tabuns
Integrates WASM executor, xterm terminal, WISP networking, and Go agent
source from feat/wasm-executor branch with latest main branch features
(module manifests, negotiators, GitFs, Dexie v18, agentContext).

Conflicts resolved:
- package.json: union of both dep lists (isomorphic-git + xterm)
- package-lock.json: removed, needs npm install to regenerate
- Removed cert.pem/key.pem from tracking, added *.pem/*.key to .gitignore

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix(idbfs): resolve mutex deadlock in openDir → ReadDir** (2026-04-12) - Yanis Tabuns
OpenContext holds fsys.mu then calls openDir which called ReadDir
that tried to acquire the same mutex again. Extract readDirLocked
for the internal call path.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: add idbfs persistent overlay, YuanFS, and WISP networking** (2026-04-12) - Yanis Tabuns
Replace memfs cowfs overlay with IndexedDB-backed idbfs so writes
survive page reloads. Add YuanFS for yuan integration (optional).
Switch VM networking from fetch adapter to WISP relay for full
TCP tunneling.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: Add module knowledge base integration** (2026-04-12) - k0inwork
Introduces a persistent storage for module-specific knowledge and integrates it into prompts for agents. This allows agents to reference contextually relevant information beyond the immediate task, improving their reasoning and execution capabilities.

Includes:
- New `moduleKnowledge` table in the database.
- Updates `ConstitutionEditor` to display and potentially manage module knowledge.
- Modifies `composeProgrammerPrompt` to include module-specific knowledge.
- Updates `Architect` to pass module knowledge to its prompt.
- Enhances `TaskCard` with hover effects for potential future tooltip integration.

* **feat: WISP networking relay for v86 VM TCP tunneling** (2026-04-12) - Yanis Tabuns
Add WISP protocol relay over WebSocket to enable full TCP connectivity
from the v86 VM through the browser to the Node.js server. This enables
wget, curl, and other network tools inside the VM to reach external hosts.

- WISP relay on /wisp with CONNECT/DATA/CONTINUE/CLOSE frame handling
- Initial CONTINUE frame to stream 0 (unblocks v86 congestion control)
- HTTP /proxy endpoint for fetch adapter fallback
- Switch from app.listen to httpServer for WebSocket upgrade support
- Disable ESC[27] in wanix.js (fixes xterm.js parsing errors)
- Add docs/v86-networking.md with architecture and protocol reference

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: Implement tool call history recording and replay** (2026-04-12) - k0inwork
Introduces a mechanism to record and replay tool call results within the sandbox. This allows for more efficient execution by skipping redundant tool calls when their outcomes are already known. The changes include:

- **Orchestrator:** Modified to utilize `sandbox.setHistoryRecorder` and persist `executionHistory` for steps.
- **Sandbox:** Enhanced to accept and manage a history recorder, and to pass the `index` of tool calls to the worker.
- **Sandbox Worker:** Updated to include `executionHistory` in its initialization and to pass the `index` along with tool call requests.
- **History Recording/Replay:** The sandbox now intercepts tool call responses, records them if a handler is set, and can replay them if provided.

* **feat: Introduce replay mode and task recovery** (2026-04-12) - k0inwork
Adds support for replaying previously executed code snippets, enabling more robust task execution.
Introduces a recovery mechanism to reset tasks stuck in an "EXECUTING" state on application startup.
Enhances the sandbox with deterministic random number generation and stubbed `Date.now` for improved testability and replayability.
Updates task types to include `currentCode`, `executionHistory`, and `seed`.

* **feat: Add YAML support and refactor handler registration** (2026-04-11) - k0inwork
Introduces YAML parsing capabilities and refactors the handler registration mechanism to be more modular.

The `yaml` package is now a dependency, enabling YAML processing.

Handler registration has been updated to use `registerModuleHandlers`, allowing handlers to be registered based on module IDs. This simplifies the `host.ts` file and makes the registry more extensible.

Prompting instructions have been refined to clarify the appropriate use of `executor-github` and `executor-jules`, particularly regarding file creation and workflow execution. This prevents misuse of Jules for simple local tasks and emphasizes the use of `runAndWait` for GitHub actions.

Additionally, the sandbox worker's timer permissions have been adjusted to be more robust, and the GitFs initialization logic has been improved for better error handling and cache management.
