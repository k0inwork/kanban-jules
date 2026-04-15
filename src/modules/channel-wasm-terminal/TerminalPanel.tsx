import { useEffect, useRef, useState, useCallback } from 'react';

export const BUILD = 37;

/**
 * Early VM boot — starts fetching wanix.min.js and sys.tar.gz bundle
 * immediately when this module is imported (before user clicks terminal tab).
 * The actual WanixRuntime + VM boot happens in parallel with the rest of the app.
 * When TerminalPanel mounts, it just waits for the pre-booted VM and connects xterm.
 */
let vmBootPromise: Promise<any> | null = null;
const termSizeRef = { cols: 120, rows: 40 };

function prebootVM(bundleUrl: string, wanixUrl: string, wasmUrl: string): Promise<any> {
  if (vmBootPromise) return vmBootPromise;

  vmBootPromise = (async () => {
    console.log('[preboot] Starting early VM boot...');

    // 1. Load WanixRuntime
    const WanixRuntime = await loadWanixRuntime(wanixUrl);
    if (!WanixRuntime) throw new Error('WanixRuntime not loaded');

    // 2. Create runtime instance
    const w = new WanixRuntime({
      screen: false,
      helpers: false,
      debug9p: false,
      wasm: null,
      network: 'fetch',
    });

    // 3. Fetch bundle + WASM in parallel
    const [bundleResp, wasmResp] = await Promise.all([
      fetch(bundleUrl),
      fetch(wasmUrl),
    ]);
    if (!bundleResp.ok) throw new Error(`Failed to fetch bundle: ${bundleResp.status}`);
    if (!wasmResp.ok) throw new Error(`Failed to fetch WASM: ${wasmResp.status}`);

    const [bundleData, wasmData] = await Promise.all([
      bundleResp.arrayBuffer(),
      wasmResp.arrayBuffer(),
    ]);

    w._bundle = bundleData;
    w._getBundle = async () => undefined;

    // 4. Load WASM (starts VM boot)
    w._loadWasm(wasmData);

    // 5. Wait for VM to be ready
    await w.ready();
    console.log('[preboot] VM ready');
    return w;
  })();

  return vmBootPromise;
}

// Auto-preboot at module import time with static URLs.
// The VM boots in parallel with React rendering.
prebootVM('/assets/wasm/sys.tar.gz', '/assets/wasm/wanix.min.js', '/assets/wasm/boot.wasm');

/**
 * TerminalPanel — xterm.js terminal connected to a Wanix VM.
 *
 * Runs WanixRuntime in the main thread (it requires `document` for WASM loading).
 * The boot.wasm (Go WASM compiled from wasm/boot/) boots the VM,
 * and serial output is bridged to xterm.js via the Wanix port API.
 *
 * Required WASM assets in public/assets/wasm/:
 *   - wanix.min.js  (Wanix runtime)
 *   - boot.wasm     (Go WASM binary compiled from wasm/boot/)
 *   - sys.tar.gz    (Alpine rootfs + kernel + v86, built via Dockerfile.wasm)
 */
/**
 * Load WanixRuntime from wanix.min.js by injecting a script tag.
 * The wanix.min.js file sets window.WanixRuntime as a side effect.
 * We need to strip the ESM export statement first since <script> tags
 * don't support export.
 */
async function loadWanixRuntime(url: string): Promise<any> {
  // Check if already loaded
  if ((window as any).WanixRuntime) {
    return (window as any).WanixRuntime;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Use a module script so import/export syntax is valid
    script.type = 'module';
    script.textContent = `
      import { WanixRuntime } from "${url}";
      window.WanixRuntime = WanixRuntime;
      window.dispatchEvent(new Event('wanix-loaded'));
    `;
    window.addEventListener('wanix-loaded', () => {
      resolve((window as any).WanixRuntime);
    }, { once: true });
    document.head.appendChild(script);
    // Fallback: check if it was already set by the side-effect path
    setTimeout(() => {
      if ((window as any).WanixRuntime) {
        resolve((window as any).WanixRuntime);
      } else {
        reject(new Error('WanixRuntime not loaded'));
      }
    }, 5000);
  });
}

interface TerminalPanelProps {
  bundleUrl: string;
  wasmUrl: string;
  wanixUrl: string;
  /** LLM API settings */
  apiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
  /** Called when the terminal is ready for input */
  onReady?: () => void;
  /** Called when the terminal produces output */
  onOutput?: (data: string) => void;
}

