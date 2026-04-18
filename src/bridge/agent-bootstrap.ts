/**
 * agent-bootstrap — creates almostnode container, installs yuaone packages,
 * injects shims, and provides the YUAN agent runner.
 *
 * This is the JS-side implementation of what yuanfs.go expects:
 *   window.boardVM.yuan.init()   → create container, install, inject shims
 *   window.boardVM.yuan.send(msg)→ run agent with message, return response
 *   window.boardVM.yuan.status() → current status string
 *
 * The almostnode container provides a Node.js-like runtime in the browser
 * with a virtual filesystem (VFS). Packages are installed into VFS via npm,
 * and shims replace native packages (openai) with boardVM-backed implementations.
 */

// almostnode is imported dynamically to avoid Vite bundling its web worker at build time
// import { createContainer as almostnodeCreateContainer } from 'almostnode';

// Shim source files (imported as raw text for VFS injection)
import openaiShimSource from './openai-shim.js?raw';
import fleetToolsShimSource from './fleet-tools-shim.js?raw';
import fsBridgeShimSource from './fs-bridge-shim.js?raw';
import fastGlobShimSource from './fast-glob-shim.js?raw';

// --- Types ---
type AlmostNodeContainer = {
  vfs: any;
  npm: any;
  execute: (code: string, filename?: string) => any;
  runFile: (filename: string) => any;
};

// --- Container state ---

let container: AlmostNodeContainer | null = null;
let agentReady = false;

// Access the inline boardVM on globalThis (set by TerminalPanel)
function getBoardVM(): any {
  return (globalThis as any).boardVM;
}

// --- Create the almostnode container ---

async function createAlmostnodeContainer(): Promise<AlmostNodeContainer> {
  // Dynamic import so almostnode is loaded at runtime, not bundled statically
  const almostnode: any = await import('almostnode');
  const createContainer = almostnode.createContainer || almostnode.default?.createContainer;
  if (!createContainer) throw new Error('almostnode.createContainer not found');

  const c = createContainer({
    cwd: '/workspace',
    env: { NODE_ENV: 'production' },
    onConsole: (method: string, args: any[]) => {
      console.log(`[almostnode:${method}]`, ...args);
    },
  });

  return c;
}

// --- Install packages into VFS ---

async function installPackages(c: AlmostNodeContainer): Promise<void> {
  console.log('[yuan-bootstrap] installing @yuaone/core + @yuaone/tools from local bundle...');

  // Pipeline: scripts/bundle-yuaone.mjs → public/assets/wasm/yuaone-bundles/*.json + manifest.json
  // Runtime: fetch manifest → fetch each bundle → write into almostnode VFS
  const bundleBase = '/assets/wasm/yuaone-bundles';

  // Load manifest to discover available bundles
  let manifest: Record<string, { version: string; files: number; hash: string; bundleFile: string }> = {};
  try {
    const manifestResp = await fetch(`${bundleBase}/manifest.json`);
    if (manifestResp.ok) {
      manifest = await manifestResp.json();
      console.log(`[yuan-bootstrap] manifest loaded: ${Object.keys(manifest).join(', ')}`);
    }
  } catch {
    console.warn('[yuan-bootstrap] manifest.json not found, loading bundles by convention');
  }

  for (const [pkg] of [
    ['@yuaone/core'],
    ['@yuaone/tools'],
  ] as const) {
    const entry = manifest[pkg];
    const bundleFile = entry?.bundleFile || `${pkg.replace('/', '_')}.json`;

    try {
      const resp = await fetch(`${bundleBase}/${bundleFile}`);
      if (resp.ok) {
        const files: Record<string, string> = await resp.json();
        const dir = `/node_modules/${pkg}`;
        c.vfs.mkdirSync(dir, { recursive: true });
        c.vfs.mkdirSync(`${dir}/dist`, { recursive: true });
        for (const [path, content] of Object.entries(files)) {
          const fullPath = `${dir}/${path}`;
          c.vfs.writeFileSync(fullPath, content);
        }
        // Write package.json with manifest version if available
        c.vfs.writeFileSync(`${dir}/package.json`, JSON.stringify({
          name: pkg, version: entry?.version || '0.0.0-local', main: 'dist/index.js',
        }));
        console.log(`[yuan-bootstrap] ${pkg}: ${Object.keys(files).length} files from bundle (hash ${entry?.hash || 'n/a'}, v${entry?.version || 'unknown'})`);
        continue;
      }
    } catch (e: any) {
      console.warn(`[yuan-bootstrap] bundle fetch failed for ${pkg}: ${e.message}, falling back to npm`);
    }

    // Fallback: try npm install (requires internet)
    console.log(`[yuan-bootstrap] falling back to npm install for ${pkg}...`);
    await c.npm.install(pkg);
  }

  // @yuaone/tools depends on child_process for shell_exec/bash/git_ops/test_run
  // Those tools won't work in browser until v86 bridge is implemented,
  // but file_read/file_write/file_edit/glob/grep/code_search/web_search/task_complete
  // work fine with the VFS and don't need child_process.
  console.log('[yuan-bootstrap] packages installed');
}

