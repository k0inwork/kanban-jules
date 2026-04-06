import { registry } from './registry';
import Sval from 'sval';
import { globalVars } from '../services/GlobalVars';

export class Sandbox {
  private interpreter: Sval;

  constructor() {
    this.interpreter = new Sval({
      ecmaVer: 2019,
      sandBox: true,
    });

    // Inject GlobalVars as a global object
    this.interpreter.import('GlobalVars', {
      set: (key: string, value: any) => globalVars.set(key, value),
      get: (key: string) => globalVars.get(key),
      getAll: () => globalVars.getAll(),
    });

    // Inject console for debugging
    this.interpreter.import('console', {
      log: (...args: any[]) => console.log('[Sandbox]', ...args),
      error: (...args: any[]) => console.error('[Sandbox Error]', ...args),
      warn: (...args: any[]) => console.warn('[Sandbox Warn]', ...args),
    });
  }

  injectAPI(name: string, api: any): void {
    this.interpreter.import(name, api);
  }

  inject(name: string, api: any): void {
    this.interpreter.import(name, api);
  }

  async execute(code: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.interpreter.import('__resolve', resolve);
      this.interpreter.import('__reject', reject);

      try {
        this.interpreter.run(`
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
      } catch (error) {
        reject(error);
      }
    });
  }
}

export function injectBindings(sandbox: Sandbox, moduleRequest: (toolName: string, args: any) => Promise<any>, context: { accumulatedAnalysis: string[] }) {
  for (const module of registry.getAll()) {
    for (const [alias, toolName] of Object.entries(module.sandboxBindings)) {
      const parts = alias.split('.');
      let current = sandbox;
      
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part]) {
          current[part] = {};
          sandbox.inject(part, current[part]);
        }
        current = current[part];
      }
      
      const lastPart = parts[parts.length - 1];
      const toolFunction = async (...args: any[]) => {
        return moduleRequest(toolName, args);
      };
      
      if (parts.length === 1) {
        sandbox.inject(lastPart, toolFunction);
      } else {
        current[lastPart] = toolFunction;
      }
    }
  }

  sandbox.inject('analyze', (text: string) => {
    context.accumulatedAnalysis.push(text);
  });

  sandbox.inject('addToContext', (text: string) => {
    context.accumulatedAnalysis.push(text);
  });
}