export function TerminalPanel({ bundleUrl, wasmUrl, wanixUrl, apiProvider, geminiApiKey, geminiModel, openaiUrl, openaiKey, openaiModel, onReady, onOutput }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<any>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const [cmdInput, setCmdInput] = useState('');
  const [serialReady, setSerialReady] = useState(false);

  // Refs to always read latest props inside closures created at mount time
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

  // Parse <tool_call name="...">JSON</tool_call from LLM response
  // and convert to OpenAI tool_calls format
  const parseXMLToolCalls = (content: string): any[] => {
    const calls: any[] = [];
    const regex = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/g;
    let match;
    let idx = 0;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      let args: any = {};
      try {
        args = JSON.parse(match[2].trim());
      } catch {
        args = { input: match[2].trim() };
      }
      calls.push({
        id: `call_${idx}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      });
      idx++;
    }
    return calls;
  };

  const sendCommand = useCallback((text: string) => {
    const fn = (window as any).__boardSend;
    if (fn) fn(text);
  }, []);

  const handleCmdSubmit = useCallback(() => {
    if (!cmdInput.trim()) return;
    sendCommand(cmdInput);
    setCmdInput('');
  }, [cmdInput, sendCommand]);

  const initTerminal = useCallback(async () => {
    if (!terminalRef.current) return;

    // Dynamic imports for xterm.js
    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    await import('@xterm/xterm/css/xterm.css');

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b7066',
      },
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    (window).__xterm = term; // expose for testing

    // Check if container is visible (has dimensions). When the terminal tab
    // is hidden via display:none, xterm reports 0x0. In that case, skip the
    // size wait and use defaults — the ResizeObserver in the resize handler
    // will send the correct size when the tab becomes visible.
    const containerVisible = terminalRef.current.offsetWidth > 0;
    if (containerVisible) {
      await new Promise<void>((resolve) => {
        const tryFit = (): boolean => {
          fitAddon.fit();
          return term.cols >= 80 && term.rows >= 24;
        };
        if (tryFit()) { resolve(); return; }
        const container = terminalRef.current;
        if (!container) { resolve(); return; }
        const observer = new ResizeObserver(() => {
          if (tryFit()) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(container);
      });
    }
    console.log(`[TerminalPanel] Starting terminal (v${BUILD}) cols=${term.cols} rows=${term.rows} visible=${containerVisible}...`);

    try {
      // Set up boardVM config for boot.wasm to read
      // Uses static defaults; resize escape sequence updates VM when xterm is ready
      if (containerVisible) {
        termSizeRef.cols = term.cols;
        termSizeRef.rows = term.rows;
      }
      (window as any).boardVM = {
        mode: 'terminal',
        memoryMB: 1024,
        get termCols() { return termSizeRef.cols; },
        get termRows() { return termSizeRef.rows; },
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
            console.log('[llmfs] sendPrompt:', prompt);
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
            console.log('[llmfs] sendRequest:', reqJSON.substring(0, 200));
            try {
              const req = JSON.parse(reqJSON);
              // Override the model name with the configured one
              console.log('[llmfs] model:', req.model, '->', openaiModelRef.current, '| url:', openaiUrlRef.current, '| key:', openaiKeyRef.current ? 'set' : 'unset');
              req.model = openaiModelRef.current;
              if (apiProviderRef.current === 'gemini') {
                // Convert OpenAI format to Gemini format
                const { GoogleGenAI } = await import('@google/genai');
                const ai = new GoogleGenAI({ apiKey: geminiApiKeyRef.current });
                // Build Gemini contents from OpenAI messages
                const contents: any[] = [];
                for (const msg of req.messages || []) {
                  if (msg.role === 'system') continue; // handle separately
                  contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
                  });
                }
                // Convert OpenAI tools to Gemini tools
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
                // Convert Gemini response back to OpenAI format
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
                // OpenAI-compatible provider that may not support native function calling.
                // Strategy: strip tools from API request, inject tool schema into the
                // last user message as XML, then parse XML tool calls from the response
                // back into OpenAI tool_calls format for the agent framework.
                const cleanReq: any = { ...req };
                const tools = cleanReq.tools;
                let toolSchemaXML = '';

                if (tools && tools.length > 0) {
                  // Build XML tool schema to inject into prompt
                  const lines = ['\n\n<available_tools>'];
                  for (const t of tools) {
                    const fn = t.function;
                    lines.push(`  <tool name="${fn.name}">`);
                    lines.push(`    <description>${fn.description || ''}</description>`);
                    if (fn.parameters?.properties) {
                      lines.push('    <parameters>');
                      for (const [k, v] of Object.entries(fn.parameters.properties)) {
                        lines.push(`      <param name="${k}" type="${(v as any).type || 'string'}">${(v as any).description || ''}</param>`);
                      }
                      lines.push('    </parameters>');
                    }
                    lines.push('  </tool>');
                  }
                  lines.push('</available_tools>');
                  lines.push('To use a tool, respond with: <tool_call name="tool_name">{"arg": "value"}</tool_call}');
                  lines.push('You can make multiple tool calls. After tool results, continue your response.');
                  toolSchemaXML = lines.join('\n');

                  // Remove tools from API request
                  delete cleanReq.tools;
                  delete cleanReq.tool_choice;
                }

                // Append tool schema to last user message
                if (toolSchemaXML && cleanReq.messages?.length > 0) {
                  const lastMsg = cleanReq.messages[cleanReq.messages.length - 1];
                  if (lastMsg.role === 'user') {
                    lastMsg.content = (lastMsg.content || '') + toolSchemaXML;
                  } else {
                    cleanReq.messages.push({ role: 'user', content: toolSchemaXML });
                  }
                }

                console.log('[llmfs] POST (tools stripped, schema in prompt) model:', cleanReq.model);
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
                  // Parse XML tool calls from response content and convert to OpenAI format
                  const content = data.choices?.[0]?.message?.content || '';
                  const toolCalls = parseXMLToolCalls(content);

                  if (toolCalls.length > 0) {
                    // Strip the XML from displayed content
                    const cleanContent = content.replace(/<tool_call[^>]*>[\s\S]*?<\/tool_call>/g, '').trim();
                    data.choices[0].message.content = cleanContent || null;
                    data.choices[0].message.tool_calls = toolCalls;
                    data.choices[0].finish_reason = 'tool_calls';
                    console.log('[llmfs] parsed', toolCalls.length, 'tool calls from XML');
                  }

                  console.log('[llmfs] response data:', JSON.stringify(data).substring(0, 300));
                  return JSON.stringify(data);
                } else {
                  const error = await response.text();
                  console.error('[llmfs] API error response:', error);
                  throw new Error(`OpenAI API error: ${error}`);
                }
              }
            } catch (e: any) {
              console.error('[llmfs] sendRequest error:', e);
              // Return as a valid OpenAI response so the agent sees the error as content
              // instead of silently failing with "Task completed"
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
          console.log('[boardVM.dispatchTool]', name, args);
          const resultJSON = await (window as any).boardVM.toolfs.callTool(name, JSON.stringify(args[0] || {}));
          const parsed = JSON.parse(resultJSON);
          if (parsed.error) throw new Error(parsed.error);
          return parsed.content;
        },
        toolfs: {
          listTools: async () => {
            return JSON.stringify([
              // Board tools
              { name: 'list_tasks', description: 'List all kanban board tasks with their status', params: {} },
              { name: 'get_task', description: 'Get full task details including description, status, steps, and analysis', params: { task_id: { type: 'string', description: 'Task ID', required: true } } },
              { name: 'update_task', description: 'Update task fields (workflowStatus, agentState, description, etc.)', params: { task_id: { type: 'string', description: 'Task ID', required: true }, updates: { type: 'object', description: 'Fields to update', required: true } } },
              { name: 'get_task_logs', description: 'Download task execution logs from all modules (executor, negotiator, orchestrator)', params: { task_id: { type: 'string', description: 'Task ID', required: true } } },
              { name: 'get_jules_activities', description: 'Download Jules session activity log for a task (plans, steps, outputs, errors)', params: { task_id: { type: 'string', description: 'Task ID', required: true } } },
              { name: 'list_artifacts', description: 'List all artifacts', params: {} },
              { name: 'read_artifact', description: 'Read artifact content by name', params: { name: { type: 'string', description: 'Artifact name', required: true } } },
              { name: 'save_artifact', description: 'Save or create an artifact', params: { name: { type: 'string', description: 'Artifact name', required: true }, content: { type: 'string', description: 'Artifact content', required: true } } },
              // Git/file tools
              { name: 'git_get_file', description: 'Read a file from the git repository', params: { path: { type: 'string', description: 'File path in repo', required: true } } },
              { name: 'git_list_files', description: 'List files in a git repository directory', params: { path: { type: 'string', description: 'Directory path (use "" for root)', required: false } } },
            ]);
          },
          callTool: async (name: string, paramsJSON: string) => {
            console.log('[toolfs] callTool:', name, paramsJSON.substring(0, 200));
            const params = JSON.parse(paramsJSON);
            try {
              const { db } = await import('../../services/db');

              switch (name) {
                // --- Board tools ---
                case 'list_tasks': {
                  const tasks = await db.tasks.toArray();
                  return JSON.stringify({ content: JSON.stringify(tasks.map(t => ({
                    id: t.id, title: t.title, workflowStatus: t.workflowStatus,
                    agentState: t.agentState, createdAt: t.createdAt,
                    description: t.description?.substring(0, 200),
                  }))), error: '' });
                }
                case 'get_task': {
                  const task = await db.tasks.get(params.task_id);
                  if (!task) return JSON.stringify({ content: '', error: `Task ${params.task_id} not found` });
                  return JSON.stringify({ content: JSON.stringify(task), error: '' });
                }
                case 'update_task': {
                  await db.tasks.update(params.task_id, params.updates);
                  return JSON.stringify({ content: `Task ${params.task_id} updated`, error: '' });
                }
                case 'get_task_logs': {
                  const task = await db.tasks.get(params.task_id);
                  if (!task) return JSON.stringify({ content: '', error: `Task ${params.task_id} not found` });
                  const logs = task.moduleLogs || {};
                  return JSON.stringify({ content: JSON.stringify({ taskId: task.id, title: task.title, status: task.workflowStatus, agentState: task.agentState, logs }), error: '' });
                }
                case 'get_jules_activities': {
                  const task = await db.tasks.get(params.task_id);
                  if (!task) return JSON.stringify({ content: '', error: `Task ${params.task_id} not found` });
                  const session = await db.julesSessions.where('taskId').equals(params.task_id).first();
                  if (!session) return JSON.stringify({ content: JSON.stringify({ info: 'No Jules session for this task' }), error: '' });
                  const activities: any[] = [];
                  try {
                    const moduleConfigs = JSON.parse(localStorage.getItem('moduleConfigs') || '{}');
                    const julesApiKey = moduleConfigs['executor-jules']?.julesApiKey;
                    if (julesApiKey) {
                      const { julesApi } = await import('../../lib/julesApi');
                      const resp = await julesApi.listActivities(julesApiKey, session.name, 50);
                      for (const act of resp.activities || []) {
                        activities.push({
                          name: act.name, originator: act.originator,
                          description: act.description, createTime: act.createTime,
                          planGenerated: act.planGenerated ? { steps: act.planGenerated.plan.steps.map((s: any) => s.title) } : undefined,
                          agentMessaged: act.agentMessaged?.agentMessage,
                          sessionFailed: act.sessionFailed?.reason,
                          bashOutput: act.artifacts?.find((a: any) => a.bashOutput)?.bashOutput,
                        });
                      }
                    }
                  } catch (e: any) {
                    console.warn('[toolfs] Jules activity fetch failed:', e);
                  }
                  return JSON.stringify({ content: JSON.stringify({ session: { id: session.id, name: session.name, title: session.title, status: session.status }, activities }), error: '' });
                }
                case 'list_artifacts': {
                  const artifacts = await db.taskArtifacts.toArray();
                  return JSON.stringify({ content: JSON.stringify(artifacts.map(a => ({ id: a.id, name: a.name, taskId: a.taskId, type: a.type }))), error: '' });
                }
                case 'read_artifact': {
                  const artifact = await db.taskArtifacts.where('name').equals(params.name).first();
                  if (!artifact) return JSON.stringify({ content: '', error: `Artifact ${params.name} not found` });
                  return JSON.stringify({ content: artifact.content, error: '' });
                }
                case 'save_artifact': {
                  await db.taskArtifacts.add({ name: params.name, content: params.content, taskId: '', repoName: '', branchName: '' });
                  return JSON.stringify({ content: `Artifact ${params.name} saved`, error: '' });
                }

                // --- Git tools (use existing boardVM.gitfs which has credentials) ---
                case 'git_get_file': {
                  const gitfs = (window as any).boardVM?.gitfs;
                  if (!gitfs) return JSON.stringify({ content: '', error: 'GitFS not available' });
                  const content = await gitfs.getFile(params.path);
                  if (!content) return JSON.stringify({ content: '', error: `File ${params.path} not found` });
                  return JSON.stringify({ content: typeof content === 'string' ? content : JSON.stringify(content), error: '' });
                }
                case 'git_list_files': {
                  const gitfs = (window as any).boardVM?.gitfs;
                  if (!gitfs) return JSON.stringify({ content: '', error: 'GitFS not available' });
                  const files = await gitfs.listFiles(params.path || '');
                  return JSON.stringify({ content: JSON.stringify(files), error: '' });
                }

                default:
                  return JSON.stringify({ content: '', error: `Unknown tool: ${name}` });
              }
            } catch (e: any) {
              console.error('[toolfs] callTool error:', e);
              return JSON.stringify({ content: '', error: e.message });
            }
          },
        },
      };

      // Yuan agent bridge — wired to session pipes for chat with session-mux
      (window as any).boardVM.yuan = {
        _status: 'not initialized' as string,
        init: async () => {
          console.log('[yuan] init called');
          (window as any).boardVM.yuan._status = 'idle';
        },
        send: async (msg: string): Promise<string> => {
          console.log('[yuan] send:', msg?.substring(0, 200));
          return '[yuan bridge: use session pipes]';
        },
        status: () => (window as any).boardVM?.yuan?._status || 'not configured',
      };

      // Initialize the real Yuan agent (almostnode + @yuaone/core) in background.
      // Don't await — npm install can be slow and we don't want to block VM startup.
      import(
        /* @vite-ignore */
        '../../bridge/agent-bootstrap'
      ).then(async ({ initYuanAgent, registerYuanWithBoardVM }) => {
        await initYuanAgent();
        registerYuanWithBoardVM();
        console.log('[TerminalPanel] Yuan agent initialized successfully');
      }).catch((e: any) => {
        console.error('[TerminalPanel] Yuan agent init failed:', e);
        console.error('[TerminalPanel] Yuan agent init failed:', e.message);
      });

      // Await preboot (runtime + bundle + WASM) — starts if not already running
      const w = await prebootVM(bundleUrl, wanixUrl, wasmUrl);
      runtimeRef.current = w;
      console.log('[TerminalPanel] VM preboot complete, connecting console...');
      onReady?.();

      // Connect serial console
      try {
        await w.waitFor('#console/data', 60000);
        console.log('[TerminalPanel] Console connected');

        const readFd = await w.open('#console/data');
        console.log('[TerminalPanel] read fd:', readFd);

        const decoder = new TextDecoder();

        (async () => {
          try {
            for (;;) {
              const chunk: Uint8Array | null = await w.read(readFd, 4096);
              if (chunk === null) {
                term.writeln('\r\n[console EOF]\r\n');
                break;
              }
              if (chunk.length > 0) {
                const text = decoder.decode(chunk, { stream: true });
                term.write(text);
                onOutput?.(text);
              }
            }
          } catch (e: any) {
            console.error('[TerminalPanel] console read error:', e);
            term.writeln(`\r\n[console read error: ${e.message}]\r\n`);
          }
        })();

        // Expose send functions
        (runtimeRef.current as any)._serialReady = true;
        (window as any).__boardSend = (text: string) => {
          const encoded = new TextEncoder().encode(text + '\r');
          return w.appendFile('#console/data', encoded).catch((e: any) => {
            console.error('[TerminalPanel] send error:', e);
          });
        };
        (window as any).__boardSendRaw = (data: Uint8Array) => {
          return w.appendFile('#console/data', data).catch((e: any) => {
            console.error('[TerminalPanel] sendRaw error:', e);
          });
        };
        setSerialReady(true);

        // Send initial resize to sync xterm dimensions with VM
        // Only when container is visible — otherwise the ResizeObserver
        // handles it when the terminal tab is shown.
        if (containerVisible && term.cols >= 80 && term.rows >= 24) {
          const initSeq = `\x1b[8;${term.rows};${term.cols}t`;
          (window as any).__boardSendRaw(new TextEncoder().encode(initSeq));
          console.log(`[TerminalPanel] sent initial resize: ${term.cols}x${term.rows}`);
        }

        // --- Session pipe bridge: read mux→JS messages, respond via LLM ---
        (async () => {
          try {
            await w.waitFor('#sessions/0/in', 30000);
            console.log('[session-bridge] session pipes available');

            const fd = await w.open('#sessions/0/in');
            console.log('[session-bridge] opened in fd:', fd);
            const decoder = new TextDecoder();
            let buf = '';

            for (;;) {
              const chunk: Uint8Array | null = await w.read(fd, 4096);
              if (chunk === null || chunk.length === 0) continue;
              buf += decoder.decode(chunk, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop() || '';
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const msg = JSON.parse(line);
                  console.log('[session-bridge] msg:', msg);
                  if (msg.type === 'chat' && msg.text) {
                    (window as any).boardVM.yuan._status = 'running';
                    (async () => {
                      try {
                        const yuan = (window as any).boardVM?.yuan;
                        console.log('[session-bridge] calling Yuan agent, yuan:', !!yuan?.send);
                        const response = await yuan?.send?.(msg.text) || '[Yuan not configured]';
                        console.log('[session-bridge] LLM response:', response?.substring(0, 100));
                        const reply = JSON.stringify({ type: 'chat', text: response }) + '\n';
                        console.log('[session-bridge] writing reply to response');
                        try {
                          const rfd = await w.open('#sessions/0/response');
                          await w.write(rfd, new TextEncoder().encode(reply));
                          await w.close(rfd);
                        } catch(e2: any) {
                          console.log('[session-bridge] fallback to in:', e2.message);
                          await w.appendFile('#sessions/0/in', new TextEncoder().encode(reply));
                        }
                        console.log('[session-bridge] reply written');
                      } catch (e: any) {
                        console.error('[session-bridge] LLM error:', e);
                        const errReply = JSON.stringify({ type: 'chat', text: `[error: ${e.message}]` }) + '\n';
                        try {
                          const efd = await w.open('#sessions/0/response');
                          await w.write(efd, new TextEncoder().encode(errReply));
                          await w.close(efd);
                        } catch(e3) {
                          await w.appendFile('#sessions/0/in', new TextEncoder().encode(errReply));
                        }
                      }
                      (window as any).boardVM.yuan._status = 'idle';
                    })();
                  }
                } catch { /* not JSON */ }
              }
            }
          } catch (e: any) {
            console.error('[session-bridge] error:', e);
          }
        })();
      } catch (serialErr: any) {
        console.error('[TerminalPanel] console setup error:', serialErr);
        term.writeln(`\r\n[console setup error: ${serialErr.message}]\r\n`);
      }

      // xterm keystrokes → VM console pipe (via __boardSendRaw)
      term.onData((data: string) => {
        const fn = (window as any).__boardSendRaw;
        if (!fn) return;
        const encoded = new TextEncoder().encode(data);
        fn(encoded);
      });
    } catch (err: any) {
      term.writeln(`\r\n[error: ${err.message || err}]\r\n`);
    }

    // Resize handling: fit xterm AND propagate to VM's VT emulator
    const sendResizeToVM = () => {
      const fn = (window as any).__boardSendRaw;
      if (!fn) return;
      // Send CSI 8;rows;cols t — session-mux intercepts this
      const seq = `\x1b[8;${term.rows};${term.cols}t`;
      fn(new TextEncoder().encode(seq));
    };

    const handleResize = () => {
      try { fitAddon.fit(); } catch {}
      sendResizeToVM();
    };
    window.addEventListener('resize', handleResize);

    // Refit when the container becomes visible (e.g. tab switch)
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }
  }, [bundleUrl, wasmUrl, wanixUrl, apiProvider, geminiApiKey, geminiModel, openaiUrl, openaiKey, openaiModel, onReady, onOutput]);

  useEffect(() => {
    initTerminal();
    return () => {
      xtermRef.current?.dispose();
    };
  }, []); // intentionally empty — only init once

  return (
    <div
      ref={terminalRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e2e',
        padding: '4px',
      }}
    />
  );
}

/**
 * Send text to the terminal VM (writes to console pipe).
 */
export function sendToTerminal(runtime: any, text: string) {
  if (runtime?._serialReady) {
    const encoded = new TextEncoder().encode(text + '\r');
    runtime.appendFile('#console/data', encoded);
  }
}
