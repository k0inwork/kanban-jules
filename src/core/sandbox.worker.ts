import Sval from 'sval';

// Helper to bridge tool calls
const createToolHandler = (toolName: string, permissions: string[]) => async (...args: any[]) => {
  const storageTools = [
    'knowledge-repo-browser.readFile',
    'knowledge-repo-browser.writeFile',
    'knowledge-repo-browser.deleteFile',
    'knowledge-repo-browser.headFile',
    'knowledge-artifacts.readArtifact',
    'knowledge-artifacts.saveArtifact',
    'knowledge-artifacts.listArtifacts'
  ];

  if (storageTools.includes(toolName) && !permissions.includes('storage')) {
    throw new Error(`Permission denied: storage (tool: ${toolName})`);
  }

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
  const { type, code, requestId, permissions, sandboxBindings, globals } = event.data as {
    type: string;
    code: string;
    requestId: string;
    permissions: string[];
    sandboxBindings: Record<string, string>;
    globals?: Record<string, any>;
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

      // 1.1 Enforce network and timer permissions
      if (!permissions.includes('network')) {
        const denyNetwork = () => { throw new Error('Permission denied: network'); };
        interpreter.import('fetch', denyNetwork);
        interpreter.import('XMLHttpRequest', denyNetwork);
        interpreter.import('WebSocket', denyNetwork);
      }

      if (!permissions.includes('timers')) {
        const denyTimers = () => { throw new Error('Permission denied: timers'); };
        interpreter.import('setTimeout', denyTimers);
        interpreter.import('setInterval', denyTimers);
        interpreter.import('requestAnimationFrame', denyTimers);
      } else {
        interpreter.import('setTimeout', setTimeout);
        interpreter.import('setInterval', setInterval);
      }

      // 2. Inject allowed tools based on sandboxBindings
      for (const [bindingName, toolName] of Object.entries(sandboxBindings)) {
        interpreter.import(bindingName, createToolHandler(toolName, permissions));
      }

      // 3. Define AgentContext using tool bindings
      interpreter.run(`
        const AgentContext = {
          get: (key) => __agentContextGet(key),
          set: (key, value) => __agentContextSet(key, value)
        };
      `);

      // 4. Inject direct globals
      if (globals) {
        for (const [name, value] of Object.entries(globals)) {
          interpreter.import(name, value);
        }
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
