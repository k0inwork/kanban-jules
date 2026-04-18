# Activity Report: collective (4 Days)

## Total Commits: 32

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
