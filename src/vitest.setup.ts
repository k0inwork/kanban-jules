import { vi } from 'vitest';
import 'fake-indexeddb/auto';
import Sval from 'sval';

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  private pendingToolCalls: Map<string, (result: any, error?: string) => void> = new Map();

  postMessage(message: any) {
    const { type, code, requestId, globals, injectedAPIs, toolName, result, error } = message;

    if (type === 'execute') {
      try {
        const interpreter = new Sval({
          ecmaVer: 2019,
          sandBox: true,
        });

        if (globals) {
          for (const [name, value] of Object.entries(globals)) {
            interpreter.import(name, value);
          }
        }

        if (injectedAPIs) {
          for (const [apiName, methods] of Object.entries(injectedAPIs)) {
            const apiProxy: Record<string, any> = {};
            for (const methodName of (methods as string[])) {
              apiProxy[methodName] = (...args: any[]) => {
                const reqId = Math.random().toString(36).substring(7);
                if (this.onmessage) {
                  this.onmessage({ data: { type: 'toolCall', toolName: `${apiName}.${methodName}`, args, requestId: reqId } } as MessageEvent);
                }
                return new Promise((resolve, reject) => {
                  this.pendingToolCalls.set(reqId, (res, err) => {
                    if (err) reject(new Error(err));
                    else resolve(res);
                  });
                });
              };
            }
            interpreter.import(apiName, apiProxy);
          }
        }

        interpreter.import('__resolve', (res: any) => {
          if (this.onmessage) {
            this.onmessage({ data: { type: 'result', requestId, result: res } } as MessageEvent);
          }
        });

        interpreter.import('__reject', (err: any) => {
          if (this.onmessage) {
            this.onmessage({ data: { type: 'result', requestId, error: err.message } } as MessageEvent);
          }
        });

        interpreter.run(`
          (async () => {
            try {
              const __result = await (async () => {
                ${code}
              })();
              __resolve(__result);
            } catch (e) {
              __reject(e);
            }
          })();
        `);
      } catch (e: any) {
        if (this.onmessage) {
          this.onmessage({ data: { type: 'result', requestId, error: e.message } } as MessageEvent);
        }
      }
    } else if (type === 'toolResponse') {
      const resolver = this.pendingToolCalls.get(requestId);
      if (resolver) {
        resolver(result, error);
        this.pendingToolCalls.delete(requestId);
      }
    }
  }

  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

global.Worker = MockWorker as any;