// --- Inject shims into VFS ---

function injectShims(c: AlmostNodeContainer): void {
  // openai shim: require('openai') → boardVM.llmfs.sendRequest()
  c.vfs.mkdirSync('/node_modules/openai', { recursive: true });
  c.vfs.writeFileSync('/node_modules/openai/index.js', openaiShimSource);
  c.vfs.writeFileSync('/node_modules/openai/package.json', JSON.stringify({
    name: 'openai',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // @fleet/tools shim: require('@fleet/tools') → boardVM.dispatchTool()
  c.vfs.mkdirSync('/node_modules/@fleet/tools', { recursive: true });
  c.vfs.writeFileSync('/node_modules/@fleet/tools/index.js', fleetToolsShimSource);
  c.vfs.writeFileSync('/node_modules/@fleet/tools/package.json', JSON.stringify({
    name: '@fleet/tools',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // chokidar shim (yuaone/core depends on it, but we don't need FS watching in browser)
  c.vfs.mkdirSync('/node_modules/chokidar', { recursive: true });
  c.vfs.writeFileSync('/node_modules/chokidar/index.js', [
    'module.exports = {',
    '  watch: function() { return { on: function() { return this; }, close: function() {} }; }',
    '};',
  ].join('\n'));
  c.vfs.writeFileSync('/node_modules/chokidar/package.json', JSON.stringify({
    name: 'chokidar',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // ts-morph shim (yuaone/core depends on it, heavy — stub for browser)
  c.vfs.mkdirSync('/node_modules/ts-morph', { recursive: true });
  c.vfs.writeFileSync('/node_modules/ts-morph/index.js', [
    'module.exports = {',
    '  Project: function() { this.addSourceFilesAtPaths = function() {}; this.getSourceFiles = function() { return []; }; },',
    '  SyntaxKind: {},',
    '};',
  ].join('\n'));
  c.vfs.writeFileSync('/node_modules/ts-morph/package.json', JSON.stringify({
    name: 'ts-morph',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // node:events shim (AgentLoop extends EventEmitter)
  c.vfs.mkdirSync('/node_modules/events', { recursive: true });
  c.vfs.writeFileSync('/node_modules/events/index.js', [
    'function EventEmitter() { this._events = {}; }',
    'EventEmitter.prototype.on = function(e, fn) { (this._events[e] = this._events[e] || []).push(fn); return this; };',
    'EventEmitter.prototype.emit = function(e) { var args = [].slice.call(arguments, 1); (this._events[e] || []).forEach(function(fn) { fn.apply(null, args); }); return true; };',
    'EventEmitter.prototype.removeListener = function(e, fn) { this._events[e] = (this._events[e] || []).filter(function(f) { return f !== fn; }); return this; };',
    'EventEmitter.prototype.removeAllListeners = function(e) { if (e) delete this._events[e]; else this._events = {}; return this; };',
    'EventEmitter.prototype.once = function(e, fn) { var self = this; function g() { self.removeListener(e, g); fn.apply(null, arguments); } this.on(e, g); return this; };',
    'EventEmitter.prototype.listenerCount = function(e) { return (this._events[e] || []).length; };',
    'EventEmitter.prototype.listeners = function(e) { return (this._events[e] || []).slice(); };',
    'EventEmitter.prototype.setMaxListeners = function() { return this; };',
    'module.exports = EventEmitter;',
    'module.exports.EventEmitter = EventEmitter;',
    'module.exports.default = EventEmitter;',
  ].join('\n'));
  c.vfs.writeFileSync('/node_modules/events/package.json', JSON.stringify({
    name: 'events',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // ollama shim — @yuaone/core tries to embed/index via Ollama, stub it out
  c.vfs.mkdirSync('/node_modules/ollama', { recursive: true });
  c.vfs.writeFileSync('/node_modules/ollama/index.js', [
    'module.exports = {',
    '  embed: async function() { return { embeddings: [[]] }; },',
    '  embeddings: async function() { return { embeddings: [[]] }; },',
    '  create: async function() { return {}; },',
    '  pull: async function() { return {}; },',
    '};',
  ].join('\n'));
  c.vfs.writeFileSync('/node_modules/ollama/package.json', JSON.stringify({
    name: 'ollama',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // node-pty shim — @yuaone/tools depends on it for PTY support, not available in browser
  c.vfs.mkdirSync('/node_modules/node-pty', { recursive: true });
  c.vfs.writeFileSync('/node_modules/node-pty/index.js', [
    'module.exports = {',
    '  spawn: function() { throw new Error("node-pty not available in browser"); },',
    '};',
  ].join('\n'));
  c.vfs.writeFileSync('/node_modules/node-pty/package.json', JSON.stringify({
    name: 'node-pty',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // playwright shim — @yuaone/tools depends on it for browser automation, not available in browser sandbox
  c.vfs.mkdirSync('/node_modules/playwright', { recursive: true });
  c.vfs.writeFileSync('/node_modules/playwright/index.js', [
    'module.exports = {',
    '  chromium: { launch: async function() { throw new Error("playwright not available in browser"); } },',
    '  firefox: { launch: async function() { throw new Error("playwright not available in browser"); } },',
    '  webkit: { launch: async function() { throw new Error("playwright not available in browser"); } },',
    '};',
  ].join('\n'));
  c.vfs.writeFileSync('/node_modules/playwright/package.json', JSON.stringify({
    name: 'playwright',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // fast-glob shim — walks VFS via boardVM.fsBridge with a tiny glob matcher
  c.vfs.mkdirSync('/node_modules/fast-glob', { recursive: true });
  c.vfs.writeFileSync('/node_modules/fast-glob/index.js', fastGlobShimSource);
  c.vfs.writeFileSync('/node_modules/fast-glob/package.json', JSON.stringify({
    name: 'fast-glob',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  // FS bridge shim: node:fs/promises and node:fs → boardVM.fsBridge (v86 filesystem)
  // This makes Yuan file tools (file_read, file_write, file_edit, glob, grep) operate
  // on the real v86 filesystem instead of almostnode's empty in-memory VFS.
  c.vfs.mkdirSync('/node_modules/node:fs', { recursive: true });
  c.vfs.writeFileSync('/node_modules/node:fs/promises.js', fsBridgeShimSource);
  c.vfs.writeFileSync('/node_modules/node:fs/promises/package.json', JSON.stringify({
    name: 'node:fs/promises',
    version: '0.0.0-shim',
    main: 'index.js',
  }));
  c.vfs.writeFileSync('/node_modules/node:fs/promises/index.js', fsBridgeShimSource);
  // node:fs uses the same bridge (sync calls are rare in the tools)
  c.vfs.writeFileSync('/node_modules/node:fs/index.js', fsBridgeShimSource);
  c.vfs.writeFileSync('/node_modules/node:fs/package.json', JSON.stringify({
    name: 'node:fs',
    version: '0.0.0-shim',
    main: 'index.js',
  }));

  console.log('[yuan-bootstrap] shims injected');
}

// --- Create the agent runner script ---

function createAgentRunner(c: AlmostNodeContainer): void {
  // This script runs inside almostnode and sets up the YUAN AgentLoop.
  // It's executed once via container.execute() during init.
  const runnerCode = `
    // Intercept fetch to stub out Ollama embedding calls (no Ollama in browser)
    var _origFetch = globalThis.fetch;
    globalThis.fetch = function(url, opts) {
      if (typeof url === 'string' && url.includes('localhost:11434')) {
        return Promise.resolve({ ok: true, status: 200, json: function() { return Promise.resolve({ embeddings: [[]] }); }, text: function() { return Promise.resolve(''); } });
      }
      return _origFetch.apply(this, arguments);
    };

    const { AgentLoop, BYOKClient } = require('@yuaone/core');
    const { createDefaultRegistry } = require('@yuaone/tools');

    // Build Yuan built-in tool registry (file_read, file_write, file_edit, glob, grep, etc.)
    var yuanRegistry = createDefaultRegistry();
    var yuanDefsRaw = yuanRegistry.toDefinitions();
    // Filter out any defs with undefined/missing function names
    var yuanDefs = yuanDefsRaw.filter(function(d) {
      return d && typeof d.name === 'string' && d.name.length > 0;
    });
    var yuanToolNames = new Set(yuanDefs.map(function(d) { return d.name; }));
    var yuanExecutor = yuanRegistry.toExecutor('/workspace');
    console.log('[yuan-runner] Yuan built-in tools:', yuanToolNames.size, '(' + Array.from(yuanToolNames).join(', ') + ')');

    // Fleet tool definitions from outside via globalThis._fleetToolDefs
    // (built dynamically from registry sandboxBindings in initYuanAgent)
    var fleetDefsRaw = globalThis._fleetToolDefs || [];
    // Filter out any defs with undefined/missing function names
    var fleetDefs = fleetDefsRaw.filter(function(d) {
      return d && typeof d.name === 'string' && d.name.length > 0;
    });
    console.log('[yuan-runner] Fleet tools raw:', fleetDefsRaw.length, 'valid:', fleetDefs.length);

    // Merge: Yuan defs first, then Fleet defs (skip duplicates by name)
    var _blockedTools = new Set(['shell_exec', 'bash', 'git_ops', 'test_run']);
    var allDefs = yuanDefs.filter(function(d) { return !_blockedTools.has(d.name); });
    var seenNames = new Set(allDefs.map(function(d) { return d.name; }));
    for (var fi = 0; fi < fleetDefs.length; fi++) {
      var fd = fleetDefs[fi];
      var fn = fd.name;
      if (!seenNames.has(fn) && !_blockedTools.has(fn)) {
        allDefs.push(fd);
        seenNames.add(fn);
      }
    }
    console.log('[yuan-runner] total merged tools:', allDefs.length, 'names:', allDefs.map(function(d) { return d.name; }).join(', '));

    // Pass all tool names to openai-shim so XML extraction only matches real tools
    var openaiShim = require('/node_modules/openai/index.js');
    if (openaiShim && openaiShim.setKnownToolNames) {
      openaiShim.setKnownToolNames(allDefs.map(function(d) { return d.name; }));
      console.log('[yuan-runner] passed tool names to openai-shim for dynamic XML extraction');
    }

    var boardVM = globalThis.boardVM;

    // Circuit breaker: detect dead Go WASM runtime and stop retrying
    var _runtimeDead = false;
    function isRuntimeDead(err) {
      return err && (String(err.message || err).indexOf('Go program has already exited') >= 0
        || String(err.message || err).indexOf('runtime is dead') >= 0);
    }

    // Combined tool executor: Yuan tools → registry, Fleet tools → boardVM.dispatchTool
    // Handles both OpenAI tool_call format ({ function: { name, arguments } }) and flat format
    const toolExecutor = {
      definitions: allDefs,
      execute: async function(call) {
        var startTime = Date.now();
        var toolName = (call.function && call.function.name) || call.name;
        // Circuit breaker: if Go runtime is dead, fail immediately with a clear message
        if (_runtimeDead) {
          return { tool_call_id: call.id, name: toolName || 'unknown', output: 'FATAL: Go WASM runtime has crashed. All file operations are unavailable. Call task_complete immediately — no further work is possible.', success: false, durationMs: Date.now() - startTime };
        }
        try {
          var rawArgs = (call.function && call.function.arguments) || call.arguments;
          var args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
          console.log('[tool-exec] →', toolName, JSON.stringify(args).substring(0, 200));

          // Route Yuan built-in tools to the registry executor
          if (yuanToolNames.has(toolName)) {
            var flatCall = { id: call.id, name: toolName, arguments: args || {} };
            var result = await yuanExecutor.execute(flatCall);
            var duration = Date.now() - startTime;
            console.log('[tool-exec] ←', toolName, 'ok:', result.success !== false, 'ms:', duration, 'output:', String(result.output || '').substring(0, 200));
            return result;
          }

          // Route Fleet tools to boardVM.dispatchTool
          if (!boardVM || !boardVM.dispatchTool) {
            return { tool_call_id: call.id, name: toolName, output: 'Error: boardVM.dispatchTool not available', success: false, durationMs: Date.now() - startTime };
          }
          var fleetResult = await boardVM.dispatchTool(toolName, [args]);
          var output = typeof fleetResult === 'string' ? fleetResult : JSON.stringify(fleetResult);
          var duration2 = Date.now() - startTime;
          console.log('[tool-exec] ←', toolName, 'ok: true', 'ms:', duration2, 'output:', String(output).substring(0, 200));
          return { tool_call_id: call.id, name: toolName, output: output, success: true, durationMs: duration2 };
        } catch (err) {
          var name2 = (call.function && call.function.name) || call.name || 'unknown';
          if (isRuntimeDead(err)) {
            _runtimeDead = true;
            return { tool_call_id: call.id, name: name2, output: 'FATAL: Go WASM runtime has crashed. All file operations are unavailable. Call task_complete immediately — no further work is possible.', success: false, durationMs: Date.now() - startTime };
          }
          console.log('[tool-exec] ←', name2, 'ERROR:', err.message);
          return { tool_call_id: call.id, name: name2, output: 'Error: ' + err.message, success: false, durationMs: Date.now() - startTime };
        }
      }
    };

    // Store agent reference globally inside almostnode
    globalThis._yuanAgent = null;
    globalThis._yuanReady = false;

    // Build system prompt dynamically from Fleet tool definitions + Yuan built-in tools
    function buildSystemPrompt(tools) {
      var toolDescs = [];
      for (var i = 0; i < tools.length; i++) {
        var t = tools[i];
        if (t && t.name) {
          var params = '';
          if (t.parameters && t.parameters.properties) {
            params = Object.keys(t.parameters.properties).join(', ');
          }
          toolDescs.push('- ' + t.name + '(' + params + '): ' + (t.description || 'No description'));
        }
      }

      var prompt = 'You are Yuan, an autonomous coding agent embedded in Fleet — a kanban board for orchestrating software engineering tasks.\\n\\n';
      prompt += '**IMPORTANT: Always respond in English only. Never use Korean or any other language.**\\n\\n';

      prompt += '===== WHAT IS FLEET =====\\n';
      prompt += 'Fleet is a kanban-style task board where each card represents a coding task (bug fix, feature, refactor, etc.).\\n';
      prompt += 'Tasks flow through columns: Backlog → Planning → In-Progress → Review → Done.\\n';
      prompt += 'An orchestrator agent picks tasks from the board and delegates them to executors:\\n';
      prompt += '  - Local executor: runs code in a browser sandbox (you have access to similar tools).\\n';
      prompt += '  - Jules (Google): cloud-based autonomous coding agent, pushes branches to GitHub.\\n';
      prompt += '  - GitHub Actions: runs CI/CD workflows, tests, and heavy compute.\\n';
      prompt += 'A knowledge base (KB) stores learned insights, patterns, and project documentation.\\n';
      prompt += '\\n';

      prompt += '===== YOUR ROLE =====\\n';
      prompt += 'You are a chat-based assistant embedded in the Fleet board UI. The user talks to you directly.\\n';
      prompt += 'You can:\\n';
      prompt += '  - Read, write, and edit files in the project repository.\\n';
      prompt += '  - Search the codebase (glob, grep, code search).\\n';
      prompt += '  - Access the Knowledge Base to read or store insights.\\n';
      prompt += '  - Access stored Artifacts (design specs, analysis results).\\n';
      prompt += '  - Browse the GitHub repository (list files, read files, write files via commits).\\n';
      prompt += '  - Delegate to external executors: ask Jules to code, trigger GitHub Actions.\\n';
      prompt += '  - Ask the user questions or send them messages via the board.\\n';
      prompt += '\\n';

      prompt += '===== TOOL CALL FORMAT (CRITICAL) =====\\n';
      prompt += 'each tool_call is:\\n  [tool_call]TOOL_NAME[arg_name]ARG_NAME[/arg_name][arg_value]ARG_VALUE[/arg_value]...[/tool_call]\\nReplace [] with <> when calling tools.\\n';
      prompt += 'Examples:\\n';
      prompt += '  [tool_call]glob[arg_name]pattern[/arg_name][arg_value]*[/arg_value][/tool_call]\\n';
      prompt += '  [tool_call]file_read[arg_name]path[/arg_name][arg_value]src/main.ts[/arg_value][/tool_call]\\n';
      prompt += '  [tool_call]file_edit[arg_name]path[/arg_name][arg_value]src/main.ts[/arg_value][arg_name]old_string[/arg_name][arg_value]foo[/arg_value][arg_name]new_string[/arg_name][arg_value]bar[/arg_value][/tool_call]\\n';
      prompt += '  [tool_call]task_complete[arg_name]summary[/arg_name][arg_value]done[/arg_value][/tool_call]\\n';
      prompt += 'One call per block. Do NOT use any other format.\\n';
      prompt += '=========================================\\n\\n';

      prompt += '===== YOUR TOOLS =====\\n\\n';

      prompt += '1. FILE TOOLS (read/write/search the project in your /workspace VFS):\\n';
      prompt += '   - file_read(path, offset?, limit?) — read file with line numbers, 50KB limit\\n';
      prompt += '   - file_write(path, content, createDirectories?) — write/create file, auto-mkdir\\n';
      prompt += '   - file_edit(path, old_string, new_string, replace_all?) — exact string replacement\\n';
      prompt += '   - glob(pattern, path?, maxResults?) — find files by glob pattern\\n';
      prompt += '   - grep(pattern, path?, glob?, maxResults?, context?) — search file contents\\n';
      prompt += '   - code_search(query, mode?, language?) — symbol search (definitions, references)\\n';
      prompt += '   - security_scan(operation?, path?) — scan for vulnerabilities\\n';
      prompt += '   - web_search(operation, query?, url?) — web search or fetch URL\\n';
      prompt += '   - parallel_web_search(queries) — multiple web searches in parallel\\n';
      prompt += '   - task_complete(summary) — MUST call when you finish your task\\n';
      prompt += '   - spawn_sub_agent(prompt, model?) — spawn a sub-agent for a subtask\\n';
      prompt += '\\n';

      prompt += '2. BOARD INTERACTION TOOLS (talk to the user and delegate work):\\n';
      prompt += '   - askUser(question, format?) — ask the user a question and WAIT for their reply\\n';
      prompt += '   - sendUser(message) — send a message to the user (no reply expected)\\n';
      prompt += '   - askJules(prompt, successCriteria?) — delegate a coding task to Google Jules (cloud agent that pushes branches)\\n';
      prompt += '   - runWorkflow(workflowYaml, workflowName, branch?) — trigger a GitHub Actions workflow\\n';
      prompt += '   - runAndWait(workflowYaml, workflowName, branch?, timeoutMs?) — trigger workflow and wait for result\\n';
      prompt += '   - fetchLogs(runId) — fetch logs from a completed GitHub Actions run\\n';
      prompt += '   - getRunStatus(runId) — check status of a GitHub Actions run\\n';
      prompt += '   - fetchArtifacts(runId) — download artifacts from a GitHub Actions run\\n';
      prompt += '\\n';

      prompt += '3. KNOWLEDGE BASE TOOLS (Fleet\\'s shared memory):\\n';
      prompt += '   - KB.record(text, category, abstraction, layer, tags, source) — store a learned insight\\n';
      prompt += '   - KB.queryLog(category?, tags?, limit?) — search the insight log\\n';
      prompt += '   - KB.queryDocs(type?, tags?, search?, limit?) — search documentation\\n';
      prompt += '   - KB.saveDoc(title, type, content, summary, tags, layer, source) — save a document\\n';
      prompt += '   - KB.updateDoc(id, changes) — update an existing document\\n';
      prompt += '   - KB.deleteDoc(id) — soft-delete a document\\n';
      prompt += '\\n';

      prompt += '4. ARTIFACT TOOLS (named storage for specs, analysis, etc.):\\n';
      prompt += '   - Artifacts.saveArtifact(name, content) — save a named artifact\\n';
      prompt += '   - Artifacts.readArtifact(name) — read an artifact by name\\n';
      prompt += '   - Artifacts.listArtifacts(taskId?) — list stored artifacts\\n';
      prompt += '\\n';

      prompt += '5. REPOSITORY BROWSER TOOLS (read files from the GitHub repo directly):\\n';
      prompt += '   - repo.listFiles(path) — list files in a repo directory\\n';
      prompt += '   - repo.readFile(path) — read a file from the GitHub repo\\n';
      prompt += '   - repo.headFile(path, lines?) — read first N lines of a repo file\\n';
      prompt += '   - repo.writeFile(path, content, commitMessage?) — write file to repo (creates a commit)\\n';
      prompt += '\\n';

      prompt += '6. ANALYSIS TOOLS:\\n';
      prompt += '   - scan(patterns?) — scan the repository for secrets and patterns\\n';
      prompt += '\\n';

      prompt += '===== SCRIPTING COMPLEX TASKS WITH runScript =====\\n';
      prompt += 'For complex tasks that need multiple tool calls with logic between them,\\n';
      prompt += 'use runScript to write JavaScript instead of calling tools one at a time.\\n';
      prompt += 'This lets you express loops, conditionals, and chained operations in code.\\n';
      prompt += '\\n';
      prompt += 'runScript({ code: "..." }) gives you access to ALL Fleet tools as async JS functions.\\n';
      prompt += 'The code runs in a sandbox. Use await for all tool calls. Return a value to pass it back.\\n';
      prompt += '\\n';
      prompt += 'When to use runScript vs individual tool calls:\\n';
      prompt += '  - Use runScript for: loops, conditionals, error handling, chaining 3+ dependent calls, data transformation.\\n';
      prompt += '  - Use individual tool calls for: simple single operations, asking the user a question.\\n';
      prompt += '\\n';
      prompt += 'Example — search codebase then conditionally update files:\\n';
      prompt += '  runScript({ code: "const files = await glob({ pattern: \\"src/**/*.ts\\" }); const results = []; for (const file of files) { const content = await readFile({ path: file }); if (content.includes(\\"oldFunction\\")) { await writeFile({ path: file, content: content.replace(/oldFunction/g, \\"newFunction\\") }); results.push(file); } } return \\"Updated: \\" + results.join(\\", \\");" })\\n';
      prompt += '\\n';
      prompt += 'Example — query KB, then ask user if uncertain:\\n';
      prompt += '  runScript({ code: "const log = await KB_queryLog({ category: \\"error\\", tags: [\\"auth\\"], limit: 5 }); if (log.length === 0) { return await askUser({ prompt: \\"No auth errors found. Check repo?\\" }); } return JSON.stringify(log);" })\\n';
      prompt += '\\n';

      prompt += '===== DYNAMICALLY REGISTERED TOOLS =====\\n';
      if (toolDescs.length > 0) {
        prompt += 'Additional tools available from active board modules:\\n';
        prompt += toolDescs.join('\\n') + '\\n';
      } else {
        prompt += '(no additional tools registered)\\n';
      }
      prompt += '\\n';

      prompt += '===== IMPORTANT RULES =====\\n';
      prompt += '- Only use tools listed above. Do NOT invent tools.\\n';
      prompt += '- shell_exec, bash, git_ops, test_run are NOT available — do NOT attempt to use them.\\n';
      prompt += '- For file operations in your workspace, use file_read/file_write/file_edit.\\n';
      prompt += '- For reading the actual GitHub repo, use repo.readFile/repo.listFiles.\\n';
      prompt += '- Always call task_complete({"summary": "..."}) when you finish your task.\\n';
      prompt += '- Think step by step. Use tools to gather information before making changes.\\n';
      prompt += '- If a tool call fails, read the error and try a different approach.\\n';
      prompt += '- Use KB tools to store important findings — other board agents can read them.\\n';
      prompt += '- Use askUser when you need clarification from the user before proceeding.';
      return prompt;
    }

    globalThis._yuanCreateAgent = function(apiKey, provider, model) {
      var systemPrompt = buildSystemPrompt(fleetDefs);
      console.log('[yuan-runner] system prompt length:', systemPrompt.length, 'tools:', allDefs.length);
      var config = {
        byok: { provider: provider || 'openai', apiKey: apiKey || 'shim', model: model },
        loop: {
          model: 'standard',
          maxIterations: 25,
          maxTokensPerIteration: 4096,
          totalTokenBudget: 100000,
          tools: allDefs,
          systemPrompt: systemPrompt,
          projectPath: '/workspace',
          indexing: false,
        },
      };

      var agent = new AgentLoop({
        config: config,
        toolExecutor: toolExecutor,
        governorConfig: { planTier: 'standard', maxIterations: 25, maxTokenBudget: 100000 },
      });

      // Patch contextManager.replaceSystemMessage so our JS format block is always prepended
      // (criticalInit() calls replaceSystemMessage with buildPrompt output, discarding our instructions)
      var _jsFormatBlock = '===== TOOL CALL FORMAT (CRITICAL) =====\\n'
        + 'each tool_call is:\\n  [tool_call]TOOL_NAME[arg_name]ARG_NAME[/arg_name][arg_value]ARG_VALUE[/arg_value]...[/tool_call]\\nReplace [] with <> when calling tools.\\n'
        + 'Examples:\\n'
        + '  [tool_call]glob[arg_name]pattern[/arg_name][arg_value]*[/arg_value][/tool_call]\\n'
        + '  [tool_call]file_read[arg_name]path[/arg_name][arg_value]src/main.ts[/arg_value][/tool_call]\\n'
        + '  [tool_call]file_edit[arg_name]path[/arg_name][arg_value]src/main.ts[/arg_value][arg_name]old_string[/arg_name][arg_value]foo[/arg_value][arg_name]new_string[/arg_name][arg_value]bar[/arg_value][/tool_call]\\n'
        + '  [tool_call]task_complete[arg_name]summary[/arg_name][arg_value]done[/arg_value][/tool_call]\\n'
        + 'One call per block. Do NOT use any other format.\\n'
        + '=========================================\\n\\n';
      var _origReplace = agent.contextManager.replaceSystemMessage.bind(agent.contextManager);
      agent.contextManager.replaceSystemMessage = function(content) {
        _origReplace(_jsFormatBlock + content);
      };

      agent.on('agent:thinking', function(ev) { console.log('[yuan] thinking:', ev.content); try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:thinking', content: ev.content }); } catch(_e) {} });
      agent.on('agent:tool_call', function(ev) { console.log('[yuan] tool_call:', ev.tool, JSON.stringify(ev.args || {}).substring(0, 200)); try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:tool_call', tool: ev.tool, args: ev.args }); } catch(_e) {} });
      agent.on('agent:tool_result', function(ev) { console.log('[yuan] tool_result:', ev.tool, 'success:', ev.success, 'output:', String(ev.output || '').substring(0, 200)); try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:tool_result', tool: ev.tool, success: ev.success, output: String(ev.output || '').substring(0, 200) }); } catch(_e) {} });
      agent.on('agent:completed', function(ev) { console.log('[yuan] completed:', ev.summary); try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:completed', summary: ev.summary }); } catch(_e) {} });
      agent.on('agent:error', function(ev) { console.error('[yuan] error:', ev.message); try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:error', message: ev.message }); } catch(_e) {} });

      globalThis._yuanAgent = agent;
      globalThis._yuanReady = true;
      return agent;
    };

    globalThis._yuanRun = async function(message) {
      if (!globalThis._yuanAgent) throw new Error('Agent not initialized');
      try {
        var result = await globalThis._yuanAgent.run(message);
        return (result && (result.summary || result.reason)) || 'completed';
      } catch(err) {
        return 'error: ' + (err.message || String(err));
      }
    };

    // Capture last LLM response text for fallback when agent errors
    globalThis._lastLLMText = '';
    var _origSendRequest = globalThis.boardVM.llmfs.sendRequest;
    globalThis.boardVM.llmfs.sendRequest = async function(reqJSON) {
      console.log('[yuan-runner] llmfs.sendRequest →');
      var resp = await _origSendRequest.call(globalThis.boardVM.llmfs, reqJSON);
      try {
        var parsed = JSON.parse(resp);
        var tc = (parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.tool_calls) || [];
        console.log('[yuan-runner] llmfs ← content_len:', (parsed.choices?.[0]?.message?.content || '').length, 'tool_calls:', tc.length);
      } catch(e) {}
      try {
        var parsed2 = JSON.parse(resp);
        if (parsed2.choices && parsed2.choices[0] && parsed2.choices[0].message) {
          globalThis._lastLLMText = parsed2.choices[0].message.content || '';
        }
      } catch(e) {}
      return resp;
    };

    // Callback-based runner for sync execute() bridge
    globalThis._yuanRunWithCallback = function(message, resolve, reject) {
      if (!globalThis._yuanAgent) { reject(new Error('Agent not initialized')); return; }
      // Clear context history so each message starts fresh (no accumulation)
      try {
        globalThis._yuanAgent.contextManager.clear();
        // Re-add system prompt (clear() removes it, and run() doesn't re-add it)
        globalThis._yuanAgent.contextManager.addMessage({
          role: 'system',
          content: globalThis._yuanAgent.config.loop.systemPrompt
        });
      } catch(e) { console.warn('[yuan-runner] contextManager.clear failed:', e); }
      console.log('═══════ [yuan-runner] INCOMING MESSAGE ═══════');
      console.log(message);
      console.log('═══════ [yuan-runner] END INCOMING ═══════');
      globalThis._yuanAgent.run(message).then(function(result) {
        console.log('═══════ [yuan-runner] RUN RESULT ═══════');
        console.log('reason:', result && result.reason);
        console.log('summary:', result && result.summary);
        console.log('filesChanged:', JSON.stringify(result && result.filesChanged));
        console.log('_lastLLMText:', globalThis._lastLLMText);
        console.log('═══════ [yuan-runner] END RESULT ═══════');
        // Prefer the actual LLM content over generic summaries like "Task completed"
        var text = globalThis._lastLLMText || (result && result.summary) || '';
        resolve(text || 'completed');
      }).catch(function(err) {
        console.error('═══════ [yuan-runner] RUN ERROR ═══════');
        console.error('message:', err.message);
        console.error('stack:', err.stack);
        console.error('_lastLLMText:', globalThis._lastLLMText);
        console.error('═══════ [yuan-runner] END ERROR ═══════');
        if (globalThis._lastLLMText) {
          resolve(globalThis._lastLLMText);
        } else {
          resolve('error: ' + (err.message || String(err)));
        }
      });
    };

    console.log('[yuan-runner] agent runner loaded');
  `;

  c.vfs.mkdirSync('/workspace', { recursive: true });
  c.vfs.writeFileSync('/yuan-runner.js', runnerCode);
}

// --- Public API ---

/**
 * Initialize the YUAN agent in almostnode.
 * Creates container, installs packages, injects shims, loads agent runner.
 */
export async function initYuanAgent(): Promise<void> {
  if (agentReady) {
    console.log('[yuan-bootstrap] agent already initialized');
    return;
  }

  const bvm = getBoardVM();
  if (!bvm) throw new Error('[yuan-bootstrap] boardVM not found on globalThis — set up TerminalPanel first');

  if (bvm.yuan) bvm.yuan._status = 'not initialized';

  console.log('[yuan-bootstrap] creating almostnode container...');
  container = await createAlmostnodeContainer();

  console.log('[yuan-bootstrap] installing packages...');
  await installPackages(container);

  console.log('[yuan-bootstrap] injecting shims...');
  injectShims(container);

  console.log('[yuan-bootstrap] creating agent runner...');
  createAgentRunner(container);

  // Build tool definitions dynamically from boardVM.toolfs.listTools()
  // (which reads sandboxBindings from all enabled module manifests).
  // This must happen before the runner is executed since container.execute() is sync.
  const bvm2 = getBoardVM();
  let toolDefs: any[] = [];
  if (bvm2?.toolfs?.listTools) {
    try {
      const toolsJSON = await bvm2.toolfs.listTools();
      const toolList = JSON.parse(toolsJSON);
      toolDefs = toolList.map((t: any) => ({
        // Flat format — Yuan's toOpenAITool() wraps this into { type: "function", function: { ... } }
        name: t.name,
        description: t.description || `Fleet tool: ${t.name}`,
        parameters: t.parameters || { type: 'object', properties: {}, required: [] },
      }));
      console.log(`[yuan-bootstrap] discovered ${toolDefs.length} tools from registry`);
    } catch (e: any) {
      console.error('[yuan-bootstrap] tool discovery failed:', e);
    }
  }

  // Inject tool definitions into globalThis for the sync runner to pick up
  (globalThis as any)._fleetToolDefs = toolDefs;

  console.log('[yuan-bootstrap] executing agent runner...');
  container.execute('require("/yuan-runner.js")');

  // Create the agent instance (uses the openai shim → boardVM.llmfs)
  container.execute('globalThis._yuanCreateAgent("shim", "openai", "default")');

  agentReady = true;
  if (bvm.yuan) bvm.yuan._status = 'idle';
  console.log('[yuan-bootstrap] YUAN agent ready');
}

/**
 * Send a message to the YUAN agent and get a response.
 * Uses a callback bridge because container.execute() is synchronous
 * but the agent's run() is async (calls LLM via boardVM.llmfs).
 */
export async function sendToYuanAgent(message: string): Promise<string> {
  if (!container || !agentReady) {
    throw new Error('YUAN agent not initialized — call initYuanAgent() first');
  }

  const bvm = getBoardVM();
  if (bvm?.yuan) bvm.yuan._status = 'running';
  try {
    // Use callback bridge: pass resolve/reject into almostnode's sync execute
    // so the async agent.run() can call back when done
    const result = await new Promise<string>((resolve, reject) => {
      // Expose the resolve/reject on globalThis so the runner can call them
      (globalThis as any).__yuanResolve = resolve;
      (globalThis as any).__yuanReject = reject;

      const escapedMsg = JSON.stringify(message);
      container!.execute(
        `globalThis._yuanRunWithCallback(${escapedMsg}, globalThis.__yuanResolve, globalThis.__yuanReject)`
      );
    });

    if (bvm?.yuan) bvm.yuan._status = 'idle';
    return result;
  } catch (err: any) {
    if (bvm?.yuan) bvm.yuan._status = 'error';
    throw err;
  }
}

/**
 * Get current YUAN agent status.
 */
export function getYuanStatus(): string {
  if (!container) return 'not initialized';
  if (!agentReady) return 'not initialized';
  const bvm = getBoardVM();
  return bvm?.yuan?._status || bvm?.yuan?.status?.() || 'unknown';
}

/**
 * Register the YUAN send handler on the inline boardVM.yuan object.
 * Called from TerminalPanel after boardVM is set up.
 */
export function registerYuanWithBoardVM(): void {
  const bvm = getBoardVM();
  if (!bvm || !bvm.yuan) {
    console.warn('[yuan-bootstrap] boardVM.yuan not found — cannot register');
    return;
  }
  bvm.yuan.send = sendToYuanAgent;
  console.log('[yuan-bootstrap] registered yuan.send with boardVM');
}
