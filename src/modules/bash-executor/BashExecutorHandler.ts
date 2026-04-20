import { RequestContext } from '../../core/types';

interface RepoConfig {
  repoUrl: string;
  repoBranch: string;
  githubToken: string;
}

export class BashExecutorHandler {
  private static _configs: Map<string, RepoConfig> = new Map();

  /** Get the per-project repo root path in v86 */
  static repoRootPath(projectId: string): string {
    return `/tmp/repo-root/${projectId}`;
  }

  static init(config: any) {
    const projectId = config.projectId || '_default';
    BashExecutorHandler.storeAndPrefetch(projectId, config);
  }

  /** Call when the user switches project to start cloning the new project's repo */
  static initProject(projectId: string, config: { repoUrl: string; repoBranch: string; githubToken: string }) {
    BashExecutorHandler.storeAndPrefetch(projectId, config);
  }

  private static storeAndPrefetch(projectId: string, config: any) {
    let url: string = config.repoUrl || '';
    // Normalize owner/repo → https://github.com/owner/repo.git
    if (url && !url.startsWith('http') && !url.startsWith('git@')) {
      url = `https://github.com/${url}.git`;
    }
    BashExecutorHandler._configs.set(projectId, {
      repoUrl: url,
      repoBranch: config.repoBranch || 'main',
      githubToken: config.githubToken || '',
    });
    // Kick off background clone (fire-and-forget)
    BashExecutorHandler.prefetchRepo(projectId);
  }

  private static prefetchRepo(projectId: string) {
    const cfg = BashExecutorHandler._configs.get(projectId);
    if (!cfg?.repoUrl) {
      console.log(`[bash-executor] No repoUrl configured for project ${projectId}, skipping prefetch`);
      return;
    }
    const repoRoot = BashExecutorHandler.repoRootPath(projectId);
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
        const exists = await boardVM.fsBridge.exists(`${repoRoot}/.git`);
        if (exists) {
          console.log(`[bash-executor] ${repoRoot} already exists, pulling latest`);
          const r = await boardVM.bashExec({
            command: `cd ${repoRoot} && git fetch origin && git reset --hard origin/${cfg.repoBranch}`,
            cwd: '/tmp',
            timeout: 60000,
          });
          if (r.exitCode !== 0) {
            console.warn('[bash-executor] git fetch/reset failed (repo still usable):', r.stdout || r.error);
          }
        } else {
          console.log(`[bash-executor] Prefetching ${cfg.repoUrl} → ${repoRoot}`);
          const authUrl = cfg.githubToken
            ? cfg.repoUrl.replace('https://', `https://${cfg.githubToken}@`)
            : cfg.repoUrl;
          const r = await boardVM.bashExec({
            command: `mkdir -p /tmp/repo-root && rm -rf ${repoRoot} && git clone --branch ${cfg.repoBranch} ${authUrl} ${repoRoot}`,
            cwd: '/tmp',
            timeout: 120000,
          });
          if (r.exitCode !== 0) {
            console.warn('[bash-executor] git clone failed:', r.stdout || r.error);
            return;
          }
        }
        console.log(`[bash-executor] Prefetch complete for project ${projectId}`);
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

  private async exec(args: any[], context: RequestContext): Promise<any> {
    const unpack = (arg: any) =>
      arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
    const obj = unpack(args[0]);
    const command = obj ? obj.command : args[0];
    const repoDir = `/tmp/${context.taskId || 'default'}/repo`;
    const timeout = Math.min(obj?.timeout || 30000, 120000);

    if (!command) {
      return { stdout: '', exitCode: 1, error: 'command is required', durationMs: 0 };
    }

    const boardVM = (globalThis as any).boardVM;
    if (!boardVM?.bashExec) {
      return { stdout: '', exitCode: 1, error: 'bashExec bridge not available', durationMs: 0 };
    }

    // Default cwd: repo dir if cloned, otherwise /home
    let cwd = obj?.cwd;
    if (!cwd) {
      try {
        cwd = (await boardVM.fsBridge?.exists(repoDir)) ? repoDir : '/home';
      } catch {
        cwd = '/home';
      }
    }

    return boardVM.bashExec({ command, cwd, timeout });
  }

  private async clone(args: any[], context: RequestContext): Promise<any> {
    const boardVM = (globalThis as any).boardVM;
    if (!boardVM?.bashExec || !boardVM?.fsBridge) {
      return { path: '', error: 'boardVM not available' };
    }

    const projectId = context.projectId || '_default';
    const repoRoot = BashExecutorHandler.repoRootPath(projectId);

    // Check if startup prefetch completed for this project
    const exists = await boardVM.fsBridge.exists(`${repoRoot}/.git`);
    if (!exists) {
      return { path: '', error: `Repo not yet cloned for project ${projectId} (startup prefetch still running or failed)` };
    }

    // Copy clean mirror → per-task working directory
    const taskId = context.taskId || 'default';
    const targetDir = `/tmp/${taskId}/repo`;
    await boardVM.bashExec({
      command: `mkdir -p /tmp/${taskId} && rm -rf ${targetDir} && cp -r ${repoRoot} ${targetDir}`,
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
