/**
 * TerminalService.ts
 *
 * Encapsulates Wanix VM lifecycle and communication for the terminal.
 */

export interface VMConfig {
  bundleUrl: string;
  wasmUrl: string;
  wanixUrl: string;
  apiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
}

export class TerminalService {
  private runtime: any = null;
  private serialReady = false;
  private onOutputCallback: ((data: string) => void) | null = null;
  private logBuffer: string[] = [];

  constructor(private config: VMConfig) {}

  async init(onOutput: (data: string) => void) {
    this.onOutputCallback = onOutput;

    const WanixRuntime = await this.loadWanixRuntime(this.config.wanixUrl);

    // Set up boardVM config for boot.wasm to read
    (window as any).boardVM = {
      mode: 'terminal',
      memoryMB: 1024,
      gitfs: {
        getFile: (_path: string) => Promise.resolve(undefined),
        listFiles: (_path: string) => Promise.resolve([]),
      },
      boardfs: this.createBoardFS(),
      llmfs: this.createLLMFS(),
      toolfs: this.createToolFS(),
    };

    this.runtime = new WanixRuntime({
      screen: false,
      helpers: false,
      debug9p: false,
      wasm: null,
      network: 'fetch',
    });

    const bundleResp = await fetch(this.config.bundleUrl);
    if (!bundleResp.ok) throw new Error(`Failed to fetch bundle: ${bundleResp.status}`);
    this.runtime._bundle = await bundleResp.arrayBuffer();
    this.runtime._getBundle = async () => undefined;

    await this.runtime.ready();

    // Boot WASM
    const wasmResp = await fetch(this.config.wasmUrl);
    if (!wasmResp.ok) throw new Error(`Failed to fetch WASM: ${wasmResp.status}`);
    this.runtime._loadWasm(await wasmResp.arrayBuffer());

    await this.setupConsole();
  }

  private async setupConsole() {
    await this.runtime.waitFor('#console/data', 60000);
    const readFd = await this.runtime.open('#console/data');
    const decoder = new TextDecoder();

    (async () => {
      try {
        for (;;) {
          const chunk: Uint8Array | null = await this.runtime.read(readFd, 4096);
          if (chunk === null) break;
          if (chunk.length > 0) {
            const text = decoder.decode(chunk, { stream: true });
            this.logBuffer.push(text);
            this.onOutputCallback?.(text);
          }
        }
      } catch (e) {
        console.error('[TerminalService] console read error:', e);
      }
    })();

    this.serialReady = true;
    (window as any).__boardSend = (text: string) => this.send(text + '\r');
    (window as any).__boardSendRaw = (data: Uint8Array) => this.sendRaw(data);
  }

  send(text: string) {
    const encoded = new TextEncoder().encode(text);
    return this.sendRaw(encoded);
  }

  sendRaw(data: Uint8Array) {
    if (!this.runtime || !this.serialReady) return Promise.resolve();
    return this.runtime.appendFile('#console/data', data).catch((e: any) => {
      console.error('[TerminalService] send error:', e);
    });
  }

  resize(cols: number, rows: number) {
    console.log(`[TerminalService] resize requested: ${cols}x${rows}`);
    if (this.serialReady) {
      // Send stty command to update the VM's TTY line settings
      // We use \f (form feed) or clear to try to minimize prompt interference,
      // but simply sending the command is often sufficient.
      this.send(`stty cols ${cols} rows ${rows}\n`);
    }
  }

  getLogs() {
    return this.logBuffer.join('');
  }

  clearLogs() {
    this.logBuffer = [];
  }

