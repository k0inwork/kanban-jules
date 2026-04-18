import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import FS from '@isomorphic-git/lightning-fs';

const fs = new FS('git-repos');
const pfs = fs.promises;

export interface GitFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
}

export class GitFs {
  private repoUrl: string;
  private branch: string;
  private token: string;
  private owner: string;
  private repo: string;
  private dir: string;

  constructor(repoUrl: string, branch: string = 'main', token: string, taskDir?: string) {
    this.repoUrl = repoUrl;
    this.branch = branch;
    this.token = token;

    // Parse owner and repo
    if (this.repoUrl.startsWith('sources/github/')) {
      const parts = this.repoUrl.split('/');
      this.owner = parts[2];
      this.repo = parts[3];
    } else if (this.repoUrl.includes('github.com')) {
      const urlString = this.repoUrl.startsWith('http') ? this.repoUrl : `https://${this.repoUrl}`;
      const url = new URL(urlString);
      const parts = url.pathname.split('/').filter(Boolean);
      this.owner = parts[0];
      this.repo = parts[1];
    } else {
      const parts = this.repoUrl.split('/');
      if (parts.length >= 2) {
        this.owner = parts[0];
        this.repo = parts[1];
      } else {
        this.owner = 'unknown';
        this.repo = this.repoUrl;
      }
    }

    this.dir = taskDir || `/${this.owner}/${this.repo}`;
  }

  /** Get the working directory for this instance */
  getDir(): string { return this.dir; }
  /** Get the base branch */
  getBranch(): string { return this.branch; }
  /** Get the repo URL */
  getRepoUrl(): string { return this.repoUrl; }
  /** Get the auth token */
  getToken(): string { return this.token; }

  /** Build a task-scoped directory path from a task ID */
  static taskDir(repoUrl: string, taskId: string): string {
    const base = new GitFs(repoUrl, 'main', '').dir;
    const shortId = taskId.length > 8 ? taskId.substring(0, 8) : taskId;
    return `${base}--${shortId}`;
  }

  private static initPromises: Record<string, Promise<void>> = {};
  private static lastInitTimes: Record<string, number> = {};

