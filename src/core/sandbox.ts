import { registry } from './registry';

export class Sandbox {
  private worker: Worker;
  private pendingToolCalls: Map<string, (result: any, error?: string) => void> = new Map();

  private historyRecorder: ((index: number, result: any, error?: string) => void) | null = null;

  setHistoryRecorder(handler: (index: number, result: any, error?: string) => void) {
    this.historyRecorder = handler;
  }

  constructor() {
    this.worker = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' });
    
    this.worker.onmessage = async (event) => {
      const { type, requestId, result, error, toolName, args, index } = event.data;

      if (type === 'toolCall') {
        if (this.toolRequestHandler) {
          try {
            const res = await this.toolRequestHandler(toolName, args);
            if (this.historyRecorder && index !== undefined) this.historyRecorder(index, res, undefined);
            this.worker.postMessage({ type: 'toolResponse', requestId, result: res });
          } catch (err: any) {
            if (this.historyRecorder && index !== undefined) this.historyRecorder(index, undefined, err.message);
            this.worker.postMessage({ type: 'toolResponse', requestId, error: err.message });
          }
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
    // For now, we'll just log that injection is not supported in the worker yet
    console.warn('[Sandbox] Injection is not supported in the worker yet.');
  }

  async execute(code: string, permissions: string[] = [], sandboxBindings: Record<string, string> = {}, globals?: Record<string, any>, executionHistory: any[] = [], seed?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(7);
      
      this.pendingToolCalls.set(requestId, (result, error) => {
        if (error) reject(new Error(error));
        else resolve(result);
      });

      this.worker.postMessage({ type: 'execute', code, requestId, permissions, sandboxBindings, globals, executionHistory, seed });
    });
  }
}

export function injectBindings(sandbox: Sandbox, moduleRequest: (toolName: string, args: any) => Promise<any>, context: { accumulatedAnalysis: string[] }) {
  sandbox.setToolRequestHandler(moduleRequest);
}
