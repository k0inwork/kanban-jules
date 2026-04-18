# Activity Report: docs/codebase-analysis-collective (All Time)

## Total Commits: 172

## Summary of Changes

* **feat: KB constitutions tab + editable constitution view + conflict-pending projection block** (2026-04-18) - Yanis Tabuns
- Add Constitutions sub-view in KB browser showing project + role constitutions
- Click constitution row opens editable tab with save to IndexedDB
- Block conflict-pending decisions from knowledge projector
- Fix micro-dream insight survival in sessionDream
- Add conflict severity prompt helper and ESCALATE type

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: evidence-based conflict classification, auto-resolve, resolution audit trail (136 tests)** (2026-04-17) - Yanis Tabuns
- 7-signal evidence scoring (provenance, duration, corroboration, verification,
  conflict survivor, supersession breadth, constitutional)
- 5 conflict types: constitutional-override, guiding (auto), self-correcting,
  doubtful (user), constitutional-amendment
- Auto-resolve for guiding (higher wins) and constitutional overrides
- Resolution audit entries (category: 'resolution') with both conflicting
  decisions, evidence scores, type/method tags for queryability
- Projector bypass for conflict-resolved entries at L2/L3
- Layer cascade: resolutions get union of both decisions' layers
- Conflict typology design doc with signal explanations and examples
- KBBrowser: resolution category color

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Merge pull request #12 from k0inwork/test-proposal-doc-3531426997528947166** (2026-04-17) - k0inwork
docs: add proposal for missing test coverage areas

* **fix: KB pipeline routing bugs + conflict resolution lifecycle (130 tests)** (2026-04-17) - Yanis Tabuns
BUG 2 (critical): sessionDream Phase 4b now preserves decision entries —
verified decisions survive to reach deepDream/decision log.
BUG 4: orchestrator fires executor:completed BEFORE microDream so
commit-harvest writes decisions before verifyDecisions runs.
BUG 1: sessionDream gathering excludes micro-dream insight output.
BUG 6: idempotency guards on microDream and sessionDream prevent
duplicate processing.
Conflict resolution: conflict-pending tags prevent re-escalation,
user:reply handler resolves conflicts via (a) pick / (b) pick / (c) merge,
merged decisions inherit combined tags + supersedes chain.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: Phase 1f conflict detection + Phase 1h decision log (8 tests)** (2026-04-17) - Yanis Tabuns
Phase 1f: detectConflicts() in sessionDream compares verified decisions
across tasks, escalates direct contradictions via AgentMessage with 3-option
resolution UI, creates conflict KB entries. Runs before Phase 4b deactivation.

Phase 1h: generateDecisionLog() in deepDream creates decision-log KB doc
grouped by classification with superseded history traces, upserts on repeat.

125 tests passing.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: Phase 1d micro dream verification + Phase 1e superseded tracing (16 tests)** (2026-04-17) - Yanis Tabuns
Phase 1d: verifyDecisions() in microDream classifies/verifies harvested
decisions via LLM — confirms or reclassifies tags, adds 'verified' tag,
gracefully handles malformed responses.

Phase 1e: supersedeEntries() with chain flattening + abstraction monotonicity
validation, traceDecisionChain() for O(1) full history lookup, both routed
through KBHandler.handleRequest().

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **docs: add proposal for missing test coverage areas** (2026-04-17) - google-labs-jules[bot]
Added a document proposing comprehensive testing strategies for areas beyond the currently well-tested KB module. The proposal covers testing core filesystem services (e.g., GitFs) with mocked HTTP, the isolated sandbox environment, frontend UI components using React Testing Library, the terminal WASM management system, and independent orchestrator executors.

Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **test: add commit-harvest and eventBus executor:completed tests (12 tests)** (2026-04-17) - Yanis Tabuns
Tests cover the event-driven decision extraction pipeline:
- Local executor path: moduleLogs → LLM extraction → KB entries
- Jules path: GitHub API commits → LLM extraction → KB entries
- Edge cases: short logs, malformed LLM response, empty results, API errors
- Lifecycle: init/destroy stops listening
- EventBus: emit/receive, multiple listeners, off

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: unified decision harvest — both agent types via event listener** (2026-04-17) - Yanis Tabuns
No recordDecision() needed in agent code. Decision harvest is a
background dreamer that analyzes traces in a separate LLM context:
- Jules: fetches GitHub commits on executor:completed, extracts decisions
- Yuan: reads moduleLogs on executor:completed, extracts decisions
Orchestrator now emits executor:completed for local tasks too.
Shared extraction prompt, same KB schema, no branching logic.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: event-driven commit harvest — Jules decisions flow to KB** (2026-04-17) - Yanis Tabuns
- Add executor:completed event to SystemEvent types (event-bus.ts)
- JulesPostman emits executor:completed on session COMPLETED
- New commit-harvest.ts: listens for event, fetches commits from
  GitHub API, LLM extracts decisions, stores in KB (source: dream:micro)
