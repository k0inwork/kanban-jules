import { RequestContext } from '../../core/types';

/**
 * WasmHandler — Module handler for the WASM executor.
 *
 * Boots a Wanix VM via a Web Worker, sends commands, collects output.
 * Fits the same module interface as LocalHandler and GithubHandler.
 */
export class WasmHandler {
  private worker: Worker | null = null;

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
    const code = obj ? obj.code : args[0];

    const result = await this.runInVM(code);
    return result;
  }

  /**
   * Run a command in a fresh ephemeral VM.
   * Returns output and exit code.
   */
  private runInVM(command: string): Promise<{ status: string; output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('./vm-worker.ts', import.meta.url),
        { type: 'module' }
      );

      const assetBase = '/assets/wasm';

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === 'result') {
          worker.terminate();
          resolve({
            status: 'success',
            output: msg.output,
            exitCode: msg.exitCode,
          });
        }

        if (msg.type === 'error') {
          worker.terminate();
          resolve({
            status: 'error',
            output: msg.error,
            exitCode: 1,
          });
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      // Boot the VM in executor mode
      worker.postMessage({
        type: 'init',
        mode: 'executor',
        command,
        bundleUrl: `${assetBase}/sys.tar.gz`,
        wasmUrl: `${assetBase}/boot.wasm`,
        wanixUrl: `${assetBase}/wanix.min.js`,
      });
    });
  }
}