  private async loadWanixRuntime(url: string): Promise<any> {
    if ((window as any).WanixRuntime) return (window as any).WanixRuntime;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
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
      setTimeout(() => {
        if ((window as any).WanixRuntime) resolve((window as any).WanixRuntime);
        else reject(new Error('WanixRuntime not loaded'));
      }, 5000);
    });
  }

  private createBoardFS() {
    return {
      listTasks: () => Promise.resolve([]),
      getTask: (_id: string) => Promise.resolve(undefined),
      updateTask: (_id: string, _data: any) => Promise.resolve(),
      listArtifacts: () => Promise.resolve([]),
      readArtifact: (_name: string) => Promise.resolve(''),
      saveArtifact: (_name: string, _content: string) => Promise.resolve(),
      invokeTool: (_tool: string, _args: any) => Promise.resolve(undefined),
    };
  }

  private createLLMFS() {
    const config = this.config;
    return {
      sendPrompt: async (prompt: string) => {
        try {
          if (config.apiProvider === 'gemini') {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
            const response = await ai.models.generateContent({
              model: config.geminiModel,
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            return response.text || '';
          } else {
            const response = await fetch(`${config.openaiUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.openaiKey}`,
              },
              body: JSON.stringify({
                model: config.openaiModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
              }),
            });
            if (response.ok) {
              const data = await response.json();
              return data.choices[0].message.content || '';
            }
            throw new Error(`OpenAI error: ${await response.text()}`);
          }
        } catch (e: any) {
          return `ERROR: ${e.message}`;
        }
      },
      sendRequest: async (reqJSON: string) => {
        try {
          const req = JSON.parse(reqJSON);
          req.model = config.openaiModel;
          if (config.apiProvider === 'gemini') {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
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
              model: config.geminiModel,
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
                if (part.text) contentParts.push({ type: 'text', text: part.text });
                else if (part.functionCall) {
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
            return JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion',
              choices: [{
                index: 0,
                message: {
                  role: 'assistant',
                  content: contentParts.map(p => p.text).filter(Boolean).join('') || null,
                  tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                },
                finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
              }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
          } else {
            const response = await fetch(`${config.openaiUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.openaiKey}`,
              },
              body: JSON.stringify(req),
            });
            if (response.ok) return JSON.stringify(await response.json());
            throw new Error(`OpenAI error: ${await response.text()}`);
          }
        } catch (e: any) {
          return JSON.stringify({ error: { message: e.message } });
        }
      }
    };
  }

  private createToolFS() {
    return {
      listTools: async () => {
        return JSON.stringify([
          { name: 'list_tasks', description: 'List all kanban board tasks with their status', params: {} },
          { name: 'get_task', description: 'Get full task details', params: { task_id: { type: 'string', required: true } } },
          { name: 'update_task', description: 'Update task fields', params: { task_id: { type: 'string', required: true }, updates: { type: 'object', required: true } } },
          { name: 'list_artifacts', description: 'List all artifacts', params: {} },
          { name: 'read_artifact', description: 'Read artifact content', params: { name: { type: 'string', required: true } } },
          { name: 'save_artifact', description: 'Save or create an artifact', params: { name: { type: 'string', required: true }, content: { type: 'string', required: true } } },
          { name: 'git_get_file', description: 'Read a file from the git repository', params: { path: { type: 'string', required: true } } },
          { name: 'git_list_files', description: 'List files in a git repository directory', params: { path: { type: 'string', required: false } } },
        ]);
      },
      callTool: async (name: string, paramsJSON: string) => {
        const params = JSON.parse(paramsJSON);
        try {
          const { db } = await import('../../services/db');
          switch (name) {
            case 'list_tasks': {
              const tasks = await db.tasks.toArray();
              return JSON.stringify({ content: JSON.stringify(tasks), error: '' });
            }
            case 'get_task': {
              const task = await db.tasks.get(params.task_id);
              return JSON.stringify({ content: JSON.stringify(task), error: '' });
            }
            case 'update_task': {
              await db.tasks.update(params.task_id, params.updates);
              return JSON.stringify({ content: 'Updated', error: '' });
            }
            case 'list_artifacts': {
              const artifacts = await db.taskArtifacts.toArray();
              return JSON.stringify({ content: JSON.stringify(artifacts), error: '' });
            }
            case 'read_artifact': {
              const artifact = await db.taskArtifacts.where('name').equals(params.name).first();
              return JSON.stringify({ content: artifact?.content || '', error: artifact ? '' : 'Not found' });
            }
            case 'save_artifact': {
              await db.taskArtifacts.add({ name: params.name, content: params.content, taskId: '', repoName: '', branchName: '' });
              return JSON.stringify({ content: 'Saved', error: '' });
            }
            case 'git_get_file': {
              const content = await (window as any).boardVM?.gitfs?.getFile(params.path);
              return JSON.stringify({ content: content || '', error: content ? '' : 'Not found' });
            }
            case 'git_list_files': {
              const files = await (window as any).boardVM?.gitfs?.listFiles(params.path || '');
              return JSON.stringify({ content: JSON.stringify(files), error: '' });
            }
            default: return JSON.stringify({ content: '', error: `Unknown tool: ${name}` });
          }
        } catch (e: any) {
          return JSON.stringify({ content: '', error: e.message });
        }
      },
    };
  }
}
