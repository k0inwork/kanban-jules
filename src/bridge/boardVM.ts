/**
 * boardVM bridge — exposes window.boardVM for almostnode ↔ Fleet communication.
 *
 * This is the single escape hatch from the almostnode sandbox to Fleet's
 * module system. Everything the agent needs goes through here.
 *
 * Surface:
 *   boardVM.llmfs.sendRequest(json)    → LLM call (OpenAI Chat Completions format)
 *   boardVM.llmfs.sendPrompt(prompt)   → simple text prompt
 *   boardVM.toolfs.listTools()         → JSON array of tool definitions
 *   boardVM.toolfs.callTool(name, json)→ call a Fleet tool
 *   boardVM.dispatchTool(name, args)   → shorthand for tool dispatch
 *   boardVM.yuan.init()                → initialize YUAN container
 *   boardVM.yuan.send(msg)             → send message to YUAN agent
 *   boardVM.yuan.status()              → get agent status
 *   boardVM.tasks.*                    → direct Dexie task access
 *   boardVM.on/emit                    → event bus
 */

import { registry } from '../core/registry';
import { eventBus } from '../core/event-bus';
import { db } from '../services/db';
import type { RequestContext } from '../core/types';

// --- Tool name mapping: short agent names → qualified Fleet handler names ---

const TOOL_MAP: Record<string, string> = {
  readFile:       'knowledge-repo-browser.readFile',
  writeFile:      'knowledge-repo-browser.writeFile',
  listFiles:      'knowledge-repo-browser.listFiles',
  headFile:       'knowledge-repo-browser.headFile',
  saveArtifact:   'knowledge-artifacts.saveArtifact',
  listArtifacts:  'knowledge-artifacts.listArtifacts',
  readArtifact:   'knowledge-artifacts.readArtifact',
  askUser:        'channel-user-negotiator.askUser',
  askJules:       'executor-jules.execute',
  runWorkflow:    'executor-github.runWorkflow',
  getRunStatus:   'executor-github.getRunStatus',
  fetchArtifacts: 'executor-github.fetchArtifacts',
  scan:           'knowledge-local-analyzer.scan',
  analyze:        'host.analyze',
  addToContext:   'host.addToContext',
  globalVarsGet:  'host.agentContextGet',
  globalVarsSet:  'host.agentContextSet',
  bash:           'executor-wasm.execute',
};

// --- LLM call function (injected by host.init) ---

let _llmCall: ((prompt: string, jsonMode?: boolean) => Promise<string>) | null = null;

export function setBoardVMLLMCall(fn: (prompt: string, jsonMode?: boolean) => Promise<string>) {
  _llmCall = fn;
}

// --- Build request context for tool dispatch ---

let _hostConfig: { repoUrl: string; repoBranch: string; githubToken: string } | null = null;

export function setBoardVMHostConfig(config: { repoUrl: string; repoBranch: string; githubToken: string }) {
  _hostConfig = config;
}

function makeContext(taskId: string = 'agent'): RequestContext {
  return {
    taskId,
    repoUrl: _hostConfig?.repoUrl || '',
    repoBranch: _hostConfig?.repoBranch || '',
    githubToken: _hostConfig?.githubToken || '',
    llmCall: _llmCall || (async () => ''),
    moduleConfig: {},
  };
}

// --- YUAN agent state ---

type YuanStatus = 'idle' | 'running' | 'error' | 'not initialized';

let _yuanStatus: YuanStatus = 'not initialized';
let _yuanInit: (() => Promise<void>) | null = null;
let _yuanSend: ((msg: string) => Promise<string>) | null = null;

export function setYuanHandlers(handlers: {
  init: () => Promise<void>;
  send: (msg: string) => Promise<string>;
}) {
  _yuanInit = handlers.init;
  _yuanSend = handlers.send;
}

export function setYuanStatus(status: YuanStatus) {
  _yuanStatus = status;
}

// --- The boardVM object ---

export const boardVM = {
  // LLM tunnel
  llmfs: {
    async sendRequest(jsonPayload: string): Promise<string> {
      if (!_llmCall) return JSON.stringify({ error: 'LLM not configured' });
      try {
        const req = JSON.parse(jsonPayload);
        // Extract the prompt from OpenAI Chat Completions format
        const messages = req.messages || [];
        const lastMsg = messages[messages.length - 1];
        const prompt = lastMsg?.content || '';
        const result = await _llmCall(prompt, false);
        // Return in OpenAI Chat Completions response format
        return JSON.stringify({
          choices: [{
            message: { role: 'assistant', content: result },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } catch (err: any) {
        return JSON.stringify({ error: err.message });
      }
    },

    async sendPrompt(prompt: string): Promise<string> {
      if (!_llmCall) return 'error: LLM not configured';
      try {
        return await _llmCall(prompt, false);
      } catch (err: any) {
        return 'error: ' + err.message;
      }
    },
  },

  // Tool tunnel
  toolfs: {
    async listTools(): Promise<string> {
      const modules = registry.getEnabled();
      const tools: Array<{ name: string; description: string }> = [];
      for (const mod of modules) {
        if (mod.tools && Array.isArray(mod.tools)) {
          for (const tool of mod.tools) {
            // Use short name for the agent
            const shortName = Object.entries(TOOL_MAP).find(([, v]) => v === tool.name)?.[0] || tool.name;
            tools.push({ name: shortName, description: tool.description || '' });
          }
        }
      }
      return JSON.stringify(tools);
    },

    async callTool(name: string, paramsJSON: string): Promise<string> {
      const qualifiedName = TOOL_MAP[name] || name;
      try {
        const params = JSON.parse(paramsJSON || '{}');
        const context = makeContext();
        const result = await registry.invokeHandler(qualifiedName, [params], context);
        return JSON.stringify({ content: typeof result === 'string' ? result : JSON.stringify(result), error: '' });
      } catch (err: any) {
        return JSON.stringify({ content: '', error: err.message });
      }
    },
  },

  // Shorthand tool dispatch
  async dispatchTool(name: string, args: any[]): Promise<any> {
    const qualifiedName = TOOL_MAP[name] || name;
    const context = makeContext();
    return registry.invokeHandler(qualifiedName, args, context);
  },

  // YUAN agent interface (consumed by yuanfs.go via JS interop)
  yuan: {
    async init(): Promise<void> {
      if (!_yuanInit) throw new Error('YUAN init handler not set');
      await _yuanInit();
    },
    async send(msg: string): Promise<string> {
      if (!_yuanSend) throw new Error('YUAN send handler not set');
      _yuanStatus = 'running';
      try {
        const result = await _yuanSend(msg);
        _yuanStatus = 'idle';
        return result;
      } catch (err: any) {
        _yuanStatus = 'error';
        throw err;
      }
    },
    status(): string {
      return _yuanStatus;
    },
  },

  // Direct Dexie task access
  tasks: {
    list: async () => db.tasks.toArray(),
    get: async (id: string) => db.tasks.get(id),
    update: async (id: string, changes: Record<string, any>) => db.tasks.update(id, changes),
    create: async (task: any) => db.tasks.add(task),
  },

  // Event bus
  on: (event: string, callback: (...args: any[]) => void) => eventBus.on(event as any, callback as any),
  emit: (event: string, data: any) => eventBus.emit(event as any, data),

  // Mode (consumed by main.go)
  mode: 'terminal',
};

// --- Install on globalThis ---

export function installBoardVM() {
  (globalThis as any).boardVM = boardVM;
  console.log('[boardVM] installed on globalThis');
}
