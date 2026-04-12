import { RequestContext } from '../../core/types';

export class WasmExecutorHandler {
  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'executor-wasm.execute':
        return this.execute(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async execute(args: any[], context: RequestContext): Promise<any> {
    const unpack = (arg: any) =>
      arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
    const obj = unpack(args[0]);
    const command = obj ? obj.command : args[0];

    // Delegate to the WasmHandler in wasm/worker/
    // The handler creates a fresh Web Worker per execution
    const { WasmHandler } = await import('../../wasm/worker/WasmHandler');
    const handler = new WasmHandler();
    return handler.runInVM(command);
  }
}
