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
    // v86 boot can take 30-90s, so we poll for up to 3 minutes
    const waitForBoardVM = async (): Promise<any> => {
      for (let i = 0; i < 180; i++) {
        const bvm = (globalThis as any).boardVM;
        if (bvm?.fsBridge && typeof bvm?.bashExec === 'function') {
          // Verify fsBridge actually works (VM filesystem mounted)
          try {
            await bvm.fsBridge.exists('/home');
            return bvm;
          } catch {
            // fsBridge registered but IDB not ready yet
          }
        }
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
    const cwd = obj?.cwd || '/home/project';
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
    if (!boardVM?.bashExec || !boardVM?.fsBridge) {
      return { path: '', error: 'boardVM not available' };
    }

    // Check if startup prefetch completed
    const exists = await boardVM.fsBridge.exists('/tmp/repo-root/.git');
    if (!exists) {
      return { path: '', error: 'Repo not yet cloned (startup prefetch still running or failed)' };
    }

    // Copy clean mirror → working directory
    const targetDir = '/home/project';
    await boardVM.bashExec({
      command: `rm -rf ${targetDir} && cp -r /tmp/repo-root ${targetDir}`,
      cwd: '/home',
      timeout: 60000,
    });

    const branch = context.repoBranch || 'main';
    const commitResult = await boardVM.bashExec({
      command: 'git rev-parse HEAD',
      cwd: targetDir,
      timeout: 5000,
    });

    return {
      path: targetDir,
      branch,
      commit: (commitResult.stdout || '').trim(),
    };
  }
}
