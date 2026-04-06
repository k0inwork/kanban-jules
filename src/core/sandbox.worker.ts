import Sval from 'sval';

const interpreter = new Sval({
  ecmaVer: 2019,
  sandBox: true,
});

// Inject console for debugging
interpreter.import('console', {
  log: (...args: any[]) => postMessage({ type: 'console', method: 'log', args }),
  error: (...args: any[]) => postMessage({ type: 'console', method: 'error', args }),
  warn: (...args: any[]) => postMessage({ type: 'console', method: 'warn', args }),
});

// Handle messages from main thread
self.onmessage = async (event) => {
  const { type, code, requestId, result, error } = event.data;

  if (type === 'execute') {
    try {
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
  } else if (type === 'toolResponse') {
    // This is handled by the promise resolver in the main thread
  }
};

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

// Inject tool handlers (this needs to be dynamic based on the bindings)
// For now, we'll just expose a generic tool requester
interpreter.import('__toolRequest', createToolHandler);
