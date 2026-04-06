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
    const [code] = args;
    // The actual execution is handled by the Orchestrator's sandbox.
    // This tool is just a placeholder to satisfy the module interface.
    return { status: 'success', message: 'Code executed locally.' };
  }
}
