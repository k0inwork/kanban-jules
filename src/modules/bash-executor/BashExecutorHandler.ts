import { RequestContext } from '../../core/types';

export class BashExecutorHandler {
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
    const cwd = obj?.cwd || '/home';
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
    const unpack = (arg: any) =>
      arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
    const obj = unpack(args[0]) || {};

    const boardVM = (globalThis as any).boardVM;
    if (!boardVM?.bashExec) {
      return { path: '', error: 'bashExec bridge not available' };
    }

    const repoUrl = obj.repoUrl || context.repoUrl;
    const branch = obj.branch || context.repoBranch;
    const targetDir = obj.targetDir || '/home/project';

    if (!repoUrl) {
      return { path: '', error: 'No repository URL configured' };
    }

    // Inject auth token (not visible to agent)
    const authUrl = context.githubToken
      ? repoUrl.replace('https://', `https://${context.githubToken}@`)
      : repoUrl;

    // Check if mirror exists
    const mirrorExists = await boardVM.fsBridge.exists('/home/_mirror');

    if (mirrorExists) {
      // Fast path: copy mirror + checkout
      await boardVM.bashExec({
        command: `cp -r /home/_mirror ${targetDir} && cd ${targetDir} && git checkout ${branch}`,
        cwd: '/home',
        timeout: 60000,
      });
    } else {
      // First time: clone directly + create mirror
      await boardVM.bashExec({
        command: `git clone --branch ${branch} --depth 1 ${authUrl} ${targetDir}`,
        cwd: '/home',
        timeout: 120000,
      });
      // Create mirror for future clones
      boardVM.bashExec({
        command: `git clone --mirror ${authUrl} /home/_mirror`,
        cwd: '/home',
        timeout: 120000,
      }).catch(() => {}); // best-effort, don't block
    }

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
