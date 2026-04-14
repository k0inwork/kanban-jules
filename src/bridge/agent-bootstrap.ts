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

import { setYuanHandlers, setYuanStatus } from './boardVM';

// Shim source files (imported as raw text for VFS injection)
import openaiShimSource from './openai-shim.js?raw';
import fleetToolsShimSource from './fleet-tools-shim.js?raw';

// --- Types for almostnode container ---

interface AlmostNodeContainer {
  vfs: {
    writeFileSync(path: string, content: string): void;
    readFileSync(path: string, encoding?: string): string;
    mkdirSync(path: string, options?: { recursive?: boolean }): void;
    existsSync(path: string): boolean;
  };
  execute(code: string): Promise<any>;
  npm: {
    install(packageName: string): Promise<void>;
  };
}

// --- Container state ---

let container: AlmostNodeContainer | null = null;
let agentReady = false;

// --- Create the almostnode container ---

async function createContainer(): Promise<AlmostNodeContainer> {
  // almostnode is loaded globally by the app (from wasm/worker or script tag)
  const almostnode = (globalThis as any).almostnode;
  if (!almostnode) {
    throw new Error('almostnode runtime not available on globalThis');
  }

  const c = await almostnode.createContainer({
    // Minimal config — VFS + npm support
    enableNetwork: false,    // all network goes through boardVM shims
    enableFileSystem: true,
  });

  return c as AlmostNodeContainer;
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

  console.log('[yuan-bootstrap] shims injected');
}

// --- Create the agent runner script ---

function createAgentRunner(c: AlmostNodeContainer): void {
  // This script runs inside almostnode and sets up the YUAN AgentLoop.
  // It's executed once via container.execute() during init.
  const runnerCode = `
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
      var result = await globalThis._yuanAgent.run(message);
      return result.summary || result.reason || 'completed';
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

  setYuanStatus('not initialized');

  console.log('[yuan-bootstrap] creating almostnode container...');
  container = await createContainer();

  console.log('[yuan-bootstrap] installing packages...');
  await installPackages(container);

  console.log('[yuan-bootstrap] injecting shims...');
  injectShims(container);

  console.log('[yuan-bootstrap] creating agent runner...');
  createAgentRunner(container);

  console.log('[yuan-bootstrap] executing agent runner...');
  await container.execute('require("/yuan-runner.js")');

  // Create the agent instance (uses the openai shim → boardVM.llmfs)
  await container.execute('globalThis._yuanCreateAgent("shim", "openai", "default")');

  agentReady = true;
  setYuanStatus('idle');
  console.log('[yuan-bootstrap] YUAN agent ready');
}

/**
 * Send a message to the YUAN agent and get a response.
 */
export async function sendToYuanAgent(message: string): Promise<string> {
  if (!container || !agentReady) {
    throw new Error('YUAN agent not initialized — call initYuanAgent() first');
  }

  setYuanStatus('running');
  try {
    // Escape the message for JS string embedding
    const escapedMsg = message.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const result = await container.execute(`globalThis._yuanRun('${escapedMsg}')`);
    setYuanStatus('idle');
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err: any) {
    setYuanStatus('error');
    throw err;
  }
}

/**
 * Get current YUAN agent status.
 */
export function getYuanStatus(): string {
  if (!container) return 'not initialized';
  if (!agentReady) return 'not initialized';
  return 'idle'; // actual status tracked by setYuanStatus
}

/**
 * Register the YUAN handlers with boardVM so yuanfs.go can call them.
 */
export function registerYuanWithBoardVM(): void {
  setYuanHandlers({
    init: initYuanAgent,
    send: sendToYuanAgent,
  });
  console.log('[yuan-bootstrap] registered with boardVM');
}
