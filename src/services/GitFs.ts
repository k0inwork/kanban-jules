import { db } from './db';
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

  constructor(repoUrl: string, branch: string = 'main', token: string) {
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
    
    this.dir = `/${this.owner}/${this.repo}`;
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
}
