/**
 * File: /src/services/Sandbox.ts
 * Description: Secure code execution sandbox.
 * Responsibility: Executes generated JavaScript code in an isolated environment (sval), providing injected APIs for system interaction.
 */
import Sval from 'sval';
import { globalVars } from './GlobalVars';

/**
 * The Sandbox service executes the Main Architect's JS code in a secure,
 * isolated environment using `sval`.
 */
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

  /**
   * Allows injecting additional APIs (like Subagent Negotiators) into the sandbox.
   */
  injectAPI(name: string, api: any): void {
    this.interpreter.import(name, api);
  }

  /**
   * Executes the provided JavaScript code in the sandbox.
   * Supports async execution and top-level return.
   */
  async execute(code: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // Inject resolve and reject into the sandbox for this specific execution
      this.interpreter.import('__resolve', resolve);
      this.interpreter.import('__reject', reject);

      try {
        // Wrap the code in an async IIFE so we can use await at the top level,
        // and capture the return value.
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
        // Catch synchronous parsing/execution errors
        reject(error);
      }
    });
  }
}

// Export a singleton instance
export const sandbox = new Sandbox();
