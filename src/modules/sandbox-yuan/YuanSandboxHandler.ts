import Sval from 'sval';
import { registry } from '../../core/registry';
import { RequestContext } from '../../core/types';

/**
 * Handler for sandbox-yuan module.
 *
 * Runs Sval directly in the main thread (no Web Worker) with ALL enabled module
 * bindings. Yuan's runScript is trusted code (the LLM batching its own tool calls),
 * so Worker isolation isn't needed — Sval's own sandbox is sufficient.
 */
export class YuanSandboxHandler {
  async handleRequest(toolName: string, args: any[], _context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'sandbox-yuan.runScript':
        return this.runScript(args);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async runScript(args: any[]): Promise<any> {
    const unpack = (arg: any) =>
      arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
    const obj = unpack(args[0]);
    const code = obj ? obj.code : args[0];

    if (!code || typeof code !== 'string') {
      throw new Error('code is required and must be a string');
    }

    // Collect all sandboxBindings from all enabled modules
    const modules = registry.getEnabled();
    const sandboxBindings: Record<string, string> = {};
    for (const mod of modules) {
      if (mod.sandboxBindings) {
        Object.assign(sandboxBindings, mod.sandboxBindings);
      }
    }

    // Add common tools (mirrors orchestrator.ts runStep)
    sandboxBindings['__agentContextGet'] = 'host.agentContextGet';
    sandboxBindings['__agentContextSet'] = 'host.agentContextSet';

    // Remove runScript from its own bindings to prevent infinite recursion
    delete sandboxBindings['runScript'];

    const interpreter = new Sval({ ecmaVer: 2019, sandBox: true });

    // Inject tool bindings as async functions that route through the registry
    const toolHandler = (qualifiedName: string) => async (...callArgs: any[]) => {
      const result = await registry.invokeHandler(qualifiedName, callArgs, {
        taskId: 'yuan-script',
        repoUrl: '',
        repoBranch: '',
        githubToken: '',
        llmCall: async () => '',
        moduleConfig: {},
      });
      return result;
    };

    for (const [bindingName, qualifiedName] of Object.entries(sandboxBindings)) {
      const dotIndex = bindingName.indexOf('.');
      if (dotIndex !== -1) {
        // Sval doesn't support dotted import names — group into nested objects
        const ns = bindingName.substring(0, dotIndex);
        const method = bindingName.substring(dotIndex + 1);
        // Merge with existing namespace object
        const existing = (interpreter as any).__namespaces || {};
        if (!existing[ns]) existing[ns] = {};
        existing[ns][method] = toolHandler(qualifiedName);
        (interpreter as any).__namespaces = existing;
      } else {
        interpreter.import(bindingName, toolHandler(qualifiedName));
      }
    }
    // Import namespace objects
    const ns = (interpreter as any).__namespaces || {};
    for (const [name, methods] of Object.entries(ns)) {
      interpreter.import(name, methods);
    }

    // Inject console
    interpreter.import('console', {
      log: (...a: any[]) => console.log('[yuan-script]', ...a),
      error: (...a: any[]) => console.error('[yuan-script]', ...a),
      warn: (...a: any[]) => console.warn('[yuan-script]', ...a),
    });

    // Use a holder object to capture the async result — Sval's run() doesn't return IIFE values
    const holder: { resolve: (v: any) => void; reject: (e: any) => void } = {} as any;
    const resultPromise = new Promise<any>((res, rej) => { holder.resolve = res; holder.reject = rej; });

    interpreter.import('__resolve', (v: any) => holder.resolve(v));
    interpreter.import('__reject', (e: any) => holder.reject(e));

    const wrappedCode = `
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
    `;

    interpreter.run(wrappedCode);
    return await resultPromise;
  }
}
