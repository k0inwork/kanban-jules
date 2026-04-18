import { RequestContext } from '../../core/types';

export class BashExecutorHandler {
  private static _config: { repoUrl: string; repoBranch: string; githubToken: string } | null = null;

  static init(config: any) {
    BashExecutorHandler._config = {
      repoUrl: config.repoUrl || '',
      repoBranch: config.repoBranch || 'main',
      githubToken: config.githubToken || '',
    };
    // Kick off background clone to /tmp/repo-root (fire-and-forget)
    BashExecutorHandler.prefetchRepo();
  }

  private static prefetchRepo() {
    const cfg = BashExecutorHandler._config;
    if (!cfg?.repoUrl) {
      console.log('[bash-executor] No repoUrl configured, skipping prefetch');
      return;
    }
    // Retry until boardVM is ready (Go WASM sets fsBridge asynchronously)
    const waitForBoardVM = async (): Promise<any> => {
      for (let i = 0; i < 30; i++) {
        const bvm = (globalThis as any).boardVM;
        if (bvm?.bashExec && bvm?.fsBridge) return bvm;
        await new Promise(r => setTimeout(r, 1000));
      }
      return null;
    };
    // Fire-and-forget — don't block init
    (async () => {
      try {
        const boardVM = await waitForBoardVM();
        if (!boardVM) {
          console.warn('[bash-executor] Timed out waiting for boardVM, prefetch aborted');
          return;
        }
        const exists = await boardVM.fsBridge.exists('/tmp/repo-root/.git');
        if (exists) {
          console.log('[bash-executor] /tmp/repo-root already exists, pulling latest');
          await boardVM.bashExec({
            command: `cd /tmp/repo-root && git fetch origin && git reset --hard origin/${cfg.repoBranch}`,
            cwd: '/tmp',
            timeout: 60000,
          });
        } else {
          console.log(`[bash-executor] Prefetching ${cfg.repoUrl} → /tmp/repo-root`);
          const authUrl = cfg.githubToken
            ? cfg.repoUrl.replace('https://', `https://${cfg.githubToken}@`)
            : cfg.repoUrl;
          await boardVM.bashExec({
            command: `git clone --branch ${cfg.repoBranch} ${authUrl} /tmp/repo-root`,
            cwd: '/tmp',
            timeout: 120000,
          });
        }
        console.log('[bash-executor] Prefetch complete');
      } catch (err: any) {
        console.warn('[bash-executor] Prefetch failed:', err.message);
      }
    })();
  }

  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'bash-executor.exec':
        return this.exec(args, context);
      case 'bash-executor.clone':
        return this.clone(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async exec(args: any[], _context: RequestContext): Promise<any> {
    const unpack = (arg: any) =>
      arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
    const obj = unpack(args[0]);
    const command = obj ? obj.command : args[0];
    const cwd = obj?.cwd || '/tmp/repo-root';
    const timeout = Math.min(obj?.timeout || 30000, 120000);

    if (!command) {
      return { stdout: '', exitCode: 1, error: 'command is required', durationMs: 0 };
    }

    const boardVM = (globalThis as any).boardVM;
    if (!boardVM?.bashExec) {
      return { stdout: '', exitCode: 1, error: 'bashExec bridge not available', durationMs: 0 };
    }

    return boardVM.bashExec({ command, cwd, timeout });
  }

  private async clone(args: any[], context: RequestContext): Promise<any> {
    const boardVM = (globalThis as any).boardVM;
    if (!boardVM?.fsBridge) {
      return { path: '', error: 'fsBridge not available' };
    }

    // Check if startup prefetch completed
    const exists = await boardVM.fsBridge.exists('/tmp/repo-root/.git');
    if (!exists) {
      return { path: '', error: 'Repo not yet cloned (startup prefetch still running or failed)' };
    }

    const branch = context.repoBranch || 'main';
    const commitResult = await boardVM.bashExec({
      command: 'git rev-parse HEAD',
      cwd: '/tmp/repo-root',
      timeout: 5000,
    });

    return {
      path: '/tmp/repo-root',
      branch,
      commit: (commitResult.stdout || '').trim(),
    };
  }
}
