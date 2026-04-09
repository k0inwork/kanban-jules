import { useEffect, useRef, useState, useCallback } from 'react';

export const BUILD = 35;

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

    term.writeln(`\r\n\x1b[1;36m●\x1b[0m Starting terminal (v${BUILD})...\r\n`);

    try {
      // Load WanixRuntime — fetch the ESM module and eval it to extract the export
      // Vite blocks import() for files in /public, so we fetch + eval instead
      const WanixRuntime = await loadWanixRuntime(wanixUrl);

      if (!WanixRuntime) {
        term.writeln('\r\n[error: WanixRuntime not exported from wanix.min.js]\r\n');
        return;
      }

      // Set up boardVM config for boot.wasm to read
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
            console.log('[llmfs] sendPrompt:', prompt);
            try {
              if (apiProvider === 'gemini') {
                const { GoogleGenAI } = await import('@google/genai');
                const ai = new GoogleGenAI({ apiKey: geminiApiKey });
                const response = await ai.models.generateContent({
                  model: geminiModel,
                  contents: [{ role: 'user', parts: [{ text: prompt }] }],
                });
                return response.text || '';
              } else {
                const response = await fetch(`${openaiUrl}/chat/completions`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiKey}`,
                  },
                  body: JSON.stringify({
                    model: openaiModel,
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
              if (apiProvider === 'gemini') {
                // Convert OpenAI format to Gemini format
                const { GoogleGenAI } = await import('@google/genai');
                const ai = new GoogleGenAI({ apiKey: geminiApiKey });
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
                  model: geminiModel,
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
                // OpenAI-compatible: pass through directly
                const response = await fetch(`${openaiUrl}/chat/completions`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiKey}`,
                  },
                  body: reqJSON,
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
              console.error('[llmfs] sendRequest error:', e);
              return JSON.stringify({ error: { message: e.message } });
            }
          },
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

      // Create Wanix runtime instance (no screen, no helpers)
      const w = new WanixRuntime({
        screen: false,
        helpers: false,
        debug9p: false,
        wasm: null,
        network: 'fetch',
      });
      runtimeRef.current = w;

      // Load the sys.tar.gz bundle
      const bundleResp = await fetch(bundleUrl);
      if (!bundleResp.ok) throw new Error(`Failed to fetch bundle: ${bundleResp.status}`);
      const bundleData = await bundleResp.arrayBuffer();
      w._bundle = bundleData;
      w._getBundle = async () => undefined;

      // Wait for WASM ready, then connect serial to xterm
      w.ready().then(async () => {
        term.writeln('\r\n\x1b[1;36m●\x1b[0m VM ready, connecting console...\r\n');
        onReady?.();

        try {
          // Wait for the v86 VM to boot and serial to be available.
          await w.waitFor('#console/data', 60000);
          term.writeln('\x1b[1;32m●\x1b[0m Connected.\r\n');

          // --- Console output: read from #console/data (pipe Port 1) ---
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

          // Mark ready
          (runtimeRef.current as any)._serialReady = true;
          // Expose send function on window so GUI input bar can call it
          (window as any).__boardSend = (text: string) => {
            const encoded = new TextEncoder().encode(text + '\r');
            return w.appendFile('#console/data', encoded).catch((e: any) => {
              console.error('[TerminalPanel] send error:', e);
            });
          };
          // Raw keystroke send (no \r) for interactive typing
          (window as any).__boardSendRaw = (data: Uint8Array) => {
            return w.appendFile('#console/data', data).catch((e: any) => {
              console.error('[TerminalPanel] sendRaw error:', e);
            });
          };
          setSerialReady(true);
        } catch (serialErr: any) {
          console.error('[TerminalPanel] console setup error:', serialErr);
          term.writeln(`\r\n[console setup error: ${serialErr.message}]\r\n`);
        }
      });

      // Load and boot the WASM
      const wasmResp = await fetch(wasmUrl);
      if (!wasmResp.ok) throw new Error(`Failed to fetch WASM: ${wasmResp.status}`);
      const wasmData = await wasmResp.arrayBuffer();
      w._loadWasm(wasmData);

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

    // Resize handling
    const onResize = () => fitAddon.fit();
    window.addEventListener('resize', onResize);

    // Refit when the container becomes visible (e.g. tab switch)
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
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
