import { registry } from './registry';

export class Sandbox {
  private worker: Worker;
  private pendingToolCalls: Map<string, (result: any, error?: string) => void> = new Map();
  private injectedAPIs: Record<string, any> = {};

  private historyRecorder: ((index: number, result: any, error?: string) => void) | null = null;

  setHistoryRecorder(handler: (index: number, result: any, error?: string) => void) {
    this.historyRecorder = handler;
  }

  constructor() {
    this.worker = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' });
    
    this.worker.onmessage = async (event) => {
      const { type, requestId, result, error, toolName, args, index } = event.data;

      if (type === 'toolCall') {
        // Handle both registered tools and injected APIs via toolName format "apiName.methodName"
        const [apiName, methodName] = toolName.split('.');

        try {
          let res: any;
          if (methodName && this.injectedAPIs[apiName]) {
            res = await this.injectedAPIs[apiName][methodName](...args);
          } else if (this.toolRequestHandler) {
            res = await this.toolRequestHandler(toolName, args);
          } else {
            throw new Error(`Tool or API not found: ${toolName}`);
          }

          if (this.historyRecorder && index !== undefined) this.historyRecorder(index, res, undefined);
          this.worker.postMessage({ type: 'toolResponse', requestId, result: res });
        } catch (err: any) {
          if (this.historyRecorder && index !== undefined) this.historyRecorder(index, undefined, err.message);
          this.worker.postMessage({ type: 'toolResponse', requestId, error: err.message });
        }
      } else if (type === 'result') {
        const resolver = this.pendingToolCalls.get(requestId);
        if (resolver) {
          resolver(result, error);
          this.pendingToolCalls.delete(requestId);
        }
      }
    };
  }

  private toolRequestHandler: ((toolName: string, args: any) => Promise<any>) | null = null;

  setToolRequestHandler(handler: (toolName: string, args: any) => Promise<any>) {
    this.toolRequestHandler = handler;
  }

  inject(name: string, api: any): void {
    this.injectedAPIs[name] = api;
  }

  async execute(code: string, permissions: string[] = [], sandboxBindings: Record<string, string> = {}, globals?: Record<string, any>, executionHistory: any[] = [], seed?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(7);
      
      this.pendingToolCalls.set(requestId, (result, error) => {
        if (error) reject(new Error(error));
        else resolve(result);
      });

      // Instead of merging APIs directly (which fail estructured clone if they have functions),
      // we only pass non-function globals and use a proxy mechanism for APIs.
      const serializableGlobals: Record<string, any> = {};
      const injectedAPIDefinitions: Record<string, string[]> = {};

      if (globals) {
        for (const [key, value] of Object.entries(globals)) {
          if (typeof value !== 'function') {
            serializableGlobals[key] = value;
          }
        }
      }

      for (const [name, api] of Object.entries(this.injectedAPIs)) {
        injectedAPIDefinitions[name] = Object.keys(api).filter(k => typeof api[k] === 'function');
      }

      this.worker.postMessage({
        type: 'execute',
        code,
        requestId,
        permissions,
        sandboxBindings,
        globals: serializableGlobals,
        injectedAPIs: injectedAPIDefinitions,
        executionHistory,
        seed
      });
    });
  }
}

export function injectBindings(sandbox: Sandbox, moduleRequest: (toolName: string, args: any) => Promise<any>, context: { accumulatedAnalysis: string[] }) {
  sandbox.setToolRequestHandler(moduleRequest);
}
