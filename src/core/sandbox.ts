import { registry } from './registry';

export function injectBindings(sandbox: any, moduleRequest: (toolName: string, args: any) => Promise<any>, context: { accumulatedAnalysis: string[] }) {
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