- Wired into ModuleHost init/stop lifecycle

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **refactor: two separate decision paths — no branching logic** (2026-04-17) - Yanis Tabuns
External (Jules): fires executor:completed event → dream engine fetches
commits from GitHub API → extracts decisions. Internal (Yuan): calls
recordDecision() directly during execution, no event. Completely
separate paths, no runtime branching needed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: event-driven commit harvest for external agent decisions** (2026-04-17) - Yanis Tabuns
Micro dream listens to executor:completed events instead of polling git.
JulesPostman emits event on session COMPLETED, handler fetches commits
via GitHub API (githubToken already in HostConfig). Internal agents
trigger same event from Orchestrator. Extract vs verify mode depends
on whether KB declarations exist.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: dual-source decision capture — commit messages for external agents** (2026-04-17) - Yanis Tabuns
External agents (Jules etc.) can't call KB API, so micro dream extracts
decisions from their git commit messages + diffs. Internal agents (Yuan)
declare via API + commit messages as backup. Dream classifies agent type
and runs extract vs verify mode accordingly.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: MVP1 Decision Harvest doc + projector focus field + FixedKBSource stub** (2026-04-17) - Yanis Tabuns
- Add docs/mvp-phase1-decision-harvest.md: agent decision declaration,
  conditional task branching, superseded DAG tracing, conflict escalation,
  constitution feedback loop
- Add focus field to TaskStep, pass to ProjectorHandler for scoped projections
- Add FixedKBSource test stub and setExternalSources() for test injection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: add missing fast-glob shim delegating to Go WASM glob** (2026-04-17) - Yanis Tabuns
The collective branch referenced fast-glob-shim.js but never committed it.
Delegates to boardVM.fsBridge.glob (Go WASM) with empty fallback.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Merge remote-tracking branch 'origin/collective'** (2026-04-17) - Yanis Tabuns

