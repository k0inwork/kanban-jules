import Sval from 'sval';

// Handle messages from main thread
self.onmessage = async (event) => {
  const { type, code, requestId, permissions, sandboxBindings, globals, executionHistory, seed } = event.data as {
    type: string;
    code: string;
    requestId: string;
    permissions: string[];
    sandboxBindings: Record<string, string>;
    globals?: Record<string, any>;
    executionHistory?: any[];
    seed?: number;
  };

  if (type === 'execute') {
    try {
      const interpreter = new Sval({
        ecmaVer: 2019,
        sandBox: true,
      });

      let callIndex = 0;
      const execHistory = executionHistory || [];

      // Helper to bridge tool calls
      const createToolHandler = (toolName: string, perms: string[]) => async (...args: any[]) => {
        const storageTools = [
          'knowledge-repo-browser.readFile',
          'knowledge-repo-browser.writeFile',
          'knowledge-repo-browser.deleteFile',
          'knowledge-repo-browser.headFile',
          'knowledge-artifacts.readArtifact',
          'knowledge-artifacts.saveArtifact',
          'knowledge-artifacts.listArtifacts'
        ];

        if (storageTools.includes(toolName) && !perms.includes('storage')) {
          throw new Error(`Permission denied: storage (tool: ${toolName})`);
        }

        const idx = callIndex++;
        if (idx < execHistory.length) {
          const record = execHistory[idx];
          if (record.error) throw new Error(record.error);
          return record.result;
        }

        const reqId = Math.random().toString(36).substring(7);
        postMessage({ type: 'toolCall', toolName, args, requestId: reqId, index: idx });
        
        return new Promise((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            if (e.data.type === 'toolResponse' && e.data.requestId === reqId) {
              self.removeEventListener('message', handler);
              if (e.data.error) reject(new Error(e.data.error));
              else resolve(e.data.result);
            }
          };
          self.addEventListener('message', handler);
        });
      };

      // --- Determinism Overrides ---
      let currentSeed = seed || Date.now();
      const mulberry32 = () => {
        let t = currentSeed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };

      const deterministicMath = Object.create(Math);
      deterministicMath.random = mulberry32;
      interpreter.import('Math', deterministicMath);

      const deterministicDate = function(...args: any[]) {
        if (args.length === 0) return new Date(); // Partial mock, Date.now is the critical one
        return new (Date as any)(...args);
      };
      deterministicDate.now = () => {
        currentSeed += 10;
        return currentSeed;
      };
      deterministicDate.parse = Date.parse;
      deterministicDate.UTC = Date.UTC;
      interpreter.import('Date', deterministicDate);
      // -----------------------------

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
      // Sval doesn't support dotted names in import() — group them into nested objects
      const namespaces: Record<string, Record<string, any>> = {};
      const plain: Record<string, any> = {};
      for (const [bindingName, toolName] of Object.entries(sandboxBindings)) {
        const dotIndex = bindingName.indexOf('.');
        if (dotIndex !== -1) {
          const ns = bindingName.substring(0, dotIndex);
          const method = bindingName.substring(dotIndex + 1);
          if (!namespaces[ns]) namespaces[ns] = {};
          namespaces[ns][method] = createToolHandler(toolName, permissions);
        } else {
          plain[bindingName] = createToolHandler(toolName, permissions);
        }
      }
      for (const [ns, methods] of Object.entries(namespaces)) {
        interpreter.import(ns, methods);
      }
      for (const [name, fn] of Object.entries(plain)) {
        interpreter.import(name, fn);
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

      interpreter.import('__resolve', (res: any) => {
        postMessage({ type: 'result', requestId, result: res });
      });
      interpreter.import('__reject', (err: any) => {
        postMessage({ type: 'result', requestId, error: err.message });
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
      postMessage({ type: 'result', requestId, error: e.message });
    }
  }
};
