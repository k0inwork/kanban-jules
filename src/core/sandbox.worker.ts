import Sval from 'sval';

// Helper to bridge tool calls
const createToolHandler = (toolName: string) => async (...args: any[]) => {
  const requestId = Math.random().toString(36).substring(7);
  postMessage({ type: 'toolCall', toolName, args, requestId });
  
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'toolResponse' && event.data.requestId === requestId) {
        self.removeEventListener('message', handler);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      }
    };
    self.addEventListener('message', handler);
  });
};

// Handle messages from main thread
self.onmessage = async (event) => {
  const { type, code, requestId, permissions, sandboxBindings } = event.data as {
    type: string;
    code: string;
    requestId: string;
    permissions: string[];
    sandboxBindings: Record<string, string>;
  };

  if (type === 'execute') {
    try {
      const interpreter = new Sval({
        ecmaVer: 2019,
        sandBox: true,
      });

      // 1. Inject console if allowed
      if (permissions.includes('logging')) {
        interpreter.import('console', {
          log: (...args: any[]) => postMessage({ type: 'console', method: 'log', args }),
          error: (...args: any[]) => postMessage({ type: 'console', method: 'error', args }),
          warn: (...args: any[]) => postMessage({ type: 'console', method: 'warn', args }),
        });
      }

      // 2. Inject allowed tools based on sandboxBindings
      for (const [bindingName, toolName] of Object.entries(sandboxBindings)) {
        interpreter.import(bindingName, createToolHandler(toolName));
      }

      interpreter.import('__resolve', (res: any) => postMessage({ type: 'result', requestId, result: res }));
      interpreter.import('__reject', (err: any) => postMessage({ type: 'result', requestId, error: err.message }));

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
      postMessage({ type: 'result', requestId, error: e.message });
    }
  }
};
