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
    cwd: '/home',
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

  // Instead of hitting npm registry, load pre-built bundles from public assets.
  // The bundles are created by `npm run bundle:yuaone` which packs the dist/ files
  // into self-contained JSON blobs that we write into VFS.
  const bundleBase = '/assets/wasm/yuaone-bundles';

  for (const [pkg, main] of [
    ['@yuaone/core', 'dist/agent-loop.js, dist/llm-client.js, dist/types.js, dist/constants.js, dist/errors.js, dist/debug-logger.js, dist/index.js, dist/context-manager.js, dist/token-budget.js, dist/prompt-defense.js, dist/budget-governor.js, dist/cost-optimizer.js, dist/skill-loader.js, dist/vision-intent.js, dist/reasoning-aggregator.js, dist/reasoning-tree.js'],
    ['@yuaone/tools', 'dist/index.js, dist/registry.js, dist/base-tool.js, dist/file-read.js, dist/file-write.js, dist/file-edit.js, dist/glob-tool.js, dist/grep-tool.js, dist/code-search.js, dist/web-search.js, dist/task-complete.js'],
  ]) {
    try {
      const resp = await fetch(`${bundleBase}/${pkg.replace('/', '_')}.json`);
      if (resp.ok) {
        const files: Record<string, string> = await resp.json();
        const dir = `/node_modules/${pkg}`;
        c.vfs.mkdirSync(dir, { recursive: true });
        c.vfs.mkdirSync(`${dir}/dist`, { recursive: true });
        for (const [path, content] of Object.entries(files)) {
          const fullPath = `${dir}/${path}`;
          c.vfs.writeFileSync(fullPath, content);
        }
        // Write package.json
        c.vfs.writeFileSync(`${dir}/package.json`, JSON.stringify({
          name: pkg, version: '0.0.0-local', main: 'dist/index.js',
        }));
        console.log(`[yuan-bootstrap] ${pkg}: ${Object.keys(files).length} files from bundle`);
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

  // FS bridge shim: fs/promises and fs → boardVM.fsBridge (v86 filesystem)
  // almostnode strips "node:" prefix before resolving, so we write under /node_modules/fs/ not /node_modules/node:fs/
  c.vfs.mkdirSync('/node_modules/fs', { recursive: true });
  c.vfs.mkdirSync('/node_modules/fs/promises', { recursive: true });
  c.vfs.writeFileSync('/node_modules/fs/promises.js', fsBridgeShimSource);
  c.vfs.writeFileSync('/node_modules/fs/promises/package.json', JSON.stringify({
    name: 'fs/promises',
    version: '0.0.0-shim',
    main: 'index.js',
  }));
  c.vfs.writeFileSync('/node_modules/fs/promises/index.js', fsBridgeShimSource);
  // fs (base module) uses the same bridge
  c.vfs.writeFileSync('/node_modules/fs/index.js', fsBridgeShimSource);
  c.vfs.writeFileSync('/node_modules/fs/package.json', JSON.stringify({
    name: 'fs',
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

    // Patch almostnode built-in fsShim.promises with missing open function.
    // almostnode createFsShim has readFile/writeFile/stat etc but NOT open.
    // @yuaone/tools imports { open as fsOpen } from node:fs/promises which
    // resolves to fsShim.promises - without this patch, fsOpen is undefined.
    var _fsp = require('fs/promises');
    if (!_fsp.open) {
      _fsp.open = async function open(path, flags, mode) {
        var b = globalThis.boardVM && globalThis.boardVM.fsBridge;
        if (!b) throw new Error('boardVM.fsBridge not available for open()');
        var content = await b.readFile(path);
        if (content instanceof Error) throw content;
        return {
          _path: path,
          readFile: async function() {
            var r = await b.readFile(path);
            if (r instanceof Error) throw r;
            return { toString: function() { return r; }, length: r.length };
          },
          writeFile: async function(data) {
            var c = typeof data === 'string' ? data : String(data);
            var r = await b.writeFile(path, c);
            if (r instanceof Error) throw r;
          },
          close: function() {},
          stat: async function() {
            var info = await b.stat(path);
            if (!info.exists) throw new Error('ENOENT');
            return {
              isFile: function() { return !info.isDir; },
              isDirectory: function() { return info.isDir; },
              size: info.size,
            };
          },
        };
      };
      console.log('[yuan-runner] patched fsShim.promises.open');
    }

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
    var yuanExecutor = yuanRegistry.toExecutor('/home');
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

      var prompt = 'You are Yuan, an autonomous coding agent inside Fleet.\\n';
      prompt += '**IMPORTANT: Always respond in English only.**\\n\\n';
      prompt += 'Use the provided tools via native function calling. Do not output tool calls as text.\\n\\n';
      prompt += 'TOOL CATEGORIES:\\n\\n';

      prompt += '1. FLEET REPO TOOLS (access GitHub repositories directly via GitHub API):\\n';
      if (toolDescs.length > 0) {
        prompt += toolDescs.join('\\n') + '\\n';
      } else {
        prompt += '   (none registered)\\n';
      }
      prompt += '   These are your PRIMARY way to read and write repository files. They go directly to GitHub.\\n';
      prompt += '   Use repo.listFiles, repo.readFile, repo.headFile to browse and read repo files.\\n';
      prompt += '   Use repo.writeFile to commit changes back to the repo.\\n';
      prompt += '\\n';

      prompt += '2. LOCAL FILE TOOLS (v86 workspace filesystem — NOT the GitHub repo):\\n';
      prompt += '   - file_read, file_write, file_edit — read/write/edit local workspace files\\n';
      prompt += '   - glob, grep — search local filesystem\\n';
      prompt += '   - security_scan — scan local files for vulnerabilities\\n';
      prompt += '   Only use these for local workspace files, NOT for accessing the GitHub repository.\\n';
      prompt += '\\n';

      prompt += '3. SEARCH TOOLS:\\n';
      prompt += '   - web_search — search the web or fetch URLs\\n';
      prompt += '   - code_search — symbol-based code search\\n';
      prompt += '\\n';

      prompt += '4. BASH TOOLS (run shell commands inside the v86 VM):\\n';
      prompt += '   - bash.exec(command, cwd, timeout) — execute a shell command\\n';
      prompt += '   - bash.clone() — copy repo mirror to an isolated per-task working directory\\n';
      prompt += '   Filesystem layout:\\n';
      prompt += '   - /tmp/repo-root — main repo mirror (read-only, do not modify)\\n';
      prompt += '   - bash.clone() creates an isolated per-task working copy (modify freely)\\n';
      prompt += '   - /home — default cwd if no task repo exists\\n';
      prompt += '   bash.exec auto-detects cwd: uses your task repo if cloned, otherwise /home.\\n';
      prompt += '\\n';

      // DEV-ONLY: Claude Code host executor — disabled in production
      // TODO: gate behind env flag or config (process.env.ENABLE_HOST_AGENT)
      prompt += '5. HOST AGENT (DEV ONLY — may not be available):\\n';
      prompt += '   - claude.run(prompt, model?, timeout?) — delegate a subtask to a local Claude Code agent on the host machine.\\n';
      prompt += '   ASYNC: returns immediately with { taskId, status: "pending" }. Result arrives automatically within 20 seconds of completion.\\n';
      prompt += '   Do NOT wait or poll — continue working. Results appear as system messages in your context.\\n';
      prompt += '   Use for: heavy compute, real tools (gh, docker, kubectl), or when v86 is too slow.\\n';
      prompt += '\\n';

      prompt += 'CRITICAL DISTINCTION:\\n';
      prompt += '- repo.* tools access the GitHub repository via API — use them when you need to commit changes (repo.writeFile).\\n';
      prompt += '- bash.exec is your main tool for exploring and working with files. Use it freely: ls, cat, grep, find, git, build, test, etc.\\n';
      prompt += '- When a task starts and needs a repo, bash.clone() copies /tmp/repo-root into an isolated per-task directory — your working copy. bash.exec auto-detects it as cwd.\\n';
      prompt += '- Local file tools (file_read, file_write, file_edit) access the v86 workspace filesystem too.\\n\\n';

      prompt += 'WORKFLOW:\\n';
      prompt += '1. Use Fleet repo tools to explore and understand the GitHub repository\\n';
      prompt += '2. For multi-step file changes (3+ steps), call bash.clone() first to get an isolated working copy\\n';
      prompt += '3. Use Fleet repo tools (repo.writeFile) or local file tools to make changes\\n';
      prompt += '4. Use bash.exec to run build/test/lint commands\\n';
      prompt += '5. Use task_complete({"summary": "..."}) when done\\n\\n';

      prompt += '===== SCRIPTING COMPLEX TASKS WITH yuan.runScript =====\\n';
      prompt += 'For complex tasks that need multiple tool calls with logic between them,\\n';
      prompt += 'use yuan.runScript to write JavaScript instead of calling tools one at a time.\\n';
      prompt += 'This lets you express loops, conditionals, and chained operations in code.\\n';
      prompt += '\\n';
      prompt += 'yuan.runScript({ code: "..." }) gives you access to ALL Fleet tools as async JS functions.\\n';
      prompt += 'The code runs in a sandbox. Use await for all tool calls. Return a value to pass it back.\\n';
      prompt += '\\n';
      prompt += 'When to use yuan.runScript vs individual tool calls:\\n';
      prompt += '  - Use yuan.runScript for: loops, conditionals, error handling, chaining 3+ dependent calls, data transformation.\\n';
      prompt += '  - Use individual tool calls for: simple single operations, asking the user a question.\\n';
      prompt += '\\n';

      prompt += 'RULES:\\n';
      prompt += '- Only use tools listed above. Do NOT invent tools.\\n';
      prompt += '- shell_exec, git_ops, test_run are NOT available.\\n';
      prompt += '- bash.exec IS available — use it for build, test, lint, and git operations inside the v86 VM.\\n';
      prompt += '- Think step by step. Gather information before making changes.\\n';
      prompt += '- If a tool call fails, read the error and try a different approach.';
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
          projectPath: '/home',
          indexing: false,
        },
      };

      var agent = new AgentLoop({
        config: config,
        toolExecutor: toolExecutor,
        governorConfig: { planTier: 'standard', maxIterations: 25, maxTokenBudget: 100000 },
      });

      // Native function calling — no text-format injection needed

      // AgentLoop events — log + forward to boardVM eventBus
      agent.on('event', function(ev) {
        if (!ev || !ev.kind) return;
        switch (ev.kind) {
          case 'agent:thinking':
            console.log('[yuan] thinking:', ev.content);
            try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:thinking', content: ev.content }); } catch(_e) { console.warn('[yuan] emit thinking failed:', _e); }
            break;
          case 'agent:tool_call':
            console.log('[yuan] tool_call:', ev.tool, JSON.stringify(ev.args || {}).substring(0, 200));
            try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:tool_call', tool: ev.tool, args: ev.args }); } catch(_e) { console.warn('[yuan] emit tool_call failed:', _e); }
            break;
          case 'agent:tool_result':
            console.log('[yuan] tool_result:', ev.tool, 'success:', ev.success, 'output:', String(ev.output || '').substring(0, 200));
            try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:tool_result', tool: ev.tool, success: ev.success, output: String(ev.output || '').substring(0, 200) }); } catch(_e) { console.warn('[yuan] emit tool_result failed:', _e); }
            break;
          case 'agent:completed':
            console.log('[yuan] completed:', ev.summary);
            try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:completed', summary: ev.summary }); } catch(_e) { console.warn('[yuan] emit completed failed:', _e); }
            break;
          case 'agent:error':
            console.error('[yuan] error:', ev.message);
            try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:error', message: ev.message }); } catch(_e) { console.warn('[yuan] emit error failed:', _e); }
            break;
          case 'agent:start':
            console.log('[yuan] start:', ev.goal);
            try { globalThis.boardVM.emit('yuan:event', { kind: 'agent:start', goal: ev.goal }); } catch(_e) { console.warn('[yuan] emit start failed:', _e); }
            break;
        }
      });

      globalThis._yuanAgent = agent;
      globalThis._yuanReady = true;
      return agent;
    };

    globalThis._yuanRun = async function(message) {
      if (!globalThis._yuanAgent) throw new Error('Agent not initialized');
      try {
        var result = await globalThis._yuanAgent.run(enrichedMessage);
        return (result && (result.summary || result.reason)) || 'completed';
      } catch(err) {
        return 'error: ' + (err.message || String(err));
      }
    };

    // Capture last LLM response text for fallback when agent errors
    globalThis._lastLLMText = '';

    // --- Async task injection: inject completed async results into LLM context ---
    globalThis._yuanWakeUp = function() {
      var finished = globalThis._asyncTasks ? globalThis._asyncTasks.getFinished() : [];
      if (finished.length === 0) return;
      // Build a wake-up message summarizing all finished tasks
      var lines = finished.map(function(t) {
        var r = t.result || {};
        var status = t.status === 'error' ? 'ERROR' : 'DONE';
        var output = r.stdout || r.error || '(no output)';
        // Try to extract result from claude JSON output
        try { var parsed = JSON.parse(output); if (parsed.result) output = parsed.result; } catch(e) {}
        return '[' + status + '] ' + t.prompt.slice(0, 60) + '... → ' + output.slice(0, 200);
      });
      var msg = '[async-results] The following tasks finished:\\n' + lines.join('\\n') + '\\n\\nReview the results and continue if needed.';
      console.log('[yuan-runner] Waking up with async results:', lines.length, 'tasks');
      globalThis._asyncTasks.clearFinished();
      // Trigger a new agent run with the results
      globalThis._yuanRunWithCallback(msg);
    };

    var _origSendRequest = globalThis.boardVM.llmfs.sendRequest;
    globalThis.boardVM.llmfs.sendRequest = async function(reqJSON) {
      // Before each LLM call, inject any finished async task results
      var finished = globalThis._asyncTasks ? globalThis._asyncTasks.getFinished() : [];
      if (finished.length > 0) {
        globalThis._asyncTasks.cancelWakeUp();
        var asyncContext = finished.map(function(t) {
          var r = t.result || {};
          var status = t.status === 'error' ? 'ERROR' : 'DONE';
          var output = r.stdout || r.error || '(no output)';
          try { var parsed = JSON.parse(output); if (parsed.result) output = parsed.result; } catch(e) {}
          return '[' + status + '] ' + t.prompt.slice(0, 60) + '... → ' + output.slice(0, 200);
        }).join('\\n');
        try {
          if (reqJSON && reqJSON.messages) {
            reqJSON.messages.push({ role: 'system', content: '[async-results] Tasks finished:\\n' + asyncContext });
          }
        } catch(e) { console.warn('[yuan-runner] Failed to inject async results:', e); }
        globalThis._asyncTasks.clearFinished();
        console.log('[yuan-runner] Injected', finished.length, 'async results into LLM context');
      }
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

    // Callback-based runner: result goes through boardVM.yuan._onResult.
    // almostnode Runtime shares the browser's globalThis, so boardVM.yuan._onResult is reachable.
    globalThis._yuanRunWithCallback = function(message) {
      if (!globalThis._yuanAgent) {
        var cb = globalThis.boardVM && globalThis.boardVM.yuan;
        if (cb && cb._onError) cb._onError(new Error('Agent not initialized'));
        return;
      }
      // Clear context history so each message starts fresh (no accumulation)
      try {
        globalThis._yuanAgent.contextManager.clear();
        // Re-add system prompt (clear() removes it; run() will replaceSystemMessage via criticalInit)
        globalThis._yuanAgent.contextManager.addMessage({
          role: 'system',
          content: globalThis._yuanAgent.config.loop.systemPrompt
        });
      } catch(e) { console.warn('[yuan-runner] contextManager.clear failed:', e); }
      // Prepend English-only instruction to user message so it survives criticalInit's system prompt replacement
      var englishPrefix = '[System: You MUST respond in English only.]\\n\\n';
      var enrichedMessage = englishPrefix + message;

      console.log('═══════ [yuan-runner] INCOMING MESSAGE ═══════');
      console.log(message);
      console.log('═══════ [yuan-runner] END INCOMING ═══════');

      // Run with a 5-minute timeout so the UI never hangs forever
      var _runTimeout = setTimeout(function() {
        console.error('[yuan-runner] TIMEOUT — aborting agent after 300s');
        try { globalThis._yuanAgent.abort(); } catch(e) {}
        var cbt = globalThis.boardVM && globalThis.boardVM.yuan;
        var fallbackText = globalThis._lastLLMText ? '\x1b[33m[timeout-fallback]\x1b[0m ' + globalThis._lastLLMText : 'Agent timed out after 300 seconds.';
        if (cbt && cbt._onResult) cbt._onResult(fallbackText);
      }, 300000);

      Promise.race([
        globalThis._yuanAgent.run(message),
        new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 305000); })
      ]).then(function(result) {
        console.log('═══════ [yuan-runner] RUN RESULT ═══════');
        clearTimeout(_runTimeout);
        console.log('═══════ [yuan-runner] RUN RESULT ═══════');
        console.log('reason:', result && result.reason);
        console.log('summary:', result && result.summary);
        console.log('filesChanged:', JSON.stringify(result?.filesChanged || []));
        console.log('_lastLLMText:', globalThis._lastLLMText);
        console.log('═══════ [yuan-runner] END RESULT ═══════');
        // Prefer the actual LLM content over generic summaries like "Task completed"
        var text = globalThis._lastLLMText || (result && result.summary) || '';
        var cb = globalThis.boardVM && globalThis.boardVM.yuan;
        if (cb && cb._onResult) cb._onResult(text || 'completed');
      }).catch(function(err) {
        clearTimeout(_runTimeout);
        console.error('═══════ [yuan-runner] RUN ERROR ═══════');
        console.error('message:', err.message);
        console.error('stack:', err.stack);
        console.error('_lastLLMText:', globalThis._lastLLMText);
        console.error('═══════ [yuan-runner] END ERROR ═══════');
        var cb2 = globalThis.boardVM && globalThis.boardVM.yuan;
        if (globalThis._lastLLMText) {
          if (cb2 && cb2._onResult) cb2._onResult('\x1b[33m[error-fallback]\x1b[0m ' + globalThis._lastLLMText);
        } else {
          if (cb2 && cb2._onError) cb2._onError(err);
        }
      });
    };

    console.log('[yuan-runner] agent runner loaded');
  `;

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
    // Use boardVM.yuan callback bridge — the worker can't access browser's globalThis,
    // but it CAN access boardVM (which is injected into the worker by almostnode).
    const result = await new Promise<string>((resolve, reject) => {
      const bvm = getBoardVM();
      if (!bvm?.yuan) { reject(new Error('boardVM.yuan not available')); return; }

      bvm.yuan._onResult = (text: string) => { resolve(text); };
      bvm.yuan._onError = (err: any) => { reject(err); };

      const escapedMsg = JSON.stringify(message);
      container!.execute(
        `globalThis._yuanRunWithCallback(${escapedMsg})`
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