* **fix: use [] brackets in tool call format prompts, add []+<> extraction** (2026-04-17) - Yanis Tabuns
Prompt examples now use [] brackets with instruction to replace with <>
to avoid XML mangling. Added Pass 1b extraction for [tool_call]NAME
format with both [] and <> bracket support in openai-shim and
BoardVMContext parsers.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: build pipeline for @yuaone bundles with manifest tracking** (2026-04-17) - Yanis Tabuns
Bundle script now gracefully handles missing node_modules/@yuaone/*
(reuses pre-built bundles), adds SHA-256 manifest for change detection,
and agent-bootstrap loads bundles via manifest instead of hardcoded file lists.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: doc RAG chunking, search, CRUD + GUI improvements (106 tests)** (2026-04-17) - Yanis Tabuns
- Add doc chunking to projectRAG: split by h1/h2 headers with parent context
- Add full-text search to queryDocs backend + chunk-based RAG search in GUI
- Add updateDocument/deleteDocument to KB handler + manifest
- Add content validation (non-empty markdown required)
- Add doc delete button, scroll-to-chunk on search click in GUI
- Fix PreviewPane scroll layout (parent flex container)
- Add 9 new tests: search, content validation, chunking, tag boost

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Merge remote-tracking branch 'origin/collective' into docs/codebase-analysis-collective** (2026-04-17) - Yanis Tabuns

* **refactor: consolidate KB to 5 categories + tabbed table view** (2026-04-17) - Yanis Tabuns
Reduce KB categories from 12 implicit to 5 explicit (error, observation,
insight, decision, correction) with tags for disambiguation. Add DB
migration v22 to rename old categories. Replace collapsible tree KB
browser with minimal sidebar overview + full table view as a tab.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **test: add GlobalVars persistence + analyze forwarding integration tests (85 total)** (2026-04-17) - Yanis Tabuns
- Flow 9: agentContext persists across task steps (2 tests)
  - Context set in step 1 survives into step 2 prompt
  - Context accumulates across 3 steps without loss
- Flow 10: analyze() output forwarded to subsequent steps (3 tests)
  - host.analyze result persisted to task.analysis, appears in next prompt
  - Multiple analyze() calls accumulate across steps
  - addToContext key-value pairs visible in later step prompts
- Update gap analysis: 14 integration tests, all MVP flows covered

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: add infrastructure + big lifecycle integration test (80 tests)** (2026-04-17) - Yanis Tabuns
- Add KB convenience writers (recordExecution, recordObservation, recordDecision, recordError)
- Add RepoScanner for project init tech stack detection and doc discovery
- Add board-idle trigger → sessionDream in host.ts
- Add on-task-complete → microDream + KB recording in orchestrator.ts
- Add sandbox KB bindings (KB.record, KB.queryLog, KB.saveDoc, KB.queryDocs)
- Add Flow 8: full e-commerce checkout lifecycle integration test (6 phases)
- Fix recordError source to 'execution' for sessionDream visibility
- Fix sessionDream to preserve errors for reflection (deactivate non-error only)
- Fix reflection Rule 5 KNOWN-GAP to use update() instead of bulkPut()
- 80 tests passing (71 unit + 9 integration)

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

* **docs: update test docs for 59 tests (53 unit + 6 integration)** (2026-04-16) - Yanis Tabuns
Updated coverage analysis (knowledge-kb 90%, process-dream 71%,
process-reflection 100%) and test suite explanation with all new
unit tests and integration pipeline descriptions.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **test: add 17 new tests — unit coverage gaps + 6 integration pipelines** (2026-04-16) - Yanis Tabuns
Unit tests (11 new): queryLog project filter, queryDocs source/layer/limit,
microDream supersedes + tag union, reflection rule 3/4/5 negation,
custom threshold, KNOWN-GAP tag-only behavior.

Integration tests (6 new): multi-task failure → self-healing,
dream propagation with abstraction climb, constitution evolution via deep-dream,
knowledge gap lifecycle, full agent session lifecycle, deep-dream pruning + amendment.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **docs: add test coverage gap analysis against MVP proposals** (2026-04-16) - Yanis Tabuns
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **docs: rewrite explanation doc to cover test suite** (2026-04-16) - Yanis Tabuns
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **docs: explain knowledge-kb, process-dream, and process-reflection systems** (2026-04-16) - Yanis Tabuns
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **test: add 42 tests for knowledge-kb, process-dream, process-reflection modules** (2026-04-16) - Yanis Tabuns
- applyRules (10 tests): all 5 reflection rules, negation cases, multi-rule firing
- ReflectionHandler (7 tests): reclassify, self-task creation, reflection logging, entry filtering
- DreamHandler (8 tests): micro/session/deep dream consolidation, pruning, constitution amendments, malformed JSON
- KBHandler (14 tests): recordEntry, queryLog (category/active/tags/source/layer/limit/sort), updateEntries, saveDocument (create/upsert/project isolation), queryDocs
- Fix IndexedDB boolean query bugs (.where('active').equals(1) → .filter(e => e.active)) across all 3 modules
- Fix missing 'title' index on kbDocs (v21 schema) — saveDocument upsert was broken without it
- Remove 4 dead imports from orchestrator.ts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **test: add headless e2e projector tests and fix KB queries** (2026-04-16) - Yanis Tabuns
- Add puppeteer-based e2e test (46 assertions across 4 suites)
  covering base projections, RAG retrieval, experience logs, and
  edge cases for the knowledge projector
- Fix KBBrowser and Handler queries: .where('active').equals(1) →
  .filter(d => d.active) for IndexedDB boolean compat
- Fix projector test data: add missing executor tags and layer
  entries so all assertions pass
- Make server port configurable via PORT env var
- Add vitest config, fake-indexeddb setup, test:e2e script

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: unify constitutions through projector with 3-part context model** (2026-04-16) - Yanis Tabuns
Move all constitution/knowledge injection into the projector's BASE section:
- L1 (ProcessAgent): project constitution + overseer constitution
- L2 (Architect): architect constitution only
- L3 (Programmer): programmer constitution + executor knowledge
Add OVERSEER_CONSTITUTION, wire ProcessAgent to projector, update
ConstitutionEditor GUI with Overseer tab, and remove duplicate
constitution loading from compose functions.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **docs: add self-healing agent design and Phase 0 KB+context propagation** (2026-04-15) - Yanis Tabuns
Self-healing agent: N+1 project model, 4 new Fleet modules (knowledge-kb,
knowledge-projector, process-dream, process-reflection), reflection rules,
mailbox proposal reuse. ~480 LOC estimate.

Phase 0 KB+context: three knowledge tiers, seven data flows, context
propagation engine with token budgets, dream engine levels.

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

* **docs: add Phase 0 MVP -- tagged log with dreaming appends** (2026-04-15) - Roo Code
Simplest viable PKB: append-only log where every entry gets tags, abstraction
level (0-10), and layer flags. Dreaming appends consolidated entries at higher
abstraction and marks raw entries inactive.

~100 LOC to implement. Upgradeable to graph index in later phases.
Migration path: log (Phase 0) -> graph index (Phase 1) -> token-budgeted
traversal (Phase 2) -> full module (Phase 3).

* **docs: explore PKB implementation approaches (graph, RAG, hybrid, event sourcing)** (2026-04-15) - Roo Code
5 approaches analyzed for building the Project Knowledge Base:

1. Knowledge Graph (IndexedDB-backed) -- graph traversal with abstraction filters
2. RAG (TF-IDF or embeddings) -- vector similarity search over text chunks
3. Multi-Structure Store -- different stores for different knowledge types
4. Code Graph (novel) -- single-table denormalized graph with token-budgeted traversal
5. Event Sourcing -- immutable event log with materialized views

Recommendation: Code Graph (#4) + Event Feed (#5) as a new knowledge-project-kb module.
Key innovation: token-budgeted projection (greedy traversal that stops at context window limit).
~600 LOC estimate as self-contained module with manifest.

* **docs: add Project Knowledge Base (PKB) with layer projections** (2026-04-15) - Roo Code
Constitution is the seed. As the system works, it accumulates:
- Architecture (structure, tech stack, patterns)
- Decisions (what was decided, why, rejected approaches)
- Experience (executor profiles, task patterns, error log)
- Wrong paths (approaches that failed and why)
- User model (preferences, corrections, communication style)

Each layer sees the PKB at its appropriate zoom level:
- L0 Yuan: strategic view (~2000 tokens) -- full arch, all decisions, exec profiles
- L1 Planner: tactical view (~1500 tokens) -- stage map, gaps, routing
- L2 Task: operational view (~1000 tokens) -- relevant files, exec tips, error context

Implemented as a read/write layer over existing Dexie tables with project() function.

* **docs: add control layers and context propagation design** (2026-04-15) - Roo Code
Covers the two fields of work:

1. Layers of responsibility (L0 Yuan -> L1 Process Planner -> L2 Task -> L3 Step -> L4 Executor)
   - Independence levels per layer
   - Why tasks should NOT spawn each other (only L0/L1 create tasks)
   - Layer interaction map

2. Context/data/experience propagation
   - Downward flow: instructions, constraints, knowledge
   - Upward flow: results, learnings, experience
   - Cross-task context transfer rules
   - Memory collections: Experience Store, Project Understanding, Constitution
   - Dreaming: micro-dream (post-task), session-dream (idle), deep-dream (scheduled)
   - Implementation sketch for all three dream levels

* **docs: rewrite MVP section -- Yuan as board planning agent, not coding agent** (2026-04-15) - Roo Code
- Correct Yuan role: brain/supervisor that controls Fleet, not a coder
- Document current state of all integration pieces (what exists, what is not wired)
- Analyze OBSERVE->THINK->PLAN->ACT loop from AGENT_HARNESS_ANALYSIS.md
- 4-phase wiring plan: activate ReAct loop, board monitoring, constitution-aware planning, multi-task orchestration
- Build priority table (~280 LOC across 8 components)
- Architecture diagram showing Yuan as brain, Fleet as hands

* **docs: add MVP functionality expansion section, move improvements to tech debt** (2026-04-15) - Roo Code

* **docs: add comprehensive codebase analysis for collective branch** (2026-04-15) - Roo Code

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

* **feat: Add isomorphic-git for repository interaction** (2026-04-11) - k0inwork
Integrates isomorphic-git library to enable local Git repository management and interaction. This includes adding necessary dependencies and updating the GitFs service to leverage the library for file system operations within Git repositories.

This change also includes:
- Adding Node.js polyfills for Vite.
- Improving error handling and timeouts for API calls.
- Adding safety checks for null/undefined responses in Jules API calls.

* **fix(toolfs): accumulate writes in Write() not Close() for WASI compat** (2026-04-10) - Yanis Tabuns
Same fix as LLMFS: WASI never calls Close() on file handles, so tool
calls were never fired. Now accumulates into lastReq during Write() and
triggers the actual JS callTool when /tools/result is opened.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **fix: LLM call chain, WASI compilation, and stale closures** (2026-04-10) - Yanis Tabuns
- Build agent.wasm with GOOS=wasip1 (WASI runtime needs wasi_snapshot_preview1, not gojs)
- Fix LLMFS write chain: accumulate data in Write() not Close() since WASI never calls Close()
- Fix TerminalPanel stale closures with refs for API config props
- Override model name in sendRequest with configured model
- Fix pass-through body bug (send JSON.stringify(req) not raw reqJSON)
- Pass API config props from App.tsx to TerminalPanel

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **Merge remote-tracking branch 'refs/remotes/origin/feat/wasm-executor' into feat/wasm-executor** (2026-04-10) - Yanis Tabuns

* **porgress on wasm agent. mostly testing** (2026-04-10) - Yanis Tabuns

* **feat: Show user-initiated actions in Mailbox** (2026-04-10) - k0inwork
Update MailboxView to only display "Click to review and accept" buttons for messages from the user or the process agent.

In orchestrator, change the default nextWorkflowStatus from 'IN_REVIEW' to 'DONE' when a task status is 'DONE', aligning with the desired workflow.

* **feat: Improve error handling and retry logic** (2026-04-10) - k0inwork
Adds retry mechanisms to LLM calls and API requests. This includes implementing exponential backoff for network-related errors in `host.ts` and `julesApi.ts`.

Introduces a new `sendUser` tool to allow agents to send messages to the user without blocking execution, improving agent responsiveness.

Enhances prompt instructions to clarify the behavior of `askUser` and introduces `sendUser`.

* **feat(jules): Enable branch creation and PR reporting** (2026-04-09) - k0inwork
Update Jules to report branch names when creating code or pushing to Git. This allows the orchestrator to trigger CI/CD workflows via GitHub Actions.

Also, enhance the SessionOutput interface to accommodate additional pull request details like branch names.

* **feat(negotiator): Verify Jules progress against success criteria** (2026-04-09) - k0inwork
Integrate LLM call within JulesNegotiator to analyze progress updates. If a progress update indicates the final answer has been reached and meets the success criteria, it will be treated as the final response from Jules.

Also includes improvements to GithubHandler for more robust default branch detection and network error handling during repository info fetching, as well as a helper for fetch with retries.

Additionally, a setup script for git installation and repository pulling/cloning has been added.

* **chore: update WASM assets [skip ci]** (2026-04-08) - github-actions[bot]

* **feat(llmfs): add LLMFS 9p filesystem with real API calls and timestamped responses** (2026-04-09) - Yanis Tabuns
Adds LLMFS (Go fs.FS) exposing /#llm/prompt (write) and /#llm/response (read)
as a 9p tunnel for bidirectional LLM communication inside the VM. Replaces
echo placeholder with real Gemini/OpenAI API calls using host config. Responses
are prefixed with [timestamp] so clients can distinguish fresh from stale.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat: Display current agent for tasks** (2026-04-09) - k0inwork
Adds functionality to display the currently assigned agent for a task in both the TaskCard and TaskDetailsModal components.

This includes a helper function `getCurrentAgentName` that determines the agent based on the task's protocol steps (in progress, next, or last completed) or directly from the `agentId` if no protocol is active. The default is 'Architect'.

Also includes refactors to the `orchestrator` to store the `architectModel` and to the `JulesHandler` and `JulesNegotiator` to use `context.llmCall` directly for verification instead of a dedicated `verify` method. Removes the `reuseSessions` flag from `JulesSessionManager`.

* **Merge remote-tracking branch 'refs/remotes/origin/feat/wasm-executor' into feat/wasm-executor** (2026-04-08) - Yanis Tabuns

* **wanix runs** (2026-04-08) - Yanis Tabuns

* **chore: update WASM assets [skip ci]** (2026-04-08) - github-actions[bot]

* **feat(wasm): add WASM terminal with v86 VM boot and interactive console** (2026-04-08) - Yanis Tabuns
Adds a complete WASM-based terminal panel that boots a v86 VM using Wanix,
with xterm.js for display and bidirectional pipe communication for I/O.
Includes boot.wasm (Go), GitFs/BoardFS implementations, executor handler,
system init scripts, and build workflow.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

* **feat(task): enable automatic task progression and user interaction** (2026-04-08) - k0inwork
This commit enhances the task progression by allowing tasks to automatically resume when an agent is idle and the status is 'IN_PROGRESS'. It also introduces a 'WAITING_FOR_USER' state, enabling agents to explicitly request user input and pause execution.

The TaskCard and TaskDetailsModal components have been updated to reflect these changes, including a new "Continue" button for resuming tasks waiting for user input.

The orchestrator logic has been refactored to handle task pauses and continuations more effectively, ensuring that steps are processed sequentially and that the agent state correctly reflects user interaction requirements.

Prompt instructions have been updated to guide agents on using the `askUser` API and to consolidate GitHub executor steps.

Additionally, unused Jules sessions are now correctly handled, and their local records are deleted if the remote session is not in a reusable state, preventing the reuse of potentially stale or completed sessions.

* **feat(executor-jules): Improve session creation and prompt handling** (2026-04-07) - k0inwork
Refactors Jules session creation logic to correctly format the `sourceContext` and handle new `prompt` and `successCriteria` argument structures. This ensures more robust session initialization and clearer input parsing for the Jules API.

* **feat: Add GitHub token configuration** (2026-04-07) - k0inwork
Integrates GitHub token support into the Agent Kanban application. This allows the application to authenticate with GitHub for repository operations, such as writing artifacts.

The GitHub token is now configurable via settings, can be persisted in local storage, and is available in the `RequestContext` for tools that require it. This enhancement is crucial for enabling features that interact with remote repositories.

* **refactor: Replace GlobalVars with AgentContext** (2026-04-07) - k0inwork
This commit refactors the application to use `AgentContext` instead of `GlobalVars` for managing task-specific, persistent state.

The `AgentContext` service provides a more robust and explicit mechanism for storing and retrieving data relevant to the current task. This change improves clarity and maintainability by clearly demarcating where task-specific data resides.

Key changes include:
- Renaming `GlobalVars` to `AgentContext` and updating imports.
- Modifying `host.globalVarsGet` and `host.globalVarsSet` to `host.agentContextGet` and `host.agentContextSet`.
- Updating the prompt to reflect the use of `AgentContext`.
- Adjusting sandbox bindings to expose `AgentContext` instead of `GlobalVars`.
- Adding logic to `ArtifactTool` to save artifacts to `.artifacts/` in the repository if Git access is available.

* **refactor: Improve task deletion and tool argument handling** (2026-04-07) - k0inwork
Enhance task deletion to properly remove associated artifacts and their links.
Refactor tool argument parsing to support both positional and object-based arguments for better flexibility and readability.
Update the orchestrator to include 'host.addToContext' as a valid tool.
Remove unused 'callLlm' method from orchestrator.
Adjust sandbox worker to no longer include 'createArtifact' in storage tools, as it's handled differently.

* **feat(orchestrator): Pass llmCall to orchestrator** (2026-04-07) - k0inwork
The orchestrator now accepts `llmCall` from the host configuration. This allows the orchestrator to use the host's specific LLM implementation, making the LLM interaction more flexible and decoupled.

Additionally, several modules and sandbox bindings have been updated to accommodate new functionalities and improve context management. This includes introducing the `LocalAnalyzer` and exposing global variables through the sandbox.

* **feat: Integrate local and GitHub executors** (2026-04-07) - k0inwork
Adds the `LocalHandler` and `GithubHandler` to the `ModuleHost`, enabling tasks to execute code locally and interact with GitHub repositories. Updates the `Orchestrator` to default to the local executor and refines the `ProgrammerPrompt` to include available executors and common tools for better agent guidance. Enhances `saveArtifact` in `ArtifactTool` to support optional `type` and `metadata` fields for richer artifact storage.

* **feat: Consolidate configuration into HostConfig** (2026-04-07) - k0inwork
Refactors the application to use a single `HostConfig` interface for managing all settings, including Jules, Gemini, OpenAI, and repository details. This simplifies state management and prop drilling, making the codebase more maintainable and easier to understand.

The `OrchestratorConfig` has been simplified to only contain orchestrator-specific settings, as other configurations are now handled by `HostConfig`. The `SettingsModal` and `ModuleHost` have been updated to use and manage this new consolidated configuration structure.

* **feat: Refactor Jules and Repo module configurations** (2026-04-07) - k0inwork
Removes Jules API key, daily limit, and concurrent limit from global settings.
These configurations are now managed by the respective Jules module manifest,
allowing for more granular control and avoiding duplication. The repository
URL and branch settings are also moved to the knowledge-repo-browser module.

* **feat: Remove Jules API key config and pass context to handlers** (2026-04-07) - k0inwork
The Jules API key is no longer required for configuration. Module handlers now receive a RequestContext object, which includes relevant information like taskId, repoUrl, repoBranch, and an llmCall function. This change centralizes context passing and removes the need for specific API key configuration at the orchestrator level. Additionally, the `julesApiKey` field has been removed from the `OrchestratorConfig` and `SettingsModal`.

* **feat: Add module configuration and host bindings** (2026-04-07) - k0inwork
Introduces a new `moduleConfigs` state to manage settings for individual modules. This allows for more granular control over module behavior.

Additionally, integrates host-provided analysis and context functions (`host.analyze`, `host.addToContext`) into the orchestrator's sandbox bindings. This enables modules to directly interact with the host for these operations without needing explicit tool definitions.

Also refactors JulesPostman to use a singleton pattern and updates `manifest.json` files to include new configuration fields and permissions for better module management and extensibility.

* **feat: Modularize module initialization and configuration** (2026-04-07) - k0inwork
Refactors the application to initialize and configure modules dynamically. This change centralizes module initialization logic within the `ModuleRegistry` and `Host`, allowing for per-module configuration passed via `OrchestratorConfig`. The sandbox execution is also updated to accept permissions and bindings.

Key changes:
- `App.tsx` now passes module-specific configurations to the host.
- `Host.ts` iterates through enabled modules for initialization.
- `Orchestrator.ts` injects sandbox permissions and bindings based on the executor module.
- `Registry.ts` defines `init` and `destroy` functions for modules and includes specific tool initializations.
- `Sandbox.ts` is updated to accept `permissions` and `sandboxBindings` during execution.
- `types.ts` introduces interfaces for `ResourceLimit`, `ConfigField`, and `ModulePresentation` to support structured module configuration.

* **refactor: Remove unused Module Management feature** (2026-04-07) - k0inwork
The Module Management modal and its associated logic have been removed from the application as it is no longer being actively used or developed. This cleans up the codebase by eliminating dead code and unused components.

* **feat: Add module management UI and sandbox worker** (2026-04-07) - k0inwork
Introduces a new modal for managing agent modules and refactors the sandbox execution to use a Web Worker. This improves performance and isolates script execution. The module registry is updated to include the new architect codegen module.

* **feat: Add module toggles and improve tool invocation** (2026-04-07) - k0inwork
Introduces the ability to enable/disable modules from the settings UI. This change also refactors tool invocation to use the `registry.invokeHandler` method, making the `ModuleHost` more generic and removing direct tool calls. Additionally, it updates the artifact filtering logic to correctly handle artifacts without names and ensures that internal artifacts are only visible to their owning task.

* **feat: Refactor logging and module communication** (2026-04-07) - k0inwork
Replace direct log appending with event bus emission for better decoupling.
Introduce a structured `moduleLogs` field for tasks to store logs from different modules.
Update UI components to display module-specific logs.
Add event listeners in `ModuleHost` to handle incoming module logs and requests, routing them to the correct handlers.
Define a `SystemEvent` type for the event bus to enforce type safety.
Streamline task creation by removing `actionLog` and initializing `moduleLogs` as an empty object.

* **feat: Add Vitest and refactor prompt parsing** (2026-04-06) - k0inwork
Introduces Vitest for testing and reorganizes prompt parsing logic into a dedicated core module.
This change also includes updates to the database schema to accommodate new logging structures and removes unused code.

* **refactor: Modularize Jules and introduce executors** (2026-04-06) - k0inwork
This commit restructures the application to better manage different agent executors, particularly Jules.

Key changes include:
- Moving Jules-specific services and managers into a dedicated `modules/executor-jules` directory.
- Introducing a core `executor` concept, allowing tasks to be delegated to specific modules (e.g., 'local', 'executor-jules').
- Updating Task Architect to reflect the new `executor` field instead of `delegateTo`.
- Adjusting agent states from `WAITING_FOR_JULES` to `WAITING_FOR_EXECUTOR` for broader applicability.
- Renaming `jnaLogs` and `unaLogs` to `moduleLogs` in task details for consistency.
- Updating imports across the application to reflect the new module structure.

* **feat: Implement module system for agent capabilities** (2026-04-06) - k0inwork
Introduces a new module system to abstract agent capabilities, enabling better organization, testability, and extensibility. This change defines module interfaces, manifests, and the overall architecture for how modules interact with the orchestrator and sandbox. Key features include bundled modules, dynamic prompt composition, and generalized sandbox injection.

* **feat: Enhance agent loop and task processing logic** (2026-04-05) - k0inwork
Refactor agent loop to improve task selection and add detailed logging. Update TaskCard to remove deprecated delete functionality. Adjust artifact filtering logic in TaskDetailsModal and ProcessAgent to correctly handle artifacts without names or with names not starting with '_'. Improve JulesSessionManager by adding action logging for session management and refining session reuse logic. Update TaskArchitect to clarify artifact creation guidelines, distinguishing between persistent artifacts and global variables, and remove the '_' prefix requirement for artifacts. Enhance Orchestrator by adding detailed logging and improving the description of available subagent functions, particularly regarding GlobalVars usage.

* **feat: Add JNA and UNA logs and improve user interaction** (2026-04-05) - k0inwork
Introduces new fields for storing Java Native Access (JNA) and User Non-Agent (UNA) logs within tasks. Enhances user interaction by adding response validation and improving the logging of user-agent conversations. Also refactors the orchestrator to include a dedicated programming log.

* **feat: Introduce Orchestrator and Negotiator pattern** (2026-04-05) - k0inwork
Refactors the agent architecture to a distributed system. The Main Architect now orchestrates tasks by emitting executable JavaScript, delegating complex interactions to specialized Negotiator Agents (JNA, UNA, CNA). This prevents context pollution and improves reliability.

Adds the `sval` dependency for secure code execution. Updates documentation to reflect the new architecture.

* **feat(task): Parse tasks from agent messages** (2026-04-03) - k0inwork
Introduces the ability to extract concrete tasks from agent messages. This enhances the agent's capability to understand and act upon requests by parsing message content into structured tasks when a direct `proposedTask` is not available. Supports both Gemini and OpenAI APIs for task parsing.

* **feat: Refactor task management and Jules integration** (2026-04-03) - k0inwork
Improves task persistence by using `useLiveQuery` for real-time updates.
Enhances Jules session management by checking for failed sessions and allowing recreation.
Updates task protocol generation to better define Jules and local agent capabilities and delegation rules.
Introduces retry counts for tasks and messages for improved resilience.
Adds activityName to messages for better tracking of communication flow.
Reorganizes `LocalAgent` to correctly assess Jules's last message before execution.

* **feat: Add Gemini API support and debug info download** (2026-04-03) - k0inwork
Integrates Gemini API for agent functionality and allows users to download task debug information. This includes updates to settings, task details, and the core agent logic to accommodate the new API and debugging features.

* **feat: Improve task protocol generation and artifact handling** (2026-04-03) - k0inwork
Refactors task protocol generation to use a dedicated function. Updates artifact handling to ensure relevant artifacts are fetched based on context and task association. Removes unnecessary local artifact filtering in the ArtifactBrowser component. Adds functionality to create a task directly from mailbox messages. Enhances task details modal to include API provider configuration.

* **Implement Smart Delegation: TaskArchitect marks CLI-heavy stages for Jules** (2026-04-02) - k0inwork

* **Implement underscore prefix convention for local vs global artifacts** (2026-04-02) - k0inwork

* **Tighten Jules session assignment and add verification criteria to protocols** (2026-04-02) - k0inwork

* **Implement protocol-driven execution: repurpose TaskRouter as TaskArchitect, add finishStage tool, and Protocol tab** (2026-04-02) - k0inwork

* **refactor: Update task state and workflow enum** (2026-04-03) - k0inwork
This commit refactors the task state management to use more descriptive enum values for workflow status and agent state. It also updates the UI components and logic to reflect these changes, improving clarity and maintainability.

Changes include:
- Renaming `TaskStatus` to `WorkflowStatus` with values like `TODO`, `IN_PROGRESS`, `IN_REVIEW`, and `DONE`.
- Introducing a new `AgentState` enum with values like `IDLE`, `EXECUTING`, and `PAUSED`.
- Modifying `App.tsx` to use the new enums when creating and updating tasks.
- Updating `KanbanBoard.tsx`, `KanbanColumn.tsx`, and `MailboxView.tsx` to display and filter tasks based on the new status fields.
- Adjusting `JulesProcessBrowser.tsx` to reflect the updated task linking logic.
- Updating `TaskCard.tsx` to display the new agent state and workflow status.

* **feat(jules): Reuse existing sessions for new tasks** (2026-04-02) - k0inwork
When starting a new task, Agent Kanban now attempts to reuse an existing, non-active Jules session from the same repository and branch. This improves efficiency by avoiding the creation of redundant sessions and allows Jules to leverage prior context if appropriate.

If a session is reused, its `taskId` and `title` are updated to reflect the new task, and Jules is prompted to forget previous context before receiving the new task information.

* **feat: Add task action log for improved tracking** (2026-04-02) - k0inwork
Introduces an 'actionLog' field to tasks to record sequential agent actions, decisions, and tool calls. This provides a detailed history of how a task was processed locally, enhancing debugging and transparency.

A new "Actions" tab is added to the Task Details modal to display this log.

* **feat: Tag user questions with sequential numbers** (2026-04-02) - k0inwork
Adds a counter to track questions asked by the agent to the user for a specific task. Each question will be prefixed with a sequential tag (e.g., {Q1}, {Q2}) to help users differentiate and respond to specific inquiries within a task thread.

This change also improves the handling of user messages in the UI by associating them with the correct task and ensures that the question count is updated correctly when the agent pauses a task to await user feedback.

* **feat: Enhance task chat and messaging functionality** (2026-04-02) - k0inwork
This commit introduces several improvements to how task messages and agent interactions are handled.

The agent's messages are now appended to the task's chat history, providing a continuous conversation log for each task. Additionally, the `MailboxView` component has been refactored to display messages grouped by task, improving organization and providing unread counts.

Error handling for artifact content has also been improved to prevent issues with undefined content.

* **feat: Enhance task management and user experience** (2026-04-02) - k0inwork
Introduces persistent task storage using IndexedDB, allowing tasks to be saved and loaded automatically. Updates the Kanban board with new status columns for better task flow visualization. Implements session pruning for the Jules Process Browser to clean up inactive sessions. Adds features to the Mailbox and Preview panes, including message archiving, replying to messages, accepting/declining proposals, and a new message composer for interacting with specific tasks. Expands the task status types to include 'INITIATED', 'WORKING', 'PAUSED', and 'POLLING'.

* **Merge pull request #6 from k0inwork/clean-scripts-4028932731280235710** (2026-04-02) - k0inwork
chore: remove temporary script files

* **chore: delete temporary script files** (2026-04-02) - google-labs-jules[bot]
Deleted all files matching `fix_*.cjs`, `patch_*.cjs`, and `update_*.cjs` from the root directory to clean up the repository.

Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **Update 2-04.ideas.md** (2026-04-02) - k0inwork

* **Enhance notebook with ML integration and config options** (2026-04-02) - k0inwork
Propose adding server-side tooling for mcps installation.

* **Add ideas for notebook ML integration** (2026-04-02) - k0inwork

* **Update agent mail design documentation** (2026-04-02) - k0inwork
Removed sections on Global/Broadcast Messaging and External Message Forwarding, and added clarification on ProcessAgent behavior regarding user directives and session statuses.

* **Merge pull request #5 from k0inwork/fix-gemini-api-key-initialization-11018902194492621949** (2026-04-02) - k0inwork
Fix: Avoid GoogleGenAI initialization crash in browser when API key is not present

* **Fix: Avoid GoogleGenAI initialization crash in browser when API key is not present** (2026-04-01) - google-labs-jules[bot]
In Vite, `process.env.GEMINI_API_KEY` is undefined and causes the `@google/genai` sdk to throw an error when instantiating `GoogleGenAI` if OpenAI or another provider is selected but no gemini key is stored. Updated to use the state `geminiKey` (with a dummy key fallback) and `import.meta.env` appropriately.

Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **Merge pull request #4 from k0inwork/feat/add-proxy-support-9026984183698552040** (2026-04-02) - k0inwork
Feat/add proxy support 9026984183698552040

* **fix: Ensure all settings are correctly passed and saved in App.tsx** (2026-04-01) - google-labs-jules[bot]
Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **feat: Add Gemini API Key setting to UI** (2026-04-01) - google-labs-jules[bot]
Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **fix: Update ProcessAgent GoogleGenAI initialization and SettingsModal proxy setting** (2026-04-01) - google-labs-jules[bot]
Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **fix: Ensure Proxy URL is correctly populated in SettingsModal** (2026-04-01) - google-labs-jules[bot]
Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **fix: Add Proxy URL input field to SettingsModal UI** (2026-04-01) - google-labs-jules[bot]
Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **Merge pull request #2 from k0inwork/feat/add-proxy-support-9026984183698552040** (2026-04-01) - k0inwork
feat: Add proxy (SOCKS5) support to LLM and Jules APIs

* **feat: Add proxy (SOCKS5) support to LLM and Jules APIs** (2026-04-01) - google-labs-jules[bot]
Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **Merge pull request #1 from k0inwork/design/agent-mail-chat-system-14870438180252362448** (2026-04-01) - k0inwork
docs: add design document for agent mail and chat system

* **docs: add design document for agent mail and chat system** (2026-04-01) - google-labs-jules[bot]
Co-authored-by: k0inwork <5244356+k0inwork@users.noreply.github.com>

* **docs: Add new ideas for Agent Kanban features** (2026-04-01) - k0inwork
This commit adds a list of potential future features and improvements for the Agent Kanban application. The ideas cover aspects like agent-user interaction, task routing, resource management, workflow integration, UI enhancements, and bug reporting.

* **feat: Toggle constitution view** (2026-04-01) - k0inwork
Introduce a state variable to manage the visibility of the constitution editor. This allows for a cleaner way to toggle the constitution view without directly manipulating the tabs array. The UI now reflects the open state of the constitution.

* **feat: Introduce autonomy modes and project constitution** (2026-04-01) - k0inwork
This commit refactors the application to support different autonomy modes for the AI agents: manual, assisted, and full.

It also introduces a project constitution feature, allowing users to define guiding principles for agent behavior within a specific repository and branch. This is stored in a new `projectConfigs` table in the database.

Additionally, initial tasks have been cleared, and several UI components and icons have been updated to accommodate these new features. The `MailboxView` now conditionally renders the "Accept Proposal" button based on the autonomy mode and supports an optional `autoStart` flag. The `PreviewTabs` component has been extended to handle a new 'constitution' tab type.

* **feat: Add mailbox and agent messaging functionality** (2026-04-01) - k0inwork
Introduces a new `AgentMessage` schema to the database and integrates a `MailboxView` component. This enables the application to store and display messages from AI agents, facilitating better communication and task supervision.

Includes updates to the `ArtifactTool` to support more flexible artifact querying.

* **feat: Integrate AI agent settings and API provider selection** (2026-04-01) - k0inwork
Adds functionality to configure AI agent settings, including API endpoint, key, repository details, and enables selection between Gemini and OpenAI API providers. This includes updating the settings modal and task routing logic to support different API configurations.

* **feat: Refactor task routing and local agent capabilities** (2026-04-01) - k0inwork
Introduces a new `routeTask` function to intelligently determine task execution location. Updates local agent capabilities to be more explicit and defines specific tools available to it. Refactors `TaskRouter`, `ArtifactTool`, `RepositoryTool`, and introduces `LocalAnalyzer` to support these changes.

* **feat(tools): Integrate artifact and repository tools** (2026-04-01) - k0inwork
Adds new tools for interacting with artifacts and repositories, enabling more sophisticated task management. Updates task routing to assess task feasibility locally versus via Jules, and enhances settings modal to accept and display source IDs. Includes extensive logging for Jules API requests.

* **feat: Add source ID to settings and GitHub URL parsing** (2026-04-01) - k0inwork
Introduces a new `sourceId` field to the settings to store and retrieve a unique identifier for the source.
This change also enhances the GitHub URL parsing in the `GithubWorkflowMonitor` component to support more flexible URL formats, including those starting with `api.github.com/repos/`.

* **feat: Add Jules process browser and GitHub workflow monitor** (2026-03-31) - k0inwork
Introduces new components to visualize Jules processes and monitor GitHub workflows. Also enhances task details modal with artifact analysis capabilities and updates settings to include a Jules source name.

* **feat: Integrate artifact management and task deletion** (2026-03-31) - k0inwork
Introduces functionality for attaching artifacts to tasks and deleting tasks. Updates TaskCard and KanbanColumn components to handle new drag-and-drop events for artifacts and user-initiated task deletions. Modifies App.tsx to manage these new actions and includes `dexie-react-hooks` for potential future data synchronization improvements.

* **feat: Initialize Agent Kanban project** (2026-03-31) - k0inwork
Sets up the foundational structure for the Agent Kanban application. This includes:
- Initializing project dependencies and build tools (Vite, React, Tailwind CSS).
- Configuring TypeScript for development.
- Adding basic application metadata and entry point.
- Creating placeholder files and environment configuration for Gemini API integration and local development.
- Updating README with setup instructions.

* **Initial commit** (2026-03-31) - k0inwork
