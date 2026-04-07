import { RequestContext } from '../../core/types';

export class LocalHandler {
  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'executor-local.execute':
        return this.execute(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async execute(args: any[], context: RequestContext): Promise<any> {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;
    const obj = unpack(args[0]);
    const code = obj ? obj.code : args[0];
    
    // The actual execution is handled by the Orchestrator's sandbox.
    // This tool is just a placeholder to satisfy the module interface.
    return { status: 'success', message: 'Code executed locally.' };
  }
}