  private async wipeDir(dir: string) {
    try {
      const entries = await pfs.readdir(dir);
      for (const entry of entries) {
        const fullPath = `${dir}/${entry}`;
        const stat = await pfs.stat(fullPath);
        if (stat.isDirectory()) {
          await this.wipeDir(fullPath);
          await pfs.rmdir(fullPath);
        } else {
          await pfs.unlink(fullPath);
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }

  private async initRepo() {
    const now = Date.now();
    const cacheKey = `${this.owner}/${this.repo}/${this.branch}`;
    
    if (GitFs.initPromises[cacheKey] && (now - GitFs.lastInitTimes[cacheKey] < 60000)) { // 1 minute cache
      return GitFs.initPromises[cacheKey];
    }

    GitFs.initPromises[cacheKey] = (async () => {
      try {
        try {
          await pfs.mkdir(`/${this.owner}`);
        } catch (e) {}
        try {
          await pfs.mkdir(this.dir);
        } catch (e) {}

        const url = `https://github.com/${this.owner}/${this.repo}`;
        const corsProxy = 'https://cors.isomorphic-git.org';

        let needsClone = false;
        try {
          // Check if repo is already cloned
          await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' });
          // Pull latest changes
          console.log(`[GitFs] Pulling latest changes for ${this.dir}...`);
          await git.pull({
            fs,
            http,
            dir: this.dir,
            ref: this.branch,
            singleBranch: true,
            author: { name: 'Fleet', email: 'fleet@example.com' },
            corsProxy,
            onAuth: () => ({ username: this.token })
          });
        } catch (e) {
          console.warn(`[GitFs] Pull failed or repo not initialized:`, e);
          needsClone = true;
        }

        if (needsClone) {
          // Wipe directory before cloning to ensure clean state
          await this.wipeDir(this.dir);
          try {
            await pfs.mkdir(this.dir);
          } catch (e) {}

          // Clone if not exists or if pull failed
          console.log(`[GitFs] Cloning ${url} into ${this.dir}...`);
          await git.clone({
            fs,
            http,
            dir: this.dir,
            url,
            ref: this.branch,
            singleBranch: true,
            depth: 1,
            corsProxy,
            onAuth: () => ({ username: this.token })
          });
          console.log(`[GitFs] Successfully cloned ${url} into ${this.dir}.`);
        }
        GitFs.lastInitTimes[cacheKey] = Date.now();
      } catch (error) {
        // If initialization fails, remove from cache so we can retry later
        delete GitFs.initPromises[cacheKey];
        delete GitFs.lastInitTimes[cacheKey];
        throw error;
      }
    })();

    return GitFs.initPromises[cacheKey];
  }

  async getFile(path: string): Promise<string> {
    await this.initRepo();
    const filepath = `${this.dir}/${path}`;
    const content = await pfs.readFile(filepath, 'utf8');
    return content as string;
  }

  async listFiles(path: string = ''): Promise<GitFile[]> {
    await this.initRepo();
    const dirpath = path ? `${this.dir}/${path}` : this.dir;
    
    let entries: string[] = [];
    try {
      entries = await pfs.readdir(dirpath);
    } catch (e) {
      return [];
    }

    const files: GitFile[] = [];
    for (const entry of entries) {
      if (entry === '.git') continue;
      
      const fullPath = `${dirpath}/${entry}`;
      const stat = await pfs.stat(fullPath);
      
      files.push({
        name: entry,
        path: path ? `${path}/${entry}` : entry,
        type: stat.isDirectory() ? 'dir' : 'file',
        size: stat.size
      });
    }
    
    return files;
  }

  async writeFile(path: string, content: string, message: string = 'Update from Fleet'): Promise<void> {
    await this.initRepo();
    const filepath = `${this.dir}/${path}`;
    
    // Ensure directory exists
    const parts = path.split('/');
    parts.pop(); // remove filename
    let currentDir = this.dir;
    for (const part of parts) {
      currentDir += `/${part}`;
      try {
        await pfs.mkdir(currentDir);
      } catch (e) {}
    }

    // Write file
    await pfs.writeFile(filepath, content, 'utf8');
    
    // Git add
    await git.add({ fs, dir: this.dir, filepath: path });
    
    // Git commit
    await git.commit({
      fs,
      dir: this.dir,
      message,
      author: { name: 'Fleet', email: 'fleet@example.com' }
    });
    
    // Git push
    await git.push({
      fs,
      http,
      dir: this.dir,
      ref: this.branch,
      corsProxy: 'https://cors.isomorphic-git.org',
      onAuth: () => ({ username: this.token })
    });
  }

  /**
   * Task Branching API
   * Creates an isolated clone for a task, branches, and supports merge-back.
   */

  /** Clone the base repo into a task-scoped directory and create a branch */
  async createTaskBranch(taskId: string): Promise<string> {
    const taskDir = GitFs.taskDir(this.repoUrl, taskId);
    const branchName = `task/${taskId.length > 8 ? taskId.substring(0, 8) : taskId}`;
    const url = `https://github.com/${this.owner}/${this.repo}`;
    const corsProxy = 'https://cors.isomorphic-git.org';

    // Ensure parent dir exists
    try { await pfs.mkdir(`/${this.owner}`); } catch (e) {}

    // Wipe task dir if it exists (fresh start)
    await this.wipeDir(taskDir);
    try { await pfs.mkdir(taskDir); } catch (e) {}

    // Clone base repo into task dir
    console.log(`[GitFs] Cloning ${url} into task dir ${taskDir}...`);
    await git.clone({
      fs, http,
      dir: taskDir,
      url,
      ref: this.branch,
      singleBranch: true,
      depth: 1,
      corsProxy,
      onAuth: () => ({ username: this.token })
    });

    // Create task branch
    await git.branch({ fs, dir: taskDir, ref: branchName, checkout: true });
    console.log(`[GitFs] Created branch ${branchName} in ${taskDir}`);

    return branchName;
  }

  /** Merge the task branch back into the base branch within the task-scoped dir */
  async mergeTaskBranch(taskId: string, branchName: string): Promise<void> {
    const taskDir = GitFs.taskDir(this.repoUrl, taskId);

    // Switch to base branch
    await git.checkout({ fs, dir: taskDir, ref: this.branch });

    // Merge task branch into base
    try {
      await git.merge({
        fs,
        dir: taskDir,
        ours: this.branch,
        theirs: branchName,
        author: { name: 'Fleet', email: 'fleet@example.com' }
      });
      console.log(`[GitFs] Merged ${branchName} into ${this.branch}`);
    } catch (e: any) {
      if (e.code === 'MergeConflictError') {
        console.error(`[GitFs] Merge conflict merging ${branchName} — leaving task dir for manual resolution`);
        throw e;
      }
      throw e;
    }
  }

  /** Commit without pushing — for local-only task work */
  async commitOnly(path: string, content: string, message: string = 'Task commit'): Promise<void> {
    const filepath = `${this.dir}/${path}`;

    // Ensure directory exists
    const parts = path.split('/');
    parts.pop();
    let currentDir = this.dir;
    for (const part of parts) {
      currentDir += `/${part}`;
      try { await pfs.mkdir(currentDir); } catch (e) {}
    }

    // Write file
    await pfs.writeFile(filepath, content, 'utf8');

    // Git add + commit (no push)
    await git.add({ fs, dir: this.dir, filepath: path });
    await git.commit({
      fs,
      dir: this.dir,
      message,
      author: { name: 'Fleet', email: 'fleet@example.com' }
    });
  }

  /** Push from a task-scoped directory */
  async pushDir(dir: string, ref: string): Promise<void> {
    await git.push({
      fs, http,
      dir,
      ref,
      corsProxy: 'https://cors.isomorphic-git.org',
      onAuth: () => ({ username: this.token })
    });
  }

  /** Clean up a task-scoped directory */
  async cleanupTaskDir(taskId: string): Promise<void> {
    const taskDir = GitFs.taskDir(this.repoUrl, taskId);
    await this.wipeDir(taskDir);
    console.log(`[GitFs] Cleaned up task dir ${taskDir}`);
  }
}
