/**
 * BoardVMContext — shared React context for boardVM setup.
 *
 * Extracts the boardVM object (llmfs, toolfs, dispatchTool, yuan) from TerminalPanel
 * so both YuanChatPanel and TerminalPanel can consume it.
 */
import React, { createContext, useContext, useRef, useCallback, useEffect, useState } from 'react';
import { registry } from '../core/registry';

// --- Helpers (moved from TerminalPanel) ---

function buildSandboxBindingsMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const mod of registry.getEnabled()) {
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

function buildToolDefinitions(): Array<{ name: string; description: string; parameters: any }> {
  const bindings = buildSandboxBindingsMap();
  const qualifiedNames = new Set(Object.values(bindings));
  const tools: Array<{ name: string; description: string; parameters: any }> = [];
  for (const mod of registry.getEnabled()) {
    if (mod.tools && Array.isArray(mod.tools)) {
      for (const tool of mod.tools) {
        if (!qualifiedNames.has(tool.name)) continue;
        const shortName = Object.entries(bindings).find(([, v]) => v === tool.name)?.[0] || tool.name;
        tools.push({
          name: shortName,
          description: tool.description || '',
          parameters: tool.parameters || { type: 'object', properties: {}, required: [] },
        });
      }
    }
  }
  return tools;
}

function parseXMLToolCalls(content: string, knownTools?: string[]): any[] {
  const calls: any[] = [];
  const skipTags = new Set(['p','br','hr','div','span','a','img','code','pre','em','strong','b','i','u','li','ul','ol','h1','h2','h3','h4','h5','h6','table','tr','td','th','blockquote','details','summary','section','article','header','footer','nav','tool_call']);
  let cleaned = content;
  let idx = 0;
  const knownSet = knownTools ? new Set(knownTools) : null;

  // Default tool names when knownTools not provided
  const defaultTools = ['bash', 'glob', 'grep', 'file_read', 'file_write', 'file_edit',
    'shell_exec', 'git_ops', 'test_run', 'code_search', 'security_scan',
    'web_search', 'parallel_web_search', 'task_complete', 'spawn_sub_agent'];

  // Pass 1: JS function call format — toolname({...})
  // This is the primary format instructed by agent-bootstrap.ts system prompt
  const allToolNames = (knownTools && knownTools.length > 0) ? knownTools : defaultTools;
  const toolAlt = allToolNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const jsCallRe = new RegExp('(' + toolAlt + ')\\s*\\(\\s*(\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\})\\s*\\)', 'gm');
  let match;
  while ((match = jsCallRe.exec(content)) !== null) {
    const name = match[1];
    const json = match[2];
    try {
      const args = JSON.parse(json);
      calls.push({ id: `call_${idx++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
      cleaned = cleaned.replace(match[0], '');
    } catch {
      // Try fixing common issues (trailing commas, unquoted keys)
      try {
        const fixed = json.replace(/,\s*}/g, '}').replace(/(\w+)\s*:/g, '"$1":');
        const args = JSON.parse(fixed);
        calls.push({ id: `call_${idx++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
        cleaned = cleaned.replace(match[0], '');
      } catch { /* skip unparseable */ }
    }
  }

  // Pass 1b: [tool_call]NAME[arg_name]ARG[/arg_name][arg_value]VAL[/arg_value]...[/tool_call]
  // Handles both [] and <> brackets, mixed brackets in args, arg_name/arg_key, dots in tool names.
  const _ao = '(?:\\[|<)';
  const _ac = '(?:\\]|>)';
  const bracketPairs = [
    { o: '\\[', c: '\\]' },
    { o: '<', c: '>' },
  ];
  for (const bp of bracketPairs) {
    const tcRe = new RegExp(bp.o + 'tool_call' + bp.c + '\\s*([\\w.]+)\\s*((?:' + _ao + 'arg_\\w+' + _ac + '[\\s\\S]*?' + _ao + '/arg_\\w+' + _ac + _ao + 'arg_value' + _ac + '[\\s\\S]*?' + _ao + '/arg_value' + _ac + ')+)\\s*' + bp.o + '/tool_call' + bp.c, 'gm');
    while ((match = tcRe.exec(content)) !== null) {
      const tcName = match[1];
      const tcBody = match[2];
      const tcArgs: any = {};
      const pairRe = new RegExp(_ao + 'arg_(\\w+)' + _ac + '([\\s\\S]*?)' + _ao + '/arg_\\w+' + _ac + _ao + 'arg_value' + _ac + '([\\s\\S]*?)' + _ao + '/arg_value' + _ac, 'gm');
      let pm;
      while ((pm = pairRe.exec(tcBody)) !== null) {
        tcArgs[pm[1].trim()] = pm[2].trim();
      }
      calls.push({ id: `call_${idx++}`, type: 'function', function: { name: tcName, arguments: JSON.stringify(tcArgs) } });
      cleaned = cleaned.replace(match[0], '');
    }
  }

  // Pass 1c: [toolname][arg_name]ARG[/arg_name][arg_value]VAL[/arg_value][/toolname] — bare [] tags
  const bareBrRe = /\[(\w+)((?:\[arg_name\][\s\S]*?\[\/arg_name\]\[arg_value\][\s\S]*?\[\/arg_value\])+)\[\/\1\]/gm;
  while ((match = bareBrRe.exec(content)) !== null) {
    const bbName = match[1];
    const bbBody = match[2];
    if (skipTags.has(bbName)) continue;
    const bbArgs: any = {};
    const bbPairRe = /\[arg_name\]([\s\S]*?)\[\/arg_name\]\[arg_value\]([\s\S]*?)\[\/arg_value\]/gm;
    let bbm;
    while ((bbm = bbPairRe.exec(bbBody)) !== null) {
      bbArgs[bbm[1].trim()] = bbm[2].trim();
    }
    if (Object.keys(bbArgs).length > 0 || (knownSet && knownSet.has(bbName))) {
      calls.push({ id: `call_${idx++}`, type: 'function', function: { name: bbName, arguments: JSON.stringify(bbArgs) } });
      cleaned = cleaned.replace(match[0], '');
    }
  }

  // Pass 2: <tool_call name="...">JSON</tool_call >
  const toolCallRe = /<tool_call\s+name="([^"]+)"\s*>([\s\S]*?)<\/\s*tool_call\s*>/g;
  while ((match = toolCallRe.exec(content)) !== null) {
    const name = match[1];
    let args: any = {};
    try { args = JSON.parse(match[2].trim()); } catch { args = { input: match[2].trim() }; }
    calls.push({ id: `call_${idx++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    cleaned = cleaned.replace(match[0], '');
  }

  // Pass 3: <toolName>JSON</toolName> — arbitrary XML tool tags
  const openCloseRe = /<([\w.]+)((?:\s+[^>]*?)*)>([\s\S]*?)<\/\1\s*>/g;
  while ((match = openCloseRe.exec(content)) !== null) {
    const tagName = match[1];
    if (skipTags.has(tagName)) continue;
    if (tagName === 'tool_call') continue; // already handled above
    const body = match[3].trim();
    let args: any = {};
    if (body) {
      try { args = JSON.parse(body); } catch { args = { input: body }; }
    }
    if (Object.keys(args).length > 0 || (knownSet && knownSet.has(tagName))) {
      calls.push({ id: `call_${idx++}`, type: 'function', function: { name: tagName, arguments: JSON.stringify(args) } });
      cleaned = cleaned.replace(match[0], '');
    }
  }

  // Patch content: store cleaned content for caller
  (parseXMLToolCalls as any)._lastCleaned = cleaned.trim();
  return calls;
}

// --- Context ---

interface BoardVMContextValue {
  /** Whether the Yuan agent is ready to accept messages */
  yuanReady: boolean;
  /** Current Yuan agent status string */
  yuanStatus: string;
  /** Send a message to Yuan and get a response */
  yuanSend: (msg: string) => Promise<string>;
  /** Initialize the Yuan agent (called automatically on mount) */
  initYuan: () => Promise<void>;
}

const BoardVMContext = createContext<BoardVMContextValue | null>(null);

export function useBoardVM(): BoardVMContextValue {
  const ctx = useContext(BoardVMContext);
  if (!ctx) throw new Error('useBoardVM must be used within BoardVMProvider');
  return ctx;
}

interface BoardVMProviderProps {
  children: React.ReactNode;
  /** LLM API settings */
  apiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
}

export function BoardVMProvider({
  children,
  apiProvider,
  geminiApiKey,
  geminiModel,
  openaiUrl,
  openaiKey,
  openaiModel,
}: BoardVMProviderProps) {
  // Refs for latest props (closures capture these)
  const apiProviderRef = useRef(apiProvider);
  const geminiApiKeyRef = useRef(geminiApiKey);
  const geminiModelRef = useRef(geminiModel);
  const openaiUrlRef = useRef(openaiUrl);
  const openaiKeyRef = useRef(openaiKey);
  const openaiModelRef = useRef(openaiModel);

  apiProviderRef.current = apiProvider;
  geminiApiKeyRef.current = geminiApiKey;
  geminiModelRef.current = geminiModel;
  openaiUrlRef.current = openaiUrl;
  openaiKeyRef.current = openaiKey;
  openaiModelRef.current = openaiModel;

  const [yuanReady, setYuanReady] = useState(false);
  const [yuanStatus, setYuanStatus] = useState('not initialized');
  const boardVMSetupRef = useRef(false);

  // Set up window.boardVM once (idempotent)
  const setupBoardVM = useCallback(() => {
    if (boardVMSetupRef.current) return;
    boardVMSetupRef.current = true;

    (window as any).boardVM = {
      mode: 'terminal',
      memoryMB: 1024,
      gitfs: {
        getFile: (_path: string) => Promise.resolve(undefined),
        listFiles: (_path: string) => Promise.resolve([]),
      },
      boardfs: {
        listTasks: () => Promise.resolve([]),
        getTask: (_id: string) => Promise.resolve(undefined),
        updateTask: (_id: string, _data: any) => Promise.resolve(),
        listArtifacts: () => Promise.resolve([]),
        readArtifact: (_name: string) => Promise.resolve(''),
        saveArtifact: (_name: string, _content: string) => Promise.resolve(),
        invokeTool: (_tool: string, _args: any) => Promise.resolve(undefined),
      },
      llmfs: {
        sendPrompt: async (prompt: string) => {
          try {
            if (apiProviderRef.current === 'gemini') {
              const { GoogleGenAI } = await import('@google/genai');
              const ai = new GoogleGenAI({ apiKey: geminiApiKeyRef.current });
              const response = await ai.models.generateContent({
                model: geminiModelRef.current,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
              });
              return response.text || '';
            } else {
              const response = await fetch(`${openaiUrlRef.current}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${openaiKeyRef.current}`,
                },
                body: JSON.stringify({
                  model: openaiModelRef.current,
                  messages: [{ role: 'user', content: prompt }],
                  temperature: 0.1,
                }),
              });
              if (response.ok) {
                const data = await response.json();
                return data.choices[0].message.content || '';
              } else {
                const error = await response.text();
                throw new Error(`OpenAI API error: ${error}`);
              }
            }
          } catch (e: any) {
            console.error('[llmfs] API error:', e);
            return `ERROR: ${e.message}`;
          }
        },
        sendRequest: async (reqJSON: string) => {
          try {
            const req = JSON.parse(reqJSON);
            req.model = openaiModelRef.current;

            if (apiProviderRef.current === 'gemini') {
              const { GoogleGenAI } = await import('@google/genai');
              const ai = new GoogleGenAI({ apiKey: geminiApiKeyRef.current });
              const contents: any[] = [];
              for (const msg of req.messages || []) {
                if (msg.role === 'system') continue;
                contents.push({
                  role: msg.role === 'assistant' ? 'model' : 'user',
                  parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
                });
              }
              const geminiTools: any[] = [];
              for (const tool of req.tools || []) {
                geminiTools.push({
                  functionDeclarations: [{
                    name: tool.function.name,
                    description: tool.function.description,
                    parameters: tool.function.parameters,
                  }],
                });
              }
              const response = await ai.models.generateContent({
                model: geminiModelRef.current,
                contents,
                config: {
                  systemInstruction: req.messages?.find((m: any) => m.role === 'system')?.content,
                  tools: geminiTools.length > 0 ? geminiTools : undefined,
                },
              });
              const candidate = response.candidates?.[0];
              const contentParts: any[] = [];
              const toolCalls: any[] = [];
              if (candidate?.content?.parts) {
                let toolIdx = 0;
                for (const part of candidate.content.parts) {
                  if (part.text) {
                    contentParts.push({ type: 'text', text: part.text });
                  } else if (part.functionCall) {
                    toolCalls.push({
                      id: `call_${toolIdx}`,
                      type: 'function',
                      function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args),
                      },
                    });
                    toolIdx++;
                  }
                }
              }
              const openaiResp: any = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                choices: [{
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: contentParts.map((p: any) => p.text).filter(Boolean).join('') || null,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                  },
                  finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
                }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
              };
              return JSON.stringify(openaiResp);
            } else {
              // OpenAI-compatible provider — pass tools natively for function calling
              const cleanReq: any = { ...req };

              const response = await fetch(`${openaiUrlRef.current}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${openaiKeyRef.current}`,
                },
                body: JSON.stringify(cleanReq),
              });

              if (response.ok) {
                const data = await response.json();
                return JSON.stringify(data);
              } else {
                const error = await response.text();
                throw new Error(`OpenAI API error: ${error}`);
              }
            }
          } catch (e: any) {
            return JSON.stringify({
              id: `chatcmpl-err-${Date.now()}`,
              object: 'chat.completion',
              choices: [{
                index: 0,
                message: { role: 'assistant', content: `[LLM Error] ${e.message}` },
                finish_reason: 'stop',
              }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
          }
        },
      },
      dispatchTool: async (name: string, args: any[]): Promise<any> => {
        const qualifiedName = getQualifiedName(name);
        const context = { taskId: 'agent', repoUrl: '', repoBranch: '', githubToken: '', llmCall: async () => '', moduleConfig: {} };
        return registry.invokeHandler(qualifiedName, args, context);
      },
      toolfs: {
        listTools: async () => {
          return JSON.stringify(buildToolDefinitions());
        },
        callTool: async (name: string, paramsJSON: string) => {
          const qualifiedName = getQualifiedName(name);
          try {
            const params = JSON.parse(paramsJSON || '{}');
            const context = { taskId: 'agent', repoUrl: '', repoBranch: '', githubToken: '', llmCall: async () => '', moduleConfig: {} };
            const result = await registry.invokeHandler(qualifiedName, [params], context);
            return JSON.stringify({ content: typeof result === 'string' ? result : JSON.stringify(result), error: '' });
          } catch (e: any) {
            return JSON.stringify({ content: '', error: e.message });
          }
        },
      },
      yuan: {
        _status: 'not initialized' as string,
        init: async () => {
          (window as any).boardVM.yuan._status = 'idle';
        },
        send: async (msg: string): Promise<string> => {
          return '[yuan: not initialized]';
        },
        status: () => (window as any).boardVM?.yuan?._status || 'not configured',
      },
      bashExec: async (args: { command: string; cwd?: string; timeout?: number }): Promise<{
        stdout: string; exitCode: number; error?: string; durationMs: number;
      }> => {
        const bvm = (window as any).boardVM;
        const fs = bvm?.fsBridge;
        if (!fs) return { stdout: '', exitCode: 1, error: 'fsBridge not available', durationMs: 0 };

        const id = crypto.randomUUID().slice(0, 8);
        const cwd = args.cwd || '/home/project';
        const timeout = Math.min(args.timeout || 30000, 120000);
        const start = Date.now();
        const resultDir = `/tmp/bash-exec/${id}`;

        // session-mux creates the result dir itself via os.MkdirAll
        const payload = btoa(`${id}:${cwd}:${args.command}`);
        const seq = new TextEncoder().encode(`\x1b]89;${payload}\x07`);
        const sendRaw = (globalThis as any).__boardSendRaw;
        if (!sendRaw) return { stdout: '', exitCode: 1, error: 'Serial console not ready', durationMs: Date.now() - start };
        sendRaw(seq);

        const deadline = start + timeout;
        let exitCode = -1;
        while (Date.now() < deadline) {
          try {
            const stat = await fs.stat(`${resultDir}/exitcode`);
            if (stat && stat.exists) {
              const codeStr = await fs.readFile(`${resultDir}/exitcode`);
              exitCode = parseInt(codeStr.trim(), 10);
              break;
            }
          } catch {}
          await new Promise(r => setTimeout(r, 200));
        }

        if (exitCode === -1) {
          const killPayload = btoa(`kill:${id}`);
          const killSeq = new TextEncoder().encode(`\x1b]89;${killPayload}\x07`);
          sendRaw(killSeq);
          return { stdout: '', exitCode: -1, error: `timeout after ${timeout}ms`, durationMs: Date.now() - start };
        }

        let stdout = '';
        try { stdout = await fs.readFile(`${resultDir}/stdout`); } catch {}

        const MAX_OUTPUT = 65536;
        if (stdout.length > MAX_OUTPUT) {
          stdout = stdout.slice(0, MAX_OUTPUT) + `\n... truncated (${stdout.length} bytes total)`;
        }

        try { await fs.rm(resultDir); } catch {}

        return { stdout, exitCode, durationMs: Date.now() - start };
      },
    };

    console.log('[BoardVMProvider] boardVM set up on window');
  }, []);

  // Initialize Yuan agent
  const initYuan = useCallback(async () => {
    setupBoardVM();
    setYuanStatus('initializing');

    try {
      const { initYuanAgent, registerYuanWithBoardVM } = await import(
        /* @vite-ignore */
        './agent-bootstrap'
      );
      await initYuanAgent();
      registerYuanWithBoardVM();
      setYuanReady(true);
      setYuanStatus('idle');
      console.log('[BoardVMProvider] Yuan agent initialized');
    } catch (e: any) {
      console.error('[BoardVMProvider] Yuan init failed:', e);
      setYuanStatus('error: ' + e.message);
    }
  }, [setupBoardVM]);

  const yuanSend = useCallback(async (msg: string): Promise<string> => {
    const bvm = (window as any).boardVM;
    if (!bvm?.yuan?.send) throw new Error('Yuan agent not available');
    setYuanStatus('running');
    bvm.yuan._status = 'running';
    try {
      const result = await bvm.yuan.send(msg);
      setYuanStatus('idle');
      bvm.yuan._status = 'idle';
      return result;
    } catch (e: any) {
      setYuanStatus('error');
      bvm.yuan._status = 'error';
      throw e;
    }
  }, []);

  // Auto-init boardVM on mount (Yuan init is lazy — triggered when Yuan tab is opened)
  useEffect(() => {
    setupBoardVM();
  }, [setupBoardVM]);

  return (
    <BoardVMContext.Provider value={{ yuanReady, yuanStatus, yuanSend, initYuan }}>
      {children}
    </BoardVMContext.Provider>
  );
}
