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
  console.log('[yuan-bootstrap] installing @yuaone/core...');
  await c.npm.install('@yuaone/core');

  // @yuaone/tools has native deps (node-pty, playwright) — skip for browser
  // The agent will use Fleet tools via the @fleet/tools shim instead
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
    const fleetTools = require('@fleet/tools');

    // Build tool definitions from Fleet tools
    const toolDefs = Object.keys(fleetTools).map(function(name) {
      return {
        name: name,
        description: 'Fleet tool: ' + name,
        parameters: { type: 'object', properties: {}, additionalProperties: true },
      };
    });

    // Tool executor that routes to Fleet via boardVM
    const toolExecutor = {
      definitions: toolDefs,
      execute: async function(call) {
        var startTime = Date.now();
        try {
          var args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
          var toolFn = fleetTools[call.name];
          if (!toolFn) {
            return { tool_call_id: call.id, name: call.name, output: 'Unknown tool: ' + call.name, success: false, durationMs: Date.now() - startTime };
          }
          var result = await toolFn(args);
          var output = typeof result === 'string' ? result : JSON.stringify(result);
          return { tool_call_id: call.id, name: call.name, output: output, success: true, durationMs: Date.now() - startTime };
        } catch (err) {
          return { tool_call_id: call.id, name: call.name, output: 'Error: ' + err.message, success: false, durationMs: Date.now() - startTime };
        }
      }
    };

    // Store agent reference globally inside almostnode
    globalThis._yuanAgent = null;
    globalThis._yuanReady = false;

    globalThis._yuanCreateAgent = function(apiKey, provider, model) {
      var config = {
        byok: { provider: provider || 'openai', apiKey: apiKey || 'shim', model: model },
        loop: {
          model: 'standard',
          maxIterations: 25,
          maxTokensPerIteration: 4096,
          totalTokenBudget: 100000,
          tools: toolDefs,
          systemPrompt: 'You are an autonomous coding agent running inside Fleet. Use the available tools to help the user.',
          projectPath: '/workspace',
          indexing: false,
        },
      };

      var agent = new AgentLoop({
        config: config,
        toolExecutor: toolExecutor,
        governorConfig: { planTier: 'standard', maxIterations: 25, maxTokenBudget: 100000 },
      });

      agent.on('agent:thinking', function(ev) { console.log('[yuan] thinking:', ev.content); });
      agent.on('agent:tool_call', function(ev) { console.log('[yuan] tool_call:', ev.tool); });
      agent.on('agent:error', function(ev) { console.error('[yuan] error:', ev.message); });

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
      var resp = await _origSendRequest.call(globalThis.boardVM.llmfs, reqJSON);
      try {
        var parsed = JSON.parse(resp);
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
          globalThis._lastLLMText = parsed.choices[0].message.content || '';
        }
      } catch(e) {}
      return resp;
    };

    // Callback-based runner for sync execute() bridge
    globalThis._yuanRunWithCallback = function(message, resolve, reject) {
      if (!globalThis._yuanAgent) { reject(new Error('Agent not initialized')); return; }
      console.log('[yuan-runner] starting run for:', message);
      globalThis._yuanAgent.run(message).then(function(result) {
        console.log('[yuan-runner] run completed, result:', JSON.stringify(result).substring(0, 500));
        // Prefer the actual LLM content over generic summaries like "Task completed"
        var text = globalThis._lastLLMText || (result && result.summary) || '';
        resolve(text || 'completed');
      }).catch(function(err) {
        console.error('[yuan-runner] run error:', err.message, err.stack);
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
