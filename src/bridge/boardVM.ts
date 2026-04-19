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

// --- Tool name mapping: built dynamically from module sandboxBindings ---

/**
 * Build a short-name → qualified-name mapping from all enabled modules' sandboxBindings.
 * Modules declare sandboxBindings in their manifest.json, e.g.:
 *   "sandboxBindings": { "jules.execute": "executor-jules.execute" }
 * This is the single source of truth — no hardcoded TOOL_MAP needed.
 */
function buildSandboxBindingsMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const modules = registry.getEnabled();
  for (const mod of modules) {
    if (mod.hidden) continue;
    if (mod.sandboxBindings) {
      for (const [shortName, qualifiedName] of Object.entries(mod.sandboxBindings)) {
        map[shortName] = qualifiedName;
      }
    }
  }
  return map;
}

function getQualifiedName(shortName: string): string {
  const map = buildSandboxBindingsMap();
  return map[shortName] || shortName;
}

// --- LLM call function (injected by host.init) ---

let _llmCall: ((prompt: string, jsonMode?: boolean) => Promise<string>) | null = null;

// --- Mock LLM response when no provider is configured ---

function mockLLMResponse(jsonPayload: string): string {
  let userMessage = '';
  let tools: any[] = [];
  try {
    const req = JSON.parse(jsonPayload);
    const messages = req.messages || [];
    const lastMsg = messages[messages.length - 1];
    userMessage = typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content || '');
    tools = req.tools || [];
  } catch {
    userMessage = jsonPayload;
  }

  // If tools are available, generate a mock tool call for common requests
  if (tools.length > 0) {
    const lowerMsg = userMessage.toLowerCase();
    // Try to match a relevant tool
    if (lowerMsg.includes('list') && lowerMsg.includes('task')) {
      const listTool = tools.find((t: any) => t.function?.name === 'list_tasks');
      if (listTool) {
        return JSON.stringify({
          id: `mock-${Date.now()}`,
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: `call_mock_${Date.now()}`,
                type: 'function',
                function: { name: 'list_tasks', arguments: '{}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    }
    if ((lowerMsg.includes('read') || lowerMsg.includes('get')) && lowerMsg.includes('file')) {
      const readTool = tools.find((t: any) => t.function?.name === 'readFile' || t.function?.name === 'git_get_file');
      if (readTool) {
        return JSON.stringify({
          id: `mock-${Date.now()}`,
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: `call_mock_${Date.now()}`,
                type: 'function',
                function: { name: readTool.function.name, arguments: JSON.stringify({ path: '/' }) },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    }
  }

  // Default: return a text response acknowledging the message
  const mockReply = `[MOCK LLM] No LLM provider configured. Received: "${userMessage.substring(0, 200)}". Configure an API key in Settings (gear icon) to get real responses. Available tools: ${tools.map((t: any) => t.function?.name).filter(Boolean).join(', ') || 'none'}.`;
  return JSON.stringify({
    id: `mock-${Date.now()}`,
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: mockReply },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

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
      // If no LLM provider configured, return mock response
      if (!_llmCall) {
        console.log('[boardVM.llmfs] No LLM configured — returning mock response');
        return mockLLMResponse(jsonPayload);
      }
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
        // If LLM call fails (e.g. missing API key), fall back to mock response
        console.log('[boardVM.llmfs] LLM call failed, falling back to mock:', err.message);
        return mockLLMResponse(jsonPayload);
      }
    },

    async sendPrompt(prompt: string): Promise<string> {
      if (!_llmCall) {
        return `[MOCK LLM] No provider configured. Prompt: "${prompt.substring(0, 200)}". Configure an API key in Settings.`;
      }
      try {
        return await _llmCall(prompt, false);
      } catch (err: any) {
        return `[MOCK LLM] LLM call failed (${err.message}). Prompt: "${prompt.substring(0, 200)}". Configure an API key in Settings.`;
      }
    },
  },

  // Tool tunnel
  toolfs: {
    async listTools(): Promise<string> {
      const modules = registry.getEnabled();
      const bindings = buildSandboxBindingsMap();
      const tools: Array<{ name: string; description: string }> = [];
      // Only expose tools that have sandboxBindings (i.e. are agent-accessible)
      const qualifiedNames = new Set(Object.values(bindings));
      for (const mod of modules) {
        if (mod.tools && Array.isArray(mod.tools)) {
          for (const tool of mod.tools) {
            if (!qualifiedNames.has(tool.name)) continue;
            // Find the short name for this qualified tool name
            const shortName = Object.entries(bindings).find(([, v]) => v === tool.name)?.[0] || tool.name;
            tools.push({ name: shortName, description: tool.description || '' });
          }
        }
      }
      return JSON.stringify(tools);
    },

    async callTool(name: string, paramsJSON: string): Promise<string> {
      const qualifiedName = getQualifiedName(name);
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
    const qualifiedName = getQualifiedName(name);
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
